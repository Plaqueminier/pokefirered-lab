import type { Memory, Ref } from "./memory";
import { MOVE_NONE, nameAt, type PartyMon, readMoves, readStats, speciesTypes, STAT_NAMES, type Stats, statusOf } from "./party";
import { activeTask, type Choice, type Decode } from "./prompts";
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
// gBattleCommunication indexes (constants/battle_script_commands.h); Cmd_trygivecaughtmonnick reads the keys in state 1.
const MULTIUSE_STATE = 0;
const CURSOR_POSITION = 1;
const NICKNAME_KEY_STATE = 1;
// Task_DexScreen_RegisterMonToPokedex (pokedex_screen.c) waits for A or B in state 11, on the page of the caught Pokémon.
const DEX_PAGE_KEY_STATE = 11;

export type BattleMenu = "battleAction" | "battleMove";

export type PrintedMove = { partyIndex: number; move: number };

export type StatStages = Record<(typeof STAGE_NAMES)[number], number>;

export type BattleMon = Pick<PartyMon, "species" | "nickname" | "types" | "level" | "hp" | "maxHp" | "status" | "stats" | "moves"> & { statStages: StatStages };

export type Battle = { kind: "trainer" | "wild"; player: BattleMon; enemy: BattleMon & { partyIndex: number } };

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
    player: battleMon(mem, mons.at(PLAYER_BATTLER), decode),
    enemy: { ...battleMon(mem, mons.at(ENEMY_BATTLER), decode), partyIndex: enemyPartyIndex(mem) },
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

// CB2_InitPartyMenu makes the task of the party menu before its fade starts: the menu reads keys only in CB2_UpdatePartyMenu.
export function partyPick(mem: Memory): boolean {
  return (
    functionName(mem.symbols, mem.global("gMain").field("callback2").pointer()) === "CB2_UpdatePartyMenu" &&
    activeTask(mem, "Task_HandleChooseMonInput") !== null &&
    !mem.global("gPaletteFade").field("active").int()
  );
}

export function levelUpBoxWaits(mem: Memory): boolean {
  return scriptCommand(mem) === "Cmd_drawlvlupbox" && LEVEL_UP_BOX_KEY_STATES.has(mem.global("gBattleScripting").field("drawlvlupboxState").int());
}

/** The question "Give a nickname to the caught Pokémon?" after a catch. */
export function nicknameChoice(mem: Memory, decode: Decode): Choice | null {
  const communication = mem.global("gBattleCommunication");
  if (scriptCommand(mem) !== "Cmd_trygivecaughtmonnick" || communication.at(MULTIUSE_STATE).int() !== NICKNAME_KEY_STATE) return null;
  const options = decode(mem.global("gText_BattleYesNoChoice").bytes()).split("\n");
  return { options, cursor: communication.at(CURSOR_POSITION).int() };
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
  return move === MOVE_NONE || move === MOVE_UNAVAILABLE ? null : { partyIndex: enemyPartyIndex(mem), move };
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

function enemyPartyIndex(mem: Memory): number {
  return mem.global("gBattlerPartyIndexes").at(ENEMY_BATTLER).int();
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
