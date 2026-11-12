// The Generations of an Evolution. The loop receives the player, so that it does not depend on the emulator (spec #88).
import { mkdir, readdir, rename } from "node:fs/promises";
import { basename, join } from "node:path";
import type { Milestone } from "../game";
import type { EndReason } from "../harness/harness";
import { isCurrentRecord, RUNS_DIR, type RunRecord, writeRecord } from "../harness/record";
import { RACE_VERSION, type RaceRun } from "../race/file";
import { RACE_SUFFIX, raceRun, readRace, writeRace } from "../race/make";
import { FITNESS_VERSION, type Fitness } from "./fitness";
import { GROUPS, type Genome } from "./genome";

const EVOLUTIONS_DIR =join(RUNS_DIR, "evolutions");
const EVOLUTION_FILE = "evolution.json";
// 2: the test seeds, and the tests of the best Genome.
const EVOLUTION_FORMAT = 2;
const NAME = /^[\w-]+$/;
const BESTS_RACE = "bests";

// The training seed is the seed of `gLabRngSeed` in the ROM (src/lab.c). A test seed is never a training seed. On each test seed, the scripted bot also reaches first-rival-battle.
const ROM_SEED = 0x4c41;
const TEST_SEEDS = [0x0001, 0x1234, 0xbeef];

// The settings of v1 (spec #88). The file keeps them, so that a continued Evolution keeps the settings of its start.
const SETTINGS = {
  population: 50,
  elites: 5,
  parents: 25,
  mutation: { probability: 0.2, sigma: 0.1 },
  generations: 100,
  goal: "first-rival-battle" as Milestone,
  noProgressLimit: 60,
  frameBudget: { least: 30_000, timesBest: 2 },
  /** Each `testEvery` Generations, the best Genome also plays on each test seed. */
  testEvery: 10,
};

type Settings = typeof SETTINGS;

/** `run`: what the Run of this Genome must use. The Genetic bot has no goal: the Run ends at the goal of the Evolution. */
export type Player = (genome: Genome, run: PlayerRun) => Promise<Played>;

export type PlayerRun = { seed: number; frameBudget: number; noProgressLimit: number; goal: Milestone };

export type Played = { record: RunRecord; fitness: Fitness };

/** What the Run of a Genome gives. */
type Outcome = { fitness: number; terms: Fitness["terms"]; frames: number; milestones: Milestone[]; endReason: EndReason };

/** A Genome of a Generation. `parents`: the ids of the two Genomes that gave it, none in the first Generation. An elite keeps its id and its parents. */
type Member = { id: number; parents: number[]; genome: Genome } & Outcome;

/**
 * `genomes`: from the best Fitness to the worst. `record`: the Run record of the best Genome, in the folder of the Evolution, when it is a new best.
 * `tests`: each `testEvery` Generations, the Runs of the best Genome on the test seeds.
 */
export type Generation = { number: number; frameBudget: number; genomes: Member[]; record?: string; tests?: ({ seed: number } & Outcome)[] };

/** `seed`: the seed of the random choices of the Evolution. `seeds.training`: the seed of the game for each Run. `seeds.tests`: the seeds of the tests only. */
export type Evolution = { format: number; seed: number; seeds: { training: number; tests: number[] }; bot: { name: string; version: string } | null; fitnessVersion: string; settings: Settings; generations: Generation[] };

type Born = Pick<Member, "id" | "parents" | "genome">;

type EvolveOptions = { play: Player; seed?: number; until?: number; onGeneration?: (generation: Generation, evolution: Evolution) => void };

/**
 * Plays the Generations of the Evolution in `dir`, and continues it when its file exists. `seed`: for a new Evolution only.
 * `until`: the last Generation that this call plays. The file changes after each Generation, so a stop loses at most the Generation that plays.
 */
export async function evolve(dir: string, { play, seed, until = Number.POSITIVE_INFINITY, onGeneration }: EvolveOptions): Promise<Evolution> {
  let evolution = (await readEvolution(dir)) ?? newEvolution(seed);
  if (evolution.fitnessVersion !== FITNESS_VERSION) throw new Error(`the Evolution ranks with the Fitness version ${evolution.fitnessVersion}, and the Fitness is now version ${FITNESS_VERSION}: start a new Evolution`);
  while (endOf(evolution) === null && evolution.generations.length < until) {
    const generation = await playGeneration(dir, evolution, play);
    evolution = { ...evolution, bot: evolution.bot ?? generation.bot, generations: [...evolution.generations, generation.generation] };
    await writeEvolution(dir, evolution);
    onGeneration?.(generation.generation, evolution);
  }
  return evolution;
}

/** Null while the Evolution can play a Generation. */
export function endOf({ settings, generations }: Evolution): string | null {
  const last = generations.at(-1);
  const reaches = ({ milestones }: Outcome) => milestones.includes(settings.goal);
  if (last?.tests && reaches(last.genomes[0]) && last.tests.every(reaches)) return `the best Genome of Generation ${last.number} reaches ${settings.goal} on the training seed and on the ${last.tests.length} test seeds`;
  if (generations.length >= settings.generations) return `${settings.generations} Generations`;
  return null;
}

function newEvolution(seed: number | undefined): Evolution {
  if (seed === undefined) throw new Error("a new Evolution needs the seed of its random choices");
  return { format: EVOLUTION_FORMAT, seed, seeds: { training: ROM_SEED, tests: TEST_SEEDS }, bot: null, fitnessVersion: FITNESS_VERSION, settings: SETTINGS, generations: [] };
}

async function playGeneration(dir: string, evolution: Evolution, play: Player): Promise<{ generation: Generation; bot: NonNullable<Evolution["bot"]> }> {
  const { settings, generations } = evolution;
  const last = generations.at(-1);
  const number = (last?.number ?? 0) + 1;
  const frameBudget = Math.max(settings.frameBudget.least, settings.frameBudget.timesBest * (last?.genomes[0].frames ?? 0));
  const born = last ? children(evolution, last) : firstGenomes(evolution);
  const run = { frameBudget, noProgressLimit: settings.noProgressLimit, goal: settings.goal };
  const played = await Promise.all(born.map(({ genome }) => play(genome, { ...run, seed: evolution.seeds.training })));
  const { name, version } = played[0].record.header.bot;
  for (const { record, fitness } of played) {
    if (record.header.bot.version !== (evolution.bot?.version ?? version)) throw new Error(`the Evolution plays the Genetic bot version ${evolution.bot?.version ?? version}, and this Run plays version ${record.header.bot.version}: start a new Evolution`);
    if (fitness.version !== evolution.fitnessVersion) throw new Error(`the Evolution ranks with the Fitness version ${evolution.fitnessVersion}, not ${fitness.version}`);
  }
  // A stable sort: a tie keeps the order of birth, so the Generation is always the same.
  const ranked = born.map((genome, i) => ({ genome, played: played[i] })).sort((a, b) => b.played.fitness.note - a.played.fitness.note);
  const genomes = ranked.map(({ genome, played }): Member => ({ ...genome, ...outcomeOf(played) }));
  const bestBefore = Math.max(Number.NEGATIVE_INFINITY, ...generations.map((g) => g.genomes[0].fitness));
  const best = ranked[0].played;
  const record = best.fitness.note > bestBefore ? basename(await writeRecord({ ...best.record, header: { ...best.record.header, fitness: best.fitness, genomeId: ranked[0].genome.id } }, dir)) : undefined;
  await writeRaces(dir, number, ranked.map(({ genome, played }) => ({ id: genome.id, record: played.record })));
  const tests = number % settings.testEvery === 0 ? await Promise.all(evolution.seeds.tests.map(async (seed) => ({ seed, ...outcomeOf(await play(genomes[0].genome, { ...run, seed })) }))) : undefined;
  return { generation: { number, frameBudget, genomes, ...(record === undefined ? {} : { record }), ...(tests === undefined ? {} : { tests }) }, bot: { name, version } };
}

function outcomeOf({ record, fitness }: Played): Outcome {
  return { fitness: fitness.note, terms: fitness.terms, frames: record.result.frames, milestones: record.result.milestones, endReason: record.result.endReason };
}

// The Races come from the Run records in memory: the Evolution keeps no Run record file for each Genome. `ranked`: from the best Fitness to the worst.
async function writeRaces(dir: string, number: number, ranked: { id: number; record: RunRecord }[]): Promise<void> {
  const name = basename(dir);
  // `record`: the Genome for `bun run bot genetic --genome <Evolution>:<Genome id>`, which plays the Run again.
  const runOf = ({ id, record }: (typeof ranked)[number]): RaceRun[] => (isCurrentRecord(record) && record.track.length > 0 ? [raceRun(id, `${name}:${id}`, record)] : []);
  await writeRace(`generation-${String(number).padStart(4, "0")}`, { version: RACE_VERSION, runs: ranked.flatMap(runOf).sort((a, b) => a.number - b.number) }, dir);
  // A Generation that plays again after a stop replaces its best in the Race of the bests.
  const bests = await readRace(BESTS_RACE, dir);
  const before = bests?.version === RACE_VERSION ? bests.runs.slice(0, number - 1) : [];
  await writeRace(BESTS_RACE, { version: RACE_VERSION, runs: [...before, ...runOf(ranked[0])] }, dir);
}

function firstGenomes({ seed, settings }: Evolution): Born[] {
  const random = randomOf(seed, 0);
  return Array.from({ length: settings.population }, (_, i) => ({ id: i + 1, parents: [], genome: genomeOf(() => random() * 2 - 1) }));
}

// The random choices of Generation n + 1 come from the seed and n only: a continued Evolution makes the same Generation.
function children({ seed, settings, generations }: Evolution, last: Generation): Born[] {
  const random = randomOf(seed, last.number);
  const elites = last.genomes.slice(0, settings.elites).map(({ id, parents, genome }) => ({ id, parents, genome }));
  const parents = last.genomes.slice(0, settings.parents);
  const firstId = 1 + Math.max(...generations.flatMap((g) => g.genomes.map((m) => m.id)));
  const { probability, sigma } = settings.mutation;
  const born = Array.from({ length: settings.population - elites.length }, (_, i): Born => {
    const a = Math.floor(random() * parents.length);
    const b = (a + 1 + Math.floor(random() * (parents.length - 1))) % parents.length;
    const genome = genomeOf((group, criterion) => {
      const weight = (random() < 0.5 ? parents[a] : parents[b]).genome[group][criterion as never] ?? 0;
      return random() < probability ? Math.min(1, Math.max(-1, weight + sigma * gaussian(random))) : weight;
    });
    return { id: firstId + i, parents: [parents[a].id, parents[b].id], genome };
  });
  return [...elites, ...born];
}

/** A weight for each criterion of each group: also the criteria of a newer version of the Genetic bot. */
function genomeOf(weight: (group: keyof Genome, criterion: string) => number): Genome {
  return Object.fromEntries(Object.entries(GROUPS).map(([group, criteria]) => [group, Object.fromEntries(criteria.map((criterion) => [criterion, weight(group as keyof Genome, criterion)]))])) as Genome;
}

// mulberry32: a small PRNG with a 32-bit state.
function randomOf(seed: number, generation: number): () => number {
  let state = (seed ^ Math.imul(generation + 1, 0x9e3779b9)) | 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Box-Muller: a number of a normal distribution with mean 0 and standard deviation 1.
function gaussian(random: () => number): number {
  return Math.sqrt(-2 * Math.log(1 - random())) * Math.cos(2 * Math.PI * random());
}

export function evolutionDir(name: string): string {
  if (!NAME.test(name)) throw new Error(`the name of an Evolution has only letters, digits, "-" and "_": ${name}`);
  return join(EVOLUTIONS_DIR, name);
}

export async function readEvolution(dir: string): Promise<Evolution | null> {
  const file = Bun.file(join(dir, EVOLUTION_FILE));
  if (!(await file.exists())) return null;
  const evolution: Evolution = await file.json();
  if (evolution.format !== EVOLUTION_FORMAT) throw new Error(`${join(dir, EVOLUTION_FILE)} has the format ${evolution.format}, not ${EVOLUTION_FORMAT}`);
  return evolution;
}

// A stop in the write must leave the old file whole: it is the only copy of the Generations.
async function writeEvolution(dir: string, evolution: Evolution): Promise<void> {
  await mkdir(dir, { recursive: true });
  const path = join(dir, EVOLUTION_FILE);
  await Bun.write(`${path}.tmp`, JSON.stringify(evolution));
  await rename(`${path}.tmp`, path);
}

/** The Genome with this id in any Generation of the Evolution `name`, and what its Run in the Evolution used: the same Genome and `run` give the same Run. */
export async function evolutionGenome(name: string, id: number): Promise<{ genome: Genome; run: PlayerRun }> {
  const evolution = await readEvolution(evolutionDir(name));
  if (!evolution) throw new Error(`no Evolution ${name} in runs/evolutions/`);
  // An elite plays again in each Generation, with the frame limit of that Generation: the last Generation that holds the Genome gives the Run.
  const generation = evolution.generations.findLast((g) => g.genomes.some((m) => m.id === id));
  const member = generation?.genomes.find((m) => m.id === id);
  if (!generation || !member) throw new Error(`the Evolution ${name} has no Genome ${id}`);
  const { noProgressLimit, goal } = evolution.settings;
  return { genome: member.genome, run: { seed: evolution.seeds.training, frameBudget: generation.frameBudget, noProgressLimit, goal } };
}

/** The files of all the Evolutions, as paths in the runs folder: `evolutions/<name>/<file>`. */
async function evolutionFiles(): Promise<string[]> {
  const names = await readdir(EVOLUTIONS_DIR).catch(() => []);
  const files = await Promise.all(names.map(async (name) => (await readdir(join(EVOLUTIONS_DIR, name)).catch(() => [])).map((file) => `evolutions/${name}/${file}`)));
  return files.flat();
}

export async function evolutionRecordNames(): Promise<string[]> {
  return (await evolutionFiles()).filter((path) => path.endsWith(".json") && basename(path) !== EVOLUTION_FILE);
}

/** The Races of all the Evolutions, as names without the suffix: `evolutions/<name>/<race>`. */
export async function evolutionRaceNames(): Promise<string[]> {
  return (await evolutionFiles()).filter((path) => path.endsWith(RACE_SUFFIX)).map((path) => path.slice(0, -RACE_SUFFIX.length));
}
