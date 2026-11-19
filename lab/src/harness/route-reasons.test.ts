import { describe, expect, test } from "bun:test";
import type { AtlasMap } from "./atlas";
import { elevationReason, LoopGuard } from "./route-reasons";

const cliff = (elevations: string): AtlasMap => ({
  name: "Cliff",
  width: 6,
  height: 1,
  cells: "......",
  elevations,
  warps: [],
  edges: [],
  hasEdges: false,
  outside: false,
  signs: [],
  people: [],
  obstacles: [],
  entry: null,
  stepExits: [],
  slides: [],
  parts: [],
});

describe("a goTo to another elevation", () => {
  test("names the other level and the stairs, as the prompt says", () => {
    expect(elevationReason(cliff("333444"), { x: 0, y: 0 }, { x: 5, y: 0 })).toBe(
      "(5, 0) is on another level of Cliff than you, and no stairs that you saw join the two levels. A step from one level to the next is possible only on stairs, and no route that you know reaches it now: explore other exits first",
    );
  });

  test("names a cell of the other elevation next to the elevation of the player, at the edge of the raised cells", () => {
    expect(elevationReason(cliff("333444"), { x: 0, y: 0 }, { x: 3, y: 0 })).toStartWith("(3, 0) is on another level of Cliff than you");
  });

  test("says nothing when stairs join the elevations, when the map keeps no elevations, or for a cell that the player did not see", () => {
    expect(elevationReason(cliff("330444"), { x: 0, y: 0 }, { x: 5, y: 0 })).toBeNull();
    expect(elevationReason({ ...cliff("333444"), cells: ".....?" }, { x: 0, y: 0 }, { x: 5, y: 0 })).toBeNull();
    expect(elevationReason({ ...cliff("333333"), elevations: undefined }, { x: 0, y: 0 }, { x: 5, y: 0 })).toBeNull();
  });
});

describe("a walk that arrives again on a map", () => {
  test("a walk that arrives again on a cell of another map stops", () => {
    const loop = new LoopGuard();
    const on = (map: string) => ({ map, x: 1, y: 0 });
    expect([loop.arrive(on("SilphCo_2F")), loop.arrive(on("SilphCo_3F")), loop.arrive(on("SilphCo_2F"))]).toEqual([null, null, null]);
    expect(loop.arrive(on("SilphCo_3F"))).toBe("the walk arrives again at SilphCo_3F (1, 0): the way to the target through the other maps is not open");
  });
});
