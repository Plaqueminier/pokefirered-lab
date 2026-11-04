import { describe, expect, test } from "bun:test";
import type { Game, MapGrid, MapKind, Warp } from "../game";
import { AtlasWatch, type ExitPlace, mapNamed, placeFromInside, placeFromOutside } from "./atlas";
import type { ActionEntry } from "./harness";

function grid(name: string, num: number, warps: Warp[]): MapGrid {
  return { name, group: 0, num, x0: 0, y0: 0, width: 3, height: 1, mapWidth: 3, mapHeight: 1, kinds: "...", warps, connections: [], signs: [], outside: false } as unknown as MapGrid;
}

const stairs = (x: number, to: string, num: number, warpId = 0): Warp => ({ x, y: 0, to, group: 0, num, warpId, behavior: "MB_LADDER", toKind: "indoor", how: "step" });

function walk(grids: MapGrid[], places: [string, number][]) {
  let at = 0;
  const here = () => grids.find((g) => g.name === places[at][0])!;
  const game = {
    mode: () => "overworld",
    battleUnderway: () => false,
    player: () => ({ x: places[at][1], y: 0 }),
    map: () => here(),
    gridOf: (_group: number, num: number) => grids.find((g) => g.num === num) ?? null,
    usableFieldMoves: () => new Set(),
    actorsOf: () => ({ people: [], obstacles: [] }),
    obstaclesOf: () => [],
    mapView: (name: string) => ({ grid: grids.find((g) => g.name === name), actors: { people: [], obstacles: [] } }),
  };
  const watch = new AtlasWatch(game as unknown as Game);
  for (at = 0; at < places.length; at++) watch.onFrame();
  return watch.atlas("player");
}

describe("what the people said", () => {
  const room = grid("Cave", 1, []);
  const man = { localId: 7, graphics: "SCIENTIST", x: 1, y: 0, facing: 1, loaded: true, stays: true };
  const watchOf = () => {
    const state = { battle: false };
    const game = {
      mode: () => "overworld",
      battleUnderway: () => state.battle,
      player: () => ({ x: 1, y: 1, facing: "north" }),
      map: () => room,
      gridOf: () => room,
      usableFieldMoves: () => new Set(),
      actorsOf: () => ({ people: [man], obstacles: [] }),
      obstaclesOf: () => [],
      mapView: () => ({ grid: room, actors: { people: [man], obstacles: [] } }),
    };
    const watch = new AtlasWatch(game as unknown as Game);
    watch.onFrame();
    return { watch, state };
  };
  const action = (entry: unknown) => entry as ActionEntry;
  const fight = action({ action: { name: "fight", move: 0 }, result: { status: "done", text: [] } });
  const read = (text: string[]) => action({ action: { name: "readText" }, result: { status: "done", text } });
  const heard = (watch: AtlasWatch) => mapNamed(watch.atlas("player"), "Cave").people.find((p) => p.localId === man.localId)?.texts;

  test("a text right after a battle belongs to the person that the player faces, with no talk before it", () => {
    const { watch, state } = watchOf();
    state.battle = true;
    watch.onFrame();
    state.battle = false;
    watch.onFrame();
    watch.onAction(fight);
    watch.onAction(read(["We'll each take a fossil!"]));
    expect(heard(watch)).toEqual(["We'll each take a fossil!"]);
  });

  test("the text that ends the battle belongs to nobody, and the next text belongs to the person", () => {
    const { watch, state } = watchOf();
    state.battle = true;
    watch.onFrame();
    watch.onAction(fight);
    watch.onFrame();
    state.battle = false;
    watch.onFrame();
    watch.onAction(read(["Foe KOFFING fainted!"]));
    watch.onAction(read(["We'll each take a fossil!"]));
    expect(heard(watch)).toEqual(["We'll each take a fossil!"]);
  });

  test("a text with no battle and no talk belongs to nobody", () => {
    const { watch } = watchOf();
    watch.onAction(action({ action: { name: "goTo", x: 1, y: 1 }, result: { status: "interrupted", reason: "script" } }));
    watch.onAction(read(["A voice from nowhere."]));
    expect(heard(watch) ?? []).toEqual([]);
  });
});

describe("what a player sees of an exit", () => {
  const door = "MB_WARP_DOOR";
  const seenFromOutside: [string, MapKind, ExitPlace][] = [
    ["ViridianCity_PokemonCenter_1F", "indoor", "center"],
    ["Route4_PokemonCenter_1F", "indoor", "center"],
    ["PewterCity_Mart", "indoor", "mart"],
    ["CeladonCity_DepartmentStore_1F", "indoor", "departmentStore"],
    ["PewterCity_Gym", "indoor", "gym"],
    ["PalletTown_PlayersHouse_1F", "indoor", "house"],
    ["Route25_SeaCottage", "indoor", "house"],
    ["Route2_ViridianForest_SouthEntrance", "indoor", "gate"],
    ["Route2_ViridianForest_NorthEntrance", "indoor", "gate"],
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
  for (const [to, kind, place] of seenFromOutside) test(`from outside, ${to} is ${place}`, () => expect(placeFromOutside({ to, toKind: kind })).toBe(place));

  test("from inside, only a cave door shows a place, by the kind of map where it leads", () => {
    expect(placeFromInside({ behavior: "MB_CAVE_DOOR", toKind: "outdoor" })).toBe("outside");
    expect(placeFromInside({ behavior: "MB_CAVE_DOOR", toKind: "underground" })).toBe("cave");
    expect(placeFromInside({ behavior: "MB_CAVE_DOOR", toKind: "indoor" })).toBeNull();
    expect(placeFromInside({ behavior: "MB_LADDER", toKind: "outdoor" })).toBeNull();
    expect(placeFromInside({ behavior: door, toKind: "indoor" })).toBeNull();
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
