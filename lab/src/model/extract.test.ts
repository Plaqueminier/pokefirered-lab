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
  signs: [],
  people: [],
  entry: { x: 2, y: 2 },
};

function overworld(current: AtlasMap, others: AtlasMap[], player = { x: 1, y: 2 }, people: Person[] = []): Overworld {
  const kinds = current.cells.replaceAll("?", ".");
  const grid = { name: current.name, x0: 0, y0: 0, width: current.width, height: current.height, mapWidth: current.width, mapHeight: current.height, kinds, signs: [] } as unknown as MapGrid;
  return {
    mode: "overworld",
    waitingFor: { kind: "walk" },
    party: [],
    milestones: [],
    map: { group: 0, num: 0, name: current.name },
    player: { ...player, facing: "north" },
    grid,
    people,
    atlas: { maps: [current, ...others] },
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
    signs: [],
    people: [],
    entry: { x: 5, y: 5 },
  }));
}

describe("the extract of the Atlas", () => {
  test("the local view shows the seen cells only, ? for the others, the player and the numbers of the targets; an exit shows its destination only when the Run went through it", () => {
    const view = atlasExtract(overworld(LAB, [], { x: 1, y: 2 }, [{ x: 1, y: 1, graphics: "PROF_OAK" }]));
    expect(view.lines).toEqual([
      "Map Lab, 5 × 4 cells. You are at (1, 2), facing north.",
      "    0",
      "    01234",
      "  0 #####",
      "  1 24.?#",
      "  2 #@3?#",
      "  3 ##1##",
      "",
      "Targets:",
      "1. exit mat at (2, 3), to Town",
      "2. door at (0, 1), not taken",
      "3. unseen cells east of (2, 2)",
      "4. PROF OAK at (1, 1)",
    ]);
  });

  test("the people on the cells that the player did not see are not targets", () => {
    const view = atlasExtract(overworld(LAB, [], { x: 1, y: 2 }, [{ x: 3, y: 1, graphics: "LASS" }]));
    expect(view.targets.map((t) => t.label)).not.toContainEqual(expect.stringContaining("LASS"));
  });

  test("a direct neighbour has a line with its exits; the other maps are targets, and past their budget, the far maps lose their line first", () => {
    const view = atlasExtract(overworld(LAB, chain(200)));
    const localOnly = atlasExtract(overworld(LAB, [])).lines.join("\n");
    expect(view.lines.join("\n").length - localOnly.length).toBeLessThanOrEqual(OTHER_MAPS_BUDGET);
    expect(view.lines).toContain("- Town: south edge, not taken; north edge, to Route0");
    const maps = view.targets.flatMap((t) => (t.kind === "map" ? [t.map] : []));
    expect(maps.length).toBeGreaterThan(10);
    expect(maps).toEqual(Array.from({ length: maps.length }, (_, i) => `Route${i}`));
    expect(view.lines).toContain("5. go to Route1 (3 exits away)");
  });

  test("a large map of the player does not remove the maps one exit away", () => {
    const size = 80;
    const city: AtlasMap = { ...LAB, name: "City", width: size, height: size, cells: ".".repeat(size * size), warps: [{ x: 2, y: 3, behavior: "MB_WARP_DOOR", to: "Town" }] };
    const view = atlasExtract(overworld(city, chain(3)));
    expect(view.lines).toContain("- Town: south edge, not taken; north edge, to Route0");
    expect(view.lines).toContain(` 79 ${".".repeat(size)}`);
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
    expect(complete).toContain("Map Route59, 24 × 40 cells, 61 exits away.");
    expect(complete).not.toContain("\n- Route");

    const appendix = fullAtlas(overworld(LAB, chain(200)));
    expect(appendix).toContain("Map Town, 24 × 40 cells, 1 exit away. Exits: south edge, not taken; north edge, to Route0.");
    expect(appendix).toContain(" 39 ........................");
    const oneLine = appendix.findIndex((line) => line.startsWith("- Route"));
    expect(appendix.slice(0, oneLine).join("\n").length).toBeLessThanOrEqual(FULL_ATLAS_BUDGET);
    expect(appendix.slice(oneLine).every((line) => line.startsWith("- Route"))).toBe(true);
    expect(appendix.at(-1)).toBe("- Route199, 201 exits away. Exits: south edge, to Route198; north edge, not taken.");
  });
});
