import { LAST_MILESTONE } from "../game";
import { InventoryHistory, type InventorySnapshot } from "../inventory";
import { Run } from "../run";
import { SCREEN_INTERVAL_MS, STATE_INTERVAL_MS } from "../protocol";
import { type Checkpoint, checkpointOf, readCheckpoint } from "./checkpoint";
import { type Bot, Harness, loadBot } from "./harness";
import type { RunSpec, WorkerCommand, WorkerMessage } from "./pool";
import { extendedRecord, parentRecord, type RunEvent, type RunRecord } from "./record";

declare const self: Worker;

function post(message: WorkerMessage): void {
  self.postMessage(message);
}

class ViewPoster {
  #lastScreen = Number.NEGATIVE_INFINITY;
  #lastState = Number.NEGATIVE_INFINITY;
  #events = 0;
  #inventory = new InventoryHistory();
  #inventorySent = 0;

  constructor(private readonly run: Run) {}

  get inventory(): InventorySnapshot {
    return this.#inventory.snapshot();
  }

  restoreInventory(snapshot: InventorySnapshot): void {
    this.#inventory = InventoryHistory.restored(snapshot);
  }

  restart(): void {
    this.#events = 0;
    this.#inventorySent = 0;
  }

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

type Idle = { harness: Harness; poster: ViewPoster; record: RunRecord };

let idle: Idle | null = null;
// Each part of the Run has its own PoolRun, with its own stop flag: the Harness reads the flag of the part that plays.
const stop: { flag: Int32Array } = { flag: new Int32Array(new SharedArrayBuffer(4)) };

async function start({ bot: name, model, genome, from, ...options }: RunSpec): Promise<void> {
  const bot = await loadBot(name, model, genome);
  const parent = from && (await parentRecord(from.record));
  const read = (from && (await readCheckpoint(from.record))) ?? undefined;
  const run = await Run.open({ names: parent?.record.header.names, seed: parent?.record.header.seed });
  const poster = new ViewPoster(run);
  const harness = await Harness.open(
    {
      ...options,
      ...(from?.kind === "extended" ? { goal: LAST_MILESTONE } : {}),
      parent,
      checkpoint: read,
      stopAsked: () => Atomics.load(stop.flag, 0) === 1,
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
  if (harness.resumed?.from === "checkpoint" && read && "checkpoint" in read) poster.restoreInventory(read.checkpoint.inventory);
  const earlier = parent && from?.kind === "extended" ? { record: parent.record, events: harness.events.length } : null;
  await playPart(harness, poster, bot, earlier);
}

async function extend({ bot: name, model, genome }: RunSpec): Promise<void> {
  if (!idle) throw new Error("the worker has no Run to continue");
  const { harness, poster, record } = idle;
  idle = null;
  const bot = await loadBot(name, model, genome);
  poster.restart();
  harness.nextPart();
  await playPart(harness, poster, bot, { record, events: record.events.length });
}

function checkpointAtEnd(record: RunRecord, harness: Harness, poster: ViewPoster): Checkpoint | null {
  try {
    return checkpointOf(record, harness.checkpoint(), poster.inventory);
  } catch (e) {
    console.error(`no Checkpoint at the end of the Run: ${e}`);
    return null;
  }
}

async function playPart(harness: Harness, poster: ViewPoster, bot: Bot, earlier: { record: RunRecord; events: number } | null): Promise<void> {
  const { resumed } = harness;
  if (resumed) post({ type: "resumed", resume: resumed });
  // The replay of a parent Run runs no Macro-action: post its events and its last screen now.
  poster.postNow(harness);
  poster.onEvents(harness.events);
  let error: string | null = null;
  try {
    await harness.play(bot);
  } catch (e) {
    error = String(e);
  }
  poster.postFinal(harness);
  const played = harness.record();
  const record = earlier ? extendedRecord(played, earlier.record, earlier.events) : played;
  const checkpoint = error === null ? checkpointAtEnd(record, harness, poster) : null;
  post({ type: "end", record, error, checkpoint });
  if (checkpoint) idle = { harness, poster, record };
  else harness.close();
}

self.onmessage = async ({ data }: MessageEvent<WorkerCommand>) => {
  if (data.type === "close") {
    idle?.harness.close();
    process.exit(0);
  }
  stop.flag = data.stop;
  try {
    await (data.type === "start" ? start(data.spec) : extend(data.spec));
  } catch (e) {
    post({ type: "end", record: null, error: String(e), checkpoint: null });
  }
  if (!idle) process.exit(0);
};
