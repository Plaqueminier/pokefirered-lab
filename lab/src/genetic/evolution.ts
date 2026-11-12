import { mkdir, readdir, rename } from "node:fs/promises";
import { basename, join } from "node:path";
import type { Milestone } from "../game";
import type { EndReason } from "../harness/harness";
import { isCurrentRecord, RUNS_DIR, type RunRecord, withGenome, writeRecord } from "../harness/record";
import { BESTS_RACE, evolutionPath, generationRace, PLAIN_NAME } from "../protocol";
import { RACE_VERSION, type RaceRun } from "../race/file";
import { RACE_SUFFIX, raceRun, readRace, writeRace } from "../race/make";
import { NO_PROGRESS_LIMIT } from "../../bots/genetic";
import { FITNESS_VERSION, type Fitness } from "./fitness";
import { type Genome, genomeOf, weightOf } from "./genome";

const EVOLUTIONS_DIR = join(RUNS_DIR, "evolutions");
const EVOLUTION_FILE = "evolution.json";
const EVOLUTION_FORMAT = 3;

// The value of gLabRngSeed in the ROM. A test seed must never equal it.
const ROM_SEED = 0x4c41;
const TEST_SEEDS = [0x0001, 0x1234, 0xbeef];

export const SETTINGS = {
  population: 50,
  elites: 5,
  parents: 25,
  // The children of a Generation, in this order. A low mutation tunes the best Genomes; a high mutation leaves a local optimum.
  mutations: [
    { children: 20, probability: 0.2, sigma: 0.1 },
    { children: 25, probability: 0.4, sigma: 0.3 },
  ],
  noProgressLimit: NO_PROGRESS_LIMIT,
  frameBudget: { least: 30_000, timesBest: 2 },
  testEvery: 10,
};

type Settings = typeof SETTINGS;

export type Player = (genome: Genome, run: PlayerRun) => Promise<Played>;

export type PlayerRun = { seed: number; frameBudget: number; noProgressLimit: number };

export type Played = { record: RunRecord; fitness: Fitness };

type Outcome = { fitness: number; terms: Fitness["terms"]; frames: number; milestones: Milestone[]; endReason: EndReason };

type Member = { id: number; parents: number[]; genome: Genome } & Outcome;

export type Generation = { number: number; frameBudget: number; genomes: Member[]; record?: string; tests?: ({ seed: number } & Outcome)[] };

type BotFacts = { name: string; version: string };

/** `from`: the Evolution whose last Generation gives Generation 1. */
export type Evolution = { format: number; seed: number; seeds: { training: number; tests: number[] }; bot: BotFacts; fitnessVersion: string; settings: Settings; from?: { evolution: string; generation: number }; generations: Generation[] };

type Born = Pick<Member, "id" | "parents" | "genome">;

/** Generation 1 of an Evolution that starts from another, and the frames of the best Genome of the Generation before it. */
type Start = { from: NonNullable<Evolution["from"]>; genomes: Born[]; bestFrames: number };

/** `bot`: the Genetic bot that plays. `from`: the folder of another Evolution, for a new Evolution only. `until`: the number of Generations of a test. `stop`: when it gives true, the Evolution ends after the Generation that plays. */
type EvolveOptions = { play: Player; bot: BotFacts; seed?: number; from?: string; until?: number; stop?: () => boolean; onGeneration?: (generation: Generation, evolution: Evolution) => void };

// An Evolution has no end: it plays until it is stopped.
export async function evolve(dir: string, { play, bot, seed, from, until = Number.POSITIVE_INFINITY, stop, onGeneration }: EvolveOptions): Promise<Evolution> {
  const earlier = await readEvolution(dir);
  if (earlier && from !== undefined) throw new Error(`the Evolution ${basename(dir)} exists: it continues from its file, and only a new Evolution starts from another`);
  const problem = earlier && problemOf(earlier, bot);
  if (problem) throw new Error(problem);
  const start = from === undefined ? undefined : await startFrom(from, SETTINGS.population);
  let evolution = earlier ?? newEvolution(seed, bot, start?.from);
  while (evolution.generations.length < until && !stop?.()) {
    const generation = await playGeneration(dir, evolution, play, start);
    evolution = { ...evolution, generations: [...evolution.generations, generation] };
    await writeEvolution(dir, evolution);
    onGeneration?.(generation, evolution);
  }
  return evolution;
}

function formatProblem({ format }: Evolution): string | null {
  return format === EVOLUTION_FORMAT ? null : `its file has the format ${format}, not ${EVOLUTION_FORMAT}`;
}

/** Why this Evolution cannot continue with this Genetic bot: its file format, its Fitness version, or the version of the Bot. */
function problemOf(evolution: Evolution, bot: BotFacts): string | null {
  const format = formatProblem(evolution);
  if (format) return format;
  if (evolution.fitnessVersion !== FITNESS_VERSION) return `it ranks with the Fitness version ${evolution.fitnessVersion}, and the Fitness is now version ${FITNESS_VERSION}: start a new Evolution`;
  if (evolution.bot.version !== bot.version) return `it plays the Genetic bot version ${evolution.bot.version}, and the Genetic bot is now version ${bot.version}: start a new Evolution`;
  return null;
}

function newEvolution(seed: number | undefined, { name, version }: BotFacts, from: Evolution["from"]): Evolution {
  if (seed === undefined) throw new Error("a new Evolution needs the seed of its random choices");
  return { format: EVOLUTION_FORMAT, seed, seeds: { training: ROM_SEED, tests: TEST_SEEDS }, bot: { name, version }, fitnessVersion: FITNESS_VERSION, settings: SETTINGS, ...(from ? { from } : {}), generations: [] };
}

/** The weights of the last Generation of the Evolution of `dir`, in its rank order, with the ids 1, 2… and no parents. A file of any format holds them. */
async function startFrom(dir: string, population: number): Promise<Start> {
  const evolution = basename(dir);
  const last = (await readEvolution(dir))?.generations.at(-1);
  if (!last) throw new Error(`no Evolution ${evolution} to start from in runs/evolutions/`);
  if (last.genomes.length < population) throw new Error(`the last Generation of the Evolution ${evolution} has ${last.genomes.length} Genomes, not ${population}`);
  const genomes = last.genomes.slice(0, population).map((member, i): Born => ({ id: i + 1, parents: [], genome: genomeOf((group, criterion) => weightOf(member.genome, group, criterion)) }));
  return { from: { evolution, generation: last.number }, genomes, bestFrames: last.genomes[0].frames };
}

async function playGeneration(dir: string, evolution: Evolution, play: Player, start: Start | undefined): Promise<Generation> {
  const { settings, generations } = evolution;
  const last = generations.at(-1);
  const number = (last?.number ?? 0) + 1;
  // Generation 1 of an Evolution from another has the frame limit of a Generation after the last Generation of the other.
  const bestFrames = last ? last.genomes[0].frames : (start?.bestFrames ?? 0);
  const frameBudget = Math.max(settings.frameBudget.least, settings.frameBudget.timesBest * bestFrames);
  const born = last ? children(evolution, last) : (start?.genomes ?? firstGenomes(evolution));
  const run = { frameBudget, noProgressLimit: settings.noProgressLimit };
  const played = await Promise.all(born.map(({ genome }) => play(genome, { ...run, seed: evolution.seeds.training })));
  for (const { record, fitness } of played) {
    if (record.header.bot.version !== evolution.bot.version) throw new Error(`the Evolution plays the Genetic bot version ${evolution.bot.version}, and this Run plays version ${record.header.bot.version}: start a new Evolution`);
    if (fitness.version !== evolution.fitnessVersion) throw new Error(`the Evolution ranks with the Fitness version ${evolution.fitnessVersion}, not ${fitness.version}`);
  }
  // A stable sort: a tie keeps the order of birth, so the Generation is always the same.
  const ranked = born.map((genome, i) => ({ genome, played: played[i] })).sort((a, b) => b.played.fitness.note - a.played.fitness.note);
  const genomes = ranked.map(({ genome, played }): Member => ({ ...genome, ...outcomeOf(played) }));
  const bestBefore = Math.max(Number.NEGATIVE_INFINITY, ...generations.map((g) => g.genomes[0].fitness));
  const best = ranked[0].played;
  const record = best.fitness.note > bestBefore ? basename(await writeRecord(withGenome(best.record, ranked[0].genome.id, best.fitness), dir)) : undefined;
  await writeRaces(dir, number, ranked.map(({ genome, played }) => ({ id: genome.id, record: played.record })));
  const tests = number % settings.testEvery === 0 ? await Promise.all(evolution.seeds.tests.map(async (seed) => ({ seed, ...outcomeOf(await play(genomes[0].genome, { ...run, seed })) }))) : undefined;
  return { number, frameBudget, genomes, ...(record === undefined ? {} : { record }), ...(tests === undefined ? {} : { tests }) };
}

function outcomeOf({ record, fitness }: Played): Outcome {
  return { fitness: fitness.note, terms: fitness.terms, frames: record.result.frames, milestones: record.result.milestones, endReason: record.result.endReason };
}

async function writeRaces(dir: string, number: number, ranked: { id: number; record: RunRecord }[]): Promise<void> {
  const name = basename(dir);
  const runOf = ({ id, record }: (typeof ranked)[number]): RaceRun[] => (isCurrentRecord(record) && record.track.length > 0 ? [raceRun(id, `${name}:${id}`, record)] : []);
  await writeRace(generationRace(number), { version: RACE_VERSION, runs: ranked.flatMap(runOf).sort((a, b) => a.number - b.number) }, dir);
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
  const mutations = settings.mutations.flatMap(({ children, ...mutation }) => Array.from({ length: children }, () => mutation));
  if (elites.length + mutations.length !== settings.population) throw new Error(`the elites and the children of the mutations make ${elites.length + mutations.length} Genomes, not ${settings.population}`);
  const born = mutations.map(({ probability, sigma }, i): Born => {
    const a = Math.floor(random() * parents.length);
    const b = (a + 1 + Math.floor(random() * (parents.length - 1))) % parents.length;
    const genome = genomeOf((group, criterion) => {
      const weight = weightOf((random() < 0.5 ? parents[a] : parents[b]).genome, group, criterion);
      return random() < probability ? Math.min(1, Math.max(-1, weight + sigma * gaussian(random))) : weight;
    });
    return { id: firstId + i, parents: [parents[a].id, parents[b].id], genome };
  });
  return [...elites, ...born];
}

function randomOf(seed: number, generation: number): () => number {
  let state = (seed ^ Math.imul(generation + 1, 0x9e3779b9)) | 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function gaussian(random: () => number): number {
  return Math.sqrt(-2 * Math.log(1 - random())) * Math.cos(2 * Math.PI * random());
}

export function evolutionDir(name: string): string {
  if (!PLAIN_NAME.test(name)) throw new Error(`the name of an Evolution has only letters, digits, "-" and "_": ${name}`);
  return join(EVOLUTIONS_DIR, name);
}

/** The file as it is: `problemOf` tells if the Evolution can continue. */
export async function readEvolution(dir: string): Promise<Evolution | null> {
  const file = Bun.file(join(dir, EVOLUTION_FILE));
  return (await file.exists()) ? file.json() : null;
}

async function writeEvolution(dir: string, evolution: Evolution): Promise<void> {
  await mkdir(dir, { recursive: true });
  const path = join(dir, EVOLUTION_FILE);
  await Bun.write(`${path}.tmp`, JSON.stringify(evolution));
  await rename(`${path}.tmp`, path);
}

export type EvolutionFacts = { name: string; generations: number; problem: string | null };

/** The Evolutions of `runs/evolutions/`, with the reason why each one cannot continue with this Genetic bot. */
export async function evolutionList(bot: BotFacts): Promise<EvolutionFacts[]> {
  const names = (await readdir(EVOLUTIONS_DIR).catch(() => [])).filter((name) => PLAIN_NAME.test(name)).sort();
  const all = await Promise.all(names.map(async (name) => ({ name, evolution: await readEvolution(evolutionDir(name)).catch(() => null) })));
  return all.flatMap(({ name, evolution }) => (evolution ? [{ name, generations: evolution.generations.length, problem: problemOf(evolution, bot) }] : []));
}

export async function evolutionGenome(name: string, id: number): Promise<{ genome: Genome; run: PlayerRun }> {
  const evolution = await readEvolution(evolutionDir(name));
  if (!evolution) throw new Error(`no Evolution ${name} in runs/evolutions/`);
  const problem = formatProblem(evolution);
  if (problem) throw new Error(`the Evolution ${name}: ${problem}`);
  // An elite plays again in each Generation, with the frame limit of that Generation: the last Generation that holds the Genome gives the Run.
  const generation = evolution.generations.findLast((g) => g.genomes.some((m) => m.id === id));
  const member = generation?.genomes.find((m) => m.id === id);
  if (!generation || !member) throw new Error(`the Evolution ${name} has no Genome ${id}`);
  return { genome: member.genome, run: { seed: evolution.seeds.training, frameBudget: generation.frameBudget, noProgressLimit: evolution.settings.noProgressLimit } };
}

async function evolutionFiles(): Promise<string[]> {
  const names = await readdir(EVOLUTIONS_DIR).catch(() => []);
  const files = await Promise.all(names.map(async (name) => (await readdir(join(EVOLUTIONS_DIR, name)).catch(() => [])).map((file) => evolutionPath(name, file))));
  return files.flat();
}

export async function evolutionRecordNames(): Promise<string[]> {
  return (await evolutionFiles()).filter((path) => path.endsWith(".json") && basename(path) !== EVOLUTION_FILE);
}

export async function evolutionRaceNames(): Promise<string[]> {
  return (await evolutionFiles()).filter((path) => path.endsWith(RACE_SUFFIX)).map((path) => path.slice(0, -RACE_SUFFIX.length));
}
