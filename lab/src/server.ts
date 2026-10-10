// Harness with one Run, and the Viewer page on http://localhost:8766.
// Usage: bun run viewer   (ROM: LAB_ROM=pokefirered_modern_lab by default)
import { mkdir, rename } from "node:fs/promises";
import { join } from "node:path";
import type { ServerWebSocket } from "bun";
import viewerPage from "../viewer/index.html";
import { CACHE_DIR, Core } from "./core";
import { Game, type MapGrid } from "./game";
import { Memory } from "./memory";
import { BinaryKind, type ClientMessage, type ServerMessage, type Speed } from "./protocol";
import { loadSymbols } from "./symbols";

const PORT = 8766;
const REPO_DIR = join(import.meta.dir, "..", "..");
const SAVES_DIR = join(import.meta.dir, "..", "saves");
const START_SAVE = join(SAVES_DIR, "start.sav");
const ROM_NAME = process.env.LAB_ROM ?? "pokefirered_modern_lab";
const GBA_FPS = 16777216 / 280896; // 59.7275
const SCREEN_INTERVAL_MS = 1000 / 60;
const STATE_INTERVAL_MS = 100;
const AUDIO_RATE = 48000;
// The Viewer keeps this much audio queued; the Run speed is trimmed to hold it there.
const AUDIO_TARGET_MS = 60;

class Run {
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

  private constructor(
    readonly core: Core,
    readonly game: Game,
  ) {}

  static async open(rom: string): Promise<Run> {
    const gba = join(REPO_DIR, `${rom}.gba`);
    const elf = join(REPO_DIR, `${rom}.elf`);
    if (!(await Bun.file(gba).exists())) throw new Error(`${gba} not found: run "make lab" at the repo root`);
    const core = await Core.open(gba);
    const mem = new Memory(core, await loadSymbols(elf, CACHE_DIR));
    const run = new Run(core, await Game.create(mem));
    await run.reset();
    return run;
  }

  /** Restarts the game from the Starting save (or from an empty save). */
  async reset(): Promise<void> {
    this.core.reset();
    const save = Bun.file(START_SAVE);
    if (await save.exists()) this.core.loadSaveData(new Uint8Array(await save.arrayBuffer()));
    this.core.reset();
    this.resyncClock();
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
    this.core.enableAudio(this.audioOn, AUDIO_RATE);
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
    this.core.setKeys(this.keys);
    while (ran < due && performance.now() < budgetEnd) {
      this.core.runFrame();
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

const run = await Run.open(ROM_NAME);
const clients = new Set<ServerWebSocket<unknown>>();
const audioClients = new Set<ServerWebSocket<unknown>>();

function setAudioClient(ws: ServerWebSocket<unknown>, enabled: boolean): void {
  if (enabled) audioClients.add(ws);
  else audioClients.delete(ws);
  run.audioWanted = audioClients.size > 0;
  run.syncAudio();
}

function send(message: ServerMessage, to?: ServerWebSocket<unknown>): void {
  const text = JSON.stringify(message);
  for (const ws of to ? [to] : clients) ws.send(text);
}

async function sendStatus(to?: ServerWebSocket<unknown>): Promise<void> {
  send(
    {
      type: "status",
      rom: ROM_NAME,
      speed: run.speed,
      paused: run.paused,
      fps: run.fps,
      frame: run.core.frameCounter,
      hasQuickState: run.quickState !== null,
      hasStartSave: await Bun.file(START_SAVE).exists(),
      audio: run.audioActive,
    },
    to,
  );
}

/** Reads game memory; returns null while the game is in a state where the reads fail (boot, transitions). */
function safely<T>(read: () => T): T | null {
  try {
    return read();
  } catch {
    return null;
  }
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
    return "Pas de sauvegarde complète. Sauvegardez dans le jeu et attendez le message de fin, puis recommencez.";
  }
  await mkdir(SAVES_DIR, { recursive: true });
  // Keep the previous Starting save instead of overwriting it.
  if (await Bun.file(START_SAVE).exists()) {
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    await rename(START_SAVE, join(SAVES_DIR, `start-${stamp}.sav`));
  }
  await Bun.write(START_SAVE, save);
  return "Sauvegarde de départ écrite dans lab/saves/start.sav (l'ancienne est gardée à côté).";
}

async function handle(message: ClientMessage, ws: ServerWebSocket<unknown>): Promise<void> {
  switch (message.type) {
    case "keys":
      run.keys = message.keys;
      break;
    case "speed":
      run.speed = message.speed;
      run.resyncClock();
      run.syncAudio();
      break;
    case "pause":
      run.paused = message.paused;
      run.resyncClock();
      run.syncAudio();
      break;
    case "audio":
      setAudioClient(ws, message.enabled);
      break;
    case "view-map": {
      const grid = safely(() => run.game.gridOf(message.group, message.num));
      send({ type: "preview", grid, actors: grid ? safely(() => run.game.actorsOf(grid)) : null }, ws);
      return;
    }
    case "audio-level": {
      // Queue too long: run a little slower, and the reverse. At most 1% off.
      const error = AUDIO_TARGET_MS - message.ms;
      run.rateTrim = 1 + Math.max(-0.01, Math.min(0.01, error * 0.0005));
      return;
    }
    case "overlay":
      run.overlay = message.enabled;
      send({ type: "camera", camera: safely(() => run.game.camera()) }, ws);
      break;
    case "quick-save":
      run.quickState = run.core.saveState();
      send({ type: "notice", text: "Savestate gardé (en mémoire)." });
      break;
    case "quick-load":
      if (run.quickState && run.core.loadState(run.quickState)) {
        run.resyncClock();
        send({ type: "notice", text: "Retour au savestate." });
      }
      break;
    case "reset":
      await run.reset();
      send({ type: "notice", text: "Run relancée depuis la sauvegarde de départ." });
      break;
    case "write-start-save":
      send({ type: "notice", text: await writeStartSave() });
      break;
  }
  await sendStatus();
}

const screenMessage = new Uint8Array(1 + run.core.width * run.core.height * 4);
screenMessage[0] = BinaryKind.Screen;

/** Audio message: 2 header bytes (kind, 0) so the 16-bit samples stay aligned. */
function sendAudio(): void {
  const samples = run.core.readAudio();
  if (samples.length === 0) return;
  const message = new Uint8Array(2 + samples.byteLength);
  message[0] = BinaryKind.Audio;
  message.set(new Uint8Array(samples.buffer, samples.byteOffset, samples.byteLength), 2);
  for (const ws of audioClients) ws.send(message);
}
let lastScreen = 0;
let lastState = 0;
let lastGrid: MapGrid | null = null;
let lastGridJson = "";

/** The grid only when it changed; the actors each time. */
function sendMap(to?: ServerWebSocket<unknown>): void {
  const grid = safely(() => run.game.grid());
  const json = JSON.stringify(grid);
  if (to || json !== lastGridJson) {
    lastGridJson = json;
    lastGrid = grid;
    for (const ws of to ? [to] : clients) ws.send(`{"type":"map","grid":${json}}`);
  }
  const current = lastGrid;
  send({ type: "actors", actors: current ? safely(() => run.game.actors(current)) : null }, to);
}

function loop(): void {
  const now = performance.now();
  const ran = run.tick(now);
  if (ran > 0 && run.audioActive) sendAudio();
  if (clients.size > 0 && ran > 0 && now - lastScreen >= SCREEN_INTERVAL_MS) {
    lastScreen = now;
    screenMessage.set(run.core.screen(), 1);
    for (const ws of clients) ws.send(screenMessage);
    if (run.overlay) send({ type: "camera", camera: safely(() => run.game.camera()) });
  }
  if (clients.size > 0 && now - lastState >= STATE_INTERVAL_MS) {
    lastState = now;
    const state = safely(() => run.game.state());
    if (state) send({ type: "state", state });
    sendMap();
    // The whole-map view shows the screen area; the overlay gets the camera with each screen too.
    send({ type: "camera", camera: safely(() => run.game.camera()) });
    void sendStatus();
  }
  setTimeout(loop, run.speed === "max" && !run.paused ? 0 : 2);
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
      sendMap(ws);
    },
    close(ws) {
      clients.delete(ws);
      setAudioClient(ws, false);
      if (clients.size === 0) run.keys = 0;
    },
    message(ws, data) {
      if (typeof data !== "string") return;
      void handle(JSON.parse(data) as ClientMessage, ws);
    },
  },
});

console.log(`Viewer: http://localhost:${PORT}  (ROM ${ROM_NAME})`);
loop();
