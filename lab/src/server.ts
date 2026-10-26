// Usage: bun run viewer   (ROM: LAB_ROM=pokefirered_modern_lab by default)
import { mkdir, readdir, rename } from "node:fs/promises";
import { basename, join } from "node:path";
import type { ServerWebSocket } from "bun";
import viewerPage from "../viewer/index.html";
import { type Camera, safely } from "./game";
import { AtlasWatch, type Sight } from "./harness/atlas";
import { type Bot, botInfos, botNames, errorText, loadBot } from "./harness/harness";
import { MAX_RUNS, type PoolRun, RunPool, type RunEnd } from "./harness/pool";
import { type ModelOptions, modelTotals, originDifferences, readRecord, RecordPlayer, type RunEvent, type RunRecord, RUNS_DIR, writeRecord } from "./harness/record";
import {
  BinaryKind,
  type ClientMessage,
  DEFAULT_STARTER,
  type ReplayModel,
  type ReplayStatus,
  type RunSummary,
  SCREEN_INTERVAL_MS,
  type ServerMessage,
  type ShownRun,
  type Speed,
  STATE_INTERVAL_MS,
} from "./protocol";
import { ROM_NAME, Run, type RunOrigin, type RunState, SAVES_DIR, START_SAVE } from "./run";

const PORT = Number(process.env.LAB_PORT ?? 8766);
const GBA_FPS = 16777216 / 280896; // 59.7275
const AUDIO_RATE = 48000;
// The Viewer keeps this much audio queued; the Run speed is trimmed to hold it there.
const AUDIO_TARGET_MS = 60;

type Replay = { name: string; player: RecordPlayer };

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

  constructor(private readonly run: Run) {
    this.atlas = new AtlasWatch(run.game);
  }

  sight(): Sight {
    return this.atlas.sight();
  }

  async reset(): Promise<void> {
    this.activeReplay = null;
    await this.run.reset();
    this.atlas = new AtlasWatch(this.run.game);
    this.resyncClock();
  }

  async startReplay(name: string, record: RunRecord): Promise<(keyof RunOrigin)[]> {
    await this.reset();
    // No await from here on: a tick in between would run frames that the record does not have.
    const differences = originDifferences(this.run, record);
    if (differences.length > 0) return differences;
    this.activeReplay = { name, player: new RecordPlayer(record) };
    this.speed = 1;
    this.paused = false;
    this.syncAudio();
    return [];
  }

  endReplay(): void {
    this.activeReplay = null;
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
    return this.audioWanted && this.speed === 1 && !this.paused;
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
    if (this.paused) return 0;
    let due: number;
    if (this.speed === "max") {
      due = Number.POSITIVE_INFINITY;
    } else {
      const trim = this.audioOn ? this.rateTrim : 1;
      this.credit += (elapsed / 1000) * GBA_FPS * this.speed * trim;
      // Too far behind (for example after a slow tick): do not try to catch up.
      if (this.credit > 20) this.credit = 1;
      due = Math.floor(this.credit);
    }
    const budgetEnd = now + 12;
    let ran = 0;
    while (ran < due && performance.now() < budgetEnd) {
      const keys = this.nextKeys();
      if (keys === null) break;
      this.run.runFrame(keys);
      this.atlas.onFrame();
      ran++;
    }
    if (this.speed !== "max") this.credit -= ran;
    this.fpsWindow.frames += ran;
    if (now - this.fpsWindow.start >= 1000) {
      this.fpsWindow.value = Math.round((this.fpsWindow.frames * 1000) / (now - this.fpsWindow.start));
      this.fpsWindow = { start: now, frames: 0, value: this.fpsWindow.value };
    }
    return ran;
  }

  get fps(): number {
    return this.fpsWindow.value;
  }
}

const run = await Run.open();
const live = new LivePlay(run);
// The Run of the Viewer is one of the emulators.
const pool = new RunPool(MAX_RUNS - 1);

/** What the Viewer sends of the Run that it shows. */
type RunSource = {
  frame(): number;
  screen(): Uint8Array | null;
  state(): RunState;
  camera(): Camera | null;
  events(): readonly RunEvent[];
  sight(): Sight;
  summary(): ShownRun;
};

const viewerRun: RunSource = {
  frame: () => run.frame,
  screen: () => run.core.screen(),
  state: () => run.readState(),
  camera: () => safely(() => run.game.camera()),
  events: () => live.replay?.player.played() ?? [],
  sight: () => live.sight(),
  summary: () => ({ kind: "viewer", replay: live.replay && replayStatus(live.replay) }),
};

function botRun(poolRun: PoolRun): RunSource {
  return {
    frame: () => poolRun.view.frame,
    screen: () => poolRun.view.screen,
    state: () => poolRun.view,
    camera: () => poolRun.view.camera,
    events: () => poolRun.events,
    sight: () => poolRun.view.sight,
    summary: () => ({ kind: "bot", run: runSummary(poolRun) }),
  };
}

let shown = viewerRun;
// The keyboard, the speeds, pause, the savestate and the Starting save act on the Run of the Viewer only.
const VIEWER_RUN_MESSAGES = new Set<ClientMessage["type"]>(["keys", "speed", "pause", "audio-level", "quick-save", "quick-load", "reset", "write-start-save", "end-replay"]);
const clients = new Set<ServerWebSocket<unknown>>();
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
    },
    to,
  );
}

/** True when one save slot has all its sectors (the game writes them over several frames). */
function hasCompleteSlot(save: Uint8Array): boolean {
  const SECTOR_SIZE = 0x1000;
  const SECTORS_PER_SLOT = 14;
  const view = new DataView(save.buffer, save.byteOffset, save.byteLength);
  for (let slot = 0; slot < 2; slot++) {
    const ids = new Set<number>();
    const counters = new Set<number>();
    for (let i = 0; i < SECTORS_PER_SLOT; i++) {
      const base = (slot * SECTORS_PER_SLOT + i) * SECTOR_SIZE;
      if (base + SECTOR_SIZE > save.length || view.getUint32(base + 0xff8, true) !== 0x08012025) break;
      ids.add(view.getUint16(base + 0xff4, true));
      counters.add(view.getUint32(base + 0xffc, true));
    }
    if (ids.size === SECTORS_PER_SLOT && counters.size === 1) return true;
  }
  return false;
}

async function writeStartSave(): Promise<string> {
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

function replayStatus({ name, player }: Replay): ReplayStatus {
  return { name, endReason: player.result.endReason, frames: player.frames, ended: player.ended, model: replayModel(player) };
}

function replayModel(player: RecordPlayer): ReplayModel | null {
  const settings = player.header.bot.model;
  if (!settings) return null;
  const played = modelTotals(player.played());
  const total = player.modelTotals;
  // A Run record from before the starter option has none: its model chose freely.
  const starter = settings.starter ?? DEFAULT_STARTER;
  return { id: settings.id, costLimit: settings.costLimit, reasoning: settings.reasoning, starter, calls: played.calls, cost: played.cost, totalCalls: total.calls, totalCost: total.cost };
}

async function replayFile(name: string): Promise<string> {
  if (!(await recordNames()).includes(name)) return `No Run record ${name} in lab/runs/.`;
  const record = readRecord(await Bun.file(join(RUNS_DIR, name)).json().catch(() => null));
  if (!record) return `${name} is not a Run record.`;
  const differences = await live.startReplay(name, record);
  show(viewerRun);
  if (differences.length > 0) {
    return `${name} does not replay here (different ${differences.join(", ")}). The Run starts again from the Starting save, and the keyboard plays it.`;
  }
  return `Replay of ${name}.`;
}

function runSummary({ id, spec, end, events, modelCallsStarted, stopAsked }: PoolRun): RunSummary {
  return {
    id,
    bot: spec.bot,
    parent: spec.parent ?? null,
    playing: end === null,
    stopAsked,
    endReason: end?.record?.result.endReason ?? null,
    error: end?.error ?? null,
    model: spec.model ? { id: spec.model.id, costLimit: spec.model.costLimit, reasoning: spec.model.reasoning, starter: spec.model.starter, cost: modelTotals(events).cost, callsStarted: modelCallsStarted } : null,
  };
}

function show(next: RunSource): void {
  shown = next;
  live.keys = 0;
  live.rateTrim = 1;
  screenFrame = null;
  sendEvents();
  sendMap(shown.state());
  sendSight();
}

async function startBot(name: string, given: ModelOptions, parent?: string): Promise<string> {
  if (!(await botNames()).includes(name)) return `No Bot ${name} in lab/bots/.`;
  if (parent !== undefined && !(await recordNames()).includes(parent)) return `No Run record ${parent} in lab/runs/.`;
  if (pool.full) return `No new Run: ${pool.limit} Runs of Bots play now (${MAX_RUNS} emulators at most, with the Viewer Run).`;
  let bot: Bot;
  try {
    bot = await loadBot(name, given);
  } catch (error) {
    return `No Run: ${errorText(error)}.`;
  }
  const { model } = bot;
  const started = pool.start({ bot: name, ...(model ? { model } : {}), ...(parent === undefined ? {} : { parent }) });
  show(botRun(started));
  void started.done.then((end) => onBotEnd(started, end));
  const from = parent === undefined ? "" : ` from the end of ${parent}`;
  return `Run ${started.id}: the Bot ${name} plays${from}${model ? ` with the model ${model.id} (limit ${model.costLimit} $)` : ""}.`;
}

async function onBotEnd({ id, spec }: PoolRun, { record, error }: RunEnd): Promise<void> {
  const failure = error ? ` · error: ${error}` : "";
  try {
    const end = record ? `end: ${record.result.endReason}, Run record runs/${basename(await writeRecord(record))}` : "no Run record";
    send({ type: "notice", text: `Run ${id} (${spec.bot}): ${end}${failure}.` });
    send({ type: "records", names: await recordNames() });
  } catch (writeError) {
    send({ type: "notice", text: `Run ${id} (${spec.bot}): the Run record is not written (${writeError})${failure}.` });
  }
  await sendStatus();
}

let eventsSent = 0;

function sendEvents(to?: ServerWebSocket<unknown>): void {
  const events = [...shown.events()];
  if (!to) eventsSent = events.length;
  send({ type: "events", events }, to);
}

function sendNewEvents(): void {
  if (shown.events().length !== eventsSent) sendEvents();
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
      live.quickState = run.core.saveState();
      send({ type: "notice", text: "Savestate kept (in memory)." });
      break;
    case "quick-load":
      if (live.replay) {
        send({ type: "notice", text: "No load of the savestate during a replay." }, ws);
      } else if (live.quickState && run.core.loadState(live.quickState)) {
        live.resyncClock();
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
    case "start-bot":
      send({ type: "notice", text: await startBot(message.name, message.model, message.parent) });
      break;
    case "stop-run": {
      const poolRun = pool.runs.find((r) => r.id === message.runId);
      if (!poolRun || poolRun.end) break;
      poolRun.stop();
      send({ type: "notice", text: `Run ${poolRun.id}: stop asked. The Run stops after the action or the Model call that plays.` });
      break;
    }
    case "show": {
      const poolRun = pool.runs.find((r) => r.id === message.runId);
      show(poolRun ? botRun(poolRun) : viewerRun);
      break;
    }
  }
  await sendStatus();
}

const screenMessage = new Uint8Array(1 + run.core.width * run.core.height * 4);
screenMessage[0] = BinaryKind.Screen;

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

let lastScreen = 0;
/** The frame of the last screen sent; null: send the next screen. */
let screenFrame: number | null = null;
let lastState = 0;
/** The grid only when it changed; the actors each time. */
function sendMap({ grid, actors }: RunState, to?: ServerWebSocket<unknown>): void {
  sendChanged({ type: "map", grid }, to);
  send({ type: "actors", actors }, to);
}

function loop(): void {
  const now = performance.now();
  const ran = live.tick(now);
  if (ran > 0 && live.audioActive) sendAudio();
  sendNewEvents();
  const frame = shown.frame();
  const screen = clients.size > 0 && frame !== screenFrame && now - lastScreen >= SCREEN_INTERVAL_MS ? shown.screen() : null;
  if (screen) {
    lastScreen = now;
    screenFrame = frame;
    screenMessage.set(screen, 1);
    for (const ws of clients) ws.send(screenMessage);
    if (live.overlay) send({ type: "camera", camera: shown.camera() });
  }
  if (clients.size > 0 && now - lastState >= STATE_INTERVAL_MS) {
    lastState = now;
    const runState = shown.state();
    if (runState.state) send({ type: "state", state: runState.state });
    sendMap(runState);
    sendSight();
    // The whole-map view shows the screen area; the overlay gets the camera with each screen too.
    send({ type: "camera", camera: runState.camera });
    void sendStatus();
  }
  setTimeout(loop, live.speed === "max" && !live.paused ? 0 : 2);
}

Bun.serve({
  port: PORT,
  development: true,
  routes: { "/": viewerPage },
  fetch(req, server) {
    if (new URL(req.url).pathname === "/ws" && server.upgrade(req)) return;
    return new Response("Not found", { status: 404 });
  },
  websocket: {
    open(ws) {
      clients.add(ws);
      void sendStatus(ws);
      send({ type: "maps", names: run.game.allMapNames }, ws);
      void recordNames().then((names) => send({ type: "records", names }, ws));
      void botInfos().then((bots) => send({ type: "bots", bots }, ws));
      sendEvents(ws);
      sendMap(shown.state(), ws);
      sendSight(ws);
    },
    close(ws) {
      clients.delete(ws);
      setAudioClient(ws, false);
      if (clients.size === 0) live.keys = 0;
    },
    message(ws, data) {
      if (typeof data !== "string") return;
      void handle(JSON.parse(data) as ClientMessage, ws);
    },
  },
});

console.log(`Viewer: http://localhost:${PORT}  (ROM ${ROM_NAME})`);
loop();
