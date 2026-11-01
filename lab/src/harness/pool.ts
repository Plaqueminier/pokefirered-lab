// A Macro-action runs its frames in one synchronous block: each Run plays in a worker, so the Viewer loop never stops.
import type { InventoryAt } from "../inventory";
import type { RunState } from "../run";
import type { Sight } from "./atlas";
import type { HarnessOptions } from "./harness";
import type { Continuation, ModelSettings, RunEvent, RunRecord } from "./record";

// A choice: the machine plays about 12 Runs at full speed. 10 is the Viewer Run and a Grid of 9 (#72).
export const MAX_RUNS = 10;

/** `parent`: the Run record in lab/runs/ that the Run continues. */
export type RunSpec = { bot: string; model?: ModelSettings; parent?: string } & Pick<HarnessOptions, "knowledge" | "frameBudget" | "noProgressLimit">;

export type RunEnd = { record: RunRecord | null; error: string | null };

export type WorkerStart = { spec: RunSpec; stop: Int32Array };

export type RunView = { frame: number; screen: Uint8Array | null; sight: Sight } & RunState;

export type WorkerMessage =
  | { type: "screen"; frame: number; screen: Uint8Array }
  | ({ type: "state"; sight: Sight } & RunState)
  | { type: "inventory"; entries: InventoryAt[] }
  | { type: "events"; events: RunEvent[] }
  | { type: "model-call-start" }
  | ({ type: "end" } & RunEnd);

export class PoolRun {
  #end: RunEnd | null = null;
  #view: RunView = { frame: 0, screen: null, sight: {}, state: null, grid: null, actors: null, camera: null };
  #modelCallsStarted = 0;
  // A scripted Bot gives the event loop of its worker no turn until the end of its Run, so a message cannot stop it: the worker reads this shared flag.
  readonly #stop = new Int32Array(new SharedArrayBuffer(4));
  readonly #events: RunEvent[] = [];
  readonly #inventory: InventoryAt[] = [];
  readonly done: Promise<RunEnd>;

  constructor(
    readonly id: number,
    readonly spec: RunSpec,
    readonly continued: Continuation | null = null,
  ) {
    const worker = new Worker(new URL("./worker.ts", import.meta.url).href);
    let end: RunEnd = { record: null, error: "the worker stopped before the end of the Run" };
    worker.onmessage = ({ data }: MessageEvent<WorkerMessage>) => {
      switch (data.type) {
        case "screen":
          this.#view = { ...this.#view, frame: data.frame, screen: data.screen };
          break;
        case "state": {
          const { type, ...state } = data;
          this.#view = { ...this.#view, ...state };
          break;
        }
        case "inventory":
          this.#inventory.push(...data.entries);
          break;
        case "events":
          this.#events.push(...data.events);
          break;
        case "model-call-start":
          this.#modelCallsStarted++;
          break;
        case "end":
          end = { record: data.record, error: data.error };
          break;
      }
    };
    this.done = new Promise((resolve) => {
      worker.addEventListener("close", () => {
        this.#end = end;
        resolve(end);
      });
    });
    worker.postMessage({ spec, stop: this.#stop } satisfies WorkerStart);
  }

  stop(): void {
    Atomics.store(this.#stop, 0, 1);
  }

  get stopAsked(): boolean {
    return Atomics.load(this.#stop, 0) === 1;
  }

  /** Null while the worker plays. */
  get end(): RunEnd | null {
    return this.#end;
  }

  get view(): RunView {
    return this.#view;
  }

  /** A Model call runs while its model event is not in `events`. */
  get modelCallsStarted(): number {
    return this.#modelCallsStarted;
  }

  /** The events of the Run record up to the end of the last Macro-action, Raw input or Model call, and all of them at the end. */
  get events(): readonly RunEvent[] {
    return this.#events;
  }

  get inventory(): readonly InventoryAt[] {
    return this.#inventory;
  }
}

export type ReplayWorkerMessage = { type: "start"; record: RunRecord } | { type: "target"; frame: number };

export type ReplayView = { frame: number; screen: Uint8Array | null };

export type ReplayWorkerReply = ({ type: "screen" } & ReplayView) | { type: "error"; error: string };

export class PoolReplay {
  #view: ReplayView = { frame: 0, screen: null };
  #error: string | null = null;
  #target = 0;
  readonly #worker = new Worker(new URL("./replay-worker.ts", import.meta.url).href);

  constructor(
    readonly id: number,
    readonly record: RunRecord,
    private readonly onStop: (replay: PoolReplay) => void,
  ) {
    this.#worker.onmessage = ({ data }: MessageEvent<ReplayWorkerReply>) => {
      if (data.type === "error") this.#error = data.error;
      else this.#view = { frame: data.frame, screen: data.screen };
    };
    this.#worker.onerror = (event) => {
      this.#error = event.message;
    };
    this.#post({ type: "start", record });
  }

  #post(message: ReplayWorkerMessage): void {
    this.#worker.postMessage(message);
  }

  seek(frame: number): void {
    if (frame === this.#target) return;
    this.#target = frame;
    this.#post({ type: "target", frame });
  }

  get view(): ReplayView {
    return this.#view;
  }

  get error(): string | null {
    return this.#error;
  }

  stop(): void {
    this.#worker.terminate();
    this.onStop(this);
  }
}

export class RunPool {
  readonly runs: PoolRun[] = [];
  readonly #replays = new Set<PoolReplay>();
  #lastId = 0;

  constructor(readonly limit = MAX_RUNS) {}

  get free(): number {
    return this.limit - this.runs.filter((run) => run.end === null).length - this.#replays.size;
  }

  #checkFree(count: number): void {
    if (count > this.free) throw new Error(`the pool has ${this.free} free places of ${this.limit}`);
  }

  startAll(spec: RunSpec, count: number, continued: Continuation | null = null): PoolRun[] {
    this.#checkFree(count);
    return Array.from({ length: count }, () => {
      const run = new PoolRun(++this.#lastId, spec, continued);
      this.runs.push(run);
      return run;
    });
  }

  start(spec: RunSpec, continued: Continuation | null = null): PoolRun {
    return this.startAll(spec, 1, continued)[0];
  }

  view(id: number): ReplayView | undefined {
    return this.runs.find((run) => run.id === id)?.view ?? [...this.#replays].find((replay) => replay.id === id)?.view;
  }

  replay(record: RunRecord): PoolReplay {
    this.#checkFree(1);
    const replay = new PoolReplay(++this.#lastId, record, (stopped) => this.#replays.delete(stopped));
    this.#replays.add(replay);
    return replay;
  }
}
