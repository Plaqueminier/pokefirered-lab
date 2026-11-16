import { join } from "node:path";

export const REPO_DIR = join(import.meta.dir, "..", "..");

export type MapJson = { id: string; name: string; region_map_section: string; map_type: string; object_events?: { graphics_id: string; flag: string }[] };

let mapsOnce: Promise<MapJson[]> | undefined;
let sectionNamesOnce: Promise<ReadonlyMap<string, string>> | undefined;

export function readMapJsons(): Promise<MapJson[]> {
  mapsOnce ??= Array.fromAsync(new Bun.Glob("data/maps/*/map.json").scan(REPO_DIR)).then((paths) => Promise.all(paths.map((path) => Bun.file(join(REPO_DIR, path)).json() as Promise<MapJson>)));
  return mapsOnce;
}

export function readSectionNames(): Promise<ReadonlyMap<string, string>> {
  sectionNamesOnce ??= (Bun.file(join(REPO_DIR, "src/data/region_map/region_map_sections.json")).json() as Promise<{ map_sections: { id: string; name?: string }[] }>).then(
    ({ map_sections }) => new Map(map_sections.flatMap(({ id, name }) => (name ? [[id, normalCase(name)]] : []))),
  );
  return sectionNamesOnce;
}

function normalCase(name: string): string {
  return name.toLowerCase().replace(/(^|[\s.])(\p{L})/gu, (_, before: string, letter: string) => before + letter.toUpperCase());
}
