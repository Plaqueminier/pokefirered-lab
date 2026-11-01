import { expect, test } from "bun:test";
import type { RaceFile, RaceRun } from "../src/race/file";
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
  return { number: 1, record: "r.json", bot: "model 12", model: "a/b", track: deltas(points), battles: [], trainers: [], milestones: [], end: { frame: 1000, result: "user stop" }, ...rest };
}

function ghostsOf(...runs: RaceRun[]): RaceGhosts {
  const race: RaceFile = { version: 1, runs };
  return new RaceGhosts(race, world);
}

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

test("a battle: the Ghost stays at its cell, with the trainer when the record tells it", () => {
  const ghosts = ghostsOf(run({ points: [[0, 3, 0, 5, 5, 0]], battles: [[100, 200, true], [300, 400, false], [500, 600, null]], trainers: [[201, "RIVAL BOB"]] }));
  const at = (frame: number) => ghosts.at(frame).ghosts[0];
  expect(at(99).battle).toBeNull();
  expect(at(100).battle).toEqual({ trainer: true, name: "RIVAL BOB" });
  expect(at(199)).toMatchObject({ x: 5, y: 5, battle: { trainer: true, name: "RIVAL BOB" } });
  expect(at(200).battle).toBeNull();
  expect(at(350).battle).toEqual({ trainer: false, name: null });
  expect(at(550).battle).toEqual({ trainer: null, name: null });
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
