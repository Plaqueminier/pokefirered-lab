import { battleTurn, type BattleTurn, hpPercent } from "./battle-facts";
import type { Memory } from "./memory";
import { MOVE_NONE, nameAt, PARTY_SIZE, type PartyMon, readMoves, readStats, speciesTypes, STAGE_NAMES, type StageName, type Stats, statusOf } from "./party";
import { activeTask, type Decode } from "./prompts";
import { functionName } from "./symbols";

const BATTLE_TYPE_DOUBLE = 1 << 0;
const BATTLE_TYPE_TRAINER = 1 << 3;
const PLAYER_BATTLER = 0;
const PLAYER_PARTNER_BATTLER = 2;
const ENEMY_BATTLER = 1;
const ENEMY_PARTNER_BATTLER = 3;
const ENEMY_BATTLERS = [ENEMY_BATTLER, ENEMY_PARTNER_BATTLER];
const MOVE_UNAVAILABLE = 0xffff;
const DEFAULT_STAT_STAGE = 6;
const BATTLE_MENUS: Record<string, BattleMenu> = {
  HandleInputChooseAction: "battleAction",
  HandleInputChooseMove: "battleMove",
  OakOldManHandleInputChooseMove: "battleMove",
};
const TARGET_MENU = "HandleInputChooseTarget";
// MOVE_TARGET_* of include/battle.h. The other targets do not aim at a Pokémon that the player chooses.
const MOVE_TARGET_SELECTED = 0;
const GAME_CHOOSES_TARGET = (1 << 0) | (1 << 2);
const MOVE_TARGET_BOTH = 1 << 3;
const MOVE_TARGET_FOES_AND_ALLY = 1 << 5;
// The controller of the battler that the player chooses for, also in its party menu.
const CHOOSING_CONTROLLERS = new Set([...Object.keys(BATTLE_MENUS), TARGET_MENU, "WaitForMonSelection"]);
const BATTLE_CURSORS: Record<BattleMenu, string> = { battleAction: "gActionSelectionCursor", battleMove: "gMoveSelectionCursor" };
// Cmd_drawlvlupbox waits for a key in these states, one per page of the level-up stats box.
const LEVEL_UP_BOX_KEY_STATES = new Set([6, 8]);
const YES_NO_READS_INPUT = 1;
const YES_NO_CURSOR = 1;
const YES_NO_COMMANDS = new Set(["Cmd_yesnobox", "Cmd_trygivecaughtmonnick"]);
const DEX_PAGE_KEY_STATE = 11;
const LEARN_MOVE_COMMANDS: Record<string, LearnMoveQuestion> = { Cmd_yesnoboxlearnmove: "learn", Cmd_yesnoboxstoplearningmove: "stop" };
const LEARN_MOVE_READS_INPUT = 1;
const EVOLUTION_TASK = "Task_EvolutionScene";
const EVO_STATE = 0;
const EVO_LEARN_MOVE_STATE = 6;
const EVO_LEARN_MOVE_YES_STATE = 7;
const EVO_PARTY_ID = 10;
const EVOSTATE_REPLACE_MOVE = 22;
const MVSTATE_HANDLE_YES_NO = 4;
const MVSTATE_SHOW_MOVE_SELECT = 5;
const SUMMARY_TASK = "Task_InputHandler_SelectOrForgetMove";
const SUMMARY_READS_INPUT = 2;
// The volatile states that a battle text tells the player, from include/constants/battle.h.
const STATUS2_STATES: [bits: number, state: string][] = [
  [0x7, "confused"],
  [0x70, "in an uproar"],
  [0x300, "storing energy (BIDE)"],
  [0xc00, "rampaging (then confused)"],
  [0x1000, "locked into its move"],
  [0xe000, "wrapped"],
  [0xf0000, "infatuated"],
  [1 << 20, "pumped up (FOCUS ENERGY)"],
  [1 << 21, "transformed"],
  [1 << 22, "must recharge"],
  [1 << 23, "in a RAGE"],
  [1 << 24, "behind a SUBSTITUTE"],
  [1 << 25, "DESTINY BOND"],
  [1 << 26, "cannot escape"],
  [1 << 27, "in a NIGHTMARE"],
  [1 << 28, "cursed"],
  [1 << 29, "identified (FORESIGHT)"],
  [1 << 31, "tormented"],
];
const STATUS3_STATES: [bits: number, state: string][] = [
  [1 << 2, "seeded"],
  [0x18, "its next move hits for sure"],
  [1 << 6, "in the air"],
  [1 << 7, "underground"],
  [1 << 18, "underwater"],
  [1 << 8, "minimized"],
  [1 << 9, "charged (CHARGE)"],
  [1 << 10, "rooted (INGRAIN)"],
  [0x1800, "drowsy (YAWN)"],
  [1 << 13, "IMPRISON"],
  [1 << 14, "GRUDGE"],
  [1 << 16, "MUD SPORT"],
  [1 << 17, "WATER SPORT"],
];
const STATUS3_PERISH_SONG = 1 << 5;

export type BattleMenu = "battleAction" | "battleMove";

type LearnMoveQuestion = "learn" | "stop";

export type LearnMoveBox = { question: LearnMoveQuestion; cursor: number; slot: number; move: number };

export type PrintedMove = { partyIndex: number; move: number };

type StatStages = Record<StageName, number>;

/** `states` are the volatile states of the battle, for example "seeded" or "confused". `encoredSlot`: the only move that FIGHT can play under an ENCORE. */
export type BattleMon = Pick<PartyMon, "species" | "nickname" | "types" | "level" | "hp" | "maxHp" | "status" | "stats" | "moves"> & { states: string[]; statStages: StatStages; encoredSlot: number | null };

type BattlerMon = BattleMon & { partyIndex: number };

/** What a move hits in a double battle. `game`: the game chooses the foe. `none`: the move does not aim at a Pokémon of the battle, for example it acts on its user. */
export type MoveReach = "one" | "both" | "all" | "game" | "none";

/** `player` is the Pokémon that the player chooses for now. In a double battle, `enemy` is the first foe that can fight, `otherFoe` is the second one while both can fight, and `reach` has one entry for each move of `player`. */
export type Battle = { kind: "trainer" | "wild"; player: BattlerMon; enemy: BattlerMon; double?: { ally: BattlerMon | null; otherFoe: BattlerMon | null; reach: MoveReach[] } };

export type EnemyMon = {
  species: string;
  types: string[];
  level: number;
  hpPercent: number;
  status: BattleMon["status"];
  states: string[];
  statStages: StatStages;
  movesSeen: string[];
  exact?: { hp: number; maxHp: number; stats: Stats };
};

export function readBattle(mem: Memory, decode: Decode): Battle {
  const kind = mem.global("gBattleTypeFlags").int() & BATTLE_TYPE_TRAINER ? "trainer" : "wild";
  const mon = (battler: number): BattlerMon => ({ ...battleMon(mem, battler, decode), partyIndex: battlerPartyIndex(mem, battler) });
  if (!isDouble(mem)) return { kind, player: mon(PLAYER_BATTLER), enemy: mon(ENEMY_BATTLER) };
  const chooser = choosingBattler(mem);
  const ally = chooser === PLAYER_BATTLER ? PLAYER_PARTNER_BATTLER : PLAYER_BATTLER;
  const [foe = ENEMY_BATTLER, otherFoe] = ENEMY_BATTLERS.filter((battler) => canFight(mem, battler));
  return { kind, player: mon(chooser), enemy: mon(foe), double: { ally: canFight(mem, ally) ? mon(ally) : null, otherFoe: otherFoe === undefined ? null : mon(otherFoe), reach: moveReaches(mem, chooser) } };
}

function moveReaches(mem: Memory, battler: number): MoveReach[] {
  const moves = mem.global("gBattleMons").at(battler).field("moves");
  return Array.from({ length: moves.length }, (_, slot) => moves.at(slot).int())
    .filter((move) => move !== MOVE_NONE)
    .map((move) => reachOf(mem.global("gBattleMoves").at(move).field("target").int()));
}

function reachOf(target: number): MoveReach {
  if (target === MOVE_TARGET_SELECTED) return "one";
  if (target & MOVE_TARGET_BOTH) return "both";
  if (target & MOVE_TARGET_FOES_AND_ALLY) return "all";
  return target & GAME_CHOOSES_TARGET ? "game" : "none";
}

function isDouble(mem: Memory): boolean {
  return (mem.global("gBattleTypeFlags").int() & BATTLE_TYPE_DOUBLE) !== 0;
}

function controllerOf(mem: Memory, battler: number): string {
  return functionName(mem.symbols, mem.global("gBattlerControllerFuncs").at(battler).pointer()) ?? "";
}

/** A double battle asks for the left Pokémon, then for the right one. */
function choosingBattler(mem: Memory): number {
  return isDouble(mem) && CHOOSING_CONTROLLERS.has(controllerOf(mem, PLAYER_PARTNER_BATTLER)) ? PLAYER_PARTNER_BATTLER : PLAYER_BATTLER;
}

function canFight(mem: Memory, battler: number): boolean {
  return (mem.global("gAbsentBattlerFlags").int() & (1 << battler)) === 0 && mem.global("gBattleMons").at(battler).field("hp").int() > 0;
}

/** The battler of a foe, as the prompt numbers the foes: 1 for the left one, 2 for the right one. */
export function foeBattler(foe: number): number {
  return ENEMY_BATTLERS[foe - 1];
}

export function enemyView(enemy: BattleMon, movesSeen: string[], exact: boolean): EnemyMon {
  const { species, types, level, hp, maxHp, status, states, stats, statStages } = enemy;
  const seen = { species, types, level, hpPercent: hpPercent(hp, maxHp), status, states, statStages, movesSeen };
  return exact ? { ...seen, exact: { hp, maxHp, stats } } : seen;
}

/** With no PP in all its moves, a Pokémon uses STRUGGLE when FIGHT is chosen (AreAllMovesUnusable in src/battle_util.c). */
export function struggles(mon: Pick<BattleMon, "moves">): boolean {
  return mon.moves.length > 0 && mon.moves.every((move) => move.pp === 0);
}

export function battleMenu(mem: Memory): BattleMenu | null {
  return BATTLE_MENUS[controllerOf(mem, choosingBattler(mem))] ?? null;
}

/** The battler under the cursor of the target screen, or null with no target screen. Only a move that hits one foe opens it, and the model chooses that foe in its fight action. */
export function battleTargetCursor(mem: Memory): number | null {
  return controllerOf(mem, choosingBattler(mem)) === TARGET_MENU ? mem.global("gMultiUsePlayerCursor").int() : null;
}

export function battleCursor(mem: Memory, menu: BattleMenu): number {
  return mem.global(BATTLE_CURSORS[menu]).at(choosingBattler(mem)).int();
}

export function levelUpBoxWaits(mem: Memory): boolean {
  return scriptCommand(mem) === "Cmd_drawlvlupbox" && LEVEL_UP_BOX_KEY_STATES.has(mem.global("gBattleScripting").field("drawlvlupboxState").int());
}

export function battleYesNoCursor(mem: Memory): number | null {
  const communication = mem.global("gBattleCommunication");
  return YES_NO_COMMANDS.has(scriptCommand(mem) ?? "") && communication.at(0).int() === YES_NO_READS_INPUT ? communication.at(YES_NO_CURSOR).int() : null;
}

export function dexPageWaits(mem: Memory): boolean {
  return activeTask(mem, "Task_DexScreen_RegisterMonToPokedex") !== null && mem.global("sPokedexScreenData").deref().field("state").int() === DEX_PAGE_KEY_STATE;
}

export function learnMoveBox(mem: Memory): LearnMoveBox | null {
  const cursor = mem.global("gBattleCommunication").at(YES_NO_CURSOR).int();
  const move = mem.global("gMoveToLearn").int();
  // The evolution scene runs before the battle mode ends.
  const evolution = activeTask(mem, EVOLUTION_TASK)?.field("data");
  if (evolution) {
    if (evolution.at(EVO_STATE).int() !== EVOSTATE_REPLACE_MOVE || evolution.at(EVO_LEARN_MOVE_STATE).int() !== MVSTATE_HANDLE_YES_NO) return null;
    const question = evolution.at(EVO_LEARN_MOVE_YES_STATE).int() === MVSTATE_SHOW_MOVE_SELECT ? "learn" : "stop";
    return { question, cursor, slot: evolution.at(EVO_PARTY_ID).int(), move };
  }
  const question = LEARN_MOVE_COMMANDS[scriptCommand(mem) ?? ""];
  const reads = question !== undefined && mem.global("gBattleScripting").field("learnMoveState").int() === LEARN_MOVE_READS_INPUT;
  return reads ? { question, cursor, slot: mem.global("gBattleStruct").deref().field("expGetterMonId").int(), move } : null;
}

export function forgetMoveCursor(mem: Memory): number | null {
  // sMonSummaryScreen keeps its old address after the screen closes.
  if (!activeTask(mem, SUMMARY_TASK)) return null;
  const reads = mem.global("sMonSummaryScreen").deref().field("selectMoveInputHandlerState").int() === SUMMARY_READS_INPUT;
  return reads ? mem.global("sMoveSelectionCursorPos").int() : null;
}

function scriptCommand(mem: Memory): string | null {
  const command = mem.u8(mem.global("gBattlescriptCurrInstr").pointer());
  const commands = mem.global("gBattleScriptingCommandsTable");
  return command < commands.length ? functionName(mem.symbols, commands.at(command).pointer()) : null;
}

export function enemyMovesPrinted(mem: Memory): (PrintedMove | null)[] {
  return ENEMY_BATTLERS.map((battler) => {
    const move = mem.global("gLastPrintedMoves").at(battler).int();
    return move === MOVE_NONE || move === MOVE_UNAVAILABLE ? null : { partyIndex: battlerPartyIndex(mem, battler), move };
  });
}

export class BattleWatch {
  private last: (PrintedMove | null)[] = [];
  private moves = new Map<number, Set<number>>();
  private open: { before: Battle; texts: string[]; choosing?: true } | null = null;
  private turns: { foe: number; turn: BattleTurn }[] = [];

  // gLastPrintedMoves keeps the move of the last battle until the intro of the next one clears it.
  onFrame(battleStarted: boolean, printed: (PrintedMove | null)[]): void {
    const changed = printed.filter((move, i): move is PrintedMove => move !== null && (move.move !== this.last[i]?.move || move.partyIndex !== this.last[i]?.partyIndex));
    this.last = printed;
    if (battleStarted) {
      this.moves = new Map();
      this.open = null;
      this.turns = [];
    } else for (const { partyIndex, move } of changed) this.moves.set(partyIndex, (this.moves.get(partyIndex) ?? new Set()).add(move));
  }

  movesSeen(partyIndex: number): number[] {
    return [...(this.moves.get(partyIndex) ?? [])];
  }

  onAction(before: Battle | null, texts: string[], now: Battle | null, decision: boolean): void {
    if (before && !this.open?.choosing) this.open = { before, texts: [] };
    if (!this.open) return;
    this.open.texts.push(...texts);
    if (!now) this.open = null;
    else if (decision && now.double && this.open.texts.length === 0) {
      // The choice for one Pokémon of a double battle has no text: the turn starts after the choice for the other one.
      this.open.choosing = true;
    } else if (decision) {
      this.turns.push({ foe: this.open.before.enemy.partyIndex, turn: battleTurn(this.open.before, now, this.open.texts) });
      this.open = null;
    }
  }

  lastTurn(): BattleTurn | null {
    return this.turns.at(-1)?.turn ?? null;
  }

  turnsAgainst(partyIndex: number): BattleTurn[] {
    return this.turns.flatMap((t) => (t.foe === partyIndex ? [t.turn] : []));
  }
}

function battlerPartyIndex(mem: Memory, battler: number): number {
  return mem.global("gBattlerPartyIndexes").at(battler).int();
}

/** The party menu of a battle lists the Pokémon in the battle order, not the party order. */
export function battleMenuSlot(mem: Memory, partyIndex: number): number {
  const order = mem.global("gBattlePartyCurrentOrder");
  for (let slot = 0; slot < PARTY_SIZE; slot++) {
    const byte = order.at(slot >> 1).int();
    if ((slot & 1 ? byte & 0xf : byte >> 4) === partyIndex) return slot;
  }
  throw new Error(`no slot of the party menu has the Pokémon ${partyIndex}`);
}

function battleMon(mem: Memory, battler: number, decode: Decode): BattleMon {
  const mon = mem.global("gBattleMons").at(battler);
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
    states: battleStates(mem, battler, mon.field("status2").int(), decode),
    encoredSlot: encoredSlot(mem, battler),
    moves: readMoves(mem, decode, mon.field("ppBonuses").int(), (slot) => ({ move: mon.field("moves").at(slot).int(), pp: mon.field("pp").at(slot).int() })),
    stats: readStats(mon),
    statStages: Object.fromEntries(STAGE_NAMES.map((name, i) => [name, stages.at(i + 1).int() - DEFAULT_STAT_STAGE])) as StatStages,
  };
}

function encoredSlot(mem: Memory, battler: number): number | null {
  const disable = mem.global("gDisableStructs").at(battler);
  return disable.field("encoredMove").int() === MOVE_NONE ? null : disable.field("encoredMovePos").int();
}

function battleStates(mem: Memory, battler: number, status2: number, decode: Decode): string[] {
  const status3 = mem.global("gStatuses3").at(battler).int();
  const disable = mem.global("gDisableStructs").at(battler);
  const move = (field: string) => nameAt(mem, "gMoveNames", disable.field(field).int(), decode);
  return [
    ...STATUS2_STATES.flatMap(([bits, state]) => (status2 & bits ? [state] : [])),
    ...STATUS3_STATES.flatMap(([bits, state]) => (status3 & bits ? [state] : [])),
    ...(status3 & STATUS3_PERISH_SONG ? [`PERISH SONG count ${disable.field("perishSongTimer").int()}`] : []),
    ...(disable.field("disableTimer").int() > 0 ? [`${move("disabledMove")} disabled`] : []),
    ...(disable.field("encoreTimer").int() > 0 ? [`ENCORE of ${move("encoredMove")}`] : []),
    ...(disable.field("tauntTimer").int() > 0 ? ["taunted"] : []),
    ...(disable.field("stockpileCounter").int() > 0 ? [`STOCKPILE ${disable.field("stockpileCounter").int()}`] : []),
  ];
}
