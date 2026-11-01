// The buttons alone replay a Run: the game reads no input while it is frozen (docs/adr/0002).
import { mkdir, readdir } from "node:fs/promises";
import { join } from "node:path";
import type { Game, Milestone } from "../game";
import { parseRunId, type ReasoningLevel, runIdText, type StarterSpecies, type STARTERS, type StateEntry, type Track, TRACK_FIELD, TRACK_POINT } from "../protocol";
import { Run, type RunOrigin } from "../run";
import { isStateEvent, type StateEvent, StateTrackWatch, StateWatch } from "./game-events";
import type { ActionEntry, Bot, KnowledgeLevel, ParentRecord, RunResult } from "./harness";

/** Format 1: the Game events of the state. Format 2: the `track`. Format 3: the State track. */
export const RECORD_FORMAT = 3;

const STATE_EVENTS_FORMAT = 1;

export const RUNS_DIR = join(import.meta.dir, "..", "..", "runs");

export type ButtonHold = [keys: number, frames: number];

/** `trainer`: the battle is against a trainer. A record without the format 1 does not tell it. */
export type GameEvent = { frame: number } & (
  | { type: "map"; map: string }
  | { type: "battle"; state: "start"; trainer?: boolean }
  | { type: "battle"; state: "end" }
  | { type: "milestone"; milestone: Milestone }
  | StateEvent
);

export function isGameEvent(event: RunEvent): event is GameEvent {
  return event.type === "map" || event.type === "battle" || event.type === "milestone" || isStateEvent(event);
}

export function hasStateEvents(record: Pick<RunRecord, "format">): boolean {
  return (record.format ?? 0) >= STATE_EVENTS_FORMAT;
}

type Starter = (typeof STARTERS)[number];

// The reasoning "off" sends the effort "none", which a model that always reasons does not have: give it another level.
export type ModelSettings = { id: string; costLimit: number; reasoning: ReasoningLevel; thinking: ReasoningLevel; temperature: number | null; starter: Starter; stopAtWhiteout: boolean };

/** The options of a model bot as a person gives them (the command line, the Viewer): a missing option takes its default. */
export type ModelOptions = { id?: string; costLimit?: number; reasoning?: string; thinking?: string; temperature?: number | null; starter?: string; stopAtWhiteout?: boolean };

export type Prompt = { system: string; user: string; turns?: Turn[] };

export type Turn = { assistant: string; user: string };

export type Usage = { promptTokens: number; cachedTokens?: number; completionTokens: number; reasoningTokens: number; cost: number };

export type Decision = { reason: string; action: string; mission: string; objective: string; note: string; character?: string; starter?: StarterSpecies };

export type NodeRange = { from: number; to: number };

export type NodeSentence = NodeRange & { sentence: string };

export type ModelAnswer = { model: string; situation: string; prompt: Prompt; answer: string | null; usage: Usage; reasoning?: string; stuck?: number; character?: boolean; reflection?: boolean; review?: boolean; removed?: NodeSentence[] } & (
  | { decision: Decision; error: null }
  | { decision: null; error: string }
);

export type ModelEvent = { type: "model"; frame: number; latencyMs: number } & ModelAnswer;

export type SummaryAnswer = { model: string; prompt: Prompt; answer: string | null; usage: Usage; reasoning?: string } & NodeRange & ({ summary: string; error: null } | { summary: null; error: string });

export type SummaryEvent = { type: "summary"; frame: number; latencyMs: number } & SummaryAnswer;

export type ActionEvent = { type: "action"; frame: number } & ActionEntry;

export type RunEvent = GameEvent | ActionEvent | ModelEvent | SummaryEvent;

function withTrainer(event: RunEvent, trainers: ReadonlyMap<number, boolean>): RunEvent {
  if (event.type !== "battle" || event.state !== "start") return event;
  const trainer = trainers.get(event.frame);
  return trainer === undefined ? event : { ...event, trainer };
}

// A record from before format 1 gets the Game events of the whole Run: a Continued Run and the migration use this.
export function withStateEvents(events: readonly RunEvent[], replayed: readonly RunEvent[]): RunEvent[] {
  const added = replayed.filter(isStateEvent);
  const trainers = new Map(replayed.flatMap((event) => (event.type === "battle" && event.state === "start" && event.trainer !== undefined ? [[event.frame, event.trainer]] : [])));
  const merged: RunEvent[] = [];
  let next = 0;
  for (const event of events) {
    while (next < added.length && (added[next].frame < event.frame || (added[next].frame === event.frame && !isGameEvent(event)))) merged.push(added[next++]);
    merged.push(withTrainer(event, trainers));
  }
  return [...merged, ...added.slice(next)];
}

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

export function factsAt(events: readonly RunEvent[], frame: number): { milestone: Milestone | null; battle: boolean; cost: number } {
  let milestone: Milestone | null = null;
  let battle = false;
  for (const event of events) {
    if (event.frame > frame) break;
    if (event.type === "milestone") milestone = event.milestone;
    if (event.type === "battle") battle = event.state === "start";
  }
  return { milestone, battle, cost: modelTotals(events.filter((event) => event.frame <= frame)).cost };
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

export type RunRecord = { format?: number; header: RunHeader; buttons: ButtonHold[]; events: RunEvent[]; track?: Track; state?: StateEntry[]; result: RunResult };

export type CurrentRecord = RunRecord & { track: Track; state: StateEntry[] };

export function isCurrentRecord(record: RunRecord): record is CurrentRecord {
  return (record.format ?? 0) >= RECORD_FORMAT && record.track !== undefined && record.state !== undefined;
}

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
  #facing = 0;
  readonly #stateEvents: StateWatch;
  readonly #stateTrack: StateTrackWatch;
  readonly track: Track = [];

  constructor(private readonly game: Game) {
    this.#stateEvents = new StateWatch(game);
    this.#stateTrack = new StateTrackWatch(game);
  }

  get stateTrack(): readonly StateEntry[] {
    return this.#stateTrack.entries;
  }

  get gameProgress(): number {
    this.#levels = Math.max(this.#levels, this.game.party().reduce((sum, mon) => sum + mon.level, 0));
    this.#flags = Math.max(this.#flags, this.game.flagProgress());
    return this.#maps.size + this.#milestones.size + this.#levels + this.#flags;
  }

  onFrame(frame: number): GameEvent[] {
    const events: GameEvent[] = [];
    const battle = this.game.battleUnderway();
    if (battle !== this.#battle) {
      events.push(battle ? { frame, type: "battle", state: "start", trainer: this.game.eventReads().trainerBattle() } : { frame, type: "battle", state: "end" });
      this.#stateTrack.onBattleChange(frame, battle);
    }
    this.#battle = battle;
    const mode = this.game.mode();
    if (mode !== "other") {
      const map = this.game.map().name;
      if (map !== this.#map) events.push({ frame, type: "map", map });
      this.#maps.add(map);
      this.#map = map;
      for (const milestone of this.game.milestones()) {
        if (this.#milestones.has(milestone)) continue;
        this.#milestones.add(milestone);
        events.push({ frame, type: "milestone", milestone });
      }
    }
    // Before the first map, the game has not loaded the save yet.
    if (this.#map === null) return events;
    events.push(...this.#stateEvents.onFrame(mode).map((event) => ({ frame, ...event })));
    this.#stateTrack.onFrame(frame);
    if (mode === "battle") this.#stateTrack.onBattleFrame(frame);
    // The game moves the save block in memory at each map load: out of the overworld, the place can read as zeros.
    if (mode === "overworld") this.#onPlace(frame);
    return events;
  }

  #onPlace(frame: number): void {
    const { group, num, x, y, facing } = this.game.place();
    if (facing !== null) this.#facing = facing;
    const point = [group, num, x, y, this.#facing];
    const last = this.track.length - TRACK_POINT + TRACK_FIELD.group;
    if (point.every((value, i) => this.track[last + i] === value)) return;
    this.track.push(frame, ...point);
  }
}

export class RecordPlayer {
  readonly frames: number;
  readonly gameEvents: GameEvent[];
  /** False for a record without the format 1. */
  readonly stateEvents: boolean;
  #frame = 0;
  #hold = 0;
  #inHold = 0;
  #event = 0;
  readonly #record: RunRecord;

  constructor(record: RunRecord) {
    this.#record = record;
    this.frames = record.buttons.reduce((frames, [, count]) => frames + count, 0);
    this.gameEvents = record.events.filter(isGameEvent);
    this.stateEvents = hasStateEvents(record);
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

  seek(frame: number): void {
    let left = Math.max(0, Math.min(frame, this.frames));
    this.#frame = left;
    this.#hold = 0;
    this.#event = 0;
    const { buttons } = this.#record;
    while (this.#hold < buttons.length && left >= buttons[this.#hold][1]) left -= buttons[this.#hold++][1];
    this.#inHold = left;
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

const KEYFRAME_FRAMES = 3600;
const MAX_KEYFRAMES = 256;

// Above MAX_KEYFRAMES, keep every second one and double the interval: a long Run stays within the limit.
export class Keyframes<K extends { frame: number }> {
  #list: K[] = [];
  #interval = KEYFRAME_FRAMES;
  #reached = -1;

  get reached(): number {
    return Math.max(0, this.#reached);
  }

  onFrame(frame: number, take: () => K): void {
    if (frame <= this.#reached) return;
    this.#reached = frame;
    if (frame % this.#interval !== 0) return;
    this.#list.push(take());
    if (this.#list.length <= MAX_KEYFRAMES) return;
    this.#list = this.#list.filter((_, i) => i % 2 === 0);
    this.#interval *= 2;
  }

  before(frame: number): K | undefined {
    return this.#list.findLast((keyframe) => keyframe.frame <= frame);
  }
}

export type Replay = { events: GameEvent[]; frame: number; screen: string; track: Track; state: StateEntry[] };


export function originDifferences(run: Run, record: RunRecord): (keyof RunOrigin)[] {
  return (Object.keys(run.origin) as (keyof RunOrigin)[]).filter((key) => run.origin[key] !== record.header[key]);
}

const EVENT_TYPES = new Set<unknown>(["action", "model", "summary", "map", "battle", "milestone"] satisfies RunEvent["type"][]);

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isRunEvent(value: unknown): value is RunEvent {
  if (!isObject(value) || !Number.isInteger(value.frame)) return false;
  if (!EVENT_TYPES.has(value.type) && !(typeof value.type === "string" && isStateEvent({ type: value.type }))) return false;
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
    return { events, frame: run.frame, screen: run.screenHash(), track: watch.track, state: [...watch.stateTrack] };
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

async function nextRunId(dir: string): Promise<string> {
  const ids = (await readdir(dir)).map((file) => parseRunId(file) ?? 0);
  return runIdText(Math.max(0, ...ids) + 1);
}

let writing: Promise<string> = Promise.resolve("");

/** The file name starts with the Run id, so that the files sort in the order of the Runs. */
export function writeRecord(record: RunRecord, dir = RUNS_DIR): Promise<string> {
  // Two Runs can end at the same time: one write at a time, so that each one reads the id of the other.
  writing = writing
    .catch(() => "")
    .then(async () => {
      await mkdir(dir, { recursive: true });
      const { name, version } = record.header.bot;
      const path = join(dir, `${await nextRunId(dir)}-${name}-${version}-${new Date().toISOString().replaceAll(":", "-")}.json`);
      await Bun.write(path, JSON.stringify(record));
      return path;
    });
  return writing;
}
