import { describe, expect, setDefaultTimeout, test } from "bun:test";
import { existsSync } from "node:fs";
import { ROM_FILE, Run } from "../run";
import { buildWorld, type World } from "./world";

setDefaultTimeout(60_000);

async function kanto(): Promise<World> {
  const run = await Run.open();
  try {
    return buildWorld(run.game);
  } finally {
    run.core.close();
  }
}

describe.skipIf(!existsSync(ROM_FILE))("the world of a Race", () => {
  test("Kanto has 37 outdoor maps, Route 1 just above Pallet Town, the real Saffron City, and interiors with the door they count at", async () => {
    const world = await kanto();
    expect(world.regions.map((region) => region.name)).toEqual(["Kanto"]);
    const { places, links } = world.regions[0];
    const nameOf = (key: string) => world.maps.find((map) => map.key === key)?.name;
    const placeOf = (name: string) => places.find((place) => nameOf(place.map) === name);
    const mapOf = (name: string) => world.maps.find((map) => map.name === name);

    expect(places.filter((place) => !place.island)).toHaveLength(37);
    const pallet = placeOf("PalletTown");
    const route1 = placeOf("Route1");
    expect(route1?.x).toBe(pallet?.x);
    expect(route1?.y).toBe((pallet?.y ?? 0) - (mapOf("Route1")?.height ?? 0));

    expect(placeOf("SaffronCity")).toBeDefined();
    expect(placeOf("SaffronCity_Connection")).toBeUndefined();
    expect(nameOf(places[0].map)).toBe("SaffronCity");

    expect(placeOf("ViridianForest")).toMatchObject({ island: true, scale: 0.82 });
    expect(new Set(links.map((link) => nameOf(link.island)))).toEqual(new Set(["ViridianForest", "SafariZone_Center"]));
    expect(links.filter((link) => nameOf(link.island) === "ViridianForest").map((link) => nameOf(link.map))).toEqual(["Route2", "Route2", "Route2", "Route2"]);

    const lab = mapOf("PalletTown_ProfessorOaksLab");
    expect(lab?.door).toEqual({ map: pallet?.map as string, x: 16, y: 13 });
    expect(mapOf("PalletTown_PlayersHouse_2F")?.door?.map).toBe(pallet?.map as string);
    expect(lab?.title).toBe("Pallet Town · Prof. Oak's Lab");
    expect(mapOf("PewterCity_Gym")?.kind).toBe("building");
    expect(mapOf("MtMoon_1F")?.kind).toBe("cave");
    expect(mapOf("PalletTown")?.kind).toBe("town");
    expect(mapOf("Route1")?.kind).toBe("route");

    expect(world.gyms).toHaveLength(8);
    expect(world.gyms[0].milestone).toBe("badge-1");
    expect(nameOf(world.gyms[0].door.map)).toBe("PewterCity");
    expect(world.player.width).toBe(144);
    expect(world.player.height).toBe(32);
    expect(world.badges.width).toBe(128);
    expect(world.badges.height).toBe(16);
    expect(world.tilesets[lab?.primary ?? 0].tiles.length).toBeGreaterThan(1000);
  });
});
