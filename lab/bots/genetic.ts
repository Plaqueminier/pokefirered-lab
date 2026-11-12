import { isDecisionPoint, type WaitingFor } from "../src/game";
import { battleActions, moveKey } from "../src/genetic/battle";
import { type ChoiceCriterion, type Genome, scoreOf } from "../src/genetic/genome";
import { type WalkAction, walkActions } from "../src/genetic/walk";
import type { ActionResult, AvailableAction, Bot, Harness, MacroAction } from "../src/harness/harness";
import { type Cell, cellKey } from "../src/harness/path";
import { B_PRESSES } from "../src/model/prompt";
import { approaches, interactCell, type Overworld } from "../src/model/targets";

// The spec (#88): a Run of a Genome ends when the Stuck counter reaches 60.
const NO_PROGRESS_LIMIT = 60;
const MAX_UNCOVERED = 3;

/** `impossible`: the Harness answered `impossible`, and the game did not change. */
type Candidate = { score: number; play: () => Promise<{ impossible: boolean }> };

/** A group with no weights, for example in a Genome of version 1, has the weight 0 for each criterion. */
export function geneticBot(weights: Partial<Genome> = {}): Bot {
  const genome: Genome = { walk: {}, choice: {}, battle: {}, ...weights };
  return { name: "genetic", version: "2", genome, noProgressLimit: NO_PROGRESS_LIMIT, play: (harness) => new GeneticPlay(harness, genome).play() };
}

// The Genome has no criteria for these Decision points: a fixed rule plays. A name stays empty: the game keeps its name.
const FIXED_RULES: Partial<Record<WaitingFor["kind"], (available: AvailableAction[]) => MacroAction[]>> = {
  naming: () => [{ name: "name", text: "" }],
  learnMove: () => [{ name: "keep" }],
  partyPick: (available) => available.flatMap((a) => (a.name === "send" ? [a] : [])),
  shopMenu: () => [{ name: "leave" }],
  itemPc: () => [{ name: "leave" }],
  pokemonPc: () => [{ name: "leave" }],
};

/** Each option of a choice, YES/NO and `multichoice`, in the order of the menu. */
function choiceCriteria(options: string[]): Partial<Record<ChoiceCriterion, number>>[] {
  return options.map((option, i) => ({ isYes: Number(option === "YES"), isNo: Number(option === "NO"), rank: options.length === 1 ? 0 : i / (options.length - 1) }));
}

function nothingPlayed(result: ActionResult): { impossible: boolean } {
  return { impossible: result.status === "impossible" };
}

class GeneticPlay {
  readonly #walked = new Map<string, Set<string>>();
  // The moves that the Bot played since the last walk: a battle ends on the overworld.
  readonly #usedMoves = new Set<string>();
  #uncovered = 0;

  constructor(
    private readonly harness: Harness,
    private readonly genome: Genome,
  ) {}

  async play(): Promise<void> {
    for (;;) {
      const waiting = this.harness.waitingFor();
      if (!isDecisionPoint(waiting)) {
        await this.readText();
        continue;
      }
      this.#uncovered = 0;
      if (!(await this.playBest(this.candidates(waiting)))) return;
    }
  }

  private candidates(waiting: WaitingFor): Candidate[] {
    const observation = this.harness.observe();
    if (waiting.kind === "walk") {
      this.#usedMoves.clear();
      return observation.mode === "overworld" ? this.walkCandidates(observation) : [];
    }
    if (waiting.kind === "choice") return choiceCriteria(waiting.options).map((criteria, i) => this.candidate(scoreOf(this.genome.choice, criteria), { name: "choose", option: waiting.options[i] }));
    if (observation.mode === "battle" && (waiting.kind === "battleAction" || waiting.kind === "battleMove")) {
      const { battle } = observation;
      return battleActions(battle, this.harness.availableActions(), this.#usedMoves).map(({ action, criteria }) =>
        this.candidate(scoreOf(this.genome.battle, criteria), action, () => {
          if (action.name === "fight") this.#usedMoves.add(moveKey(battle, action.move));
        }),
      );
    }
    return (FIXED_RULES[waiting.kind]?.(this.harness.availableActions()) ?? []).map((action) => this.candidate(0, action));
  }

  /** `played`: what the Bot remembers when the action is not impossible. */
  private candidate(score: number, action: MacroAction, played?: () => void): Candidate {
    return {
      score,
      play: async () => {
        const result = nothingPlayed(await this.harness.perform(action));
        if (!result.impossible) played?.();
        return result;
      },
    };
  }

  /** An impossible action leaves the list, and the next best plays. A tie goes to the first action of the list. False: no action is possible. */
  private async playBest(candidates: Candidate[]): Promise<boolean> {
    const left = [...candidates];
    while (left.length > 0) {
      const best = left.reduce((top, candidate, i) => (candidate.score > left[top].score ? i : top), 0);
      if (!(await left[best].play()).impossible) return true;
      left.splice(best, 1);
    }
    return false;
  }

  private walkCandidates(overworld: Overworld): Candidate[] {
    const { map, player } = overworld;
    const walked = this.#walked.get(map.name) ?? new Set();
    walked.add(cellKey(player));
    this.#walked.set(map.name, walked);
    const arrivals = this.harness.events.flatMap((e) => (e.type === "map" ? [e.map] : []));
    return walkActions(overworld, { walked: this.#walked, arrivals }).map((action) => ({ score: scoreOf(this.genome.walk, action.criteria), play: () => this.walk(action, overworld) }));
  }

  private async walk({ target }: WalkAction, overworld: Overworld): Promise<{ impossible: boolean }> {
    switch (target.kind) {
      case "cell":
        return nothingPlayed(await this.harness.goTo(target.cell.x, target.cell.y));
      case "person":
      case "sign":
        return this.talkTo(target.kind, target.cell, (now) => (target.kind === "person" ? (now.people.find((p) => p.localId === target.localId && p.loaded) ?? null) : target.cell), approaches(target, overworld), overworld);
      default:
        return this.goToFirst(approaches(target, overworld));
    }
  }

  private async goToFirst(cells: Cell[]): Promise<{ impossible: boolean; result?: ActionResult }> {
    for (const cell of cells) {
      const result = await this.harness.goTo(cell.x, cell.y);
      if (result.status !== "impossible") return { impossible: false, result };
    }
    return { impossible: true };
  }

  /** A walk next to the person or the sign, then an interaction from there. `locate` gives its cell after the walk, as a person can move. */
  private async talkTo(kind: "person" | "sign", cell: Cell, locate: (now: Overworld) => Cell | null, sides: Cell[], overworld: Overworld): Promise<{ impossible: boolean }> {
    const at = interactCell({ kind, cell }, overworld.grid, overworld.player);
    if (at) return nothingPlayed(await this.harness.interact(at.x, at.y));
    const walked = await this.goToFirst(sides);
    if (walked.result?.status !== "done" || this.harness.waitingFor().kind !== "walk") return walked;
    const now = this.harness.observe();
    const there = now.mode === "overworld" ? locate(now) : null;
    const next = now.mode === "overworld" && there && interactCell({ kind, cell: there }, now.grid, now.player);
    if (next) await this.harness.interact(next.x, next.y);
    return { impossible: false };
  }

  private async readText(): Promise<void> {
    if ((await this.harness.readText()).status !== "impossible") {
      this.#uncovered = 0;
      return;
    }
    for (let i = 0; i < B_PRESSES; i++) await this.harness.press("B");
    if (++this.#uncovered >= MAX_UNCOVERED) this.harness.end("unknown screen");
  }
}
