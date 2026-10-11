// A Macro-action runs its frames in one synchronous block: each Run plays in a worker, so the Viewer loop never stops.
import type { RunState } from "../run";
import type { HarnessOptions } from "./harness";
import type { RunEvent, RunRecord } from "./record";

// The machine runs 4 emulators at most.
export const MAX_RUNS = 4;

export type RunSpec = { bot: string } & Pick<HarnessOptions, "knowledge" | "frameBudget" | "noProgressLimit">;

export type RunEnd = { record: RunRecord | null; error: string | null };

export type RunView = { frame: number; screen: Uint8Array | null } & RunState;

export type WorkerMessage =
  | { type: "screen"; frame: number; screen: Uint8Array }
  | ({ type: "state" } & RunState)
  | { type: "events"; events: RunEvent[] }
  | ({ type: "end" } & RunEnd);

export class PoolRun {
  #end: RunEnd | null = null;
  #view: RunView = { frame: 0, screen: null, state: null, grid: null, actors: null, camera: null };
  readonly #events: RunEvent[] = [];
  readonly done: Promise<RunEnd>;

  constructor(
    readonly id: number,
    readonly spec: RunSpec,
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
    worker.postMessage(spec);
  }

  /** Null while the worker plays. */
  get end(): RunEnd | null {
    return this.#end;
  }

  get view(): RunView {
    return this.#view;
  }

  /** The events of the Run record up to the end of the last Macro-action or Raw input, and all of them at the end. */
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

  start(spec: RunSpec): PoolRun {
    if (this.full) throw new Error(`the pool plays ${this.limit} Runs at most`);
    const run = new PoolRun(this.runs.length + 1, spec);
    this.runs.push(run);
    return run;
  }
}
