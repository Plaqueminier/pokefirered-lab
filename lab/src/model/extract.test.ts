import { describe, expect, test } from "bun:test";
import type { MapGrid } from "../game";
import type { AtlasMap } from "../harness/atlas";
import type { Person } from "../harness/harness";
import { atlasExtract, FULL_ATLAS_BUDGET, fullAtlas, OTHER_MAPS_BUDGET } from "./extract";
import type { Overworld } from "./targets";

const LAB: AtlasMap = {
  name: "Lab",
  width: 5,
  height: 4,
  cells: "#####" + "#..?#" + "#..?#" + "##.##",
  warps: [
    { x: 2, y: 3, behavior: "MB_SOUTH_ARROW_WARP", to: "Town" },
    { x: 0, y: 1, behavior: "MB_WARP_DOOR", to: null },
  ],
  edges: [],
  hasEdges: false,
  signs: [],
  people: [],
  entry: { x: 2, y: 2 },
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
    signs: [],
    people: [],
    entry: { x: 5, y: 5 },
  }));
}

describe("the extract of the Atlas", () => {
  test("the map block of a house: every row with ? for the cells not seen, the targets as letters in groups with their distance and direction, no edge that leads out, and no exit to the outside yet", () => {
    const house: AtlasMap = {
      name: "House",
      width: 8,
      height: 6,
      cells: "########" + "#......#".repeat(3) + "?".repeat(16),
      warps: [{ x: 6, y: 1, behavior: "MB_UP_RIGHT_STAIR_WARP", to: "House_2F" }],
      edges: [],
      hasEdges: false,
      signs: [{ x: 3, y: 0, facing: "north", text: "It's a TV." }],
      people: [{ localId: 1, graphics: "MOM", x: 5, y: 3, texts: ["MOM: Hi!"] }],
      entry: { x: 6, y: 2 },
    };
    const upstairs: AtlasMap = { ...house, name: "House_2F", cells: "#".repeat(48), warps: [{ x: 1, y: 1, behavior: "MB_DOWN_LEFT_STAIR_WARP", to: "House" }], signs: [], people: [] };
    const view = atlasExtract(overworld(house, [upstairs], { x: 3, y: 1 }, [{ localId: 1, x: 5, y: 3, graphics: "MOM", loaded: true }]));
    expect(view.lines).toEqual([
      "Map House: x from 0 to 7, y from 0 to 5. You are at (3, 1), facing north.",
      'Legend: # blocked, . open, " tall grass, ~ water, ^ v < > a ledge that you jump down in that direction only, ? not seen, @ you, letters the targets.',
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
      '- MOM, last seen at (5, 3): "MOM: Hi!"',
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
      "D. MOM at (5, 3), 2 south, 2 east: talked",
    ]);
  });

  test("a water edge says that the player cannot go there now and why, and it is not a target", () => {
    const [town] = chain(0);
    const view = atlasExtract(overworld({ ...town, edges: [{ side: "south", to: null, blocked: "water" }, ...town.edges.slice(1)] }, []));
    expect(view.lines).toContain("- south edge: you cannot go there now: the south edge of Town is water. Only a Pokémon that knows SURF can cross water, and you have none.");
    expect(view.targets.filter((t) => t.kind === "edge").map((t) => t.label)).toEqual(["north edge, 3 north: not taken"]);
  });

  test("the people on the cells that the player did not see are not targets", () => {
    const lass = { localId: 3, graphics: "LASS", x: 3, y: 1, loaded: true };
    const view = atlasExtract(overworld({ ...LAB, people: [{ ...lass, texts: [] }] }, [], { x: 1, y: 2 }, [lass]));
    expect(view.targets.map((t) => t.label)).not.toContainEqual(expect.stringContaining("LASS"));
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
    const city: AtlasMap = { ...LAB, name: "City", width: size, height: size, cells: ".".repeat(size * size), warps: [{ x: 2, y: 3, behavior: "MB_WARP_DOOR", to: "Town" }] };
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
});
