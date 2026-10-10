// FireRed-specific reads: what the Viewer shows. All addresses and layouts come
// from the debug info; this file only knows names of game variables.
import { join } from "node:path";
import type { Memory, Ref } from "./memory";
import { functionName } from "./symbols";

const REPO_DIR = join(import.meta.dir, "..", "..");

/** Cells around the visible map: the map grid adds this border on each side. */
const MAP_OFFSET = 7;
const NUM_METATILES_IN_PRIMARY = 640;
const FLAG_BADGE01_GET = 0x820;
// For substruct order n = personality % 24, the position of the growth substruct (species).
const GROWTH_POSITION = [0, 0, 0, 0, 0, 0, 1, 1, 2, 3, 2, 3, 1, 1, 2, 3, 2, 3, 1, 1, 2, 3, 2, 3];
// Ledge behaviors, as the arrow of the jump direction.
const MB_JUMP: Record<number, string> = { 0x38: ">", 0x39: "<", 0x3a: "^", 0x3b: "v" };
const MB_TALL_GRASS = 0x02;
const BG_EVENT_HIDDEN_ITEM = 7;
const OBJ_KIND_NORMAL = 0;
const TRAINER_TYPE_NORMAL = 1;
const TRAINER_FLAGS_START = 0x500;
const FLAG_HIDDEN_ITEMS_START = 0x3e8;
const VARS_START = 0x4000;
const SPECIAL_VARS_START = 0x8000;
const DIRECTION_NAMES: Record<number, string> = { 1: "south", 2: "north", 3: "west", 4: "east", 5: "dive", 6: "emerge" };
const DIRECTION_STEP: Record<number, [number, number]> = { 1: [0, 1], 2: [0, -1], 3: [-1, 0], 4: [1, 0] };
// MOVEMENT_TYPE_FACE_UP/DOWN/LEFT/RIGHT: the direction of a person not loaded in memory.
const FACING_OF_MOVEMENT: Record<number, number> = { 0x7: 2, 0x8: 1, 0x9: 3, 0xa: 4 };

export type PartyMon = { species: string; nickname: string; level: number; hp: number; maxHp: number };

export type GameState = {
  map: { group: number; num: number; name: string };
  player: { x: number; y: number } | null;
  party: PartyMon[];
  badges: boolean[];
  money: number;
  context: { mode: "overworld" | "battle" | "other"; callback1: string; callback2: string };
};

export type Camera = { x: number; y: number };

export type MapGrid = {
  /** "group.num": changes when the map changes. */
  key: string;
  group: number;
  num: number;
  name: string;
  /** Map coordinates of the first cell: the player's map has a border of 7 cells on each side. */
  x0: number;
  y0: number;
  width: number;
  height: number;
  /** Size of the map itself, inside the border. */
  mapWidth: number;
  mapHeight: number;
  /** One character per cell, row by row: # blocked, ~ water, " tall grass, ^ v < > ledge (jump direction), . open. */
  kinds: string;
  /** Raw grid value per cell: metatile (bits 0-9), collision (10-11), elevation (12-15). */
  blocks: number[];
  /** Metatile behavior id per cell; names in behaviorNames. */
  behaviors: number[];
  behaviorNames: Record<number, string>;
  /** `how`: what the player does to take the warp; a warp event on a normal cell does nothing. */
  warps: { x: number; y: number; to: string; group: number; num: number; behavior: string; how: "step" | "press" | "none" }[];
  connections: { direction: string; offset: number; map: string; group: number; num: number }[];
  signs: { x: number; y: number; kind: "sign" | "hidden-item" }[];
  /** Cells that start a script when the player steps on them, if `variable` has `value`. */
  triggers: { x: number; y: number; variable: number; value: number; weather: boolean }[];
};

export type MapActors = {
  player: { x: number; y: number; facing: number } | null;
  /** Every person of the map. `loaded`: the game has it in memory now (near the screen). */
  people: {
    localId: number;
    x: number;
    y: number;
    /** 1 south, 2 north, 3 west, 4 east, 0 unknown. */
    facing: number;
    loaded: boolean;
    /** The area where a wandering person can walk. */
    wander?: { x: number; y: number; w: number; h: number };
    trainer?: { id: number; defeated: boolean; range: number; allDirections: boolean; sight: [number, number][] };
  }[];
  /** Per grid trigger: true active, false inactive, null unknown (special variable). */
  triggers: (boolean | null)[];
  /** Per grid sign: hidden items say if they were found. */
  signs: ({ found: boolean } | null)[];
};

export class Game {
  private readonly charmap: string[];
  private readonly behaviorNames: Map<number, string>;
  private readonly mapNames: string[][];
  private readonly attributeCache = new Map<number, Uint32Array>();

  private constructor(
    private readonly mem: Memory,
    tables: { charmap: string[]; behaviorNames: Map<number, string>; mapNames: string[][] },
  ) {
    this.charmap = tables.charmap;
    this.behaviorNames = tables.behaviorNames;
    this.mapNames = tables.mapNames;
  }

  static async create(mem: Memory): Promise<Game> {
    const [charmapText, behaviorsText, groups] = await Promise.all([
      Bun.file(join(REPO_DIR, "charmap.txt")).text(),
      Bun.file(join(REPO_DIR, "include/constants/metatile_behaviors.h")).text(),
      Bun.file(join(REPO_DIR, "data/maps/map_groups.json")).json(),
    ]);
    const charmap: string[] = [];
    for (const m of charmapText.matchAll(/^'(.)'\s*=\s*([0-9A-F]{2})\s*$/gm)) charmap[parseInt(m[2], 16)] = m[1];
    const behaviorNames = new Map<number, string>();
    for (const m of behaviorsText.matchAll(/^#define (MB_\w+)\s+(0x[0-9A-Fa-f]+)/gm)) behaviorNames.set(Number(m[2]), m[1]);
    const mapNames = (groups.group_order as string[]).map((g) => groups[g] as string[]);
    return new Game(mem, { charmap, behaviorNames, mapNames });
  }

  decodeText(bytes: Uint8Array): string {
    let out = "";
    for (const b of bytes) {
      if (b === 0xff) break;
      out += this.charmap[b] ?? "?";
    }
    return out;
  }

  private get saveBlock1(): Ref {
    return this.mem.global("gSaveBlock1Ptr").deref();
  }

  private playerObject(): Ref | null {
    const avatar = this.mem.global("gPlayerAvatar");
    const objects = this.mem.global("gObjectEvents");
    const id = avatar.field("objectEventId").int();
    if (id >= objects.length) return null;
    const obj = objects.at(id);
    return obj.field("active").int() ? obj : null;
  }

  state(): GameState {
    const sb1 = this.saveBlock1;
    const location = sb1.field("location");
    const group = location.field("mapGroup").int();
    const num = location.field("mapNum").int();
    const player = this.playerObject();
    const coords = player?.field("currentCoords");
    return {
      map: { group, num, name: this.mapNames[group]?.[num] ?? `${group}.${num}` },
      player: coords ? { x: coords.field("x").int() - MAP_OFFSET, y: coords.field("y").int() - MAP_OFFSET } : null,
      party: this.party(),
      badges: Array.from({ length: 8 }, (_, i) => this.flag(FLAG_BADGE01_GET + i)),
      money: (sb1.field("money").int() ^ this.mem.global("gSaveBlock2Ptr").deref().field("encryptionKey").int()) >>> 0,
      context: this.context(),
    };
  }

  flag(id: number): boolean {
    const byte = this.saveBlock1.field("flags").at(id >> 3).int();
    return ((byte >> (id & 7)) & 1) === 1;
  }

  private context(): GameState["context"] {
    const main = this.mem.global("gMain");
    const name = (field: string) => {
      const address = main.field(field).pointer();
      return address === 0 ? "-" : (functionName(this.mem.symbols, address) ?? `0x${address.toString(16)}`);
    };
    const callback1 = name("callback1");
    const callback2 = name("callback2");
    const mode = callback2 === "CB2_Overworld" ? "overworld" : callback2 === "BattleMainCB2" ? "battle" : "other";
    return { mode, callback1, callback2 };
  }

  private party(): PartyMon[] {
    const count = Math.min(this.mem.global("gPlayerPartyCount").int(), 6);
    const party = this.mem.global("gPlayerParty");
    const out: PartyMon[] = [];
    for (let i = 0; i < count; i++) {
      const mon = party.at(i);
      const box = mon.field("box");
      const personality = box.field("personality").int();
      const key = (personality ^ box.field("otId").int()) >>> 0;
      // The 48 secure bytes are 4 substructs of 12 bytes, XOR-ed with the key and shuffled.
      const raw = box.field("secure").bytes(48);
      const words = new DataView(raw.buffer);
      for (let w = 0; w < 12; w++) words.setUint32(w * 4, (words.getUint32(w * 4, true) ^ key) >>> 0, true);
      const growth = GROWTH_POSITION[personality % 24] * 12;
      const species = words.getUint16(growth, true);
      out.push({
        species: this.speciesName(species),
        nickname: this.decodeText(box.field("nickname").bytes()),
        level: mon.field("level").int(),
        hp: mon.field("hp").int(),
        maxHp: mon.field("maxHP").int(),
      });
    }
    return out;
  }

  private speciesName(species: number): string {
    const names = this.mem.global("gSpeciesNames");
    if (species <= 0 || species >= names.length) return `#${species}`;
    return this.decodeText(names.at(species).bytes());
  }

  /** Metatile attributes of a tileset, read once per tileset. */
  private attributes(tileset: Ref, count: number): Uint32Array {
    const address = tileset.pointer();
    let cached = this.attributeCache.get(address);
    if (!cached) {
      const table = tileset.deref().field("metatileAttributes").pointer();
      const bytes = this.mem.bus.read(table, count * 4);
      cached = new Uint32Array(bytes.buffer.slice(0));
      this.attributeCache.set(address, cached);
    }
    return cached;
  }

  /** Screen position of map cell (0, 0), in GBA pixels. Null when not on the overworld. */
  camera(): Camera | null {
    if (this.context().mode !== "overworld") return null;
    // The game draws cell (pos.x, pos.y) of the map grid at tile (xTileOffset, yTileOffset)
    // of the background, then scrolls the background by (HOFS, VOFS). See field_camera.c.
    const pos = this.saveBlock1.field("pos");
    const cam = this.mem.global("sFieldCameraOffset");
    const hofs = cam.field("xPixelOffset").int() + this.mem.global("sHorizontalCameraPan").int();
    const vofs = cam.field("yPixelOffset").int() + this.mem.global("sVerticalCameraPan").int() + 8;
    // The background is 256 px wide and wraps; the drawn area starts above and left of the screen.
    const wrap = (v: number) => ((((v + 128) % 256) + 256) % 256) - 128;
    const originX = wrap(cam.field("xTileOffset").int() * 8 - hofs);
    const originY = wrap(cam.field("yTileOffset").int() * 8 - vofs);
    return {
      x: originX + (MAP_OFFSET - pos.field("x").int()) * 16,
      y: originY + (MAP_OFFSET - pos.field("y").int()) * 16,
    };
  }

  /** Map header in ROM. The current map also has a copy in RAM (gMapHeader). */
  private mapHeader(group: number, num: number): Ref {
    return this.mem.global("gMapGroups").at(group).at(num).deref();
  }

  private eventList(header: Ref, arrayField: string, countField: string): Ref[] {
    const events = header.field("events").deref();
    const count = events.field(countField).int();
    return Array.from({ length: count }, (_, i) => events.field(arrayField).at(i));
  }

  private mapName(group: number, num: number): string {
    return this.mapNames[group]?.[num] ?? `${group}.${num}`;
  }

  /** All map names, by group then number. */
  get allMapNames(): string[][] {
    return this.mapNames;
  }

  private location(): { group: number; num: number } {
    const location = this.saveBlock1.field("location");
    return { group: location.field("mapGroup").int(), num: location.field("mapNum").int() };
  }

  /**
   * The grid of the player's map, from RAM: it has a border of 7 cells with the edges of the
   * neighbor maps, and the cells that scripts changed. Null when not on the overworld.
   */
  grid(): MapGrid | null {
    if (this.context().mode !== "overworld") return null;
    const vmap = this.mem.global("VMap");
    const width = vmap.field("Xsize").int();
    const height = vmap.field("Ysize").int();
    const bytes = this.mem.bus.read(vmap.field("map").pointer(), width * height * 2);
    const { group, num } = this.location();
    return this.buildGrid(group, num, this.mem.global("gMapHeader"), bytes, width, height, MAP_OFFSET);
  }

  /** The grid of any map, from ROM: no border, and as the map is before its scripts run. */
  gridOf(group: number, num: number): MapGrid | null {
    if (!this.mapNames[group]?.[num]) return null;
    const header = this.mapHeader(group, num);
    const layout = header.field("mapLayout").deref();
    const width = layout.field("width").int();
    const height = layout.field("height").int();
    const bytes = this.mem.bus.read(layout.field("map").pointer(), width * height * 2);
    return this.buildGrid(group, num, header, bytes, width, height, 0);
  }

  private buildGrid(group: number, num: number, header: Ref, bytes: Uint8Array, width: number, height: number, border: number): MapGrid {
    const layout = header.field("mapLayout").deref();
    const primary = this.attributes(layout.field("primaryTileset"), NUM_METATILES_IN_PRIMARY);
    const secondary = this.attributes(layout.field("secondaryTileset"), 1024 - NUM_METATILES_IN_PRIMARY);
    const surfable = this.mem.global("sBehaviorSurfable");

    let kinds = "";
    const blocks: number[] = [];
    const behaviors: number[] = [];
    const behaviorNames: Record<number, string> = {};
    for (let i = 0; i < width * height; i++) {
      const block = bytes[i * 2] | (bytes[i * 2 + 1] << 8);
      const metatile = block & 0x03ff;
      const attrs = metatile < NUM_METATILES_IN_PRIMARY ? primary[metatile] : secondary[metatile - NUM_METATILES_IN_PRIMARY];
      const behavior = (attrs ?? 0) & 0x1ff;
      behaviorNames[behavior] ??= this.behaviorNames.get(behavior) ?? `0x${behavior.toString(16)}`;
      blocks.push(block);
      behaviors.push(behavior);
      kinds +=
        block === 0x03ff || block & 0x0c00 ? "#"
        : behavior < surfable.length && surfable.at(behavior).int() & 1 ? "~"
        : (MB_JUMP[behavior] ?? (behavior === MB_TALL_GRASS ? '"' : "."));
    }

    const connectionsRef = header.field("connections");
    const connections: MapGrid["connections"] = [];
    if (connectionsRef.pointer() !== 0) {
      const list = connectionsRef.deref();
      for (let i = 0; i < list.field("count").int(); i++) {
        const c = list.field("connections").at(i);
        const toGroup = c.field("mapGroup").int();
        const toNum = c.field("mapNum").int();
        connections.push({
          direction: DIRECTION_NAMES[c.field("direction").int()] ?? `#${c.field("direction").int()}`,
          offset: c.field("offset").int() | 0,
          map: this.mapName(toGroup, toNum),
          group: toGroup,
          num: toNum,
        });
      }
    }

    return {
      key: `${group}.${num}`,
      group,
      num,
      name: this.mapName(group, num),
      x0: -border,
      y0: -border,
      width,
      height,
      mapWidth: layout.field("width").int(),
      mapHeight: layout.field("height").int(),
      kinds,
      blocks,
      behaviors,
      behaviorNames,
      warps: this.eventList(header, "warps", "warpCount").map((w) => {
        const x = w.field("x").int();
        const y = w.field("y").int();
        const gx = x + border;
        const gy = y + border;
        const inside = gx >= 0 && gy >= 0 && gx < width && gy < height;
        const behavior = inside ? behaviorNames[behaviors[gy * width + gx]] : "?";
        // Arrow and stair warps run when the player pushes against them (field_control_avatar.c).
        const how = /ARROW_WARP|STAIR_WARP/.test(behavior) ? "press" : /WARP|DOOR|LADDER|ESCALATOR|HOLE/.test(behavior) ? "step" : "none";
        const toGroup = w.field("mapGroup").int();
        const toNum = w.field("mapNum").int();
        return { x, y, to: this.mapName(toGroup, toNum), group: toGroup, num: toNum, behavior, how };
      }),
      connections,
      signs: this.eventList(header, "bgEvents", "bgEventCount").map((e) => ({
        x: e.field("x").int(),
        y: e.field("y").int(),
        kind: e.field("kind").int() === BG_EVENT_HIDDEN_ITEM ? ("hidden-item" as const) : ("sign" as const),
      })),
      triggers: this.eventList(header, "coordEvents", "coordEventCount").map((e) => ({
        x: e.field("x").int(),
        y: e.field("y").int(),
        variable: e.field("trigger").int(),
        value: e.field("index").int() & 0xff,
        weather: e.field("script").pointer() === 0,
      })),
    };
  }

  /** Value of a script variable, as VarGet() returns it. Null for special variables. */
  private varGet(id: number): number | null {
    if (id < VARS_START) return id;
    if (id >= SPECIAL_VARS_START) return null;
    return this.saveBlock1.field("vars").at(id - VARS_START).int();
  }

  /** What moves or changes on the player's map: player, people, trainer sight, active triggers. */
  actors(grid: MapGrid): MapActors | null {
    if (this.context().mode !== "overworld") return null;
    return this.buildActors(grid, this.mem.global("gMapHeader"), true);
  }

  /** The same for any map, from the story state in the save: people at their start position. */
  actorsOf(grid: MapGrid): MapActors {
    const here = this.location();
    const isHere = this.context().mode === "overworld" && here.group === grid.group && here.num === grid.num;
    return this.buildActors(grid, this.mapHeader(grid.group, grid.num), isHere);
  }

  private buildActors(grid: MapGrid, header: Ref, isPlayerMap: boolean): MapActors {
    const objects = this.mem.global("gObjectEvents");
    const playerId = this.mem.global("gPlayerAvatar").field("objectEventId").int();
    const live = new Map<number, Ref>();
    let player: MapActors["player"] = null;
    for (let i = 0; i < (isPlayerMap ? objects.length : 0); i++) {
      const obj = objects.at(i);
      if (!obj.field("active").int()) continue;
      if (i === playerId) {
        const c = obj.field("currentCoords");
        player = { x: c.field("x").int() - MAP_OFFSET, y: c.field("y").int() - MAP_OFFSET, facing: obj.field("facingDirection").int() };
      } else {
        live.set(obj.field("localId").int(), obj);
      }
    }

    const kindAt = (x: number, y: number) => {
      const gx = x - grid.x0;
      const gy = y - grid.y0;
      return gx < 0 || gy < 0 || gx >= grid.width || gy >= grid.height ? "#" : grid.kinds[gy * grid.width + gx];
    };

    // The map lists every person; only those near the screen are loaded in gObjectEvents.
    const people: MapActors["people"] = [];
    for (const template of this.eventList(header, "objectEvents", "objectEventCount")) {
      if (template.field("kind").int() !== OBJ_KIND_NORMAL) continue;
      const localId = template.field("localId").int();
      const obj = live.get(localId);
      const hideFlag = template.field("flagId").int();
      if (!obj && hideFlag !== 0 && this.flag(hideFlag)) continue;
      const normal = template.field("objUnion").field("normal");
      const x = obj ? obj.field("currentCoords").field("x").int() - MAP_OFFSET : template.field("x").int();
      const y = obj ? obj.field("currentCoords").field("y").int() - MAP_OFFSET : template.field("y").int();
      const facing = obj ? obj.field("facingDirection").int() : (FACING_OF_MOVEMENT[normal.field("movementType").int()] ?? 0);
      const rangeX = normal.field("movementRangeX").int();
      const rangeY = normal.field("movementRangeY").int();
      const person: MapActors["people"][number] = { localId, x, y, facing, loaded: obj !== undefined };
      if (rangeX > 0 || rangeY > 0) {
        person.wander = { x: template.field("x").int() - rangeX, y: template.field("y").int() - rangeY, w: rangeX * 2 + 1, h: rangeY * 2 + 1 };
      }

      const trainerType = normal.field("trainerType").int();
      const script = template.field("script").pointer();
      // A trainer script starts with "trainerbattle" (0x5C); its trainer id is at byte 2.
      if (trainerType !== 0 && script !== 0 && this.mem.u8(script) === 0x5c) {
        const trainerId = this.mem.u8(script + 2) | (this.mem.u8(script + 3) << 8);
        const range = normal.field("trainerRange_berryTreeId").int();
        const defeated = this.flag(TRAINER_FLAGS_START + trainerId);
        const directions = trainerType === TRAINER_TYPE_NORMAL ? (facing ? [facing] : []) : [1, 2, 3, 4];
        const sight: [number, number][] = [];
        if (!defeated) {
          for (const dir of directions) {
            const [dx, dy] = DIRECTION_STEP[dir];
            // The game stops the line at a cell the trainer cannot walk on.
            for (let i = 1; i <= range && kindAt(x + dx * i, y + dy * i) !== "#"; i++) sight.push([x + dx * i, y + dy * i]);
          }
        }
        person.trainer = { id: trainerId, defeated, range, allDirections: trainerType !== TRAINER_TYPE_NORMAL, sight };
      }
      people.push(person);
    }

    // As TryRunCoordEventScript: a trigger runs when its variable has its value (or always with variable 0).
    const triggers = grid.triggers.map((t) => {
      if (t.weather) return false;
      if (t.variable === 0) return true;
      const v = this.varGet(t.variable);
      return v === null ? null : (v & 0xff) === t.value;
    });
    const signs = this.eventList(header, "bgEvents", "bgEventCount").map((e) => {
      if (e.field("kind").int() !== BG_EVENT_HIDDEN_ITEM) return null;
      const raw = e.field("bgUnion").field("hiddenItem").int();
      return { found: this.flag(FLAG_HIDDEN_ITEMS_START + ((raw >>> 16) & 0xff)) };
    });
    return { player, people, triggers, signs };
  }
}
