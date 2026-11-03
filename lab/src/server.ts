// Usage: bun run viewer   (ROM: LAB_ROM=pokefirered_modern_lab by default)
import { mkdir, readdir, rename } from "node:fs/promises";
import { basename, join } from "node:path";
import type { ServerWebSocket } from "bun";
import viewerPage from "../viewer/index.html";
import { type Camera, readAreas, safely } from "./game";
import { type InventoryAt, InventoryHistory } from "./inventory";
import { AtlasWatch, type Sight } from "./harness/atlas";
import { type Bot, botInfos, botNames, errorText, loadBot } from "./harness/harness";
import { GridPlay } from "./grid";
import { ScreenFanout } from "./screens";
import { RACE_SUFFIX, RACES_DIR, raceNames } from "./race/make";
import { buildWorld } from "./race/world";
import { MAX_RUNS, type PoolRun, type ReplayView, RunPool, type RunEnd } from "./harness/pool";
import { type Continuation, continuationOf, extendedOptions, factsAt, Keyframes, limitOf, modelFacts, type ModelOptions, modelTotals, originDifferences, providerOf, readRunHeader, readRunRecord, recordFacts, RecordPlayer, replaceRecord, replayStart, type RunEvent, type RunRecord, RUNS_DIR, type SpendLimit, writeRecord } from "./harness/record";
import { runCharacter } from "./model/character";
import { providerProblem, providerStatuses } from "./model/providers";
import {
  BinaryKind,
  type ClientMessage,
  extendProblem,
  GBA_FPS,
  type Jump,
  modelEvents,
  type ModelProvider,
  type ReplayModel,
  type ReplayStatus,
  type RunFrom,
  type RunSummary,
  type ServerMessage,
  type ShownRun,
  type Speed,
  spendText,
  spentIn,
  STATE_INTERVAL_MS,
  VIEWER_RUN_ID,
} from "./protocol";
import { ROM_NAME, Run, type RunOrigin, type RunState, SAVES_DIR, START_SAVE } from "./run";
import { hasCompleteSlot, type TrainerNames } from "./save-file";

const PORT = Number(process.env.LAB_PORT ?? 8766);
const AUDIO_RATE = 48000;
// The Viewer keeps this much audio queued; the Run speed is trimmed to hold it there.
const AUDIO_TARGET_MS = 60;

type Keyframe = { frame: number; state: Uint8Array; atlas: AtlasWatch };

type Replay = { name: string; player: RecordPlayer; continued: Continuation | null; keyframes: Keyframes<Keyframe>; jump: Jump | null };

const TICK_MS = 12;
const JUMP_TICK_MS = 40;

class LivePlay {
  keys = 0;
  speed: Speed = 1;
  paused = false;
  overlay = false;
  quickState: Uint8Array | null = null;
  audioWanted = false;
  /** Speed factor near 1, set from the Viewer audio queue (the two clocks drift apart). */
  rateTrim = 1;
  private audioOn = false;
  private lastTick = performance.now();
  /** Frames due but not run yet (fractional). */
  private credit = 0;
  private fpsWindow = { start: performance.now(), frames: 0, value: 0 };
  private activeReplay: Replay | null = null;
  private atlas: AtlasWatch;
  inventory = new InventoryHistory();

  constructor(private readonly run: Run) {
    this.atlas = new AtlasWatch(run.game);
  }

  sight(): Sight {
    return this.atlas.sight();
  }

  async reset(names: TrainerNames | null = null): Promise<void> {
    this.endReplay();
    await this.run.reset(names);
    this.inventory = new InventoryHistory();
    this.atlas = new AtlasWatch(this.run.game);
    this.resyncClock();
  }

  loadQuickState(): boolean {
    if (!this.quickState || !this.run.core.loadState(this.quickState)) return false;
    this.inventory = new InventoryHistory();
    this.resyncClock();
    return true;
  }

  async startReplay(name: string, record: RunRecord, continued: Continuation | null): Promise<(keyof RunOrigin)[]> {
    // A save with no place for the names gives a notice through the differences below.
    await this.reset(record.header.names).catch(() => this.reset());
    const differences = originDifferences(this.run, record);
    if (differences.length > 0) {
      await this.reset();
      return differences;
    }
    // No await from here on: a tick in between would run frames that the record does not have.
    this.activeReplay = { name, player: new RecordPlayer(record), continued, keyframes: new Keyframes(), jump: null };
    this.onReplayFrame(this.activeReplay);
    this.speed = 1;
    this.paused = false;
    this.syncAudio();
    return [];
  }

  endReplay(): void {
    if (this.activeReplay) this.inventory = this.inventory.until(this.run.frame);
    this.activeReplay = null;
    this.syncAudio();
  }

  get seeking(): Jump | null {
    return this.activeReplay?.jump ?? null;
  }

  // A jump starts from a keyframe or from now, so the replay plays each new frame in order: the keyframes come in order.
  private onReplayFrame(replay: Replay): void {
    replay.keyframes.onFrame(this.run.frame, () => ({ frame: this.run.frame, state: this.run.core.saveState(), atlas: this.atlas.clone() }));
  }

  seek(target: number): void {
    const replay = this.activeReplay;
    if (!replay) return;
    const frame = Math.max(0, Math.min(Math.round(target), replay.player.frames));
    const now = this.run.frame;
    const key = replay.keyframes.before(frame);
    const fromNow = key === undefined || (key.frame <= now && now <= frame);
    if (!fromNow) {
      if (!this.run.core.loadState(key.state)) return;
      replay.player.seek(key.frame);
      this.atlas = key.atlas.clone();
    }
    replay.jump = frame === now ? null : { from: this.run.frame, to: frame };
    this.resyncClock();
    this.syncAudio();
  }

  private endJump(replay: Replay): void {
    replay.jump = null;
    this.resyncClock();
    this.syncAudio();
  }

  get replay(): Replay | null {
    return this.activeReplay;
  }

  private nextKeys(): number | null {
    const player = this.activeReplay?.player;
    if (!player) return this.keys;
    return player.ended ? null : player.next();
  }

  resyncClock(): void {
    this.lastTick = performance.now();
    this.credit = 0;
  }

  /** Audio only at normal speed: at other speeds it would sound wrong. */
  get audioActive(): boolean {
    return this.audioWanted && this.speed === 1 && !this.paused && !this.seeking;
  }

  syncAudio(): void {
    if (this.audioActive === this.audioOn) return;
    this.audioOn = this.audioActive;
    this.run.core.enableAudio(this.audioOn, AUDIO_RATE);
    this.rateTrim = 1;
  }

  /** Runs the frames that are due now. Returns the number of frames run. */
  tick(now: number): number {
    const elapsed = now - this.lastTick;
    this.lastTick = now;
    const replay = this.activeReplay;
    const jump = replay?.jump ?? null;
    const due = jump ? jump.to - this.run.frame : this.clockDue(elapsed);
    const budgetEnd = now + (jump ? JUMP_TICK_MS : TICK_MS);
    let ran = 0;
    while (ran < due && performance.now() < budgetEnd) {
      const keys = this.nextKeys();
      if (keys === null) break;
      this.run.runFrame(keys);
      this.atlas.onFrame();
      this.inventory.onFrame(this.run.frame, () => this.run.game.inventory());
      ran++;
      if (replay) this.onReplayFrame(replay);
    }
    if (replay && jump) {
      if (this.run.frame >= jump.to || replay.player.ended) this.endJump(replay);
    } else if (this.speed !== "max") this.credit -= ran;
    this.fpsWindow.frames += ran;
    if (now - this.fpsWindow.start >= 1000) {
      this.fpsWindow.value = Math.round((this.fpsWindow.frames * 1000) / (now - this.fpsWindow.start));
      this.fpsWindow = { start: now, frames: 0, value: this.fpsWindow.value };
    }
    return ran;
  }

  private clockDue(elapsed: number): number {
    if (this.paused) return 0;
    if (this.speed === "max") return Number.POSITIVE_INFINITY;
    const trim = this.audioOn ? this.rateTrim : 1;
    this.credit += (elapsed / 1000) * GBA_FPS * this.speed * trim;
    // Too far behind (for example after a slow tick): do not try to catch up.
    if (this.credit > 20 * this.speed) this.credit = 1;
    return Math.floor(this.credit);
  }

  get fps(): number {
    return this.fpsWindow.value;
  }
}

const [run, areas] = await Promise.all([Run.open(), readAreas()]);
const live = new LivePlay(run);
// The Run of the Viewer is one of the emulators.
const pool = new RunPool(MAX_RUNS - 1);
const grid = new GridPlay(pool);
const writtenRecords = new Map<number, string>();
const settled = new Set<number>();

/** What the Viewer sends of the Run that it shows. */
type RunSource = {
  id: number;
  frame(): number;
  state(): RunState;
  camera(): Camera | null;
  events(): readonly RunEvent[];
  sight(): Sight;
  summary(): ShownRun;
  inventory(): readonly InventoryAt[];
};

const viewerRun: RunSource = {
  id: VIEWER_RUN_ID,
  frame: () => run.frame,
  state: () => run.readState(),
  camera: () => safely(() => run.game.camera()),
  events: () => live.replay?.player.played() ?? [],
  sight: () => live.sight(),
  summary: () => ({ kind: "viewer", replay: live.replay && replayStatus(live.replay) }),
  inventory: () => live.inventory.entries,
};

function botRun(poolRun: PoolRun): RunSource {
  return {
    id: poolRun.id,
    frame: () => poolRun.view.frame,
    state: () => poolRun.view,
    camera: () => poolRun.view.camera,
    events: () => poolRun.events,
    sight: () => poolRun.view.sight,
    summary: () => ({ kind: "bot", run: runSummary(poolRun) }),
    inventory: () => poolRun.inventory,
  };
}

let shown = viewerRun;
// The keyboard, the speeds, pause, the savestate and the Starting save act on the Run of the Viewer only.
const VIEWER_RUN_MESSAGES = new Set<ClientMessage["type"]>(["keys", "speed", "pause", "audio-level", "quick-save", "quick-load", "reset", "write-start-save", "end-replay", "seek"]);
const clients = new Set<ServerWebSocket<unknown>>();
const screens = new ScreenFanout();
const audioClients = new Set<ServerWebSocket<unknown>>();

function setAudioClient(ws: ServerWebSocket<unknown>, enabled: boolean): void {
  if (enabled) audioClients.add(ws);
  else audioClients.delete(ws);
  live.audioWanted = audioClients.size > 0;
  live.syncAudio();
}

function send(message: ServerMessage, to?: ServerWebSocket<unknown>): void {
  const text = JSON.stringify(message);
  for (const ws of to ? [to] : clients) ws.send(text);
}

async function sendStatus(to?: ServerWebSocket<unknown>): Promise<void> {
  const hasStartSave = await Bun.file(START_SAVE).exists();
  send(
    {
      type: "status",
      rom: ROM_NAME,
      speed: live.speed,
      paused: live.paused,
      fps: live.fps,
      frame: shown.frame(),
      hasQuickState: live.quickState !== null,
      hasStartSave,
      audio: live.audioActive,
      runs: pool.runs.map(runSummary),
      shown: shown.summary(),
      places: { free: pool.free, limit: pool.limit },
      grid: grid.status(),
    },
    to,
  );
}

async function writeStartSave(): Promise<string> {
  if (run.origin.names) return "This emulator has the names of a replay in its save. Reset it, save in the game, then try again.";
  const save = run.core.saveData();
  if (!hasCompleteSlot(save)) {
    return "No complete save. Save in the game, wait for the message at the end of the save, then try again.";
  }
  await mkdir(SAVES_DIR, { recursive: true });
  // Keep the previous Starting save instead of overwriting it.
  if (await Bun.file(START_SAVE).exists()) {
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    await rename(START_SAVE, join(SAVES_DIR, `start-${stamp}.sav`));
  }
  await Bun.write(START_SAVE, save);
  return "Starting save written to lab/saves/start.sav (the old one is kept next to it).";
}

async function recordNames(): Promise<string[]> {
  const names = await readdir(RUNS_DIR).catch(() => []);
  return names.filter((name) => name.endsWith(".json")).sort().reverse();
}

async function sendRecords(to?: ServerWebSocket<unknown>): Promise<void> {
  const names = await recordNames();
  send({ type: "records", names, facts: await recordFacts(names) }, to);
}

function replayStatus({ name, player, continued, keyframes }: Replay): ReplayStatus {
  return {
    name,
    endReason: player.result.endReason,
    frames: player.frames,
    ended: player.ended,
    model: replayModel(player, continued),
    continued,
    gameEvents: player.stateEvents ? player.gameEvents.length : null,
    reached: keyframes.reached,
    seeking: live.seeking,
  };
}

function replayModel(player: RecordPlayer, continued: Continuation | null): ReplayModel | null {
  const settings = player.header.bot.model;
  if (!settings) return null;
  const first = continued?.events ?? 0;
  const played = modelTotals(player.played().slice(first));
  const total = player.modelTotalsFrom(first);
  const { unit } = limitOf(settings);
  return { ...modelFacts(settings), calls: played.calls, spent: { unit, amount: spentIn(unit, played) }, totalCalls: total.calls, totalSpent: { unit, amount: spentIn(unit, total) } };
}

async function openRecord(name: string): Promise<RunRecord | string> {
  if (!(await recordNames()).includes(name)) return `No Run record ${name} in lab/runs/.`;
  return (await readRunRecord(name)) ?? `${name} is not a Run record.`;
}

async function replayFile(name: string): Promise<string> {
  const record = await openRecord(name);
  if (typeof record === "string") return record;
  const { parent } = record.header;
  const continued = await replayStart(record.header);
  const differences = await live.startReplay(name, record, continued);
  show(viewerRun);
  sendReplayEvents();
  if (differences.length > 0) {
    return `${name} does not replay here (different ${differences.join(", ")}). The Run starts again from the Starting save, and the keyboard plays it.`;
  }
  const noParent = parent !== undefined && continued === null ? ` Its parent ${parent} does not read: the panel Stats counts the calls of the parent in the limit.` : "";
  return `Replay of ${name}.${noParent}`;
}

function runSummary({ id, spec, continued, end, events, modelCallsStarted, stopAsked, view }: PoolRun): RunSummary {
  const { milestone, battle, totals } = factsAt(events, Number.POSITIVE_INFINITY);
  const facts = spec.model && modelFacts(spec.model);
  const own = continued ? modelTotals(events.slice(continued.events)) : totals;
  return {
    id,
    bot: spec.bot,
    names: runCharacter(events)?.names ?? null,
    from: spec.from ?? null,
    continued,
    playing: end === null,
    stopAsked,
    endReason: end?.record?.result.endReason ?? null,
    error: end?.error ?? null,
    model: facts ? { ...facts, spent: { unit: facts.limit.unit, amount: spentIn(facts.limit.unit, totals) }, ownSpent: { unit: facts.limit.unit, amount: spentIn(facts.limit.unit, own) }, callsStarted: modelCallsStarted } : null,
    frame: view.frame,
    milestone,
    battle,
    waits: end === null && modelCallsStarted > modelEvents(events).length,
    record: writtenRecords.get(id) ?? null,
  };
}

function show(next: RunSource): void {
  shown = next;
  live.keys = 0;
  live.rateTrim = 1;
  sendEvents();
  sendMap(shown.state());
  sendSight();
  sendInventory();
}

function placesText(): string {
  return `${pool.free} of the ${pool.limit} places are free (the Runs of the Bots and the Grid replays share them; ${MAX_RUNS} emulators at most, with the Viewer Run)`;
}

async function startBot(name: string, given: ModelOptions, parent: string | undefined, count: number): Promise<string> {
  if (parent === undefined) return launch(name, given, count, null);
  const record = await openRecord(parent);
  if (typeof record === "string") return record;
  if (runsFrom(parent).some(({ spec }) => spec.from?.kind === "extended")) return `No new Run: a Run plays on from ${parent} in the same Run, and this file changes at its end.`;
  return launch(name, given, count, { from: { record: parent, kind: "continued" }, record });
}

function runsFrom(name: string): PoolRun[] {
  return pool.runs.filter(({ id, spec }) => !settled.has(id) && spec.from?.record === name);
}

async function extendRun(name: string, limit: SpendLimit): Promise<string> {
  const record = await openRecord(name);
  if (typeof record === "string") return record;
  const playing = runsFrom(name).length > 0;
  const problem = extendProblem((await recordFacts(await recordNames()))[name], playing);
  if (problem) return `No Run: ${problem}`;
  const { bot } = record.header;
  return launch(bot.name, extendedOptions(bot.model, limit), 1, { from: { record: name, kind: "extended" }, record });
}

async function launch(name: string, given: ModelOptions, count: number, start: { from: RunFrom; record: RunRecord } | null): Promise<string> {
  if (!(await botNames()).includes(name)) return `No Bot ${name} in lab/bots/.`;
  if (!Number.isInteger(count) || count < 1) return `No new Run: the count ${count} is not a whole number from 1.`;
  if (count > pool.free) return `No new Run: ${count} Runs need ${count} places, and ${placesText()}.`;
  let bot: Bot;
  try {
    bot = await loadBot(name, given);
  } catch (error) {
    return `No Run: ${errorText(error)}.`;
  }
  const { model } = bot;
  const started = pool.startAll({ bot: name, ...(model ? { model } : {}), ...(start ? { from: start.from } : {}) }, count, start && continuationOf(start.record));
  show(botRun(started[0]));
  for (const run of started) void run.done.then((end) => onBotEnd(run, end));
  const origin = start ? ` from the end of ${start.from.record}${start.from.kind === "extended" ? ", in the same Run" : ""}` : "";
  const runs = count === 1 ? `Run ${started[0].id}: the Bot ${name} plays` : `Runs ${started[0].id} to ${started[count - 1].id}: the Bot ${name} plays ${count} times`;
  return `${runs}${origin}${model ? ` with the model ${model.id} on ${providerOf(model)} (limit ${spendText(limitOf(model))} for each Run)` : ""}.`;
}

async function onBotEnd({ id, spec }: PoolRun, { record, error }: RunEnd): Promise<void> {
  const failure = error ? ` · error: ${error}` : "";
  try {
    const lastText = record?.result.lastText === undefined ? "" : ` (last text "${record.result.lastText}")`;
    const planLimit = record?.result.planLimit === undefined ? "" : ` (${record.result.planLimit})`;
    const written = record && basename(await (spec.from?.kind === "extended" ? replaceRecord(spec.from.record, record) : writeRecord(record)));
    if (written) writtenRecords.set(id, written);
    const end = record ? `end: ${record.result.endReason}${lastText}${planLimit}, Run record runs/${written}` : "no Run record";
    send({ type: "notice", text: `Run ${id} (${spec.bot}): ${end}${failure}.` });
    await sendRecords();
  } catch (writeError) {
    send({ type: "notice", text: `Run ${id} (${spec.bot}): the Run record is not written (${writeError})${failure}.` });
  }
  settled.add(id);
  await sendStatus();
}

function sendReplayEvents(to?: ServerWebSocket<unknown>): void {
  const replay = live.replay;
  if (replay) send({ type: "replay-events", name: replay.name, events: replay.player.gameEvents }, to);
}

let eventsSent = 0;

function sendEvents({ to, quiet }: { to?: ServerWebSocket<unknown>; quiet?: boolean } = {}): void {
  const events = [...shown.events()];
  if (!to) eventsSent = events.length;
  send({ type: "events", events, quiet }, to);
}

function sendNewEvents(): void {
  if (shown.events().length !== eventsSent) sendEvents();
}

async function addToGrid(cell: number, name: string): Promise<string | null> {
  const record = await openRecord(name);
  if (typeof record === "string") return record;
  return grid.add(cell, name, record) ? null : `No replay of ${name}: ${placesText()}.`;
}

async function handle(message: ClientMessage, ws: ServerWebSocket<unknown>): Promise<void> {
  if (shown !== viewerRun && VIEWER_RUN_MESSAGES.has(message.type)) return;
  switch (message.type) {
    case "keys":
      live.keys = message.keys;
      break;
    case "speed":
      live.speed = message.speed;
      live.resyncClock();
      live.syncAudio();
      break;
    case "pause":
      live.paused = message.paused;
      live.resyncClock();
      live.syncAudio();
      break;
    case "audio":
      setAudioClient(ws, message.enabled);
      break;
    case "view-map": {
      const grid = safely(() => run.game.gridOf(message.group, message.num));
      // The actors are those of the Run of the Viewer: none for a Run of a Bot.
      send({ type: "preview", grid, actors: grid && shown === viewerRun ? safely(() => run.game.actorsOf(grid)) : null }, ws);
      return;
    }
    case "audio-level": {
      // Queue too long: run a little slower, and the reverse. At most 1% off.
      const error = AUDIO_TARGET_MS - message.ms;
      live.rateTrim = 1 + Math.max(-0.01, Math.min(0.01, error * 0.0005));
      return;
    }
    case "overlay":
      live.overlay = message.enabled;
      send({ type: "camera", camera: shown.camera() }, ws);
      break;
    case "quick-save":
      if (run.origin.names) {
        send({ type: "notice", text: "No savestate of a replay with names: its game must not become the Starting save." }, ws);
      } else {
        live.quickState = run.core.saveState();
        send({ type: "notice", text: "Savestate kept (in memory)." });
      }
      break;
    case "quick-load":
      if (live.replay) {
        send({ type: "notice", text: "No load of the savestate during a replay." }, ws);
      } else if (live.loadQuickState()) {
        show(viewerRun);
        send({ type: "notice", text: "Savestate loaded." });
      }
      break;
    case "reset":
      await live.reset();
      show(viewerRun);
      send({ type: "notice", text: "The Run starts again from the Starting save." });
      break;
    case "write-start-save":
      send({ type: "notice", text: await writeStartSave() });
      break;
    case "replay":
      send({ type: "notice", text: await replayFile(message.name) });
      break;
    case "end-replay":
      if (!live.replay) break;
      live.endReplay();
      send({ type: "notice", text: "End of the replay: the keyboard plays the Run from this frame." });
      break;
    case "seek":
      live.seek(message.frame);
      void sendStatus();
      break;
    case "start-bot":
      send({ type: "notice", text: await startBot(message.name, message.model, message.parent, message.count) });
      break;
    case "extend-run":
      send({ type: "notice", text: await extendRun(message.record, message.limit) });
      break;
    case "stop-run": {
      const poolRun = pool.runs.find((r) => r.id === message.runId);
      if (!poolRun || poolRun.end) break;
      poolRun.stop();
      send({ type: "notice", text: `Run ${poolRun.id}: stop asked. The Run stops after the action that plays, or at once in a Model call.` });
      break;
    }
    case "show": {
      const poolRun = pool.runs.find((r) => r.id === message.runId);
      show(poolRun ? botRun(poolRun) : viewerRun);
      break;
    }
    case "follow":
      screens.follow(ws, message.runIds, message.size);
      return;
    case "grid-add": {
      const refused = await addToGrid(message.cell, message.name);
      if (refused) send({ type: "notice", text: refused }, ws);
      break;
    }
    case "grid-remove":
      grid.remove(message.cell);
      break;
    case "grid-cursor":
      grid.control(message);
      break;
  }
  await sendStatus();
}

function screenOf(id: number): ReplayView | undefined {
  if (id === VIEWER_RUN_ID) return live.seeking ? undefined : { frame: run.frame, screen: run.core.screen() };
  return pool.view(id);
}

function sendScreens(now: number): void {
  if (screens.send(now, shown.id, screenOf) && live.overlay) send({ type: "camera", camera: shown.camera() });
}

/** Audio message: 2 header bytes (kind, 0) so the 16-bit samples stay aligned. */
function sendAudio(): void {
  const samples = run.core.readAudio();
  if (samples.length === 0 || shown !== viewerRun) return;
  const message = new Uint8Array(2 + samples.byteLength);
  message[0] = BinaryKind.Audio;
  message.set(new Uint8Array(samples.buffer, samples.byteOffset, samples.byteLength), 2);
  for (const ws of audioClients) ws.send(message);
}
const lastSent = new Map<ServerMessage["type"], string>();

/** To one client always; to all the clients only when the message changed since they got it. */
function sendChanged(message: ServerMessage, to?: ServerWebSocket<unknown>): void {
  const json = JSON.stringify(message);
  if (!to && json === lastSent.get(message.type)) return;
  if (!to) lastSent.set(message.type, json);
  for (const ws of to ? [to] : clients) ws.send(json);
}

function sendSight(to?: ServerWebSocket<unknown>): void {
  sendChanged({ type: "sight", maps: shown.sight() }, to);
}

let inventorySent: { entries: readonly InventoryAt[]; length: number } = { entries: [], length: 0 };

function sendInventory(to?: ServerWebSocket<unknown>): void {
  const entries = shown.inventory();
  if (to) return send({ type: "inventory", from: 0, entries }, to);
  const same = entries === inventorySent.entries;
  if (same && entries.length === inventorySent.length) return;
  const from = same ? inventorySent.length : 0;
  inventorySent = { entries, length: entries.length };
  send({ type: "inventory", from, entries: entries.slice(from) });
}

let lastState = 0;
/** The grid only when it changed; the actors each time. */
function sendMap({ grid, actors }: RunState, to?: ServerWebSocket<unknown>): void {
  sendChanged({ type: "map", grid }, to);
  send({ type: "actors", actors }, to);
}

function loop(): void {
  const now = performance.now();
  const jumped = live.seeking !== null;
  const ran = live.tick(now);
  grid.tick(now);
  // The screens and the events of the frames between the two ends of a jump moved the panels forward and backward: a jump sends the status only.
  if (shown === viewerRun && live.seeking) {
    sendScreens(now);
    if (now - lastState >= STATE_INTERVAL_MS) {
      lastState = now;
      void sendStatus();
    }
    setTimeout(loop, 0);
    return;
  }
  if (shown === viewerRun && jumped) {
    screens.forget(VIEWER_RUN_ID);
    lastState = 0;
    sendEvents({ quiet: true });
  }
  if (ran > 0 && live.audioActive) sendAudio();
  sendNewEvents();
  sendScreens(now);
  if (clients.size > 0 && now - lastState >= STATE_INTERVAL_MS) {
    lastState = now;
    const runState = shown.state();
    if (runState.state) send({ type: "state", state: runState.state });
    sendMap(runState);
    sendSight();
    sendInventory();
    // The whole-map view shows the screen area; the overlay gets the camera with each screen too.
    send({ type: "camera", camera: runState.camera });
    void sendStatus();
  }
  setTimeout(loop, live.speed === "max" && !live.paused ? 0 : 2);
}

const raceWorld = safely(() => JSON.stringify(buildWorld(run.game)));
if (raceWorld === null) console.error("The world of the Race did not load: the Race tab will not open");

async function raceFile(name: string): Promise<Response> {
  const file = Bun.file(join(RACES_DIR, `${basename(name)}${RACE_SUFFIX}`));
  if (!(await file.exists())) return new Response("Not found", { status: 404 });
  return new Response(file, { headers: { "content-type": "application/gzip" } });
}

let handling = Promise.resolve();

// One message at a time: the Grid sends a seek right after a replay, and the seek must find the replay started.
function enqueue(message: ClientMessage, ws: ServerWebSocket<unknown>): void {
  handling = handling.then(() => handle(message, ws)).catch((error) => console.error(error));
}

async function botProvider(message: Extract<ClientMessage, { type: "start-bot" }>): Promise<ModelProvider | null> {
  const bot = await loadBot(message.name, message.model).catch(() => null);
  return bot?.model ? providerOf(bot.model) : null;
}

async function recordProvider(name: string): Promise<ModelProvider | null> {
  const model = (await readRunHeader(name))?.bot.model;
  return model ? providerOf(model) : null;
}

// The check of a provider runs a command, so it stays out of the queue: a stop does not wait for it.
async function startWhenReady(message: Extract<ClientMessage, { type: "start-bot" | "extend-run" }>, ws: ServerWebSocket<unknown>): Promise<void> {
  const provider = message.type === "extend-run" ? await recordProvider(message.record) : await botProvider(message);
  const problem = provider && (await providerProblem(provider));
  if (problem) send({ type: "notice", text: `No Run: ${problem}.` });
  else enqueue(message, ws);
}

Bun.serve({
  port: PORT,
  development: true,
  routes: {
    "/": viewerPage,
    "/race/world.json": () => (raceWorld === null ? new Response("The world of the Race did not load: see the log of the server", { status: 500 }) : new Response(raceWorld, { headers: { "content-type": "application/json" } })),
    "/race/list.json": async () => Response.json(await raceNames()),
    "/race/file/:name": (req) => raceFile(req.params.name),
  },
  fetch(req, server) {
    if (new URL(req.url).pathname === "/ws" && server.upgrade(req)) return;
    return new Response("Not found", { status: 404 });
  },
  websocket: {
    open(ws) {
      clients.add(ws);
      screens.add(ws);
      void sendStatus(ws);
      send({ type: "maps", names: run.game.allMapNames }, ws);
      send({ type: "areas", areas }, ws);
      void sendRecords(ws);
      void Promise.all([botInfos(), providerStatuses()]).then(([bots, providers]) => send({ type: "bots", bots, providers }, ws));
      sendReplayEvents(ws);
      sendEvents({ to: ws });
      sendMap(shown.state(), ws);
      sendSight(ws);
      sendInventory(ws);
    },
    close(ws) {
      clients.delete(ws);
      screens.delete(ws);
      setAudioClient(ws, false);
      // The Grid is not kept after a reload (#72).
      if (clients.size === 0) {
        live.keys = 0;
        grid.clear();
      }
    },
    message(ws, data) {
      if (typeof data !== "string") return;
      const message = JSON.parse(data) as ClientMessage;
      if (message.type === "start-bot" || message.type === "extend-run") void startWhenReady(message, ws);
      else enqueue(message, ws);
    },
  },
});

console.log(`Viewer: http://localhost:${PORT}  (ROM ${ROM_NAME})`);
loop();
