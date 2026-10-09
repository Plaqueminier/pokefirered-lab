// Harness with one Run, and the Viewer page on http://localhost:8766.
// Usage: bun run viewer   (ROM: LAB_ROM=pokefirered_modern_lab by default)
import { mkdir, rename } from "node:fs/promises";
import { join } from "node:path";
import type { ServerWebSocket } from "bun";
import viewerPage from "../viewer/index.html";
import { CACHE_DIR, Core } from "./core";
import { Game } from "./game";
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

class Run {
  keys = 0;
  speed: Speed = 1;
  paused = false;
  overlay = false;
  quickState: Uint8Array | null = null;
  private clockStart = 0;
  private clockFrames = 0;
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
    this.clockStart = performance.now();
    this.clockFrames = 0;
  }

  /** Runs the frames that are due now. Returns the number of frames run. */
  tick(now: number): number {
    if (this.paused) return 0;
    let due: number;
    if (this.speed === "max") {
      due = Number.POSITIVE_INFINITY;
    } else {
      due = Math.floor(((now - this.clockStart) / 1000) * GBA_FPS * this.speed) - this.clockFrames;
      // Too far behind (for example after a pause): do not try to catch up.
      if (due > 20) {
        this.resyncClock();
        due = 1;
      }
    }
    const budgetEnd = now + 12;
    let ran = 0;
    this.core.setKeys(this.keys);
    while (ran < due && performance.now() < budgetEnd) {
      this.core.runFrame();
      ran++;
    }
    this.clockFrames += ran;
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
      break;
    case "pause":
      run.paused = message.paused;
      run.resyncClock();
      break;
    case "overlay":
      run.overlay = message.enabled;
      if (!run.overlay) send({ type: "overlay", overlay: null }, ws);
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
let lastScreen = 0;
let lastState = 0;

function loop(): void {
  const now = performance.now();
  const ran = run.tick(now);
  if (clients.size > 0 && ran > 0 && now - lastScreen >= SCREEN_INTERVAL_MS) {
    lastScreen = now;
    screenMessage.set(run.core.screen(), 1);
    for (const ws of clients) ws.send(screenMessage);
    if (run.overlay) send({ type: "overlay", overlay: safely(() => run.game.overlay()) });
  }
  if (clients.size > 0 && now - lastState >= STATE_INTERVAL_MS) {
    lastState = now;
    const state = safely(() => run.game.state());
    if (state) send({ type: "state", state });
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
    },
    close(ws) {
      clients.delete(ws);
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
