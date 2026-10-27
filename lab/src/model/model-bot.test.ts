import { afterAll, beforeAll, describe, expect, setDefaultTimeout, spyOn, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { modelBot, unknownScreen } from "../../bots/model";
import { Harness } from "../harness/harness";
import { type ModelEvent, modelTotals, type Prompt, type RunEvent, replay, type SummaryEvent } from "../harness/record";
import { ROM_FILE, SAVES_DIR, START_SAVE } from "../run";
import { modelPanelView } from "../../viewer/model-panel";
import type { ModelClient } from "./openrouter";

const ready = existsSync(ROM_FILE) && existsSync(START_SAVE);
setDefaultTimeout(60_000);
const COST = 0.001;
const AFTER_RIVAL = ["go A", "go C"];
const DECISIONS = ["go A", "go B", "go B", "go D", "go A", "go E", "choose YES", "choose NO", "go A", "fight 1", "fight 0", "fight 0", "fight 0", "fight 0", "fight 0", "fight 0"];

function reply(action: string, objective = "Get a Pokémon", note = "") {
  return { content: JSON.stringify({ reason: `I choose ${action}.`, action, mission: "Get my first Pokémon", objective, note }), usage: { promptTokens: 1000, completionTokens: 30, reasoningTokens: 0, cost: COST } };
}

function target(prompt: Prompt, ...labels: string[]): string {
  for (const label of labels) {
    const letter = prompt.user.match(new RegExp(`^([A-Z]+)\\. ${label}`, "m"))?.[1];
    if (letter) return `go ${letter}`;
  }
  throw new Error(`no target "${labels.join('" or "')}" in the prompt:\n${prompt.user}`);
}

function waitedFor({ user }: Prompt): string {
  return /^The game asks: /m.test(user) ? "a choice" : (user.match(/^The game waits for (.+)$/m)?.[1] ?? "");
}

function fakeModel(): { client: ModelClient; prompts: Prompt[] } {
  const prompts: Prompt[] = [];
  let fights = 0;
  const client: ModelClient = async (prompt) => {
    prompts.push(prompt);
    const now = waitedFor(prompt);
    const texts = [...prompt.user.matchAll(/^ +"(.*)"$/gm)].map((m) => m[1]);
    if (now.startsWith("a choice")) return reply(texts.at(-1)?.includes("nickname") ? "choose NO" : "choose YES");
    if (now.startsWith("a battle action") || now.startsWith("a move")) return reply(fights++ === 0 ? "fight 1" : "fight 0");
    const map = prompt.user.match(/^Map (\w+)/m)?.[1];
    switch (map) {
      case "PalletTown_PlayersHouse_2F":
        return reply(target(prompt, "stairs"));
      case "PalletTown_PlayersHouse_1F":
        return reply(target(prompt, "exit mat", "unseen cells south"));
      case "PalletTown":
        return reply(target(prompt, "north edge", "unseen cells north"));
      case "PalletTown_ProfessorOaksLab":
        return reply(prompt.user.includes("Party: none") ? target(prompt, "ITEM BALL at \\(9, 4\\)") : target(prompt, "exit mat", "unseen cells south"));
    }
    throw new Error(`the fake model does not know this prompt:\n${prompt.user}`);
  };
  return { client, prompts };
}

function ballTalker(): { client: ModelClient; prompts: Prompt[] } {
  const prompts: Prompt[] = [];
  let talks = 0;
  const client: ModelClient = async (prompt) => {
    prompts.push(prompt);
    switch (prompt.user.match(/^Map (\w+)/m)?.[1]) {
      case "PalletTown_PlayersHouse_2F":
        return reply(target(prompt, "stairs"));
      case "PalletTown_PlayersHouse_1F":
        return reply(target(prompt, "exit mat", "unseen cells south"));
      case "PalletTown":
        return reply(target(prompt, "door at \\(16, 13\\)", "unseen cells east", "unseen cells south"));
      case "PalletTown_ProfessorOaksLab": {
        const ball = prompt.user.match(/^([A-Z]+)\. ITEM BALL at \(9, 4\)/m)?.[1];
        if (!ball) return reply(target(prompt, "unseen cells north"));
        if (talks++ >= 3) break;
        return reply(`go ${ball}`);
      }
    }
    return { ...reply("go 1"), content: "I stop here." };
  };
  return { client, prompts };
}

function noteTaker(...actions: string[]): { client: ModelClient; summaryPrompts: Prompt[] } {
  const summaryPrompts: Prompt[] = [];
  let calls = 0;
  const client: ModelClient = async (prompt, format) => {
    if (format?.name === "summary") {
      summaryPrompts.push(prompt);
      const parts = [...prompt.user.matchAll(/^#([\d-]+): /gm)].map((m) => m[1]);
      return { content: JSON.stringify({ summary: `summary of ${parts.join(" and ")}` }), usage: { promptTokens: 100, completionTokens: 20, reasoningTokens: 0, cost: COST } };
    }
    calls++;
    return reply(actions[Math.min(calls - 1, actions.length - 1)], "Leave the house", `fact ${calls}`);
  };
  return { client, summaryPrompts };
}

function partyPlayer(): { client: ModelClient; prompts: Prompt[] } {
  const prompts: Prompt[] = [];
  const battleActions = ["switch squirtle", "switch 1"];
  let swapped = false;
  let walks = 0;
  let sent = false;
  const client: ModelClient = async (prompt) => {
    prompts.push(prompt);
    const now = waitedFor(prompt);
    if (sent) return { ...reply("go 1"), content: "I stop here." };
    if (now.startsWith("a walk")) {
      if (swapped) return reply(walks++ % 2 ? "goTo 12 2 Route1" : "goTo 12 30 Route1");
      swapped = true;
      return reply("swap SQUIRTLE SHELL");
    }
    if (now.startsWith("a battle action")) return reply(battleActions.shift() ?? "fight 0");
    if (now.startsWith("a choice")) return reply("choose YES");
    if (now.startsWith("a Pokémon in the party menu")) {
      sent = true;
      return reply("send SQUIRTLE");
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

describe("the guard of an uncovered screen", () => {
  test("the Run is at an unknown screen when the bot pressed B for 3 uncovered screens with no Model call between them", () => {
    const uncovered: RunEvent[] = [
      { type: "action", frame: 0, action: { name: "readText" }, result: { status: "impossible", reason: "the game is busy", frames: 3600, text: [] } },
      ...Array.from({ length: 3 }, (): RunEvent => ({ type: "action", frame: 0, action: { name: "press", button: "B" }, result: { status: "done", frames: 2 } })),
    ];
    const call = { type: "model", frame: 0 } as RunEvent;
    expect([unknownScreen([...uncovered, call, ...uncovered, ...uncovered]), unknownScreen([...uncovered, ...uncovered, ...uncovered])]).toEqual([false, true]);
  });
});

describe.skipIf(!ready)("model bot", () => {
  test("with a fake model, it plays past the first rival battle: the code reads the texts, the model chooses at each walk, choice and battle action, and the next Milestone in the prompt moves with the story", async () => {
    const { client, prompts } = fakeModel();
    const seen: string[] = [];
    const harness = await Harness.open({
      onModelCallStart: () => seen.push("thinks"),
      onModelCall: (event) => seen.push(`answer ${event.decision?.action}`),
      onAction: ({ action }) => seen.push(action.name),
    });
    const costLimit = (DECISIONS.length + 1.5) * COST;
    const result = await harness.play(modelBot({ id: "fake/model", costLimit }, () => client));
    expect(result).toMatchObject({ endReason: "cost limit", milestones: ["has-pokemon", "first-rival-battle"], rawInputs: 0 });

    const calls = modelEvents(harness);
    expect(calls.map((e) => e.decision?.action)).toEqual([...DECISIONS, ...AFTER_RIVAL]);
    const next = prompts.map((p) => p.user.match(/^Next Milestone: (.+)$/m)?.[1]);
    expect([...new Set(next)]).toEqual([
      "Get your first Pokémon from Professor Oak in Pallet Town.",
      "Battle your rival for the first time, in Professor Oak's lab in Pallet Town.",
      "Get OAK'S PARCEL in Viridian City and bring it back to Professor Oak.",
    ]);
    expect(prompts).toHaveLength(calls.length);
    const totals = modelTotals(harness.events);
    expect(totals).toMatchObject({ calls: calls.length, promptTokens: calls.length * 1000, completionTokens: calls.length * 30, reasoningTokens: 0 });
    expect(totals.cost).toBeCloseTo(calls.length * COST, 10);
    for (const [i, call] of calls.entries()) {
      expect(call).toMatchObject({ model: "fake/model", prompt: prompts[i], error: null, usage: { cost: COST } });
      expect(call.answer).toBe(reply(call.decision?.action ?? "").content);
      expect(call.latencyMs).toBeGreaterThanOrEqual(0);
    }
    expect(seen.slice(0, 4)).toEqual(["thinks", "answer go A", "goTo", "thinks"]);
    expect(seen.filter((s) => s === "thinks")).toHaveLength(calls.length);
    expect(harness.actions.filter((e) => e.action.name === "readText").length).toBeGreaterThan(10);
    const titles = calls.flatMap((_, i) => modelPanelView(harness.events, 0, i).call?.blocks.map((b) => b.title) ?? []);
    expect(titles).not.toContain("Other");
    expect(titles).toEqual(expect.arrayContaining(["Local view", "Battle", "Actions", "Rules"]));

    const first = (pattern: RegExp) => {
      const prompt = prompts.find((p) => pattern.test(p.user));
      if (!prompt) throw new Error(`no prompt matches ${pattern}`);
      return prompt.user;
    };
    expect(prompts[0].system).toContain("Become the Champion: earn the 8 gym badges, then beat the Elite Four");
    expect(prompts[0].system).toContain("Choose your first Pokémon as you like: BULBASAUR, CHARMANDER or SQUIRTLE. There is no correct answer.");
    expect(prompts[0].system).not.toContain("answer NO");
    expect(prompts[0].system).toContain("When your last decisions give nothing new, do not do them again");
    expect(prompts[0].system).toContain("heal your Pokémon at a Pokémon Center");
    expect(prompts[0].system).not.toMatch(/goal of this run|rival|Oak/i);
    expect(prompts[0].user).toContain("Map PalletTown_PlayersHouse_2F");
    expect(prompts[1].user).toMatch(/You chose: go A\n +goTo\(10, 2\): done/);
    const pallet = first(/^Map PalletTown:/m);
    expect(pallet).toMatch(/^A\. door at \(6, 7\), adjacent north: to PalletTown_PlayersHouse_1F, taken$/m);
    expect(pallet).toMatch(/^[A-Z]\. unseen cells north of \(\d+, \d+\), /m);
    expect(pallet).toMatch(/^- A \(door\) leads to PalletTown_PlayersHouse_1F\. /m);
    const choice = first(/^The game asks: "Hm! SQUIRTLE is your choice\..*SQUIRTLE\?" Choose YES or NO\.$/m);
    expect(choice).toContain('"Hm! SQUIRTLE is your choice.');
    expect(choice).toContain("Objective: Get a Pokémon");
    expect(choice).toMatch(/^Mission: Get my first Pokémon \(the same for \d+ decisions\)\.$/m);
    expect(choice).toContain("Memory tree: none yet.");
    expect(choice).toMatch(/Actions:\n- choose YES\n- choose NO\n- zoom <a-b>: .*$/);
    expect(choice).not.toContain("goTo <x> <y>");
    const battle = first(/^The game waits for a battle action\.$/m);
    expect(battle).toContain("- fight 1: TAIL WHIP (NORMAL, power ---, accuracy 100, PP 30/30)");
    expect(battle).toContain("Foe BULBASAUR (GRASS, POISON): level 5, HP 100%");
    expect(battle).toMatch(/^1\. SQUIRTLE: level 5, HP \d+\/\d+, status none\. Type WATER\. Ability TORRENT: Ups WATER moves in a pinch\. Held item none\. Nature [A-Z]+\. Stats: attack \d+, defense \d+, speed \d+, special attack \d+, special defense \d+\. EXP 135, 44 to the next level\.$/m);
    expect(battle).toContain("  - TAIL WHIP: NORMAL, power ---, accuracy 100, PP 30/30. The user wags its tail cutely, making the foe lower its DEFENSE stat.");

    const { header } = harness.record();
    expect(header.bot).toEqual({ name: "model", version: "10", model: { id: "fake/model", costLimit, reasoning: "low", temperature: null, starter: "free", stopAtWhiteout: true } });
  });

  test("the Run ends with cost limit, with no error and with a Run record, when its cost is more than the cost limit; a starter of the Run and the stop at a whiteout are in the rules", async () => {
    const harness = await Harness.open();
    const bot = modelBot({ costLimit: 2.5 * COST, starter: "CHARMANDER" }, () => answers(reply("goTo 8 6").content));
    expect(await harness.play(bot)).toMatchObject({ endReason: "cost limit" });
    expect(harness.record().result.endReason).toBe("cost limit");
    expect(modelEvents(harness)).toHaveLength(3);
    expect(modelEvents(harness)[0].prompt.system).toContain("Choose CHARMANDER as your first Pokémon.\nIf all your Pokémon faint, the Run ends, and you cannot try again.");
  });

  test("it stops after 3 answers in a row that it cannot read; at the same Decision point, the next call has that answer and the error", async () => {
    const harness = await Harness.open();
    const good = reply("goTo 8 6").content;
    const bot = modelBot({ costLimit: 1 }, () => answers("I go north", good, "{}", JSON.stringify({ ...JSON.parse(good), action: "dance" }), "not JSON either"));
    await expect(harness.play(bot)).rejects.toThrow("3 answers in a row that the Bot cannot read; the last one: the answer is not JSON");
    const calls = modelEvents(harness);
    expect(calls.map((e) => e.error)).toEqual(["the answer is not JSON", null, 'the answer has no string "reason"', '"dance" is not an action', "the answer is not JSON"]);
    expect(calls.map((e) => e.decision === null)).toEqual([true, false, true, true, true]);
    expect(calls[1].prompt).toEqual({ ...calls[0].prompt, turns: [{ assistant: "I go north", user: expect.stringContaining("Your answer could not be read: the answer is not JSON.") }] });
    expect(calls[2].prompt.turns).toBeUndefined();
    expect(calls[2].prompt.user).toContain("Your answer could not be read: the answer is not JSON");
    expect(calls[4].prompt.turns?.map((t) => t.assistant)).toEqual(["{}", JSON.stringify({ ...JSON.parse(good), action: "dance" })]);
  });

  test("a Run continues a stopped Run: the replay gives the same game and events, the new model sees the Mission of the parent, and the cost limit and the unreadable answers count from the continuation", async () => {
    const parent = await Harness.open();
    const good = reply("goTo 8 6").content;
    await expect(parent.play(modelBot({ costLimit: 1 }, () => answers(good, "x", "y", "z")))).rejects.toThrow("3 answers in a row that the Bot cannot read");
    const record = parent.record();

    const harness = await Harness.open({ parent: { name: "parent.json", record } });
    expect(harness.frame).toBe(parent.frame);
    expect(harness.screenHash()).toBe(parent.screenHash());
    expect(harness.events).toEqual(record.events);
    expect(harness.observe()).toEqual(parent.observe());
    const parentFrame = parent.frame;
    const parentCalls = modelEvents(parent).length;
    parent.close();

    const { client, prompts } = { prompts: [] as Prompt[], client: answers("not JSON", good) };
    const recording: ModelClient = async (prompt, format) => {
      prompts.push(prompt);
      return client(prompt, format);
    };
    expect(await harness.play(modelBot({ id: "other/model", costLimit: 2.5 * COST }, () => recording))).toMatchObject({ endReason: "cost limit" });
    const calls = modelEvents(harness).slice(parentCalls);
    expect(calls.map((e) => [e.model, e.error === null])).toEqual([["other/model", false], ["other/model", true], ["other/model", true]]);
    expect(prompts[0].user).toContain("Mission: Get my first Pokémon");

    const continued = harness.record();
    expect(continued.header).toMatchObject({ parent: "parent.json", bot: { model: { id: "other/model" } } });
    expect(continued.events.slice(0, record.events.length)).toEqual(record.events);
    expect(continued.result.frames).toBe(record.result.frames + harness.frame - parentFrame);
    const replayed = await replay(continued);
    expect([replayed.frame, replayed.screen]).toEqual([harness.frame, harness.screenHash()]);
    await expect(Harness.open({ parent: { name: "parent.json", record: { ...record, header: { ...record.header, seed: 1 } } } })).rejects.toThrow("the Run record does not replay here: different seed");
  });

  test("after an impossible action, the conversation goes on with the reason of the Harness and the exits of the map; after 3 in a row, a new conversation starts", async () => {
    const harness = await Harness.open();
    const outside = ["goTo 6 20", "goTo 6 9", "goTo 6 30"].map((action) => reply(action).content);
    await expect(harness.play(modelBot({ costLimit: 1 }, () => answers(...outside, "?")))).rejects.toThrow("3 answers in a row that the Bot cannot read");
    const calls = modelEvents(harness);
    expect(calls[1].prompt.user).toBe(calls[0].prompt.user);
    expect(calls[1].prompt.turns).toEqual([{ assistant: outside[0], user: expect.stringContaining('Your action "goTo 6 20" is impossible: (6, 20) is outside PalletTown_PlayersHouse_2F; the cells of PalletTown_PlayersHouse_2F are x from 0 to 11, y from 0 to 8. The player did not move.') }]);
    expect(calls[1].prompt.turns?.[0].user).toMatch(/^To leave this map, go to one of its exits \(go <letter>\):\nA\. stairs at /m);
    expect(calls[2].prompt.turns?.map((t) => t.user)).toEqual([calls[1].prompt.turns?.[0].user, expect.stringContaining("no map connects to the south edge of PalletTown_PlayersHouse_2F")]);
    expect(calls[3].prompt.turns).toBeUndefined();
    expect(calls[3].prompt.user).toContain("goTo(6, 30) ×1: impossible ((6, 30) is outside PalletTown_PlayersHouse_2F");
  });

  test("viewAtlas runs no frames: the code continues the same conversation, the answer and the full Atlas in a new user message; a second viewAtlas is refused; the next frame starts a new conversation", async () => {
    const harness = await Harness.open();
    const viewAtlas = reply("viewAtlas").content;
    const bot = modelBot({ costLimit: 3.5 * COST }, () => answers(viewAtlas, viewAtlas, reply("goTo 8 6").content));
    expect(await harness.play(bot)).toMatchObject({ endReason: "cost limit" });
    const calls = modelEvents(harness);
    expect(calls.map((e) => e.decision?.action)).toEqual(["viewAtlas", undefined, "goTo 8 6", "goTo 8 6"]);
    expect(calls[1].error).toBe('"viewAtlas" is not an action now: use go, goTo, zoom or press');
    expect(calls.slice(0, 3).map((e) => e.frame)).toEqual([calls[0].frame, calls[0].frame, calls[0].frame]);
    expect(calls[3].frame).toBeGreaterThan(calls[0].frame);
    const third = harness.events.indexOf(calls[2]);
    expect(harness.events.slice(harness.events.indexOf(calls[0]), third).every((e) => e.type === "model")).toBe(true);
    const fullAtlas = "Full Atlas, the other maps that you know, nearest first:";
    expect(calls.map((e) => e.prompt.user.includes(fullAtlas))).toEqual([false, false, false, false]);
    expect(calls.map((e) => /^- viewAtlas/m.test(e.prompt.user))).toEqual([true, true, true, true]);
    expect(calls[1].prompt).toEqual({ ...calls[0].prompt, turns: [{ assistant: viewAtlas, user: expect.stringContaining(fullAtlas) }] });
    expect(calls[2].prompt.turns).toEqual([
      { assistant: viewAtlas, user: calls[1].prompt.turns?.[0].user },
      { assistant: viewAtlas, user: expect.stringContaining('"viewAtlas" is not an action now: use go, goTo, zoom or press') },
    ]);
    expect(calls[2].prompt.user).toBe(calls[0].prompt.user);
    expect(calls[3].prompt.turns).toBeUndefined();
  });

  test("the prompt lists the tries since the last progress: after the first talk to a Poké Ball (a new text), the next two talks are one line with ×2 and the text; the rival has its name from the save", async () => {
    const harness = await Harness.open();
    const { client, prompts } = ballTalker();
    await expect(harness.play(modelBot({ costLimit: 1 }, () => client))).rejects.toThrow("3 answers in a row that the Bot cannot read");
    const lab = prompts.filter((p) => /^Map PalletTown_ProfessorOaksLab:/m.test(p.user)).map((p) => p.user);
    expect(lab.filter((user) => /^[A-Z]+\. BOB \(your rival\) at \(5, 4\), /m.test(user)).length).toBeGreaterThan(0);
    expect(lab.filter((user) => user.includes("BLUE"))).toEqual([]);
    const afterTalks = lab.findLast((user) => /^- interact\(9, 4\)/m.test(user)) ?? "";
    expect(afterTalks.match(/^- interact\(9, 4\).*$/gm)).toEqual([expect.stringMatching(/^- interact\(9, 4\) ×2: ".+"$/)]);
    expect(afterTalks).toContain("Decision points since your last progress (a new map, a new Milestone, a new exit seen, a level up or a new text of a person): 2.");
    expect(modelEvents(harness).find((e) => e.prompt.user === afterTalks)).toMatchObject({ stuck: 2, reflection: false });
  });

  test("each merge of the Memory tree makes one Summary call at the same Decision point, a summary event whose cost counts against the cost limit; the prompt shows the top nodes", async () => {
    const harness = await Harness.open();
    const { client, summaryPrompts } = noteTaker("goTo 8 6");
    await harness.play(modelBot({ costLimit: 7.5 * COST }, () => client)).catch(() => {});
    const calls = modelEvents(harness);
    const summaries = harness.events.filter((e): e is SummaryEvent => e.type === "summary");
    expect(calls).toHaveLength(5);
    expect(summaries.map((e) => `${e.from}-${e.to}: ${e.summary}`)).toEqual(["1-2: summary of 1 and 2", "3-4: summary of 3 and 4", "1-4: summary of 1-2 and 3-4"]);
    expect(modelTotals(harness.events).cost).toBeCloseTo(8 * COST, 10);
    const second = harness.events.indexOf(calls[1]);
    expect(harness.events[second + 1]).toMatchObject({ type: "summary", frame: calls[1].frame, model: calls[1].model, prompt: summaryPrompts[0], error: null, usage: { cost: COST } });
    expect(summaries[0].answer).toBe(JSON.stringify({ summary: "summary of 1 and 2" }));
    expect(summaries[0].latencyMs).toBeGreaterThanOrEqual(0);
    expect(summaryPrompts[2].user).toContain("#1-2: summary of 1 and 2\n#3-4: summary of 3 and 4");
    expect(calls[2].prompt.user).toContain("Memory tree, the top nodes (zoom <a-b> opens a node):\n#1-2: summary of 1 and 2");
    expect(calls[4].prompt.user).toContain("Memory tree, the top nodes (zoom <a-b> opens a node):\n#1-4: summary of 1-2 and 3-4\n\n");
  });

  test("zoom runs no frames: the code continues the same conversation, with the two halves of the node in a new user message", async () => {
    const harness = await Harness.open();
    const { client } = noteTaker("goTo 8 6", "goTo 8 6", "zoom 1-2", "zoom 5-6", "goTo 8 6");
    await harness.play(modelBot({ costLimit: 7.5 * COST }, () => client)).catch(() => {});
    const calls = modelEvents(harness);
    expect(calls.map((e) => e.decision?.action)).toEqual(["goTo 8 6", "goTo 8 6", "zoom 1-2", "zoom 5-6", "goTo 8 6"]);
    expect(calls.slice(2).map((e) => e.frame)).toEqual([calls[2].frame, calls[2].frame, calls[2].frame]);
    expect(calls[3].prompt).toEqual({ ...calls[2].prompt, turns: [{ assistant: calls[2].answer ?? "", user: expect.stringContaining("Node #1-2, its two halves:\n#1: fact 1\n#2: fact 2") }] });
    expect(calls[4].prompt.turns?.[1].user).toContain("There is no node #5-6 with two halves");
  });

  test("on a screen that no Macro-action covers, as the withdraw list of the PC, the code presses B three times and tells the model", async () => {
    const harness = await Harness.open({ noProgressLimit: 30 });
    await harness.goTo(1, 2);
    await harness.interact(1, 1);
    await harness.readText();
    await harness.choose("ITEM STORAGE");
    let calls = 0;
    const client: ModelClient = async () => {
      if (calls++ > 0) return reply("goTo 8 6");
      await harness.press("A");
      return reply("leave");
    };
    await harness.play(modelBot({ costLimit: 1 }, () => client)).catch(() => {});
    expect(modelEvents(harness)[1].prompt.user).toContain("The game showed a screen that no action covers: the program pressed B 3 times.");
    expect(harness.actions.slice(4, 10).map((e) => e.action)).toEqual([
      { name: "press", button: "A" },
      { name: "leave" },
      { name: "readText" },
      { name: "press", button: "B" },
      { name: "press", button: "B" },
      { name: "press", button: "B" },
    ]);
  });

  test("go to a person who walks during the walk talks to that person at the new cell", async () => {
    const harness = await Harness.open();
    let chosen = null as string | null;
    const client: ModelClient = async (prompt) => {
      if (chosen) return reply("?");
      switch (prompt.user.match(/^Map (\w+)/m)?.[1]) {
        case "PalletTown_PlayersHouse_2F":
          return reply(target(prompt, "stairs"));
        case "PalletTown_PlayersHouse_1F":
          return reply(target(prompt, "exit mat", "unseen cells south"));
      }
      const man = prompt.user.match(/^([A-Z]+)\. (FAT MAN at \(\d+, \d+\))/m);
      if (!man) return reply(target(prompt, "unseen cells south"));
      chosen = man[2];
      return reply(`go ${man[1]}`);
    };
    await expect(harness.play(modelBot({ costLimit: 1 }, () => client))).rejects.toThrow("3 answers in a row that the Bot cannot read");
    expect(chosen).toBe("FAT MAN at (14, 17)");
    const talk = harness.actions.findIndex(({ action }) => action.name === "interact");
    expect(harness.actions.slice(talk - 2, talk + 2)).toMatchObject([
      { action: { name: "goTo", x: 13, y: 17 }, result: { status: "done" } },
      { action: { name: "goTo", x: 15, y: 17 }, result: { status: "done" } },
      { action: { name: "interact", x: 15, y: 18 }, result: { status: "done" } },
      { action: { name: "readText" }, result: { text: [expect.stringContaining("Technology is incredible!")] } },
    ]);
  });
});

const PARTY_SAVE = join(SAVES_DIR, "test-party.sav");

describe.skipIf(!existsSync(ROM_FILE) || !existsSync(PARTY_SAVE))("model bot with 2 Pokémon", () => {
  test("the model swaps its Pokémon on a walk, switches them in a battle, and after a faint answers YES and sends a Pokémon, by name or by place", async () => {
    const harness = await Harness.open({ startSave: PARTY_SAVE });
    const { client, prompts } = partyPlayer();
    await expect(harness.play(modelBot({ costLimit: 1 }, () => client))).rejects.toThrow("3 answers in a row that the Bot cannot read");
    const party = harness.actions.filter(({ action }) => ["swap", "switch", "send", "choose"].includes(action.name));
    expect(party.map(({ action, result }) => [action, result.status])).toEqual([
      [{ name: "swap", first: 0, second: 1 }, "done"],
      [{ name: "switch", slot: 1 }, "done"],
      [{ name: "switch", slot: 0 }, "done"],
      [{ name: "choose", option: "YES" }, "done"],
      [{ name: "send", slot: 1 }, "done"],
    ]);
    expect(harness.rawInputs).toBe(0);
    const users = prompts.map((p) => p.user);
    expect(users[0]).toContain("- swap <Pokémon> <Pokémon>: change the order of two Pokémon of your party.");
    expect(users.find((user) => user.includes("The game waits for a battle action."))).toContain("- switch <Pokémon>: take your Pokémon out of the battle and send this one. <Pokémon> can be 2 SQUIRTLE.");
    expect(users.find((user) => user.includes('" Choose YES or NO.'))).toMatch(/^Battle against a wild Pokémon\.$/m);
    expect(users.find((user) => user.includes("The game waits for a Pokémon in the party menu"))).toContain("- send <Pokémon>: send this Pokémon into the battle. <Pokémon> can be 2 SQUIRTLE.");
  });
});

const MART_SAVE = join(SAVES_DIR, "test-mart.sav");

describe.skipIf(!existsSync(ROM_FILE) || !existsSync(MART_SAVE))("model bot at a counter", () => {
  test("go to a person behind a counter walks to the front of the counter and talks across it", async () => {
    const harness = await Harness.open({ startSave: MART_SAVE });
    const prompts: Prompt[] = [];
    const client: ModelClient = async (prompt) => {
      prompts.push(prompt);
      if (prompts.length === 1) return reply("goTo 4 5");
      if (prompts.length === 2) return reply(target(prompt, "CLERK"));
      return reply("?");
    };
    await expect(harness.play(modelBot({ costLimit: 1 }, () => client))).rejects.toThrow("3 answers in a row that the Bot cannot read");
    // The counter of this Mart has an L shape: (3, 3) and (2, 4) are both counter cells next to the clerk.
    expect(harness.actions.find(({ action }) => action.name === "interact")).toMatchObject({ action: { x: 2, y: 4 }, result: { status: "done" } });
    expect(prompts.at(-1)?.user).toContain("The game waits for the shop menu of a Poké Mart.");
  });
});
