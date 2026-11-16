import { join } from "node:path";
import { REPO_DIR, readMapJsons, readSectionNames } from "./map-data";

const SYS_FLAGS = 0x800;
const FLY_REGIONS = ["kanto", "sevii_123", "sevii_45", "sevii_67"] as const;

type FlyRegion = (typeof FLY_REGIONS)[number];

export type FlyDestination = { name: string; area: string; map: string; x: number; y: number; flag: number; region: FlyRegion; tile: { x: number; y: number } };

export type FlyData = { destinations: FlyDestination[]; regions: ReadonlyMap<string, FlyRegion> };

// From region_map.c: GetMapsecType has the flag of each place, sMapFlyDestinations its heal location, and sSeviiMapsecs the sections of each Sevii region.
export async function readFlyData(): Promise<FlyData> {
  const text = (path: string) => Bun.file(join(REPO_DIR, path)).text();
  const json = <T>(path: string) => Bun.file(join(REPO_DIR, path)).json() as Promise<T>;
  const [regionMap, flagsText, heals, sectionName, layouts, maps] = await Promise.all([
    text("src/region_map.c"),
    text("include/constants/flags.h"),
    json<{ heal_locations: { id: string; map: string; x: number; y: number }[] }>("src/data/heal_locations.json"),
    readSectionNames(),
    Promise.all(FLY_REGIONS.map((region) => text(`src/data/region_map/region_map_layout_${region}.h`))),
    readMapJsons(),
  ]);
  const flags = new Map([...flagsText.matchAll(/^#define (FLAG_WORLD_MAP_\w+)\s+\(SYS_FLAGS \+ (0x[0-9A-Fa-f]+)\)/gm)].map((m) => [m[1], SYS_FLAGS + Number(m[2])]));
  const flagOf = new Map([...functionBody(regionMap, "GetMapsecType").matchAll(/case (MAPSEC_\w+):\s*(?:if \(.*\n\s*return MAPSECTYPE_NONE;\s*)?return FlagGet\((FLAG_WORLD_MAP_\w+)\)/g)].map((m) => [m[1], m[2]]));
  const healOf = new Map(heals.heal_locations.map((heal) => [heal.id, heal]));
  const mapNameOf = new Map(maps.map((map) => [map.id, map.name]));
  const tiles = layouts.map(layoutTiles);
  const regionOf = seviiRegions(regionMap);
  const destinations = [...regionMap.matchAll(/\[(MAPSEC_\w+)\s*-\s*KANTO_MAPSEC_START\]\s*=\s*\{MAP\(\w+\),\s*(HEAL_LOCATION_\w+)\}/g)].filter(([, , healId]) => healId !== "HEAL_LOCATION_NONE").map(([, section, healId]): FlyDestination => {
    const heal = need(healOf.get(healId), healId);
    const flag = need(flags.get(need(flagOf.get(section), `the flag of ${section}`)), `the value of the flag of ${section}`);
    const region = regionOf(section);
    const area = need(sectionName.get(section), section);
    return { name: `${area}${section.endsWith("_POKECENTER") ? " Pokémon Center" : ""}`, area, map: need(mapNameOf.get(heal.map), heal.map), x: heal.x, y: heal.y, flag, region, tile: need(tiles[FLY_REGIONS.indexOf(region)].get(section), `the tile of ${section}`) };
  });
  return { destinations, regions: new Map(maps.map((map) => [map.name, regionOf(map.region_map_section)])) };
}

function need<T>(value: T | undefined, what: string): T {
  if (value === undefined) throw new Error(`the FLY data has no ${what}`);
  return value;
}

function functionBody(source: string, name: string): string {
  const start = source.indexOf(`static u8 ${name}(u8 mapsec)\n{`);
  if (start < 0) throw new Error(`region_map.c has no ${name}`);
  return source.slice(start, source.indexOf("\n}\n", start));
}

// LoadPlayerRegion: a section of a list of sSeviiMapsecs is in that Sevii region, and each other section is in Kanto.
function seviiRegions(regionMap: string): (section: string) => FlyRegion {
  const lists = regionMap.slice(regionMap.indexOf("sSeviiMapsecs[3][30] = {"));
  const sevii = new Map<string, FlyRegion>();
  for (const [, region, body] of lists.matchAll(/\[REGIONMAP_(SEVII\d+) - 1\] =\s*\{([^}]*)\}/g)) {
    for (const section of body.match(/MAPSEC_\w+/g) ?? []) if (section !== "MAPSEC_NONE") sevii.set(section, `sevii_${region.slice("SEVII".length)}` as FlyRegion);
  }
  if (sevii.size === 0) throw new Error("region_map.c has no sSeviiMapsecs");
  return (section) => sevii.get(section) ?? "kanto";
}

function layoutTiles(layout: string): Map<string, { x: number; y: number }> {
  const mapLayer = layout.slice(layout.indexOf("[LAYER_MAP]"), layout.indexOf("[LAYER_DUNGEON]"));
  const tiles = new Map<string, { x: number; y: number }>();
  [...mapLayer.matchAll(/\{([^{}]+)\}/g)].forEach(([, row], y) => {
    row.split(",").forEach((cell, x) => {
      const section = cell.trim();
      if (section && !tiles.has(section)) tiles.set(section, { x, y });
    });
  });
  return tiles;
}

let flyDataOnce: Promise<FlyData> | undefined;

export function flyData(): Promise<FlyData> {
  flyDataOnce ??= readFlyData();
  return flyDataOnce;
}
