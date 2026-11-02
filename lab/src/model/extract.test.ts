import { describe, expect, test } from "bun:test";
import type { MapGrid } from "../game";
import { type AtlasMap, atlasWarps } from "../harness/atlas";
import type { Person } from "../harness/harness";
import { atlasExtract, FULL_ATLAS_BUDGET, fullAtlas, knownWorld, OTHER_MAPS_BUDGET } from "./extract";
import type { Overworld } from "./targets";

const LAB: AtlasMap = {
  name: "Lab",
  width: 5,
  height: 4,
  cells: "#####" + "#..?#" + "#..?#" + "##.##",
  warps: [
    { x: 2, y: 3, behavior: "MB_SOUTH_ARROW_WARP", to: "Town", arrival: null },
    { x: 0, y: 1, behavior: "MB_WARP_DOOR", to: null, arrival: null },
  ],
  edges: [],
  hasEdges: false,
  outside: false,
  signs: [],
  people: [],
  obstacles: [],
  entry: { x: 2, y: 2 },
  stepExits: [],
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
    money: 0,
    milestones: [],
    map: { group: 0, num: 0, name: current.name },
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
  }));
}

describe("the exits of the Atlas", () => {
  const cell = (x: number, to = "Gate") => ({ x, y: 9, to, warpId: 0, group: 0, num: 0, behavior: "MB_CAVE_DOOR", how: "step" as const });
  const seen = () => true;

  test("the neighbour cells of a wide exit are one exit, and a walk through one cell takes the whole exit; other maps and far cells stay other exits", () => {
    expect(atlasWarps([cell(4), cell(5), cell(6)], new Map(), seen)).toEqual([{ x: 4, y: 9, behavior: "MB_CAVE_DOOR", to: null, arrival: null }]);
    expect(atlasWarps([cell(4), cell(5), cell(6)], new Map([["5,9", { to: "Gate", arrival: { x: 3, y: 3 } }]]), seen)).toEqual([{ x: 5, y: 9, behavior: "MB_CAVE_DOOR", to: "Gate", arrival: { x: 3, y: 3 } }]);
    expect(atlasWarps([cell(4, "Gate"), cell(5, "House")], new Map(), seen)).toHaveLength(2);
    expect(atlasWarps([cell(4), cell(8)], new Map(), seen)).toHaveLength(2);
  });
});

describe("the parts of a map", () => {
  const stairs = (x: number, to: string): AtlasMap["warps"][number] => ({ x, y: 1, behavior: "MB_LADDER", to, arrival: { x, y: 1 } });
  const floor = (name: string, row: string, to: string, more: Partial<AtlasMap> = {}): AtlasMap => ({ ...LAB, name, width: 16, height: 3, cells: "#".repeat(16) + row.padEnd(16, "#") + "#".repeat(16), warps: [stairs(1, to), stairs(7, to)], stepExits: [{ x: 1, y: 1 }, { x: 7, y: 1 }], entry: null, ...more });
  const upper = floor("Upper", "#.......#", "Lower");
  const lower = floor("Lower", "#..?#...#", "Upper");

  test("an exit shows its arrival cell and what is beyond it, and the unseen cells of a part behind an exit stay a target", () => {
    const view = atlasExtract(overworld(upper, [lower], { x: 4, y: 1 }));
    expect(view.lines).toContain("A. stairs at (1, 1), 3 west: to Lower (1, 1), taken; beyond it: unseen cells");
    expect(view.lines).toContain("B. stairs at (7, 1), 3 east: to Lower (7, 1), taken; beyond it: nothing new");
    expect(view.lines).toContain("Leads, what you did not explore in other parts and maps:");
    expect(view.lines).toContain("C. unseen cells east of (2, 1) on Lower, 1 exit away");
    expect(view.targets.at(2)).toMatchObject({ kind: "lead", map: "Lower", cell: { x: 2, y: 1 } });
  });

  test("the line of a neighbour map shows, for each part where its exits arrive, the exits of that part only", () => {
    const view = atlasExtract(overworld(upper, [lower], { x: 4, y: 1 }));
    expect(view.lines).toContain("- A (stairs) leads to Lower. From there you can walk to: stairs at (1, 1), to Upper (1, 1).");
    expect(view.lines).toContain("- B (stairs) leads to Lower. From there you can walk to: stairs at (7, 1), to Upper (7, 1).");
  });

  test("an exit or a person in another part of the map shows how far it is in exits, comes after the targets of the part, and the unseen cells of the other part stay a target", () => {
    const rocket = { localId: 2, graphics: "ROCKET_M", x: 2, y: 1, loaded: true };
    const view = atlasExtract(overworld({ ...lower, people: [{ ...rocket, texts: [] }] }, [upper], { x: 6, y: 1 }, [rocket]));
    expect(view.lines).toContain("A. stairs at (7, 1), adjacent east: to Upper (7, 1), taken; beyond it: unseen cells");
    expect(view.lines).toContain("B. stairs at (1, 1), in another part of this map, 2 exits away: to Upper (1, 1), taken; beyond it: unseen cells");
    expect(view.lines).toContain("C. ROCKET M at (2, 1), in another part of this map, 2 exits away");
    expect(view.lines).toContain("D. unseen cells east of (2, 1) in another part of this map, 2 exits away");
    expect(view.targets.at(1)).toMatchObject({ kind: "exit", cell: { x: 1, y: 1 } });
  });

  test("with no unseen cell in the part of the player, the extract says that the other cells have no seen way from here", () => {
    const view = atlasExtract(overworld(lower, [upper], { x: 6, y: 1 }));
    expect(view.lines).toContain("You saw all the cells of your part of this map: no cell that you saw leads from it to the other cells of this map.");
    expect(atlasExtract(overworld(lower, [upper], { x: 2, y: 1 })).lines).not.toContainEqual(expect.stringContaining("You saw all the cells"));
  });

  test("the cell next to an exit not taken is never a step on another cell of a wide exit: go has no route to such a cell", () => {
    const holes = floor("Lower", "#.......#", "Upper", { warps: [stairs(1, "Upper"), { x: 7, y: 1, behavior: "MB_LADDER", to: null, arrival: null }], stepExits: [{ x: 1, y: 1 }, { x: 6, y: 1 }, { x: 7, y: 1 }] });
    const view = atlasExtract(overworld({ ...upper, warps: [stairs(1, "Lower")] }, [holes], { x: 4, y: 1 }));
    expect(view.targets.filter((t) => t.kind === "lead")).toEqual([]);
  });

  test("an exit not taken on another map is a lead, and go walks next to it", () => {
    const below = floor("Lower", "#.......#", "Upper", { warps: [stairs(1, "Upper"), { x: 7, y: 1, behavior: "MB_LADDER", to: null, arrival: null }], stepExits: [{ x: 1, y: 1 }, { x: 7, y: 1 }] });
    const view = atlasExtract(overworld({ ...upper, warps: [stairs(1, "Lower")] }, [below], { x: 4, y: 1 }));
    expect(view.lines).toContain("A. stairs at (1, 1), 3 west: to Lower (1, 1), taken; beyond it: an exit not taken");
    expect(view.lines).toContain("B. stairs at (7, 1) on Lower, not taken, 1 exit away: go walks next to it");
    expect(view.targets.at(1)).toMatchObject({ kind: "lead", map: "Lower", cell: { x: 6, y: 1 } });
  });

  test("a thin wall ends the part, and the unseen cells behind it are not a target", () => {
    const walled: AtlasMap = { ...LAB, name: "Cave", width: 3, height: 4, cells: "..." + "..." + "---" + "???", warps: [], entry: null };
    const view = atlasExtract(overworld(walled, [], { x: 1, y: 1 }));
    expect(view.lines.join("\n")).not.toContain("unseen cells south");
    expect(view.lines).toContain("You saw all the cells of your part of this map: no cell that you saw leads from it to the other cells of this map.");
  });

  test("the unseen cells of a room that fits on the screen are no lead, and they are not beyond an exit", () => {
    const room = { ...lower, width: 9, cells: "#########" + "#..?#...#" + "#########" };
    const view = atlasExtract(overworld(upper, [room], { x: 4, y: 1 }));
    expect(view.lines).toContain("A. stairs at (1, 1), 3 west: to Lower (1, 1), taken; beyond it: nothing new");
    expect(view.targets.filter((t) => t.kind === "lead")).toEqual([]);
  });

  test("a door next to the part of the player is in that part: the way back through a house is not another part", () => {
    const town: AtlasMap = { ...LAB, name: "Town", outside: true, width: 16, height: 2, cells: "#".repeat(16) + ".".repeat(16), warps: [{ x: 3, y: 0, behavior: "MB_WARP_DOOR", to: "House", arrival: { x: 1, y: 1 } }], entry: null };
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
    const gap: AtlasMap = { ...LAB, name: "Gap", width: 16, height: 1, cells: "..?.............", warps: [{ x: 5, y: 0, behavior: "MB_LADDER", to: null, arrival: null }], stepExits: [{ x: 5, y: 0 }], entry: null };
    const view = atlasExtract(overworld(gap, [], { x: 0, y: 0 }));
    expect(view.lines).toContain("A. stairs at (5, 0), 5 east, no seen way there yet: not taken");
  });

  test("an edge in another part shows the number of exits to it, not a direction", () => {
    const road: AtlasMap = { ...LAB, name: "Road", outside: true, width: 16, height: 3, cells: "#".repeat(16) + "..#..#.........." + "#".repeat(16), warps: [{ x: 0, y: 1, behavior: "MB_CAVE_DOOR", to: "Cave", arrival: { x: 1, y: 1 } }, { x: 3, y: 1, behavior: "MB_CAVE_DOOR", to: "Cave", arrival: { x: 7, y: 1 } }], stepExits: [{ x: 0, y: 1 }, { x: 3, y: 1 }], edges: [{ side: "east", to: "Town" }], hasEdges: true, entry: null };
    const cave = { ...upper, name: "Cave", warps: [{ ...stairs(1, "Road"), arrival: { x: 0, y: 1 } }, { ...stairs(7, "Road"), arrival: { x: 3, y: 1 } }] };
    const view = atlasExtract(overworld(road, [cave], { x: 1, y: 1 }));
    expect(view.lines).toContain("C. east edge, 15 east, no seen way there yet: to Town, taken");
    const beside = atlasExtract(overworld({ ...road, cells: "#".repeat(16) + "..#............." + "#".repeat(16) }, [cave], { x: 1, y: 1 }));
    expect(beside.lines).toContain("C. east edge, in another part of this map, 2 exits away: to Town, taken");
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
    const hall: AtlasMap = { ...LAB, name: "Hall", width: 5, height: 1, cells: "...?.", warps: [{ x: 1, y: 0, behavior: "MB_LADDER", to: null, arrival: null }], stepExits: [{ x: 1, y: 0 }], entry: null };
    const view = atlasExtract(overworld(hall, [], { x: 0, y: 0 }));
    expect(view.lines.join("\n")).not.toContain("unseen cells east");
  });
});

describe("the extract of the Atlas", () => {
  test("the map block of a house: every row with ? for the cells not seen, the targets as letters in groups with their distance and direction, a person with its last text, no edge that leads out, and no exit to the outside yet", () => {
    const house: AtlasMap = {
      name: "House",
      width: 8,
      height: 6,
      cells: "########" + "#......#".repeat(3) + "?".repeat(16),
      warps: [{ x: 6, y: 1, behavior: "MB_UP_RIGHT_STAIR_WARP", to: "House_2F", arrival: null }],
      edges: [],
      hasEdges: false,
      outside: false,
      signs: [{ x: 3, y: 0, facing: "north", text: "It's a TV." }],
      people: [{ localId: 1, graphics: "MOM", x: 5, y: 3, texts: ["MOM: Hi!", "MOM: Take care!"] }],
      obstacles: [],
      entry: { x: 6, y: 2 },
      stepExits: [],
    };
    const upstairs: AtlasMap = { ...house, name: "House_2F", cells: "#".repeat(48), warps: [{ x: 1, y: 1, behavior: "MB_DOWN_LEFT_STAIR_WARP", to: "House", arrival: null }], signs: [], people: [] };
    const view = atlasExtract(overworld(house, [upstairs], { x: 3, y: 1 }, [{ localId: 1, x: 5, y: 3, graphics: "MOM", loaded: true }]));
    expect(view.lines).toEqual([
      "Map House: x from 0 to 7, y from 0 to 5. You are at (3, 1), facing north.",
      'Legend: # blocked, . open, " tall grass, ~ water, ^ v < > a ledge that you jump down in that direction only, ? not seen, @ you, letters the targets, - _ [ ] an open cell with a thin wall on its north, south, west or east side: you cannot step across that side.',
      "      0",
      "      01234567",
      "y= 0  ###C####",
      "y= 1  #..@..A#",
      "y= 2  #......#",
      "y= 3  #..B.D.#",
      "y= 4  ????????",
      "y= 5  ????????",
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
      "People and signs:",
      'C. sign at (3, 0), adjacent north, you face it: read, "It\'s a TV."',
      'D. MOM at (5, 3), 2 south, 2 east: talked, "MOM: Take care!"',
    ]);
  });

  test("a water edge says that the player cannot go there now and why, and it is not a target", () => {
    const [town] = chain(0);
    const view = atlasExtract(overworld({ ...town, edges: [{ side: "south", to: null, blocked: "water" }, ...town.edges.slice(1)] }, []));
    expect(view.lines).toContain("- south edge: you cannot go there now: the south edge of Town is water. Only a Pokémon that knows SURF can cross water, and you have none.");
    expect(view.targets.filter((t) => t.kind === "edge").map((t) => t.label)).toEqual(["north edge, 3 north: not taken"]);
  });

  test("a cut tree is a fixed obstacle with its move, and not a target", () => {
    const view = atlasExtract(overworld({ ...LAB, obstacles: [{ x: 2, y: 1, name: "CUT TREE", move: "CUT" }] }, []));
    expect(view.lines).toContain("- CUT TREE at (2, 1). Only a Pokémon that knows CUT can remove it.");
    expect(view.targets.map((t) => t.label)).not.toContainEqual(expect.stringContaining("CUT TREE"));
  });

  test("the people on the cells that the player did not see are not targets", () => {
    const lass = { localId: 3, graphics: "LASS", x: 3, y: 1, loaded: true };
    const view = atlasExtract(overworld({ ...LAB, people: [{ ...lass, texts: [] }] }, [], { x: 1, y: 2 }, [lass]));
    expect(view.targets.map((t) => t.label)).not.toContainEqual(expect.stringContaining("LASS"));
  });

  test("a trainer that the player did not beat yet has a mark in its target; a beaten trainer has none", () => {
    const lass = { localId: 3, graphics: "LASS", x: 2, y: 1, loaded: true, unbeatenTrainer: true };
    const youngster = { localId: 4, graphics: "YOUNGSTER", x: 1, y: 1, loaded: true };
    const view = atlasExtract(overworld({ ...LAB, people: [lass, youngster].map((p) => ({ ...p, texts: [] })) }, [], { x: 1, y: 2 }, [lass, youngster]));
    expect(view.targets.flatMap((t) => (t.kind === "person" ? [t.label] : []))).toEqual([
      "YOUNGSTER at (1, 1), adjacent north, you face it",
      "LASS at (2, 1), 1 north, 1 east, a trainer that you did not beat yet: a talk starts a battle",
    ]);
  });

  test("a direct neighbour has a line with its exits; the other maps are targets, and past their budget, the far maps lose their line first", () => {
    const view = atlasExtract(overworld(LAB, chain(200)));
    const localOnly = atlasExtract(overworld(LAB, [])).lines.join("\n");
    expect(view.lines.join("\n").length - localOnly.length).toBeLessThanOrEqual(OTHER_MAPS_BUDGET);
    expect(view.lines).toContain("- A (exit mat) leads to Town. Its exits (cells of Town): south edge, not taken; north edge, to Route0.");
    const maps = view.targets.flatMap((t) => (t.kind === "map" ? [t.map] : []));
    expect(maps.length).toBeGreaterThan(10);
    expect(maps).toEqual(Array.from({ length: maps.length }, (_, i) => `Route${i}`));
    expect(view.lines).toContain("E. Route1, 3 exits away");
  });

  test("a large map of the player does not remove the maps one exit away", () => {
    const size = 80;
    const city: AtlasMap = { ...LAB, name: "City", width: size, height: size, cells: ".".repeat(size * size), warps: [{ x: 2, y: 3, behavior: "MB_WARP_DOOR", to: "Town", arrival: null }] };
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

  test("the Known world has one line for each outdoor map, in the order of the first visit: its edges, its passages to other outdoor maps, the buildings entered, the doors not entered, the unseen cells left and the obstacles", () => {
    const map = (name: string, outside: boolean, warps: AtlasMap["warps"], edges: AtlasMap["edges"] = []): AtlasMap => ({ ...LAB, name, outside, warps, edges, hasEdges: edges.length > 0 });
    const door = (x: number, to: string | null) => ({ x, y: 4, behavior: "MB_WARP_DOOR", to, arrival: null });
    const town = map("Town", true, [door(3, "Town_Mart"), door(6, null)], [
      { side: "north", to: "Route1" },
      { side: "south", to: null, blocked: "water" },
      { side: "east", to: null },
    ]);
    const atlas = {
      maps: [
        { ...town, obstacles: [{ x: 2, y: 2, name: "CUT TREE", move: "CUT" }] },
        map("Town_Mart", false, [door(1, "Town")]),
        map("Route1", true, [door(5, "Route1_Gate")], [{ side: "south", to: "Town" }]),
        map("Route1_Gate", false, [door(1, "Route1"), door(2, "Route1_Gate_2F")]),
        map("Route1_Gate_2F", false, [door(1, "Route1_Gate"), door(2, "Forest")]),
        map("Forest", true, [door(1, "Route1_Gate_2F")]),
      ],
      lastTalk: null,
    };
    expect(knownWorld(atlas)).toEqual([
      "Known world, the outdoor maps that you visited, the first visit first:",
      "- Town: edges: north to Route1, south blocked (water), east not visited. Buildings entered: door at (3, 4), to Town_Mart. 1 door not entered. 2 unseen cells left. Fixed obstacles: CUT TREE at (2, 2).",
      "- Route1: edges: south to Town. Passages: door at (5, 4), to Route1_Gate, a passage through Route1_Gate_2F to Forest. 2 unseen cells left.",
      "- Forest: edges: none seen. Passages: door at (1, 4), to Route1_Gate_2F, a passage through Route1_Gate to Route1. 2 unseen cells left.",
    ]);
  });
});
