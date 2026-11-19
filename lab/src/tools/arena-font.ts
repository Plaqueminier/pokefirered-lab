import { join } from "node:path";
import { REPO_DIR } from "../map-data";
import { encodeBitPng } from "./png";

export const FONT_TEXT = join(REPO_DIR, "graphics", "arena", "font_small.txt");
export const FONT_PNG = join(REPO_DIR, "graphics", "arena", "font_small.png");
export const GFX_SOURCE = join(REPO_DIR, "src", "arena", "arena_gfx.c");

const CELL_WIDTH = 8;
const CELL_HEIGHT = 16;
const DRAWN_ROWS = 13;
const CELLS_ACROSS = 16;
const CODES = 256;
const WIDTHS_TABLE = /(static const u8 sFontSmallWidths\[256\] =\n\{\n)[^}]*(\};)/;

type Glyph = { rows: number[]; width: number };

export type Font = { glyphs: (Glyph | undefined)[] };

function inkWidth(rows: readonly number[]): number {
  return Math.max(0, ...rows.map((bits) => 32 - Math.clz32(bits)));
}

function codeOf(key: string): number | null {
  return /^[0-9A-F]{2}$/.test(key) ? Number.parseInt(key, 16) : null;
}

type Line = { number: number; text: string };
type Entry = { header: Line; art: Line[] };

const ART = /^[#.]+$/;
const ACCENTED = /^(\S+) \S+ = (\S+) \+ (\S+) (\d+)$/;
const DRAWN = /^(\S+) \S+ (\d+)(?: (\d+))?$/;

function entries(text: string): Entry[] {
  const out: Entry[] = [];
  let open: Entry | null = null;
  text.split("\n").forEach((raw, i) => {
    const line = { number: i + 1, text: raw.trimEnd() };
    if (open && ART.test(line.text)) open.art.push(line);
    else if (line.text === "" || line.text.startsWith("//")) open = null;
    else out.push((open = { header: line, art: [] }));
  });
  return out;
}

function drawnGlyph({ header, art }: Entry): [string, Glyph] {
  const match = header.text.match(DRAWN);
  if (!match) throw new Error(`line ${header.number}: "${header.text}" is not a glyph header`);
  const [, key, first, width] = match;
  const rows = new Array<number>(CELL_HEIGHT).fill(0);
  art.forEach((line, r) => {
    if (line.text.length > CELL_WIDTH) throw new Error(`line ${line.number}: a glyph is ${CELL_WIDTH} pixels wide at most`);
    if (Number(first) + r >= DRAWN_ROWS) throw new Error(`line ${line.number}: a glyph has ${DRAWN_ROWS} rows at most`);
    rows[Number(first) + r] = [...line.text].reduce((bits, pixel, x) => (pixel === "#" ? bits | (1 << x) : bits), 0);
  });
  return [key, { rows, width: width === undefined ? inkWidth(rows) + 1 : Number(width) }];
}

function accentedGlyph({ header, art }: Entry, match: RegExpMatchArray, byKey: ReadonlyMap<string, Glyph>): [string, Glyph] {
  const [, key, baseKey, accentKey, at] = match;
  const base = byKey.get(baseKey);
  const accent = byKey.get(accentKey);
  if (art.length > 0) throw new Error(`line ${art[0].number}: an accented glyph has no rows of its own`);
  if (!base || !accent) throw new Error(`line ${header.number}: draw ${baseKey} and ${accentKey} before "${header.text}"`);
  const shift = Math.floor((inkWidth(base.rows) - inkWidth(accent.rows)) / 2);
  if (shift < 0) throw new Error(`line ${header.number}: ${accentKey} is wider than ${baseKey}`);
  const rows = [...base.rows];
  accent.rows.forEach((bits, r) => {
    if (bits === 0) return;
    if (Number(at) + r >= DRAWN_ROWS) throw new Error(`line ${header.number}: the accent goes below row ${DRAWN_ROWS - 1}`);
    rows[Number(at) + r] |= bits << shift;
  });
  return [key, { rows, width: base.width }];
}

export function parseFont(text: string): Font {
  const byKey = new Map<string, Glyph>();
  const lineOf = new Map<string, number>();
  const used = new Set<string>();
  for (const entry of entries(text)) {
    const accented = entry.header.text.match(ACCENTED);
    const [key, glyph] = accented ? accentedGlyph(entry, accented, byKey) : drawnGlyph(entry);
    if (lineOf.has(key)) throw new Error(`line ${entry.header.number}: ${key} is already drawn at line ${lineOf.get(key)}`);
    if (accented) for (const part of accented.slice(2, 4)) used.add(part);
    lineOf.set(key, entry.header.number);
    byKey.set(key, glyph);
  }
  for (const [key, line] of lineOf)
    if (codeOf(key) === null && !used.has(key)) throw new Error(`line ${line}: ${key} is not a code, and no accented glyph uses it`);
  const glyphs = new Array<Glyph | undefined>(CODES).fill(undefined);
  for (const [key, glyph] of byKey) {
    const code = codeOf(key);
    if (code !== null) glyphs[code] = glyph;
  }
  return { glyphs };
}

export function fontPng({ glyphs }: Font): Uint8Array {
  const width = CELLS_ACROSS * CELL_WIDTH;
  const height = (CODES / CELLS_ACROSS) * CELL_HEIGHT;
  const bits = new Uint8Array(width * height);
  glyphs.forEach((glyph, code) => {
    const left = (code % CELLS_ACROSS) * CELL_WIDTH;
    const top = Math.floor(code / CELLS_ACROSS) * CELL_HEIGHT;
    glyph?.rows.forEach((mask, y) => {
      for (let x = 0; x < CELL_WIDTH; x++) if (mask & (1 << x)) bits[(top + y) * width + left + x] = 1;
    });
  });
  return encodeBitPng(width, height, bits);
}

export function withWidths(source: string, { glyphs }: Font): string {
  if (!WIDTHS_TABLE.test(source)) throw new Error("no sFontSmallWidths table in arena_gfx.c");
  const widths = glyphs.map((glyph) => glyph?.width ?? 0);
  const lines = Array.from({ length: CODES / CELLS_ACROSS }, (_, r) => `    ${widths.slice(r * CELLS_ACROSS, (r + 1) * CELLS_ACROSS).map((w) => `${String(w).padStart(2)},`).join(" ")}\n`);
  return source.replace(WIDTHS_TABLE, `$1${lines.join("")}$2`);
}

async function main(): Promise<void> {
  const font = parseFont(await Bun.file(FONT_TEXT).text());
  await Bun.write(FONT_PNG, fontPng(font));
  await Bun.write(GFX_SOURCE, withWidths(await Bun.file(GFX_SOURCE).text(), font));
  console.log(`${font.glyphs.filter(Boolean).length} glyphs: wrote ${FONT_PNG} and the widths in ${GFX_SOURCE}`);
}

if (import.meta.main)
  await main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
