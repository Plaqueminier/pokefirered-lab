import { isDecisionPoint, type WaitingFor } from "../src/game";
import { battleActions, moveKey } from "../src/genetic/battle";
import { type ChoiceCriterion, type Genome, scoreOf } from "../src/genetic/genome";
import { type WalkAction, type WalkTarget, walkActions } from "../src/genetic/walk";
import type { ActionResult, AvailableAction, Bot, Harness, MacroAction, Observation } from "../src/harness/harness";
import { type Cell, cellKey } from "../src/harness/path";
import { B_PRESSES } from "../src/model/prompt";
import { approaches, interactCell, type Overworld } from "../src/model/targets";

export const NO_PROGRESS_LIMIT = 60;
const MAX_UNCOVERED = 3;

/** `play` gives false when the Harness answers `impossible` or `blocked`: the action leaves the list. */
type Candidate = { score: number; play: () => Promise<boolean> };

// A `blocked` action that stayed in the list got the same best score at the next Decision point, so the Bot played it again until the Stuck counter ended the Run (Oak on the way in his lab).
const didPlay = (result: ActionResult) => result.status !== "impossible" && result.status !== "blocked";

export function geneticBot(weights: Partial<Genome> = {}): Bot {
  const genome: Genome = { walk: {}, choice: {}, battle: {}, ...weights };
  return { name: "genetic", version: "3", genome, noProgressLimit: NO_PROGRESS_LIMIT, play: (harness) => new GeneticPlay(harness, genome).play() };
}

const FIXED_RULES: Partial<Record<WaitingFor["kind"], (available: AvailableAction[]) => MacroAction[]>> = {
  naming: () => [{ name: "name", text: "" }],
  learnMove: () => [{ name: "keep" }],
  partyPick: (available) => available.flatMap((a) => (a.name === "send" ? [a] : [])),
  shopMenu: () => [{ name: "leave" }],
  itemPc: () => [{ name: "leave" }],
  pokemonPc: () => [{ name: "leave" }],
};

function choiceCriteria(options: string[]): Partial<Record<ChoiceCriterion, number>>[] {
  return options.map((option, i) => ({ isYes: Number(option === "YES"), isNo: Number(option === "NO"), rank: options.length === 1 ? 0 : i / (options.length - 1) }));
}

function cellNow(target: Extract<WalkTarget, { kind: "person" | "sign" }>, now: Overworld): Cell | null {
  return target.kind === "person" ? (now.people.find((p) => p.localId === target.localId && p.loaded) ?? null) : target.cell;
}

class GeneticPlay {
  readonly #walked = new Map<string, Set<string>>();
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
      const observation = this.harness.observe();
      if (waiting.kind === "walk") this.startWalk(observation);
      if (!(await this.playBest(this.candidates(waiting, observation)))) return;
    }
  }

  // A walk Decision point: the battle is over, so its moves count as unused again. The cell of the player counts as walked.
  private startWalk(observation: Observation): void {
    this.#usedMoves.clear();
    if (observation.mode !== "overworld") return;
    const { map, player } = observation;
    const walked = this.#walked.get(map.name) ?? new Set();
    walked.add(cellKey(player));
    this.#walked.set(map.name, walked);
  }

  private candidates(waiting: WaitingFor, observation: Observation): Candidate[] {
    if (waiting.kind === "walk") return observation.mode === "overworld" ? this.walkCandidates(observation) : [];
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

  private candidate(score: number, action: MacroAction, played?: () => void): Candidate {
    return {
      score,
      play: async () => {
        const done = didPlay(await this.harness.perform(action));
        if (done) played?.();
        return done;
      },
    };
  }

  // The best score plays first, and a tie keeps the order of the list. An `impossible` or `blocked` action leaves the list.
  private async playBest(candidates: Candidate[]): Promise<boolean> {
    for (const candidate of candidates.toSorted((a, b) => b.score - a.score)) if (await candidate.play()) return true;
    return false;
  }

  private walkCandidates(overworld: Overworld): Candidate[] {
    const arrivals = this.harness.events.flatMap((e) => (e.type === "map" ? [e.map] : []));
    return walkActions(overworld, { walked: this.#walked, arrivals }).map((action) => ({ score: scoreOf(this.genome.walk, action.criteria), play: () => this.walk(action, overworld) }));
  }

  private async walk({ target }: WalkAction, overworld: Overworld): Promise<boolean> {
    switch (target.kind) {
      case "cell":
        return didPlay(await this.harness.goTo(target.cell.x, target.cell.y));
      case "person":
      case "sign":
        return this.talkTo(target, overworld);
      default:
        return (await this.goToFirst(approaches(target, overworld))) !== null;
    }
  }

  private async goToFirst(cells: Cell[]): Promise<ActionResult | null> {
    for (const cell of cells) {
      const result = await this.harness.goTo(cell.x, cell.y);
      if (didPlay(result)) return result;
    }
    return null;
  }

  private async talkTo(target: Extract<WalkTarget, { kind: "person" | "sign" }>, overworld: Overworld): Promise<boolean> {
    const at = interactCell(target, overworld.grid, overworld.player);
    if (at) return didPlay(await this.harness.interact(at.x, at.y));
    const walked = await this.goToFirst(approaches(target, overworld));
    if (walked?.status !== "done" || this.harness.waitingFor().kind !== "walk") return walked !== null;
    const now = this.harness.observe();
    if (now.mode !== "overworld") return true;
    const there = cellNow(target, now);
    const next = there && interactCell({ kind: target.kind, cell: there }, now.grid, now.player);
    if (next) await this.harness.interact(next.x, next.y);
    return true;
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
