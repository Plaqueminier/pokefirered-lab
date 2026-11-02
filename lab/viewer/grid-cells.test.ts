import { expect, test } from "bun:test";
import type { GridReplay, RunSummary } from "../src/protocol";
import { type GridCell, gridCells } from "./grid-cells";

function live(id: number, facts: Partial<RunSummary>): RunSummary {
  return {
    id,
    bot: "model-bot",
    playing: true,
    stopAsked: false,
    endReason: null,
    error: null,
    parent: null,
    continued: null,
    model: { id: "a/b", provider: "openrouter", limit: { unit: "dollars", amount: 0.5 }, reasoning: "off", thinking: "medium", starter: "free", spent: { unit: "dollars", amount: 0.12 }, ownSpent: { unit: "dollars", amount: 0.12 }, callsStarted: 3 },
    frame: 1000 * id,
    milestone: null,
    battle: false,
    waits: false,
    record: null,
    ...facts,
  };
}

function replay(cell: number, name: string, frames: number, facts: Partial<GridReplay> = {}): GridReplay {
  return { id: 20 + cell, cell, name, bot: "starter", model: null, frames, frame: 300, milestone: "has-pokemon", spent: null, battle: false, endReason: "goal", error: null, ...facts };
}

const short = (cell: GridCell | null) => cell && `${cell.kind} ${cell.runId} ${cell.state.kind}${cell.state.kind === "ended" ? ` ${cell.state.result}` : ""}`;

test("the Grid puts each chosen Run record in its cell, then the live Runs that play in the order they started, then the ended live Runs, but not a live Run whose record a cell replays; a replay ends at the last frame of its record", () => {
  const runs = [
    live(1, { playing: false, endReason: "cost limit", record: "model-bot-1.json" }),
    live(2, { waits: true }),
    live(3, { battle: true, milestone: "first-rival-battle" }),
    live(4, { playing: false, error: "the worker stopped" }),
  ];
  const replays = [replay(0, "a.json", 5000, { battle: true }), replay(2, "b.json", 300), replay(7, "c.json", 9000)];

  const nine = gridCells(9, runs, replays, 300);
  expect(nine.map(short)).toEqual([
    "replay 20 battle",
    "live 2 waits",
    "replay 22 ended goal",
    "live 3 battle",
    "live 1 ended cost limit",
    "live 4 ended error: the worker stopped",
    null,
    "replay 27 plays",
    null,
  ]);
  expect(nine[3]).toMatchObject({ name: "Run 3", bot: "model-bot", model: "a/b", frame: 3000, milestone: "first-rival-battle", spent: { unit: "dollars", amount: 0.12 }, record: null });
  expect(nine[4]).toMatchObject({ record: "model-bot-1.json" });
  expect(nine[0]).toMatchObject({ name: "a.json", bot: "starter", model: null, frame: 300, milestone: "has-pokemon", spent: null, record: "a.json" });

  expect(gridCells(2, runs, replays, 300).map(short)).toEqual(["replay 20 battle", "live 2 waits"]);
  expect(gridCells(4, [], [], 0)).toEqual([null, null, null, null]);

  const replayed = [live(1, { playing: false, endReason: "goal", record: "r.json" }), live(2, {})];
  expect(gridCells(4, replayed, [replay(0, "r.json", 500)], 0).map(short)).toEqual(["replay 20 plays", "live 2 plays", null, null]);
  expect(gridCells(2, [], [replay(1, "old.json", 500, { error: "different rom" })], 0).map(short)).toEqual([null, "replay 21 ended error: different rom"]);
});
