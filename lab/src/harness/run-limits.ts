import type { Milestone } from "../game";
import { type EndReason, spentIn, timeLimitFrame } from "../protocol";
import type { NoProgress } from "./harness";
import { type ModelSettings, modelTotals, type RunEvent, runWhiteouts } from "./record";

export class RunEnd extends Error {
  constructor(
    readonly reason: EndReason,
    readonly planLimit?: string,
  ) {
    super(`the Run ends: ${reason}`);
  }
}

export function afterAction(noProgress: NoProgress, progressed: boolean, decisionPoint: boolean, events: number): NoProgress {
  if (progressed) return { stuck: 0, since: events };
  return decisionPoint ? { ...noProgress, stuck: noProgress.stuck + 1 } : noProgress;
}

type ModelLimits = { costLimit: number; tokenLimit: number; whiteoutLimit: number; timeFrame: number };

// A limit that a model bot does not have never ends its Run.
export function modelLimits(model: ModelSettings | undefined): ModelLimits {
  const timeLimit = model?.timeLimit ?? null;
  return {
    costLimit: model?.costLimit ?? Number.POSITIVE_INFINITY,
    tokenLimit: model?.tokenLimit ?? Number.POSITIVE_INFINITY,
    whiteoutLimit: model?.whiteoutLimit ?? Number.POSITIVE_INFINITY,
    timeFrame: timeLimit === null ? Number.POSITIVE_INFINITY : timeLimitFrame(timeLimit),
  };
}

type Limits = ModelLimits & { goal: Milestone; lastFrame: number; noProgressLimit: number; progress: number; runStart: number };

/** `battle`: the battle in progress at the Time limit plays. `after`: that battle ended, and the Run ends at the next walk. */
type ExtraTime = "none" | "battle" | "after";

export type ActionEnd = { frame: number; decisionPoint: boolean; walk: boolean };

export class RunLimits {
  readonly #firstEvent: number;
  #noProgress: NoProgress;
  #whiteouts = 0;
  #battle = false;
  #extraTime: ExtraTime = "none";
  #progress: number;

  constructor(
    private readonly limits: Limits,
    history: readonly RunEvent[],
  ) {
    this.#firstEvent = history.length;
    this.#noProgress = { stuck: 0, since: history.length };
    this.#progress = limits.progress;
    this.afterFrame(history);
  }

  // Issue #109: the battle at the Time limit plays to its end, and the script after it can give a badge, so the Run ends at the next walk.
  beforeFrame(frame: number): void {
    if (frame >= this.limits.lastFrame) throw new RunEnd("frame budget");
    if (frame < this.limits.timeFrame) return;
    if (this.#extraTime === "none" && !this.#battle) throw new RunEnd("time limit");
    if (this.#extraTime === "none") this.#extraTime = "battle";
    if (this.#extraTime === "after" && this.#battle) throw new RunEnd("time limit");
  }

  afterFrame(events: readonly RunEvent[]): void {
    this.#whiteouts += runWhiteouts(events, this.limits.runStart);
    const battle = events.findLast((event) => event.type === "battle");
    if (battle) this.#battle = battle.state === "start";
    if (this.#extraTime === "battle" && !this.#battle) this.#extraTime = "after";
  }

  get noProgress(): NoProgress {
    return this.#noProgress;
  }

  get whiteouts(): number {
    return this.#whiteouts;
  }

  atAction(milestones: Milestone[], progress: number, events: number, { frame, decisionPoint, walk }: ActionEnd): void {
    if (milestones.includes(this.limits.goal)) throw new RunEnd("goal");
    const whitedOut = this.#whiteouts >= this.limits.whiteoutLimit;
    if (frame >= this.limits.timeFrame && !this.#battle && (this.#extraTime !== "after" || walk || whitedOut)) throw new RunEnd("time limit");
    if (whitedOut) throw new RunEnd("whiteout");
    this.#noProgress = afterAction(this.#noProgress, progress > this.#progress, decisionPoint, events);
    // A text of a talk changes while it is read: keep the highest count, so a lower one does not reset the count later.
    this.#progress = Math.max(this.#progress, progress);
    if (this.#noProgress.stuck >= this.limits.noProgressLimit) throw new RunEnd("no progress");
  }

  afterCall(events: readonly RunEvent[]): void {
    const totals = modelTotals(events.slice(this.#firstEvent));
    if (totals.cost > this.limits.costLimit) throw new RunEnd("cost limit");
    if (spentIn("tokens", totals) > this.limits.tokenLimit) throw new RunEnd("token limit");
  }
}
