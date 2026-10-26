// A Macro-action runs its frames in one synchronous block: each Run plays in a worker, so the Viewer loop never stops.
import type { RunState } from "../run";
import type { Sight } from "./atlas";
import type { HarnessOptions } from "./harness";
import type { Continuation, ModelSettings, RunEvent, RunRecord } from "./record";

// A choice, not a limit of the machine: it plays about 12 Runs at full speed.
export const MAX_RUNS = 4;

/** `parent`: the Run record in lab/runs/ that the Run continues. */
export type RunSpec = { bot: string; model?: ModelSettings; parent?: string } & Pick<HarnessOptions, "knowledge" | "frameBudget" | "noProgressLimit">;

export type RunEnd = { record: RunRecord | null; error: string | null };

export type WorkerStart = { spec: RunSpec; stop: Int32Array };

export type RunView = { frame: number; screen: Uint8Array | null; sight: Sight } & RunState;

export type WorkerMessage =
  | { type: "screen"; frame: number; screen: Uint8Array }
  | ({ type: "state"; sight: Sight } & RunState)
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
}

export class RunPool {
  readonly runs: PoolRun[] = [];

  constructor(readonly limit = MAX_RUNS) {}

  /** A Run keeps its place until its worker stops, after the end of the Run. */
  get full(): boolean {
    return this.runs.filter((run) => run.end === null).length >= this.limit;
  }

  start(spec: RunSpec, continued: Continuation | null = null): PoolRun {
    if (this.full) throw new Error(`the pool plays ${this.limit} Runs at most`);
    const run = new PoolRun(this.runs.length + 1, spec, continued);
    this.runs.push(run);
    return run;
  }
}
