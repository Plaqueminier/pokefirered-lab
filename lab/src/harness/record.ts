// The buttons alone replay a Run: the game reads no input while it is frozen (docs/adr/0002).
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import type { Game, Milestone } from "../game";
import { Run, type RunOrigin } from "../run";
import type { ActionEntry, Bot, KnowledgeLevel, RunResult } from "./harness";

const RUNS_DIR = join(import.meta.dir, "..", "..", "runs");

export type ButtonHold = [keys: number, frames: number];

export type GameEvent = { frame: number } & (
  | { type: "map"; map: string }
  | { type: "battle"; state: "start" | "end" }
  | { type: "milestone"; milestone: Milestone }
);

export type RunEvent = GameEvent | ({ type: "action"; frame: number } & ActionEntry) | { type: "model"; frame: number; text: string };

export type RunHeader = RunOrigin & { knowledge: KnowledgeLevel; bot: Pick<Bot, "name" | "version"> };

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
  #cells = new Set<string>();

  constructor(private readonly game: Game) {}

  /** It increases with each new cell of the player and each new Milestone. */
  get progress(): number {
    return this.#cells.size + this.#milestones.size;
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
    this.#map = map;
    const player = mode === "overworld" ? this.game.player() : null;
    if (player) this.#cells.add(`${map} ${player.x} ${player.y}`);
    for (const milestone of this.game.milestones()) {
      if (this.#milestones.has(milestone)) continue;
      this.#milestones.add(milestone);
      events.push({ frame, type: "milestone", milestone });
    }
    return events;
  }
}

export type Replay = { events: GameEvent[]; frame: number; screen: string };

export async function replay(record: RunRecord): Promise<Replay> {
  const run = await Run.open();
  try {
    const differences = (Object.keys(run.origin) as (keyof RunOrigin)[]).filter((key) => run.origin[key] !== record.header[key]);
    if (differences.length > 0) throw new Error(`the Run record does not replay here: different ${differences.join(", ")}`);
    const watch = new GameWatch(run.game);
    const events: GameEvent[] = [];
    for (const [keys, frames] of record.buttons) {
      for (let i = 0; i < frames; i++) {
        run.runFrame(keys);
        events.push(...watch.onFrame(run.frame));
      }
    }
    return { events, frame: run.frame, screen: run.screenHash() };
  } finally {
    run.core.close();
  }
}

export async function writeRecord(record: RunRecord): Promise<string> {
  await mkdir(RUNS_DIR, { recursive: true });
  const { name, version } = record.header.bot;
  const path = join(RUNS_DIR, `${name}-${version}-${new Date().toISOString().replaceAll(":", "-")}.json`);
  await Bun.write(path, JSON.stringify(record));
  return path;
}
