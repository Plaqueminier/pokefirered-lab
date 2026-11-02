import { describe, expect, test } from "bun:test";
import type { Game, MapGrid, Warp } from "../game";
import { AtlasWatch, mapNamed } from "./atlas";

function grid(name: string, num: number, warps: Warp[]): MapGrid {
  return { name, group: 0, num, x0: 0, y0: 0, width: 3, height: 1, mapWidth: 3, mapHeight: 1, kinds: "...", warps, connections: [], signs: [], outside: false } as unknown as MapGrid;
}

const stairs = (x: number, to: string, num: number, warpId = 0): Warp => ({ x, y: 0, to, group: 0, num, warpId, behavior: "MB_LADDER", how: "step" });

function walk(grids: MapGrid[], places: [string, number][]) {
  let at = 0;
  const here = () => grids.find((g) => g.name === places[at][0])!;
  const game = {
    mode: () => "overworld",
    player: () => ({ x: places[at][1], y: 0 }),
    map: () => here(),
    gridOf: (_group: number, num: number) => grids.find((g) => g.num === num) ?? null,
    withObstacles: (g: MapGrid) => g,
    actorsOf: () => ({ people: [], obstacles: [] }),
    mapView: (name: string) => ({ grid: grids.find((g) => g.name === name), actors: { people: [], obstacles: [] } }),
  };
  const watch = new AtlasWatch(game as unknown as Game);
  for (at = 0; at < places.length; at++) watch.onFrame();
  return watch.atlas("player");
}

describe("the arrival of an exit", () => {
  test("an exit that the player took has the cell where the player arrived, and its pair has the cell of the warp data", () => {
    const atlas = walk([grid("A", 0, [stairs(1, "B", 1)]), grid("B", 1, [stairs(2, "A", 0)])], [["A", 1], ["B", 2]]);
    expect(mapNamed(atlas, "A").warps).toMatchObject([{ to: "B", arrival: { x: 2, y: 0 } }]);
    expect(mapNamed(atlas, "B").warps).toMatchObject([{ to: "A", arrival: { x: 1, y: 0 } }]);
  });

  test("a warp where the player arrives and that leads to another map is not taken: not all the warps are in pairs", () => {
    const atlas = walk([grid("A", 0, [stairs(1, "B", 1)]), grid("B", 1, [stairs(2, "C", 2)]), grid("C", 2, [])], [["A", 1], ["B", 2]]);
    expect(mapNamed(atlas, "A").warps).toMatchObject([{ to: "B", arrival: { x: 2, y: 0 } }]);
    expect(mapNamed(atlas, "B").warps).toMatchObject([{ to: null, arrival: null }]);
  });
});
