import type { Player } from "./evolution";
import type { EvolveEnd, EvolveJob } from "./evolve-worker";

type Waiting = { job: EvolveJob; done: (end: EvolveEnd) => void };

/** The workers that play the Runs of an Evolution: each worker plays one Run at a time. `onRun` tells that a Run ended. */
export class EvolvePool {
  readonly #free: Worker[] = [];
  readonly #waiting: Waiting[] = [];
  readonly #playing = new Map<number, (end: EvolveEnd) => void>();
  readonly #workers: Worker[];
  #jobs = 0;

  constructor(
    size: number,
    private readonly onRun: () => void,
  ) {
    this.#workers = Array.from({ length: size }, () => {
      const worker = new Worker(new URL("./evolve-worker.ts", import.meta.url).href);
      worker.onmessage = ({ data }: MessageEvent<EvolveEnd>) => {
        this.#playing.get(data.job)?.(data);
        this.#playing.delete(data.job);
        this.#free.push(worker);
        this.#next();
      };
      return worker;
    });
    this.#free.push(...this.#workers);
  }

  play: Player = (genome, run) =>
    new Promise<EvolveEnd>((done) => {
      this.#waiting.push({ job: { job: ++this.#jobs, genome, ...run }, done });
      this.#next();
    }).then(({ played, error }) => {
      if (!played) throw new Error(`a Run of the Evolution did not play: ${error}`);
      if (error) console.error(`A Run stops with an error of the Bot (its Run record counts): ${error}`);
      this.onRun();
      if (played.record.header.seed !== run.seed) throw new Error(`the Run plays on the seed ${played.record.header.seed}, not on the seed ${run.seed} of the Evolution`);
      return played;
    });

  #next(): void {
    const worker = this.#free.at(-1);
    const next = this.#waiting[0];
    if (!worker || !next) return;
    this.#free.pop();
    this.#waiting.shift();
    this.#playing.set(next.job.job, next.done);
    worker.postMessage(next.job);
    this.#next();
  }

  close(): void {
    for (const worker of this.#workers) worker.terminate();
  }
}
