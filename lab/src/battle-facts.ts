import type { ItemEffect } from "./bag";
import type { Battle, BattleMon } from "./battle";
import type { Memory } from "./memory";
import { isDamageMove, MOVE_NONE, nameAt, type PartyMon, type PartyMove, STAGE_NAMES, type StageName, statLabel, typeName, walkStatus } from "./party";
import type { Decode } from "./prompts";

const HP_BAR_PIXELS = 48;
const TYPE_MYSTERY = 9;
const TYPE_FORESIGHT = 0xfe;
const TYPE_ENDTABLE = 0xff;
const TYPE_MUL_NORMAL = 10;
const NEUTRAL_EFFECT = 1;
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
const EFFECT_ALWAYS_HIT = 17;
const EFFECT_TOXIC = 33;
const EFFECT_RAZOR_WIND = 39;
const EFFECT_CONFUSE = 49;
const EFFECT_POISON = 66;
const EFFECT_PARALYZE = 67;
const EFFECT_SKY_ATTACK = 75;
const EFFECT_VITAL_THROW = 78;
const EFFECT_RECHARGE = 80;
const EFFECT_LEECH_SEED = 84;
const EFFECT_SKULL_BASH = 145;
const EFFECT_SOLAR_BEAM = 151;
const EFFECT_SEMI_INVULNERABLE = 155;
const EFFECT_WILL_O_WISP = 167;
// Each range has one effect for each stat, in the order of STAGE_NAMES.
const STAT_UP_EFFECTS = [10, 50];
const STAT_DOWN_EFFECTS = [18, 58];
const MAX_STAGE = 6;
// STATUS1_TOXIC_COUNTER is 4 bits, and the game stops at the highest value.
export const TOXIC_COUNTER_MAX = 0xf;
const BAD_POISON_TURNS = 3;
// The sAccuracyStageRatios table of the game, from the stage -6 to the stage +6.
const ACCURACY_STAGE_RATIOS: [number, number][] = [
  [33, 100], [36, 100], [43, 100], [50, 100], [60, 100], [75, 100], [1, 1], [133, 100], [166, 100], [2, 1], [233, 100], [133, 50], [3, 1],
];
const SURE_HIT_EFFECTS = new Set([EFFECT_ALWAYS_HIT, EFFECT_VITAL_THROW]);
const CHARGE_EFFECTS = new Set([EFFECT_RAZOR_WIND, EFFECT_SKY_ATTACK, EFFECT_SKULL_BASH, EFFECT_SOLAR_BEAM, EFFECT_SEMI_INVULNERABLE]);
// These scripts fail on a target behind a SUBSTITUTE before the accuracy check.
const SUBSTITUTE_FAILS = new Set([EFFECT_SLEEP, EFFECT_TOXIC, EFFECT_CONFUSE, EFFECT_POISON, EFFECT_PARALYZE, EFFECT_LEECH_SEED, EFFECT_WILL_O_WISP]);
const STATUS_EFFECTS = new Set([EFFECT_SLEEP, EFFECT_TOXIC, EFFECT_POISON, EFFECT_PARALYZE, EFFECT_WILL_O_WISP]);
// jumpiftype in the scripts. The paralysis script uses the type chart instead (typecalc).
const IMMUNE_TYPES: Record<number, string[]> = { [EFFECT_POISON]: ["POISON", "STEEL"], [EFFECT_TOXIC]: ["POISON", "STEEL"], [EFFECT_WILL_O_WISP]: ["FIRE"], [EFFECT_LEECH_SEED]: ["GRASS"] };
const SOUND_MOVES_END = 0xffff;
const ABILITY_BLOCKS: Record<string, { blocks: (move: PartyMove, effect: number, foe: BattleMon, chart: TypeChart) => boolean; rule: string }> = {
  LEVITATE: { blocks: (move) => move.type === "GROUND" && isDamageMove(move), rule: "GROUND moves miss it" },
  "FLASH FIRE": { blocks: (move, _, foe) => move.type === "FIRE" && foe.status !== "freeze", rule: "FIRE moves have no effect on it and make its FIRE moves stronger" },
  "VOLT ABSORB": { blocks: (move) => move.type === "ELECTRIC" && isDamageMove(move), rule: "ELECTRIC moves that do damage restore its HP and do no damage" },
  "WATER ABSORB": { blocks: (move) => move.type === "WATER" && isDamageMove(move), rule: "WATER moves that do damage restore its HP and do no damage" },
  SOUNDPROOF: { blocks: (move, _, __, chart) => chart.soundMoves.includes(move.name), rule: "sound moves have no effect on it" },
  "WONDER GUARD": { blocks: (move, effect) => isDamageMove(move) && effect <= 1, rule: "only super effective moves do damage to it" },
};
const FOE_PREFIXES = ["Foe", "Wild"];
// The texts of the states in battle.ts.
const SUBSTITUTE_STATE = "behind a SUBSTITUTE";
const FORESIGHT_STATE = "identified (FORESIGHT)";

export type TypeChart = { effects: { attack: string; defense: string; multiplier: number }[]; special: string[]; soundMoves: string[] };

type HitFacts = { hitChance?: number; turns?: "charge" | "recharge" };

type AbilityBlock = { ability: string; sure: boolean; rule: string };

/** A damage move gets its type effect, STAB and an estimate. A move with no damage gets only the sure reason why it has no effect on the foe now. Each move can also have its chance to hit now, its 2 turns, and the ability of the foe that stops it. */
export type FightFacts = (({ effect: number; stab: boolean; estimate: { minPercent: number; maxPercent: number; minHits: number; maxHits: number } | null } & HitFacts) | { noEffect: string } | HitFacts) & { abilityBlock?: AbilityBlock };

export type UseFacts = { hp: { from: number; to: number } | null; cures: string[]; poisonStays: boolean; raise: ItemEffect["raise"] | null };

export type SpeedFacts = { stat: number; stage: number; badge: boolean; paralysis: boolean; now: number };

/** `foes`: the speed now of each foe, in the order of the foes. Null: hidden, below the `full` Knowledge level. */
export type BattleSpeed = { player: SpeedFacts; foes: number[] | null };

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
  const sounds = mem.global("sSoundMovesTable");
  const soundMoves = Array.from({ length: sounds.length }, (_, i) => sounds.at(i).int()).filter((move) => move !== SOUND_MOVES_END && move !== MOVE_NONE);
  return {
    effects,
    special: Array.from({ length: types - TYPE_MYSTERY - 1 }, (_, i) => typeName(mem, TYPE_MYSTERY + 1 + i, decode)),
    soundMoves: soundMoves.map((move) => nameAt(mem, "gMoveNames", move, decode)),
  };
}

export function fightFacts({ player, enemy }: Battle, chart: TypeChart, milestones: readonly string[], texts: readonly string[]): (FightFacts | null)[] {
  const abilities = shownAbilities(enemy, texts);
  return player.moves.map((move) => {
    const { type, power } = move;
    const hit = hitFacts(move, player, enemy);
    if (!isDamageMove(move)) {
      const noEffect = noEffectReason(move, player, enemy, chart);
      const block = abilityBlock(abilities, move, NEUTRAL_EFFECT, enemy, chart);
      if (noEffect) return { noEffect, ...block };
      const facts = { ...hit, ...block };
      return Object.keys(facts).length > 0 ? facts : null;
    }
    const stab = player.types.includes(type);
    const effects = chart.effects.filter((e) => e.attack === type && enemy.types.includes(e.defense));
    const effect = effects.reduce((product, e) => (product * e.multiplier) / TYPE_MUL_NORMAL, 1);
    // The damage of such a move has its own rule: only an immunity of the foe changes it.
    if (effect === 0) return { effect, stab: stab && power !== null, estimate: null, ...(hit.turns ? { turns: hit.turns } : {}) };
    const block = abilityBlock(abilities, move, effect, enemy, chart);
    if (power === null) return { effect: 1, stab: false, estimate: null, ...hit, ...block };
    if (enemy.hp === 0) return { effect, stab, estimate: null, ...hit, ...block };
    // The order of the game: Cmd_damagecalc gives the base damage, Cmd_typecalc applies STAB and then each factor of the type chart, and the damage is 85% to 100% of the result. Each step rounds down.
    let damage = baseDamage(player, enemy, power, chart.special.includes(type), milestones);
    if (stab) damage = Math.floor((damage * 15) / 10);
    for (const { multiplier } of effects) damage = Math.max(Math.floor((damage * multiplier) / TYPE_MUL_NORMAL), multiplier === 0 ? 0 : 1);
    const [min, max] = [Math.floor((damage * MIN_RANDOM_PERCENT) / 100), damage];
    const percent = (hp: number) => Math.min(100, Math.round((hp * 100) / enemy.hp));
    const hits = (hp: number) => Math.ceil(enemy.hp / Math.max(1, hp));
    return { effect, stab, estimate: { minPercent: percent(min), maxPercent: percent(max), minHits: hits(max), maxHits: hits(min) }, ...hit, ...block };
  });
}

/** The HP that the poison takes at each of the next turns: one value for poison, `BAD_POISON_TURNS` values for bad poison, none with no poison. */
export function poisonDamage({ status, maxHp, toxicCounter }: BattleMon): number[] {
  if (status === "poison") return [Math.max(1, Math.floor(maxHp / 8))];
  if (status !== "bad poison") return [];
  return Array.from({ length: BAD_POISON_TURNS }, (_, turn) => Math.max(1, Math.floor(maxHp / 16)) * Math.min(toxicCounter + turn + 1, TOXIC_COUNTER_MAX));
}

/** What an item of the use line does now to the Pokémon of the player. */
export function useFacts({ hp, cures = [], raise }: ItemEffect, player: BattleMon): UseFacts {
  const cured = [...(cures.some((cure) => cure === walkStatus(player.status)) ? [player.status] : []), ...(cures.includes("confusion") && player.states.includes("confused") ? ["confusion"] : [])];
  const healed = hp !== undefined && player.hp < player.maxHp ? healedHp(player.hp, player.maxHp, hp) : null;
  return {
    hp: healed === null ? null : { from: player.hp, to: healed },
    cures: cured,
    poisonStays: healed !== null && cured.length === 0 && poisonDamage(player).length > 0,
    raise: raise && player.statStages[raise.stat] < MAX_STAGE ? raise : null,
  };
}

/** The HP of each fainted Pokémon of the party after a REVIVE. */
export function reviveFacts({ hp }: ItemEffect, party: PartyMon[]): { slot: number; hp: number }[] {
  return [...party.keys()].filter((slot) => party[slot].hp === 0 && !party[slot].isEgg).map((slot) => ({ slot, hp: healedHp(0, party[slot].maxHp, hp) }));
}

function healedHp(hp: number, maxHp: number, amount: ItemEffect["hp"]): number {
  if (amount === "full") return maxHp;
  if (amount === "half") return Math.max(1, Math.floor(maxHp / 2));
  return Math.min(maxHp, hp + (amount ?? 0));
}

function hitFacts({ effect, accuracy }: PartyMove, player: BattleMon, foe: BattleMon): HitFacts {
  const facts: HitFacts = {};
  if (CHARGE_EFFECTS.has(effect)) facts.turns = "charge";
  if (effect === EFFECT_RECHARGE) facts.turns = "recharge";
  const evasion = foe.states.includes(FORESIGHT_STATE) ? 0 : foe.statStages.evasion;
  const stage = Math.min(MAX_STAGE, Math.max(-MAX_STAGE, player.statStages.accuracy - evasion));
  if (accuracy !== null && stage !== 0 && !SURE_HIT_EFFECTS.has(effect)) {
    const [dividend, divisor] = ACCURACY_STAGE_RATIOS[stage + MAX_STAGE];
    facts.hitChance = Math.min(100, Math.floor((dividend * accuracy) / divisor));
  }
  return facts;
}

function shownAbilities(foe: BattleMon, texts: readonly string[]): string[] {
  const aboutFoe = (text: string) => FOE_PREFIXES.some((prefix) => text.startsWith(`${prefix} ${foe.nickname}`) && [" ", "'"].includes(text[prefix.length + foe.nickname.length + 1]));
  const shown = texts.filter(aboutFoe).flatMap((text) => foe.abilities.filter((ability) => text.includes(ability)));
  return shown.length > 0 ? [shown[0]] : foe.abilities;
}

function abilityBlock(abilities: string[], move: PartyMove, effect: number, foe: BattleMon, chart: TypeChart): { abilityBlock?: AbilityBlock } {
  const blocking = abilities.filter((ability) => ABILITY_BLOCKS[ability]?.blocks(move, effect, foe, chart));
  if (blocking.length === 0) return {};
  return { abilityBlock: { ability: blocking[0], sure: blocking.length === abilities.length, rule: ABILITY_BLOCKS[blocking[0]].rule } };
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

/** The multiplier of a stat stage, as a numerator and a denominator. */
export function stageRatio(stage: number): [number, number] {
  return [10 + 5 * Math.max(0, stage), 10 + 5 * Math.max(0, -stage)];
}

function staged(stat: number, stage: number): number {
  const [numerator, denominator] = stageRatio(stage);
  return Math.floor((stat * numerator) / denominator);
}

/** The rules of GetWhoStrikesFirst, but with no held item, SWIFT SWIM or CHLOROPHYLL. */
export function speedFacts({ stats, statStages, status }: Pick<BattleMon, "stats" | "statStages" | "status">, badge: boolean): SpeedFacts {
  const stage = statStages.speed;
  const paralysis = status === "paralysis";
  let now = staged(stats.speed, stage);
  if (badge) now = Math.floor((now * 110) / 100);
  if (paralysis) now = Math.floor(now / 4);
  return { stat: stats.speed, stage, badge, paralysis, now };
}

/** The speed of the player, with its badge boost, and at the `full` Knowledge level the speed of each foe: no badge boost for a foe. */
export function battleSpeed({ player, enemy, double }: Battle, milestones: readonly string[], full: boolean): BattleSpeed {
  const foes = [enemy, ...(double?.otherFoe ? [double.otherFoe] : [])];
  return { player: speedFacts(player, milestones.includes("badge-3")), foes: full ? foes.map((foe) => speedFacts(foe, false).now) : null };
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
