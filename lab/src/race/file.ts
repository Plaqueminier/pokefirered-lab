// The browser imports this file: no Node import here.
import type { EndReason } from "../harness/harness";
import { type Track, TRACK_FIELD, TRACK_POINT } from "../protocol";

export const CELL = 16;
export const TILE = 8;
export const TILE_BYTES = 32;
export const NUM_PRIMARY = 640;

export type RaceBattle = [start: number, end: number, trainer: boolean | null];

export type RaceRun = {
  number: number;
  record: string;
  bot: string;
  model: string;
  /** Frames and cells as the difference with the point before. */
  track: number[];
  /** `trainer` is null for a record before format 1: it does not tell. */
  battles: RaceBattle[];
  trainers: [frame: number, name: string][];
  milestones: [frame: number, milestone: string][];
  end: { frame: number; result: EndReason };
};

export const RACE_VERSION = 1;

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
