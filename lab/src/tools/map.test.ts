import { describe, expect, test } from "bun:test";
import { ELEVATION_SHIFT } from "../cells";
import type { MapActors, MapGrid } from "../game";
import { mapText, similarNames } from "./map";

// A map of 4 x 2 cells in a grid with a border of 1 cell, as the grid of the map of the player has.
const rows = ["######", "#..s.#", "#~~..#", "######"];
const grid: MapGrid = {
  key: "1.2",
  group: 1,
  num: 2,
  name: "Test_Cave",
  x0: -1,
  y0: -1,
  width: 6,
  height: 4,
  mapWidth: 4,
  mapHeight: 2,
  kinds: rows.join(""),
  outside: false,
  cave: true,
  allowsRunning: true,
  allowsBiking: true,
  blocks: rows.join("").split("").map((_, i) => (i === 7 ? 3 << ELEVATION_SHIFT : 0x0c00)),
  behaviors: [],
  behaviorNames: {},
  warps: [{ x: 3, y: 1, to: "Test_Out", warpId: 0, how: "step", group: 1, num: 3, behavior: "MB_LADDER", toKind: "indoor" }],
  connections: [{ direction: "north", offset: -2, map: "Route1", group: 3, num: 19 }],
  signs: [{ x: 1, y: 0, kind: "hidden-item" }],
  triggers: [{ x: 2, y: 0, variable: 0x4064, value: 1, weather: false }],
};
const actors: MapActors = {
  player: { x: 0, y: 0, facing: 1 },
  people: [{ localId: 1, x: 3, y: 0, graphics: "HIKER", facing: 1, loaded: true, stays: true, trainer: { id: 7, defeated: false, range: 3, allDirections: false, sight: [] } }],
  obstacles: [{ localId: 2, x: 2, y: 1, name: "PUSHABLE BOULDER", move: "STRENGTH" }],
  triggers: [true],
  signs: [{ found: true }],
};

describe("the text of a map", () => {
  const text = mapText({ grid, actors }, true);

  test("the cells are the map with no border, with the player, the people, the obstacles and the warps; a trigger hides no switch", () => {
    expect(text.slice(3, 7)).toEqual(["      0", "      0123", "y= 0  @?sP", "y= 1  ~~bW"]);
  });

  test("the elevation is bits 12-15 of each block, in hex", () => {
    expect(text.slice(text.indexOf("y= 0  @?sP") + 6, text.indexOf("y= 0  @?sP") + 8)).toEqual(["y= 0  3000", "y= 1  0000"]);
  });

  test("the lists give the connections, the warps, the people, the obstacles, the things to check and the triggers", () => {
    expect(text.filter((line) => line.startsWith("- "))).toEqual([
      "- north to Route1, offset -2",
      "- (3, 1) to Test_Out (warp 0), step, MB_LADDER",
      "- #1 HIKER at (3, 0), stays, trainer 7 (not defeated, sight 3)",
      "- b PUSHABLE BOULDER #2 at (2, 1)",
      "- (1, 0) hidden item, found",
      "- (2, 0) when var 0x4064 = 1, active",
    ]);
  });
});

test("a map name that does not exist gives the names that hold it, with no case", () => {
  expect(similarNames(["MtMoon_1F", "MtMoon_B1F", "Route4"], "mtmoon")).toEqual(["MtMoon_1F", "MtMoon_B1F"]);
});
