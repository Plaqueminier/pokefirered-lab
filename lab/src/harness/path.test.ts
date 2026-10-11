import { describe, expect, test } from "bun:test";
import type { Direction } from "../game";
import { type Cell, findPath, type PathGrid } from "./path";

function grid(rows: string[], x0 = 0, y0 = 0): PathGrid {
  return { kinds: rows.join(""), x0, y0, width: rows[0].length, height: rows.length };
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

describe("findPath", () => {
  test("walks in a straight line on open cells", () => {
    expect(findPath(grid(["....."]), { x: 0, y: 0 }, { x: 3, y: 0 })).toEqual(["east", "east", "east"]);
  });

  test("goes around a wall by the shortest way", () => {
    const rows = [
      "..#..",
      "..#..",
      ".....",
    ];
    const path = findPath(grid(rows), { x: 0, y: 0 }, { x: 4, y: 0 });
    expect(path).toHaveLength(8);
    expect(walk({ x: 0, y: 0 }, path!)).toEqual({ x: 4, y: 0 });
    expect(visits({ x: 0, y: 0 }, path!).some((c) => c.x === 2 && c.y < 2)).toBe(false);
  });

  test("has no path to a blocked cell", () => {
    expect(findPath(grid(["..#.."]), { x: 0, y: 0 }, { x: 2, y: 0 })).toBeNull();
  });

  test("has no path to an open cell behind walls", () => {
    const rows = [
      ".....",
      ".###.",
      ".#.#.",
      ".###.",
    ];
    expect(findPath(grid(rows), { x: 0, y: 0 }, { x: 2, y: 2 })).toBeNull();
  });

  test("does not walk on water or ledges, but walks in tall grass", () => {
    expect(findPath(grid(['.~.']), { x: 0, y: 0 }, { x: 2, y: 0 })).toBeNull();
    expect(findPath(grid(['.v.']), { x: 0, y: 0 }, { x: 2, y: 0 })).toBeNull();
    expect(findPath(grid(['.".']), { x: 0, y: 0 }, { x: 2, y: 0 })).toEqual(["east", "east"]);
  });

  test("uses map coordinates when the grid has a border", () => {
    const rows = [
      "####",
      "#..#",
      "####",
    ];
    expect(findPath(grid(rows, -1, -1), { x: 0, y: 0 }, { x: 1, y: 0 })).toEqual(["east"]);
    expect(findPath(grid(rows, -1, -1), { x: 0, y: 0 }, { x: 0, y: -1 })).toBeNull();
  });

  test("has an empty path to the cell where the player is", () => {
    expect(findPath(grid(["..."]), { x: 1, y: 0 }, { x: 1, y: 0 })).toEqual([]);
  });

  test("has no path to a cell outside the grid", () => {
    expect(findPath(grid(["..."]), { x: 0, y: 0 }, { x: 5, y: 0 })).toBeNull();
  });

  test("finds the stairs from the bed in PalletTown_PlayersHouse_2F", () => {
    const wall = "#".repeat(27);
    const rows = [
      ...Array(9).fill(wall),
      "########.......##..########",
      "########.......##..########",
      "########.....#.....########",
      "########.....#.....########",
      "########.#.........########",
      "########...........########",
      "########...........########",
      ...Array(7).fill(wall),
    ];
    const path = findPath(grid(rows, -7, -7), { x: 6, y: 6 }, { x: 10, y: 2 });
    expect(path).toHaveLength(8);
    expect(walk({ x: 6, y: 6 }, path!)).toEqual({ x: 10, y: 2 });
  });
});
