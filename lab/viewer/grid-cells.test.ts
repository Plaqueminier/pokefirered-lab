import { expect, test } from "bun:test";
import type { GridReplay, RunSummary } from "../src/protocol";
import { cellTitle, type GridCell, gridCells } from "./grid-cells";

test("a Run that writes its memory shows this state; a Run that ended does not", () => {
  const [writing, ended] = gridCells(2, [live(1, { calling: { kind: "summary", since: 0 } }), live(2, { calling: { kind: "summary", since: 0 }, playing: false, endReason: "cost limit" })], [], 0) as GridCell[];
  expect(writing.state).toEqual({ kind: "memory" });
  expect(ended.state).toEqual({ kind: "ended", result: "cost limit" });
});

function live(id: number, facts: Partial<RunSummary>): RunSummary {
  return {
    id,
    bot: "model-bot",
    playing: true,
    stopAsked: false,
    endReason: null,
    error: null,
    from: null,
    continued: null,
    model: { id: "a/b", provider: "openrouter", limit: { unit: "dollars", amount: 0.5 }, reasoning: "off", thinking: "medium", starter: "free", whiteoutLimit: 1, timeLimit: null, spent: { unit: "dollars", amount: 0.12 }, ownSpent: { unit: "dollars", amount: 0.12 } },
    frame: 1000 * id,
    milestone: null,
    whiteouts: 0,
    battle: false,
    calling: null,
    record: null,
    names: null,
    party: null,
    ...facts,
  };
}

function replay(cell: number, name: string, frames: number, facts: Partial<GridReplay> = {}): GridReplay {
  return { id: 20 + cell, cell, name, bot: "starter", model: null, frames, frame: 300, milestone: "has-pokemon", whiteouts: 0, spent: null, battle: false, endReason: "goal", error: null, names: null, party: null, ...facts };
}

test("a cell shows the names of its Run, for a live Run and for a replay", () => {
  const names = { player: "Mira", rival: "Crumb" };
  const [replayed, withNames, withNone] = gridCells(4, [live(1, { names }), live(2, {})], [replay(0, "a.json", 5000, { names: { player: "Al", rival: "Bo" } })], 300);
  expect(replayed?.names).toEqual({ player: "Al", rival: "Bo" });
  expect(withNames?.names).toEqual(names);
  expect(withNone?.names).toBeNull();
});

const short = (cell: GridCell | null) => cell && `${cell.kind} ${cell.runId} ${cell.state.kind}${cell.state.kind === "ended" ? ` ${cell.state.result}` : ""}`;

test("the Grid puts each chosen Run record in its cell, then the live Runs that play in the order they started, then the ended live Runs, but not a live Run whose record a cell replays; a replay ends at the last frame of its record", () => {
  const runs = [
    live(1, { playing: false, endReason: "cost limit", record: "model-bot-1.json" }),
    live(2, { calling: { kind: "model", since: 0 } }),
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
  expect(nine[3]).toMatchObject({ name: "Run 3", bot: "model-bot", model: { id: "a/b" }, limits: { whiteoutLimit: 1, timeLimit: null, whiteouts: 0 }, frame: 3000, milestone: "first-rival-battle", spent: { unit: "dollars", amount: 0.12 }, record: null });
  expect(nine[4]).toMatchObject({ record: "model-bot-1.json" });
  expect(nine[0]).toMatchObject({ name: "a.json", bot: "starter", model: null, frame: 300, milestone: "has-pokemon", spent: null, record: "a.json" });

  expect(gridCells(2, runs, replays, 300).map(short)).toEqual(["replay 20 battle", "live 2 waits"]);
  expect(gridCells(4, [], [], 0)).toEqual([null, null, null, null]);

  const replayed = [live(1, { playing: false, endReason: "goal", record: "r.json" }), live(2, {})];
  expect(gridCells(4, replayed, [replay(0, "r.json", 500)], 0).map(short)).toEqual(["replay 20 plays", "live 2 plays", null, null]);
  expect(gridCells(2, [], [replay(1, "old.json", 500, { error: "different rom" })], 0).map(short)).toEqual([null, "replay 21 ended error: different rom"]);
});

test("a cell gives the short name of its Run record, with no date", () => {
  const name = "00061-model-28-2026-11-05T09-59-37.060Z.json";
  const [replayed, playing, ended] = gridCells(4, [live(1, { playing: false, endReason: "whiteout", record: name }), live(2, {})], [replay(0, name.replace("61", "60"), 500)], 0) as GridCell[];
  expect(cellTitle(replayed)).toBe("00060-model-28");
  expect(cellTitle(ended)).toBe("Run 1 · 00061-model-28");
  expect(cellTitle(playing)).toBe("Run 2");
});

test("a cell gives the party, the Run id of its Run record (a new or continued live Run has none until its end) and its limits; a Bot with no model has none", () => {
  const party = [{ species: "IVYSAUR", nickname: "LEAF", level: 17, hp: 31, maxHp: 50, status: "none" as const }];
  const coached = { id: "a/b", provider: "openrouter", limit: { unit: "dollars", amount: 1 }, reasoning: "off", thinking: "off", starter: "free", coach: { id: "a/c" }, whiteoutLimit: null, timeLimit: null } as const;
  const runs = [
    live(1, { party, playing: false, endReason: "goal", record: "00047-model-45-2026-11-16T09-25-19.706Z.json" }),
    live(2, { from: { record: "00012-model-45-2026-11-01T10-00-00.000Z.json", kind: "extended" } }),
    live(4, { playing: false, endReason: "goal", record: "00003-genetic-2-2026-11-12T16-25-02.047Z.json", from: { record: "evolutions/v5/00003-genetic-2-2026-11-12T16-25-02.047Z.json", kind: "extended" } }),
    live(3, { from: { record: "00012-model-45-2026-11-01T10-00-00.000Z.json", kind: "continued" } }),
  ];
  const replays = [replay(0, "00044-model-41-2026-11-12T10-00-00.000Z.json", 500, { model: coached, party: [] }), replay(5, "evolutions/v5/00003-genetic-2-2026-11-12T16-25-02.047Z.json", 500, { bot: "genetic 2" })];
  const [replayed, extended, continued, ended, endedExtended] = gridCells(9, runs, replays, 0);
  expect(replayed).toMatchObject({ recordRun: { id: 44, evolution: null }, party: [], model: { id: "a/b", coach: { id: "a/c" } }, limits: { whiteoutLimit: null, timeLimit: null, whiteouts: 0 } });
  expect(ended).toMatchObject({ recordRun: { id: 47, evolution: null }, party, limits: { whiteoutLimit: 1, timeLimit: null, whiteouts: 0 } });
  expect(extended?.recordRun).toEqual({ id: 12, evolution: null, file: "00012-model-45-2026-11-01T10-00-00.000Z.json" });
  expect(endedExtended?.recordRun).toMatchObject({ id: 3, evolution: "v5" });
  expect(continued?.recordRun).toBeNull();
  expect(gridCells(9, [], replays, 0)[5]).toMatchObject({ recordRun: { id: 3, evolution: "v5" }, model: null, limits: null });
});
