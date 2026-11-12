import { expect, test } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { RunRecord } from "../harness/record";
import { dotOf } from "../race/file";
import { readRace } from "../race/make";
import { evolve, type Player } from "./evolution";
import { fitness } from "./fitness";
import type { Genome } from "./genome";

const fakePlayer: Player = async (genome, { seed }) => {
  const record: RunRecord = {
    format: 3,
    header: { rom: "", seed, startSave: null, knowledge: "player", bot: { name: "genetic", version: "1", genome } },
    buttons: [],
    events: [],
    track: [10, 4, 1, 6, 6, 1],
    state: [],
    result: { endReason: "no progress", frames: 1000, milestones: [], rawInputs: 0 },
  };
  return { record, fitness: { ...fitness(record), note: noteOf(genome) } };
};

function noteOf(genome: Genome): number {
  return Object.values(genome).reduce((sum, weights) => sum + Object.values(weights).reduce((a: number, b) => a + (b ?? 0), 0), 0);
}

const evolutionDir = () => mkdtemp(join(tmpdir(), "evolution-"));
const bot = { name: "genetic", version: "1" };

test("the 5 best Genomes pass unchanged to the next Generation with their ids, and the children get new ids and the ids of their parents", async () => {
  const [first, second] = (await evolve(await evolutionDir(), { play: fakePlayer, bot, seed: 7, until: 2 })).generations;
  expect(first.genomes.map((g) => g.id).sort((a, b) => a - b)).toEqual(Array.from({ length: 50 }, (_, i) => i + 1));
  const ranked = [...first.genomes].sort((a, b) => b.fitness - a.fitness);
  const byId = (genomes: typeof ranked) => genomes.map(({ id, genome }) => ({ id, genome })).sort((a, b) => a.id - b.id);
  expect(byId(second.genomes.filter((g) => g.id <= 50))).toEqual(byId(ranked.slice(0, 5)));
  const children = second.genomes.filter((g) => g.id > 50);
  expect(second.genomes).toHaveLength(50);
  expect(children.map((g) => g.id).sort((a, b) => a - b)).toEqual(Array.from({ length: 45 }, (_, i) => i + 51));
  const parents = new Set(ranked.slice(0, 25).map((g) => g.id));
  for (const child of children) {
    expect(child.parents).toHaveLength(2);
    expect(child.parents.every((id) => parents.has(id))).toBe(true);
  }
});

test("an Evolution that stops in a Generation and continues from its file gives the same next Generation as an Evolution that did not stop", async () => {
  const whole = await evolve(await evolutionDir(), { play: fakePlayer, bot, seed: 7, until: 3 });
  const dir = await evolutionDir();
  let plays = 0;
  const stops: Player = (genome, run) => (++plays === 75 ? Promise.reject(new Error("the Mac sleeps")) : fakePlayer(genome, run));
  await expect(evolve(dir, { play: stops, bot, seed: 7, until: 3 })).rejects.toThrow("the Mac sleeps");
  const continued = await evolve(dir, { play: fakePlayer, bot, until: 3 });
  expect(continued.generations.map((g) => g.genomes)).toEqual(whole.generations.map((g) => g.genomes));
});

test("each Generation writes its Race from the Run records in memory, with the number of each Genome and the dot genetic, and the Race of the bests grows by the best Genome of each Generation", async () => {
  const dir = await evolutionDir();
  const { generations } = await evolve(dir, { play: fakePlayer, bot, seed: 7, until: 2 });
  for (const { number, genomes } of generations) {
    const race = await readRace(`generation-000${number}`, dir);
    expect(race?.runs.map((run) => run.number)).toEqual(genomes.map((g) => g.id).sort((a, b) => a - b));
    expect(new Set(race?.runs.map(dotOf))).toEqual(new Set(["genetic"]));
  }
  const bests = await readRace("bests", dir);
  expect(bests?.runs.map((run) => run.number)).toEqual(generations.map((g) => g.genomes[0].id));
  expect(bests?.runs.map(dotOf)).toEqual(["genetic", "genetic"]);
});

test("an Evolution ends after the Generation that plays when it is asked to stop, and a later Evolution continues from there", async () => {
  const dir = await evolutionDir();
  let stopAsked = false;
  const stopped = await evolve(dir, { play: fakePlayer, bot, seed: 7, stop: () => stopAsked, onGeneration: () => void (stopAsked = true) });
  expect(stopped.generations).toHaveLength(1);
  expect((await evolve(dir, { play: fakePlayer, bot, until: 2 })).generations).toHaveLength(2);
});

test("an Evolution does not continue with another version of the Genetic bot", async () => {
  const dir = await evolutionDir();
  await evolve(dir, { play: fakePlayer, bot, seed: 7, until: 1 });
  await expect(evolve(dir, { play: fakePlayer, bot: { name: "genetic", version: "2" }, until: 2 })).rejects.toThrow("it plays the Genetic bot version 1, and the Genetic bot is now version 2: start a new Evolution");
});
