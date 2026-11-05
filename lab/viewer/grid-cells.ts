import type { Milestone } from "../src/game";
import type { GridReplay, GridSize, RunSummary, Spend } from "../src/protocol";
import type { TrainerNames } from "../src/save-file";
import type { Tone } from "./components";

export type CellState = { kind: "plays" } | { kind: "waits" } | { kind: "memory" } | { kind: "battle" } | { kind: "ended"; result: string };

export const STATE_LOOKS: Record<CellState["kind"], { tone: Tone; label: string; dim?: boolean }> = {
  plays: { tone: "ok", label: "plays" },
  waits: { tone: "warn", label: "waits for the model", dim: true },
  memory: { tone: "warn", label: "writes its memory", dim: true },
  battle: { tone: "info", label: "in battle" },
  ended: { tone: "bad", label: "ended", dim: true },
};

const STOPPED = { model: "waits", summary: "memory" } as const;

export function stoppedState({ calling }: Pick<RunSummary, "calling">): "waits" | "memory" | null {
  return calling && STOPPED[calling.kind];
}

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

// A Run record has a long name, and the date at its end does not tell the Runs apart in a small cell.
function shortRecord(name: string): string {
  return name.replace(/\.json$/, "").replace(/-\d{4}-\d{2}-\d{2}T.*$/, "");
}

export function cellTitle({ kind, name, record }: GridCell): string {
  if (kind === "replay") return shortRecord(name);
  return record ? `${name} · ${shortRecord(record)}` : name;
}

function liveState(run: RunSummary): CellState {
  if (!run.playing) return { kind: "ended", result: run.error ? `error: ${run.error}` : (run.endReason ?? "unknown") };
  const stopped = stoppedState(run);
  if (stopped) return { kind: stopped };
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
