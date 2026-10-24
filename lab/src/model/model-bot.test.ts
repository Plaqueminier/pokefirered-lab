import { afterAll, beforeAll, describe, expect, setDefaultTimeout, spyOn, test } from "bun:test";
import { existsSync } from "node:fs";
import { modelBot } from "../../bots/model";
import { Harness } from "../harness/harness";
import { type ModelEvent, modelTotals, type Prompt } from "../harness/record";
import { ROM_FILE, START_SAVE } from "../run";
import type { ModelClient } from "./openrouter";

const ready = existsSync(ROM_FILE) && existsSync(START_SAVE);
setDefaultTimeout(60_000);
const COST = 0.001;

function reply(action: string, objective = "Get a Pokémon") {
  return { content: JSON.stringify({ reason: `I choose ${action}.`, action, objective, notes: "Oak is in his lab." }), usage: { promptTokens: 1000, completionTokens: 30, reasoningTokens: 0, cost: COST } };
}

function target(prompt: Prompt, label: string): string {
  const n = prompt.user.match(new RegExp(`^(\\d+)\\. ${label}`, "m"))?.[1];
  if (!n) throw new Error(`no target "${label}" in the prompt:\n${prompt.user}`);
  return `go ${n}`;
}

function fakeModel(): { client: ModelClient; prompts: Prompt[] } {
  const prompts: Prompt[] = [];
  let fights = 0;
  const client: ModelClient = async (prompt) => {
    prompts.push(prompt);
    const now = prompt.user.match(/^The game waits for (.+)$/m)?.[1] ?? "";
    const texts = [...prompt.user.matchAll(/^ +"(.*)"$/gm)].map((m) => m[1]);
    if (now.startsWith("a choice")) return reply(texts.at(-1)?.includes("nickname") ? "choose NO" : "choose YES");
    if (now.startsWith("a battle action") || now.startsWith("a move")) return reply(fights++ === 0 ? "fight 1" : "fight 0");
    const map = prompt.user.match(/^Map (\w+)/m)?.[1];
    switch (map) {
      case "PalletTown_PlayersHouse_2F":
        return reply(target(prompt, "stairs"));
      case "PalletTown_PlayersHouse_1F":
        return reply(target(prompt, "exit mat"));
      case "PalletTown":
        return reply(target(prompt, "north edge"));
      case "PalletTown_ProfessorOaksLab":
        return reply(prompt.user.includes("Party: none") ? target(prompt, "ITEM BALL at \\(9, 4\\)") : target(prompt, "exit mat"));
    }
    throw new Error(`the fake model does not know this prompt:\n${prompt.user}`);
  };
  return { client, prompts };
}

function answers(...contents: string[]): ModelClient {
  let i = 0;
  return async () => ({ ...reply("go 1"), content: contents[Math.min(i++, contents.length - 1)] });
}

function modelEvents(harness: Harness): ModelEvent[] {
  return harness.events.filter((e): e is ModelEvent => e.type === "model");
}

let fetchSpy: ReturnType<typeof spyOn> | null = null;
beforeAll(() => {
  fetchSpy = spyOn(globalThis, "fetch").mockImplementation((() => {
    throw new Error("the tests do not call the network");
  }) as unknown as typeof fetch);
});
afterAll(() => fetchSpy?.mockRestore());

describe.skipIf(!ready)("model bot", () => {
  test("with a fake model, it plays to the first rival battle: the code reads the texts, and the model chooses at each walk, choice and battle action", async () => {
    const { client, prompts } = fakeModel();
    const seen: string[] = [];
    const harness = await Harness.open({
      onModelCallStart: () => seen.push("thinks"),
      onModelCall: (event) => seen.push(`answer ${event.decision?.action}`),
      onAction: ({ action }) => seen.push(action.name),
    });
    const result = await harness.play(modelBot({ id: "fake/model", costLimit: 1 }, () => client));
    expect(result).toMatchObject({ endReason: "goal", milestones: ["has-pokemon", "first-rival-battle"], rawInputs: 0 });

    const calls = modelEvents(harness);
    expect(calls.map((e) => e.decision?.action)).toEqual(["go 1", "go 1", "go 4", "go 7", "choose YES", "choose NO", "go 1", "fight 1", "fight 0", "fight 0", "fight 0", "fight 0"]);
    expect(prompts).toHaveLength(calls.length);
    const totals = modelTotals(harness.events);
    expect(totals).toMatchObject({ calls: 12, promptTokens: 12_000, completionTokens: 360, reasoningTokens: 0 });
    expect(totals.cost).toBeCloseTo(12 * COST, 10);
    for (const [i, call] of calls.entries()) {
      expect(call).toMatchObject({ model: "fake/model", prompt: prompts[i], error: null, usage: { cost: COST } });
      expect(call.answer).toBe(reply(call.decision?.action ?? "").content);
      expect(call.latencyMs).toBeGreaterThanOrEqual(0);
    }
    expect(seen.slice(0, 4)).toEqual(["thinks", "answer go 1", "goTo", "thinks"]);
    expect(seen.filter((s) => s === "thinks")).toHaveLength(calls.length);
    expect(harness.actions.filter((e) => e.action.name === "readText").length).toBeGreaterThan(10);

    expect(prompts[0].system).toContain("Become the Champion: earn the 8 gym badges, then beat the Elite Four");
    expect(prompts[0].system).toContain("answer NO");
    expect(prompts[0].system).toContain("When your last decisions give nothing new, do not do them again");
    expect(prompts[0].user).toContain("Map PalletTown_PlayersHouse_2F");
    expect(prompts[1].user).toMatch(/You chose: go 1\n +goTo\(10, 2\): done/);
    expect(prompts[2].user).toMatch(/^\d+\. door at \(6, 7\), to PalletTown_PlayersHouse_1F$/m);
    expect(prompts[2].user).toMatch(/^\d+\. door at \(15, 7\), to a map that you have not visited$/m);
    expect(prompts[2].user).toMatch(/^\d+\. north edge of the map, to a map that you have not visited$/m);
    expect(prompts[4].user).toContain('"Hm! SQUIRTLE is your choice.');
    expect(prompts[4].user).toContain("Objective: Get a Pokémon");
    expect(prompts[4].user).toContain("Notes: Oak is in his lab.");
    expect(prompts[4].user).toMatch(/^The game waits for a choice: YES, NO\.$/m);
    expect(prompts[4].user).toMatch(/Actions:\n- choose YES\n- choose NO\n- press <button>/);
    expect(prompts[4].user).not.toContain("goTo <x> <y>");
    expect(prompts[7].user).toContain("fight 1: TAIL WHIP (PP 30/30)");
    expect(prompts[7].user).toContain("Foe BULBASAUR: level 5, HP 100%");

    const { header } = harness.record();
    expect(header.bot).toEqual({ name: "model", version: "1", model: { id: "fake/model", costLimit: 1, reasoning: "off", temperature: null } });
  });

  test("it stops when the cost of the Run is more than the cost limit", async () => {
    const harness = await Harness.open();
    const bot = modelBot({ costLimit: 2.5 * COST }, () => answers(reply("goTo 8 6").content));
    await expect(harness.play(bot)).rejects.toThrow("the cost of the Run (0.003 $) is more than the cost limit (0.0025 $)");
    expect(harness.record().result.endReason).toBe("bot stopped");
    expect(modelEvents(harness)).toHaveLength(3);
  });

  test("it stops after 3 answers in a row that it cannot read, and the model sees each one", async () => {
    const harness = await Harness.open();
    const good = reply("goTo 8 6").content;
    const bot = modelBot({ costLimit: 1 }, () => answers("I go north", good, "{}", JSON.stringify({ ...JSON.parse(good), action: "dance" }), "not JSON either"));
    await expect(harness.play(bot)).rejects.toThrow("3 answers in a row that the Bot cannot read; the last one: the answer is not JSON");
    const calls = modelEvents(harness);
    expect(calls.map((e) => e.error)).toEqual(["the answer is not JSON", null, 'the answer has no string "reason"', '"dance" is not an action', "the answer is not JSON"]);
    expect(calls.map((e) => e.decision === null)).toEqual([true, false, true, true, true]);
    expect(calls[1].prompt.user).toContain("Your answer could not be read: the answer is not JSON");
  });

  test("on a screen that no Macro-action covers, the code presses B three times and tells the model", async () => {
    const harness = await Harness.open({ noProgressLimit: 30 });
    const bot = modelBot({ costLimit: 1 }, () => answers(reply("press Start").content, reply("goTo 8 6").content));
    await harness.play(bot).catch(() => {});
    const calls = modelEvents(harness);
    expect(calls[1].prompt.user).toContain("The game showed a screen that no action covers: the program pressed B 3 times.");
    expect(harness.actions.slice(0, 5).map((e) => e.action)).toEqual([
      { name: "press", button: "Start" },
      { name: "readText" },
      { name: "press", button: "B" },
      { name: "press", button: "B" },
      { name: "press", button: "B" },
    ]);
  });
});
