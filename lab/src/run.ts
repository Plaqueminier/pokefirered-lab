import { join } from "node:path";
import { CACHE_DIR, Core } from "./core";
import { type Camera, Game, type GameState, type MapActors, type MapGrid, safely } from "./game";
import { Memory } from "./memory";
import type { TrainerNames } from "./save-file";
import { loadSymbols } from "./symbols";

const REPO_DIR = join(import.meta.dir, "..", "..");
export const SAVES_DIR = join(import.meta.dir, "..", "saves");
export const START_SAVE = join(SAVES_DIR, "start.sav");
export const ROM_NAME = process.env.LAB_ROM ?? "pokefirered_modern_lab";
export const ROM_FILE = join(REPO_DIR, `${ROM_NAME}.gba`);
const ROM_ADDRESS = 0x08000000;

export type RunOrigin = { rom: string; seed: number; startSave: string | null; names: TrainerNames | null };

export type RunState = { state: GameState | null; grid: MapGrid | null; actors: MapActors | null; camera: Camera | null };

export class Run {
  #origin: RunOrigin;
  #save: Uint8Array | null = null;

  private constructor(
    readonly core: Core,
    readonly game: Game,
    origin: RunOrigin,
    readonly startSavePath: string,
  ) {
    this.#origin = origin;
  }

  static async open({ startSave = START_SAVE, names = null }: { startSave?: string; names?: TrainerNames | null } = {}): Promise<Run> {
    if (!(await Bun.file(ROM_FILE).exists())) throw new Error(`${ROM_FILE} not found: run "make lab" at the repo root`);
    const core = await Core.open(ROM_FILE);
    const mem = new Memory(core, await loadSymbols(join(REPO_DIR, `${ROM_NAME}.elf`), CACHE_DIR));
    const run = new Run(core, await Game.create(mem), { rom: await romHash(mem), seed: mem.global("gLabRngSeed").int(), startSave: null, names: null }, startSave);
    try {
      await run.reset(names);
    } catch (error) {
      core.close();
      throw error;
    }
    return run;
  }

  async reset(names: TrainerNames | null = null): Promise<void> {
    const file = Bun.file(this.startSavePath);
    this.boot((await file.exists()) ? new Uint8Array(await file.arrayBuffer()) : null, names);
  }

  // The bytes of the last boot, not the file: a person can write the file while a Model call waits.
  rename(names: TrainerNames, holds: readonly (readonly [number, number])[]): void {
    this.boot(this.#save, names);
    for (const [keys, frames] of holds) for (let i = 0; i < frames; i++) this.runFrame(keys);
  }

  private boot(save: Uint8Array | null, names: TrainerNames | null): void {
    if (names && !save) throw new Error("no Starting save to write the names in");
    const played = save && names ? this.game.namedSave(save, names) : save;
    this.core.reset();
    if (played) this.core.loadSaveData(played);
    this.#save = save;
    this.#origin = { ...this.#origin, startSave: save && sha256(save), names };
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
    return screenHash(this.core.screen());
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

export function screenHash(screen: Uint8Array): string {
  return sha256(screen).slice(0, 16);
}
