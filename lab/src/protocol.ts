// Messages between the harness (server.ts) and the Viewer (viewer/viewer.ts).
import type { Areas, Camera, GameState, MapActors, MapGrid, Milestone } from "./game";
import type { Sight } from "./harness/atlas";
import type { EndReason, MacroAction, RawInput } from "./harness/harness";
import type { Continuation, ModelOptions, ModelSettings, RunEvent } from "./harness/record";

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

/** An action as one line, for example `goTo(6, 1)`. */
export function actionText({ name, ...args }: MacroAction | RawInput): string {
  return `${name}(${Object.values(args).join(", ")})`;
}

/** What removes a fixed obstacle of the map, for the model, the reasons of the Harness and the Viewer. */
export function obstacleRemedy(move: string): string {
  return `Only a Pokémon that knows ${move} can remove it`;
}

/** The model of a model bot when the Run gives none. */
export const DEFAULT_MODEL = "deepseek/deepseek-v4-flash";

export const REASONING = ["off", "low", "medium", "high"] as const;

export const DEFAULT_REASONING: (typeof REASONING)[number] = "low";

/** The first Pokémon that the model bot must choose, or "free": it chooses. */
export const STARTERS = ["free", "BULBASAUR", "CHARMANDER", "SQUIRTLE"] as const;

export const DEFAULT_STARTER: (typeof STARTERS)[number] = "free";

export const GBA_FPS = 16777216 / 280896; // 59.7275

/** The Viewer shows the screen and the state of a Run at most at these rates. */
export const SCREEN_INTERVAL_MS = 1000 / 60;
export const STATE_INTERVAL_MS = 100;

/** First byte of a binary message. */
export const BinaryKind = { Screen: 1, Audio: 2 } as const;

export type Speed = 1 | 4 | "max";

type BotKind = "scripted" | "model";

/** `name` is the module in `bots/`. */
export type BotInfo = { name: string } & ({ kind: BotKind; version: string; goal: Milestone | null } | { error: string });

/** The Model calls of a replay: `calls` and `cost` up to the frame of the replay, the totals for the whole record. */
export type ReplayModel = Pick<ModelSettings, "id" | "costLimit" | "reasoning" | "starter"> & { calls: number; cost: number; totalCalls: number; totalCost: number };

export type ReplayStatus = { name: string; frames: number; ended: boolean; endReason: EndReason; model: ReplayModel | null; continued: Continuation | null };

export type RunSummary = {
  id: number;
  bot: string;
  playing: boolean;
  /** A person asked to stop the Run, and it plays to the next decision of its Bot. */
  stopAsked: boolean;
  endReason: EndReason | null;
  error: string | null;
  /** The Run record that the Run continues. */
  parent: string | null;
  continued: Continuation | null;
  /** A Model call runs while `callsStarted` is more than the model events of the Run. */
  model: (Pick<ModelSettings, "id" | "costLimit" | "reasoning" | "starter"> & { cost: number; callsStarted: number }) | null;
};

/** The Run that the Viewer shows: its own Run (keyboard or replay), or a Run of a Bot. */
export type ShownRun = { kind: "viewer"; replay: ReplayStatus | null } | { kind: "bot"; run: RunSummary };

export type ServerMessage =
  | { type: "status"; rom: string; speed: Speed; paused: boolean; fps: number; frame: number; hasQuickState: boolean; hasStartSave: boolean; audio: boolean; runs: RunSummary[]; shown: ShownRun }
  | { type: "state"; state: GameState }
  /** Sent when the map grid changes (new map, or a cell changed). */
  | { type: "map"; grid: MapGrid | null }
  | { type: "actors"; actors: MapActors | null }
  | { type: "sight"; maps: Sight }
  /** All map names, by group then number. Sent once. */
  | { type: "maps"; names: string[][] }
  /** Another map, read from ROM, as asked with "view-map". The player does not move. */
  | { type: "preview"; grid: MapGrid | null; actors: MapActors | null }
  /** With each screen, while the screen overlay is on. */
  | { type: "camera"; camera: Camera | null }
  | { type: "notice"; text: string }
  | { type: "records"; names: string[] }
  | { type: "bots"; bots: BotInfo[] }
  | { type: "areas"; areas: Areas }
  /** All the events of the shown Run up to now. Sent before the screen of the same frames. */
  | { type: "events"; events: RunEvent[] };

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
  | { type: "write-start-save" }
  | { type: "replay"; name: string }
  | { type: "end-replay" }
  /** `parent`: continue this Run record of lab/runs/, not a Run from the Starting save. */
  | { type: "start-bot"; name: string; model: ModelOptions; parent?: string }
  | { type: "stop-run"; runId: number }
  | { type: "show"; runId: number | null };
