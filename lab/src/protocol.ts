// Messages between the harness (server.ts) and the Viewer (viewer/viewer.ts).
import type { Camera, GameState, MapActors, MapGrid } from "./game";

/** GBA key bits, as setKeys expects them. */
export const Keys = {
  A: 1 << 0,
  B: 1 << 1,
  Select: 1 << 2,
  Start: 1 << 3,
  Right: 1 << 4,
  Left: 1 << 5,
  Up: 1 << 6,
  Down: 1 << 7,
  R: 1 << 8,
  L: 1 << 9,
} as const;

/** First byte of a binary message. */
export const BinaryKind = { Screen: 1, Audio: 2 } as const;

export type Speed = 1 | 4 | "max";

export type ServerMessage =
  | { type: "status"; rom: string; speed: Speed; paused: boolean; fps: number; frame: number; hasQuickState: boolean; hasStartSave: boolean; audio: boolean }
  | { type: "state"; state: GameState }
  /** Sent when the map grid changes (new map, or a cell changed). */
  | { type: "map"; grid: MapGrid | null }
  | { type: "actors"; actors: MapActors | null }
  /** All map names, by group then number. Sent once. */
  | { type: "maps"; names: string[][] }
  /** Another map, read from ROM, as asked with "view-map". The player does not move. */
  | { type: "preview"; grid: MapGrid | null; actors: MapActors | null }
  /** With each screen, while the screen overlay is on. */
  | { type: "camera"; camera: Camera | null }
  | { type: "notice"; text: string };

export type ClientMessage =
  | { type: "keys"; keys: number }
  | { type: "speed"; speed: Speed }
  | { type: "pause"; paused: boolean }
  | { type: "overlay"; enabled: boolean }
  | { type: "audio"; enabled: boolean }
  /** Audio queued in the Viewer, in milliseconds. */
  | { type: "audio-level"; ms: number }
  | { type: "view-map"; group: number; num: number }
  | { type: "quick-save" }
  | { type: "quick-load" }
  | { type: "reset" }
  | { type: "write-start-save" };
