import { describe, expect, test } from "bun:test";
import type { Game, MapGrid, MapKind, Warp } from "../game";
import { AtlasWatch, type ExitPlace, mapNamed, placeFromInside, placeFromOutside } from "./atlas";
import type { ActionEntry, KnowledgeLevel } from "./harness";

function grid(name: string, num: number, warps: Warp[]): MapGrid {
  return { name, group: 0, num, x0: 0, y0: 0, width: 3, height: 1, mapWidth: 3, mapHeight: 1, kinds: "...", warps, connections: [], signs: [], outside: false } as unknown as MapGrid;
}

const stairs = (x: number, to: string, num: number, warpId = 0): Warp => ({ x, y: 0, to, group: 0, num, warpId, behavior: "MB_LADDER", toKind: "indoor", how: "step" });

function walk(grids: MapGrid[], places: [string, number][], knowledge: KnowledgeLevel = "player") {
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
    allMapNames: [grids.map((g) => g.name)],
  };
  const watch = new AtlasWatch(game as unknown as Game, knowledge);
  for (at = 0; at < places.length; at++) watch.onFrame();
  return watch.atlas();
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
    const watch = new AtlasWatch(game as unknown as Game, "player");
    watch.onFrame();
    return { watch, state };
  };
  const action = (entry: unknown) => entry as ActionEntry;
  const fight = action({ action: { name: "fight", move: 0 }, result: { status: "done", text: [] } });
  const read = (text: string[]) => action({ action: { name: "readText" }, result: { status: "done", text } });
  const heard = (watch: AtlasWatch) => mapNamed(watch.atlas(), "Cave").people.find((p) => p.localId === man.localId)?.texts;

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

describe("what a player sees on a Dark map", () => {
  const SIZE = 30;
  const kinds = ".".repeat(SIZE * SIZE);
  const room = (name: string, cave: boolean) => ({ name, group: 0, num: 0, x0: 0, y0: 0, width: SIZE, height: SIZE, mapWidth: SIZE, mapHeight: SIZE, kinds, warps: [], connections: [], signs: [], outside: false, cave }) as unknown as MapGrid;
  const man = { localId: 7, graphics: "SCIENTIST", x: 12, y: 10, facing: 1, loaded: true, stays: true };
  const rock = { x: 10, y: 12, name: "ROCK SMASH ROCK", move: "ROCK SMASH" };
  const watchOn = (cave: boolean, knowledge: KnowledgeLevel = "player") => {
    const grid = room("Cave", cave);
    const state = { x: 10, y: 10, flash: false, flashUser: null as number | null };
    const game = {
      mode: () => "overworld",
      battleUnderway: () => false,
      player: () => ({ x: state.x, y: state.y, facing: "north" }),
      map: () => grid,
      gridOf: () => grid,
      usableFieldMoves: () => new Set(),
      flashActive: () => state.flash,
      flashUser: () => state.flashUser,
      flashBadgeMissing: () => null,
      obstaclesOf: () => [rock],
      mapView: () => ({ grid, actors: { people: [man], obstacles: [rock] } }),
      allMapNames: [["Cave"]],
    };
    return { watch: new AtlasWatch(game as unknown as Game, knowledge), state };
  };
  const seenCount = (watch: AtlasWatch) => [...watch.sight().Cave].filter((seen) => seen === "1").length;
  const seenAt = (watch: AtlasWatch, x: number, y: number) => watch.sight().Cave[y * SIZE + x] === "1";

  test("in the dark, only the 3 x 3 cells around the player are seen, and the cells that the player saw stay seen", () => {
    const { watch, state } = watchOn(true);
    watch.onFrame();
    expect(seenCount(watch)).toBe(9);
    expect(seenAt(watch, 9, 9)).toBe(true);
    expect(seenAt(watch, 11, 11)).toBe(true);
    expect(seenAt(watch, 12, 10)).toBe(false);
    state.x = 11;
    watch.onFrame();
    expect(seenCount(watch)).toBe(12);
    expect(seenAt(watch, 9, 10)).toBe(true);
  });

  test("in the dark, the Atlas lists no person and no Fixed obstacle out of the 3 x 3 cells, and it lists them when they come in", () => {
    const { watch, state } = watchOn(true);
    watch.onFrame();
    watch.lookAround();
    expect(mapNamed(watch.atlas(), "Cave")).toMatchObject({ people: [], obstacles: [] });
    state.x = 11;
    state.y = 11;
    watch.onFrame();
    watch.lookAround();
    expect(mapNamed(watch.atlas(), "Cave").people).toMatchObject([{ localId: man.localId }]);
    expect(mapNamed(watch.atlas(), "Cave").obstacles).toMatchObject([{ x: rock.x, y: rock.y }]);
  });

  test("FLASH shows the 15 x 10 cells at once, with no new step", () => {
    const { watch, state } = watchOn(true);
    watch.onFrame();
    state.flash = true;
    watch.onFrame();
    expect(seenCount(watch)).toBe(150);
    expect(mapNamed(watch.atlas(), "Cave").people).toMatchObject([{ localId: man.localId }]);
  });

  test("another map and the full Knowledge level keep the 15 x 10 cells", () => {
    const other = watchOn(false);
    other.watch.onFrame();
    expect(seenCount(other.watch)).toBe(150);
    const full = watchOn(true, "full");
    full.watch.onFrame();
    expect(seenCount(full.watch)).toBe(150);
  });

  test("a map is dark for the model only in the dark, when the party cannot use FLASH", () => {
    const { watch, state } = watchOn(true);
    watch.onFrame();
    expect(mapNamed(watch.atlas(), "Cave").dark).toEqual({ missingBadge: null });
    state.flashUser = 0;
    expect(mapNamed(watch.atlas(), "Cave").dark).toBeUndefined();
    state.flashUser = null;
    state.flash = true;
    expect(mapNamed(watch.atlas(), "Cave").dark).toBeUndefined();
    const other = watchOn(false);
    other.watch.onFrame();
    expect(mapNamed(other.watch.atlas(), "Cave").dark).toBeUndefined();
    const full = watchOn(true, "full");
    full.watch.onFrame();
    expect(mapNamed(full.watch.atlas(), "Cave").dark).toBeUndefined();
  });

  test("a new cell seen is progress on a map that is dark for the model, and on no other map", () => {
    const dark = watchOn(true);
    dark.watch.onFrame();
    expect(dark.watch.darkCells).toBe(9);
    dark.state.x = 11;
    dark.watch.onFrame();
    expect(dark.watch.darkCells).toBe(12);
    dark.state.x = 10;
    dark.watch.onFrame();
    expect(dark.watch.darkCells).toBe(12);
    dark.state.flash = true;
    dark.watch.onFrame();
    expect(dark.watch.darkCells).toBe(12);
    const other = watchOn(false);
    other.watch.onFrame();
    other.state.x = 11;
    other.watch.onFrame();
    expect(other.watch.darkCells).toBe(0);
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

describe("the exit of an Elevator", () => {
  const mat: Warp = { x: 1, y: 0, to: "MAP_DYNAMIC", group: 127, num: 127, warpId: 127, behavior: "MB_SOUTH_ARROW_WARP", toKind: "indoor", how: "press", from: { x: 1, y: 0 }, direction: "south", dynamic: "unknown" };
  const wall: Warp = { ...stairs(2, "Elevator", 2), behavior: "MB_NORMAL", how: "none" };
  const floors = () => [grid("F1", 0, [stairs(1, "Elevator", 2), wall]), grid("F2", 1, [stairs(2, "Elevator", 2)]), grid("Elevator", 2, [mat])];

  test("the exit keeps one destination for each floor that the player came from or reached by it", () => {
    const atlas = walk(floors(), [["F1", 1], ["Elevator", 1], ["F2", 2]]);
    expect(mapNamed(atlas, "Elevator").warps).toMatchObject([
      { x: 1, y: 0, to: "F1", arrival: { x: 1, y: 0 }, elevator: true },
      { x: 1, y: 0, to: "F2", arrival: { x: 2, y: 0 }, elevator: true },
    ]);
    expect(mapNamed(atlas, "F2").warps).toMatchObject([{ to: "Elevator", arrival: { x: 1, y: 0 } }]);
  });

  test("an exit with no floor known is not taken", () => {
    const atlas = walk([grid("Elevator", 2, [mat])], [["Elevator", 0]]);
    expect(mapNamed(atlas, "Elevator").warps).toMatchObject([{ to: null, arrival: null, elevator: true }]);
  });

  test("at the full Knowledge level, the floors are all the maps with a warp to the Elevator, at the cell of the warp that the player can take", () => {
    const atlas = walk(floors(), [], "full");
    expect(mapNamed(atlas, "Elevator").warps).toMatchObject([
      { to: "F1", arrival: { x: 1, y: 0 }, elevator: true },
      { to: "F2", arrival: { x: 2, y: 0 }, elevator: true },
    ]);
  });
});

describe("the slides that the player took", () => {
  test("a goTo that slid keeps the slide, from its spin tile to the cell where the player stopped, also after a later goTo", () => {
    const room = { ...grid("Hideout", 0, []), width: 4, mapWidth: 4, kinds: "→..." };
    const game = {
      mode: () => "overworld",
      battleUnderway: () => false,
      player: () => ({ x: 3, y: 0, facing: "east" }),
      map: () => room,
      gridOf: () => room,
      usableFieldMoves: () => new Set(),
      actorsOf: () => ({ people: [], obstacles: [] }),
      obstaclesOf: () => [],
      mapView: () => ({ grid: room, actors: { people: [], obstacles: [] } }),
    };
    const watch = new AtlasWatch(game as unknown as Game, "player");
    watch.onFrame();
    watch.onAction({ action: { name: "goTo", x: 0, y: 0 }, result: { status: "done", slidTo: { x: 3, y: 0 }, frames: 40 } });
    watch.onAction({ action: { name: "goTo", x: 2, y: 0 }, result: { status: "done", frames: 8 } });
    const hideout = mapNamed(watch.atlas(), "Hideout");
    expect(hideout.slides).toEqual([{ from: { x: 0, y: 0 }, to: { x: 3, y: 0 } }]);
    expect(hideout.parts).toEqual([0, 1, 1, 1]);
  });
});
