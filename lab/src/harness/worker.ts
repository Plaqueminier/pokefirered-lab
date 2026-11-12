import { InventoryHistory } from "../inventory";
import { Run } from "../run";
import { SCREEN_INTERVAL_MS, STATE_INTERVAL_MS } from "../protocol";
import { Harness, loadBot } from "./harness";
import type { WorkerMessage, WorkerStart } from "./pool";
import { extendedRecord, parentRecord, type RunEvent, type RunRecord } from "./record";

declare const self: Worker;

function post(message: WorkerMessage): void {
  self.postMessage(message);
}

class ViewPoster {
  #lastScreen = Number.NEGATIVE_INFINITY;
  #lastState = Number.NEGATIVE_INFINITY;
  #events = 0;
  readonly #inventory = new InventoryHistory();
  #inventorySent = 0;

  constructor(private readonly run: Run) {}

  onFrame(harness: Harness): void {
    this.#inventory.onFrame(this.run.frame, () => this.run.game.inventory());
    const now = performance.now();
    if (now - this.#lastScreen >= SCREEN_INTERVAL_MS) this.postScreen(now);
    if (now - this.#lastState >= STATE_INTERVAL_MS) this.postState(now, harness);
  }

  // A Macro-action inserts its event before the game events of its frames: post only after it ends, or at a Model call.
  onEvents(events: readonly RunEvent[]): void {
    if (events.length > this.#events) post({ type: "events", events: events.slice(this.#events) });
    this.#events = events.length;
  }

  // Frames run faster than the posts, so the worker has not posted the last frames of a Macro-action yet.
  postNow(harness: Harness): void {
    const now = performance.now();
    this.postScreen(now);
    this.postState(now, harness);
  }

  postFinal(harness: Harness): void {
    this.postNow(harness);
    this.onEvents(harness.events);
  }

  private postScreen(now: number): void {
    this.#lastScreen = now;
    post({ type: "screen", frame: this.run.frame, screen: this.run.core.screen().slice() });
  }

  private postState(now: number, harness: Harness): void {
    this.#lastState = now;
    post({ type: "state", ...this.run.readState(), sight: harness.sight() });
    const { entries } = this.#inventory;
    if (entries.length > this.#inventorySent) post({ type: "inventory", entries: entries.slice(this.#inventorySent) });
    this.#inventorySent = entries.length;
  }
}

self.onmessage = async ({ data: { spec, stop } }: MessageEvent<WorkerStart>) => {
  let opened: { harness: Harness; poster: ViewPoster } | null = null;
  let earlier: { record: RunRecord; events: number } | null = null;
  let error: string | null = null;
  try {
    const { bot: name, model, genome, from, ...options } = spec;
    const bot = await loadBot(name, model, genome);
    const parent = from && (await parentRecord(from.record));
    const run = await Run.open({ names: parent?.record.header.names, seed: parent?.record.header.seed });
    const poster = new ViewPoster(run);
    const harness = await Harness.open(
      {
        ...options,
        parent,
        stopAsked: () => Atomics.load(stop, 0) === 1,
        onFrame: (h) => poster.onFrame(h),
        onAction: (_, h) => poster.onEvents(h.events),
        onCallStart: (kind, h) => {
          poster.postNow(h);
          post({ type: "call-start", kind });
        },
        onModelCall: (_, h) => poster.onEvents(h.events),
        onSummaryCall: (_, h) => poster.onEvents(h.events),
      },
      run,
    );
    opened = { harness, poster };
    if (parent && from?.kind === "extended") earlier = { record: parent.record, events: harness.events.length };
    // The replay of a parent Run runs no Macro-action: post its events and its last screen now.
    poster.postNow(harness);
    poster.onEvents(harness.events);
    await harness.play(bot);
  } catch (e) {
    error = String(e);
  }
  opened?.poster.postFinal(opened.harness);
  const played = opened?.harness.record() ?? null;
  post({ type: "end", record: played && earlier ? extendedRecord(played, earlier.record, earlier.events) : played, error });
  opened?.harness.close();
  process.exit(0);
};
