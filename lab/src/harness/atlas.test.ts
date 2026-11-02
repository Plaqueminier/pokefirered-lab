import { describe, expect, test } from "bun:test";
import { exitPlaceOf, type Game, type MapGrid, type Warp } from "../game";
import { AtlasWatch, mapNamed } from "./atlas";

function grid(name: string, num: number, warps: Warp[]): MapGrid {
  return { name, group: 0, num, x0: 0, y0: 0, width: 3, height: 1, mapWidth: 3, mapHeight: 1, kinds: "...", warps, connections: [], signs: [], outside: false } as unknown as MapGrid;
}

const stairs = (x: number, to: string, num: number, warpId = 0): Warp => ({ x, y: 0, to, group: 0, num, warpId, behavior: "MB_LADDER", place: null, how: "step" });

function walk(grids: MapGrid[], places: [string, number][]) {
  let at = 0;
  const here = () => grids.find((g) => g.name === places[at][0])!;
  const game = {
    mode: () => "overworld",
    player: () => ({ x: places[at][1], y: 0 }),
    map: () => here(),
    gridOf: (_group: number, num: number) => grids.find((g) => g.num === num) ?? null,
    withObstacles: (g: MapGrid) => g,
    actorsOf: () => ({ people: [], obstacles: [] }),
    mapView: (name: string) => ({ grid: grids.find((g) => g.name === name), actors: { people: [], obstacles: [] } }),
  };
  const watch = new AtlasWatch(game as unknown as Game);
  for (at = 0; at < places.length; at++) watch.onFrame();
  return watch.atlas("player");
}

describe("what a player sees of an exit", () => {
  const door = "MB_WARP_DOOR";
  const seenFromOutside: [string, "outdoor" | "underground" | "indoor", string][] = [
    ["ViridianCity_PokemonCenter_1F", "indoor", "center"],
    ["Route4_PokemonCenter_1F", "indoor", "center"],
    ["PewterCity_Mart", "indoor", "mart"],
    ["CeladonCity_DepartmentStore_1F", "indoor", "departmentStore"],
    ["PewterCity_Gym", "indoor", "gym"],
    ["PalletTown_PlayersHouse_1F", "indoor", "house"],
    ["Route25_SeaCottage", "indoor", "house"],
    ["Route2_ViridianForest_SouthEntrance", "indoor", "gate"],
    ["Route16_NorthEntrance_1F", "indoor", "gate"],
    ["Route2_EastBuilding", "indoor", "gate"],
    ["UndergroundPath_NorthEntrance", "indoor", "gate"],
    ["FuchsiaCity_SafariZone_Entrance", "indoor", "gate"],
    ["VermilionCity_PokemonFanClub", "indoor", "building"],
    ["PewterCity_Museum_1F", "indoor", "building"],
    ["CinnabarIsland_PokemonLab_Entrance", "indoor", "building"],
    ["Route5_PokemonDayCare", "indoor", "building"],
    ["TrainerTower_Lobby", "indoor", "building"],
    ["FiveIsland_Harbor", "indoor", "harbor"],
    ["SSAnne_Exterior", "indoor", "harbor"],
    ["MtMoon_1F", "underground", "cave"],
    ["DiglettsCave_NorthEntrance", "underground", "cave"],
    ["SafariZone_North", "outdoor", "path"],
  ];
  for (const [to, kind, place] of seenFromOutside) test(`from outside, ${to} is ${place}`, () => expect(exitPlaceOf(true, door, to, kind)).toBe(place as never));

  test("the cell of a cave door tells nothing: from outside, a gate or a museum with this cell is not a cave", () => {
    expect(exitPlaceOf(true, "MB_CAVE_DOOR", "Route2_ViridianForest_SouthEntrance", "indoor")).toBe("gate");
    expect(exitPlaceOf(true, "MB_CAVE_DOOR", "PewterCity_Museum_1F", "indoor")).toBe("building");
    expect(exitPlaceOf(true, "MB_CAVE_DOOR", "Route2_ViridianForest_NorthEntrance", "indoor")).toBe("gate");
  });

  test("from inside, only a cave door shows a place, by the kind of map where it leads", () => {
    expect(exitPlaceOf(false, "MB_CAVE_DOOR", "Route4", "outdoor")).toBe("outside");
    expect(exitPlaceOf(false, "MB_CAVE_DOOR", "FourIsland_IcefallCave_1F", "underground")).toBe("cave");
    expect(exitPlaceOf(false, "MB_CAVE_DOOR", "SevenIsland_House_Room1", "indoor")).toBeNull();
    expect(exitPlaceOf(false, "MB_LADDER", "Route4", "outdoor")).toBeNull();
    expect(exitPlaceOf(false, door, "ViridianCity_PokemonCenter_1F", "indoor")).toBeNull();
  });
});

describe("the arrival of an exit", () => {
  test("an exit that the player took has the cell where the player arrived, and its pair has the cell of the warp data", () => {
    const atlas = walk([grid("A", 0, [stairs(1, "B", 1)]), grid("B", 1, [stairs(2, "A", 0)])], [["A", 1], ["B", 2]]);
    expect(mapNamed(atlas, "A").warps).toMatchObject([{ to: "B", arrival: { x: 2, y: 0 } }]);
    expect(mapNamed(atlas, "B").warps).toMatchObject([{ to: "A", arrival: { x: 1, y: 0 } }]);
  });

  test("a warp where the player arrives and that leads to another map is not taken: not all the warps are in pairs", () => {
    const atlas = walk([grid("A", 0, [stairs(1, "B", 1)]), grid("B", 1, [stairs(2, "C", 2)]), grid("C", 2, [])], [["A", 1], ["B", 2]]);
    expect(mapNamed(atlas, "A").warps).toMatchObject([{ to: "B", arrival: { x: 2, y: 0 } }]);
    expect(mapNamed(atlas, "B").warps).toMatchObject([{ to: null, arrival: null }]);
  });
});
