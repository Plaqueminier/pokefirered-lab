import { describe, expect, test } from "bun:test";
import type { MapGrid } from "../game";
import { type AtlasMap, atlasCells, atlasWarps } from "../harness/atlas";
import { walkable } from "../harness/path";
import { hasSpinTiles, numberParts } from "../harness/slides";
import type { Person } from "../harness/harness";
import { atlasExtract, FULL_ATLAS_BUDGET, fullAtlas, knownWorld, MAX_FAR_MAPS, OTHER_MAPS_BUDGET } from "./extract";
import type { Overworld } from "./targets";

const LAB: AtlasMap = {
  name: "Lab",
  width: 5,
  height: 4,
  cells: "#####" + "#..?#" + "#..?#" + "##.##",
  warps: [
    { x: 2, y: 3, behavior: "MB_SOUTH_ARROW_WARP", place: null, to: "Town", arrival: null },
    { x: 0, y: 1, behavior: "MB_WARP_DOOR", place: null, to: null, arrival: null },
  ],
  edges: [],
  hasEdges: false,
  outside: false,
  signs: [],
  people: [],
  obstacles: [],
  entry: { x: 2, y: 2 },
  stepExits: [],
  slides: [],
  parts: [],
};

function overworld(current: AtlasMap, others: AtlasMap[], player = { x: 1, y: 2 }, people: Person[] = []): Overworld {
  const kinds = current.cells.replaceAll("?", ".");
  const size = current.width * current.height;
  const grid = { name: current.name, x0: 0, y0: 0, width: current.width, height: current.height, mapWidth: current.width, mapHeight: current.height, kinds, behaviors: Array(size).fill(0), behaviorNames: { 0: "MB_NORMAL" }, connections: [], signs: [] } as unknown as MapGrid;
  return {
    mode: "overworld",
    waitingFor: { kind: "walk" },
    party: [],
    bag: [],
    teachables: [],
    boxes: [],
    pcItems: [],
    repelActive: false, riding: false, rideChosen: false,
    money: 0,
    milestones: [],
    map: { group: 0, num: 0, name: current.name },
    mapKind: "outdoor",
    player: { ...player, facing: "north" },
    grid,
    people,
    atlas: { maps: [current, ...others], lastTalk: null },
  };
}

function chain(routes: number): AtlasMap[] {
  const names = ["Town", ...Array.from({ length: routes }, (_, i) => `Route${i}`)];
  return names.map((name, i) => ({
    name,
    width: 24,
    height: 40,
    cells: ".".repeat(24 * 40),
    warps: [],
    edges: [
      { side: "south", to: i === 0 ? null : names[i - 1] },
      { side: "north", to: names[i + 1] ?? null },
    ],
    hasEdges: true,
    outside: true,
    signs: [],
    people: [],
    obstacles: [],
    entry: { x: 5, y: 5 },
    stepExits: [],
    slides: [],
    parts: [],
  }));
}

describe("the exits of the Atlas", () => {
  const cell = (x: number, to = "Gate") => ({ x, y: 9, to, warpId: 0, group: 0, num: 0, behavior: "MB_CAVE_DOOR", toKind: "indoor" as const, how: "step" as const });
  const seen = () => true;

  test("the neighbour cells of a wide exit are one exit, and a walk through one cell takes the whole exit; other maps and far cells stay other exits", () => {
    expect(atlasWarps({ warps: [cell(4), cell(5), cell(6)], outside: false }, new Map(), seen)).toEqual([{ x: 4, y: 9, behavior: "MB_CAVE_DOOR", place: null, to: null, arrival: null }]);
    expect(atlasWarps({ warps: [cell(4), cell(5), cell(6)], outside: false }, new Map([["5,9", { to: "Gate", arrival: { x: 3, y: 3 } }]]), seen)).toEqual([{ x: 5, y: 9, behavior: "MB_CAVE_DOOR", place: null, to: "Gate", arrival: { x: 3, y: 3 } }]);
    expect(atlasWarps({ warps: [cell(4, "Gate"), cell(5, "House")], outside: false }, new Map(), seen)).toHaveLength(2);
    expect(atlasWarps({ warps: [cell(4), cell(8)], outside: false }, new Map(), seen)).toHaveLength(2);
  });
});

describe("what is left on a floor", () => {
  const ladder = (x: number, to: string | null, arrival: { x: number; y: number } | null): AtlasMap["warps"][number] => ({ x, y: 1, behavior: "MB_LADDER", place: null, to, arrival });
  const floor = (name: string, row: string, warps: AtlasMap["warps"]): AtlasMap => ({ ...LAB, name, width: 16, height: 3, cells: "#".repeat(16) + row.padEnd(16, "#") + "#".repeat(16), warps, stepExits: warps.map(({ x, y }) => ({ x, y })), entry: null });
  const upper = floor("Upper", "#....?#?..#", [ladder(1, "Lower", { x: 3, y: 1 }), ladder(9, "Lower", { x: 4, y: 1 })]);
  const lower = floor("Lower", "#?...#", [ladder(3, "Upper", { x: 1, y: 1 }), ladder(4, "Upper", { x: 9, y: 1 })]);

  test("the list counts your part, the other parts of the map and the floors behind the exits, with the nearest unseen place of your part", () => {
    const { left, lines } = atlasExtract(overworld(upper, [lower], { x: 2, y: 1 }));
    const letter = lines.find((line) => line.includes("unseen cells east of (4, 1), 2 east"))?.[0];
    expect(left).toEqual([
      "What is left (from the game, not from your notes: if your Memory tree disagrees, this list is right):",
      `- Upper, your part: 1 unseen place, the nearest 2 east (go ${letter}).`,
      "- Lower, 1 exit away: 1 unseen place.",
      "- Upper, other parts, 2 exits away: 1 unseen place.",
    ]);
  });

  test("an unseen place that no part reaches has no seen way yet", () => {
    const gap = floor("Gap", "#..#..?#", []);
    expect(atlasExtract(overworld(gap, [], { x: 1, y: 1 })).left).toEqual([
      "What is left (from the game, not from your notes: if your Memory tree disagrees, this list is right):",
      "- Gap, other parts, no seen way yet: 1 unseen place.",
    ]);
  });

  test("with nothing left, the list says so; a map that fits on the screen or has edges has no list", () => {
    const done = floor("Done", "#...#", []);
    expect(atlasExtract(overworld(done, [], { x: 1, y: 1 })).left.at(-1)).toBe("- Nothing that a way that you saw reaches: to go on, take an exit to another map.");
    expect(atlasExtract(overworld(LAB, [])).left).toEqual([]);
    expect(atlasExtract(overworld({ ...done, hasEdges: true }, [], { x: 1, y: 1 })).left).toEqual([]);
  });

  test("the letters of a floor follow the cells and not the distance, so a walk does not change them", () => {
    const hall = floor("Hall", "..............", []);
    const people = [{ localId: 1, graphics: "MAN", x: 2, y: 1, loaded: true, stays: false }, { localId: 2, graphics: "LASS", x: 12, y: 1, loaded: true, stays: false }];
    const atlasPeople = people.map((p) => ({ ...p, texts: [] }));
    const labels = (x: number) => atlasExtract(overworld({ ...hall, people: atlasPeople }, [], { x, y: 1 }, people)).targets.map((t) => t.label.split(" at ")[0]);
    expect(labels(10)).toEqual(labels(3));
    expect(labels(10)).toEqual(["MAN", "LASS"]);
  });
});

describe("the unseen cells of a map that is dark for the model", () => {
  const room = (dark: boolean): AtlasMap => ({ ...LAB, name: "Dark", width: 9, height: 5, cells: "?".repeat(9) + "?.......?".repeat(3) + "?".repeat(9), warps: [], entry: null, ...(dark ? { dark: { missingBadge: null } } : {}) });
  const unseen = (dark: boolean) => atlasExtract(overworld(room(dark), [], { x: 4, y: 2 })).lines.filter((line) => line.includes("unseen cells"));

  test("each direction of a group has one target, at the cell nearest to the player", () => {
    expect(unseen(true).map((line) => line.slice(3))).toEqual(["unseen cells north of (4, 1), adjacent north, you face it", "unseen cells south of (4, 3), adjacent south", "unseen cells west of (1, 2), 3 west", "unseen cells east of (7, 2), 3 east"]);
  });

  test("on another map, a group has one target", () => {
    expect(unseen(false)).toHaveLength(1);
  });

  test("the target keeps the direction of its unseen cells", () => {
    const { targets } = atlasExtract(overworld(room(true), [], { x: 4, y: 2 }));
    expect(targets.filter((target) => target.kind === "frontier")).toContainEqual(expect.objectContaining({ cell: { x: 7, y: 2 }, direction: "east" }));
  });
});

describe("the parts of a map", () => {
  const stairs = (x: number, to: string): AtlasMap["warps"][number] => ({ x, y: 1, behavior: "MB_UP_RIGHT_STAIR_WARP", place: null, to, arrival: { x, y: 1 } });
  const floor = (name: string, row: string, to: string, more: Partial<AtlasMap> = {}): AtlasMap => ({ ...LAB, name, width: 16, height: 3, cells: "#".repeat(16) + row.padEnd(16, "#") + "#".repeat(16), warps: [stairs(1, to), stairs(7, to)], stepExits: [{ x: 1, y: 1 }, { x: 7, y: 1 }], entry: null, ...more });
  const upper = floor("Upper", "#.......#", "Lower");
  const lower = floor("Lower", "#..?#...#", "Upper");

  test("an exit shows its arrival cell and what is beyond it, and the unseen cells of a part behind an exit stay a target", () => {
    const view = atlasExtract(overworld(upper, [lower], { x: 4, y: 1 }));
    expect(view.lines).toContain("Leads, what you did not explore in other parts and maps:");
    expect(view.lines).toContain("A. unseen cells east of (2, 1) on Lower, 1 exit away");
    expect(view.lines).toContain("B. stairs at (1, 1), 3 west: to Lower (1, 1), taken; beyond it: unseen cells");
    expect(view.lines).toContain("C. stairs at (7, 1), 3 east: to Lower (7, 1), taken; beyond it: nothing new");
    expect(view.targets.at(0)).toMatchObject({ kind: "lead", map: "Lower", cell: { x: 2, y: 1 } });
  });

  test("the line of a neighbour map shows, for each part where its exits arrive, the exits of that part only", () => {
    const view = atlasExtract(overworld(upper, [lower], { x: 4, y: 1 }));
    expect(view.lines).toContain("- B (stairs) leads to Lower. From there you can walk to: stairs at (1, 1), to Upper (1, 1).");
    expect(view.lines).toContain("- C (stairs) leads to Lower. From there you can walk to: stairs at (7, 1), to Upper (7, 1).");
  });

  test("an exit or a person in another part of the map shows how far it is in exits, comes after the targets of the part, and the unseen cells of the other part stay a lead, at the top of the targets", () => {
    const rocket = { localId: 2, graphics: "ROCKET_M", x: 2, y: 1, loaded: true, stays: false };
    const view = atlasExtract(overworld({ ...lower, people: [{ ...rocket, texts: [] }] }, [upper], { x: 6, y: 1 }, [rocket]));
    expect(view.lines).toContain("A. unseen cells east of (2, 1) in another part of this map, 2 exits away");
    expect(view.lines).toContain("B. stairs at (7, 1), adjacent east: to Upper (7, 1), taken; beyond it: unseen cells");
    expect(view.lines).toContain("C. stairs at (1, 1), in another part of this map, 2 exits away: to Upper (1, 1), taken; beyond it: unseen cells");
    expect(view.lines).toContain("D. ROCKET M at (2, 1), in another part of this map, 2 exits away");
    expect(view.targets.at(2)).toMatchObject({ kind: "exit", cell: { x: 1, y: 1 } });
  });

  test("with no unseen cell in the part of the player, the extract tells to take an exit or a lead", () => {
    const view = atlasExtract(overworld(lower, [upper], { x: 6, y: 1 }));
    expect(view.lines).toContain("You saw all the cells that you can reach from here on this map. Other parts of it can have unseen cells: to go on, take an exit or a lead.");
    expect(atlasExtract(overworld(lower, [upper], { x: 2, y: 1 })).lines).not.toContainEqual(expect.stringContaining("You saw all the cells"));
  });

  test("the cell next to an exit not taken is never a step on another cell of a wide exit: go has no route to such a cell", () => {
    const holes = floor("Lower", "#.......#", "Upper", { warps: [stairs(1, "Upper"), { x: 7, y: 1, behavior: "MB_UP_RIGHT_STAIR_WARP", place: null, to: null, arrival: null }], stepExits: [{ x: 1, y: 1 }, { x: 6, y: 1 }, { x: 7, y: 1 }] });
    const view = atlasExtract(overworld({ ...upper, warps: [stairs(1, "Lower")] }, [holes], { x: 4, y: 1 }));
    expect(view.targets.filter((t) => t.kind === "lead")).toEqual([]);
  });

  test("an exit not taken on another map is a lead, and go walks next to it", () => {
    const below = floor("Lower", "#.......#", "Upper", { warps: [stairs(1, "Upper"), { x: 7, y: 1, behavior: "MB_UP_RIGHT_STAIR_WARP", place: null, to: null, arrival: null }], stepExits: [{ x: 1, y: 1 }, { x: 7, y: 1 }] });
    const view = atlasExtract(overworld({ ...upper, warps: [stairs(1, "Lower")] }, [below], { x: 4, y: 1 }));
    expect(view.lines).toContain("A. stairs at (7, 1) on Lower, not taken, 1 exit away: go walks next to it");
    expect(view.lines).toContain("B. stairs at (1, 1), 3 west: to Lower (1, 1), taken; beyond it: an exit not taken");
    expect(view.targets.at(0)).toMatchObject({ kind: "lead", map: "Lower", cell: { x: 6, y: 1 } });
  });

  test("a thin wall ends the part, and the unseen cells behind it are not a target", () => {
    const walled: AtlasMap = { ...LAB, name: "Cave", width: 3, height: 4, cells: "..." + "..." + "---" + "???", warps: [], entry: null };
    const view = atlasExtract(overworld(walled, [], { x: 1, y: 1 }));
    expect(view.lines.join("\n")).not.toContain("unseen cells south");
    expect(view.lines).toContain("You saw all the cells that you can reach from here on this map. Other parts of it can have unseen cells: to go on, take an exit or a lead.");
  });

  test("the unseen cells of a room that fits on the screen are no lead, and they are not beyond an exit", () => {
    const room = { ...lower, width: 9, cells: "#########" + "#..?#...#" + "#########" };
    const view = atlasExtract(overworld(upper, [room], { x: 4, y: 1 }));
    expect(view.lines).toContain("A. stairs at (1, 1), 3 west: to Lower (1, 1), taken; beyond it: nothing new");
    expect(view.targets.filter((t) => t.kind === "lead")).toEqual([]);
  });

  test("a door next to the part of the player is in that part: the way back through a house is not another part", () => {
    const town: AtlasMap = { ...LAB, name: "Town", outside: true, width: 16, height: 2, cells: "#".repeat(16) + ".".repeat(16), warps: [{ x: 3, y: 0, behavior: "MB_WARP_DOOR", place: null, to: "House", arrival: { x: 1, y: 1 } }], entry: null };
    const house = { ...upper, name: "House", warps: [{ ...stairs(1, "Town"), arrival: { x: 3, y: 0 } }] };
    const view = atlasExtract(overworld(town, [house], { x: 3, y: 1 }));
    expect(view.lines).toContain("A. door at (3, 0), adjacent north, you face it: to House (1, 1), taken; beyond it: nothing new");
    expect(view.lines.join("\n")).not.toContain("another part");
  });

  test("a thin wall on a cell that the player did not see stays unknown: the unseen cells stay a target", () => {
    const hidden: AtlasMap = { ...LAB, name: "Cave", width: 3, height: 3, cells: "..." + "..." + "???", warps: [], entry: null };
    const ow = overworld(hidden, [], { x: 1, y: 1 });
    const view = atlasExtract({ ...ow, grid: { ...ow.grid, kinds: "..." + "..." + "---" } });
    expect(view.lines).toContain("A. unseen cells south of (1, 1), you stand on it");
    expect(view.lines.join("\n")).not.toContain("You saw all the cells");
  });

  test("a target with no seen way to it keeps its direction, and an exit there says that no seen way goes there yet", () => {
    const gap: AtlasMap = { ...LAB, name: "Gap", width: 16, height: 1, cells: "..?.............", warps: [{ x: 5, y: 0, behavior: "MB_UP_RIGHT_STAIR_WARP", place: null, to: null, arrival: null }], stepExits: [{ x: 5, y: 0 }], entry: null };
    const view = atlasExtract(overworld(gap, [], { x: 0, y: 0 }));
    expect(view.lines).toContain("A. stairs at (5, 0), 5 east, no seen way there yet: not taken");
  });

  test("an edge in another part shows the number of exits to it, not a direction", () => {
    const road: AtlasMap = { ...LAB, name: "Road", outside: true, width: 16, height: 3, cells: "#".repeat(16) + "..#..#.........." + "#".repeat(16), warps: [{ x: 0, y: 1, behavior: "MB_CAVE_DOOR", place: null, to: "Cave", arrival: { x: 1, y: 1 } }, { x: 3, y: 1, behavior: "MB_CAVE_DOOR", place: null, to: "Cave", arrival: { x: 7, y: 1 } }], stepExits: [{ x: 0, y: 1 }, { x: 3, y: 1 }], edges: [{ side: "east", to: "Town" }], hasEdges: true, entry: null };
    const cave = { ...upper, name: "Cave", warps: [{ ...stairs(1, "Road"), arrival: { x: 0, y: 1 } }, { ...stairs(7, "Road"), arrival: { x: 3, y: 1 } }] };
    const view = atlasExtract(overworld(road, [cave], { x: 1, y: 1 }));
    expect(view.lines).toContain("C. east edge, 15 east, no seen way there yet: to Town, taken");
    const beside = atlasExtract(overworld({ ...road, cells: "#".repeat(16) + "..#............." + "#".repeat(16) }, [cave], { x: 1, y: 1 }));
    expect(beside.lines).toContain("C. east edge, in another part of this map, 2 exits away: to Town, taken");
  });

  test("a way through a gate, an outdoor map and a second gate counts its exits: the edge and the gate past it are in another part, and a place with no taken way stays with no seen way", () => {
    const door = (x: number, y: number, to: string, arrival: { x: number; y: number } | null) => ({ x, y, behavior: "MB_CAVE_DOOR", place: null, to, arrival });
    const route: AtlasMap = {
      ...LAB,
      name: "Route",
      outside: true,
      width: 16,
      height: 5,
      cells: "#".repeat(16) + "###............." + "#".repeat(16) + "..##############" + "#".repeat(16),
      warps: [door(0, 3, "SouthGate", { x: 1, y: 1 }), door(3, 1, "NorthGate", { x: 7, y: 1 })],
      stepExits: [{ x: 0, y: 3 }, { x: 3, y: 1 }],
      edges: [{ side: "east", to: "Town" }],
      hasEdges: true,
      entry: null,
    };
    const gate = (name: string, west: AtlasMap["warps"][number], east: AtlasMap["warps"][number]): AtlasMap => ({ ...floor(name, "#.......#", "Route"), warps: [west, east], stepExits: [] });
    const southGate = gate("SouthGate", door(1, 1, "Route", { x: 0, y: 3 }), door(7, 1, "Forest", { x: 1, y: 1 }));
    const forest: AtlasMap = { ...floor("Forest", "#.......#", "SouthGate"), outside: true, warps: [door(1, 1, "SouthGate", { x: 7, y: 1 }), door(7, 1, "NorthGate", { x: 1, y: 1 })], stepExits: [] };
    const northGate = gate("NorthGate", door(1, 1, "Forest", { x: 7, y: 1 }), door(7, 1, "Route", { x: 3, y: 1 }));
    const view = atlasExtract(overworld(route, [southGate, forest, northGate], { x: 1, y: 3 }));
    expect(view.lines).toContainEqual(expect.stringContaining("entrance at (3, 1), in another part of this map, 4 exits away"));
    expect(view.lines).toContainEqual(expect.stringContaining("east edge, in another part of this map, 4 exits away"));
    const closed = atlasExtract(overworld({ ...route, warps: [route.warps[0]] }, [southGate, { ...forest, warps: [forest.warps[0]] }], { x: 1, y: 3 }));
    expect(closed.lines).toContainEqual(expect.stringContaining("east edge, 15 east, no seen way there yet"));
  });

  test("each group of open cells next to unseen cells is one target, at its nearest cell: two groups on one side are two targets, and one group with two sides is one target", () => {
    const pockets: AtlasMap = { ...LAB, name: "Field", width: 16, height: 3, cells: "?#######??##?###" + "................" + "############?###", warps: [], entry: null };
    const view = atlasExtract(overworld(pockets, [], { x: 3, y: 1 }));
    expect(view.lines.filter((line) => line.includes("unseen cells"))).toEqual([
      "A. unseen cells north of (0, 1), 3 west",
      "B. unseen cells north of (8, 1), 5 east",
      "C. unseen cells north of (12, 1), 9 east",
    ]);
  });

  test("a ledge with an unseen landing is an unseen side of the part", () => {
    const ledge: AtlasMap = { ...LAB, name: "Hill", width: 3, height: 3, cells: "..." + "vvv" + "???", warps: [], entry: null };
    const view = atlasExtract(overworld(ledge, [], { x: 1, y: 0 }));
    expect(view.lines).toContain("A. unseen cells south of (1, 0), you stand on it");
    expect(view.lines.join("\n")).not.toContain("You saw all the cells");
  });

  test("the line of a neighbour map with no exit seen from the arrival gives all the exits of the map", () => {
    const pit: AtlasMap = { ...floor("Pit", "#.......#", "Upper"), warps: [{ ...stairs(7, "Upper"), arrival: null }], stepExits: [{ x: 7, y: 1 }], cells: "#".repeat(16) + "#..#....#".padEnd(16, "#") + "#".repeat(16) };
    const view = atlasExtract(overworld({ ...upper, warps: [{ ...stairs(1, "Pit"), arrival: { x: 1, y: 1 } }] }, [pit], { x: 4, y: 1 }));
    expect(view.lines).toContain("- A (stairs) leads to Pit. Its exits (cells of Pit): stairs at (7, 1), to Upper.");
  });

  test("a walk does not continue past an exit: a stairs cell ends the part", () => {
    const hall: AtlasMap = { ...LAB, name: "Hall", width: 5, height: 1, cells: "...?.", warps: [{ x: 1, y: 0, behavior: "MB_UP_RIGHT_STAIR_WARP", place: null, to: null, arrival: null }], stepExits: [{ x: 1, y: 0 }], entry: null };
    const view = atlasExtract(overworld(hall, [], { x: 0, y: 0 }));
    expect(view.lines.join("\n")).not.toContain("unseen cells east");
  });
});

const withItem = (name: string) => [{ pocket: "TM CASE", items: [{ name }] }] as unknown as Overworld["bag"];
const knowing = (name: string) => [{ moves: [{ name }] }] as unknown as Overworld["party"];

describe("the clearest map", () => {
  const room = (cells: string, more: Partial<AtlasMap> = {}): AtlasMap => ({ ...LAB, name: "Room", width: 6, height: Math.ceil(cells.length / 6), cells, warps: [], stepExits: [], entry: null, ...more });
  const rows = (lines: string[]) => lines.filter((line) => line.startsWith("y="));
  const legend = (lines: string[]) => lines.find((line) => line.startsWith("Legend:")) ?? "";

  test("a ? stays only where an open cell leads to it: behind a wall or a thin wall, the unseen cell is blank", () => {
    expect(rows(atlasExtract(overworld(room("...#??"), [], { x: 0, y: 0 })).lines)).toEqual(["y= 0  @..#  "]);
    expect(rows(atlasExtract(overworld(room("......" + "______" + "??????"), [], { x: 0, y: 0 })).lines)).toEqual(["y= 0  @.....", "y= 1  ______", "y= 2        "]);
  });

  test("the ? next to the open cells of another part stays", () => {
    const { lines } = atlasExtract(overworld(room("..#..?"), [], { x: 0, y: 0 }));
    expect(rows(lines)).toEqual(["y= 0  @.#..?"]);
  });

  test("the column numbers come again every 10 rows", () => {
    const { lines } = atlasExtract(overworld(room(".".repeat(6 * 23)), [], { x: 0, y: 0 }));
    const header = ["      0", "      012345"];
    const at = (y: number) => lines.findIndex((line) => line.startsWith(`y=${String(y).padStart(2)}  `));
    expect(lines.slice(at(0) - 2, at(0))).toEqual(header);
    expect(lines.slice(at(9) + 1, at(10))).toEqual(header);
    expect(lines.slice(at(19) + 1, at(20))).toEqual(header);
    expect(at(5)).toBe(at(4) + 1);
  });

  test("the legend lists only the signs of the map", () => {
    const plain = legend(atlasExtract(overworld(room("......"), [], { x: 0, y: 0 })).lines);
    expect(plain).toBe("Legend: . open; @ you.");
    const full = legend(atlasExtract(overworld(room('#."^-?'), [], { x: 1, y: 0 })).lines);
    expect(full).toContain("# blocked");
    expect(full).toContain('" tall grass');
    expect(full).toContain("^ a ledge that you jump down to the north only");
    expect(full).not.toContain("v a ledge");
    expect(full).toContain("- an open cell with a thin wall on its north side: you cannot step across that side");
    expect(full).not.toContain("_ an open cell");
  });

  const pond = room("...~~~");
  test("water is # with no way to surf, and w with HM03 in the Bag or a Pokémon that knows SURF", () => {
    const at = { x: 0, y: 0 };
    expect(rows(atlasExtract(overworld(pond, [], at)).lines)).toEqual(["y= 0  @..###"]);
    expect(rows(atlasExtract({ ...overworld(pond, [], at), bag: withItem("HM03") }).lines)).toEqual(["y= 0  @..www"]);
    const known = atlasExtract({ ...overworld(pond, [], at), party: knowing("SURF") }).lines;
    expect(rows(known)).toEqual(["y= 0  @..www"]);
    expect(legend(known)).toContain("w water");
    expect(legend(atlasExtract(overworld(pond, [], at)).lines)).not.toContain("water");
  });

  const blocks = room("...###", { obstacles: [{ x: 3, y: 0, name: "CUT TREE", move: "CUT" }, { x: 4, y: 0, name: "ROCK SMASH ROCK", move: "ROCK SMASH" }, { x: 5, y: 0, name: "PUSHABLE BOULDER", move: "STRENGTH" }] });
  test("with no HM and no Pokémon that knows the move, a fixed obstacle is # and no text tells of it", () => {
    const { lines } = atlasExtract(overworld(blocks, [], { x: 0, y: 0 }));
    expect(rows(lines)).toEqual(["y= 0  @..###"]);
    expect(lines.join("\n")).not.toContain("CUT TREE");
    const atlas = { maps: [{ ...blocks, outside: true }], lastTalk: null };
    expect(knownWorld({ atlas, bag: [], party: [] }).join("\n")).not.toContain("Fixed obstacles");
    expect(fullAtlas(overworld(room("......"), [{ ...blocks, warps: [] }], { x: 0, y: 0 })).join("\n")).not.toContain("Fixed obstacles");
  });

  test("with the HM in the Bag or the move on a Pokémon, only this obstacle gets its letter and its text", () => {
    const hm = atlasExtract({ ...overworld(blocks, [], { x: 0, y: 0 }), bag: withItem("HM01") }).lines;
    expect(rows(hm)).toEqual(["y= 0  @..t##"]);
    expect(hm.join("\n")).toContain("- CUT TREE at (3, 0). Only a Pokémon that knows CUT can remove it.");
    expect(hm.join("\n")).not.toContain("ROCK SMASH ROCK");
    expect(legend(hm)).toContain("t a cut tree");
    expect(rows(atlasExtract({ ...overworld(blocks, [], { x: 0, y: 0 }), party: knowing("ROCK SMASH") }).lines)).toEqual(["y= 0  @..#r#"]);
    expect(rows(atlasExtract({ ...overworld(blocks, [], { x: 0, y: 0 }), bag: withItem("HM04") }).lines)).toEqual(["y= 0  @..##b"]);
    const atlas = { maps: [{ ...blocks, outside: true }], lastTalk: null };
    expect(knownWorld({ atlas, bag: withItem("HM01"), party: [] }).join("\n")).toContain("Fixed obstacles: CUT TREE at (3, 0).");
  });

  test("an obstacle that the party can remove is an open cell with no text, and the door past it is in the part of the player", () => {
    const tree = { x: 3, y: 0, name: "CUT TREE", move: "CUT" as const };
    const door = { x: 5, y: 0, behavior: "MB_WARP_DOOR", place: "gym" as const, to: null, arrival: null };
    const usable = room("......", { warps: [door] });
    const atlas = { maps: [{ ...usable, outside: true }], lastTalk: null };
    const { lines, targets } = atlasExtract({ ...overworld(usable, [], { x: 0, y: 0 }), party: knowing("CUT") });
    expect(rows(lines)).toEqual(["y= 0  @....A"]);
    expect(lines.join("\n")).not.toContain("CUT");
    expect(legend(lines)).not.toContain("a cut tree");
    expect(targets[0].label).toBe("door at (5, 0), 5 east: a Gym, not taken");
    expect(knownWorld({ atlas, bag: [], party: knowing("CUT") }).join("\n")).not.toContain("Fixed obstacles");

    const closed = room("...#..", { warps: [door], obstacles: [tree] });
    const wall = atlasExtract({ ...overworld(closed, [], { x: 0, y: 0 }), party: knowing("CUT") });
    expect(rows(wall.lines)).toEqual(["y= 0  @..t.A"]);
    expect(wall.lines.join("\n")).toContain("- CUT TREE at (3, 0). Only a Pokémon that knows CUT can remove it.");
    expect(wall.targets[0].label).toBe("door at (5, 0), 5 east, no seen way there yet: a Gym, not taken");
  });

  test("a TM in the Bag or another move on a Pokémon changes nothing on the map", () => {
    const view = atlasExtract({ ...overworld(blocks, [], { x: 0, y: 0 }), bag: withItem("TM39"), party: knowing("TACKLE") });
    expect(rows(view.lines)).toEqual(["y= 0  @..###"]);
  });

  test("the full Atlas has its own legend, for the signs of its maps", () => {
    const lines = fullAtlas(overworld(room("......"), [room("..#...", { name: "Other" })], { x: 0, y: 0 }));
    expect(lines[0]).toBe("");
    expect(lines[2]).toBe("Legend: # blocked; . open.");
  });
});

describe("what the prompt tells of the exits and of the unseen cells", () => {
  const town = (warps: AtlasMap["warps"], cells: string): AtlasMap => ({ ...LAB, name: "Town", outside: true, width: 16, height: 3, cells, warps, stepExits: [] });
  const open = ".".repeat(48);

  test("a door that the player did not take shows the place that a player sees, and the name of the map only after the player took it", () => {
    const center = { x: 8, y: 0, behavior: "MB_WARP_DOOR", place: "center" as const };
    expect(atlasExtract(overworld(town([{ ...center, to: null, arrival: null }], open), [], { x: 8, y: 1 })).lines).toContain("A. door at (8, 0), adjacent north, you face it: a Pokémon Center, not taken");
    const inside: AtlasMap = { ...LAB, name: "Town_PokemonCenter_1F", width: 3, height: 1, cells: "...", warps: [], stepExits: [] };
    const taken = { ...center, to: inside.name, arrival: { x: 1, y: 0 } };
    expect(atlasExtract(overworld(town([taken], open), [inside], { x: 8, y: 1 })).lines).toContain("A. door at (8, 0), adjacent north, you face it: a Pokémon Center, to Town_PokemonCenter_1F (1, 0), taken; beyond it: nothing new");
  });

  test("each kind of cell of an exit has its own word", () => {
    const exit = (x: number, behavior: string) => ({ x, y: 0, behavior, place: null, to: null, arrival: null });
    const lines = atlasExtract(overworld(town([exit(1, "MB_LADDER"), exit(3, "MB_UP_ESCALATOR"), exit(5, "MB_REGULAR_WARP"), exit(7, "MB_FALL_WARP"), exit(9, "MB_CAVE_DOOR"), exit(11, "MB_DOWN_LEFT_STAIR_WARP"), exit(13, "MB_SOUTH_ARROW_WARP")], open), [], { x: 8, y: 2 })).lines.join("\n");
    for (const word of ["ladder at (1, 0)", "escalator at (3, 0)", "teleport pad at (5, 0)", "hole at (7, 0)", "entrance at (9, 0)", "stairs at (11, 0)", "exit mat at (13, 0)"]) expect(lines).toContain(word);
  });

  test("with no unseen cell in the part of the player, a line stands under the map", () => {
    const walled = town([], "#".repeat(16) + "..#.????????????" + "#".repeat(16));
    const { lines } = atlasExtract(overworld(walled, [], { x: 0, y: 1 }));
    const line = "You saw all the cells that you can reach from here on this map. Other parts of it can have unseen cells: to go on, take an exit or a lead.";
    expect(lines).toContain(line);
    expect(lines.indexOf(line)).toBe(lines.findLastIndex((l) => l.startsWith("y=")) + 1);
  });

  test("with only blank cells left, the line tells of the part, not of the map: a part that the player never saw is blank too", () => {
    const walled = town([], "#".repeat(16) + "..#?????????????" + "#".repeat(16));
    const { lines } = atlasExtract(overworld(walled, [], { x: 0, y: 1 }));
    expect(lines).toContain("You saw all the cells that you can reach from here on this map. Other parts of it can have unseen cells: to go on, take an exit or a lead.");
    expect(lines).not.toContain("You saw all the cells of this map.");
  });

  test("with no ? on the map, a line says that the player saw all of it", () => {
    expect(atlasExtract(overworld(town([], open), [], { x: 0, y: 1 })).lines).toContain("You saw all the cells of this map.");
  });

  test("with unseen cells next to the part of the player, no line says that all is seen", () => {
    expect(atlasExtract(overworld(town([], "?".repeat(16) + ".".repeat(32)), [], { x: 0, y: 2 })).lines.join("\n")).not.toContain("You saw all");
  });

  test("the Known world counts the groups of open cells next to unseen cells, not the ? cells that the player never sees, and gives the cell of each exit not taken", () => {
    const wall = "#".repeat(16);
    const unseenWall = "?".repeat(16);
    const closed = town([{ x: 8, y: 0, behavior: "MB_WARP_DOOR", place: "mart", to: null, arrival: null }, { x: 9, y: 0, behavior: "MB_WARP_DOOR", place: "house", to: null, arrival: null }], wall);
    expect(knownWorld({ atlas: { maps: [{ ...closed, height: 5, cells: wall + ".".repeat(16) + wall + unseenWall + unseenWall }], lastTalk: null }, bag: [], party: [] })[1]).toBe("- Town: edges: none seen. Exits not taken: door at (8, 0), a Poké Mart; door at (9, 0), a house. No open cell next to unseen cells.");
    const twoAreas = "?..............?" + wall + wall;
    expect(knownWorld({ atlas: { maps: [town([], twoAreas)], lastTalk: null }, bag: [], party: [] })[1]).toBe("- Town: edges: none seen. 2 groups of open cells next to unseen cells.");
    const oneArea = "...............?" + wall + wall;
    expect(knownWorld({ atlas: { maps: [town([], oneArea)], lastTalk: null }, bag: [], party: [] })[1]).toBe("- Town: edges: none seen. 1 group of open cells next to unseen cells.");
  });
});

describe("the extract of the Atlas", () => {
  test("the map block of a house: every row with ? for the cells not seen, the targets as letters in groups with their distance and direction, a person with its last text, no edge that leads out, and no exit to the outside yet", () => {
    const house: AtlasMap = {
      name: "House",
      width: 8,
      height: 6,
      cells: "########" + "#......#".repeat(3) + "?".repeat(16),
      warps: [{ x: 6, y: 1, behavior: "MB_UP_RIGHT_STAIR_WARP", place: null, to: "House_2F", arrival: null }],
      edges: [],
      hasEdges: false,
      outside: false,
      signs: [{ x: 3, y: 0, facing: "north", text: "It's a TV." }],
      people: [{ localId: 1, graphics: "MOM", x: 5, y: 3, texts: ["MOM: Hi!", "MOM: Take care!"] }],
      obstacles: [],
      entry: { x: 6, y: 2 },
      stepExits: [],
      slides: [],
      parts: [],
    };
    const upstairs: AtlasMap = { ...house, name: "House_2F", cells: "#".repeat(48), warps: [{ x: 1, y: 1, behavior: "MB_DOWN_LEFT_STAIR_WARP", place: null, to: "House", arrival: null }], signs: [], people: [] };
    const view = atlasExtract(overworld(house, [upstairs], { x: 3, y: 1 }, [{ localId: 1, x: 5, y: 3, graphics: "MOM", loaded: true, stays: false }]));
    expect(view.lines).toEqual([
      "Map House: x from 0 to 7, y from 0 to 5. You are at (3, 1), facing north.",
      "Legend: # blocked; . open; ? not seen, next to a cell where you can walk; a blank cell not seen, and no cell that you saw leads to it; @ you; letters the targets.",
      "      0",
      "      01234567",
      "y= 0  ###C####",
      "y= 1  #..@..A#",
      "y= 2  #......#",
      "y= 3  #..B.D.#",
      "y= 4   ?????? ",
      "y= 5          ",
      "Edges: no edge of this map leads to another map.",
      "",
      "What the people of this map said to you:",
      '- MOM, last seen at (5, 3): "MOM: Hi!"; "MOM: Take care!"',
      "",
      "Maps one exit away:",
      "- A (stairs) leads to House_2F. Its exits (cells of House_2F): stairs at (1, 1), to House.",
      "",
      "Exits of this map:",
      "A. stairs at (6, 1), 3 east: to House_2F, taken",
      "No exit to the outside is seen yet: explore B.",
      "Unseen cells:",
      "B. unseen cells south of (3, 3), 2 south",
      "People, objects and things to check:",
      'C. something you can check at (3, 0), adjacent north, you face it: read, "It\'s a TV."',
      'D. MOM at (5, 3), 2 south, 2 east: talked, "MOM: Take care!"',
    ]);
  });

  test("a water edge says that the player cannot go there now and why, and it is not a target", () => {
    const [town] = chain(0);
    const view = atlasExtract(overworld({ ...town, edges: [{ side: "south", to: null, blocked: "water" }, ...town.edges.slice(1)] }, []));
    expect(view.lines).toContain("- south edge: you cannot go there now: the south edge of Town is water. Only a Pokémon that knows SURF can cross water.");
    expect(view.targets.filter((t) => t.kind === "edge").map((t) => t.label)).toEqual(["north edge, 3 north: not taken"]);
  });

  test("a cut tree is a fixed obstacle with its move, and not a target", () => {
    const view = atlasExtract({ ...overworld({ ...LAB, obstacles: [{ x: 2, y: 1, name: "CUT TREE", move: "CUT" }] }, []), bag: withItem("HM01") });
    expect(view.lines).toContain("- CUT TREE at (2, 1). Only a Pokémon that knows CUT can remove it.");
    expect(view.targets.map((t) => t.label)).not.toContainEqual(expect.stringContaining("CUT TREE"));
  });

  test("the people on the cells that the player did not see are not targets", () => {
    const lass = { localId: 3, graphics: "LASS", x: 3, y: 1, loaded: true, stays: false };
    const view = atlasExtract(overworld({ ...LAB, people: [{ ...lass, texts: [] }] }, [], { x: 1, y: 2 }, [lass]));
    expect(view.targets.map((t) => t.label)).not.toContainEqual(expect.stringContaining("LASS"));
  });

  test("an ITEM BALL says that it is a free item; the starter balls of Oak's Lab are objects to interact with", () => {
    const ball = { localId: 3, graphics: "ITEM_BALL", x: 1, y: 1, loaded: true, stays: false };
    const label = (name: string) => atlasExtract(overworld({ ...LAB, name, people: [{ ...ball, texts: [] }] }, [], { x: 1, y: 2 }, [ball])).targets.find((t) => t.kind === "person")?.label;
    expect(label("Route3")).toBe("ITEM BALL at (1, 1), adjacent north, you face it: a free item, go takes it");
    expect(label("PalletTown_ProfessorOaksLab")).toBe("ITEM BALL at (1, 1), adjacent north, you face it, an object that you can interact with");
  });

  test("each object says that the player can interact with it, also when it closes no way", () => {
    const fossil = { localId: 3, graphics: "FOSSIL", x: 1, y: 1, loaded: true, stays: false };
    const lass = { localId: 4, graphics: "LASS", x: 2, y: 1, loaded: true, stays: false };
    const view = atlasExtract(overworld({ ...LAB, people: [fossil, lass].map((p) => ({ ...p, texts: [] })) }, [], { x: 1, y: 2 }, [fossil, lass]));
    expect(view.targets.flatMap((t) => (t.kind === "person" ? [t.label] : []))).toEqual([
      "FOSSIL at (1, 1), adjacent north, you face it, an object that you can interact with",
      "LASS at (2, 1), 1 north, 1 east",
    ]);
  });

  test("an object that stays on the only way is in your way, and the unseen cells past it say so; a person who walks or stands in the open is not", () => {
    const cave: AtlasMap = { ...LAB, name: "Cave", width: 5, height: 5, cells: "?????" + "##.##" + "#...#" + "#...#" + "#####", warps: [] };
    const fossil = { localId: 1, graphics: "FOSSIL", x: 2, y: 1, loaded: true, stays: true };
    const man = { localId: 2, graphics: "MAN", x: 3, y: 2, loaded: true, stays: true };
    const view = atlasExtract(overworld({ ...cave, people: [fossil, man].map((p) => ({ ...p, texts: [] })) }, [], { x: 1, y: 3 }, [fossil, man]));
    const labels = view.targets.map((t) => t.label);
    expect(labels).toContain("FOSSIL at (2, 1), 2 north, 1 east, an object that you can interact with, in your way: on the cells that you saw, the way past it stays closed while it is here");
    expect(labels).toContain("MAN at (3, 2), 1 north, 2 east");
    expect(labels.find((l) => l.startsWith("unseen"))).toContain("past the FOSSIL on this cell");
    expect(labels.findIndex((l) => l.startsWith("FOSSIL"))).toBeLessThan(labels.findIndex((l) => l.startsWith("MAN")));
    const walker = atlasExtract(overworld({ ...cave, people: [{ ...fossil, texts: [] }] }, [], { x: 1, y: 3 }, [{ ...fossil, stays: false }]));
    expect(walker.targets.map((t) => t.label)).not.toContainEqual(expect.stringContaining("in your way"));
  });

  test("a person who stays in a gap between two groups of seen cells is in your way", () => {
    const hall: AtlasMap = { ...LAB, name: "Hall", width: 5, height: 5, cells: "#####" + "#...#" + "##.##" + "#...#" + "#####", warps: [] };
    const guard = { localId: 1, graphics: "POLICEMAN", x: 2, y: 2, loaded: true, stays: true };
    const view = atlasExtract(overworld({ ...hall, people: [{ ...guard, texts: [] }] }, [], { x: 1, y: 3 }, [guard]));
    expect(view.targets.map((t) => t.label)).toContainEqual(expect.stringContaining("POLICEMAN at (2, 2), 1 north, 1 east, in your way"));
  });

  test("a trainer that the player did not beat yet has a mark in its target; a beaten trainer has none", () => {
    const lass = { localId: 3, graphics: "LASS", x: 2, y: 1, loaded: true, stays: false, unbeatenTrainer: true };
    const youngster = { localId: 4, graphics: "YOUNGSTER", x: 1, y: 1, loaded: true, stays: false };
    const view = atlasExtract(overworld({ ...LAB, people: [lass, youngster].map((p) => ({ ...p, texts: [] })) }, [], { x: 1, y: 2 }, [lass, youngster]));
    expect(view.targets.flatMap((t) => (t.kind === "person" ? [t.label] : []))).toEqual([
      "YOUNGSTER at (1, 1), adjacent north, you face it",
      "LASS at (2, 1), 1 north, 1 east, a trainer that you did not beat yet: a talk starts a battle",
    ]);
  });

  test("a direct neighbour has a line with its exits, and only the nearest other maps are targets", () => {
    const view = atlasExtract(overworld(LAB, chain(200)));
    const localOnly = atlasExtract(overworld(LAB, [])).lines.join("\n");
    expect(view.lines.join("\n").length - localOnly.length).toBeLessThanOrEqual(OTHER_MAPS_BUDGET);
    expect(view.lines).toContain("- A (exit mat) leads to Town. Its exits (cells of Town): south edge, not taken; north edge, to Route0.");
    const maps = view.targets.flatMap((t) => (t.kind === "map" ? [t.map] : []));
    expect(maps).toHaveLength(MAX_FAR_MAPS);
    expect(maps).toEqual(Array.from({ length: maps.length }, (_, i) => `Route${i}`));
    expect(view.lines).toContain("E. Route1, 3 exits away");
  });

  test("a large map of the player does not remove the maps one exit away", () => {
    const size = 80;
    const city: AtlasMap = { ...LAB, name: "City", width: size, height: size, cells: ".".repeat(size * size), warps: [{ x: 2, y: 3, behavior: "MB_WARP_DOOR", place: null, to: "Town", arrival: null }] };
    const view = atlasExtract(overworld(city, chain(3)));
    expect(view.lines).toContain("- A (door) leads to Town. Its exits (cells of Town): south edge, not taken; north edge, to Route0.");
    expect(view.lines).toContain(`y=79  ${".".repeat(size)}`);
  });

  test("the extract shows the texts of the people of the map of the player; the full Atlas shows the texts of the other maps", () => {
    const oak = { localId: 4, graphics: "PROF_OAK", x: 1, y: 1, texts: ["OAK: Hey! Wait!", "OAK: Choose one!"] };
    const [town] = chain(0);
    const girl = { localId: 2, graphics: "LITTLE_GIRL", x: 3, y: 3, texts: ["Technology is incredible!"] };
    const ow = overworld({ ...LAB, people: [oak] }, [{ ...town, people: [girl] }]);
    const extract = atlasExtract(ow).lines;
    expect(extract).toContain('- PROF OAK, last seen at (1, 1): "OAK: Hey! Wait!"; "OAK: Choose one!"');
    expect(extract.join("\n")).not.toContain("Technology");
    expect(fullAtlas(ow).join("\n")).toContain('People: LITTLE GIRL, last seen at (3, 3): "Technology is incredible!".');
  });

  test("the full Atlas shows all the maps in detail up to its budget; past it, each far map has one line", () => {
    const complete = fullAtlas(overworld(LAB, chain(60))).join("\n");
    expect(complete).toContain("Map Route59: x from 0 to 23, y from 0 to 39, 61 exits away.");
    expect(complete).not.toContain("\n- Route");

    const appendix = fullAtlas(overworld(LAB, chain(200)));
    expect(appendix).toContain("Map Town: x from 0 to 23, y from 0 to 39, 1 exit away. Exits: south edge, not taken; north edge, to Route0.");
    expect(appendix).toContain("y=39  ........................");
    const oneLine = appendix.findIndex((line) => line.startsWith("- Route"));
    expect(appendix.slice(0, oneLine).join("\n").length).toBeLessThanOrEqual(FULL_ATLAS_BUDGET);
    expect(appendix.slice(oneLine).every((line) => line.startsWith("- Route"))).toBe(true);
    expect(appendix.at(-1)).toBe("- Route199, 201 exits away. Exits: south edge, to Route198; north edge, not taken.");
  });

  test("the Known world has one line for each outdoor map, in the order of the first visit: its edges, its passages to other outdoor maps, the buildings entered, the exits not taken, the groups next to unseen cells and the obstacles", () => {
    const map = (name: string, outside: boolean, warps: AtlasMap["warps"], edges: AtlasMap["edges"] = []): AtlasMap => ({ ...LAB, name, outside, warps, edges, hasEdges: edges.length > 0 });
    const door = (x: number, to: string | null) => ({ x, y: 4, behavior: "MB_WARP_DOOR", place: null, to, arrival: null });
    const town = map("Town", true, [door(3, "Town_Mart"), door(6, null)], [
      { side: "north", to: "Route1" },
      { side: "south", to: null, blocked: "water" },
      { side: "east", to: null },
    ]);
    const atlas = {
      maps: [
        { ...town, obstacles: [{ x: 2, y: 2, name: "CUT TREE", move: "CUT" as const }] },
        map("Town_Mart", false, [door(1, "Town")]),
        map("Route1", true, [door(5, "Route1_Gate")], [{ side: "south", to: "Town" }]),
        map("Route1_Gate", false, [door(1, "Route1"), door(2, "Route1_Gate_2F")]),
        map("Route1_Gate_2F", false, [door(1, "Route1_Gate"), door(2, "Forest")]),
        map("Forest", true, [door(1, "Route1_Gate_2F")]),
      ],
      lastTalk: null,
    };
    expect(knownWorld({ atlas, bag: withItem("HM01"), party: [] })).toEqual([
      "Known world, the outdoor maps that you visited, the first visit first:",
      "- Town: edges: north to Route1, south blocked (water), east not visited. Buildings entered: door at (3, 4), to Town_Mart. Exits not taken: door at (6, 4). 1 group of open cells next to unseen cells. Fixed obstacles: CUT TREE at (2, 2).",
      "- Route1: edges: south to Town. Passages: door at (5, 4), to Route1_Gate, a passage through Route1_Gate_2F to Forest. 1 group of open cells next to unseen cells.",
      "- Forest: edges: none seen. Passages: door at (1, 4), to Route1_Gate_2F, a passage through Route1_Gate to Route1. 1 group of open cells next to unseen cells.",
    ]);
  });
});

describe("a map with spin tiles", () => {
  const maze = (cells: string[], more: Partial<AtlasMap> = {}): AtlasMap => {
    const view = atlasCells({ cells: cells.join(""), width: 8, height: 4 });
    return {
      ...LAB,
      name: "Hideout",
      width: 8,
      height: 4,
      cells: cells.join(""),
      warps: [{ x: 6, y: 3, behavior: "MB_UP_RIGHT_STAIR_WARP", place: null, to: null, arrival: null }],
      entry: { x: 1, y: 1 },
      parts: hasSpinTiles(cells.join("")) ? numberParts(view, (c) => walkable(view, c), []) : [],
      ...more,
    };
  };
  const ROWS = ["########", "#..→...#", "#..#...#", "####...#"];
  const after = (lines: string[], first: string) => lines.slice(lines.indexOf(first));

  test("the grid shows the spin tiles, the legend and the rule tell what they do, and the Parts tell where each slide ends", () => {
    const { lines } = atlasExtract(overworld(maze(ROWS), []));
    expect(lines).toContain("y= 2  #@.#...#");
    expect(lines).toContain("y= 1  #..→...#");
    expect(lines.find((line) => line.startsWith("Legend:"))).toContain("↑ ↓ ← → a spin tile");
    expect(lines).toContain(
      "Spin tiles: when you step on a spin tile, you slide in the direction of its arrow and you cannot stop. Another spin tile on the way changes your direction to its arrow. You stop on a stop tile (o), or on the last cell before a blocked cell or a person. A stop tile that you walk on, with no slide, is normal floor.",
    );
    expect(after(lines, "Parts of this map: the cells of a part connect on foot, with no spin tile, and slides link the parts. The numbers of the parts stay the same on this map.").slice(1, 5)).toEqual([
      "Part 1 (you): 4 cells, x 1-2, y 1-2.",
      "  - spin tile → at (3, 1): slides to (6, 1), in Part 2",
      "Part 2: 9 cells, x 4-6, y 1-3.",
      "  - no slide to another part",
    ]);
    expect(lines).toContain("B. stairs at (6, 3), in Part 2, 1 exit or slide away: not taken");
  });

  test("a slide that the player took and a Part where the player was have their marks", () => {
    const { lines } = atlasExtract(overworld(maze(ROWS, { slides: [{ from: { x: 3, y: 1 }, to: { x: 6, y: 1 } }] }), []));
    expect(lines).toContain("  - spin tile → at (3, 1): slides to (6, 1), in Part 2, taken");
    expect(lines).toContain("Part 2 (visited): 9 cells, x 4-6, y 1-3.");
  });

  test("a slide through a cell that the player did not see has no known end", () => {
    const { lines } = atlasExtract(overworld(maze(["########", "#..→.??#", "#..#.??#", "####.??#"], { warps: [] }), []));
    expect(lines).toContain("  - spin tile → at (3, 1): its way goes through a cell that you did not see, so its end is unknown");
    expect(lines.some((line) => line.startsWith("You saw all the cells"))).toBe(false);
  });

  test("a slide that stops on a spin tile says it, and leads to no Part", () => {
    const { lines } = atlasExtract(overworld(maze(["########", "#..→↑..#", "#..#...#", "####...#"], { warps: [] }), []));
    expect(lines).toContain("  - spin tile → at (3, 1): slides to (4, 1), a spin tile where you stop");
    expect(lines.some((line) => line.startsWith("Part 2"))).toBe(false);
  });

  test("a map with no spin tile has no Parts block", () => {
    const { lines } = atlasExtract(overworld(maze(["########", "#.....##", "#.....##", "########"], { warps: [] }), []));
    expect(lines.some((line) => line.startsWith("Parts of this map"))).toBe(false);
  });
});
