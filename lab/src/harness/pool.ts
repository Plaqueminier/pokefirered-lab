// A Macro-action runs its frames in one synchronous block: each Run plays in a worker, so the Viewer loop never stops.
import type { Genome } from "../genetic/genome";
import type { InventoryAt } from "../inventory";
import type { RunFrom } from "../protocol";
import type { RunState } from "../run";
import type { Sight } from "./atlas";
import type { Worker as BunWorker } from "bun";
import type { Checkpoint, Resume } from "./checkpoint";
import type { CallKind, HarnessOptions } from "./harness";
import type { Continuation, ModelSettings, Replay, RunEvent, RunRecord } from "./record";

// A choice: the machine plays about 12 Runs at full speed. 10 is the Viewer Run and a Grid of 9 (#72).
export const MAX_RUNS = 10;

// An idle worker uses no CPU, but a long Run keeps hundreds of MB of prompts in its events.
const MAX_IDLE_WORKERS = 4;

type RunWorker = Worker & Pick<BunWorker, "ref" | "unref">;

/** `since`: ms since the epoch, when the worker started. */
type PoolWorker = { worker: RunWorker; since: number };

/** `plays`: the worker plays this part. `idle`: it waits with its Harness for the next part. `gone`: another PoolRun has it, or it closed. */
type WorkerState = { kind: "plays"; worker: PoolWorker } | { kind: "idle"; worker: PoolWorker; key: string } | { kind: "gone" };

export type RunSpec = { bot: string; model?: ModelSettings; genome?: Genome; from?: RunFrom } & Pick<HarnessOptions, "knowledge" | "frameBudget" | "noProgressLimit">;

export type RunEnd = { record: RunRecord | null; error: string | null };

export type WorkerCommand = { type: "start" | "extend"; spec: RunSpec; stop: Int32Array } | { type: "close" };

export type RunView = { frame: number; screen: Uint8Array | null; sight: Sight } & RunState;

export type WorkerMessage =
  | { type: "screen"; frame: number; screen: Uint8Array }
  | ({ type: "state"; sight: Sight } & RunState)
  | { type: "inventory"; entries: InventoryAt[] }
  | { type: "events"; events: RunEvent[] }
  | { type: "call-start"; kind: CallKind }
  | { type: "resumed"; resume: Resume }
  | ({ type: "end"; checkpoint: Checkpoint | null } & RunEnd);

/** `since`: ms since the epoch. */
export type RunCall = { kind: CallKind; since: number };

export class PoolRun {
  #end: RunEnd | null = null;
  #view: RunView = { frame: 0, screen: null, sight: {}, state: null, grid: null, actors: null, camera: null };
  #calling: RunCall | null = null;
  // A scripted Bot gives the event loop of its worker no turn until the end of its Run, so a message cannot stop it: the worker reads this shared flag.
  readonly #stop = new Int32Array(new SharedArrayBuffer(4));
  readonly #events: RunEvent[] = [];
  readonly #inventory: InventoryAt[] = [];
  #worker: WorkerState;
  readonly #onClose: () => void;
  // The Checkpoint goes to the caller once, so the pool does not keep a savestate and an Atlas for each ended Run.
  #checkpoint: Checkpoint | null = null;
  readonly done: Promise<RunEnd>;
  readonly resumed: Promise<Resume | null>;

  constructor(
    readonly id: number,
    readonly spec: RunSpec,
    readonly continued: Continuation | null,
    from: { worker: PoolWorker; command: "start" | "extend" },
  ) {
    this.#worker = { kind: "plays", worker: from.worker };
    const { worker } = from.worker;
    const resumed = Promise.withResolvers<Resume | null>();
    const done = Promise.withResolvers<RunEnd>();
    this.resumed = resumed.promise;
    this.done = done.promise;
    // The worker stays after the end only when its end message has a Checkpoint: see playPart in worker.ts.
    const finish = (end: RunEnd, checkpoint: Checkpoint | null) => {
      if (this.#end) return;
      this.#end = end;
      this.#calling = null;
      resumed.resolve(null);
      if (checkpoint && this.#worker.kind === "plays") {
        // An idle worker does not keep the process alive.
        worker.unref();
        this.#worker = { kind: "idle", worker: this.#worker.worker, key: checkpoint.key };
        this.#checkpoint = checkpoint;
      }
      done.resolve(end);
    };
    this.#onClose = () => {
      this.#worker = { kind: "gone" };
      finish({ record: null, error: "the worker stopped before the end of the Run" }, null);
    };
    worker.addEventListener("close", this.#onClose);
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
          if (data.events.some((e) => e.type === this.#calling?.kind)) this.#calling = null;
          break;
        case "call-start":
          this.#calling = { kind: data.kind, since: Date.now() };
          break;
        case "resumed":
          resumed.resolve(data.resume);
          break;
        case "end":
          finish({ record: data.record, error: data.error }, data.checkpoint);
          break;
      }
    };
    worker.ref();
    worker.postMessage({ type: from.command, spec, stop: this.#stop } satisfies WorkerCommand);
  }

  /** The worker stays after the end of the Run, with its Harness, for the next part. */
  get idle(): boolean {
    return this.#worker.kind === "idle";
  }

  /** The key of the Run record that the idle worker ended. */
  get checkpointKey(): string | null {
    return this.#worker.kind === "idle" ? this.#worker.key : null;
  }

  /** When the idle worker loaded the code of the lab: it plays each later part with this code. */
  get idleSince(): number | null {
    return this.#worker.kind === "idle" ? this.#worker.worker.since : null;
  }

  takeCheckpoint(): Checkpoint | null {
    const checkpoint = this.#checkpoint;
    this.#checkpoint = null;
    return checkpoint;
  }

  // The close listener holds this PoolRun. `takeWorker` removes the listener, so the garbage collector can free a removed PoolRun.
  takeWorker(): PoolWorker {
    if (this.#worker.kind !== "idle") throw new Error(`Run ${this.id} has no idle worker`);
    const { worker } = this.#worker;
    worker.worker.removeEventListener("close", this.#onClose);
    this.#worker = { kind: "gone" };
    return worker;
  }

  closeWorker(): void {
    if (this.#worker.kind === "idle") this.#worker.worker.worker.postMessage({ type: "close" } satisfies WorkerCommand);
    this.#worker = { kind: "gone" };
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

  get calling(): RunCall | null {
    return this.#calling;
  }

  /** The events of the Run record up to the end of the last Macro-action, Raw input or Model call, and all of them at the end. */
  get events(): readonly RunEvent[] {
    return this.#events;
  }

  get inventory(): readonly InventoryAt[] {
    return this.#inventory;
  }
}

export type ReplayWorkerMessage = { type: "start"; record: RunRecord } | { type: "target"; frame: number } | { type: "toEnd"; record: RunRecord };

export type ReplayView = { frame: number; screen: Uint8Array | null };

export type ReplayWorkerReply = ({ type: "screen" } & ReplayView) | { type: "end"; replay: Replay } | { type: "error"; error: string };

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
      else if (data.type === "screen") this.#view = { frame: data.frame, screen: data.screen };
    };
    this.#worker.onerror = (event: ErrorEvent) => {
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
  #toEnd = 0;
  #lastId = 0;

  constructor(
    readonly limit = MAX_RUNS,
    readonly idleLimit = MAX_IDLE_WORKERS,
  ) {}

  // The oldest idle workers close first.
  #closeExtraIdle(): void {
    const idle = this.runs.filter((run) => run.idle);
    for (const run of idle.slice(0, Math.max(0, idle.length - this.idleLimit))) run.closeWorker();
  }

  get free(): number {
    return this.limit - this.runs.filter((run) => run.end === null).length - this.#replays.size - this.#toEnd;
  }

  #checkFree(count: number): void {
    if (count > this.free) throw new Error(`the pool has ${this.free} free places of ${this.limit}`);
  }

  startAll(spec: RunSpec, count: number, continued: Continuation | null = null): PoolRun[] {
    this.#checkFree(count);
    return Array.from({ length: count }, () => {
      const worker = new Worker(new URL("./worker.ts", import.meta.url).href) as RunWorker;
      return this.#add(new PoolRun(++this.#lastId, spec, continued, { worker: { worker, since: Date.now() }, command: "start" }));
    });
  }

  start(spec: RunSpec, continued: Continuation | null = null): PoolRun {
    return this.startAll(spec, 1, continued)[0];
  }

  /** The ended Run whose idle worker holds the end of this Run record. */
  idleRunFor(key: string): PoolRun | undefined {
    return this.runs.find((run) => run.checkpointKey === key);
  }

  /** The next part of an ended Run, in its idle worker: no replay and no Checkpoint file. */
  extendIn(ended: PoolRun, spec: RunSpec, continued: Continuation): PoolRun {
    this.#checkFree(1);
    return this.#add(new PoolRun(++this.#lastId, spec, continued, { worker: ended.takeWorker(), command: "extend" }));
  }

  #add(run: PoolRun): PoolRun {
    this.runs.push(run);
    void run.done.then(() => this.#closeExtraIdle());
    return run;
  }

  /** A Run that plays stays: it holds a place and writes its Run record at its end. */
  remove(run: PoolRun): void {
    if (run.end === null) return;
    run.closeWorker();
    const index = this.runs.indexOf(run);
    if (index >= 0) this.runs.splice(index, 1);
  }

  view(id: number): ReplayView | undefined {
    return this.runs.find((run) => run.id === id)?.view ?? [...this.#replays].find((replay) => replay.id === id)?.view;
  }

  async replayToEnd(record: RunRecord): Promise<Replay> {
    this.#checkFree(1);
    this.#toEnd++;
    const worker = new Worker(new URL("./replay-worker.ts", import.meta.url).href);
    try {
      return await new Promise<Replay>((resolve, reject) => {
        worker.onmessage = ({ data }: MessageEvent<ReplayWorkerReply>) => {
          if (data.type === "end") resolve(data.replay);
          if (data.type === "error") reject(new Error(data.error));
        };
        worker.onerror = (event: ErrorEvent) => reject(new Error(event.message));
        worker.postMessage({ type: "toEnd", record } satisfies ReplayWorkerMessage);
      });
    } finally {
      worker.terminate();
      this.#toEnd--;
    }
  }

  replay(record: RunRecord): PoolReplay {
    this.#checkFree(1);
    const replay = new PoolReplay(++this.#lastId, record, (stopped) => this.#replays.delete(stopped));
    this.#replays.add(replay);
    return replay;
  }
}
