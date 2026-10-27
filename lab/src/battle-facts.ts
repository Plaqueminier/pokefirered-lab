import type { Battle, BattleMon } from "./battle";
import type { Memory } from "./memory";
import { type PartyMove, STAGE_NAMES, type StageName, statLabel, typeName } from "./party";
import type { Decode } from "./prompts";

const HP_BAR_PIXELS = 48;
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
// EFFECT_* of constants/battle_move_effects.h. The rules come from their scripts in data/battle_scripts_1.s.
const EFFECT_SLEEP = 1;
const EFFECT_TOXIC = 33;
const EFFECT_CONFUSE = 49;
const EFFECT_POISON = 66;
const EFFECT_PARALYZE = 67;
const EFFECT_LEECH_SEED = 84;
const EFFECT_WILL_O_WISP = 167;
// Each range has one effect for each stat, in the order of STAGE_NAMES.
const STAT_UP_EFFECTS = [10, 50];
const STAT_DOWN_EFFECTS = [18, 58];
const MAX_STAGE = 6;
// These scripts fail on a target behind a SUBSTITUTE before the accuracy check.
const SUBSTITUTE_FAILS = new Set([EFFECT_SLEEP, EFFECT_TOXIC, EFFECT_CONFUSE, EFFECT_POISON, EFFECT_PARALYZE, EFFECT_LEECH_SEED, EFFECT_WILL_O_WISP]);
const STATUS_EFFECTS = new Set([EFFECT_SLEEP, EFFECT_TOXIC, EFFECT_POISON, EFFECT_PARALYZE, EFFECT_WILL_O_WISP]);
// jumpiftype in the scripts. The paralysis script uses the type chart instead (typecalc).
const IMMUNE_TYPES: Record<number, string[]> = { [EFFECT_POISON]: ["POISON", "STEEL"], [EFFECT_TOXIC]: ["POISON", "STEEL"], [EFFECT_WILL_O_WISP]: ["FIRE"], [EFFECT_LEECH_SEED]: ["GRASS"] };
// The texts of the states in battle.ts.
const SUBSTITUTE_STATE = "behind a SUBSTITUTE";
const FORESIGHT_STATE = "identified (FORESIGHT)";

export type TypeChart = { effects: { attack: string; defense: string; multiplier: number }[]; special: string[] };

/** A damage move gets its type effect, STAB and an estimate. A move with no damage gets only the sure reason why it has no effect on the foe now. */
export type FightFacts = { effect: number; stab: boolean; estimate: { minPercent: number; maxPercent: number; minHits: number; maxHits: number } | null } | { noEffect: string };

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
  return player.moves.map((move) => {
    const { type, power, fixedDamage } = move;
    if (power === null && !fixedDamage) {
      const noEffect = noEffectReason(move, player, enemy, chart);
      return noEffect ? { noEffect } : null;
    }
    const stab = player.types.includes(type);
    const effects = chart.effects.filter((e) => e.attack === type && enemy.types.includes(e.defense));
    const effect = effects.reduce((product, e) => (product * e.multiplier) / TYPE_MUL_NORMAL, 1);
    // The damage of such a move has its own rule: only an immunity of the foe changes it.
    if (power === null) return { effect: effect === 0 ? 0 : 1, stab: false, estimate: null };
    if (effect === 0 || enemy.hp === 0) return { effect, stab, estimate: null };
    // The order of the game: Cmd_damagecalc gives the base damage, Cmd_typecalc applies STAB and then each factor of the type chart, and the damage is 85% to 100% of the result. Each step rounds down.
    let damage = baseDamage(player, enemy, power, chart.special.includes(type), milestones);
    if (stab) damage = Math.floor((damage * 15) / 10);
    for (const { multiplier } of effects) damage = Math.max(Math.floor((damage * multiplier) / TYPE_MUL_NORMAL), multiplier === 0 ? 0 : 1);
    const [min, max] = [Math.floor((damage * MIN_RANDOM_PERCENT) / 100), damage];
    const percent = (hp: number) => Math.min(100, Math.round((hp * 100) / enemy.hp));
    const hits = (hp: number) => Math.ceil(enemy.hp / Math.max(1, hp));
    return { effect, stab, estimate: { minPercent: percent(min), maxPercent: percent(max), minHits: hits(max), maxHits: hits(min) } };
  });
}

/** The reason why a move with no damage surely has no effect now, from the facts that a player sees. Accuracy, abilities and the other cases are not sure: they give null. */
function noEffectReason({ effect, type }: PartyMove, player: BattleMon, foe: BattleMon, chart: TypeChart): string | null {
  const raised = stageOf(STAT_UP_EFFECTS, effect);
  if (raised) return player.statStages[raised] === MAX_STAGE ? `the ${statLabel(raised)} of ${player.nickname} is already at +${MAX_STAGE}` : null;
  const lowered = stageOf(STAT_DOWN_EFFECTS, effect);
  if (foe.states.includes(SUBSTITUTE_STATE) && (lowered || SUBSTITUTE_FAILS.has(effect))) return `the foe is ${SUBSTITUTE_STATE}`;
  if (lowered) return foe.statStages[lowered] === -MAX_STAGE ? `the ${statLabel(lowered)} of the foe is already at -${MAX_STAGE}` : null;
  // With FORESIGHT, the type chart of the game skips the immunities of GHOST.
  const immune = effect === EFFECT_PARALYZE && !foe.states.includes(FORESIGHT_STATE) ? chart.effects.filter((e) => e.attack === type && e.multiplier === 0).map((e) => e.defense) : (IMMUNE_TYPES[effect] ?? []);
  const immuneType = foe.types.find((t) => immune.includes(t));
  if (immuneType) return `the foe is a ${immuneType} type`;
  if (STATUS_EFFECTS.has(effect) && foe.status !== "none") return "the foe already has a status";
  if (effect === EFFECT_LEECH_SEED && foe.states.includes("seeded")) return "the foe is already seeded";
  if (effect === EFFECT_CONFUSE && foe.states.includes("confused")) return "the foe is already confused";
  return null;
}

function stageOf(firstEffects: number[], effect: number): StageName | null {
  const first = firstEffects.find((start) => effect >= start && effect < start + STAGE_NAMES.length);
  return first === undefined ? null : STAGE_NAMES[effect - first];
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

export function hpPercent(hp: number, maxHp: number): number {
  const pixels = Math.floor((hp * HP_BAR_PIXELS) / maxHp);
  return Math.round(((pixels === 0 && hp > 0 ? 1 : pixels) * 100) / HP_BAR_PIXELS);
}
