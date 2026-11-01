import { type Game, type MapGrid, type Milestone, mapTitle } from "../game";
import type { Ref } from "../memory";
import { NUM_PRIMARY, TILE, TILE_BYTES } from "./file";

const CONNECTED_SIDES: Partial<Record<MapGrid["connections"][number]["direction"], true>> = { north: true, south: true, west: true, east: true };
const START_MAP = "PalletTown";
const SAFFRON = "SaffronCity";
const SAFFRON_STAND_IN = "SaffronCity_Connection";

// In world cells: the outdoor maps that only warps reach. `scale` fits an island in the empty space.
const ISLANDS: Record<string, { x: number; y: number; scale: number }> = {
  ViridianForest: { x: 86, y: 102, scale: 0.82 },
  SafariZone_North: { x: 192, y: 214, scale: 0.6 },
  SafariZone_West: { x: 160, y: 244, scale: 0.6 },
  SafariZone_Center: { x: 192, y: 244, scale: 0.6 },
  SafariZone_East: { x: 226, y: 244, scale: 0.6 },
};

const GYMS: [Milestone, string][] = [
  ["badge-1", "PewterCity_Gym"],
  ["badge-2", "CeruleanCity_Gym"],
  ["badge-3", "VermilionCity_Gym"],
  ["badge-4", "CeladonCity_Gym"],
  ["badge-5", "FuchsiaCity_Gym"],
  ["badge-6", "SaffronCity_Gym"],
  ["badge-7", "CinnabarIsland_Gym"],
  ["badge-8", "ViridianCity_Gym"],
];

const MAP_TYPE_TOWN = 1;
const MAP_TYPE_CITY = 2;
const MAP_TYPE_ROUTE = 3;
const MAP_TYPE_UNDERGROUND = 4;

const NUM_SECONDARY = 384;
const METATILE_BYTES = 16;
const PALETTES = 16;
const COLORS = 16;
const LZ77_HEADER = 4;
const PLAYER_FRAMES = 9;
const PLAYER_TILES_WIDE = 2;
const PLAYER_TILES_HIGH = 4;
const BADGE_SHEET_TILES_WIDE = 16;
const BADGE_SHEET_TILES_HIGH = 2;

type MapKind = "town" | "route" | "cave" | "building";

export type Door = { map: string; x: number; y: number };

export type WorldMap = {
  key: string;
  name: string;
  /** The name for a person. */
  title: string;
  kind: MapKind;
  width: number;
  height: number;
  /** Base64: one little-endian u16 per cell, the metatile in bits 0-9. */
  blocks: string;
  primary: number;
  secondary: number;
  warps: { x: number; y: number; to: string }[];
  /** Null for a map on the world, or for an interior that no door of the world reaches. */
  door: Door | null;
};

export type WorldPlace = { map: string; x: number; y: number; scale: number; island: boolean };

export type IslandLink = { island: string } & Door;

type WorldRegion = { name: string; places: WorldPlace[]; links: IslandLink[] };

type WorldTileset = {
  /** Base64: 4 bits per pixel, 32 bytes a tile; the low nibble is the left pixel. */
  tiles: string;
  palettes: number[][];
  metatiles: string;
};

/** Base64: one color index per pixel, row by row. Index 0 is transparent. */
export type WorldSprite = { width: number; height: number; pixels: string; palette: number[] };

export type WorldGym = { milestone: Milestone; door: Door };

export type World = { regions: WorldRegion[]; maps: WorldMap[]; tilesets: WorldTileset[]; player: WorldSprite; badges: WorldSprite; gyms: WorldGym[] };

function base64(bytes: Uint8Array): string {
  return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString("base64");
}

function lz77(source: Uint8Array): Uint8Array {
  const size = source[1] | (source[2] << 8) | (source[3] << 16);
  const out = new Uint8Array(size);
  let from = LZ77_HEADER;
  let to = 0;
  while (to < size) {
    let flags = source[from++];
    for (let bit = 0; bit < 8 && to < size; bit++, flags <<= 1) {
      if (!(flags & 0x80)) {
        out[to++] = source[from++];
        continue;
      }
      const length = (source[from] >> 4) + 3;
      const distance = (((source[from] & 0x0f) << 8) | source[from + 1]) + 1;
      from += 2;
      for (let i = 0; i < length && to < size; i++, to++) out[to] = out[to - distance];
    }
  }
  return out;
}

/** The worst case of LZ77 is one flag byte for each 8 bytes. */
function readCompressed(game: Game, address: number): Uint8Array {
  const { bus } = game.mem;
  const [, a, b, c] = bus.read(address, LZ77_HEADER);
  const size = a | (b << 8) | (c << 16);
  return lz77(bus.read(address, LZ77_HEADER + size + Math.ceil(size / 8)));
}

function colors(game: Game, address: number, count: number): number[] {
  const bytes = game.mem.bus.read(address, count * 2);
  const out: number[] = [];
  for (let i = 0; i < count; i++) {
    const color = bytes[i * 2] | (bytes[i * 2 + 1] << 8);
    for (const shift of [0, 5, 10]) {
      const five = (color >> shift) & 31;
      out.push((five << 3) | (five >> 2));
    }
  }
  return out;
}

function tilesetFrom(game: Game, tileset: Ref, secondary: boolean): WorldTileset {
  const { mem } = game;
  const tiles = tileset.field("tiles").pointer();
  const size = (secondary ? NUM_SECONDARY : NUM_PRIMARY) * TILE_BYTES;
  const palettes = Array.from({ length: PALETTES }, (_, i) => colors(game, tileset.field("palettes").pointer() + i * COLORS * 2, COLORS));
  const metatiles = mem.bus.read(tileset.field("metatiles").pointer(), (secondary ? NUM_SECONDARY : NUM_PRIMARY) * METATILE_BYTES);
  return { tiles: base64(tileset.field("isCompressed").int() ? readCompressed(game, tiles) : mem.bus.read(tiles, size)), palettes, metatiles: base64(metatiles) };
}

function sheet(tiles: Uint8Array, wide: number, high: number, tileAt: (column: number, row: number) => number, palette: number[]): WorldSprite {
  const width = wide * TILE;
  const height = high * TILE;
  const pixels = new Uint8Array(width * height);
  for (let row = 0; row < high; row++)
    for (let column = 0; column < wide; column++) {
      const tile = tileAt(column, row) * TILE_BYTES;
      for (let i = 0; i < TILE * TILE; i++) {
        const byte = tiles[tile + (i >> 1)];
        const at = (row * TILE + (i >> 3)) * width + column * TILE + (i & 7);
        pixels[at] = i & 1 ? byte >> 4 : byte & 0x0f;
      }
    }
  return { width, height, pixels: base64(pixels), palette };
}

function playerSprite(game: Game): WorldSprite {
  const { mem } = game;
  const tiles = mem.bus.read(mem.global("gObjectEventPic_RedNormal").addr, PLAYER_FRAMES * PLAYER_TILES_WIDE * PLAYER_TILES_HIGH * TILE_BYTES);
  const tileAt = (column: number, row: number) => Math.floor(column / PLAYER_TILES_WIDE) * PLAYER_TILES_WIDE * PLAYER_TILES_HIGH + row * PLAYER_TILES_WIDE + (column % PLAYER_TILES_WIDE);
  return sheet(tiles, PLAYER_FRAMES * PLAYER_TILES_WIDE, PLAYER_TILES_HIGH, tileAt, colors(game, mem.global("gObjectEventPal_Player").addr, COLORS));
}

function badgeSprite(game: Game): WorldSprite {
  const { mem } = game;
  const tiles = readCompressed(game, mem.global("sKantoTrainerCardBadges_Gfx").addr);
  const tileAt = (column: number, row: number) => row * BADGE_SHEET_TILES_WIDE + column;
  return sheet(tiles, BADGE_SHEET_TILES_WIDE, BADGE_SHEET_TILES_HIGH, tileAt, colors(game, mem.global("sKantoTrainerCardBadges_Pal").addr, COLORS));
}

function kindOf(type: number): MapKind {
  if (type === MAP_TYPE_TOWN || type === MAP_TYPE_CITY) return "town";
  if (type === MAP_TYPE_ROUTE) return "route";
  return type === MAP_TYPE_UNDERGROUND ? "cave" : "building";
}

type Point = { x: number; y: number };

function found<K, V>(map: ReadonlyMap<K, V>, key: K): V {
  const value = map.get(key);
  if (value === undefined) throw new Error(`the ROM has no map ${String(key)}`);
  return value;
}

function connected(at: Point, side: string, offset: number, map: Pick<MapGrid, "mapWidth" | "mapHeight">, neighbor: Pick<MapGrid, "mapWidth" | "mapHeight">): Point {
  if (side === "north") return { x: at.x + offset, y: at.y - neighbor.mapHeight };
  if (side === "south") return { x: at.x + offset, y: at.y + map.mapHeight };
  if (side === "west") return { x: at.x - neighbor.mapWidth, y: at.y + offset };
  return { x: at.x + map.mapWidth, y: at.y + offset };
}

/** When two connections disagree on an offset, the first one in the search wins. */
function placeOutdoor(grids: Map<string, MapGrid>, start: string): Map<string, Point> {
  const places = new Map<string, Point>([[start, { x: 0, y: 0 }]]);
  const queue = [start];
  for (let key = queue.shift(); key !== undefined; key = queue.shift()) {
    const grid = found(grids, key);
    const at = found(places, key);
    for (const { direction, offset, group, num } of grid.connections) {
      const next = `${group}.${num}`;
      const neighbor = grids.get(next);
      if (!CONNECTED_SIDES[direction] || !neighbor || places.has(next)) continue;
      places.set(next, connected(at, direction, offset, grid, neighbor));
      queue.push(next);
    }
  }
  return places;
}

// The ROM has no connections for the real Saffron City (`connections_no_include`): the routes connect to a stand-in that starts at the same cell.
function placeSaffron(keys: Map<string, string>, places: Map<string, Point>): void {
  const stand = found(keys, SAFFRON_STAND_IN);
  places.set(found(keys, SAFFRON), found(places, stand));
  places.delete(stand);
}

function kantoRegion(grids: Map<string, MapGrid>): WorldRegion {
  const keys = new Map([...grids.values()].map((grid) => [grid.name, grid.key]));
  const connectedPlaces = placeOutdoor(grids, found(keys, START_MAP));
  placeSaffron(keys, connectedPlaces);
  const left = Math.min(...[...connectedPlaces.values()].map(({ x }) => x));
  const top = Math.min(...[...connectedPlaces.values()].map(({ y }) => y));
  const onGrid = [...connectedPlaces].map(([map, { x, y }]): WorldPlace => ({ map, x: x - left, y: y - top, scale: 1, island: false }));
  const saffron = keys.get(SAFFRON);
  // The routes around the real Saffron City draw over it, as in the game.
  onGrid.sort((a, b) => Number(b.map === saffron) - Number(a.map === saffron));
  const islands = Object.entries(ISLANDS).map(([name, place]): WorldPlace => ({ map: found(keys, name), ...place, island: true }));
  return { name: "Kanto", places: [...onGrid, ...islands], links: islandLinks(grids, onGrid, islands) };
}

function islandLinks(grids: Map<string, MapGrid>, onGrid: readonly WorldPlace[], islands: readonly WorldPlace[]): IslandLink[] {
  const placed = new Set([...onGrid, ...islands].map((place) => place.map));
  const links: IslandLink[] = [];
  for (const island of islands) {
    const gates = new Set([...grids.values()].filter((grid) => !placed.has(grid.key) && grid.warps.some((warp) => `${warp.group}.${warp.num}` === island.map)).map((grid) => grid.key));
    for (const { map } of onGrid)
      for (const warp of found(grids, map).warps) if (gates.has(`${warp.group}.${warp.num}`)) links.push({ island: island.map, map, x: warp.x, y: warp.y });
  }
  return links;
}

function interiorDoors(grids: Map<string, MapGrid>, places: readonly WorldPlace[]): Map<string, Door> {
  const placed = new Set(places.map((place) => place.map));
  const doors = new Map<string, Door>();
  const queue: string[] = [];
  const reach = (warpsOf: MapGrid, door: (warp: MapGrid["warps"][number]) => Door) => {
    for (const warp of warpsOf.warps) {
      const to = `${warp.group}.${warp.num}`;
      if (placed.has(to) || doors.has(to) || !grids.has(to)) continue;
      doors.set(to, door(warp));
      queue.push(to);
    }
  };
  for (const { map } of places) reach(found(grids, map), (warp) => ({ map, x: warp.x, y: warp.y }));
  for (let key = queue.shift(); key !== undefined; key = queue.shift()) {
    const door = found(doors, key);
    reach(found(grids, key), () => door);
  }
  return doors;
}

export function buildWorld(game: Game): World {
  const grids = new Map<string, MapGrid>();
  for (const [group, names] of game.allMapNames.entries())
    for (const num of names.keys()) {
      const grid = game.gridOf(group, num);
      if (grid) grids.set(grid.key, grid);
    }
  const kanto = kantoRegion(grids);
  const doors = interiorDoors(grids, kanto.places);
  const placed = new Set(kanto.places.map((place) => place.map));

  const tilesetIndex = new Map<number, number>();
  const tilesets: WorldTileset[] = [];
  const tilesetAt = (pointer: Ref, secondary: boolean): number => {
    const known = tilesetIndex.get(pointer.pointer());
    if (known !== undefined) return known;
    tilesets.push(tilesetFrom(game, pointer.deref(), secondary));
    tilesetIndex.set(pointer.pointer(), tilesets.length - 1);
    return tilesets.length - 1;
  };

  const maps = [...grids.values()].map((grid): WorldMap => {
    const header = game.mapHeader(grid.group, grid.num);
    const layout = header.field("mapLayout").deref();
    return {
      key: grid.key,
      name: grid.name,
      title: mapTitle(grid.name),
      kind: kindOf(header.field("mapType").int()),
      width: grid.mapWidth,
      height: grid.mapHeight,
      blocks: base64(new Uint8Array(Uint16Array.from(grid.blocks).buffer)),
      primary: tilesetAt(layout.field("primaryTileset"), false),
      secondary: tilesetAt(layout.field("secondaryTileset"), true),
      warps: grid.warps.flatMap((warp) => (grids.has(`${warp.group}.${warp.num}`) ? [{ x: warp.x, y: warp.y, to: `${warp.group}.${warp.num}` }] : [])),
      door: placed.has(grid.key) ? null : (doors.get(grid.key) ?? null),
    };
  });

  const gyms = GYMS.map(([milestone, name]): WorldGym => {
    const door = maps.find((map) => map.name === name)?.door;
    if (!door) throw new Error(`the gym ${name} has no door`);
    return { milestone, door };
  });
  return { regions: [kanto], maps, tilesets, player: playerSprite(game), badges: badgeSprite(game), gyms };
}
