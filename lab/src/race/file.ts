// The browser imports this file: no Node import here.
import type { EndReason } from "../harness/harness";
import { type StateEntry, type Track, TRACK_FIELD, TRACK_POINT } from "../protocol";

export const CELL = 16;
export const TILE = 8;
export const TILE_BYTES = 32;
export const NUM_PRIMARY = 640;

export type RaceBattle = [start: number, end: number];

export type RaceRun = {
  number: number;
  record: string;
  bot: string;
  model: string;
  coach?: string;
  character: string;
  /** Frames and cells as the difference with the point before. */
  track: number[];
  battles: RaceBattle[];
  trainers: [frame: number, name: string][];
  milestones: [frame: number, milestone: string][];
  end: { frame: number; result: EndReason };
  state: StateEntry[];
  unit?: "tokens";
  cost: [frame: number, cost: number, calls: number][];
  faints: number[];
  money: [frame: number, money: number][];
};

export const RACE_VERSION = 3;

export const GENETIC_BOT = "genetic";

type ModelFamily = "deepseek" | "claude" | "gpt" | "grok";

export type Dot = ModelFamily | "genetic";

export function shortModelId(id: string): string {
  return id.slice(id.lastIndexOf("/") + 1);
}

export function modelFamily(id: string): ModelFamily | null {
  const short = shortModelId(id);
  if (short.startsWith("deepseek")) return "deepseek";
  if (short.startsWith("gpt-")) return "gpt";
  if (short.startsWith("grok-")) return "grok";
  return short.startsWith("claude") ? "claude" : null;
}

/** `bot` of a Ghost is "<name> <version>". */
export function isGeneticRun({ bot }: Pick<RaceRun, "bot">): boolean {
  return bot.startsWith(`${GENETIC_BOT} `);
}

export function botVersion(bot: string): string {
  return bot.slice(bot.indexOf(" ") + 1);
}

export function dotOf(run: Pick<RaceRun, "bot" | "model">): Dot | null {
  return isGeneticRun(run) ? "genetic" : modelFamily(run.model);
}

export type RaceFile = { version: typeof RACE_VERSION; runs: RaceRun[] };

const DELTA_FIELDS = [TRACK_FIELD.frame, TRACK_FIELD.x, TRACK_FIELD.y];

export function encodeTrack(track: Track): number[] {
  const deltas = [...track];
  for (let i = track.length - TRACK_POINT; i > 0; i -= TRACK_POINT) for (const field of DELTA_FIELDS) deltas[i + field] -= track[i + field - TRACK_POINT];
  return deltas;
}

export function decodeTrack(deltas: readonly number[]): Int32Array {
  const track = Int32Array.from(deltas);
  for (let i = TRACK_POINT; i < track.length; i += TRACK_POINT) for (const field of DELTA_FIELDS) track[i + field] += track[i + field - TRACK_POINT];
  return track;
}
