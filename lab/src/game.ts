// FireRed-specific reads: what the Viewer and the Harness see. The addresses and the C layouts come
// from the debug info; the byte layouts of script data and of text come from the decomp sources.
import { join } from "node:path";
import { type BagMenu, type BagPlace, type BagPocket, bagMenu, bagQuantity, findInBag, itemAnimWaits, readBag } from "./bag";
import {
  type Battle,
  type BattleMenu,
  battleCursor,
  battleMenu,
  battleMenuSlot,
  battleYesNoCursor,
  dexPageWaits,
  enemyMovePrinted,
  forgetMoveCursor,
  type LearnMoveBox,
  learnMoveBox,
  levelUpBoxWaits,
  type PrintedMove,
  readBattle,
} from "./battle";
import { readTypeChart, type TypeChart } from "./battle-facts";
import type { Memory, Ref } from "./memory";
import { FLAG_SYS_POKEDEX_GET, multichoice, multichoiceGrid, type NamingScreen, namingScreen, type PartyMenu, partyMenu, pcMenu, playerPcMenu, SCRIPT_CONTEXT_SHUTDOWN, startMenu } from "./menus";
import { nameAt, newMove, type PartyMon, type PartyMove, readParty, readPcSpecies } from "./party";
import { itemPcRow, itemStorageCursor, type PcItem, pcItems, pcQuantity, pcTransfer, withdrawMenuCursor } from "./pc";
import { activeTask, type Choice, type Decode, decoder, type Messages, oneLine, Prompts } from "./prompts";
import { type BuyList, buyList, type ShopItem, type ShopMenu, shopMenu, tradeDone, tradeQuantity, tradeYesNo } from "./shop";
import { functionName } from "./symbols";

const REPO_DIR = join(import.meta.dir, "..", "..");

/** Cells around the visible map: the map grid adds this border on each side. */
const MAP_OFFSET = 7;
const NUM_METATILES_IN_PRIMARY = 640;
const FLAG_BADGE01_GET = 0x820;
const FLAG_SYS_POKEMON_GET = 0x828;
// EndRivalBattle sets it after the first rival battle, won or lost.
const FLAG_BEAT_RIVAL_IN_OAKS_LAB = 0x258;
const BADGES = [1, 2, 3, 4, 5, 6, 7, 8] as const;
const MILESTONE_FLAGS: [Milestone, number][] = [
  ["has-pokemon", FLAG_SYS_POKEMON_GET],
  ["first-rival-battle", FLAG_BEAT_RIVAL_IN_OAKS_LAB],
  ["pokedex", FLAG_SYS_POKEDEX_GET],
  ...BADGES.map((n): [Milestone, number] => [`badge-${n}`, badgeFlag(n)]),
];
export const MILESTONES: readonly Milestone[] = MILESTONE_FLAGS.map(([milestone]) => milestone);
// CB2_BuyMenu draws the map behind the buy list, so the map stays the same.
const OVERWORLD_CALLBACKS = new Set(["CB2_Overworld", "CB2_OverworldBasic", "CB2_BuyMenu"]);
const BATTLE_START_CALLBACKS = new Set(["CB2_InitBattle", "CB2_HandleStartBattle"]);
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
const FLAG_HIDDEN_ITEMS_END = 0x4b0;
const TRAINER_FLAGS_END = 0x800;
const VARS_START = 0x4000;
const SPECIAL_VARS_START = 0x8000;
const DIRECTION_OF_DIR: Record<number, Direction> = { 1: "south", 2: "north", 3: "west", 4: "east" };
// BG_EVENT_PLAYER_FACING_NORTH, _SOUTH, _EAST and _WEST.
const SIGN_PLAYER_FACING: Record<number, Direction> = { 1: "north", 2: "south", 3: "east", 4: "west" };
const CONNECTION_SIDES: Record<number, ConnectionSide> = { ...DIRECTION_OF_DIR, 5: "dive", 6: "emerge" };
export const DIRECTION_STEP: Record<Direction, [number, number]> = { north: [0, -1], south: [0, 1], west: [-1, 0], east: [1, 0] };
export const DIRECTION_STEPS = Object.entries(DIRECTION_STEP) as [Direction, [number, number]][];
// MOVEMENT_TYPE_FACE_UP/DOWN/LEFT/RIGHT: the direction of a person not loaded in memory.
const FACING_OF_MOVEMENT: Record<number, number> = { 0x7: 2, 0x8: 1, 0x9: 3, 0xa: 4 };
const T_NOT_MOVING = 0;
const SCRIPT_MODE_NATIVE = 2;
// Map script tables (script.c): entries of a tag byte and a pointer; frame table rows of two variables and a pointer.
const MAP_SCRIPT_ON_FRAME_TABLE = 2;
const MAP_SCRIPT_ENTRY_SIZE = 5;
const MAP_SCRIPT_ROW_SIZE = 8;
export type Milestone = "has-pokemon" | "first-rival-battle" | "pokedex" | `badge-${(typeof BADGES)[number]}`;

export type GameState = {
  map: { group: number; num: number; name: string };
  player: { x: number; y: number } | null;
  party: PartyMon[];
  badges: boolean[];
  money: number;
  context: { mode: "overworld" | "battle" | "other"; callback1: string; callback2: string };
};

export type Camera = { x: number; y: number };

export type WaitingFor =
  | { kind: "walk" }
  | { kind: "text" }
  | ({ kind: "choice"; columns: number } & Choice)
  | { kind: "battleAction" }
  | { kind: "battleMove" }
  | { kind: "partyPick" }
  | { kind: "shopMenu"; items: ShopItem[]; screen: "menu" | "buyList" }
  | { kind: "itemPc"; items: PcItem[] }
  | { kind: "naming"; subject: string; maxLength: number; keys: string[] }
  | { kind: "learnMove"; slot: number; move: PartyMove }
  | { kind: "busy" };

export function isDecisionPoint({ kind }: WaitingFor): boolean {
  return kind !== "text" && kind !== "busy";
}

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
  outside: boolean;
  /** Raw grid value per cell: metatile (bits 0-9), collision (10-11), elevation (12-15). */
  blocks: number[];
  /** Metatile behavior id per cell; names in behaviorNames. */
  behaviors: number[];
  behaviorNames: Record<number, string>;
  warps: Warp[];
  connections: { direction: ConnectionSide; offset: number; map: string; group: number; num: number }[];
  /** `playerFacing`: the direction that the player must face to read the sign. */
  signs: ({ x: number; y: number } & ({ kind: "sign"; playerFacing: Direction | "any" } | { kind: "hidden-item" }))[];
  /** Cells that start a script when the player steps on them, if `variable` has `value`. */
  triggers: { x: number; y: number; variable: number; value: number; weather: boolean }[];
};

const OBSTACLES: Record<string, Pick<Obstacle, "name" | "move">> = {
  CUT_TREE: { name: "CUT TREE", move: "CUT" },
  ROCK_SMASH_ROCK: { name: "ROCK SMASH ROCK", move: "ROCK SMASH" },
  PUSHABLE_BOULDER: { name: "PUSHABLE BOULDER", move: "STRENGTH" },
};

export type Obstacle = { x: number; y: number; name: string; move: string };

export type MapActors = {
  player: { x: number; y: number; facing: number } | null;
  /** Every person of the map. `loaded`: the game has it in memory now (near the screen). */
  people: {
    localId: number;
    x: number;
    y: number;
    graphics: string;
    /** 1 south, 2 north, 3 west, 4 east, 0 unknown. */
    facing: number;
    loaded: boolean;
    /** The area where a wandering person can walk. */
    wander?: { x: number; y: number; w: number; h: number };
    trainer?: { id: number; defeated: boolean; range: number; allDirections: boolean; sight: [number, number][] };
  }[];
  obstacles: Obstacle[];
  /** Per grid trigger: true active, false inactive, null unknown (special variable). */
  triggers: (boolean | null)[];
  /** Per grid sign: hidden items say if they were found. */
  signs: ({ found: boolean } | null)[];
};

/** Reads game memory; returns null while the game is in a state where the reads fail (boot, transitions). */
export function safely<T>(read: () => T): T | null {
  try {
    return read();
  } catch {
    return null;
  }
}

// People have hide flags too, so the item ball flags come from the map data, not from a flag range.
async function readItemBallFlags(): Promise<number[]> {
  const flagsText = await Bun.file(join(REPO_DIR, "include/constants/flags.h")).text();
  const ids = new Map([...flagsText.matchAll(/^#define (FLAG_\w+)\s+(0x[0-9A-Fa-f]+)\b/gm)].map((m) => [m[1], Number(m[2])]));
  const paths = await Array.fromAsync(new Bun.Glob("data/maps/*/map.json").scan(REPO_DIR));
  const maps = await Promise.all(paths.map((path) => Bun.file(join(REPO_DIR, path)).json() as Promise<{ object_events?: { graphics_id: string; flag: string }[] }>));
  const flags = maps.flatMap((map) => (map.object_events ?? []).filter((o) => o.graphics_id === "OBJ_EVENT_GFX_ITEM_BALL").map((o) => ids.get(o.flag)));
  return [...new Set(flags.filter((id) => id !== undefined))];
}

type MapArea = { area: string; place: string | null };

export type Areas = Readonly<Record<string, MapArea>>;

const OUTSIDE_MAP_TYPES = new Set(["MAP_TYPE_TOWN", "MAP_TYPE_CITY", "MAP_TYPE_ROUTE", "MAP_TYPE_OCEAN_ROUTE"]);

export async function readAreas(): Promise<Areas> {
  const { map_sections } = (await Bun.file(join(REPO_DIR, "src/data/region_map/region_map_sections.json")).json()) as { map_sections: { id: string; name?: string }[] };
  const names = new Map(map_sections.flatMap(({ id, name }) => (name ? [[id, normalCase(name)]] : [])));
  const paths = await Array.fromAsync(new Bun.Glob("data/maps/*/map.json").scan(REPO_DIR));
  const maps = await Promise.all(paths.map((path) => Bun.file(join(REPO_DIR, path)).json() as Promise<{ name: string; region_map_section: string; map_type: string }>));
  return Object.fromEntries(
    maps.flatMap((map) => {
      const area = names.get(map.region_map_section);
      return area ? [[map.name, { area, place: OUTSIDE_MAP_TYPES.has(map.map_type) ? null : placeName(map.name, area) }]] : [];
    }),
  );
}

const PLACE_WORDS: Record<string, string> = { PlayersHouse: "Player's House", RivalsHouse: "Rival's House", ProfessorOaksLab: "Prof. Oak's Lab", PokemonCenter: "Pokémon Center", Mart: "Poké Mart" };

// The Area name can follow a prefix (`FiveIsland_LostCave_Room1`), and the map names have no accents ("Pokemon").
function placeName(map: string, area: string): string {
  const parts = map.split("_");
  const key = (text: string) => text.normalize("NFD").replace(/[^A-Za-z0-9]/g, "").toLowerCase();
  let after = 0;
  for (let from = 0; from < parts.length && after === 0; from++) {
    for (let to = from + 1; to <= parts.length; to++) if (key(parts.slice(from, to).join("")) === key(area)) after = to;
  }
  return parts
    .slice(after)
    .map((part) => PLACE_WORDS[part] ?? part.replace(/([a-z])([A-Z0-9])/g, "$1 $2").replace(/\bPokemon\b/g, "Pokémon"))
    .join(" ");
}

function normalCase(name: string): string {
  return name.toLowerCase().replace(/(^|[\s.])(\p{L})/gu, (_, before: string, letter: string) => before + letter.toUpperCase());
}

export class Game {
  private readonly decode: Decode;
  private readonly prompts: Prompts;
  private readonly behaviorNames: Map<number, string>;
  private readonly graphicsNames: Map<number, string>;
  private readonly outsideTypes: Set<number>;
  private readonly mapNames: string[][];
  private readonly itemBallFlags: number[];
  private readonly attributeCache = new Map<number, Uint32Array>();
  private chart: TypeChart | null = null;

  private constructor(
    private readonly mem: Memory,
    tables: { decode: Decode; behaviorNames: Map<number, string>; graphicsNames: Map<number, string>; outsideTypes: Set<number>; mapNames: string[][]; itemBallFlags: number[] },
  ) {
    this.decode = tables.decode;
    this.prompts = new Prompts(mem, tables.decode);
    this.behaviorNames = tables.behaviorNames;
    this.graphicsNames = tables.graphicsNames;
    this.outsideTypes = tables.outsideTypes;
    this.mapNames = tables.mapNames;
    this.itemBallFlags = tables.itemBallFlags;
  }

  static async create(mem: Memory): Promise<Game> {
    const [charmapText, behaviorsText, graphicsText, mapTypesText, groups, itemBallFlags] = await Promise.all([
      Bun.file(join(REPO_DIR, "charmap.txt")).text(),
      Bun.file(join(REPO_DIR, "include/constants/metatile_behaviors.h")).text(),
      Bun.file(join(REPO_DIR, "include/constants/event_objects.h")).text(),
      Bun.file(join(REPO_DIR, "include/constants/map_types.h")).text(),
      Bun.file(join(REPO_DIR, "data/maps/map_groups.json")).json(),
      readItemBallFlags(),
    ]);
    const behaviorNames = new Map<number, string>();
    for (const m of behaviorsText.matchAll(/^#define (MB_\w+)\s+(0x[0-9A-Fa-f]+)/gm)) behaviorNames.set(Number(m[2]), m[1]);
    const graphicsNames = new Map<number, string>();
    for (const m of graphicsText.matchAll(/^#define OBJ_EVENT_GFX_(\w+)\s+(\d+)\s*$/gm)) graphicsNames.set(Number(m[2]), m[1]);
    const outsideTypes = new Set([...mapTypesText.matchAll(/^#define (MAP_TYPE_\w+)\s+(\d+)/gm)].flatMap((m) => (OUTSIDE_MAP_TYPES.has(m[1]) ? [Number(m[2])] : [])));
    const mapNames = (groups.group_order as string[]).map((g) => groups[g] as string[]);
    return new Game(mem, { decode: decoder(charmapText), behaviorNames, graphicsNames, outsideTypes, mapNames, itemBallFlags });
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
    const naming = this.namingScreen();
    if (naming) return naming.ready ? { kind: "naming", subject: naming.subject, maxLength: naming.maxLength, keys: naming.characters() } : { kind: "busy" };
    const { mode, callback1 } = this.context();
    if (mode === "battle") return this.battleWaitingFor();
    if (mode !== "overworld") return { kind: "busy" };
    const list = this.buyList();
    if (list) return { kind: "shopMenu", items: list.items, screen: "buyList" };
    const shop = this.shopMenu();
    if (shop) return { kind: "shopMenu", items: shop.items, screen: "menu" };
    if (itemStorageCursor(this.mem) !== null) return { kind: "itemPc", items: this.pcItems() };
    const menu = this.prompts.choice() ?? playerPcMenu(this.mem, this.decode) ?? pcMenu(this.mem, this.decode, (id) => this.flag(id)) ?? multichoice(this.mem, this.decode);
    if (menu) return { kind: "choice", ...menu, columns: 1 };
    const grid = multichoiceGrid(this.mem, this.decode);
    if (grid) return { kind: "choice", ...grid };
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

  private battleWaitingFor(): WaitingFor {
    if (this.partyMenu()?.kind === "pick") return { kind: "partyPick" };
    if (this.prompts.anyPrinterWaits() || levelUpBoxWaits(this.mem) || dexPageWaits(this.mem)) return { kind: "text" };
    const learnMove = this.learnMoveWait();
    if (learnMove) return learnMove;
    const yesNo = battleYesNoCursor(this.mem);
    if (yesNo !== null) return { kind: "choice", options: this.prompts.yesNo(), cursor: yesNo, columns: 1 };
    return { kind: battleMenu(this.mem) ?? "busy" };
  }

  private learnMoveWait(): WaitingFor | null {
    const box = this.learnMoveBox();
    return box?.question === "learn" ? { kind: "learnMove", slot: box.slot, move: newMove(this.mem, this.decode, box.move) } : null;
  }

  learnMoveBox(): LearnMoveBox | null {
    return learnMoveBox(this.mem);
  }

  forgetMoveCursor(): number | null {
    return forgetMoveCursor(this.mem);
  }

  private textWaits(): boolean {
    if (this.prompts.fieldPrinterActive()) return this.prompts.fieldPrinterWaits();
    const script = this.mem.global("sGlobalScriptContext");
    return (
      this.scriptRunning() &&
      script.field("mode").int() === SCRIPT_MODE_NATIVE &&
      functionName(this.mem.symbols, script.field("nativePtr").pointer()) === "WaitForAorBPress"
    );
  }

  messages(): Messages {
    return this.context().mode === "battle" ? this.prompts.battleMessages() : this.prompts.fieldMessages();
  }

  messageText(window: number): string {
    return this.prompts.messageText(window);
  }

  waitingTexts(): string[] {
    return this.prompts.waitingWindows().map((window) => oneLine(this.prompts.messageText(window)).trim());
  }

  bag(): BagPocket[] {
    return readBag(this.mem, this.decode);
  }

  findInBag(name: string): BagPlace | null {
    return findInBag(this.mem, name, this.decode);
  }

  bagQuantity(item: number): number {
    return bagQuantity(this.mem, item);
  }

  bagMenu(): BagMenu | null {
    return bagMenu(this.mem);
  }

  shopMenu(): ShopMenu | null {
    return shopMenu(this.mem, this.decode);
  }

  buyList(): BuyList | null {
    return buyList(this.mem, this.decode);
  }

  tradeQuantity(): number | null {
    return tradeQuantity(this.mem);
  }

  tradeYesNo(): number | null {
    return tradeYesNo(this.mem);
  }

  tradeDone(): boolean {
    return tradeDone(this.mem);
  }

  pcItems(): PcItem[] {
    return pcItems(this.mem, this.decode);
  }

  itemStorageCursor(): number | null {
    return itemStorageCursor(this.mem);
  }

  itemPcRow(): number | null {
    return itemPcRow(this.mem);
  }

  withdrawMenuCursor(): number | null {
    return withdrawMenuCursor(this.mem);
  }

  pcQuantity(): number | null {
    return pcQuantity(this.mem);
  }

  pcTransfer(): "done" | "refused" | null {
    return pcTransfer(this.mem);
  }

  menuMessage(): string {
    return oneLine(this.decode(this.mem.global("gStringVar4").bytes()));
  }

  itemAnimWaits(): boolean {
    return itemAnimWaits(this.mem);
  }

  battleCursor(menu: BattleMenu): number {
    return battleCursor(this.mem, menu);
  }

  fieldLocked(): boolean {
    return this.mem.global("sLockFieldControls").int() !== 0;
  }

  interruption(): GameInterruption | null {
    if (this.battleUnderway()) return "battle";
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

  battleUnderway(): boolean {
    const { mode, callback2 } = this.context();
    return mode === "battle" || BATTLE_START_CALLBACKS.has(callback2) || activeTask(this.mem, "Task_BattleStart") !== null;
  }

  battle(): Battle | null {
    return this.context().mode === "battle" ? readBattle(this.mem, this.decode) : null;
  }

  requireBattle(): Battle {
    const battle = this.battle();
    if (!battle) throw new Error("the game is not in a battle");
    return battle;
  }

  // Read also outside a battle, so that BattleWatch sees the old value before the battle intro clears it.
  enemyMovePrinted(): PrintedMove | null {
    return enemyMovePrinted(this.mem);
  }

  keysRead(): { held: number; pressed: number } {
    const main = this.mem.global("gMain");
    return { held: main.field("heldKeysRaw").int(), pressed: main.field("newKeysRaw").int() };
  }

  startMenu(): Choice | null {
    return startMenu(this.mem, this.decode);
  }

  namingScreen(): NamingScreen | null {
    return namingScreen(this.mem, this.decode);
  }

  partyMenu(): PartyMenu | null {
    return partyMenu(this.mem, this.decode);
  }

  battleMenuSlot(partyIndex: number): number {
    return battleMenuSlot(this.mem, partyIndex);
  }

  typeChart(): TypeChart {
    this.chart ??= readTypeChart(this.mem, this.decode);
    return this.chart;
  }

  moveName(move: number): string {
    return nameAt(this.mem, "gMoveNames", move, this.decode);
  }

  map(): GameState["map"] {
    const { group, num } = this.location();
    return { group, num, name: this.mapName(group, num) };
  }

  state(): GameState {
    const player = this.player();
    return {
      map: this.map(),
      player: player ? { x: player.x, y: player.y } : null,
      party: this.partyOnScreen(),
      badges: BADGES.map((n) => this.flag(badgeFlag(n))),
      money: this.money(),
      context: this.context(),
    };
  }

  money(): number {
    return (this.saveBlock1.field("money").int() ^ this.mem.global("gSaveBlock2Ptr").deref().field("encryptionKey").int()) >>> 0;
  }

  rivalName(): string {
    return this.decode(this.saveBlock1.field("rivalName").bytes());
  }

  flag(id: number): boolean {
    const byte = this.saveBlock1.field("flags").at(id >> 3).int();
    return ((byte >> (id & 7)) & 1) === 1;
  }

  mode(): GameState["context"]["mode"] {
    return this.context().mode;
  }

  battleScreen(): boolean {
    return this.context().callback2 === "BattleMainCB2";
  }

  whitingOut(): boolean {
    return this.context().callback2 === "CB2_WhiteOut";
  }

  private context(): GameState["context"] {
    const main = this.mem.global("gMain");
    const name = (field: string) => {
      const address = main.field(field).pointer();
      return address === 0 ? "-" : (functionName(this.mem.symbols, address) ?? `0x${address.toString(16)}`);
    };
    const callback1 = name("callback1");
    const callback2 = name("callback2");
    const mode = main.field("inBattle").int() ? "battle" : OVERWORLD_CALLBACKS.has(callback2) ? "overworld" : "other";
    return { mode, callback1, callback2 };
  }

  /** The party in the order of the game. */
  party(): PartyMon[] {
    return readParty(this.mem, this.decode);
  }

  pcSpecies(): string[] {
    return readPcSpecies(this.mem, this.decode);
  }

  /** The party in the order of the screen: the party menu of a battle lists the Pokémon in the battle order. */
  partyOnScreen(): PartyMon[] {
    const party = this.party();
    if (this.context().mode !== "battle" || !this.partyMenu()) return party;
    return party.map((_, i) => party[battleMenuSlot(this.mem, i)]);
  }

  milestones(): Milestone[] {
    return MILESTONE_FLAGS.filter(([, flag]) => this.flag(flag)).map(([milestone]) => milestone);
  }

  flagProgress(): number {
    const flags = this.saveBlock1.field("flags").bytes();
    const set = (id: number) => (flags[id >> 3] >> (id & 7)) & 1;
    let count = this.itemBallFlags.reduce((sum, id) => sum + set(id), 0);
    for (let id = FLAG_HIDDEN_ITEMS_START; id < FLAG_HIDDEN_ITEMS_END; id++) count += set(id);
    for (let id = TRAINER_FLAGS_START; id < TRAINER_FLAGS_END; id++) count += set(id);
    for (const byte of this.mem.global("gSaveBlock2Ptr").deref().field("pokedex").field("owned").bytes()) for (let bit = 0; bit < 8; bit++) count += (byte >> bit) & 1;
    return count;
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
      if (grid) {
        const actors = this.buildActors(grid, this.mem.global("gMapHeader"), true);
        return { grid: this.withObstacles(grid, actors), actors };
      }
    }
    const grid = this.gridOf(id.group, id.num);
    if (!grid) return null;
    const actors = this.actorsOf(grid);
    return { grid: this.withObstacles(grid, actors), actors };
  }

  /** The grid with the cells of the fixed obstacles as blocked cells: a route, a target and the Atlas then see them as walls. */
  withObstacles(grid: MapGrid, { obstacles }: MapActors): MapGrid {
    const kinds = [...grid.kinds];
    for (const { x, y } of obstacles) kinds[(y - grid.y0) * grid.width + (x - grid.x0)] = KIND.blocked;
    return { ...grid, kinds: kinds.join("") };
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
      outside: this.outsideTypes.has(header.field("mapType").int()),
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
      signs: this.eventList(header, "bgEvents", "bgEventCount").map((e) => {
        const kind = e.field("kind").int();
        const at = { x: e.field("x").int(), y: e.field("y").int() };
        return kind === BG_EVENT_HIDDEN_ITEM ? { ...at, kind: "hidden-item" as const } : { ...at, kind: "sign" as const, playerFacing: SIGN_PLAYER_FACING[kind] ?? "any" };
      }),
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
    const obstacles: Obstacle[] = [];
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
      const graphicsId = (obj ?? template).field("graphicsId").int();
      const graphics = this.graphicsNames.get(graphicsId) ?? `#${graphicsId}`;
      const obstacle = OBSTACLES[graphics];
      if (obstacle) {
        obstacles.push({ x, y, ...obstacle });
        continue;
      }
      const person: MapActors["people"][number] = { localId, x, y, graphics, facing, loaded: obj !== undefined };
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
    return { player, people, obstacles, triggers, signs };
  }
}

function badgeFlag(badge: number): number {
  return FLAG_BADGE01_GET + badge - 1;
}

function warpHow(x: number, y: number, behavior: string): WarpHow {
  const push = PUSH_WARPS[behavior];
  if (push) return { how: "press", from: { x, y: push.from === "below" ? y + 1 : y }, direction: push.direction };
  return STEP_WARPS.has(behavior) ? { how: "step" } : { how: "none" };
}
