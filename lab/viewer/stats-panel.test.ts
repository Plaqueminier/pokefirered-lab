import { afterAll, beforeAll, describe, expect, setDefaultTimeout, spyOn, test } from "bun:test";
import { existsSync } from "node:fs";
import { modelBot } from "../bots/model";
import { readAreas } from "../src/game";
import { Harness } from "../src/harness/harness";
import { continuationOf, type ModelEvent, RecordPlayer, type RunEvent, type RunRecord } from "../src/harness/record";
import { MODEL_ACTION_NAMES } from "../src/model/decision";
import { ROM_FILE, START_SAVE } from "../src/run";
import { axisScale, costScale, lanes, lanesSvg, stuckLevel } from "./stats-lanes";
import { type StatsOptions, selected, statsView } from "./stats-panel";

const ready = existsSync(ROM_FILE) && existsSync(START_SAVE);
setDefaultTimeout(60_000);
const COST = 0.001;
const NOW = 1000;
const OPTIONS: StatsOptions = { now: NOW, areas: {}, continued: null };

const reply = (action: string) => ({
  content: JSON.stringify({ reason: `I choose ${action}.`, action, mission: "Get my first Pokémon", objective: "Leave the house", note: "" }),
  usage: { promptTokens: 1000, completionTokens: 30, reasoningTokens: 0, cost: COST },
});

const ANSWERS = ["go A", "fight 2", "goTo 0 0", "viewAtlas", "goTo 8 6"];

async function modelRecord(): Promise<RunRecord> {
  const harness = await Harness.open();
  let call = 0;
  const bot = modelBot({ costLimit: (ANSWERS.length - 0.5) * COST }, () => async () => reply(ANSWERS[Math.min(call++, ANSWERS.length - 1)]));
  await harness.play(bot).catch(() => {});
  return harness.record();
}

let fetchSpy: ReturnType<typeof spyOn> | null = null;
beforeAll(() => {
  fetchSpy = spyOn(globalThis, "fetch").mockImplementation((() => {
    throw new Error("the tests do not call the network");
  }) as unknown as typeof fetch);
});
afterAll(() => fetchSpy?.mockRestore());

describe.skipIf(!ready)("the panel Stats", () => {
  test("it shows the same stats live and in the replay of the Run record, at the same frame", async () => {
    const record = await modelRecord();
    const calls = record.events.filter((e): e is ModelEvent => e.type === "model");
    expect(calls).toHaveLength(ANSWERS.length);
    const file: RunRecord = JSON.parse(JSON.stringify(record));
    for (const frame of [...calls.map((c) => c.frame), record.result.frames]) {
      const live = record.events.filter((e) => e.frame <= frame);
      const player = new RecordPlayer(file);
      while (player.frame < frame) player.next();
      expect(statsView(player.played(), { ...OPTIONS, now: frame })).toEqual(statsView(live, { ...OPTIONS, now: frame }));
    }
  });

  test("it counts the actions of the model, the actions never used, the impossible actions and the answers that the Bot cannot read", async () => {
    const all = selected(statsView((await modelRecord()).events, OPTIONS), null);
    expect(all.actions.slice(0, 4)).toEqual([
      { name: "goTo", count: 2 },
      { name: "go", count: 1 },
      { name: "viewAtlas", count: 1 },
      { name: "swap", count: 0 },
    ]);
    expect(all.impossible).toEqual([{ name: expect.stringMatching(/^goTo: /), count: 1 }]);
    expect(all.unreadable).toEqual([{ name: '"fight" is not an action now: use go, goTo, viewAtlas, zoom or press', count: 1 }]);
  });
});

const usage = (cost: number, promptTokens = 0) => ({ promptTokens, completionTokens: 0, reasoningTokens: 0, cost });

function call(frame: number, action: string | null, more: Partial<ModelEvent> = {}, note = ""): RunEvent {
  const answer = action === null ? { decision: null, error: "no JSON" } : { decision: { reason: "", action, mission: "", objective: "", note }, error: null };
  return { type: "model", frame, latencyMs: 0, model: "m", situation: `situation at ${frame}`, prompt: { system: "", user: "" }, answer: null, usage: usage(0.25), ...answer, ...more } as RunEvent;
}

function played(frame: number, status: "done" | "impossible" | "blocked" | "interrupted", reason = ""): RunEvent {
  return { type: "action", frame, action: { name: "goTo", x: 3, y: 4 }, result: { status, reason, frames: 10 } } as RunEvent;
}

const summary = (frame: number): RunEvent => ({ type: "summary", frame, usage: usage(0.5) }) as RunEvent;

test("it places the calls, the played actions and the Summary calls at their frames, each played action with the Model call that played it, and the cost so far", () => {
  const view = statsView([played(5, "done"), call(10, "go A"), played(10, "done"), played(40, "impossible", "no path"), summary(40), call(50, null), call(50, "goTo 1 2"), played(50, "blocked", "a person")], OPTIONS);
  expect(view.calls.map((c) => [c.frame, c.answer.kind === "action" ? c.answer.name : c.answer.error])).toEqual([
    [10, "go"],
    [50, "no JSON"],
    [50, "goTo"],
  ]);
  expect(view.played.map((p) => [p.frame, p.call, p.status])).toEqual([
    [5, null, "done"],
    [10, 0, "done"],
    [40, 0, "impossible"],
    [50, 2, "blocked"],
  ]);
  expect(view.summaries).toEqual([{ frame: 40 }]);
  expect(view.costSteps).toEqual([
    { frame: 10, cost: 0.25 },
    { frame: 40, cost: 0.75 },
    { frame: 50, cost: 1 },
    { frame: 50, cost: 1.25 },
  ]);
  expect(view.cost).toBe(1.25);
});

test("the lane Prompt tokens shows the prompt tokens of each Model call at its frame, and a Run record with no usage shows an empty lane", () => {
  const tokens = (frame: number, promptTokens: number) => call(frame, "go A", { usage: usage(0.25, promptTokens) });
  const view = statsView([tokens(10, 1600), played(10, "done"), tokens(40, 3200), summary(40), tokens(70, 5100)], OPTIONS);
  expect(view.calls.map((c) => [c.frame, c.prompt])).toEqual([
    [10, 1600],
    [40, 3200],
    [70, 5100],
  ]);
  const svg = lanesSvg({ view, scale: axisScale(1000, NOW), played: NOW, costLimit: 1, selection: null });
  expect(svg).toContain(">Prompt tokens<");
  expect(svg).toContain('data-tip="prompt of 5,100 tokens at 0:01"');
  const old = statsView([call(10, "go A"), call(40, null)], OPTIONS);
  expect(old.calls.map((c) => c.prompt)).toEqual([null, null]);
  expect(lanesSvg({ view: old, scale: axisScale(1000, NOW), played: NOW, costLimit: 1, selection: null })).toContain("no prompt tokens in this Run record");
});

describe("a selection", () => {
  const view = statsView(
    [
      call(10, "go A", { stuck: 3, usage: usage(0.25, 1500) }, "a note"),
      played(10, "done"),
      played(20, "impossible", "no path to 3 4"),
      summary(20),
      call(30, null, { stuck: 12 }),
      call(30, "goTo 1 2", { stuck: 12, reflection: true, usage: usage(0.25, 2400) }, "a lesson"),
      played(30, "impossible", "no path to 5 6"),
      played(35, "blocked", "a person stays in the way"),
      call(60, "go B", { stuck: 25, usage: usage(0.25, 2100) }, "a lesson"),
      played(60, "done"),
    ],
    OPTIONS,
  );

  test("of a range has the calls, the played actions and the Summary calls in it, with their cost, the new notes, the Stuck counter and the reasons grouped", () => {
    const range = selected(view, { kind: "range", from: 20, to: 35 });
    expect([range.from, range.to]).toEqual([20, 35]);
    expect(range.calls.map((c) => c.index)).toEqual([1, 2]);
    expect(range.played.map((p) => p.frame)).toEqual([20, 30, 35]);
    expect(range.summaries).toHaveLength(1);
    expect(range.cost).toBe(1);
    expect(range.notes).toBe(1);
    expect(range.stuck).toEqual({ end: 12, max: 12 });
    expect(range.reflections).toBe(1);
    expect(range.prompt).toEqual({ min: 2400, max: 2400 });
    expect(range.impossible).toEqual([{ name: "goTo: no path to # #", count: 2 }]);
    expect(range.unreadable).toEqual([{ name: "no JSON", count: 1 }]);
    expect(range.actions.slice(0, 2)).toEqual([
      { name: "goTo", count: 1 },
      { name: "go", count: 0 },
    ]);
    expect(range.actions.map((a) => a.name).sort()).toEqual([...MODEL_ACTION_NAMES].sort());
  });

  test("of one Model call goes from its frame to the frame before the next call", () => {
    const one = selected(view, { kind: "call", index: 0 });
    expect([one.from, one.to]).toEqual([10, 29]);
    expect(one.calls.map((c) => c.index)).toEqual([0]);
    expect(one.played.map((p) => p.frame)).toEqual([10, 20]);
    expect(one.summaries).toHaveLength(1);
    expect(one.cost).toBe(0.75);
    expect(one.notes).toBe(1);
  });

  test("of nothing is the whole Run up to now, and a note given again is not a new note", () => {
    const all = selected(view, null);
    expect([all.from, all.to]).toEqual([0, NOW]);
    expect(all.calls).toHaveLength(4);
    expect(all.notes).toBe(2);
    expect(all.stuck).toEqual({ end: 25, max: 25 });
    expect(all.prompt).toEqual({ min: 1500, max: 2400 });
  });
});

test("the Stuck counter is low under a third of the Reflection turn interval, mid under two thirds, and high above", () => {
  expect([0, 6, 7, 13, 14, 45].map(stuckLevel)).toEqual(["low", "low", "mid", "mid", "high", "high"]);
});

test("the cost scale stops at the cost while the cost is less than half of the limit, and then it shows the limit as a line", () => {
  expect(costScale(0.1, 1)).toEqual({ max: 0.1, limitLine: false });
  expect(costScale(0.6, 1)).toEqual({ max: 1, limitLine: true });
  expect(costScale(1.2, 1)).toEqual({ max: 1.2, limitLine: true });
  expect(costScale(0.1, null)).toEqual({ max: 0.1, limitLine: false });
});

test("for a Continued Run, the cost scale reads only its own cost, and its limit line is above the cost of the parent", () => {
  expect(costScale(0.05, 1, 0.75)).toEqual({ max: 0.8, limitLine: false });
  expect(costScale(0.625, 1, 0.75)).toEqual({ max: 1.75, limitLine: true });
});

test("a Continued Run starts at the last frame of the buttons of its parent, after all its events", () => {
  const parent = { buttons: [[0, 30], [1, 20]], events: [call(10, "go A"), call(50, "go B")] } as unknown as RunRecord;
  expect(continuationOf(parent)).toEqual({ frame: 50, events: 2 });
});

test("a Continued Run starts at the end of its parent, and the cost of the parent is the cost of the events before its own", () => {
  const events = [call(10, "go A"), call(50, "go B"), call(50, "go C")];
  const view = statsView(events, { ...OPTIONS, continued: { frame: 50, events: 2 } });
  expect(view.parentEnd).toEqual({ frame: 50, cost: 0.5 });
  expect(view.cost).toBe(0.75);
  expect(statsView(events.slice(0, 2), { ...OPTIONS, continued: { frame: 50, events: 2 } }).parentEnd).toEqual({ frame: 50, cost: 0.5 });
  expect(statsView(events, OPTIONS).parentEnd).toBeNull();
});

test("a Run with no Model call has no lanes of the model, a model bot has them before its first call, and a record with no Stuck counter has none in the selection", () => {
  const scripted = statsView([{ type: "map", frame: 0, map: "PalletTown" }, played(10, "done")], OPTIONS);
  const all = ["Milestones", "Areas", "Cost", "Stuck", "Prompt tokens", "Model calls", "Played actions", "Summary calls", "Battles"];
  expect(lanes(scripted, false).map((l) => l.name)).toEqual(["Milestones", "Areas", "Played actions", "Battles"]);
  expect(lanes(scripted, true).map((l) => l.name)).toEqual(all);
  const old = statsView([call(10, "go A")], OPTIONS);
  expect(lanes(old, false).map((l) => l.name)).toEqual(all);
  expect(selected(old, null).stuck).toBeNull();
  expect(selected(old, null).prompt).toBeNull();
});

test("a battle is a span from its start to its end, and a battle that plays now ends now", () => {
  const battle = (frame: number, state: "start" | "end"): RunEvent => ({ type: "battle", frame, state });
  const view = statsView([battle(100, "start"), battle(200, "end"), battle(300, "start")], OPTIONS);
  expect(view.battles).toEqual([
    { from: 100, to: 200 },
    { from: 300, to: NOW },
  ]);
});

test("each Milestone ends a chapter, and the open chapter goes to the next Milestone, up to now", () => {
  const milestone = (frame: number, name: "has-pokemon" | "first-rival-battle"): RunEvent => ({ type: "milestone", frame, milestone: name });
  const view = statsView([milestone(100, "has-pokemon"), milestone(400, "first-rival-battle")], OPTIONS);
  expect(view.chapters).toEqual([
    { milestone: "has-pokemon", from: 0, to: 100 },
    { milestone: "first-rival-battle", from: 100, to: 400 },
    { milestone: null, from: 400, to: NOW },
  ]);
});

test("the maps group in Areas while the player stays in them, and each Area has the order of its first visit", () => {
  const inside = (area: string, place: string) => ({ area, place });
  const outside = (area: string) => ({ area, place: null });
  const areas = {
    PalletTown: outside("Pallet Town"),
    PalletTown_PlayersHouse_2F: inside("Pallet Town", "Player's House 2F"),
    PalletTown_ProfessorOaksLab: inside("Pallet Town", "Prof. Oak's Lab"),
    Route1: outside("Route 1"),
    ViridianCity_PokemonCenter_1F: inside("Viridian City", "Pokémon Center 1F"),
    ViridianCity_Mart: inside("Viridian City", "Poké Mart"),
    Route2_ViridianForest_SouthEntrance: inside("Route 2", "Viridian Forest South Entrance"),
  };
  const maps = ["PalletTown_PlayersHouse_2F", "PalletTown", "PalletTown_ProfessorOaksLab", "Route1", "PalletTown", "ViridianCity_PokemonCenter_1F", "ViridianCity_Mart", "Route2_ViridianForest_SouthEntrance"];
  const view = statsView(maps.map((map, i): RunEvent => ({ type: "map", frame: i * 100, map })), { ...OPTIONS, areas });
  expect(view.areas).toEqual([
    { area: "Pallet Town", order: 0, from: 0, to: 300 },
    { area: "Route 1", order: 1, from: 300, to: 400 },
    { area: "Pallet Town", order: 0, from: 400, to: 500 },
    { area: "Viridian City", order: 2, from: 500, to: 700 },
    { area: "Route 2", order: 3, from: 700, to: NOW },
  ]);
  expect(view.maps.map((m) => m.place)).toEqual(["Player's House 2F", null, "Prof. Oak's Lab", null, null, "Pokémon Center 1F", "Poké Mart", "Viridian Forest South Entrance"]);
  expect(view.maps.at(-1)).toEqual({ map: "Route2_ViridianForest_SouthEntrance", area: "Route 2", place: "Viridian Forest South Entrance", order: 3, from: 700, to: NOW });
});

test("a map with no Area in the table is its own Area, outside", () => {
  const view = statsView([{ type: "map", frame: 0, map: "SomeNewMap" }], OPTIONS);
  expect(view.areas).toEqual([{ area: "SomeNewMap", order: 0, from: 0, to: NOW }]);
  expect(view.maps[0].place).toBeNull();
});

test("the Areas come from the map sections of the game, with their names in normal case; an inside map has its name without its Area, and a town or a route has none", async () => {
  const areas = await readAreas();
  expect(areas.PalletTown_PlayersHouse_2F).toEqual({ area: "Pallet Town", place: "Player's House 2F" });
  expect(areas.PalletTown_ProfessorOaksLab).toEqual({ area: "Pallet Town", place: "Prof. Oak's Lab" });
  expect(areas.Route1).toEqual({ area: "Route 1", place: null });
  expect(areas.Route21_North).toEqual({ area: "Route 21", place: null });
  expect(areas.Route2_ViridianForest_NorthEntrance).toEqual({ area: "Route 2", place: "Viridian Forest North Entrance" });
  expect(areas.ViridianForest).toEqual({ area: "Viridian Forest", place: null });
  expect(areas.MtMoon_B1F).toEqual({ area: "Mt. Moon", place: "B1F" });
  expect(areas.PokemonTower_1F).toEqual({ area: "Pokémon Tower", place: "1F" });
  expect(areas.FiveIsland_LostCave_Room1).toEqual({ area: "Lost Cave", place: "Room 1" });
  expect(areas.SSAnne_Exterior.area).toBe("S.S. Anne");
});
