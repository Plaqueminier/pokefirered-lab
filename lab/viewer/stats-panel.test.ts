import { afterAll, beforeAll, describe, expect, setDefaultTimeout, spyOn, test } from "bun:test";
import { existsSync } from "node:fs";
import { modelBot } from "../bots/model";
import { Harness } from "../src/harness/harness";
import { type ModelEvent, RecordPlayer, type RunEvent, type RunRecord } from "../src/harness/record";
import { ROM_FILE, START_SAVE } from "../src/run";
import { statsView } from "./stats-panel";

const ready = existsSync(ROM_FILE) && existsSync(START_SAVE);
setDefaultTimeout(60_000);
const COST = 0.001;

const reply = (action: string) => ({
  content: JSON.stringify({ reason: `I choose ${action}.`, action, mission: "Get my first Pokémon", objective: "Leave the house", note: "" }),
  usage: { promptTokens: 1000, completionTokens: 30, reasoningTokens: 0, cost: COST },
});

// "fight 2" is not an action of a walk: the Bot cannot read it. The cell (0, 0) of the bedroom is a wall.
const ANSWERS = ["go 1", "fight 2", "goTo 0 0", "viewAtlas", "goTo 8 6"];

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
      expect(statsView(player.played())).toEqual(statsView(live));
    }
  });

  test("it counts the actions of the model, the actions never used, the impossible actions and the answers that the Bot cannot read", async () => {
    const view = statsView((await modelRecord()).events);
    expect(view.actions).toEqual([
      { name: "goTo", count: 2 },
      { name: "go", count: 1 },
      { name: "viewAtlas", count: 1 },
    ]);
    expect(view.neverUsed).toEqual(["swap", "choose", "fight", "switch", "send", "run", "press", "zoom"]);
    expect(view.impossible).toMatchObject([{ action: "goTo(0, 0)" }]);
    expect(view.unreadable).toMatchObject([{ error: '"fight" is not an action now: use go, goTo, viewAtlas, zoom or press' }]);
    expect(view.events).toEqual(expect.arrayContaining([{ name: "model", count: 5 }]));
  });
});

test("the cost of each Milestone adds up to the cost of the Run, and an event type that the panel does not know shows", () => {
  const call = (frame: number, cost: number) => ({ type: "model", frame, usage: { promptTokens: 0, completionTokens: 0, reasoningTokens: 0, cost }, decision: null, error: "e" }) as unknown as RunEvent;
  const events = [
    { type: "milestone", frame: 0, milestone: "has-pokemon" },
    call(10, 0.25),
    call(20, 0.125),
    { type: "summary", frame: 20, usage: { promptTokens: 0, completionTokens: 0, reasoningTokens: 0, cost: 0.5 } },
    { type: "milestone", frame: 30, milestone: "first-rival-battle" },
    call(40, 1),
  ] as RunEvent[];
  const view = statsView(events);
  expect(view.milestones).toEqual([
    { milestone: "has-pokemon", calls: 0, cost: 0 },
    { milestone: "first-rival-battle", calls: 2, cost: 0.875 },
    { milestone: null, calls: 1, cost: 1 },
  ]);
  expect(view.cost).toBe(1.875);
  expect(view.events).toContainEqual({ name: "summary", count: 1 });
});
