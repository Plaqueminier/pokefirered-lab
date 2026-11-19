import type { BagItem } from "../bag";
import { type SafariBattle, struggles } from "../battle";
import { type BattleTurn, type FightFacts, poisonDamage, reviveFacts, type SpeedFacts, stageRatio, type UseFacts, useFacts } from "../battle-facts";
import type { BattleState } from "../harness/harness";
import { isDamageMove, type PartyMon, type PartyMove, statLabel } from "../party";
import { monPlace, moveText, statsText } from "./party-text";

const GHOST_LINE = "The game cannot identify this GHOST, because the Bag has no SILPH SCOPE. Your Pokémon are too scared to attack it, a ball does not catch it, and run always works. Use run, and get the SILPH SCOPE first.";

const MULTIPLIERS: Record<number, string> = { 0.25: "¼", 0.5: "½" };

export function itemEstimates(items: BagItem[], player: BattleState["player"], party: PartyMon[]): string[] {
  return items.flatMap(({ name, effect }) => {
    if (!effect) return [];
    if (effect.revive) {
      const revived = reviveFacts(effect, party);
      return revived.length === 0 ? [] : [`  ${name}: ${revived.map(({ slot, hp }) => `${monPlace(party, slot)} HP 0 → ${hp}`).join(", ")}.`];
    }
    const facts = useText(useFacts(effect, player), player);
    return facts.length === 0 ? [] : [`  ${name} on ${player.nickname}: ${facts.join(", ")}.`];
  });
}

function useText({ hp, cures, poisonStays, raise }: UseFacts, player: BattleState["player"]): string[] {
  return [
    ...(hp ? [`HP ${hp.from} → ${hp.to}`] : []),
    ...(cures.length > 0 ? [`cures ${cures.join(" and ")}`] : []),
    ...(poisonStays ? [`the ${player.status} stays (${poisonText(player)})`] : []),
    ...(raise ? [`${statLabel(raise.stat)} +${raise.stages} stage${raise.stages === 1 ? "" : "s"}`] : []),
  ];
}

export function fights({ player, enemy, fights: facts, double }: BattleState): string[] {
  if (struggles(player)) return [`- fight 0: no move of ${player.nickname} has PP, so ${player.nickname} uses STRUGGLE (NORMAL, power 50) and loses 1/4 of the damage that it does.`];
  return player.moves.flatMap((move, i) => {
    if (player.encoredSlot !== null && player.encoredSlot !== i) return [];
    const otherFoe = double?.otherFoe;
    const onFoes = otherFoe ? [factText(facts[i], "foe 1", enemy.species), factText(otherFoe.fights[i] ?? null, "foe 2", otherFoe.enemy.species)] : [factText(facts[i], null, enemy.species)];
    const reach = double ? reachText(double, i) : null;
    const turns = turnsText(facts[i] ?? otherFoe?.fights[i] ?? null, player.nickname);
    const known = [reach, ...onFoes, turns].filter((text) => text !== null);
    const about = move.pp === 0 ? ". No PP: you cannot use it." : known.length > 0 ? `. ${known.join(". ")}.` : "";
    return [`- fight ${i}: ${move.name} (${moveText(move)})${about}${player.encoredSlot === i ? " The ENCORE allows only this move." : ""}`];
  });
}

/** What the fight of the move `i` hits, and what to write for the foe that it hits. */
function reachText({ reach, otherFoe, ally }: NonNullable<BattleState["double"]>, i: number): string | null {
  const foes = otherFoe ? "both foes" : "the foe";
  switch (reach[i]) {
    case "one":
      return otherFoe ? `Hits one foe: fight ${i} hits foe 1, fight ${i} on 2 hits foe 2` : `Hits ${foes}`;
    case "both":
      return `Hits ${foes}`;
    case "all":
      return `Hits ${foes}${ally ? " and your other Pokémon" : ""}`;
    case "game":
      return "The game chooses its foe";
    default:
      return "It does not aim at a foe";
  }
}

function factText(fact: FightFacts | null, foe: string | null, species: string): string | null {
  if (!fact) return null;
  const noEffect = `No effect${foe ? ` on ${foe}` : ""}: `;
  if ("noEffect" in fact) return noEffect + fact.noEffect;
  const block = fact.abilityBlock;
  if (block?.sure) return `${noEffect}${species} has the ability ${block.ability}, so ${block.rule}`;
  const damage = "effect" in fact ? `On ${foe ?? "the foe"}: ${fightText(fact)}` : null;
  const canHave = block ? `${!damage && foe ? `On ${foe}: ` : ""}${species} can have the ability ${block.ability}: then ${block.rule}` : null;
  const chance = fact.hitChance === undefined ? null : `Chance to hit${foe ? ` ${foe}` : ""} now: ${fact.hitChance}%`;
  return [damage, canHave, chance].filter((text) => text !== null).join(". ") || null;
}

function turnsText(fact: FightFacts | null, nickname: string): string | null {
  if (!fact || "noEffect" in fact) return null;
  if (fact.turns === "charge") return "It takes 2 turns: the foe acts at the 1st turn";
  return fact.turns === "recharge" ? `After it, ${nickname} must recharge for 1 turn: the foe acts at this turn` : null;
}

function fightText({ effect, stab, estimate }: Extract<FightFacts, { effect: number }>): string {
  const name = effect === 0 ? "no effect" : effect < 1 ? "not very effective" : effect > 1 ? "super effective" : "normal effect";
  return [
    `${name} ×${MULTIPLIERS[effect] ?? effect}`,
    ...(stab ? ["STAB"] : []),
    ...(estimate ? [`${rangeText(estimate.minPercent, estimate.maxPercent, "%")} of its HP now`, `${rangeText(estimate.minHits, estimate.maxHits)} hit${estimate.maxHits === 1 ? "" : "s"} to KO`] : []),
  ].join(", ");
}

export function rangeText(min: number, max: number, unit = ""): string {
  return min === max ? `${min}${unit}` : `${min}${unit} to ${max}${unit}`;
}

export function battleLines(battle: BattleState, party: PartyMon[]): string[] {
  if (battle.safari) return safariBattleLines(battle, battle.safari, party);
  const { player, enemy, lastTurn, foeTurns, double } = battle;
  const used = foeTurns.flatMap((turn) => turn.moves.filter((m) => m.user === turn.player.before.name).map((m) => `${m.move} (${[...m.results, `its HP ${turn.foe.before.hp} → ${turn.foe.after.hp}`].join(", ")})`));
  return [
    `Battle against ${battle.kind === "trainer" ? "a trainer" : "a wild Pokémon"}.`,
    ...(double ? doubleLines(battle) : []),
    `Your ${player.nickname}: level ${player.level}, HP ${player.hp}/${player.maxHp}, status ${player.status}${badPoisonText(player)}. States: ${player.states.join(", ") || "none"}. Stats: ${statsText(player.stats)}.${speedText(battle.speed.player)} Stat stages: ${stagesText(player.statStages)}.`,
    ...(double?.ally ? [`Your other Pokémon in the battle, ${double.ally.nickname}: level ${double.ally.level}, HP ${double.ally.hp}/${double.ally.maxHp}, status ${double.ally.status}.`] : []),
    foeLine(enemy, double?.otherFoe ? "Foe 1" : "Foe"),
    ...(double?.otherFoe ? [foeLine(double.otherFoe.enemy, "Foe 2")] : []),
    ...orderLines(battle.speed),
    ...(battle.ghost ? [GHOST_LINE] : ownedLines(battle, party)),
    ...(lastTurn ? [turnLine(lastTurn)] : []),
    ...(used.length > 0 ? [`Your moves on this foe: ${used.join(", ")}.`] : []),
    ...(fewDamagePp(player.moves) ? ["Your damage moves have few PP: use the other moves that have an effect, or switch."] : []),
  ];
}

// The game sets the Pokémon of the player to zeros in a Safari battle (battle_main.c), so the lines show only the foe.
function safariBattleLines(battle: BattleState, { balls, fleePercent }: SafariBattle, party: PartyMon[]): string[] {
  const { enemy } = battle;
  return [
    foeLine(enemy, "Foe"),
    ...ownedLines(battle, party),
    `This is a battle of the Safari Zone: your Pokémon do not fight, and you have ${balls} SAFARI BALL${balls === 1 ? "" : "s"}.`,
    `The foe can flee at each turn: now a chance of ${fleePercent}%.`,
    "BALL throws a SAFARI BALL. BAIT: the foe flees less for 2 to 6 turns, and a ball catches it less easily. ROCK: a ball catches it more easily, and the foe flees more for 2 to 6 turns. RUN leaves the battle.",
  ];
}

function badPoisonText(player: BattleState["player"]): string {
  return player.status === "bad poison" ? ` (${poisonText(player)})` : "";
}

function poisonText(player: BattleState["player"]): string | null {
  const damage = poisonDamage(player);
  if (damage.length === 0) return null;
  return damage.length === 1 ? `poison damage ${damage[0]} HP at each turn` : `poison damage ${damage.join(", ")} HP in the next ${damage.length} turns`;
}

function foeLine(foe: BattleState["enemy"], label: string): string {
  return `${label} ${foe.species} (${foe.types.join(", ")}): level ${foe.level}, HP ${foe.hpPercent}%, status ${foe.status}. States: ${foe.states.join(", ") || "none"}. Stat stages: ${stagesText(foe.statStages)}. Moves seen: ${foe.movesSeen.join(", ") || "none"}.`;
}

function doubleLines({ player }: BattleState): string[] {
  return [`This is a double battle: you choose an action for each of your Pokémon, one after the other, and the turn plays after the last choice. You choose now for ${player.nickname}. Each fight below tells what it hits.`];
}

/** All the damage moves together have a quarter of their PP or less, and a move still has PP. */
function fewDamagePp(moves: PartyMove[]): boolean {
  const damage = moves.filter(isDamageMove);
  const sum = (pp: (move: PartyMove) => number) => damage.reduce((total, move) => total + pp(move), 0);
  return damage.length > 0 && sum((move) => move.pp) * 4 <= sum((move) => move.maxPp) && moves.some((move) => move.pp > 0);
}

function ownedLines(battle: BattleState, party: PartyMon[]): string[] {
  if (battle.kind !== "wild") return [];
  const { species } = battle.enemy;
  const inParty = party.filter((mon) => mon.species === species).length;
  const owned = inParty + battle.inPc;
  return [owned === 0 ? `You own no ${species}.` : `You own ${owned} ${species}: ${inParty} in the party, ${battle.inPc} in the PC.`];
}

function turnLine({ moves, player, foe }: BattleTurn): string {
  const first = moves.length > 1 ? [`${moves[0].user} moved first.`] : [];
  const used = moves.map((m) => `${m.user} used ${m.move}${m.results.length > 0 ? `: ${m.results.join(", ")}` : ""}.`);
  return ["Last turn:", ...first, ...used, `Your ${sideText(player)}.`, `Foe ${sideText(foe)}.`].join(" ");
}

function sideText({ before, after }: BattleTurn["player"]): string {
  return before.name === after.name ? `${before.name}: HP ${before.hp} → ${after.hp}` : `${before.name}: HP ${before.hp}, then ${after.name}: HP ${after.hp}`;
}

function speedText({ stat, stage, badge, paralysis, now }: SpeedFacts): string {
  const [numerator, denominator] = stageRatio(stage);
  const steps = [
    ...(stage === 0 ? [] : [`× ${stage > 0 ? numerator / denominator : fractionText(numerator, denominator)} for the stage ${stage > 0 ? "+" : ""}${stage}`]),
    ...(badge ? ["× 1.1 for the Thunder Badge"] : []),
    ...(paralysis ? ["× ¼ for paralysis"] : []),
  ];
  return steps.length === 0 ? "" : ` Speed ${now} now: ${stat} ${steps.join(", ")}.`;
}

function orderLines({ player, foes }: BattleState["speed"]): string[] {
  if (foes === null) return [];
  const yours = player.now;
  const order = (foe: number) => (yours === foe ? `The order is random (speed ${yours} on both sides)` : `${yours > foe ? "You move" : "The foe moves"} first (your speed ${yours}, its speed ${foe})`);
  if (foes.length === 1) return [`When both moves have priority 0: ${order(foes[0])}.`];
  return [`When both moves have priority 0, ${foes.map((foe, i) => `${i === 0 ? "against" : "Against"} foe ${i + 1}: ${order(foe)}.`).join(" ")}`];
}

function fractionText(numerator: number, denominator: number): string {
  const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));
  const divisor = gcd(numerator, denominator);
  return MULTIPLIERS[numerator / denominator] ?? `${numerator / divisor}/${denominator / divisor}`;
}

function stagesText(stages: Record<string, number>): string {
  const changed = Object.entries(stages).filter(([, stage]) => stage !== 0);
  return changed.map(([stat, stage]) => `${statLabel(stat)} ${stage > 0 ? "+" : ""}${stage}`).join(", ") || "none";
}

