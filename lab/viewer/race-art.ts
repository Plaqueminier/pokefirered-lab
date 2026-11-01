import { runIdText } from "../src/protocol";
import { CELL, NUM_PRIMARY, TILE, TILE_BYTES } from "../src/race/file";
import type { World, WorldIcon, WorldMap, WorldSprite } from "../src/race/world";
import { FRAME_WIDTH, type GhostPart, ghostSheet, SHEET_HEIGHT, SHEET_WIDTH } from "./race-sprite";

const NUM_PRIMARY_PALETTES = 7;
const METATILE_ENTRIES = 8;
const LAYERS = 2;
const LAYER_ENTRIES = 4;
const FACE_TOP = 8;

function decoded(base64: string): Uint8Array {
  return Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
}

function context(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("no 2d canvas");
  return ctx;
}

/** Sizes a canvas for the screen: its drawings are in CSS pixels. Null while it is hidden. */
export function fitCanvas(canvas: HTMLCanvasElement): { ctx: CanvasRenderingContext2D; width: number; height: number } | null {
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  if (width === 0) return null;
  const dpr = window.devicePixelRatio || 1;
  if (canvas.width !== Math.round(width * dpr)) canvas.width = Math.round(width * dpr);
  if (canvas.height !== Math.round(height * dpr)) canvas.height = Math.round(height * dpr);
  const ctx = context(canvas);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { ctx, width, height };
}

function newCanvas(width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

function spriteCanvas({ width, height, pixels, palette }: WorldSprite): HTMLCanvasElement {
  const indices = decoded(pixels);
  const canvas = newCanvas(width, height);
  const ctx = context(canvas);
  const image = ctx.createImageData(width, height);
  indices.forEach((index, i) => {
    if (index === 0) return;
    image.data.set([palette[index * 3], palette[index * 3 + 1], palette[index * 3 + 2], 255], i * 4);
  });
  ctx.putImageData(image, 0, 0);
  return canvas;
}

function cached<K, V>(known: Map<K, V>, key: K, make: () => V): V {
  const value = known.get(key);
  if (value !== undefined) return value;
  const made = make();
  known.set(key, made);
  return made;
}

type Tileset = { tiles: Uint8Array; palettes: number[][]; metatiles: Uint16Array };

export class RaceArt {
  readonly badges: HTMLCanvasElement;
  readonly maps: ReadonlyMap<string, WorldMap>;
  readonly #tilesets: Tileset[];
  readonly #painted = new Map<string, HTMLCanvasElement>();
  readonly #people: GhostPart[];
  readonly #sheets = new Map<number, HTMLCanvasElement>();
  readonly #faces = new Map<number, string>();
  readonly #icons: Map<string, WorldIcon>;
  readonly #iconUrls = new Map<string, string | null>();

  constructor(world: World) {
    this.#people = world.people.map(({ name, layout, pixels, palette }) => ({ name, layout, palette, indices: decoded(pixels) }));
    this.#icons = new Map(world.icons.map((icon) => [icon.species, icon]));
    this.badges = spriteCanvas(world.badges);
    this.maps = new Map(world.maps.map((map) => [map.key, map]));
    this.#tilesets = world.tilesets.map(({ tiles, palettes, metatiles }) => ({ tiles: decoded(tiles), palettes, metatiles: new Uint16Array(decoded(metatiles).buffer) }));
  }

  ghost(number: number): HTMLCanvasElement {
    return cached(this.#sheets, number, () => {
      const canvas = newCanvas(SHEET_WIDTH, SHEET_HEIGHT);
      const ctx = context(canvas);
      const image = ctx.createImageData(SHEET_WIDTH, SHEET_HEIGHT);
      image.data.set(ghostSheet(runIdText(number), this.#people).rgba);
      ctx.putImageData(image, 0, 0);
      return canvas;
    });
  }

  faceUrl(number: number): string {
    return cached(this.#faces, number, () => {
      const canvas = newCanvas(FRAME_WIDTH, SHEET_HEIGHT - FACE_TOP);
      context(canvas).drawImage(this.ghost(number), 0, FACE_TOP, FRAME_WIDTH, canvas.height, 0, 0, FRAME_WIDTH, canvas.height);
      return canvas.toDataURL();
    });
  }

  iconUrl(species: string): string | null {
    return cached(this.#iconUrls, species, () => {
      const icon = this.#icons.get(species);
      return icon ? spriteCanvas(icon).toDataURL() : null;
    });
  }

  paint(key: string): HTMLCanvasElement {
    return cached(this.#painted, key, () => {
      const map = this.maps.get(key);
      if (!map) throw new Error(`no map ${key} in the world`);
      const canvas = newCanvas(map.width * CELL, map.height * CELL);
      const ctx = context(canvas);
      const image = ctx.createImageData(canvas.width, canvas.height);
      const blocks = new Uint16Array(decoded(map.blocks).buffer);
      const primary = this.#tilesets[map.primary];
      const secondary = this.#tilesets[map.secondary];
      blocks.forEach((block, cell) => this.#drawMetatile(image, block & 0x3ff, ((cell % map.width) * CELL), Math.floor(cell / map.width) * CELL, primary, secondary));
      ctx.putImageData(image, 0, 0);
      return canvas;
    });
  }

  #drawMetatile(image: ImageData, metatile: number, left: number, top: number, primary: Tileset, secondary: Tileset): void {
    const set = metatile < NUM_PRIMARY ? primary : secondary;
    const base = (metatile < NUM_PRIMARY ? metatile : metatile - NUM_PRIMARY) * METATILE_ENTRIES;
    for (let layer = 0; layer < LAYERS; layer++)
      for (let corner = 0; corner < LAYER_ENTRIES; corner++) {
        const entry = set.metatiles[base + layer * LAYER_ENTRIES + corner];
        if (entry !== undefined) this.#drawTile(image, entry, left + (corner & 1) * TILE, top + (corner >> 1) * TILE, layer === 0, primary, secondary);
      }
  }

  // As on the GBA: index 0 shows the backdrop color on the bottom layer, and the bottom layer on the top layer.
  #drawTile(image: ImageData, entry: number, left: number, top: number, bottom: boolean, primary: Tileset, secondary: Tileset): void {
    const tile = entry & 0x3ff;
    const flipX = (entry >> 10) & 1;
    const flipY = (entry >> 11) & 1;
    const paletteId = entry >> 12;
    const tiles = (tile < NUM_PRIMARY ? primary : secondary).tiles;
    const offset = (tile < NUM_PRIMARY ? tile : tile - NUM_PRIMARY) * TILE_BYTES;
    const palette = (paletteId < NUM_PRIMARY_PALETTES ? primary : secondary).palettes[paletteId];
    const backdrop = primary.palettes[0];
    if (!palette) return;
    for (let y = 0; y < TILE; y++)
      for (let x = 0; x < TILE; x++) {
        const at = (flipY ? TILE - 1 - y : y) * TILE + (flipX ? TILE - 1 - x : x);
        const byte = tiles[offset + (at >> 1)] ?? 0;
        const index = at & 1 ? byte >> 4 : byte & 0x0f;
        if (index === 0 && !bottom) continue;
        const colors = index === 0 ? backdrop : palette;
        const pixel = ((top + y) * image.width + left + x) * 4;
        image.data[pixel] = colors[index * 3];
        image.data[pixel + 1] = colors[index * 3 + 1];
        image.data[pixel + 2] = colors[index * 3 + 2];
        image.data[pixel + 3] = 255;
      }
  }
}
