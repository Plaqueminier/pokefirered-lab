import { describe, expect, test } from "bun:test";
import { ELEVATION_SHIFT } from "../cells";
import type { MapGrid } from "../game";
import { fake } from "../harness/fakes";
import { approaches, interactCell, type Overworld } from "./targets";

const COUNTER = 1;

function room(rows: string[]): MapGrid {
  const width = rows[0].length;
  const cells = rows.join("");
  return fake<MapGrid>({
    key: "1.1",
    group: 1,
    num: 1,
    name: "Room",
    x0: 0,
    y0: 0,
    width,
    height: rows.length,
    mapWidth: width,
    mapHeight: rows.length,
    kinds: [...cells].map((c) => (/\d/.test(c) ? "." : "#")).join(""),
    outside: false,
    cave: false,
    allowsRunning: true,
    allowsBiking: true,
    blocks: [...cells].map((c) => (/\d/.test(c) ? Number(c) : c === "C" ? 3 : 0) << ELEVATION_SHIFT),
    behaviors: [...cells].map((c) => (c === "C" ? COUNTER : 0)),
    behaviorNames: { 0: "MB_NORMAL", [COUNTER]: "MB_COUNTER" },
    warps: [],
    connections: [],
    signs: [],
    triggers: [],
  });
}

function overworld(grid: MapGrid, player: { x: number; y: number }, people: { localId: number; x: number; y: number }[]): Pick<Overworld, "grid" | "player" | "people"> {
  return fake<Pick<Overworld, "grid" | "player" | "people">>({ grid, player: { ...player, facing: "north" }, people: people.map((p) => ({ ...p, graphics: "GENTLEMAN", loaded: true, stays: true })) });
}

describe("the cells to talk to a person", () => {
  const fanClub = room(["33333", "33333", "30440", "33##3"]);
  const seat = { x: 2, y: 2 };
  const chairman = { localId: 1, ...seat };
  const worker = { localId: 2, x: 3, y: 2 };

  test("a cell at another elevation than the person is not a talk cell, and a cell of elevation 0 is", () => {
    expect(approaches({ kind: "person", cell: chairman }, overworld(fanClub, { x: 2, y: 1 }, [chairman, worker]))).toEqual([{ x: 1, y: 2 }]);
  });

  test("an A press reaches the person only from a cell whose elevation matches", () => {
    expect(interactCell({ kind: "person", cell: seat }, fanClub, { x: 2, y: 1 })).toBeNull();
    expect(interactCell({ kind: "person", cell: seat }, fanClub, { x: 1, y: 2 })).toEqual(seat);
  });

  test("across a counter, the elevation of the player and of the person must also match", () => {
    const shop = room(["33", "CC", "34"]);
    expect(approaches({ kind: "person", cell: { x: 0, y: 2 } }, overworld(shop, { x: 1, y: 0 }, [{ localId: 1, x: 0, y: 2 }]))).toEqual([{ x: 0, y: 0 }]);
    expect(interactCell({ kind: "person", cell: { x: 0, y: 2 } }, shop, { x: 0, y: 0 })).toEqual({ x: 0, y: 1 });
    expect(interactCell({ kind: "person", cell: { x: 1, y: 2 } }, shop, { x: 1, y: 0 })).toBeNull();
  });
});
