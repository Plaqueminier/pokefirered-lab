import { join } from "node:path";
import { CACHE_DIR, Core } from "./core";
import { Game } from "./game";
import { Memory } from "./memory";
import { loadSymbols } from "./symbols";

const REPO_DIR = join(import.meta.dir, "..", "..");
export const SAVES_DIR = join(import.meta.dir, "..", "saves");
export const START_SAVE = join(SAVES_DIR, "start.sav");
export const ROM_NAME = process.env.LAB_ROM ?? "pokefirered_modern_lab";
export const ROM_FILE = join(REPO_DIR, `${ROM_NAME}.gba`);

export class Run {
  private constructor(
    readonly core: Core,
    readonly game: Game,
  ) {}

  static async open(): Promise<Run> {
    if (!(await Bun.file(ROM_FILE).exists())) throw new Error(`${ROM_FILE} not found: run "make lab" at the repo root`);
    const core = await Core.open(ROM_FILE);
    const mem = new Memory(core, await loadSymbols(join(REPO_DIR, `${ROM_NAME}.elf`), CACHE_DIR));
    const run = new Run(core, await Game.create(mem));
    await run.reset();
    return run;
  }

  async reset(): Promise<void> {
    this.core.reset();
    const save = Bun.file(START_SAVE);
    if (await save.exists()) this.core.loadSaveData(new Uint8Array(await save.arrayBuffer()));
    this.core.reset();
  }

  /** Frames since the Starting save: the emulator counter restarts at 0 on reset. */
  get frame(): number {
    return this.core.frameCounter;
  }

  runFrame(keys: number): void {
    this.core.setKeys(keys);
    this.core.runFrame();
  }

  screenHash(): string {
    return new Bun.CryptoHasher("sha256").update(this.core.screen()).digest("hex").slice(0, 16);
  }
}
