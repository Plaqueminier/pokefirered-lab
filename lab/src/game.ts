// FireRed-specific reads: what the Viewer and the Harness see. The addresses and the C layouts come
// from the debug info; the byte layouts of script data and of text come from the decomp sources.
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
const MB_TALL_GRASS = 0x02;
export const KIND = { blocked: "#", water: "~", grass: '"', open: "." } as const;
export const LEDGE: Record<Direction, string> = { north: "^", south: "v", west: "<", east: ">" };
const MB_JUMP: Record<number, string> = { 0x38: LEDGE.east, 0x39: LEDGE.west, 0x3a: LEDGE.north, 0x3b: LEDGE.south };
// From IsWarpMetatileBehavior, TryArrowWarp and TryDoorWarp in field_control_avatar.c.
const STEP_WARPS = new Set(["MB_CAVE_DOOR", "MB_LADDER", "MB_UP_ESCALATOR", "MB_DOWN_ESCALATOR", "MB_REGULAR_WARP", "MB_UNION_ROOM_WARP", "MB_FALL_WARP", "MB_LAVARIDGE_1F_WARP"]);
const PUSH_WARPS: Record<string, { direction: Direction; from: "cell" | "below" }> = {
  MB_NORTH_ARROW_WARP: { direction: "north", from: "cell" },
  MB_SOUTH_ARROW_WARP: { direction: "south", from: "cell" },
  MB_WEST_ARROW_WARP: { direction: "west", from: "cell" },
  MB_EAST_ARROW_WARP: { direction: "east", from: "cell" },
  MB_UP_LEFT_STAIR_WARP: { direction: "west", from: "cell" },
  MB_DOWN_LEFT_STAIR_WARP: { direction: "west", from: "cell" },
  MB_UP_RIGHT_STAIR_WARP: { direction: "east", from: "cell" },
  MB_DOWN_RIGHT_STAIR_WARP: { direction: "east", from: "cell" },
  MB_WARP_DOOR: { direction: "north", from: "below" },
};
const BG_EVENT_HIDDEN_ITEM = 7;
const OBJ_KIND_NORMAL = 0;
const TRAINER_TYPE_NORMAL = 1;
const TRAINER_FLAGS_START = 0x500;
const FLAG_HIDDEN_ITEMS_START = 0x3e8;
const VARS_START = 0x4000;
const SPECIAL_VARS_START = 0x8000;
const DIRECTION_OF_DIR: Record<number, Direction> = { 1: "south", 2: "north", 3: "west", 4: "east" };
const CONNECTION_SIDES: Record<number, ConnectionSide> = { ...DIRECTION_OF_DIR, 5: "dive", 6: "emerge" };
export const DIRECTION_STEP: Record<Direction, [number, number]> = { north: [0, -1], south: [0, 1], west: [-1, 0], east: [1, 0] };
// MOVEMENT_TYPE_FACE_UP/DOWN/LEFT/RIGHT: the direction of a person not loaded in memory.
const FACING_OF_MOVEMENT: Record<number, number> = { 0x7: 2, 0x8: 1, 0x9: 3, 0xa: 4 };
const T_NOT_MOVING = 0;
// The enum in script.c is RUNNING, WAITING, SHUTDOWN.
const SCRIPT_CONTEXT_SHUTDOWN = 2;
const SCRIPT_MODE_NATIVE = 2;
// Map script tables (script.c): entries of a tag byte and a pointer; frame table rows of two variables and a pointer.
const MAP_SCRIPT_ON_FRAME_TABLE = 2;
const MAP_SCRIPT_ENTRY_SIZE = 5;
const MAP_SCRIPT_ROW_SIZE = 8;
// RENDER_STATE_WAIT, RENDER_STATE_CLEAR and RENDER_STATE_SCROLL_START (text.h) wait for A or B.
const PRINTER_WAIT_STATES = new Set([1, 2, 3]);
// Task_YesNoMenu_HandleInput (script_menu.c) reads no input while its tTimer (data[2]) is below 5.
const YES_NO_TIMER = 2;
const YES_NO_INPUT_DELAY = 5;
// The field message box is window 0 (sStandardTextBox_WindowTemplates, new_menu_helpers.c); text printer n prints in window n.
const FIELD_MESSAGE_WINDOW = 0;
// The background tilemap of the text windows is 32 tiles wide; bits 0-9 of an entry are the tile.
const TILEMAP_WIDTH = 32;
const TILE_INDEX_MASK = 0x3ff;
// Character codes (characters.h).
const CHAR_DYNAMIC = 0xf7;
const CHAR_KEYPAD_ICON = 0xf8;
const CHAR_EXTRA_SYMBOL = 0xf9;
const CHAR_PROMPT_SCROLL = 0xfa;
const CHAR_PROMPT_CLEAR = 0xfb;
const EXT_CTRL_CODE_BEGIN = 0xfc;
const PLACEHOLDER_BEGIN = 0xfd;
const CHAR_NEWLINE = 0xfe;
const CHAR_EOS = 0xff;
const ONE_ARG_CODES = new Set([CHAR_DYNAMIC, CHAR_KEYPAD_ICON, CHAR_EXTRA_SYMBOL, PLACEHOLDER_BEGIN]);
// The table of GetExtCtrlCodeLength (string_util.c): the length of each extended code, with the code byte.
const EXT_CTRL_CODE_LENGTHS = [1, 2, 2, 2, 4, 2, 2, 1, 2, 1, 1, 3, 2, 2, 2, 1, 3, 2, 2, 2, 2, 1, 1, 1, 1];
const CHARMAP_JAPANESE = "@ Hiragana";

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

export type Choice = { options: string[]; cursor: number };

export type WaitingFor = { kind: "walk" } | { kind: "text" } | ({ kind: "choice" } & Choice) | { kind: "busy" };

export type FieldMessage = { shown: boolean; printerActive: boolean };

export type Direction = "south" | "north" | "west" | "east";

export type PlayerPosition = { x: number; y: number; facing: Direction };

type WarpHow = { how: "step" } | { how: "press"; from: { x: number; y: number }; direction: Direction } | { how: "none" };

export type WarpExit = { x: number; y: number; to: string; warpId: number } & WarpHow;

export type Warp = WarpExit & { group: number; num: number; behavior: string };

export type GameInterruption = "trigger" | "trainer" | "script" | "battle";

export type ConnectionSide = Direction | "dive" | "emerge";

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
  warps: Warp[];
  connections: { direction: ConnectionSide; offset: number; map: string; group: number; num: number }[];
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
    // The Japanese part gives the same bytes again. In the Latin part, a later line wins ('\'' over '’').
    const japanese = charmapText.indexOf(CHARMAP_JAPANESE);
    if (japanese < 0) throw new Error(`charmap.txt: no "${CHARMAP_JAPANESE}" line`);
    const latin = charmapText.slice(0, japanese);
    const charmap: string[] = [];
    for (const m of latin.matchAll(/^'(\\'|.)'\s*=\s*([0-9A-F]{2})\s*$/gm)) charmap[parseInt(m[2], 16)] = m[1].replace("\\", "");
    const behaviorNames = new Map<number, string>();
    for (const m of behaviorsText.matchAll(/^#define (MB_\w+)\s+(0x[0-9A-Fa-f]+)/gm)) behaviorNames.set(Number(m[2]), m[1]);
    const mapNames = (groups.group_order as string[]).map((g) => groups[g] as string[]);
    return new Game(mem, { charmap, behaviorNames, mapNames });
  }

  decodeText(bytes: Uint8Array): string {
    let out = "";
    for (let i = 0; i < bytes.length && bytes[i] !== CHAR_EOS; i++) {
      const b = bytes[i];
      if (b === CHAR_NEWLINE || b === CHAR_PROMPT_SCROLL || b === CHAR_PROMPT_CLEAR) out += "\n";
      else if (b === EXT_CTRL_CODE_BEGIN) i += this.extCtrlCodeLength(bytes[i + 1]);
      else if (ONE_ARG_CODES.has(b)) i++;
      else out += this.charmap[b] ?? "?";
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

  player(): PlayerPosition | null {
    const obj = this.playerObject();
    if (!obj) return null;
    const coords = obj.field("currentCoords");
    return { x: coords.field("x").int() - MAP_OFFSET, y: coords.field("y").int() - MAP_OFFSET, facing: DIRECTION_OF_DIR[obj.field("facingDirection").int()] };
  }

  waitingFor(): WaitingFor {
    const { mode, callback1 } = this.context();
    if (mode !== "overworld") return { kind: "busy" };
    const choice = this.choice();
    if (choice) return { kind: "choice", ...choice };
    if (this.textWaits()) return { kind: "text" };
    return callback1 === "CB1_Overworld" && this.canWalk() ? { kind: "walk" } : { kind: "busy" };
  }

  // DoCB1_Overworld (overworld.c) reads the player input only while the field controls are unlocked.
  // ProcessPlayerFieldInput starts a waiting frame script of the map instead of reading the input.
  private canWalk(): boolean {
    return (
      !this.fieldLocked() &&
      this.mem.global("gPlayerAvatar").field("tileTransitionState").int() === T_NOT_MOVING &&
      !this.mem.global("gPaletteFade").field("active").int() &&
      !this.frameScriptWaits()
    );
  }

  // As MapHeaderGetScriptTable (script.c).
  private mapScriptTable(tag: number): number | null {
    let entry = this.mem.global("gMapHeader").field("mapScripts").pointer();
    if (entry === 0) return null;
    for (; this.mem.u8(entry) !== 0; entry += MAP_SCRIPT_ENTRY_SIZE) if (this.mem.u8(entry) === tag) return this.mem.u32(entry + 1);
    return null;
  }

  // As MapHeaderCheckScriptTable (script.c): a row runs when its two variables have the same value.
  private frameScriptWaits(): boolean {
    const table = this.mapScriptTable(MAP_SCRIPT_ON_FRAME_TABLE);
    if (table === null) return false;
    for (let row = table; this.mem.u16(row) !== 0; row += MAP_SCRIPT_ROW_SIZE) {
      if (this.knownVar(this.mem.u16(row)) === this.knownVar(this.mem.u16(row + 2))) return true;
    }
    return false;
  }

  // No frame table of the game compares a special variable, and varGet cannot read them.
  private knownVar(id: number): number {
    const value = this.varGet(id);
    if (value === null) throw new Error(`a frame script of the map compares the special variable 0x${id.toString(16)}`);
    return value;
  }

  private textWaits(): boolean {
    const printer = this.fieldPrinter();
    if (printer.field("active").int()) {
      return PRINTER_WAIT_STATES.has(printer.field("state").int()) && !this.mem.global("gTextFlags").field("autoScroll").int();
    }
    const script = this.mem.global("sGlobalScriptContext");
    return (
      this.scriptRunning() &&
      script.field("mode").int() === SCRIPT_MODE_NATIVE &&
      functionName(this.mem.symbols, script.field("nativePtr").pointer()) === "WaitForAorBPress"
    );
  }

  private choice(): Choice | null {
    const task = this.activeTask("Task_YesNoMenu_HandleInput");
    if (!task || task.field("data").at(YES_NO_TIMER).int() < YES_NO_INPUT_DELAY) return null;
    const options = ["gText_Yes", "gText_No"].map((name) => this.decodeText(this.mem.global(name).bytes()));
    return { options, cursor: this.mem.global("sMenu").field("cursorPos").int() };
  }

  private activeTask(func: string): Ref | null {
    const tasks = this.mem.global("gTasks");
    for (let i = 0; i < tasks.length; i++) {
      const task = tasks.at(i);
      if (task.field("isActive").int() && functionName(this.mem.symbols, task.field("func").pointer()) === func) return task;
    }
    return null;
  }

  fieldMessage(): FieldMessage {
    return { shown: this.messageBoxShown(), printerActive: this.fieldPrinter().field("active").int() !== 0 };
  }

  /** The text of the message box, with its line and page breaks as "\n". */
  fieldMessageText(): string {
    const printer = this.fieldPrinter();
    const buffer = this.mem.global("gStringVar4");
    const at = printer.field("printerTemplate").field("currentChar").pointer();
    if (printer.field("active").int() && (at < buffer.addr || at >= buffer.addr + buffer.size)) {
      throw new Error(`the message box prints a string at 0x${at.toString(16)}, not from gStringVar4`);
    }
    return this.decodeText(buffer.bytes());
  }

  private fieldPrinter(): Ref {
    return this.mem.global("sTextPrinters").at(FIELD_MESSAGE_WINDOW);
  }

  private extCtrlCodeLength(code: number): number {
    const length = EXT_CTRL_CODE_LENGTHS[code];
    if (length === undefined) throw new Error(`unknown extended control code 0x${code.toString(16)} in a game string`);
    return length;
  }

  private messageBoxShown(): boolean {
    const window = this.mem.global("gWindows").at(FIELD_MESSAGE_WINDOW).field("window");
    const tilemap = this.mem.global("sGpuBgConfigs2").at(window.field("bg").int()).field("tilemap").pointer();
    if (tilemap === 0) return false;
    const cell = window.field("tilemapTop").int() * TILEMAP_WIDTH + window.field("tilemapLeft").int();
    return (this.mem.u16(tilemap + cell * 2) & TILE_INDEX_MASK) === window.field("baseBlock").int();
  }

  fieldLocked(): boolean {
    return this.mem.global("sLockFieldControls").int() !== 0;
  }

  interruption(): GameInterruption | null {
    if (this.battleStarting()) return "battle";
    if (!this.scriptRunning()) return null;
    const player = this.player();
    const grid = this.grid();
    if (!player || !grid) return "script";
    const actors = this.buildActors(grid, this.mem.global("gMapHeader"), true);
    const at = (x: number, y: number) => x === player.x && y === player.y;
    if (grid.triggers.some((t, i) => actors.triggers[i] && at(t.x, t.y))) return "trigger";
    if (actors.people.some((p) => p.trainer?.sight.some(([x, y]) => at(x, y)))) return "trainer";
    return "script";
  }

  // The status is 0 (RUNNING) from boot until the first overworld frame sets it.
  private scriptRunning(): boolean {
    return this.context().mode === "overworld" && this.mem.global("sGlobalScriptContextStatus").int() !== SCRIPT_CONTEXT_SHUTDOWN;
  }

  battleStarting(): boolean {
    return this.context().mode === "battle" || this.activeTask("Task_BattleStart") !== null;
  }

  map(): GameState["map"] {
    const { group, num } = this.location();
    return { group, num, name: this.mapName(group, num) };
  }

  state(): GameState {
    const sb1 = this.saveBlock1;
    const player = this.player();
    return {
      map: this.map(),
      player: player ? { x: player.x, y: player.y } : null,
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

  private mapId(name: string): { group: number; num: number } | null {
    for (const [group, names] of this.mapNames.entries()) {
      const num = names.indexOf(name);
      if (num >= 0) return { group, num };
    }
    return null;
  }

  mapView(name: string): { grid: MapGrid; actors: MapActors } | null {
    const id = this.mapId(name);
    if (!id) return null;
    const here = this.location();
    if (id.group === here.group && id.num === here.num) {
      const grid = this.grid();
      if (grid) return { grid, actors: this.buildActors(grid, this.mem.global("gMapHeader"), true) };
    }
    const grid = this.gridOf(id.group, id.num);
    return grid && { grid, actors: this.actorsOf(grid) };
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
      // Ledge metatiles have the collision bit set; the game checks the jump before the collision.
      kinds +=
        MB_JUMP[behavior] ??
        (block === 0x03ff || block & 0x0c00 ? KIND.blocked
        : behavior < surfable.length && surfable.at(behavior).int() & 1 ? KIND.water
        : behavior === MB_TALL_GRASS ? KIND.grass
        : KIND.open);
    }

    const connectionsRef = header.field("connections");
    const connections: MapGrid["connections"] = [];
    if (connectionsRef.pointer() !== 0) {
      const list = connectionsRef.deref();
      for (let i = 0; i < list.field("count").int(); i++) {
        const c = list.field("connections").at(i);
        const toGroup = c.field("mapGroup").int();
        const toNum = c.field("mapNum").int();
        const direction = CONNECTION_SIDES[c.field("direction").int()];
        if (!direction) continue;
        connections.push({
          direction,
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
        const toGroup = w.field("mapGroup").int();
        const toNum = w.field("mapNum").int();
        const warp = { x, y, to: this.mapName(toGroup, toNum), group: toGroup, num: toNum, warpId: w.field("warpId").int(), behavior };
        return { ...warp, ...warpHow(x, y, behavior) };
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
            const [dx, dy] = DIRECTION_STEP[DIRECTION_OF_DIR[dir]];
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

function warpHow(x: number, y: number, behavior: string): WarpHow {
  const push = PUSH_WARPS[behavior];
  if (push) return { how: "press", from: { x, y: push.from === "below" ? y + 1 : y }, direction: push.direction };
  return STEP_WARPS.has(behavior) ? { how: "step" } : { how: "none" };
}
