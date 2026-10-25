import { afterAll, beforeAll, describe, expect, setDefaultTimeout, spyOn, test } from "bun:test";
import { existsSync } from "node:fs";
import { modelBot } from "../bots/model";
import { Harness } from "../src/harness/harness";
import { type ModelEvent, RecordPlayer, type RunRecord } from "../src/harness/record";
import { ROM_FILE, START_SAVE } from "../src/run";
import { modelPanelView } from "./model-panel";

const ready = existsSync(ROM_FILE) && existsSync(START_SAVE);
setDefaultTimeout(60_000);
const COST = 0.001;

const reply = (action: string) => ({
  content: JSON.stringify({ reason: `I choose ${action}.`, action, mission: "Get my first Pokémon", objective: "Leave the house", notes: "Mom is downstairs." }),
  usage: { promptTokens: 1000, cachedTokens: 600, completionTokens: 30, reasoningTokens: 0, cost: COST },
});

async function modelRecord(): Promise<RunRecord> {
  const harness = await Harness.open();
  const actions = ["go 1", "viewAtlas", "goTo 8 6"];
  let call = 0;
  await harness.play(modelBot({ costLimit: 2.5 * COST }, () => async () => reply(actions[Math.min(call++, actions.length - 1)]))).catch(() => {});
  return harness.record();
}

let fetchSpy: ReturnType<typeof spyOn> | null = null;
beforeAll(() => {
  fetchSpy = spyOn(globalThis, "fetch").mockImplementation((() => {
    throw new Error("the tests do not call the network");
  }) as unknown as typeof fetch);
});
afterAll(() => fetchSpy?.mockRestore());

describe.skipIf(!ready)("the panel Model", () => {
  test("it shows the same Model call live, from the events of the Run, and in the replay of its Run record", async () => {
    const record = await modelRecord();
    const calls = record.events.filter((e): e is ModelEvent => e.type === "model");
    expect(calls).toHaveLength(3);
    for (const [i, call] of calls.entries()) {
      const live = record.events.slice(0, record.events.indexOf(call) + 1);
      const player = new RecordPlayer(record);
      while (player.frame < call.frame) player.next();
      const replay = player.played();
      expect(modelPanelView(replay, 0, i).call).toEqual(modelPanelView(live, 0, null).call);
      expect(modelPanelView(live, 0, null).call?.answer).toMatchObject({ action: call.decision?.action });
    }
  });

  test("it lists all the Model calls, shows the selected one in full, and tells when the model thinks", async () => {
    const record = await modelRecord();
    const view = modelPanelView(record.events, 4, 1);
    expect(view.thinking).toBe(true);
    expect(view.rows.map((r) => r.action)).toEqual(["go 1", "viewAtlas", "goTo 8 6"]);
    expect(view.selected).toBe(1);
    expect(view.call?.answer).toEqual({ action: "viewAtlas", reason: "I choose viewAtlas.", mission: "Get my first Pokémon", objective: "Leave the house", notes: "Mom is downstairs." });
    expect(view.call?.usage).toMatch(/^1000 tokens in \(600 cached\) · 30 out \(0 reasoning\) · 0\.001 \$ · \d+\.\d s$/);
    expect(view.call?.blocks.map((b) => b.title)).toEqual(["Progress", "Situation", "History", "Party", "Local view", "Atlas", "Targets", "Actions", "Rules"]);
    const afterAtlas = modelPanelView(record.events, 3, 2).call?.blocks ?? [];
    expect(afterAtlas.map((b) => b.title)).toEqual(["Progress", "Situation", "History", "Party", "Local view", "Atlas", "Targets", "Actions", "Your answer", "Full Atlas", "Request", "Rules"]);
    expect(afterAtlas[8].text).toBe(reply("viewAtlas").content);
    expect(modelPanelView(record.events, 3, null)).toMatchObject({ thinking: false, selected: 2 });
  });
});
