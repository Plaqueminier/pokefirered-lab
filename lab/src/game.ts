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
const MB_JUMP = { 0x38: "east", 0x39: "west", 0x3a: "north", 0x3b: "south" } as Record<number, string>;
const MB_TALL_GRASS = 0x02;

export type PartyMon = { species: string; nickname: string; level: number; hp: number; maxHp: number };

export type GameState = {
  map: { group: number; num: number; name: string };
  player: { x: number; y: number } | null;
  party: PartyMon[];
  badges: boolean[];
  money: number;
  context: { mode: "overworld" | "battle" | "other"; callback1: string; callback2: string };
};

export type Cell = {
  x: number;
  y: number;
  /** Raw map grid value: metatile id, collision and elevation bits. */
  metatile: number;
  collision: number;
  elevation: number;
  behavior: string;
  kind: "blocked" | "water" | "ledge" | "grass" | "open";
  ledge?: string;
};

export type Overlay = {
  /** Screen pixel of the top-left corner of cells[0]. */
  originX: number;
  originY: number;
  columns: number;
  cells: Cell[];
  warps: { x: number; y: number; to: string }[];
  npcs: { x: number; y: number }[];
  events: { x: number; y: number; kind: "sign" | "trigger" }[];
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

  overlay(): Overlay | null {
    if (this.context().mode !== "overworld") return null;
    const vmap = this.mem.global("VMap");
    const width = vmap.field("Xsize").int();
    const height = vmap.field("Ysize").int();
    const grid = vmap.field("map").pointer();
    const layout = this.mem.global("gMapHeader").field("mapLayout").deref();
    const primary = this.attributes(layout.field("primaryTileset"), NUM_METATILES_IN_PRIMARY);
    const secondary = this.attributes(layout.field("secondaryTileset"), 1024 - NUM_METATILES_IN_PRIMARY);
    const surfable = this.mem.global("sBehaviorSurfable");

    // Camera: the game draws cell (pos.x, pos.y) at tile (xTileOffset, yTileOffset) of
    // the background, then scrolls the background by (HOFS, VOFS). See field_camera.c.
    const pos = this.saveBlock1.field("pos");
    const camX = pos.field("x").int();
    const camY = pos.field("y").int();
    const cam = this.mem.global("sFieldCameraOffset");
    const hofs = cam.field("xPixelOffset").int() + this.mem.global("sHorizontalCameraPan").int();
    const vofs = cam.field("yPixelOffset").int() + this.mem.global("sVerticalCameraPan").int() + 8;
    // The background is 256 px wide and wraps; the drawn area starts above and left of the screen.
    const wrap = (v: number) => ((((v + 128) % 256) + 256) % 256) - 128;
    const originX = wrap(cam.field("xTileOffset").int() * 8 - hofs);
    const originY = wrap(cam.field("yTileOffset").int() * 8 - vofs);

    const columns = 16;
    const rows = 12;
    const cells: Cell[] = [];
    for (let row = 0; row < rows; row++) {
      const y = camY + row;
      const rowBytes = y >= 0 && y < height ? this.mem.bus.read(grid + (y * width + camX) * 2, columns * 2) : null;
      for (let col = 0; col < columns; col++) {
        const x = camX + col;
        const inside = rowBytes && x >= 0 && x < width;
        const block = inside ? rowBytes[col * 2] | (rowBytes[col * 2 + 1] << 8) : 0x03ff;
        const metatile = block & 0x03ff;
        const collision = inside ? (block & 0x0c00) >> 10 : 1;
        const elevation = block >> 12;
        const attrs = metatile < NUM_METATILES_IN_PRIMARY ? primary[metatile] : secondary[metatile - NUM_METATILES_IN_PRIMARY];
        const behaviorId = (attrs ?? 0) & 0x1ff;
        const ledge = MB_JUMP[behaviorId];
        const kind: Cell["kind"] =
          collision !== 0 ? "blocked"
          : behaviorId < surfable.length && surfable.at(behaviorId).int() & 1 ? "water"
          : ledge ? "ledge"
          : behaviorId === MB_TALL_GRASS ? "grass"
          : "open";
        cells.push({
          x: x - MAP_OFFSET,
          y: y - MAP_OFFSET,
          metatile,
          collision,
          elevation,
          behavior: this.behaviorNames.get(behaviorId) ?? `0x${behaviorId.toString(16)}`,
          kind,
          ...(ledge ? { ledge } : {}),
        });
      }
    }

    const events = this.mem.global("gMapHeader").field("events").deref();
    const list = <T>(arrayField: string, countField: string, f: (r: Ref) => T): T[] => {
      const count = events.field(countField).int();
      const out: T[] = [];
      for (let i = 0; i < count; i++) out.push(f(events.field(arrayField).at(i)));
      return out;
    };
    const warps = list("warps", "warpCount", (w) => {
      const group = w.field("mapGroup").int();
      const num = w.field("mapNum").int();
      return { x: w.field("x").int(), y: w.field("y").int(), to: this.mapNames[group]?.[num] ?? `${group}.${num}` };
    });
    const signs = list("bgEvents", "bgEventCount", (e) => ({ x: e.field("x").int(), y: e.field("y").int(), kind: "sign" as const }));
    const triggers = list("coordEvents", "coordEventCount", (e) => ({ x: e.field("x").int(), y: e.field("y").int(), kind: "trigger" as const }));

    const npcs: Overlay["npcs"] = [];
    const objects = this.mem.global("gObjectEvents");
    const playerId = this.mem.global("gPlayerAvatar").field("objectEventId").int();
    for (let i = 0; i < objects.length; i++) {
      if (i === playerId) continue;
      const obj = objects.at(i);
      if (!obj.field("active").int() || obj.field("invisible").int()) continue;
      const c = obj.field("currentCoords");
      npcs.push({ x: c.field("x").int() - MAP_OFFSET, y: c.field("y").int() - MAP_OFFSET });
    }

    return { originX, originY, columns, cells, warps, npcs, events: [...signs, ...triggers] };
  }
}
