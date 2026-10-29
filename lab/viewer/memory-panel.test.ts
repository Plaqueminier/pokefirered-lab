import { afterAll, beforeAll, describe, expect, setDefaultTimeout, spyOn, test } from "bun:test";
import { existsSync } from "node:fs";
import { modelBot } from "../bots/model";
import { Harness } from "../src/harness/harness";
import { type ModelEvent, RecordPlayer, type RunEvent, type RunRecord } from "../src/harness/record";
import type { ModelClient } from "../src/model/openrouter";
import { ROM_FILE, START_SAVE } from "../src/run";
import { memoryPanelView, type TreeNode } from "./memory-panel";

const ready = existsSync(ROM_FILE) && existsSync(START_SAVE);
setDefaultTimeout(60_000);
const COST = 0.001;
const USAGE = { promptTokens: 100, completionTokens: 20, reasoningTokens: 0, cost: COST };

const noteTaker = (): ModelClient => {
  let calls = 0;
  return async (prompt, format) => {
    if (format?.name === "summary") {
      const parts = [...prompt.user.matchAll(/^#([\d-]+): /gm)].map((m) => m[1]);
      return { content: JSON.stringify({ summary: `summary of ${parts.join(" and ")}` }), usage: USAGE };
    }
    calls++;
    const content = { reason: "r", action: "goTo 8 6", mission: "Get my first Pokémon", objective: "Leave the house", note: `fact ${calls}` };
    return { content: JSON.stringify(content), usage: USAGE };
  };
};

let fetchSpy: ReturnType<typeof spyOn> | null = null;
beforeAll(() => {
  fetchSpy = spyOn(globalThis, "fetch").mockImplementation((() => {
    throw new Error("the tests do not call the network");
  }) as unknown as typeof fetch);
});
afterAll(() => fetchSpy?.mockRestore());

describe.skipIf(!ready)("the panel Memory tree", () => {
  test("it shows the same Memory tree and Summary calls live and in the replay of the Run record, at the same frame", async () => {
    const harness = await Harness.open();
    await harness.play(modelBot({ costLimit: 7.5 * COST }, () => noteTaker())).catch(() => {});
    const record: RunRecord = JSON.parse(JSON.stringify(harness.record()));
    const calls = record.events.filter((e): e is ModelEvent => e.type === "model");
    expect(calls).toHaveLength(5);
    for (const frame of [...calls.map((c) => c.frame), record.result.frames]) {
      const live = harness.record().events.filter((e) => e.frame <= frame);
      const player = new RecordPlayer(record);
      while (player.frame < frame) player.next();
      expect(memoryPanelView(player.played())).toEqual(memoryPanelView(live));
    }
    const end = memoryPanelView(record.events);
    expect(end.tops.map((node) => node.line)).toEqual(["#1-4: summary of 1-2 and 3-4", "#5: fact 5"]);
    expect(end.calls.map((call) => call.node)).toEqual(["#1-4", "#3-4", "#1-2"]);
  });
});

test("a click on a node opens its two halves down to the notes, and a failed Summary call shows its error and leaves its two halves in the prompt", () => {
  const usage = { promptTokens: 0, completionTokens: 0, reasoningTokens: 0, cost: 0.25 };
  const call = (frame: number, note: string): RunEvent => ({
    type: "model",
    frame,
    latencyMs: 1,
    model: "a/b",
    situation: "a walk",
    prompt: { system: "", user: "" },
    answer: "",
    usage,
    decision: { reason: "", action: "go 1", mission: "", objective: "", note },
    error: null,
  });
  const summary = (frame: number, from: number, to: number, text: string | null): RunEvent => ({
    type: "summary",
    frame,
    latencyMs: 1500,
    model: "a/b",
    from,
    to,
    prompt: { system: "rules", user: "two parts" },
    answer: text === null ? null : JSON.stringify({ summary: text }),
    usage,
    ...(text === null ? { summary: null, error: "the request failed: 502" } : { summary: text, error: null }),
  });
  const events = [call(1, "a"), call(2, "b"), summary(2, 1, 2, "ab"), call(3, "c"), call(4, "d"), summary(4, 3, 4, null), summary(5, 3, 4, "cd"), summary(5, 1, 4, "abcd"), call(6, "e"), call(7, "f"), summary(7, 5, 6, null)];
  const view = memoryPanelView(events);
  const lines = (nodes: TreeNode[]): unknown[] => nodes.map((node) => (node.halves.length ? [node.line, lines(node.halves)] : node.line));
  expect(lines(view.tops)).toEqual([["#1-4: abcd", [["#1-2: ab", ["#1: a", "#2: b"]], ["#3-4: cd", ["#3: c", "#4: d"]]]], "#5: e", "#6: f"]);
  expect(view.calls.map((c) => [c.frame, c.node, c.result, c.failed])).toEqual([
    [7, "#5-6", "the request failed: 502", true],
    [5, "#1-4", "abcd", false],
    [5, "#3-4", "cd", false],
    [4, "#3-4", "the request failed: 502", true],
    [2, "#1-2", "ab", false],
  ]);
  expect(view.calls[0]).toMatchObject({ cost: 0.25, latencyMs: 1500, prompt: { system: "rules", user: "two parts" }, answer: "(no answer: the request failed: 502)" });
  expect(view.cost).toBe(1.25);
});
