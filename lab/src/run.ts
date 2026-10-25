import { join } from "node:path";
import { CACHE_DIR, Core } from "./core";
import { type Camera, Game, type GameState, type MapActors, type MapGrid, safely } from "./game";
import { Memory } from "./memory";
import { loadSymbols } from "./symbols";

const REPO_DIR = join(import.meta.dir, "..", "..");
export const SAVES_DIR = join(import.meta.dir, "..", "saves");
export const START_SAVE = join(SAVES_DIR, "start.sav");
export const ROM_NAME = process.env.LAB_ROM ?? "pokefirered_modern_lab";
export const ROM_FILE = join(REPO_DIR, `${ROM_NAME}.gba`);
const ROM_ADDRESS = 0x08000000;

export type RunOrigin = { rom: string; seed: number; startSave: string | null };

export type RunState = { state: GameState | null; grid: MapGrid | null; actors: MapActors | null; camera: Camera | null };

export class Run {
  #origin: RunOrigin;

  private constructor(
    readonly core: Core,
    readonly game: Game,
    origin: RunOrigin,
    readonly startSavePath: string,
  ) {
    this.#origin = origin;
  }

  static async open(startSavePath = START_SAVE): Promise<Run> {
    if (!(await Bun.file(ROM_FILE).exists())) throw new Error(`${ROM_FILE} not found: run "make lab" at the repo root`);
    const core = await Core.open(ROM_FILE);
    const mem = new Memory(core, await loadSymbols(join(REPO_DIR, `${ROM_NAME}.elf`), CACHE_DIR));
    const run = new Run(core, await Game.create(mem), { rom: await romHash(mem), seed: mem.global("gLabRngSeed").int(), startSave: null }, startSavePath);
    await run.reset();
    return run;
  }

  async reset(): Promise<void> {
    this.core.reset();
    const save = Bun.file(this.startSavePath);
    const data = (await save.exists()) ? new Uint8Array(await save.arrayBuffer()) : null;
    if (data) this.core.loadSaveData(data);
    this.#origin = { ...this.#origin, startSave: data && sha256(data) };
    this.core.reset();
  }

  get origin(): RunOrigin {
    return this.#origin;
  }

  /** Frames since the Starting save: the emulator counter restarts at 0 on reset. */
  get frame(): number {
    return this.core.frameCounter;
  }

  runFrame(keys: number): void {
    this.core.setKeys(keys);
    this.core.runFrame();
  }

  readState(): RunState {
    const { game } = this;
    const grid = safely(() => game.grid());
    return { state: safely(() => game.state()), grid, actors: grid && safely(() => game.actors(grid)), camera: safely(() => game.camera()) };
  }

  screenHash(): string {
    return sha256(this.core.screen()).slice(0, 16);
  }
}

// BuildDateTime changes on each build: at zero, a rebuild of the same code keeps the hash.
async function romHash(mem: Memory): Promise<string> {
  const rom = new Uint8Array(await Bun.file(ROM_FILE).arrayBuffer());
  const date = mem.global("BuildDateTime");
  const offset = date.addr - ROM_ADDRESS;
  rom.fill(0, offset, offset + mem.sizeOf(date.typeId));
  return sha256(rom);
}

function sha256(data: Uint8Array): string {
  return new Bun.CryptoHasher("sha256").update(data).digest("hex");
}
