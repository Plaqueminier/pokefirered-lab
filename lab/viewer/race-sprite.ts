export const FRAME_WIDTH = 16;
const FRAMES = 9;
const STAND_FRAMES = 3;
const HEAD_ROWS = 23;
export const SHEET_WIDTH = FRAME_WIDTH * FRAMES;
export const SHEET_HEIGHT = 32;

export type GhostPart = { name: string; layout: "people" | "player"; indices: Uint8Array; palette: readonly number[] };

export type GhostSheet = { head: string; body: string; rgba: Uint8ClampedArray };

type Rgb = [number, number, number];

const SKIN = "skin";

type Role = typeof SKIN | { ramp: number; level: number } | null;

const ramp = (index: number, level: number): Role => ({ ramp: index, level });

// From the palettes of the game. Null: black or white, which stay. In a ramp, level 0 is the light colour and 2 the dark one.
const ROLES: Record<GhostPart["layout"], Role[]> = {
  people: [null, SKIN, SKIN, SKIN, SKIN, ramp(0, 0), ramp(0, 1), ramp(0, 2), ramp(1, 0), ramp(1, 1), ramp(1, 2), ramp(2, 0), ramp(2, 1), ramp(2, 2), null, null],
  player: [null, ramp(2, 1), SKIN, SKIN, SKIN, ramp(0, 1), ramp(0, 2), ramp(0, 0), ramp(1, 2), null, null, ramp(1, 0), ramp(1, 1), ramp(2, 0), ramp(2, 1), null],
};

// One weight for each family: on the hue circle, greens fill much more than reds.
const FAMILIES: [from: number, to: number][] = [[352, 368], [18, 34], [46, 56], [100, 140], [165, 190], [205, 235], [262, 285], [310, 340]];
const FAMILY_HARMONIES = [0, 1, -1, 4, 3, -3];

type Mood = { name: string; weight: number; s: [number, number]; l: [number, number] };

const MOODS: Mood[] = [
  { name: "vivid", weight: 3, s: [0.7, 0.95], l: [0.45, 0.6] },
  { name: "pastel", weight: 2, s: [0.45, 0.8], l: [0.72, 0.84] },
  { name: "dark", weight: 2, s: [0.25, 0.6], l: [0.2, 0.33] },
  { name: "earth", weight: 2, s: [0.2, 0.45], l: [0.34, 0.55] },
  { name: "mono", weight: 1, s: [0, 0.06], l: [0.15, 0.88] },
];
const MOOD_WEIGHTS = MOODS.reduce((sum, mood) => sum + mood.weight, 0);

const SKIN_TONES = [
  { h: 26, s: 0.85, l: 0.84 },
  { h: 26, s: 0.9, l: 0.76 },
  { h: 26, s: 0.6, l: 0.62 },
  { h: 22, s: 0.42, l: 0.46 },
  { h: 18, s: 0.34, l: 0.33 },
];
const SOURCE_SKIN_LIGHT = 0.78;
const SKIN_LIGHT_KEPT = 0.9;
const RAMPS = 6;
const RAMPS_OF_A_PART = 3;

function fnv1a(text: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function mulberry32(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hsl(h: number, s: number, l: number): Rgb {
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    return Math.round(255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))));
  };
  return [f(0), f(8), f(4)];
}

function lightOf(r: number, g: number, b: number): number {
  return (Math.max(r, g, b) + Math.min(r, g, b)) / 2 / 255;
}

function moodOf(next: () => number): Mood {
  let left = next() * MOOD_WEIGHTS;
  for (const mood of MOODS) {
    left -= mood.weight;
    if (left < 0) return mood;
  }
  return MOODS[0];
}

function rampColors(next: () => number, baseFamily: number, outfit: Mood): [Rgb, Rgb, Rgb] {
  const between = ([from, to]: [number, number]) => from + next() * (to - from);
  const harmony = FAMILY_HARMONIES[Math.floor(next() * FAMILY_HARMONIES.length)];
  const hue = between(FAMILIES[(baseFamily + harmony + FAMILIES.length) % FAMILIES.length]) % 360;
  const mood = next() < 0.5 ? outfit : moodOf(next);
  let l = between(mood.l);
  // A bright green hides on the grass of the map.
  if (hue > 85 && hue < 165 && l > 0.42 && mood.name !== "mono") l = 0.3;
  const s = between(mood.s);
  return [hsl((hue + 10) % 360, s * 0.9, Math.min(0.93, l + 0.2)), hsl(hue, s, l), hsl((hue + 346) % 360, Math.min(1, s * 1.05), l * 0.5)];
}

function skinColor(tone: (typeof SKIN_TONES)[number], light: number): Rgb {
  return hsl(tone.h, tone.s, Math.max(0.1, Math.min(0.92, tone.l + (light - SOURCE_SKIN_LIGHT) * SKIN_LIGHT_KEPT)));
}

function partColors(part: GhostPart, ramps: readonly Rgb[][], tone: (typeof SKIN_TONES)[number]): ([...Rgb, number] | null)[] {
  return ROLES[part.layout].map((role, index) => {
    if (index === 0) return null;
    const [r, g, b] = part.palette.slice(index * 3, index * 3 + 3);
    if (role === null) return [r, g, b, 255];
    return [...(role === SKIN ? skinColor(tone, lightOf(r, g, b)) : ramps[role.ramp][role.level]), 255];
  });
}

/** The order of the draws decides the faces: a new draw goes after the old ones. `id` has 5 digits, `people` the order of GHOST_PEOPLE. */
export function ghostSheet(id: string, people: readonly GhostPart[]): GhostSheet {
  const next = mulberry32(fnv1a(id));
  const pick = <T,>(list: readonly T[]): T => list[Math.floor(next() * list.length)];
  const head = pick(people);
  const body = pick(people);
  const baseFamily = Math.floor(next() * FAMILIES.length);
  const outfit = moodOf(next);
  const ramps = Array.from({ length: RAMPS }, () => rampColors(next, baseFamily, outfit));
  const tone = pick(SKIN_TONES);

  const headColors = partColors(head, ramps.slice(0, RAMPS_OF_A_PART), tone);
  const bodyColors = partColors(body, ramps.slice(RAMPS_OF_A_PART), tone);

  const rgba = new Uint8ClampedArray(SHEET_WIDTH * SHEET_HEIGHT * 4);
  for (let frame = 0; frame < FRAMES; frame++) {
    const cut = HEAD_ROWS + (frame < STAND_FRAMES ? 0 : 1);
    for (let y = 0; y < SHEET_HEIGHT; y++) {
      const { indices } = y < cut ? head : body;
      const colors = y < cut ? headColors : bodyColors;
      for (let x = frame * FRAME_WIDTH; x < (frame + 1) * FRAME_WIDTH; x++) {
        const color = colors[indices[y * SHEET_WIDTH + x]];
        if (color) rgba.set(color, (y * SHEET_WIDTH + x) * 4);
      }
    }
  }
  return { head: head.name, body: body.name, rgba };
}

