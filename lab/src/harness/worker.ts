import { Run } from "../run";
import { SCREEN_INTERVAL_MS, STATE_INTERVAL_MS } from "../protocol";
import { Harness, loadBot } from "./harness";
import type { RunSpec, WorkerMessage } from "./pool";
import type { RunEvent } from "./record";

declare const self: Worker;

function post(message: WorkerMessage): void {
  self.postMessage(message);
}

class ViewPoster {
  #lastScreen = Number.NEGATIVE_INFINITY;
  #lastState = Number.NEGATIVE_INFINITY;
  #events = 0;

  constructor(private readonly run: Run) {}

  onFrame(): void {
    const now = performance.now();
    if (now - this.#lastScreen >= SCREEN_INTERVAL_MS) this.postScreen(now);
    if (now - this.#lastState >= STATE_INTERVAL_MS) this.postState(now);
  }

  // A Macro-action inserts its event before the game events of its frames: post only after it ends.
  onEvents(events: readonly RunEvent[]): void {
    if (events.length > this.#events) post({ type: "events", events: events.slice(this.#events) });
    this.#events = events.length;
  }

  postFinal(events: readonly RunEvent[]): void {
    const now = performance.now();
    this.postScreen(now);
    this.postState(now);
    this.onEvents(events);
  }

  private postScreen(now: number): void {
    this.#lastScreen = now;
    post({ type: "screen", frame: this.run.frame, screen: this.run.core.screen().slice() });
  }

  private postState(now: number): void {
    this.#lastState = now;
    post({ type: "state", ...this.run.readState() });
  }
}

self.onmessage = async ({ data: spec }: MessageEvent<RunSpec>) => {
  let opened: { harness: Harness; poster: ViewPoster } | null = null;
  let error: string | null = null;
  try {
    const bot = await loadBot(spec.bot);
    const run = await Run.open();
    const poster = new ViewPoster(run);
    const harness = await Harness.open({ ...spec, onFrame: () => poster.onFrame(), onAction: (_, h) => poster.onEvents(h.events) }, run);
    opened = { harness, poster };
    await harness.play(bot);
  } catch (e) {
    error = String(e);
  }
  opened?.poster.postFinal(opened.harness.events);
  post({ type: "end", record: opened?.harness.record() ?? null, error });
  opened?.harness.close();
  process.exit(0);
};
