import { describe, expect, test } from "bun:test";
import type { MapActors, MapGrid, Warp } from "../src/game";
import { exitList, stopList } from "./map-lists";

const warp = (x: number, y: number, to: string, num: number): Warp => ({ x, y, to, warpId: 0, group: 1, num, behavior: "MB_NORMAL", place: null, how: "step" });
const trigger = (x: number, y: number) => ({ x, y, variable: 0x4050, value: 1, weather: false });

const grid = {
  connections: [{ direction: "north", offset: 0, map: "Route24", group: 3, num: 2 }],
  warps: [warp(0, 4, "SaffronCity_Gym", 7), warp(5, 28, "SaffronCity", 0), warp(0, 7, "SaffronCity_Gym", 7), warp(9, 2, "SaffronCity_Gym", 7)],
  triggers: [trigger(1, 1), trigger(2, 1), { ...trigger(3, 1), weather: true }, trigger(4, 1), trigger(5, 1), trigger(6, 1)],
} as unknown as MapGrid;

const person = (localId: number, x: number, defeated: boolean) => ({ localId, x, y: 9, graphics: "", facing: 1, loaded: true, trainer: { id: 100 + localId, defeated, range: 3, allDirections: false, sight: [] } });

const actors = {
  people: [person(1, 7, false), { ...person(2, 8, true), trainer: undefined }, person(3, 9, true)],
  triggers: [false, true, null, false, null, false],
} as unknown as MapActors;

describe("the lists of the Whole map", () => {
  test("the warps to the same map make one row, the edges stay rows", () => {
    const { count, rows } = exitList(grid);
    expect(count).toBe(5);
    expect(rows.map((row) => [row.cell, row.to])).toEqual([
      ["north", "Route24"],
      ["3 warps", "SaffronCity_Gym"],
      ["5, 28", "SaffronCity"],
    ]);
    expect(rows[1].tip).toBe("3 warps → SaffronCity_Gym: 0, 4 · 0, 7 · 9, 2");
  });

  test("the trainers and the active triggers come first, then a group of 2 or more inactive triggers", () => {
    const { count, items } = stopList(grid, actors);
    expect(count).toBe(7);
    expect(items.map((item) => (item.type === "group" ? `${item.text} (${item.rows.length})` : `${item.text} ${item.state}`))).toEqual([
      "Trigger active",
      "Trainer 101 not beaten",
      "Trainer 103 beaten",
      "Inactive triggers (3)",
      "Trigger state unknown",
    ]);
  });
});
