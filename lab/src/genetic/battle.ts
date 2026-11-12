import type { AvailableAction, BattleState } from "../harness/harness";
import { isDamageMove } from "../party";
import type { BattleCriterion } from "./genome";

// The highest type multiplier: 2 × 2 on a foe with two weak types.
const MAX_EFFECT = 4;
// EXPLOSION has the highest power of the game.
const MAX_POWER = 250;

type BattleMove = { name: "fight"; move: number } | { name: "run" };

export type BattleAction = { action: BattleMove; criteria: Partial<Record<BattleCriterion, number>> };

export function moveKey(battle: BattleState, move: number): string {
  return `${battle.player.partyIndex}:${battle.player.moves[move]?.name}`;
}

export function battleActions(battle: BattleState, available: AvailableAction[], used: ReadonlySet<string>): BattleAction[] {
  return available.flatMap((action): BattleAction[] => {
    if (action.name === "run") return [{ action, criteria: { run: 1 } }];
    if (action.name !== "fight") return [];
    const move = battle.player.moves[action.move];
    if (!move) return [];
    const facts = battle.fights[action.move];
    const noDamage = !isDamageMove(move);
    return [
      {
        action: { name: "fight", move: action.move },
        criteria: {
          effectiveness: facts && "effect" in facts ? facts.effect / MAX_EFFECT : 0,
          power: (move.power ?? 0) / MAX_POWER,
          accuracy: (move.accuracy ?? 100) / 100,
          ppLeft: move.maxPp === 0 ? 0 : move.pp / move.maxPp,
          noDamage: Number(noDamage),
          usedNoDamage: Number(noDamage && used.has(moveKey(battle, action.move))),
        },
      },
    ];
  });
}
