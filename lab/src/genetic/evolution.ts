// The Generations of an Evolution. The loop receives the player, so that it does not depend on the emulator (spec #88).
import { mkdir, readdir, rename } from "node:fs/promises";
import { basename, join } from "node:path";
import type { Milestone } from "../game";
import type { EndReason } from "../harness/harness";
import { RUNS_DIR, type RunRecord, writeRecord } from "../harness/record";
import { FITNESS_VERSION, type Fitness } from "./fitness";
import { GROUPS, type Genome } from "./genome";

const EVOLUTIONS_DIR =join(RUNS_DIR, "evolutions");
const EVOLUTION_FILE = "evolution.json";
const EVOLUTION_FORMAT = 1;
const NAME = /^[\w-]+$/;

// The seed of `gLabRngSeed` in the ROM (src/lab.c). A Run cannot take another seed yet (#94).
const ROM_SEED = 0x4c41;

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
};

type Settings = typeof SETTINGS;

/** `run`: what the Run of this Genome must use. The Genetic bot has no goal: the Run ends at the goal of the Evolution. */
export type Player = (genome: Genome, run: { seed: number; frameBudget: number; noProgressLimit: number; goal: Milestone }) => Promise<Played>;

export type Played = { record: RunRecord; fitness: Fitness };

/** A Genome of a Generation. `parents`: the ids of the two Genomes that gave it, none in the first Generation. An elite keeps its id and its parents. */
type Member = { id: number; parents: number[]; genome: Genome; fitness: number; terms: Fitness["terms"]; frames: number; milestones: Milestone[]; endReason: EndReason };

/** `genomes`: from the best Fitness to the worst. `record`: the Run record of the best Genome, in the folder of the Evolution, when it is a new best. */
export type Generation = { number: number; frameBudget: number; genomes: Member[]; record?: string };

/** `seed`: the seed of the random choices of the Evolution. `seeds.training`: the seed of the game for each Run. */
export type Evolution = { format: number; seed: number; seeds: { training: number }; bot: { name: string; version: string } | null; fitnessVersion: string; settings: Settings; generations: Generation[] };

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
  if (last?.genomes[0].milestones.includes(settings.goal)) return `the best Genome of Generation ${last.number} reaches ${settings.goal}`;
  if (generations.length >= settings.generations) return `${settings.generations} Generations`;
  return null;
}

function newEvolution(seed: number | undefined): Evolution {
  if (seed === undefined) throw new Error("a new Evolution needs the seed of its random choices");
  return { format: EVOLUTION_FORMAT, seed, seeds: { training: ROM_SEED }, bot: null, fitnessVersion: FITNESS_VERSION, settings: SETTINGS, generations: [] };
}

async function playGeneration(dir: string, evolution: Evolution, play: Player): Promise<{ generation: Generation; bot: NonNullable<Evolution["bot"]> }> {
  const { settings, generations } = evolution;
  const last = generations.at(-1);
  const number = (last?.number ?? 0) + 1;
  const frameBudget = Math.max(settings.frameBudget.least, settings.frameBudget.timesBest * (last?.genomes[0].frames ?? 0));
  const born = last ? children(evolution, last) : firstGenomes(evolution);
  const played = await Promise.all(born.map(({ genome }) => play(genome, { seed: evolution.seeds.training, frameBudget, noProgressLimit: settings.noProgressLimit, goal: settings.goal })));
  const { name, version } = played[0].record.header.bot;
  for (const { record, fitness } of played) {
    if (record.header.bot.version !== (evolution.bot?.version ?? version)) throw new Error(`the Evolution plays the Genetic bot version ${evolution.bot?.version ?? version}, and this Run plays version ${record.header.bot.version}: start a new Evolution`);
    if (fitness.version !== evolution.fitnessVersion) throw new Error(`the Evolution ranks with the Fitness version ${evolution.fitnessVersion}, not ${fitness.version}`);
  }
  // A stable sort: a tie keeps the order of birth, so the Generation is always the same.
  const ranked = born.map((genome, i) => ({ genome, played: played[i] })).sort((a, b) => b.played.fitness.note - a.played.fitness.note);
  const genomes = ranked.map(({ genome, played: { record, fitness } }): Member => ({ ...genome, fitness: fitness.note, terms: fitness.terms, frames: record.result.frames, milestones: record.result.milestones, endReason: record.result.endReason }));
  const bestBefore = Math.max(Number.NEGATIVE_INFINITY, ...generations.map((g) => g.genomes[0].fitness));
  const best = ranked[0].played;
  const record = best.fitness.note > bestBefore ? basename(await writeRecord({ ...best.record, header: { ...best.record.header, fitness: best.fitness } }, dir)) : undefined;
  return { generation: { number, frameBudget, genomes, ...(record === undefined ? {} : { record }) }, bot: { name, version } };
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

/** The Genome with this id in any Generation of the Evolution `name`. */
export async function evolutionGenome(name: string, id: number): Promise<Genome> {
  const evolution = await readEvolution(evolutionDir(name));
  if (!evolution) throw new Error(`no Evolution ${name} in runs/evolutions/`);
  const member = evolution.generations.flatMap((g) => g.genomes).find((m) => m.id === id);
  if (!member) throw new Error(`the Evolution ${name} has no Genome ${id}`);
  return member.genome;
}

/** The Run records of all the Evolutions, as paths in the runs folder: `evolutions/<name>/<file>`. */
export async function evolutionRecordNames(): Promise<string[]> {
  const names = await readdir(EVOLUTIONS_DIR).catch(() => []);
  const files = await Promise.all(names.map(async (name) => (await readdir(join(EVOLUTIONS_DIR, name)).catch(() => [])).filter((file) => file.endsWith(".json") && file !== EVOLUTION_FILE).map((file) => `evolutions/${name}/${file}`)));
  return files.flat();
}
