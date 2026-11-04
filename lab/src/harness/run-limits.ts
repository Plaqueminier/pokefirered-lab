import type { Milestone } from "../game";
import { spentIn } from "../protocol";
import type { EndReason, NoProgress } from "./harness";
import { modelTotals, type RunEvent } from "./record";

export class RunEnd extends Error {
  constructor(
    readonly reason: EndReason,
    readonly planLimit?: string,
  ) {
    super(`the Run ends: ${reason}`);
  }
}

type Limits = { goal: Milestone; lastFrame: number; noProgressLimit: number; costLimit: number; tokenLimit: number; progress: number; firstEvent: number; stopAtWhiteout: boolean };

export class RunLimits {
  #noProgress: NoProgress;
  #whitedOut = false;
  #progress: number;

  constructor(private readonly limits: Limits) {
    this.#noProgress = { stuck: 0, since: limits.firstEvent };
    this.#progress = limits.progress;
  }

  beforeFrame(frame: number): void {
    if (frame >= this.limits.lastFrame) throw new RunEnd("frame budget");
  }

  // Battle poison and field poison both white out through CB2_WhiteOut. The game is read only when the Run stops at a whiteout.
  afterFrame(whitingOut: () => boolean): void {
    if (this.limits.stopAtWhiteout && !this.#whitedOut) this.#whitedOut = whitingOut();
  }

  get noProgress(): NoProgress {
    return this.#noProgress;
  }

  atAction(milestones: Milestone[], progress: number, decisionPoint: boolean, events: number): void {
    if (milestones.includes(this.limits.goal)) throw new RunEnd("goal");
    if (this.#whitedOut) throw new RunEnd("whiteout");
    if (progress > this.#progress) this.#noProgress = { stuck: 0, since: events };
    else if (decisionPoint) this.#noProgress = { ...this.#noProgress, stuck: this.#noProgress.stuck + 1 };
    // A text of a talk changes while it is read: keep the highest count, so a lower one does not reset the count later.
    this.#progress = Math.max(this.#progress, progress);
    if (this.#noProgress.stuck >= this.limits.noProgressLimit) throw new RunEnd("no progress");
  }

  afterCall(events: readonly RunEvent[]): void {
    const totals = modelTotals(events.slice(this.limits.firstEvent));
    if (totals.cost > this.limits.costLimit) throw new RunEnd("cost limit");
    if (spentIn("tokens", totals) > this.limits.tokenLimit) throw new RunEnd("token limit");
  }
}
