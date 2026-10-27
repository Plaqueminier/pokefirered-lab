import type { Memory, Ref } from "./memory";
import { MOVE_NONE, nameAt, PARTY_SIZE, type PartyMon, readMoves, readStats, speciesTypes, STAT_NAMES, type Stats, statusOf, typeName } from "./party";
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
const YES_NO_READS_INPUT = 1;
const YES_NO_CURSOR = 1;
const YES_NO_COMMANDS = new Set(["Cmd_yesnobox", "Cmd_trygivecaughtmonnick"]);
const DEX_PAGE_KEY_STATE = 11;
const TYPE_MYSTERY = 9;
const TYPE_FORESIGHT = 0xfe;
const TYPE_ENDTABLE = 0xff;
const TYPE_MUL_NORMAL = 10;
const MIN_RANDOM_PERCENT = 85;
const USED_TEXT = /^(.+) used (.+)!$/;
const TURN_RESULTS: [RegExp, string][] = [
  [/^It's super effective!$/, "super effective"],
  [/^It's not very effective/, "not very effective"],
  [/^It doesn't affect /, "no effect"],
  [/^A critical hit!$/, "a critical hit"],
  [/'s attack missed!$/, "missed"],
  [/^But it failed!$/, "failed"],
];
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

export type BattleMenu = "battleAction" | "battleMove";

type LearnMoveQuestion = "learn" | "stop";

export type LearnMoveBox = { question: LearnMoveQuestion; cursor: number; slot: number; move: number };

export type PrintedMove = { partyIndex: number; move: number };

type StatStages = Record<(typeof STAGE_NAMES)[number], number>;

export type BattleMon = Pick<PartyMon, "species" | "nickname" | "types" | "level" | "hp" | "maxHp" | "status" | "stats" | "moves"> & { statStages: StatStages };

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

export function enemyMovePrinted(mem: Memory): PrintedMove | null {
  const move = mem.global("gLastPrintedMoves").at(ENEMY_BATTLER).int();
  return move === MOVE_NONE || move === MOVE_UNAVAILABLE ? null : { partyIndex: battlerPartyIndex(mem, ENEMY_BATTLER), move };
}

export class BattleWatch {
  private last: PrintedMove | null = null;
  private moves = new Map<number, Set<number>>();
  private open: { before: Battle; texts: string[] } | null = null;
  private turns: { foe: number; turn: BattleTurn }[] = [];

  // gLastPrintedMoves keeps the move of the last battle until the intro of the next one clears it.
  onFrame(battleStarted: boolean, printed: PrintedMove | null): void {
    const changed = printed && (printed.move !== this.last?.move || printed.partyIndex !== this.last?.partyIndex);
    this.last = printed;
    if (battleStarted) {
      this.moves = new Map();
      this.open = null;
      this.turns = [];
    } else if (changed) this.moves.set(printed.partyIndex, (this.moves.get(printed.partyIndex) ?? new Set()).add(printed.move));
  }

  movesSeen(partyIndex: number): number[] {
    return [...(this.moves.get(partyIndex) ?? [])];
  }

  onAction(before: Battle | null, texts: string[], now: Battle | null, decision: boolean): void {
    if (before) this.open = { before, texts: [] };
    if (!this.open) return;
    this.open.texts.push(...texts);
    if (!now) this.open = null;
    else if (decision) {
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

export type TypeChart = { effects: { attack: string; defense: string; multiplier: number }[]; special: string[] };

export type FightFacts = { effect: number; stab: boolean; estimate: { minPercent: number; maxPercent: number; minHits: number; maxHits: number } | null };

type TurnSide = { before: { name: string; hp: string }; after: { name: string; hp: string } };

type MoveUse = { user: string; move: string; results: string[] };

export type BattleTurn = { moves: MoveUse[]; player: TurnSide; foe: TurnSide };

export function readTypeChart(mem: Memory, decode: Decode): TypeChart {
  // The debug info gives signed bytes: read them raw so that TYPE_ENDTABLE is 0xff.
  const table = mem.global("gTypeEffectiveness").bytes();
  const effects: TypeChart["effects"] = [];
  for (let i = 0; i + 2 < table.length && table[i] !== TYPE_ENDTABLE; i += 3) {
    if (table[i] === TYPE_FORESIGHT) continue;
    effects.push({ attack: typeName(mem, table[i], decode), defense: typeName(mem, table[i + 1], decode), multiplier: table[i + 2] });
  }
  const types = mem.global("gTypeNames").length;
  return { effects, special: Array.from({ length: types - TYPE_MYSTERY - 1 }, (_, i) => typeName(mem, TYPE_MYSTERY + 1 + i, decode)) };
}

export function fightFacts({ player, enemy }: Battle, chart: TypeChart, milestones: readonly string[]): (FightFacts | null)[] {
  return player.moves.map(({ type, power }) => {
    if (power === null) return null;
    const stab = player.types.includes(type);
    const effects = chart.effects.filter((e) => e.attack === type && enemy.types.includes(e.defense));
    const effect = effects.reduce((product, e) => (product * e.multiplier) / TYPE_MUL_NORMAL, 1);
    if (effect === 0 || enemy.hp === 0) return { effect, stab, estimate: null };
    let damage = baseDamage(player, enemy, power, chart.special.includes(type), milestones);
    if (stab) damage = Math.floor((damage * 15) / 10);
    for (const { multiplier } of effects) damage = Math.max(Math.floor((damage * multiplier) / TYPE_MUL_NORMAL), multiplier === 0 ? 0 : 1);
    const [min, max] = [Math.floor((damage * MIN_RANDOM_PERCENT) / 100), damage];
    const percent = (hp: number) => Math.min(100, Math.round((hp * 100) / enemy.hp));
    const hits = (hp: number) => Math.ceil(enemy.hp / Math.max(1, hp));
    return { effect, stab, estimate: { minPercent: percent(min), maxPercent: percent(max), minHits: hits(max), maxHits: hits(min) } };
  });
}

function baseDamage(attacker: BattleMon, defender: BattleMon, power: number, special: boolean, milestones: readonly string[]): number {
  const [attackStat, defenseStat] = special ? (["spAttack", "spDefense"] as const) : (["attack", "defense"] as const);
  const badge = special ? "badge-7" : "badge-1";
  const attack = milestones.includes(badge) ? Math.floor((attacker.stats[attackStat] * 110) / 100) : attacker.stats[attackStat];
  let damage = staged(attack, attacker.statStages[attackStat]) * power * (Math.floor((2 * attacker.level) / 5) + 2);
  damage = Math.floor(Math.floor(damage / staged(defender.stats[defenseStat], defender.statStages[defenseStat])) / 50);
  if (!special) {
    if (attacker.status === "burn") damage = Math.floor(damage / 2);
    damage = Math.max(damage, 1);
  }
  return damage + 2;
}

function staged(stat: number, stage: number): number {
  return Math.floor((stat * (10 + 5 * Math.max(0, stage))) / (10 + 5 * Math.max(0, -stage)));
}

export function battleTurn(before: Battle, after: Battle, texts: string[]): BattleTurn {
  const moves: MoveUse[] = [];
  for (const text of texts) {
    const used = text.match(USED_TEXT);
    if (used) moves.push({ user: used[1], move: used[2], results: [] });
    const result = TURN_RESULTS.find(([pattern]) => pattern.test(text));
    if (result && moves.length > 0) moves.at(-1)!.results.push(result[1]);
  }
  const foeAfter = after.enemy.partyIndex === before.enemy.partyIndex ? after.enemy : { ...before.enemy, hp: 0 };
  const playerHp = (mon: BattleMon) => ({ name: mon.nickname, hp: `${mon.hp}/${mon.maxHp}` });
  const foeHp = (mon: BattleMon) => ({ name: mon.species, hp: `${hpPercent(mon.hp, mon.maxHp)}%` });
  return { moves, player: { before: playerHp(before.player), after: playerHp(after.player) }, foe: { before: foeHp(before.enemy), after: foeHp(foeAfter) } };
}

function hpPercent(hp: number, maxHp: number): number {
  const pixels = Math.floor((hp * HP_BAR_PIXELS) / maxHp);
  return Math.round(((pixels === 0 && hp > 0 ? 1 : pixels) * 100) / HP_BAR_PIXELS);
}
