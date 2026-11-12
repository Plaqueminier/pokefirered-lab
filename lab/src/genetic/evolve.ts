// `bun run evolve <name>`: starts the Evolution of that name, or continues it from its file.
import { relative } from "node:path";
import { parseArgs } from "node:util";
import { geneticBot } from "../../bots/genetic";
import { endOf, evolutionDir, evolve, type Generation, type Player, readEvolution, SETTINGS } from "./evolution";
import { type EvolveNews, STOP_EVOLUTION } from "./evolve-process";
import type { EvolveEnd, EvolveJob } from "./evolve-worker";

const USAGE = "Usage: bun run evolve <name> [--parallel <1 to 18>]";
// The spec (#88): 12 Runs at the same time by default, 18 at most. They play out of the 10 emulators of the Viewer.
const PARALLEL = 12;
const MAX_PARALLEL = 18;

const { values, positionals } = parseArgs({ args: process.argv.slice(2), allowPositionals: true, options: { parallel: { type: "string" } } });
const parallel = values.parallel === undefined ? PARALLEL : Number(values.parallel);
if (positionals.length !== 1 || !Number.isInteger(parallel) || parallel < 1 || parallel > MAX_PARALLEL) {
  console.error(USAGE);
  process.exit(1);
}
const [name] = positionals;

// Started from the page of the Evolutions: the Viewer server gets the news over IPC, and can ask for a stop.
const tell = (news: EvolveNews) => process.send?.(news);
let stopAsked = false;
process.on("message", (message) => {
  if (message === STOP_EVOLUTION) stopAsked = true;
});

/** Each worker plays one Run at a time; the Runs wait in a queue for a free worker. */
class EvolvePool {
  readonly #free: Worker[] = [];
  readonly #waiting: { job: EvolveJob; done: (end: EvolveEnd) => void }[] = [];
  readonly #playing = new Map<number, (end: EvolveEnd) => void>();
  readonly #workers: Worker[];
  #jobs = 0;

  constructor(size: number) {
    this.#workers = Array.from({ length: size }, () => {
      const worker = new Worker(new URL("./evolve-worker.ts", import.meta.url).href);
      worker.onmessage = ({ data }: MessageEvent<EvolveEnd>) => {
        this.#playing.get(data.job)?.(data);
        this.#playing.delete(data.job);
        this.#free.push(worker);
        this.next();
      };
      return worker;
    });
    this.#free.push(...this.#workers);
  }

  play: Player = (genome, { seed, frameBudget, noProgressLimit, goal }) =>
    new Promise<EvolveEnd>((done) => {
      this.#waiting.push({ job: { job: ++this.#jobs, genome, seed, frameBudget, noProgressLimit, goal }, done });
      this.next();
    }).then(({ played, error }) => {
      if (!played) throw new Error(`a Run of the Evolution did not play: ${error}`);
      if (error) console.error(`A Run stops with an error of the Bot (its Run record counts): ${error}`);
      tell({ kind: "run" });
      if (played.record.header.seed !== seed) throw new Error(`the Run plays on the seed ${played.record.header.seed}, not on the seed ${seed} of the Evolution`);
      return played;
    });

  private next(): void {
    while (this.#free.length > 0 && this.#waiting.length > 0) {
      const worker = this.#free.pop() as Worker;
      const { job, done } = this.#waiting.shift() as { job: EvolveJob; done: (end: EvolveEnd) => void };
      this.#playing.set(job.job, done);
      worker.postMessage(job);
    }
  }

  close(): void {
    for (const worker of this.#workers) worker.terminate();
  }
}

const dir = evolutionDir(name);
const before = await readEvolution(dir);
// The Evolution also refuses it after the first Generation that plays: this check saves the time of that Generation.
const { version } = geneticBot();
if (before?.bot && before.bot.version !== version) {
  console.error(`The Evolution ${name} plays the Genetic bot version ${before.bot.version}, and the Genetic bot is now version ${version}: start a new Evolution.`);
  process.exit(1);
}
const pool = new EvolvePool(parallel);
const seed = before ? undefined : crypto.getRandomValues(new Uint32Array(1))[0];
console.log(before ? `The Evolution ${name} continues after Generation ${before.generations.length}, in ${relative(process.cwd(), dir)}` : `A new Evolution ${name}, seed ${seed}, in ${relative(process.cwd(), dir)}`);
console.log(`${parallel} Runs at the same time`);
tell({ kind: "start", generation: (before?.generations.length ?? 0) + 1, population: (before?.settings ?? SETTINGS).population });
let start = performance.now();
const onGeneration = ({ number, frameBudget, genomes, record, tests }: Generation) => {
  const seconds = (performance.now() - start) / 1000;
  start = performance.now();
  const [best] = genomes;
  const mean = genomes.reduce((sum, g) => sum + g.fitness, 0) / genomes.length;
  const milestones = best.milestones.join(", ") || "no Milestone";
  const newBest = record === undefined ? "" : `, new best: Run record ${relative(process.cwd(), `${dir}/${record}`)}`;
  console.log(`Generation ${number}: best Fitness ${best.fitness.toFixed(2)} (Genome ${best.id}, ${best.frames} frames, ${best.endReason}, ${milestones}), mean ${mean.toFixed(2)}, frame limit ${frameBudget}, ${seconds.toFixed(1)} s${newBest}`);
  for (const test of tests ?? []) console.log(`  Test of Genome ${best.id} on the seed 0x${test.seed.toString(16)}: Fitness ${test.fitness.toFixed(2)}, ${test.frames} frames, ${test.endReason}, ${test.milestones.join(", ") || "no Milestone"}`);
  tell({ kind: "generation", number, seconds });
  // The file holds this Generation: the next one has played nothing yet.
  if (stopAsked) {
    console.log(`The Evolution ${name} stops after Generation ${number}, as asked.`);
    pool.close();
    process.exit(0);
  }
};
try {
  const evolution = await evolve(dir, { play: pool.play, seed, onGeneration });
  console.log(`The Evolution ${name} ends: ${endOf(evolution)}.`);
} catch (error) {
  console.error(`The Evolution ${name} stops: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
} finally {
  pool.close();
  // An open IPC channel keeps the process alive.
  process.disconnect?.();
}
