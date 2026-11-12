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
  readonly #romSeed: number;

  private constructor(
    readonly core: Core,
    readonly game: Game,
    origin: RunOrigin,
    readonly startSavePath: string,
  ) {
    this.#origin = origin;
    this.#romSeed = origin.seed;
  }

  static async open({ startSave = START_SAVE, names = null, seed }: { startSave?: string; names?: TrainerNames | null; seed?: number } = {}): Promise<Run> {
    if (!(await Bun.file(ROM_FILE).exists())) throw new Error(`${ROM_FILE} not found: run "make lab" at the repo root`);
    const core = await Core.open(ROM_FILE);
    const mem = new Memory(core, await loadSymbols(join(REPO_DIR, `${ROM_NAME}.elf`), CACHE_DIR));
    const run = new Run(core, await Game.create(mem), { rom: await romHash(mem), seed: mem.global("gLabRngSeed").int(), startSave: null, names: null }, startSave);
    try {
      await run.reset(names, seed);
    } catch (error) {
      core.close();
      throw error;
    }
    return run;
  }

  async reset(names: TrainerNames | null = null, seed = this.#romSeed): Promise<void> {
    const file = Bun.file(this.startSavePath);
    this.boot((await file.exists()) ? new Uint8Array(await file.arrayBuffer()) : null, names, seed);
  }

  // The bytes of the last boot, not the file: a person can write the file while a Model call waits.
  rename(names: TrainerNames, holds: readonly (readonly [number, number])[]): void {
    this.boot(this.#save, names, this.#origin.seed);
    for (const [keys, frames] of holds) for (let i = 0; i < frames; i++) this.runFrame(keys);
  }

  // The game reads gLabRngSeed from the ROM at boot, and a patch of the ROM image stays after a reset in this core.
  private boot(save: Uint8Array | null, names: TrainerNames | null, seed: number): void {
    if (names && !save) throw new Error("no Starting save to write the names in");
    if (!Number.isInteger(seed) || seed < 0 || seed > 0xffff) throw new Error(`the seed ${seed} is not a whole number from 0 to 0xffff`);
    const played = save && names ? this.game.namedSave(save, names) : save;
    const seedGlobal = this.game.mem.global("gLabRngSeed");
    this.core.patch16(seedGlobal.addr, seed);
    this.core.reset();
    if (played) this.core.loadSaveData(played);
    this.#save = save;
    this.#origin = { ...this.#origin, seed: seedGlobal.int(), startSave: save && sha256(save), names };
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
