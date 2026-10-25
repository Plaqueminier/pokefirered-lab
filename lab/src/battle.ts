import type { Memory, Ref } from "./memory";
import { MOVE_NONE, nameAt, PARTY_SIZE, type PartyMon, readMoves, readStats, speciesTypes, STAT_NAMES, type Stats, statusOf } from "./party";
import { activeTask, type Decode } from "./prompts";
import { functionName } from "./symbols";

const BATTLE_TYPE_TRAINER = 1 << 3;
const PLAYER_BATTLER = 0;
const ENEMY_BATTLER = 1;
const MOVE_UNAVAILABLE = 0xffff;
const STAGE_NAMES = [...STAT_NAMES, "accuracy", "evasion"] as const;
const DEFAULT_STAT_STAGE = 6;
const HP_BAR_PIXELS = 48;
const BATTLE_MENUS: Record<string, BattleMenu> = {
  HandleInputChooseAction: "battleAction",
  HandleInputChooseMove: "battleMove",
  OakOldManHandleInputChooseMove: "battleMove",
};
const BATTLE_CURSORS: Record<BattleMenu, string> = { battleAction: "gActionSelectionCursor", battleMove: "gMoveSelectionCursor" };
// Cmd_drawlvlupbox waits for a key in these states, one per page of the level-up stats box.
const LEVEL_UP_BOX_KEY_STATES = new Set([6, 8]);
// Cmd_yesnobox and Cmd_trygivecaughtmonnick (the nickname after a catch) read the input in their state 1, with the cursor in gBattleCommunication[CURSOR_POSITION].
const YES_NO_READS_INPUT = 1;
const YES_NO_CURSOR = 1;
const YES_NO_COMMANDS = new Set(["Cmd_yesnobox", "Cmd_trygivecaughtmonnick"]);
// Task_DexScreen_RegisterMonToPokedex (pokedex_screen.c) waits for A or B in state 11, on the page of the caught Pokémon.
const DEX_PAGE_KEY_STATE = 11;

export type BattleMenu = "battleAction" | "battleMove";

export type PrintedMove = { partyIndex: number; move: number };

export type StatStages = Record<(typeof STAGE_NAMES)[number], number>;

export type BattleMon = Pick<PartyMon, "species" | "nickname" | "types" | "level" | "hp" | "maxHp" | "status" | "stats" | "moves"> & { statStages: StatStages };

/** `partyIndex`: the place of the Pokémon in its party, in the order of the party out of a battle. */
export type Battle = { kind: "trainer" | "wild"; player: BattleMon & { partyIndex: number }; enemy: BattleMon & { partyIndex: number } };

export type EnemyMon = {
  species: string;
  types: string[];
  level: number;
  hpPercent: number;
  status: BattleMon["status"];
  statStages: StatStages;
  movesSeen: string[];
  exact?: { hp: number; maxHp: number; stats: Stats };
};

export function readBattle(mem: Memory, decode: Decode): Battle {
  const mons = mem.global("gBattleMons");
  return {
    kind: mem.global("gBattleTypeFlags").int() & BATTLE_TYPE_TRAINER ? "trainer" : "wild",
    player: { ...battleMon(mem, mons.at(PLAYER_BATTLER), decode), partyIndex: battlerPartyIndex(mem, PLAYER_BATTLER) },
    enemy: { ...battleMon(mem, mons.at(ENEMY_BATTLER), decode), partyIndex: battlerPartyIndex(mem, ENEMY_BATTLER) },
  };
}

export function enemyView(enemy: BattleMon, movesSeen: string[], exact: boolean): EnemyMon {
  const { species, types, level, hp, maxHp, status, stats, statStages } = enemy;
  const seen = { species, types, level, hpPercent: hpPercent(hp, maxHp), status, statStages, movesSeen };
  return exact ? { ...seen, exact: { hp, maxHp, stats } } : seen;
}

export function battleMenu(mem: Memory): BattleMenu | null {
  const controller = mem.global("gBattlerControllerFuncs").at(PLAYER_BATTLER).pointer();
  return BATTLE_MENUS[functionName(mem.symbols, controller) ?? ""] ?? null;
}

export function battleCursor(mem: Memory, menu: BattleMenu): number {
  return mem.global(BATTLE_CURSORS[menu]).at(PLAYER_BATTLER).int();
}

export function levelUpBoxWaits(mem: Memory): boolean {
  return scriptCommand(mem) === "Cmd_drawlvlupbox" && LEVEL_UP_BOX_KEY_STATES.has(mem.global("gBattleScripting").field("drawlvlupboxState").int());
}

/** The cursor of the yes/no box of a battle script, for example "Use next POKéMON?" after a faint or the nickname after a catch: 0 YES, 1 NO. Null when the box does not read the input. */
export function battleYesNoCursor(mem: Memory): number | null {
  const communication = mem.global("gBattleCommunication");
  return YES_NO_COMMANDS.has(scriptCommand(mem) ?? "") && communication.at(0).int() === YES_NO_READS_INPUT ? communication.at(YES_NO_CURSOR).int() : null;
}

/** The Pokédex page of a Pokémon caught for the first time waits for A or B. */
export function dexPageWaits(mem: Memory): boolean {
  return activeTask(mem, "Task_DexScreen_RegisterMonToPokedex") !== null && mem.global("sPokedexScreenData").deref().field("state").int() === DEX_PAGE_KEY_STATE;
}

function scriptCommand(mem: Memory): string | null {
  const command = mem.u8(mem.global("gBattlescriptCurrInstr").pointer());
  const commands = mem.global("gBattleScriptingCommandsTable");
  return command < commands.length ? functionName(mem.symbols, commands.at(command).pointer()) : null;
}

export function enemyMovePrinted(mem: Memory): PrintedMove | null {
  const move = mem.global("gLastPrintedMoves").at(ENEMY_BATTLER).int();
  return move === MOVE_NONE || move === MOVE_UNAVAILABLE ? null : { partyIndex: battlerPartyIndex(mem, ENEMY_BATTLER), move };
}

export class BattleWatch {
  private last: PrintedMove | null = null;
  private moves = new Map<number, Set<number>>();

  // gLastPrintedMoves keeps the move of the last battle until the intro of the next one clears it.
  onFrame(battleStarted: boolean, printed: PrintedMove | null): void {
    const changed = printed && (printed.move !== this.last?.move || printed.partyIndex !== this.last?.partyIndex);
    this.last = printed;
    if (battleStarted) this.moves = new Map();
    else if (changed) this.moves.set(printed.partyIndex, (this.moves.get(printed.partyIndex) ?? new Set()).add(printed.move));
  }

  movesSeen(partyIndex: number): number[] {
    return [...(this.moves.get(partyIndex) ?? [])];
  }
}

function battlerPartyIndex(mem: Memory, battler: number): number {
  return mem.global("gBattlerPartyIndexes").at(battler).int();
}

/**
 * The party menu of a battle shows the party in the battle order, and gPlayerParty has this order while the menu is open:
 * slot s shows the Pokémon gBattlePartyCurrentOrder[s] (GetPartyIdFromBattleSlot, party_menu.c), 4 bits for each slot.
 */
export function battleMenuSlot(mem: Memory, partyIndex: number): number {
  const order = mem.global("gBattlePartyCurrentOrder");
  for (let slot = 0; slot < PARTY_SIZE; slot++) {
    const byte = order.at(slot >> 1).int();
    if ((slot & 1 ? byte & 0xf : byte >> 4) === partyIndex) return slot;
  }
  throw new Error(`no slot of the party menu has the Pokémon ${partyIndex}`);
}

function battleMon(mem: Memory, mon: Ref, decode: Decode): BattleMon {
  const stages = mon.field("statStages");
  const species = mon.field("species").int();
  return {
    species: nameAt(mem, "gSpeciesNames", species, decode),
    types: speciesTypes(mem, species, decode),
    nickname: decode(mon.field("nickname").bytes()),
    level: mon.field("level").int(),
    hp: mon.field("hp").int(),
    maxHp: mon.field("maxHP").int(),
    status: statusOf(mon.field("status1").int()),
    moves: readMoves(mem, decode, mon.field("ppBonuses").int(), (slot) => ({ move: mon.field("moves").at(slot).int(), pp: mon.field("pp").at(slot).int() })),
    stats: readStats(mon),
    statStages: Object.fromEntries(STAGE_NAMES.map((name, i) => [name, stages.at(i + 1).int() - DEFAULT_STAT_STAGE])) as StatStages,
  };
}

function hpPercent(hp: number, maxHp: number): number {
  const pixels = Math.floor((hp * HP_BAR_PIXELS) / maxHp);
  return Math.round(((pixels === 0 && hp > 0 ? 1 : pixels) * 100) / HP_BAR_PIXELS);
}
