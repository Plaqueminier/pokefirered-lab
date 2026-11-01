import { describe, expect, setDefaultTimeout, test } from "bun:test";
import { existsSync } from "node:fs";
import { ROM_FILE, Run } from "../run";
import { type GhostPart, ghostSheet } from "../../viewer/race-sprite";
import { buildWorld, GHOST_PEOPLE, type World, type WorldIcon, type WorldPerson } from "./world";
import { runIdText } from "../protocol";

setDefaultTimeout(60_000);

const FAMILY_ENDS: [number, string][] = [[15, "red"], [40, "orange"], [70, "yellow"], [160, "green"], [195, "teal"], [250, "blue"], [295, "purple"], [345, "pink"], [361, "red"]];

function familyOf([r, g, b]: number[]): string | null {
  const [x, y, z] = [r / 255, g / 255, b / 255];
  const max = Math.max(x, y, z);
  const min = Math.min(x, y, z);
  const light = (max + min) / 2;
  const delta = max - min;
  if (light < 0.1) return null;
  if (delta === 0 || delta / (1 - Math.abs(2 * light - 1)) < 0.14) return light > 0.7 ? "white" : "grey";
  const sector = max === x ? ((y - z) / delta + 6) % 6 : max === y ? (z - x) / delta + 2 : (x - y) / delta + 4;
  return FAMILY_ENDS.find(([end]) => sector * 60 < end)?.[1] ?? null;
}

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
    expect(new Set(links.map((link) => nameOf(link.island)))).toEqual(new Set(["ViridianForest", "SafariZone_Center", "MtMoon_1F", "MtMoon_B1F"]));
    expect(links.filter((link) => nameOf(link.island) === "ViridianForest").map((link) => nameOf(link.map))).toEqual(["Route2", "Route2", "Route2", "Route2"]);
    expect(links.filter((link) => nameOf(link.island)?.startsWith("MtMoon")).map((link) => [nameOf(link.island), nameOf(link.map), link.x, link.y])).toEqual([
      ["MtMoon_1F", "Route4", 19, 5],
      ["MtMoon_B1F", "Route4", 32, 5],
    ]);
    expect(mapOf("MtMoon_B2F")?.door).toBeNull();

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
    expect(world.badges.width).toBe(128);
    expect(world.badges.height).toBe(16);
    expect(world.tilesets[lab?.primary ?? 0].tiles.length).toBeGreaterThan(1000);
  });

  test("the 55 sprites of the Ghosts come in the fixed order, with the layout of their palette, and a known sprite has its first rows", async () => {
    const { people } = await kanto();
    expect(people.map((person) => person.name)).toEqual(GHOST_PEOPLE);
    expect(people).toHaveLength(55);
    expect(people.filter((person) => person.layout === "player").map((person) => person.name)).toEqual(["green_normal", "red_normal"]);
    for (const { width, height } of people) expect([width, height]).toEqual([144, 32]);
    const red = people.find((person) => person.name === "red_normal") as WorldPerson;
    const indices = Buffer.from(red.pixels, "base64");
    const row = (y: number) => [...indices.subarray(y * 144, y * 144 + 16)].map((index) => index.toString(16)).join("");
    expect(row(11)).toBe("0000000000000000");
    expect(row(12)).toBe("0000888888880000");
    expect(row(30)).toBe("0000ff0000ff0000");
    expect(red.palette.slice(15 * 3, 16 * 3)).toEqual([0, 0, 0]);
    expect(people.find((person) => person.name === "boy")?.palette.slice(14 * 3, 16 * 3)).toEqual([255, 255, 255, 0, 0, 0]);
  });

  test("the icon of each species comes by its name, with 32 × 32 pixels and its palette", async () => {
    const { icons } = await kanto();
    const names = icons.map((icon) => icon.species);
    expect(new Set(names).size).toBe(names.length);
    for (const species of ["BULBASAUR", "MEW", "PIDGEY"]) expect(names).toContain(species);
    const bulbasaur = icons.find((icon) => icon.species === "BULBASAUR") as WorldIcon;
    expect([bulbasaur.width, bulbasaur.height]).toEqual([32, 32]);
    expect(Buffer.from(bulbasaur.pixels, "base64").filter((index) => index !== 0).length).toBeGreaterThan(100);
    expect(bulbasaur.palette).toHaveLength(48);
  });

  test("pinned faces with the sprites of the ROM, and on 1000 ids each family is the main colour of 8% to 14% of them", async () => {
    const { people } = await kanto();
    const parts: GhostPart[] = people.map(({ name, layout, pixels, palette }) => ({ name, layout, palette, indices: new Uint8Array(Buffer.from(pixels, "base64")) }));
    const pinned = ["00001", "00017", "00032"].map((id) => {
      const { head, body, rgba } = ghostSheet(id, parts);
      return [id, head, body, Bun.hash.crc32(rgba).toString(16)];
    });
    expect(pinned).toEqual([
      ["00001", "rs_brendan", "woman_2", "54d07344"],
      ["00017", "youngster", "picnicker", "67a47c04"],
      ["00032", "rich_boy", "crush_girl", "b508171d"],
    ]);

    const FRAME = 16;
    const main = new Map<string, number>();
    const sheets = new Set<number>();
    for (let n = 1; n <= 1000; n++) {
      const { rgba, head, body } = ghostSheet(runIdText(n), parts);
      sheets.add(Bun.hash.crc32(rgba));
      const seen = new Map<string, number>();
      for (let y = 0; y < 32; y++)
        for (let x = 0; x < FRAME; x++) {
          const part = parts.find((other) => other.name === (y < 23 ? head : body)) as GhostPart;
          const index = part.indices[y * 144 + x];
          if (index === 0 || (index >= (part.layout === "player" ? 2 : 1) && index <= 4)) continue;
          const at = (y * 144 + x) * 4;
          const name = familyOf([rgba[at], rgba[at + 1], rgba[at + 2]]);
          if (name) seen.set(name, (seen.get(name) ?? 0) + 1);
        }
      const top = [...seen].sort((a, b) => b[1] - a[1])[0];
      if (top) main.set(top[0], (main.get(top[0]) ?? 0) + 1);
    }
    expect(sheets.size).toBe(1000);
    const families = ["blue", "green", "orange", "pink", "purple", "red", "teal", "yellow"].map((name) => [name, main.get(name) ?? 0] as const);
    for (const [name, count] of families) {
      expect([name, count >= 80]).toEqual([name, true]);
      expect([name, count <= 140]).toEqual([name, true]);
    }
  });
});
