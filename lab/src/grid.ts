import type { PoolReplay, RunPool } from "./harness/pool";
import { factsAt, limitOf, RecordPlayer, type RunRecord } from "./harness/record";
import { spentIn } from "./protocol";
import { GBA_FPS, type GridCursor, type GridCursorControl, type GridReplay, type GridSpeed } from "./protocol";

type Cell = { name: string; replay: PoolReplay; frames: number };

export class GridPlay {
  readonly #cells = new Map<number, Cell>();
  #frame = 0;
  #paused = false;
  #speed: GridSpeed = 1;
  #lastTick = performance.now();

  constructor(private readonly pool: RunPool) {}

  add(cell: number, name: string, record: RunRecord): boolean {
    const old = this.#cells.get(cell);
    if (!old && this.pool.free === 0) return false;
    old?.replay.stop();
    const replay = this.pool.replay(record);
    replay.seek(Math.floor(this.#frame));
    this.#cells.set(cell, { name, replay, frames: new RecordPlayer(record).frames });
    return true;
  }

  remove(cell: number): void {
    this.#cells.get(cell)?.replay.stop();
    this.#cells.delete(cell);
    if (this.#cells.size === 0) this.#paused = false;
    this.#frame = Math.min(this.#frame, this.#end);
  }

  clear(): void {
    for (const cell of [...this.#cells.keys()]) this.remove(cell);
  }

  get #end(): number {
    return Math.max(0, ...[...this.#cells.values()].map((cell) => cell.frames));
  }

  control({ paused, speed, frame }: GridCursorControl): void {
    if (speed !== undefined) this.#speed = speed;
    if (frame !== undefined) this.#frame = Math.max(0, Math.min(Math.round(frame), this.#end));
    if (paused === false && this.#frame >= this.#end) this.#frame = 0;
    if (paused !== undefined) this.#paused = paused;
    this.#follow();
  }

  tick(now: number): void {
    const elapsed = now - this.#lastTick;
    this.#lastTick = now;
    if (this.#paused || this.#cells.size === 0) return;
    this.#frame = Math.min(this.#end, this.#frame + (elapsed / 1000) * GBA_FPS * this.#speed);
    if (this.#frame >= this.#end) this.#paused = true;
    this.#follow();
  }

  #follow(): void {
    for (const { replay } of this.#cells.values()) replay.seek(Math.floor(this.#frame));
  }

  status(): { cursor: GridCursor; replays: GridReplay[] } {
    const replays = [...this.#cells].map(([cell, { name, replay, frames }]): GridReplay => {
      const { header, result, events } = replay.record;
      const { frame } = replay.view;
      const { milestone, battle, totals } = factsAt(events, frame);
      const unit = header.bot.model && limitOf(header.bot.model).unit;
      return { id: replay.id, cell, name, bot: header.bot.name, model: header.bot.model?.id ?? null, frames, frame, endReason: result.endReason, error: replay.error, milestone, battle, spent: unit ? { unit, amount: spentIn(unit, totals) } : null };
    });
    return { cursor: { frame: Math.floor(this.#frame), paused: this.#paused, speed: this.#speed, end: this.#end }, replays };
  }
}
