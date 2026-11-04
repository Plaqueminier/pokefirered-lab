import { expect, test } from "bun:test";
import type { MapGrid, Warp } from "../src/game";
import { floorLayout, mapFamily } from "./map-floors";
import { mapParts } from "./map-parts";
import { shortMapName, warpPairColors } from "./mapdraw";

function grid(rows: string[], warps: { x: number; y: number; how?: string }[]): MapGrid {
  return { x0: 0, y0: 0, width: rows[0].length, height: rows.length, mapWidth: rows[0].length, mapHeight: rows.length, kinds: rows.join(""), connections: [], warps: warps.map((w) => ({ how: "press", ...w })) } as unknown as MapGrid;
}

const partAt = (parts: Uint8Array | null, width: number, x: number, y: number) => parts?.[y * width + x];

test("a wall cuts a map in two Map parts when both have an exit", () => {
  const parts = mapParts(grid(["..#..", "..#.."], [{ x: 0, y: 0 }, { x: 4, y: 0 }]), []);
  expect(partAt(parts, 5, 0, 1)).toBe(1);
  expect(partAt(parts, 5, 4, 1)).toBe(2);
  expect(partAt(parts, 5, 2, 0)).toBe(0);
});

test("the largest Map part is the first", () => {
  const parts = mapParts(grid([".#...", ".#..."], [{ x: 0, y: 0 }, { x: 4, y: 0 }]), []);
  expect(partAt(parts, 5, 4, 0)).toBe(1);
  expect(partAt(parts, 5, 0, 0)).toBe(2);
});

test("a map with one Map part has none, and a closed room with no exit does not count", () => {
  expect(mapParts(grid(["...", "..."], [{ x: 0, y: 0 }]), [])).toBeNull();
  expect(mapParts(grid(["..#..", "..#.."], [{ x: 0, y: 0 }]), [])).toBeNull();
});

test("a ledge links both sides, and a thin wall does not", () => {
  expect(mapParts(grid([".", "v", "."], [{ x: 0, y: 0 }, { x: 0, y: 2 }]), [])).toBeNull();
  expect(partAt(mapParts(grid(["_", "."], [{ x: 0, y: 0 }, { x: 0, y: 1 }]), []), 1, 0, 1)).toBe(2);
});

test("a person who stays is a wall", () => {
  const rows = ["...", "#.#", "..."];
  const warps = [{ x: 0, y: 0 }, { x: 0, y: 2 }];
  expect(mapParts(grid(rows, warps), [])).toBeNull();
  const parts = mapParts(grid(rows, warps), [{ x: 1, y: 1 }]);
  expect(partAt(parts, 3, 1, 0)).toBe(1);
  expect(partAt(parts, 3, 1, 2)).toBe(2);
});

test("a walk does not pass through a warp that it steps on", () => {
  const parts = mapParts(grid(["..#", "#.#", "#.."], [{ x: 1, y: 1, how: "step" }, { x: 0, y: 0 }, { x: 2, y: 2 }]), []);
  expect(partAt(parts, 3, 0, 0)).toBe(1);
  expect(partAt(parts, 3, 2, 2)).toBe(2);
});

test("both ends of a pair of warps have one color, and other pairs of the floors have other colors", () => {
  const to = (num: number, warpId: number) => ({ group: 1, num, warpId }) as Warp;
  const upper = { group: 1, num: 1, warps: [to(2, 1), to(2, 0)] } as MapGrid;
  const lower = { group: 1, num: 2, warps: [to(1, 1), to(1, 0)] } as MapGrid;
  const colors = warpPairColors([upper, lower]);
  expect(colors(upper, 0)).toBe(colors(lower, 1));
  expect(colors(upper, 1)).toBe(colors(lower, 0));
  expect(colors(upper, 0)).not.toBe(colors(upper, 1));
});

test("warps with one destination have one color, also at the other end of the stairs", () => {
  const to = (num: number, warpId: number) => ({ group: 1, num, warpId }) as Warp;
  const upper = { group: 1, num: 1, warps: [to(2, 0), to(2, 0)] } as MapGrid;
  const lower = { group: 1, num: 2, warps: [to(1, 0)] } as MapGrid;
  const colors = warpPairColors([upper, lower]);
  expect(colors(upper, 0)).toBe(colors(upper, 1));
  expect(colors(upper, 1)).toBe(colors(lower, 0));
});

test("both ends of a pair that leaves the floors have one color, each end with its own floors", () => {
  const out = { group: 2, num: 1, warps: [{ group: 3, num: 1, warpId: 0 }] } as MapGrid;
  const back = { group: 3, num: 1, warps: [{ group: 2, num: 1, warpId: 0 }] } as MapGrid;
  expect(warpPairColors([out])(out, 0)).toBe(warpPairColors([back])(back, 0));
});

test("the floor shown keeps its cells, and the other floors stand at its sides", () => {
  const floor = (name: string, mapWidth: number) => ({ name, mapWidth }) as MapGrid;
  const [low, mid, top] = [floor("A_B1F", 10), floor("A_1F", 20), floor("A_2F", 5)];
  const family = ["A_B1F", "A_1F", "A_2F"];
  expect(floorLayout(mid, family, new Map([["A_B1F", low], ["A_2F", top]])).map(({ grid, dx }) => [grid.name, dx])).toEqual([["A_B1F", -19], ["A_1F", 0], ["A_2F", 29]]);
  expect(floorLayout(mid, family, new Map()).map(({ dx }) => dx)).toEqual([0]);
  expect(floorLayout(mid, [], new Map())).toEqual([{ grid: mid, dx: 0 }]);
});

test("the name of a warp loses the part that it shares with the map", () => {
  expect(shortMapName("MtMoon_B1F", "MtMoon_B2F")).toBe("B1F");
  expect(shortMapName("PewterCity_Gym", "PewterCity")).toBe("Gym");
  expect(shortMapName("PewterCity", "PewterCity_Gym")).toBe("PewterCity");
  expect(shortMapName("Route4", "MtMoon_1F")).toBe("Route4");
});

test("a family is the maps with the same stem and a floor: basements first, the roof last; another map is alone", () => {
  const names = ["MtMoon_1F", "MtMoon_B2F", "MtMoon_B1F", "SilphCo_2F", "SilphCo_1F", "SilphCo_11F", "SilphCo_Elevator", "CeladonCity_DepartmentStore_Roof", "CeladonCity_DepartmentStore_1F", "Route4"];
  expect(mapFamily("MtMoon_B1F", names)).toEqual(["MtMoon_B2F", "MtMoon_B1F", "MtMoon_1F"]);
  expect(mapFamily("SilphCo_2F", names)).toEqual(["SilphCo_1F", "SilphCo_2F", "SilphCo_11F"]);
  expect(mapFamily("CeladonCity_DepartmentStore_1F", names)).toEqual(["CeladonCity_DepartmentStore_1F", "CeladonCity_DepartmentStore_Roof"]);
  expect(mapFamily("Route4", names)).toEqual(["Route4"]);
  expect(mapFamily("SilphCo_Elevator", names)).toEqual(["SilphCo_Elevator"]);
});
