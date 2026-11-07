import { describe, expect, test } from "bun:test";
import type { AtlasMap } from "./atlas";
import { type Cell, type MapCells, type RouteMap, walkable } from "./path";
import { noFootWayReason } from "./route-reasons";
import { numberParts, partAt, partNear, routeOntoSpin, slideEnd, withOpenTile } from "./slides";

function cells(rows: string[]): MapCells {
  const width = rows[0].length;
  return { kinds: rows.join(""), x0: 0, y0: 0, width, mapWidth: width, mapHeight: rows.length };
}

const known = () => true;
const noOne = () => false;

describe("the end of a Slide", () => {
  test("the player slides in the direction of the arrow and stops before a blocked cell", () => {
    expect(slideEnd(cells(["#####", "#→..#", "#####"]), { x: 1, y: 1 }, known, noOne)).toEqual({ x: 3, y: 1 });
  });

  test("another spin tile on the way changes the direction, and a stop tile ends the slide", () => {
    expect(slideEnd(cells(["######", "#→..↓#", "#...o#", "#....#", "######"]), { x: 1, y: 1 }, known, noOne)).toEqual({ x: 4, y: 2 });
  });

  test("a person on the way stops the player on the cell before it", () => {
    expect(slideEnd(cells(["######", "#→...#", "######"]), { x: 1, y: 1 }, known, (c) => c.x === 4)).toEqual({ x: 3, y: 1 });
  });

  test("the player stops on the spin tile when the next cell is blocked", () => {
    expect(slideEnd(cells(["####", "#.←#", "#..#", "####"]), { x: 2, y: 1 }, known, noOne)).toEqual({ x: 1, y: 1 });
    expect(slideEnd(cells(["####", "#↑.#", "####"]), { x: 1, y: 1 }, known, noOne)).toEqual({ x: 1, y: 1 });
  });

  test("a way through a cell that the player did not see, and a way that turns around for ever, have no known end", () => {
    expect(slideEnd(cells(["######", "#→...#", "######"]), { x: 1, y: 1 }, (c) => c.x < 3, noOne)).toBeNull();
    expect(slideEnd(cells(["####", "#→↓#", "#↑←#", "####"]), { x: 1, y: 1 }, known, noOne)).toBeNull();
  });
});

const MAZE = ["######", "#...↓#", "#.##.#", "#.##.#", "######"];

function atlasMap(rows: string[], more: Partial<AtlasMap> = {}): AtlasMap {
  const width = rows[0].length;
  const view = cells(rows.map((row) => row.replaceAll("?", "#")));
  const parts = numberParts(view, (c) => rows[c.y][c.x] !== "?" && walkable(view, c), []);
  return { name: "Maze", width, height: rows.length, cells: rows.join(""), warps: [], edges: [], hasEdges: false, outside: false, signs: [], people: [], obstacles: [], entry: null, stepExits: [], slides: [], parts, ...more };
}

describe("the Parts of a map with spin tiles", () => {
  const at = (map: AtlasMap, x: number, y: number) => partNear(map, { x, y });

  test("the first numbers of the Parts follow their first cell, row by row, and a spin tile takes the Part of the first open cell next to it: north, south, west, then east", () => {
    const maze = atlasMap(MAZE);
    expect([at(maze, 1, 1), at(maze, 3, 1), at(maze, 1, 2), at(maze, 1, 3), at(maze, 4, 2), at(maze, 4, 3)]).toEqual([1, 1, 1, 1, 2, 2]);
    expect(partAt(maze, { x: 4, y: 1 })).toBe(0);
    expect(at(maze, 4, 1)).toBe(2);
    expect(at(maze, 0, 0)).toBeNull();
  });

  test("a Part keeps its number when the player sees more: a new Part takes the next number, and two Parts that join keep the lower number", () => {
    const view = cells(["#####", "#.#.#", "#...#", "#####"]);
    const open = (seen: string[]) => (c: Cell) => seen.includes(`${c.x},${c.y}`) && walkable(view, c);
    const first = numberParts(view, open(["3,1"]), []);
    const more = numberParts(view, open(["3,1", "1,1"]), first);
    const all = numberParts(view, open(["3,1", "1,1", "1,2", "2,2", "3,2"]), more);
    const part = (parts: number[], x: number, y: number) => partAt({ parts, width: 5, height: 4 }, { x, y });
    expect([part(first, 3, 1), part(more, 3, 1), part(more, 1, 1), part(all, 1, 1), part(all, 2, 2)]).toEqual([1, 1, 2, 1, 1]);
  });

  test("a goTo to another Part names the two Parts and the slides", () => {
    expect(noFootWayReason(atlasMap(MAZE), { x: 1, y: 3 }, { x: 4, y: 3 })).toBe("(4, 3) is in Part 2, and you are in Part 1: no way on foot. Only a slide leaves Part 1: goTo one of its spin tiles");
  });

  test("with no slide out of the Part of the player, or a target in the same Part or not seen, it says nothing", () => {
    expect(noFootWayReason(atlasMap(MAZE), { x: 4, y: 3 }, { x: 1, y: 1 })).toBeNull();
    expect(noFootWayReason(atlasMap(MAZE), { x: 1, y: 3 }, { x: 3, y: 1 })).toBeNull();
    expect(noFootWayReason(atlasMap(["######", "#...↓#", "#.##?#", "#.##?#", "######"]), { x: 1, y: 3 }, { x: 4, y: 3 })).toBeNull();
    expect(noFootWayReason(atlasMap(["####", "#..#", "####"]), { x: 1, y: 1 }, { x: 2, y: 1 })).toBeNull();
  });

  test("the route onto a spin tile ends with the step from the cell next to it that the search chooses", () => {
    const rows = ["#####", "#...#", "#.#→#", "#...#", "#####"];
    const map = { name: "Maze", ...cells(rows), warps: [], connections: [], people: [], obstacles: [], removable: [] } as unknown as RouteMap;
    const maps = (name: string) => (name === "Maze" ? map : null);
    const tile = { map: "Maze", x: 3, y: 2 };
    expect(routeOntoSpin({ map: "Maze", x: 1, y: 1 }, tile, withOpenTile(maps, tile))).toEqual({ from: { map: "Maze", x: 3, y: 1 }, direction: "south" });
    expect(routeOntoSpin({ map: "Maze", x: 1, y: 3 }, tile, withOpenTile(maps, tile))).toEqual({ from: { map: "Maze", x: 3, y: 3 }, direction: "north" });
  });
});
