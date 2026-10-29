// The buttons alone replay a Run: the game reads no input while it is frozen (docs/adr/0002).
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import type { Game, Milestone } from "../game";
import type { REASONING, STARTERS } from "../protocol";
import { Run, type RunOrigin } from "../run";
import type { ActionEntry, Bot, KnowledgeLevel, ParentRecord, RunResult } from "./harness";

export const RUNS_DIR = join(import.meta.dir, "..", "..", "runs");

export type ButtonHold = [keys: number, frames: number];

export type GameEvent = { frame: number } & (
  | { type: "map"; map: string }
  | { type: "battle"; state: "start" | "end" }
  | { type: "milestone"; milestone: Milestone }
);

type Reasoning = (typeof REASONING)[number];

type Starter = (typeof STARTERS)[number];

// The reasoning "off" sends the effort "none", which a model that always reasons does not have: give it another level.
export type ModelSettings = { id: string; costLimit: number; reasoning: Reasoning; temperature: number | null; starter: Starter; stopAtWhiteout: boolean };

/** The options of a model bot as a person gives them (the command line, the Viewer): a missing option takes its default. */
export type ModelOptions = { id?: string; costLimit?: number; reasoning?: string; temperature?: number | null; starter?: string; stopAtWhiteout?: boolean };

export type Prompt = { system: string; user: string; turns?: Turn[] };

export type Turn = { assistant: string; user: string };

export type Usage = { promptTokens: number; cachedTokens?: number; completionTokens: number; reasoningTokens: number; cost: number };

export type Decision = { reason: string; action: string; mission: string; objective: string; note: string };

export type ModelAnswer = { model: string; situation: string; prompt: Prompt; answer: string | null; usage: Usage; stuck?: number; reflection?: boolean; review?: boolean } & (
  | { decision: Decision; error: null }
  | { decision: null; error: string }
);

export type ModelEvent = { type: "model"; frame: number; latencyMs: number } & ModelAnswer;

export type NodeRange = { from: number; to: number };

export type SummaryAnswer = { model: string; prompt: Prompt; answer: string | null; usage: Usage } & NodeRange & ({ summary: string; error: null } | { summary: null; error: string });

export type SummaryEvent = { type: "summary"; frame: number; latencyMs: number } & SummaryAnswer;

export type ActionEvent = { type: "action"; frame: number } & ActionEntry;

export type RunEvent = GameEvent | ActionEvent | ModelEvent | SummaryEvent;

export type ModelTotals = { calls: number } & Usage;

export function modelEvents(events: readonly RunEvent[]): ModelEvent[] {
  return events.filter((e): e is ModelEvent => e.type === "model");
}

export type CallTurn = { call: ModelEvent | null; events: Exclude<RunEvent, ModelEvent>[] };

/** The events after each Model call, up to the next one. The first turn has no call when the events do not start with one. */
export function callTurns(events: readonly RunEvent[]): CallTurn[] {
  const turns: CallTurn[] = [];
  for (const event of events) {
    if (event.type === "model") turns.push({ call: event, events: [] });
    else if (turns.length === 0) turns.push({ call: null, events: [event] });
    else turns[turns.length - 1].events.push(event);
  }
  return turns;
}

export function modelTotals(events: readonly RunEvent[]): ModelTotals {
  const totals: ModelTotals = { calls: 0, promptTokens: 0, completionTokens: 0, reasoningTokens: 0, cost: 0 };
  for (const event of events) {
    if (event.type !== "model" && event.type !== "summary") continue;
    if (event.type === "model") totals.calls++;
    for (const key of ["promptTokens", "completionTokens", "reasoningTokens", "cost"] as const) totals[key] += event.usage[key];
  }
  return totals;
}

/** `parent`: the file in lab/runs/ of the Run record that this Run continues. */
export type RunHeader = RunOrigin & { knowledge: KnowledgeLevel; bot: Pick<Bot, "name" | "version" | "model">; parent?: string };

export type RunRecord = { header: RunHeader; buttons: ButtonHold[]; events: RunEvent[]; result: RunResult };

export class ButtonTrack {
  readonly holds: ButtonHold[] = [];

  push(keys: number): void {
    const last = this.holds.at(-1);
    if (last?.[0] === keys) last[1]++;
    else this.holds.push([keys, 1]);
  }
}

export class GameWatch {
  #map: string | null = null;
  #battle = false;
  #milestones = new Set<Milestone>();
  #maps = new Set<string>();
  #levels = 0;
  #flags = 0;

  constructor(private readonly game: Game) {}

  get gameProgress(): number {
    this.#levels = Math.max(this.#levels, this.game.party().reduce((sum, mon) => sum + mon.level, 0));
    this.#flags = Math.max(this.#flags, this.game.flagProgress());
    return this.#maps.size + this.#milestones.size + this.#levels + this.#flags;
  }

  onFrame(frame: number): GameEvent[] {
    const events: GameEvent[] = [];
    const battle = this.game.battleUnderway();
    if (battle !== this.#battle) events.push({ frame, type: "battle", state: battle ? "start" : "end" });
    this.#battle = battle;
    const mode = this.game.mode();
    if (mode === "other") return events;
    const map = this.game.map().name;
    if (map !== this.#map) events.push({ frame, type: "map", map });
    this.#maps.add(map);
    this.#map = map;
    for (const milestone of this.game.milestones()) {
      if (this.#milestones.has(milestone)) continue;
      this.#milestones.add(milestone);
      events.push({ frame, type: "milestone", milestone });
    }
    return events;
  }
}

export class RecordPlayer {
  readonly frames: number;
  #frame = 0;
  #hold = 0;
  #inHold = 0;
  #event = 0;
  readonly #record: RunRecord;

  constructor(record: RunRecord) {
    this.#record = record;
    this.frames = record.buttons.reduce((frames, [, count]) => frames + count, 0);
  }

  get frame(): number {
    return this.#frame;
  }

  get ended(): boolean {
    return this.#frame >= this.frames;
  }

  next(): number {
    if (this.ended) throw new Error("the Run record has no more frames");
    const [keys, count] = this.#record.buttons[this.#hold];
    if (++this.#inHold === count) {
      this.#hold++;
      this.#inHold = 0;
    }
    this.#frame++;
    return keys;
  }

  get result(): RunResult {
    return this.#record.result;
  }

  get header(): RunHeader {
    return this.#record.header;
  }

  /** The Model calls of the whole record. */
  get modelTotals(): ModelTotals {
    return modelTotals(this.#record.events);
  }

  played(): RunEvent[] {
    const { events } = this.#record;
    while (this.#event < events.length && events[this.#event].frame <= this.#frame) this.#event++;
    return events.slice(0, this.#event);
  }
}

export type Replay = { events: GameEvent[]; frame: number; screen: string };

export function originDifferences(run: Run, record: RunRecord): (keyof RunOrigin)[] {
  return (Object.keys(run.origin) as (keyof RunOrigin)[]).filter((key) => run.origin[key] !== record.header[key]);
}

const EVENT_TYPES = new Set<unknown>(["action", "map", "battle", "milestone", "model", "summary"] satisfies RunEvent["type"][]);

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isRunEvent(value: unknown): value is RunEvent {
  if (!isObject(value) || !Number.isInteger(value.frame) || !EVENT_TYPES.has(value.type)) return false;
  return value.type !== "action" || (isObject(value.action) && isObject(value.result));
}

export function isRunRecord(value: unknown): value is RunRecord {
  if (!isObject(value) || !isObject(value.header) || !isObject(value.result)) return false;
  const { buttons, events } = value;
  if (!Array.isArray(buttons) || !Array.isArray(events)) return false;
  const holdsOk = buttons.every((hold) => Array.isArray(hold) && Number.isInteger(hold[0]) && Number.isInteger(hold[1]) && hold[1] > 0);
  return holdsOk && events.every((event, i) => isRunEvent(event) && (i === 0 || events[i - 1].frame <= event.frame));
}

/** A Run record from before the Memory tree has `notes` in its decisions, in place of `note`. */
export function readRecord(value: unknown): RunRecord | null {
  return isRunRecord(value) ? { ...value, events: value.events.map(oldNotes) } : null;
}

function oldNotes(event: RunEvent): RunEvent {
  if (event.type !== "model" || event.decision === null) return event;
  const { notes, ...decision } = event.decision as Decision & { notes?: string };
  return notes === undefined ? event : { ...event, decision: { ...decision, note: notes } };
}

export async function replay(record: RunRecord): Promise<Replay> {
  const run = await Run.open();
  try {
    const differences = originDifferences(run, record);
    if (differences.length > 0) throw new Error(`the Run record does not replay here: different ${differences.join(", ")}`);
    const watch = new GameWatch(run.game);
    const events: GameEvent[] = [];
    const player = new RecordPlayer(record);
    while (!player.ended) {
      run.runFrame(player.next());
      events.push(...watch.onFrame(run.frame));
    }
    return { events, frame: run.frame, screen: run.screenHash() };
  } finally {
    run.core.close();
  }
}

export async function readRunRecord(name: string): Promise<RunRecord | null> {
  return readRecord(await Bun.file(join(RUNS_DIR, name)).json().catch(() => null));
}

export async function parentRecord(name: string): Promise<ParentRecord> {
  const record = await readRunRecord(name);
  if (!record) throw new Error(`${name} is not a Run record`);
  return { name, record };
}

/** The events of a Continued Run start with the `events` events of its parent; `frame` is its first frame. */
export type Continuation = { frame: number; events: number };

export function continuationOf(parent: RunRecord): Continuation {
  return { frame: new RecordPlayer(parent).frames, events: parent.events.length };
}

export async function writeRecord(record: RunRecord): Promise<string> {
  await mkdir(RUNS_DIR, { recursive: true });
  const { name, version } = record.header.bot;
  const path = join(RUNS_DIR, `${name}-${version}-${new Date().toISOString().replaceAll(":", "-")}.json`);
  await Bun.write(path, JSON.stringify(record));
  return path;
}
