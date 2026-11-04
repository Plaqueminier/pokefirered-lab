// Messages between the harness (server.ts) and the Viewer (viewer/viewer.ts).
import type { Areas, Camera, GameState, MapActors, MapGrid, Milestone } from "./game";
import type { Sight } from "./harness/atlas";
import type { InventoryAt } from "./inventory";
import type { Status } from "./party";
import type { EndReason, MacroAction, RawInput } from "./harness/harness";
import type { RunCall } from "./harness/pool";
import type { Continuation, GameEvent, ModelEvent, ModelOptions, ModelSettings, RunEvent, SpendLimit } from "./harness/record";
import type { TrainerNames } from "./save-file";

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

export function badgeNeeded(move: string, badge: number): string {
  return `A Pokémon of your party knows ${move}, but its use on the map needs badge ${badge}`;
}

export const MODEL_PROVIDERS = ["openrouter", "claude-code", "codex", "grok"] as const;

export type ModelProvider = (typeof MODEL_PROVIDERS)[number];

export type PlanProvider = Exclude<ModelProvider, "openrouter">;

export const DEFAULT_PROVIDER: ModelProvider = "openrouter";

export function isPlanProvider(provider: ModelProvider): provider is PlanProvider {
  return provider !== "openrouter";
}

/** The tool of this provider has no reasoning level `off`, so `off` plays as `low`. */
export function hasNoReasoningOff(provider: ModelProvider): boolean {
  return provider === "claude-code" || provider === "grok";
}

/** The model of a model bot when the Run gives none. */
export const DEFAULT_MODEL = "deepseek/deepseek-v4.1-flash";

export const DEFAULT_MODELS: Record<ModelProvider, string> = { openrouter: DEFAULT_MODEL, "claude-code": "claude-haiku-5-5", codex: "gpt-5.6-luna", grok: "grok-4.7" };

export const MILLION = 1_000_000;

export const DEFAULT_TOKEN_LIMIT = tokensFromMillions(1);

/** A person gives a Token limit in millions of tokens; the Harness and the Run record keep tokens. */
export function tokensFromMillions(millions: number): number {
  return Math.round(millions * MILLION);
}

export type SpendUnit = "dollars" | "tokens";

export type Spend = { unit: SpendUnit; amount: number };

export const SPEND_WORDS: Record<SpendUnit, { name: string; limit: string }> = { dollars: { name: "Cost", limit: "Cost limit" }, tokens: { name: "Tokens", limit: "Token limit" } };

function dollars(cost: number): string {
  return `${cost.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 4 })} $`;
}

export function tokens(count: number): string {
  return count.toLocaleString("en-US");
}

export function spendText({ unit, amount }: Spend): string {
  return unit === "tokens" ? `${tokens(Math.round(amount))} tokens` : dollars(amount);
}

export function spentIn(unit: SpendUnit, { promptTokens, completionTokens, cost }: { promptTokens: number; completionTokens: number; cost: number }): number {
  return unit === "tokens" ? promptTokens + completionTokens : cost;
}

export type ProviderStatus = { provider: ModelProvider; problem: string | null };

export const REASONING = ["off", "low", "medium", "high"] as const;

export type ReasoningLevel = (typeof REASONING)[number];

export const DEFAULT_REASONING: ReasoningLevel = "off";

export const DEFAULT_THINKING: ReasoningLevel = "medium";

export const STARTER_SPECIES = ["BULBASAUR", "CHARMANDER", "SQUIRTLE"] as const;

export type StarterSpecies = (typeof STARTER_SPECIES)[number];

/** The first Pokémon that the model bot must choose, or "free": its character chooses. */
export const STARTERS = ["free", ...STARTER_SPECIES] as const;

export const DEFAULT_STARTER: (typeof STARTERS)[number] = "free";

export const GBA_FPS = 16777216 / 280896; // 59.7275

/** The Viewer shows the screen and the state of a Run at most at these rates. */
export const SCREEN_INTERVAL_MS = 1000 / 60;
export const STATE_INTERVAL_MS = 100;

/** 30 screens/s for each Run of a Grid of 9: its cells are small (#72). */
export const SMALL_SCREEN_INTERVAL_MS = 1000 / 30;

/** First byte of a binary message. */
export const BinaryKind = { Screen: 1, Audio: 2 } as const;

export const SCREEN_HEADER = 5;

export const VIEWER_RUN_ID = 0;

export const GRID_SIZES = [2, 4, 9] as const;

export type GridSize = (typeof GRID_SIZES)[number];

export const GRID_SPEEDS = [1, 4, 20] as const;

export type GridSpeed = (typeof GRID_SPEEDS)[number];

export const SPEEDS = [1, 2, 4, 8, 16, "max"] as const;

export type Speed = (typeof SPEEDS)[number];

type BotKind = "scripted" | "model";

/** `name` is the module in `bots/`. */
export type BotInfo = { name: string } & ({ kind: BotKind; version: string; goal: Milestone | null; costLimit: number | null } | { error: string });

export type ModelFacts = Pick<ModelSettings, "id" | "reasoning" | "thinking" | "starter"> & { provider: ModelProvider; limit: Spend };

/** The Run record that a Run starts from. `continued`: a new Run with this parent. `extended`: the same Run, and its end replaces this file. */
export type RunFrom = { record: string; kind: "continued" | "extended" };

export type RecordFacts = { bot: string; version: string; model: (ModelFacts & { stopAtWhiteout: boolean }) | null; continued: boolean };

// A Continued Run finds its start from the end of its parent, so a parent must not grow.
export function extendProblem(facts: RecordFacts | undefined, playing: boolean): string | null {
  if (!facts) return "This file has no header of a Run record.";
  if (facts.continued) return "Another Run record continues this one, and it needs this one as it is.";
  if (playing) return "A Run plays from this Run record now.";
  return null;
}

export type ReplayModel = ModelFacts & { calls: number; spent: Spend; totalCalls: number; totalSpent: Spend };

export type Jump = { from: number; to: number };

export type ReplayStatus = {
  name: string;
  frames: number;
  ended: boolean;
  endReason: EndReason;
  model: ReplayModel | null;
  continued: Continuation | null;
  gameEvents: number | null;
  reached: number;
  seeking: Jump | null;
};

export function replayOf(shown: ShownRun | null): ReplayStatus | null {
  return shown?.kind === "viewer" ? shown.replay : null;
}

export type RunSummary = {
  id: number;
  bot: string;
  names: TrainerNames | null;
  playing: boolean;
  /** A person asked to stop the Run, and it plays to the end of its action. */
  stopAsked: boolean;
  endReason: EndReason | null;
  error: string | null;
  from: RunFrom | null;
  continued: Continuation | null;
  model: (ModelFacts & { spent: Spend; ownSpent: Spend }) | null;
  frame: number;
  milestone: Milestone | null;
  battle: boolean;
  /** The call that the game waits for now. */
  calling: RunCall | null;
  record: string | null;
};

export type GridReplay = {
  id: number;
  cell: number;
  name: string;
  bot: string;
  model: string | null;
  frames: number;
  frame: number;
  milestone: Milestone | null;
  spent: Spend | null;
  battle: boolean;
  endReason: EndReason;
  error: string | null;
  names: TrainerNames | null;
};

export type GridCursor = { frame: number; paused: boolean; speed: GridSpeed; end: number };

export type GridCursorControl = { paused?: boolean; speed?: GridSpeed; frame?: number };

/** The Run that the Viewer shows: its own Run (keyboard or replay), or a Run of a Bot. */
export type ShownRun = { kind: "viewer"; replay: ReplayStatus | null } | { kind: "bot"; run: RunSummary };

export type ServerMessage =
  | { type: "status"; rom: string; speed: Speed; paused: boolean; fps: number; frame: number; hasQuickState: boolean; hasStartSave: boolean; audio: boolean; runs: RunSummary[]; shown: ShownRun; places: { free: number; limit: number }; grid: { cursor: GridCursor; replays: GridReplay[] } }
  | { type: "state"; state: GameState }
  | { type: "inventory"; from: number; entries: readonly InventoryAt[] }
  /** Sent when the map grid changes (new map, or a cell changed). */
  | { type: "map"; grid: MapGrid | null }
  | { type: "actors"; actors: MapActors | null }
  | { type: "sight"; maps: Sight }
  /** All map names, by group then number. Sent once. */
  | { type: "maps"; names: string[][] }
  /** Another map, read from ROM, as asked with "view-map". The player does not move. */
  | { type: "preview"; grid: MapGrid | null; actors: MapActors | null }
  | { type: "floors"; grids: MapGrid[] }
  /** With each screen, while the screen overlay is on. */
  | { type: "camera"; camera: Camera | null }
  | { type: "notice"; text: string }
  | { type: "records"; names: string[]; facts: Record<string, RecordFacts> }
  | { type: "bots"; bots: BotInfo[]; providers: ProviderStatus[] }
  | { type: "areas"; areas: Areas }
  | { type: "replay-events"; name: string; events: GameEvent[] }
  /** All the events of the shown Run up to now. Sent before the screen of the same frames. */
  /** `quiet`: the events after a jump; the Viewer gives no toast for them. */
  | { type: "events"; events: RunEvent[]; quiet?: boolean }
  | { type: "events-added"; from: number; events: RunEvent[] };

export type ClientMessage =
  | { type: "keys"; keys: number }
  | { type: "speed"; speed: Speed }
  | { type: "pause"; paused: boolean }
  | { type: "overlay"; enabled: boolean }
  | { type: "audio"; enabled: boolean }
  /** Audio queued in the Viewer, in milliseconds. */
  | { type: "audio-level"; ms: number }
  | { type: "view-map"; group: number; num: number }
  | { type: "view-floors"; names: string[] }
  | { type: "quick-save" }
  | { type: "quick-load" }
  | { type: "reset" }
  | { type: "write-start-save" }
  | { type: "replay"; name: string }
  | { type: "end-replay" }
  | { type: "seek"; frame: number }
  /** `parent`: continue this Run record of lab/runs/, not a Run from the Starting save. */
  | { type: "start-bot"; name: string; model: ModelOptions; parent?: string; count: number }
  | { type: "extend-run"; record: string; limit: SpendLimit }
  | { type: "stop-run"; runId: number }
  | { type: "show"; runId: number | null }
  /** The server also sends the screens of the shown Run. */
  | { type: "follow"; runIds: number[]; size: GridSize }
  | { type: "grid-add"; name: string; cell: number }
  | { type: "grid-remove"; cell: number }
  | ({ type: "grid-cursor" } & GridCursorControl);

/** The track of a Run record: `TRACK_POINT` numbers at each change of cell, map or facing: the frame, the map group and number, the cell and the facing (0 south, 1 north, 2 west, 3 east). */
export type Track = number[];

export const TRACK_POINT = 6;

export const TRACK_FIELD = { frame: 0, group: 1, num: 2, x: 3, y: 4, facing: 5 } as const;

const RUN_ID_DIGITS = 5;

export function runIdText(number: number): string {
  return String(number).padStart(RUN_ID_DIGITS, "0");
}

export function parseRunId(fileName: string): number | null {
  const id = /^(\d+)-/.exec(fileName)?.[1];
  return id === undefined ? null : Number(id);
}

export type TeamMon = { species: string; nickname: string; level: number; maxHp: number; moves: string[] };

export type MonHealth = { hp: number; status: Status };

export type BattleSide = Omit<TeamMon, "moves"> & MonHealth;

/** `health` follows the order of the last `team`. `trainer`: null in a wild battle. `player` and `foe`: null until the game has loaded them. */
export type StateEntry = { frame: number } & ({ kind: "team"; team: TeamMon[] } | { kind: "health"; health: MonHealth[] } | { kind: "battle"; trainer: string | null; player: BattleSide | null; foe: BattleSide | null });

export function modelEvents(events: readonly RunEvent[]): ModelEvent[] {
  return events.filter((e): e is ModelEvent => e.type === "model");
}
