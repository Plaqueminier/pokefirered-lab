import type { Milestone } from "../src/game";
import type { GridReplay, GridSize, RunSummary, Spend } from "../src/protocol";
import type { TrainerNames } from "../src/save-file";

export type CellState = { kind: "plays" } | { kind: "waits" } | { kind: "battle" } | { kind: "ended"; result: string };

export type GridCell = {
  kind: "live" | "replay";
  runId: number;
  name: string;
  bot: string;
  model: string | null;
  frame: number;
  milestone: Milestone | null;
  spent: Spend | null;
  state: CellState;
  record: string | null;
  names: TrainerNames | null;
};

function liveState(run: RunSummary): CellState {
  if (!run.playing) return { kind: "ended", result: run.error ? `error: ${run.error}` : (run.endReason ?? "unknown") };
  if (run.waits) return { kind: "waits" };
  return run.battle ? { kind: "battle" } : { kind: "plays" };
}

function liveCell(run: RunSummary): GridCell {
  const { id, bot, model, frame, milestone, record, names } = run;
  return { kind: "live", runId: id, name: `Run ${id}`, bot, model: model?.id ?? null, frame, milestone, spent: model?.spent ?? null, state: liveState(run), record, names };
}

function replayCell(replay: GridReplay, cursor: number): GridCell {
  const { id, name, bot, model, frame, milestone, spent, battle, endReason, error, frames, names } = replay;
  const state: CellState = error ? { kind: "ended", result: `error: ${error}` } : cursor >= frames ? { kind: "ended", result: endReason } : battle ? { kind: "battle" } : { kind: "plays" };
  return { kind: "replay", runId: id, name, bot, model, frame, milestone, spent, state, record: name, names };
}

// The Runs that play come before the ended ones, so a small Grid shows what plays now.
export function gridCells(size: GridSize, runs: readonly RunSummary[], replays: readonly GridReplay[], cursor: number): (GridCell | null)[] {
  const cells: (GridCell | null)[] = Array.from({ length: size }, () => null);
  for (const replay of replays) if (replay.cell < size) cells[replay.cell] = replayCell(replay, cursor);
  const replayed = new Set(replays.map((replay) => replay.name));
  const shown = runs.filter((run) => run.record === null || !replayed.has(run.record));
  const ordered = shown.sort((a, b) => Number(b.playing) - Number(a.playing) || a.id - b.id);
  let next = 0;
  for (const run of ordered) {
    while (next < size && cells[next] !== null) next++;
    if (next === size) break;
    cells[next] = liveCell(run);
  }
  return cells;
}
