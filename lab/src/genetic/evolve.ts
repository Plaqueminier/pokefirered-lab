import { relative } from "node:path";
import { parseArgs } from "node:util";
import { geneticBot } from "../../bots/genetic";
import { DEFAULT_PARALLEL, MAX_PARALLEL } from "../protocol";
import { endOf, evolutionDir, evolve, type Generation, readEvolution, SETTINGS } from "./evolution";
import { type EvolveNews, STOP_EVOLUTION } from "./evolve-process";
import { EvolvePool } from "./evolve-pool";

const USAGE = `Usage: bun run evolve <name> [--parallel <1 to ${MAX_PARALLEL}>]`;

const { values, positionals } = parseArgs({ args: process.argv.slice(2), allowPositionals: true, options: { parallel: { type: "string" } } });
const parallel = values.parallel === undefined ? DEFAULT_PARALLEL : Number(values.parallel);
if (positionals.length !== 1 || !Number.isInteger(parallel) || parallel < 1 || parallel > MAX_PARALLEL) {
  console.error(USAGE);
  process.exit(1);
}
const [name] = positionals;

const tell = (news: EvolveNews) => process.send?.(news);
let stopAsked = false;
process.on("message", (message) => {
  if (message === STOP_EVOLUTION) stopAsked = true;
});

const dir = evolutionDir(name);
const before = await readEvolution(dir);
const { name: botName, version } = geneticBot();
const pool = new EvolvePool(parallel, () => tell({ kind: "run" }));
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
};
try {
  const evolution = await evolve(dir, { play: pool.play, bot: { name: botName, version }, seed, stop: () => stopAsked, onGeneration });
  const end = endOf(evolution);
  console.log(end === null ? `The Evolution ${name} stops after Generation ${evolution.generations.length}, as asked.` : `The Evolution ${name} ends: ${end}.`);
} catch (error) {
  console.error(`The Evolution ${name} stops: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
} finally {
  pool.close();
  // An open IPC channel keeps the process alive.
  process.disconnect?.();
}
