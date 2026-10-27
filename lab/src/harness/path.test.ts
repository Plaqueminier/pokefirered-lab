import { describe, expect, test } from "bun:test";
import type { Direction } from "../game";
import { type Cell, findRoute, type Leg, type MapSource, type RouteMap } from "./path";

function map(name: string, rows: string[], more: Partial<RouteMap> = {}): RouteMap {
  const width = rows[0].length;
  const height = rows.length;
  return { name, kinds: rows.join(""), x0: 0, y0: 0, width, height, mapWidth: width, mapHeight: height, warps: [], connections: [], people: [], obstacles: [], ...more };
}

function world(...maps: RouteMap[]): MapSource {
  return (name) => maps.find((m) => m.name === name) ?? null;
}

function path(m: RouteMap, from: Cell, to: Cell): Direction[] | null {
  const legs = findRoute({ map: m.name, ...from }, { map: m.name, ...to }, world(m));
  if (!legs) return null;
  expect(legs).toHaveLength(1);
  return legs[0].moves.map((move) => move.direction);
}

const STEP = { south: [0, 1], north: [0, -1], west: [-1, 0], east: [1, 0] } as const;

function visits(from: Cell, path: Direction[]): Cell[] {
  const cells = [from];
  for (const d of path) {
    const last = cells[cells.length - 1];
    cells.push({ x: last.x + STEP[d][0], y: last.y + STEP[d][1] });
  }
  return cells;
}

function walk(from: Cell, path: Direction[]): Cell {
  return visits(from, path).at(-1)!;
}

function summary(legs: Leg[] | null): string[] | null {
  return legs?.map((leg) => `${leg.map}: ${leg.moves.map((m) => `${m.kind} ${m.direction}`).join(", ")}`) ?? null;
}

describe("findRoute on one map", () => {
  test("walks in a straight line on open cells", () => {
    expect(path(map("A", ["....."]), { x: 0, y: 0 }, { x: 3, y: 0 })).toEqual(["east", "east", "east"]);
  });

  test("goes around a wall by the shortest way", () => {
    const rows = [
      "..#..",
      "..#..",
      ".....",
    ];
    const route = path(map("A", rows), { x: 0, y: 0 }, { x: 4, y: 0 });
    expect(route).toHaveLength(8);
    expect(walk({ x: 0, y: 0 }, route!)).toEqual({ x: 4, y: 0 });
    expect(visits({ x: 0, y: 0 }, route!).some((c) => c.x === 2 && c.y < 2)).toBe(false);
  });

  test("has no route to a blocked cell", () => {
    expect(path(map("A", ["..#.."]), { x: 0, y: 0 }, { x: 2, y: 0 })).toBeNull();
  });

  test("has no route to an open cell behind walls", () => {
    const rows = [
      ".....",
      ".###.",
      ".#.#.",
      ".###.",
    ];
    expect(path(map("A", rows), { x: 0, y: 0 }, { x: 2, y: 2 })).toBeNull();
  });

  test("does not walk on water, but walks in tall grass", () => {
    expect(path(map("A", [".~."]), { x: 0, y: 0 }, { x: 2, y: 0 })).toBeNull();
    expect(path(map("A", ['.".']), { x: 0, y: 0 }, { x: 2, y: 0 })).toEqual(["east", "east"]);
  });

  test("does not walk on the cell of a person", () => {
    const rows = [
      "...",
      "...",
    ];
    const route = path(map("A", rows, { people: [{ x: 1, y: 0 }] }), { x: 0, y: 0 }, { x: 2, y: 0 });
    expect(route).toEqual(["south", "east", "east", "north"]);
    expect(path(map("A", rows, { people: [{ x: 1, y: 0 }] }), { x: 0, y: 0 }, { x: 1, y: 0 })).toBeNull();
  });

  test("uses map coordinates when the grid has a border, and stays inside the map", () => {
    const rows = [
      "....",
      "#..#",
      "....",
    ];
    const bordered = map("A", rows, { x0: -1, y0: -1, mapWidth: 2, mapHeight: 1 });
    expect(path(bordered, { x: 0, y: 0 }, { x: 1, y: 0 })).toEqual(["east"]);
    expect(path(bordered, { x: 0, y: 0 }, { x: 0, y: -1 })).toBeNull();
  });

  test("has an empty route to the cell where the player is", () => {
    expect(path(map("A", ["..."]), { x: 1, y: 0 }, { x: 1, y: 0 })).toEqual([]);
  });

  test("has no route to a cell outside the map", () => {
    expect(path(map("A", ["..."]), { x: 0, y: 0 }, { x: 5, y: 0 })).toBeNull();
  });

  test("finds the stairs from the bed in PalletTown_PlayersHouse_2F", () => {
    const route = path(HOUSE_2F, { x: 6, y: 6 }, { x: 10, y: 2 });
    expect(route).toHaveLength(8);
    expect(walk({ x: 6, y: 6 }, route!)).toEqual({ x: 10, y: 2 });
  });
});

describe("findRoute over ledges", () => {
  test("jumps down a ledge and lands two cells further", () => {
    const rows = [
      ".",
      "v",
      ".",
    ];
    const legs = findRoute({ map: "A", x: 0, y: 0 }, { map: "A", x: 0, y: 2 }, world(map("A", rows)));
    expect(summary(legs)).toEqual(["A: jump south"]);
  });

  test("jumps a ledge toward the east only", () => {
    expect(summary(findRoute({ map: "A", x: 0, y: 0 }, { map: "A", x: 2, y: 0 }, world(map("A", [".>."]))))).toEqual(["A: jump east"]);
    expect(path(map("A", [".>."]), { x: 2, y: 0 }, { x: 0, y: 0 })).toBeNull();
  });

  test("does not climb a ledge, and goes around it", () => {
    const rows = [
      "...",
      "vv.",
      "...",
    ];
    expect(path(map("A", rows), { x: 0, y: 2 }, { x: 0, y: 0 })).toEqual(["east", "east", "north", "north", "west", "west"]);
    expect(path(map("A", [".", "v", "."]), { x: 0, y: 2 }, { x: 0, y: 0 })).toBeNull();
  });

  test("does not walk along a ledge or stop on it", () => {
    expect(path(map("A", [".v."]), { x: 0, y: 0 }, { x: 2, y: 0 })).toBeNull();
    expect(path(map("A", [".", "v", "."]), { x: 0, y: 0 }, { x: 0, y: 1 })).toBeNull();
  });

  test("does not jump onto a blocked cell or a person", () => {
    expect(path(map("A", [".", "v", "#", "."]), { x: 0, y: 0 }, { x: 0, y: 3 })).toBeNull();
    expect(path(map("A", [".", "v", ".", "."], { people: [{ x: 0, y: 2 }] }), { x: 0, y: 0 }, { x: 0, y: 3 })).toBeNull();
  });
});

describe("findRoute through warps", () => {
  const room = (name: string, warps: RouteMap["warps"]) => map(name, ["...", "...", "..."], { warps });

  test("takes a step warp by walking onto it", () => {
    const a = room("A", [{ x: 2, y: 1, to: "B", warpId: 0, how: "step" }]);
    const b = room("B", [{ x: 0, y: 0, to: "A", warpId: 0, how: "step" }]);
    const legs = findRoute({ map: "A", x: 0, y: 1 }, { map: "B", x: 0, y: 2 }, world(a, b));
    expect(summary(legs)).toEqual(["A: walk east, walk east", "B: walk south, walk south"]);
  });

  test("takes a press warp by pushing toward its direction from its cell", () => {
    const a = room("A", [{ x: 1, y: 1, to: "B", warpId: 0, how: "press", from: { x: 1, y: 1 }, direction: "west" }]);
    const b = room("B", [{ x: 2, y: 2, to: "A", warpId: 0, how: "none" }]);
    const legs = findRoute({ map: "A", x: 1, y: 0 }, { map: "B", x: 2, y: 2 }, world(a, b));
    expect(summary(legs)).toEqual(["A: walk south, push west", "B: "]);
  });

  test("a walk from a press warp cell toward its direction takes the warp", () => {
    const a = room("A", [{ x: 1, y: 1, to: "B", warpId: 0, how: "press", from: { x: 1, y: 1 }, direction: "south" }]);
    const b = room("B", [{ x: 0, y: 0, to: "A", warpId: 0, how: "none" }]);
    const route = path(a, { x: 1, y: 0 }, { x: 1, y: 2 });
    expect(route).toHaveLength(4);
    expect(walk({ x: 1, y: 0 }, route!)).toEqual({ x: 1, y: 2 });
    const cells = visits({ x: 1, y: 0 }, route!);
    expect(route!.some((d, i) => d === "south" && cells[i].x === 1 && cells[i].y === 1)).toBe(false);
    expect(summary(findRoute({ map: "A", x: 1, y: 0 }, { map: "B", x: 0, y: 0 }, world(a, b)))).toEqual(["A: walk south, push south", "B: "]);
  });

  test("takes a door by pushing north from the cell below it", () => {
    const town = map("Town", ["#D#", "..."], { warps: [{ x: 1, y: 0, to: "House", warpId: 0, how: "press", from: { x: 1, y: 1 }, direction: "north" }] });
    const house = room("House", [{ x: 1, y: 2, to: "Town", warpId: 0, how: "step" }]);
    const legs = findRoute({ map: "Town", x: 0, y: 1 }, { map: "House", x: 1, y: 0 }, world(town, house));
    expect(summary(legs)).toEqual(["Town: walk east, push north", "House: walk north, walk north"]);
  });

  test("does not take a warp whose cell does not warp", () => {
    const a = room("A", [{ x: 2, y: 1, to: "B", warpId: 0, how: "none" }]);
    const b = room("B", [{ x: 0, y: 0, to: "A", warpId: 0, how: "none" }]);
    expect(findRoute({ map: "A", x: 0, y: 1 }, { map: "B", x: 0, y: 0 }, world(a, b))).toBeNull();
    expect(path(a, { x: 0, y: 1 }, { x: 2, y: 1 })).toEqual(["east", "east"]);
  });

  test("does not stop on a step warp: it walks around it", () => {
    const a = map("A", ["...", "..."], { warps: [{ x: 1, y: 0, to: "B", warpId: 0, how: "step" }] });
    const b = room("B", [{ x: 0, y: 0, to: "A", warpId: 0, how: "none" }]);
    expect(findRoute({ map: "A", x: 0, y: 0 }, { map: "A", x: 2, y: 0 }, world(a, b))).toEqual([
      { map: "A", moves: ["south", "east", "east", "north"].map((direction) => ({ direction: direction as Direction, kind: "walk" })) },
    ]);
  });

  test("ignores a warp to a map it does not know, or to a missing warp", () => {
    const a = room("A", [
      { x: 1, y: 0, to: "Nowhere", warpId: 0, how: "step" },
      { x: 1, y: 2, to: "B", warpId: 5, how: "step" },
    ]);
    const b = room("B", []);
    expect(findRoute({ map: "A", x: 0, y: 1 }, { map: "B", x: 0, y: 0 }, world(a, b))).toBeNull();
  });
});

describe("findRoute through connections", () => {
  test("walks off the north edge into the map above, with the connection offset", () => {
    const town = map("Town", ["....", "...."], { connections: [{ direction: "north", offset: 2, map: "Route" }] });
    const route = map("Route", ["..", ".."], { connections: [{ direction: "south", offset: -2, map: "Town" }] });
    const legs = findRoute({ map: "Town", x: 3, y: 1 }, { map: "Route", x: 1, y: 0 }, world(town, route));
    expect(summary(legs)).toEqual(["Town: walk north, walk north", "Route: walk north"]);
  });

  test("crosses only where the next map has a free cell", () => {
    const town = map("Town", ["...."], { connections: [{ direction: "north", offset: 2, map: "Route" }] });
    const legs = findRoute({ map: "Town", x: 2, y: 0 }, { map: "Route", x: 0, y: 0 }, world(town, map("Route", ["..", "#."])));
    expect(summary(legs)).toEqual(["Town: walk east, walk north", "Route: walk north, walk west"]);
    expect(findRoute({ map: "Town", x: 2, y: 0 }, { map: "Route", x: 0, y: 0 }, world(town, map("Route", ["..", "##"])))).toBeNull();
  });

  test("walks east and west across connections", () => {
    const west = map("West", ["..", ".."], { connections: [{ direction: "east", offset: 1, map: "East" }] });
    const east = map("East", ["..", ".."], { connections: [{ direction: "west", offset: -1, map: "West" }] });
    expect(summary(findRoute({ map: "West", x: 1, y: 1 }, { map: "East", x: 1, y: 0 }, world(west, east)))).toEqual(["West: walk east", "East: walk east"]);
    expect(summary(findRoute({ map: "East", x: 0, y: 0 }, { map: "West", x: 0, y: 1 }, world(west, east)))).toEqual(["East: walk west", "West: walk west"]);
  });
});

const HOUSE_2F = map(
  "PalletTown_PlayersHouse_2F",
  ["############", "############", "#.......##..", "#.......##..", "#.....#.....", "#.....#.....", "#.#.........", "#...........", "#..........."],
  { warps: [{ x: 10, y: 2, to: "PalletTown_PlayersHouse_1F", warpId: 2, how: "press", from: { x: 10, y: 2 }, direction: "west" }] },
);

const HOUSE_1F = map(
  "PalletTown_PlayersHouse_1F",
  ["#############", "#############", "#..........##", "#............", "#.....##.....", "#.....##.....", "#............", "##..........#", "#............", "#############"],
  {
    warps: [
      { x: 5, y: 8, to: "PalletTown", warpId: 0, how: "none" },
      { x: 4, y: 8, to: "PalletTown", warpId: 0, how: "press", from: { x: 4, y: 8 }, direction: "south" },
      { x: 10, y: 2, to: "PalletTown_PlayersHouse_2F", warpId: 0, how: "press", from: { x: 10, y: 2 }, direction: "east" },
      { x: 3, y: 9, to: "PalletTown", warpId: 0, how: "none" },
    ],
    people: [{ x: 8, y: 4 }],
  },
);

const PALLET_TOWN = map(
  "PalletTown",
  [
    "############..##########",
    "############..##########",
    "##....................##",
    "##....................##",
    "##...#####....#####...##",
    "##...#####....#####...##",
    "##...#####....#####...##",
    "##..######...######...##",
    "##....................##",
    "##....................##",
  ],
  {
    mapHeight: 10,
    warps: [
      { x: 6, y: 7, to: "PalletTown_PlayersHouse_1F", warpId: 1, how: "press", from: { x: 6, y: 8 }, direction: "north" },
      { x: 15, y: 7, to: "PalletTown_RivalsHouse", warpId: 0, how: "press", from: { x: 15, y: 8 }, direction: "north" },
    ],
  },
);

describe("findRoute from the bedroom to Pallet Town", () => {
  test("goes down the stairs, out by the door mat, and north in the town", () => {
    const legs = findRoute({ map: HOUSE_2F.name, x: 6, y: 6 }, { map: "PalletTown", x: 12, y: 2 }, world(HOUSE_2F, HOUSE_1F, PALLET_TOWN));
    expect(legs?.map((l) => l.map)).toEqual(["PalletTown_PlayersHouse_2F", "PalletTown_PlayersHouse_1F", "PalletTown"]);
    expect(legs![0].moves.at(-1)).toEqual({ direction: "west", kind: "push" });
    expect(legs![1].moves.at(-1)).toEqual({ direction: "south", kind: "push" });
    const walked = legs![1].moves.slice(0, -1).map((m) => m.direction);
    expect(walk({ x: 10, y: 2 }, walked)).toEqual({ x: 4, y: 8 });
    expect(visits({ x: 10, y: 2 }, walked).some((c) => c.x === 8 && c.y === 4)).toBe(false);
    expect(walk({ x: 6, y: 7 }, legs![2].moves.map((m) => m.direction))).toEqual({ x: 12, y: 2 });
  });

  test("has no route to a map it cannot reach", () => {
    expect(findRoute({ map: HOUSE_2F.name, x: 6, y: 6 }, { map: "Route1", x: 0, y: 0 }, world(HOUSE_2F, HOUSE_1F, PALLET_TOWN))).toBeNull();
  });
});
