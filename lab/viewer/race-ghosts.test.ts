import { expect, test } from "bun:test";
import type { BattleSide, StateEntry } from "../src/protocol";
import { RACE_VERSION, type RaceFile, type RaceRun } from "../src/race/file";
import { modelFamily, shortModelId } from "../src/race/file";
import { framedBox, type GhostWorld, RaceGhosts } from "./race-ghosts";

const PALLET = "3.0";
const ROUTE = "3.1";
const LAB = "4.3";
const LAB_UP = "4.4";
const CENTER = "5.0";
const FOREST = "1.0";
const LAB_DOOR = { map: PALLET, x: 16, y: 13 };

const world: GhostWorld = {
  places: [
    { map: PALLET, x: 10, y: 20, scale: 1, island: false },
    { map: ROUTE, x: 10, y: 0, scale: 1, island: false },
    { map: FOREST, x: 100, y: 50, scale: 0.5, island: true },
  ],
  maps: [
    { key: PALLET, warps: [{ x: 16, y: 13, to: LAB }, { x: 17, y: 13, to: LAB }, { x: 2, y: 2, to: CENTER }], door: null },
    { key: ROUTE, warps: [], door: null },
    { key: FOREST, warps: [], door: null },
    { key: LAB, warps: [{ x: 1, y: 1, to: LAB_UP }], door: LAB_DOOR },
    { key: LAB_UP, warps: [], door: LAB_DOOR },
    { key: CENTER, warps: [], door: { map: PALLET, x: 2, y: 2 } },
  ],
};

function deltas(points: number[][]): number[] {
  const flat: number[] = [];
  let before = [0, 0, 0, 0, 0, 0];
  for (const point of points) {
    flat.push(point[0] - before[0], point[1], point[2], point[3] - before[3], point[4] - before[4], point[5]);
    before = point;
  }
  return flat;
}

function run(fields: Partial<RaceRun> & { points: number[][] }): RaceRun {
  const { points, ...rest } = fields;
  return { number: 1, record: "r.json", bot: "model 12", model: "a/b", character: "Normal trainer", track: deltas(points), battles: [], trainers: [], milestones: [], end: { frame: 1000, result: "user stop" }, state: [], cost: [], faints: [], money: [], ...rest };
}

function ghostsOf(...runs: RaceRun[]): RaceGhosts {
  const race: RaceFile = { version: RACE_VERSION, runs };
  return new RaceGhosts(race, world);
}

test("the family of a model comes from its id alone", () => {
  for (const id of ["deepseek/deepseek-v4-flash", "deepseek/deepseek-v4.1-flash"]) expect(modelFamily(id)).toBe("deepseek");
  for (const id of ["gpt-5.6-terra", "gpt-6-luna", "gpt-6.1-terra", "gpt-5.6-luna", "gpt-6.-luna", "openai/gpt-5.5"]) expect(modelFamily(id)).toBe("gpt");
  for (const id of ["claude-haiku-5-5", "claude-sonnet-5-5", "anthropic/claude-opus-5.5"]) expect(modelFamily(id)).toBe("claude");
  for (const id of ["grok-4.7", "grok-4.7-fast", "x-ai/grok-4"]) expect(modelFamily(id)).toBe("grok");
});

test("a model of another family, or no model, has no family", () => {
  for (const id of ["", "a/b", "mistralai/mistral-large", "haiku-of-another-maker", "my-gpt-copy", "my-grok-copy"]) expect(modelFamily(id)).toBeNull();
});

test("the short id of a model has no prefix", () => {
  expect(shortModelId("deepseek/deepseek-v4.1-flash")).toBe("deepseek-v4.1-flash");
  expect(shortModelId("claude-haiku-5-5")).toBe("claude-haiku-5-5");
  expect(shortModelId("")).toBe("");
});

test("a Ghost gives the model of its Run, with the full id of an alias of the claude command", () => {
  const ghosts = ghostsOf(run({ model: "deepseek/deepseek-v4-flash", points: [[0, 3, 0, 5, 5, 0]] }), run({ number: 2, model: "haiku", points: [[0, 3, 0, 5, 5, 0]] }));
  expect(ghosts.at(0).ghosts.map(({ model }) => model)).toEqual(["deepseek/deepseek-v4-flash", "claude-haiku-5-5"]);
});

test("a step: the Ghost slides from its cell to the next one in 16 frames, with a walk frame in the first half and its new facing", () => {
  const ghosts = ghostsOf(run({ points: [[0, 3, 0, 5, 5, 0], [100, 3, 0, 5, 4, 1], [200, 3, 0, 5, 3, 1]] }));
  const at = (frame: number) => ghosts.at(frame).ghosts[0];
  expect(at(99)).toMatchObject({ map: PALLET, x: 5, y: 5, facing: 0, walk: 0, place: { kind: "world", x: 15, y: 25 } });
  expect(at(100)).toMatchObject({ x: 5, y: 5, facing: 1 });
  expect(at(104)).toMatchObject({ x: 5, y: 4.75, facing: 1, place: { y: 24.75 } });
  expect(at(104).walk).toBeGreaterThan(0);
  expect(at(112)).toMatchObject({ x: 5, y: 4.25, walk: 0 });
  expect(at(116)).toMatchObject({ x: 5, y: 4, walk: 0 });

  const running = ghostsOf(run({ points: [[0, 3, 0, 5, 5, 0], [100, 3, 0, 5, 4, 1], [108, 3, 0, 5, 3, 1]] }));
  expect(running.at(104).ghosts[0].y).toBe(4.5);
  expect(running.at(108).ghosts[0].y).toBe(4);
});

test("a turn on the spot has no slide, and a step over a connection slides on the world", () => {
  const ghosts = ghostsOf(run({ points: [[0, 3, 0, 5, 0, 0], [50, 3, 0, 5, 0, 1], [100, 3, 1, 5, 19, 1]] }));
  expect(ghosts.at(52).ghosts[0]).toMatchObject({ x: 5, y: 0, facing: 1, walk: 0 });
  expect(ghosts.at(108).ghosts[0]).toMatchObject({ map: ROUTE, y: 19.5, place: { kind: "world", x: 15, y: 19.5 } });
});

test("a warp into a house has no slide: the Ghost counts at the door that it went in by, also on the next floor, and until it comes out", () => {
  const ghosts = ghostsOf(
    run({
      points: [[0, 3, 0, 15, 14, 1], [50, 3, 0, 16, 14, 1], [66, 3, 0, 16, 13, 1], [100, 4, 3, 6, 12, 1], [200, 4, 4, 1, 1, 0], [300, 4, 3, 6, 12, 0], [400, 3, 0, 16, 14, 0]],
    }),
    run({ number: 2, points: [[0, 3, 0, 17, 14, 1], [90, 3, 0, 17, 13, 1], [100, 4, 3, 7, 12, 1]] }),
  );
  const atDoor = { kind: "door", door: LAB_DOOR, x: 26, y: 33 };
  expect(ghosts.at(99).ghosts[0]).toMatchObject({ map: PALLET, place: { kind: "world" } });
  expect(ghosts.at(101).ghosts[0]).toMatchObject({ map: LAB, x: 6, y: 12, place: atDoor });
  expect(ghosts.at(250).ghosts[0]).toMatchObject({ map: LAB_UP, place: atDoor });
  expect(ghosts.at(350).ghosts[0]).toMatchObject({ map: LAB, place: atDoor });
  expect(ghosts.at(401).ghosts[0]).toMatchObject({ map: PALLET, x: 16, y: 14, place: { kind: "world" } });

  // The second cell of a wide door is the same door.
  const moment = ghosts.at(101);
  expect(moment.doors).toHaveLength(1);
  expect(moment.doors[0]).toMatchObject({ door: LAB_DOOR, interiors: [{ map: LAB }] });
  expect(moment.doors[0].ghosts.map((ghost) => ghost.number)).toEqual([1, 2]);
  expect(moment.inside.get(LAB)).toHaveLength(2);
});

test("a Ghost that starts inside counts at the door of the world, a whiteout counts at the door of the Pokémon Center, and a map with no door is nowhere", () => {
  const ghosts = ghostsOf(run({ points: [[67, 4, 4, 1, 1, 0], [100, 3, 0, 8, 8, 0], [200, 5, 0, 1, 1, 1]] }), run({ points: [[0, 9, 9, 3, 3, 0], [100, 9, 9, 3, 4, 0]] }));
  expect(ghosts.at(0).ghosts[0]).toMatchObject({ map: LAB_UP, place: { kind: "door", door: LAB_DOOR } });
  expect(ghosts.at(250).ghosts[0]).toMatchObject({ map: CENTER, place: { kind: "door", door: { map: PALLET, x: 2, y: 2 }, x: 12, y: 22 } });
  expect(ghosts.at(104).ghosts[1]).toMatchObject({ y: 3.25, place: { kind: "nowhere" } });
});

test("an island scales its cells on the world", () => {
  const ghosts = ghostsOf(run({ points: [[0, 1, 0, 4, 6, 0]] }));
  expect(ghosts.at(10).ghosts[0]).toMatchObject({ map: FOREST, x: 4, y: 6, place: { kind: "world", x: 102, y: 53, scale: 0.5 } });
});

test("a battle: the Ghost stays at its cell, with the name of the trainer from the start, or none in a wild battle", () => {
  const start = (frame: number, trainer: string | null) => ({ frame, kind: "battle" as const, trainer, player: null, foe: null });
  const ghosts = ghostsOf(run({ points: [[0, 3, 0, 5, 5, 0]], battles: [[100, 200], [300, 400]], state: [start(100, "RIVAL BOB"), start(300, null)] }));
  const at = (frame: number) => ghosts.at(frame).ghosts[0];
  expect(at(99).battle).toBeNull();
  expect(at(100).battle).toEqual(start(100, "RIVAL BOB"));
  expect(at(199)).toMatchObject({ x: 5, y: 5, battle: { trainer: "RIVAL BOB" } });
  expect(at(200).battle).toBeNull();
  expect(at(350).battle).toEqual(start(300, null));
});

const SQUIRTLE = { species: "SQUIRTLE", nickname: "BOB", level: 5, maxHp: 20, moves: ["TACKLE", "TAIL WHIP"] };
const PIDGEY = { species: "PIDGEY", nickname: "PIDGEY", level: 3, maxHp: 14, moves: ["GUST"] };

test("the team at a frame: its names and moves from the last team, its HP and status from the last health; before the first Pokémon, an empty team", () => {
  const ghosts = ghostsOf(
    run({
      points: [[0, 3, 0, 5, 5, 0]],
      state: [
        { frame: 100, kind: "team", team: [SQUIRTLE] },
        { frame: 100, kind: "health", health: [{ hp: 20, status: "none" }] },
        { frame: 150, kind: "health", health: [{ hp: 7, status: "poison" }] },
        { frame: 200, kind: "team", team: [{ ...SQUIRTLE, level: 6, maxHp: 22 }, PIDGEY] },
        { frame: 200, kind: "health", health: [{ hp: 9, status: "none" }, { hp: 14, status: "none" }] },
      ],
    }),
  );
  const at = (frame: number) => ghosts.at(frame).ghosts[0].team;
  expect(at(99)).toEqual([]);
  expect(at(100)).toEqual([{ ...SQUIRTLE, hp: 20, status: "none" }]);
  expect(at(170)).toEqual([{ ...SQUIRTLE, hp: 7, status: "poison" }]);
  expect(at(250).map((mon) => [mon.species, mon.level, mon.hp])).toEqual([["SQUIRTLE", 6, 9], ["PIDGEY", 3, 14]]);
});

test("the battle at a frame: the two Pokémon of the last battle entry", () => {
  const side = (species: string, hp: number): BattleSide => ({ species, nickname: species, level: 5, hp, maxHp: 20, status: "none" });
  const ghosts = ghostsOf(
    run({
      points: [[0, 3, 0, 5, 5, 0]],
      battles: [[100, 200]],
      state: [
        { frame: 100, kind: "battle", trainer: null, player: null, foe: null },
        { frame: 120, kind: "battle", trainer: null, player: side("SQUIRTLE", 20), foe: side("RATTATA", 20) },
        { frame: 150, kind: "battle", trainer: null, player: side("SQUIRTLE", 20), foe: side("RATTATA", 6) },
      ],
    }),
  );
  const at = (frame: number) => ghosts.at(frame).ghosts[0].battle;
  expect(at(110)).toMatchObject({ player: null, foe: null });
  expect(at(130)?.foe?.hp).toBe(20);
  expect(at(170)?.foe?.hp).toBe(6);
  expect(at(190)?.player?.species).toBe("SQUIRTLE");
});

test("the stats at a frame: Milestones, badges by their number, cost, Model calls, battles, trainers beaten, faints and money", () => {
  const none = [false, false, false, false, false, false, false, false];
  const third = [false, false, true, false, false, false, false, false];
  const ghosts = ghostsOf(
    run({
      points: [[0, 3, 0, 5, 5, 0]],
      milestones: [[50, "has-pokemon"], [300, "badge-3"]],
      battles: [[100, 200], [400, 500]],
      trainers: [[201, "RIVAL BOB"]],
      cost: [[90, 0.01, 2], [350, 0.03, 8]],
      faints: [150],
      money: [[0, 3000], [210, 3080]],
    }),
    run({ number: 2, points: [[0, 3, 0, 1, 1, 0]] }),
  );
  const stats = (frame: number) => ghosts.at(frame).ghosts[0].stats;
  expect(stats(10)).toEqual({ milestones: 0, lastMilestone: 0, badges: none, cost: 0, calls: 0, battles: 0, trainers: 0, faints: 0, money: 3000 });
  expect(stats(205)).toEqual({ milestones: 1, lastMilestone: 50, badges: none, cost: 0.01, calls: 2, battles: 1, trainers: 1, faints: 1, money: 3000 });
  expect(stats(450)).toEqual({ milestones: 2, lastMilestone: 300, badges: third, cost: 0.03, calls: 8, battles: 2, trainers: 1, faints: 1, money: 3080 });
  expect(ghosts.at(450).ghosts[1].stats.money).toBeNull();
});

test("the ranking: most Milestones, then the first to reach them, then the highest sum of levels, then the lowest Run id", () => {
  const team = (frame: number, level: number): StateEntry => ({ frame, kind: "team", team: [{ ...SQUIRTLE, level }] });
  const points = [[0, 3, 0, 1, 1, 0]];
  const ghosts = ghostsOf(
    run({ number: 7, points }),
    run({ number: 3, points }),
    run({ number: 5, points, state: [team(10, 9)] }),
    run({ number: 9, points, milestones: [[100, "has-pokemon"], [500, "pokedex"]] }),
    run({ number: 2, points, milestones: [[200, "has-pokemon"], [400, "pokedex"]] }),
    run({ number: 4, points, milestones: [[200, "has-pokemon"]], state: [team(10, 5), team(300, 12)] }),
    run({ number: 8, points, milestones: [[200, "has-pokemon"]], state: [team(10, 6)] }),
  );
  const ranks = (frame: number) => ghosts.at(frame).ranking.map((ghost) => ghost.number);
  expect(ranks(50)).toEqual([5, 8, 4, 2, 3, 7, 9]);
  expect(ranks(150)).toEqual([9, 5, 8, 4, 2, 3, 7]);
  expect(ranks(250)).toEqual([9, 8, 4, 2, 5, 3, 7]);
  expect(ranks(350)).toEqual([9, 4, 8, 2, 5, 3, 7]);
  expect(ranks(450)).toEqual([2, 9, 4, 8, 5, 3, 7]);
  expect(ranks(600)).toEqual([2, 9, 4, 8, 5, 3, 7]);
  expect(ghosts.at(50).leader).toBeNull();
  expect(ghosts.at(50).ranking[0].number).toBe(5);
});

test("the end of a Run: the Ghost stays at its last place with its Run result, and the race lasts until the last end", () => {
  const ghosts = ghostsOf(run({ points: [[0, 3, 0, 5, 5, 0], [100, 3, 0, 5, 4, 1]], end: { frame: 150, result: "whiteout" } }), run({ number: 2, points: [[0, 3, 0, 1, 1, 0]], end: { frame: 900, result: "goal" } }));
  expect(ghosts.lastFrame).toBe(900);
  expect(ghosts.at(149).ghosts[0].result).toBeNull();
  expect(ghosts.at(150).ghosts[0]).toMatchObject({ result: "whiteout", x: 5, y: 4 });
  expect(ghosts.at(900).ghosts[1]).toMatchObject({ number: 2, result: "goal" });
});

test("the camera frames the Ghosts that still play, and all the Ghosts when no Run plays", () => {
  const ghosts = ghostsOf(run({ points: [[0, 3, 0, 2, 3, 0]], end: { frame: 100, result: "whiteout" } }), run({ number: 2, points: [[0, 3, 0, 5, 7, 0]], end: { frame: 200, result: "goal" } }));
  const both = { left: 12, top: 23, right: 16, bottom: 28 };
  expect(framedBox(ghosts.at(99).ghosts)).toEqual(both);
  expect(framedBox(ghosts.at(100).ghosts)).toEqual({ left: 15, top: 27, right: 16, bottom: 28 });
  expect(framedBox(ghosts.at(200).ghosts)).toEqual(both);
});

test("the camera can follow one Ghost: a Ghost inside counts at its door, and a Ghost that ended stays framed", () => {
  const ghosts = ghostsOf(
    run({ points: [[0, 3, 0, 2, 3, 0]], end: { frame: 100, result: "whiteout" } }),
    run({ number: 2, points: [[0, 3, 0, 5, 7, 0]] }),
    run({ number: 3, points: [[0, 3, 0, 16, 13, 1], [50, 4, 3, 6, 12, 1]] }),
  );
  const moment = ghosts.at(150);
  expect(framedBox([moment.ghosts[0]])).toEqual({ left: 12, top: 23, right: 13, bottom: 24 });
  expect(framedBox([moment.ghosts[2]])).toEqual({ left: 26, top: 33, right: 27, bottom: 34 });
});

test("the leader has the most Milestones at the frame; on a tie, the first to reach them; before any Milestone, there is none", () => {
  const ghosts = ghostsOf(
    run({ number: 1, points: [[0, 3, 0, 1, 1, 0]], milestones: [[100, "has-pokemon"], [500, "first-rival-battle"]] }),
    run({ number: 2, points: [[0, 3, 0, 2, 2, 0]], milestones: [[200, "has-pokemon"], [400, "first-rival-battle"], [900, "pokedex"]] }),
  );
  const leader = (frame: number) => ghosts.at(frame).leader;
  expect(leader(50)).toBeNull();
  expect(leader(150)).toBe(0);
  expect(leader(250)).toBe(0);
  expect(leader(450)).toBe(1);
  expect(leader(600)).toBe(1);
  expect(leader(950)).toBe(1);
  expect(ghosts.winners("has-pokemon", 150)).toBe(1);
  expect(ghosts.winners("has-pokemon", 250)).toBe(2);
  expect(ghosts.winners("pokedex", 250)).toBe(0);
});
