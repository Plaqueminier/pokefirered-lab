import { describe, expect, setDefaultTimeout, test } from "bun:test";
import { existsSync } from "node:fs";
import { ROM_FILE } from "../run";
import { openAt, overworld, PARTY_SAVE, setFlag, writeFlag, writeVar } from "./game-fixtures";
import { must } from "./harness";

setDefaultTimeout(60_000);

const FLAG_POKEMON_MANSION_SWITCH_STATE = 0x26c;
const VAR_MAP_SCENE_VICTORY_ROAD_1F = 0x4064;
const FLOOR_SWITCH_PRESSED = 100;

describe.skipIf(!existsSync(ROM_FILE) || !existsSync(PARTY_SAVE))("the flags that the map scripts of a map read, for a route through the other maps", () => {
  test("in the Pokémon Mansion, with no change of the switch since the last step on 2F, a goTo with no route on these cells stays on 3F and gives the reason of that route", async () => {
    const { harness } = await openAt("PokemonMansion_2F", 10, 14, false, (run) => setFlag(run, FLAG_POKEMON_MANSION_SWITCH_STATE));
    must(await harness.goTo(9, 14));
    expect(overworld(harness)).toMatchObject({ map: { name: "PokemonMansion_3F" }, player: { x: 11, y: 11 } });
    expect(await harness.goTo(10, 4)).toMatchObject({ status: "impossible", reason: expect.stringContaining("no route from PokemonMansion_3F (11, 11) to PokemonMansion_3F (10, 4)"), frames: 0 });
    expect(overworld(harness)).toMatchObject({ map: { name: "PokemonMansion_3F" }, player: { x: 11, y: 11 } });
    harness.close();
  });

  test("in the Pokémon Mansion, after a change of the switch, a goTo uses the cells of the ROM for a floor with the cells of the old switch", async () => {
    const { harness, run } = await openAt("PokemonMansion_2F", 10, 14, false, (r) => setFlag(r, FLAG_POKEMON_MANSION_SWITCH_STATE));
    must(await harness.goTo(9, 14));
    writeFlag(run, FLAG_POKEMON_MANSION_SWITCH_STATE, false);
    const before = harness.events.length;
    must(await harness.goTo(10, 4));
    expect(overworld(harness)).toMatchObject({ map: { name: "PokemonMansion_3F" }, player: { x: 10, y: 4 } });
    expect(harness.events.slice(before).flatMap((e) => (e.type === "map" ? [e.map] : []))).toEqual(["PokemonMansion_2F", "PokemonMansion_3F"]);
    harness.close();
  });

  test("on Victory Road, after a step on 1F with its switch pressed and an entry into Route 23, a goTo across 1F does not go through the barrier that Route 23 closed again", async () => {
    const { harness, run, warpTo } = await openAt("VictoryRoad_1F", 11, 19, false);
    writeVar(run, VAR_MAP_SCENE_VICTORY_ROAD_1F, FLOOR_SWITCH_PRESSED);
    warpTo({ map: "VictoryRoad_2F", x: 2, y: 9 });
    await harness.goTo(11, 20);
    must(await harness.goTo(1, 9));
    expect(overworld(harness)).toMatchObject({ map: { name: "VictoryRoad_1F" }, player: { x: 3, y: 2 } });
    warpTo({ map: "Route23", x: 5, y: 29 });
    await harness.goTo(3, 2);
    expect(overworld(harness)).toMatchObject({ map: { name: "Route23" }, player: { x: 5, y: 29 } });
    expect(await harness.goTo(4, 4, "VictoryRoad_1F")).toMatchObject({ status: "impossible", frames: 0 });
    expect(overworld(harness)).toMatchObject({ map: { name: "Route23" }, player: { x: 5, y: 29 } });
    harness.close();
  });
});

describe.skipIf(!existsSync(ROM_FILE) || !existsSync(PARTY_SAVE))("the Same-map pads of the Saffron Gym and of Silph Co", () => {
  test("a goTo to a pad next to the player takes it: the walk ends at the arrival cell of the pad, and the result names the cell", async () => {
    const { harness } = await openAt("SaffronCity_Gym", 17, 20, false);
    expect(await harness.goTo(18, 20)).toEqual({ status: "done", padTo: { x: 28, y: 23 }, frames: expect.any(Number) });
    expect(overworld(harness)).toMatchObject({ map: { name: "SaffronCity_Gym" }, player: { x: 28, y: 23 } });
    harness.close();
  });

  test("a goTo to the pad under the player steps off it and on again: it takes the pad, with more than 0 frames", async () => {
    const { harness } = await openAt("SaffronCity_Gym", 18, 20, false);
    const result = await harness.goTo(18, 20);
    expect(result).toMatchObject({ status: "done", padTo: { x: 28, y: 23 } });
    expect(result.frames).toBeGreaterThan(0);
    expect(overworld(harness).player).toMatchObject({ x: 28, y: 23 });
    harness.close();
  });

  test("in SilphCo_3F, a goTo to the pad (32, 20) from the side of its partner (29, 14) takes the pad (32, 20), and does not end on it from (29, 14)", async () => {
    const { harness } = await openAt("SilphCo_3F", 29, 15, false);
    expect(await harness.goTo(32, 20)).toMatchObject({ status: "done", padTo: { x: 29, y: 14 } });
    expect(overworld(harness).player).toMatchObject({ x: 29, y: 14 });
    harness.close();
  });

  test("a goTo to a plain cell across the Saffron Gym still takes the pads on its way, and gets there", async () => {
    const { harness } = await openAt("SaffronCity_Gym", 17, 20, false);
    expect(await harness.goTo(27, 12)).toEqual({ status: "done", frames: expect.any(Number) });
    expect(overworld(harness)).toMatchObject({ map: { name: "SaffronCity_Gym" }, player: { x: 27, y: 12 } });
    harness.close();
  });

  test("a goTo to the exit of the Saffron Gym, a warp to another map, still leaves the Gym, and the result names no pad", async () => {
    const { harness } = await openAt("SaffronCity_Gym", 17, 20, false);
    expect(await harness.goTo(14, 23)).toEqual({ status: "done", frames: expect.any(Number) });
    expect(overworld(harness).map.name).toBe("SaffronCity");
    harness.close();
  });
});
