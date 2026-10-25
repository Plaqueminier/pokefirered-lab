import { afterAll, beforeAll, describe, expect, setDefaultTimeout, spyOn, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { modelBot } from "../../bots/model";
import { Harness } from "../harness/harness";
import { type ModelEvent, modelTotals, type Prompt } from "../harness/record";
import { ROM_FILE, SAVES_DIR, START_SAVE } from "../run";
import { modelPanelView } from "../../viewer/model-panel";
import type { ModelClient } from "./openrouter";

const ready = existsSync(ROM_FILE) && existsSync(START_SAVE);
setDefaultTimeout(60_000);
const COST = 0.001;
const AFTER_RIVAL = ["go 1", "go 4"];
const DECISIONS = ["go 1", "go 2", "go 1", "go 2", "go 2", "go 7", "choose YES", "choose NO", "go 1", "fight 1", "fight 0", "fight 0", "fight 0", "fight 0", "fight 0", "fight 0"];

function reply(action: string, objective = "Get a Pokémon") {
  return { content: JSON.stringify({ reason: `I choose ${action}.`, action, mission: "Get my first Pokémon", objective, notes: "Oak is in his lab." }), usage: { promptTokens: 1000, completionTokens: 30, reasoningTokens: 0, cost: COST } };
}

function target(prompt: Prompt, ...labels: string[]): string {
  for (const label of labels) {
    const n = prompt.user.match(new RegExp(`^(\\d+)\\. ${label}`, "m"))?.[1];
    if (n) return `go ${n}`;
  }
  throw new Error(`no target "${labels.join('" or "')}" in the prompt:\n${prompt.user}`);
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
        const ball = prompt.user.match(/^(\d+)\. ITEM BALL at \(9, 4\)$/m)?.[1];
        if (!ball) return reply(target(prompt, "unseen cells north"));
        if (talks++ >= 3) break;
        return reply(`go ${ball}`);
      }
    }
    return { ...reply("go 1"), content: "I stop here." };
  };
  return { client, prompts };
}

// On the test Starting save with SQUIRTLE and SHELL (1 HP): swap them, walk in the grass, switch two times, then send SQUIRTLE after the faint of SHELL.
function partyPlayer(): { client: ModelClient; prompts: Prompt[] } {
  const prompts: Prompt[] = [];
  const battleActions = ["switch squirtle", "switch 1"];
  let swapped = false;
  let walks = 0;
  let sent = false;
  const client: ModelClient = async (prompt) => {
    prompts.push(prompt);
    const now = prompt.user.match(/^The game waits for (.+)$/m)?.[1] ?? "";
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
      "Get the Pokédex from Professor Oak in Pallet Town.",
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
    expect(seen.slice(0, 4)).toEqual(["thinks", "answer go 1", "goTo", "thinks"]);
    expect(seen.filter((s) => s === "thinks")).toHaveLength(calls.length);
    expect(harness.actions.filter((e) => e.action.name === "readText").length).toBeGreaterThan(10);
    const titles = calls.flatMap((_, i) => modelPanelView(harness.events, 0, i).call?.blocks.map((b) => b.title) ?? []);
    expect(titles).not.toContain("Other");
    expect(titles).toEqual(expect.arrayContaining(["Local view", "Question", "Battle", "Actions", "Rules"]));

    const first = (pattern: RegExp) => {
      const prompt = prompts.find((p) => pattern.test(p.user));
      if (!prompt) throw new Error(`no prompt matches ${pattern}`);
      return prompt.user;
    };
    expect(prompts[0].system).toContain("Become the Champion: earn the 8 gym badges, then beat the Elite Four");
    expect(prompts[0].system).toContain("Choose your first Pokémon as you like: BULBASAUR, CHARMANDER or SQUIRTLE. There is no correct answer.");
    expect(prompts[0].system).toContain("answer NO");
    expect(prompts[0].system).toContain("When your last decisions give nothing new, do not do them again");
    expect(prompts[0].system).toContain("heal your Pokémon at a Pokémon Center");
    expect(prompts[0].system).not.toMatch(/goal of this run|rival|Oak/i);
    expect(prompts[0].user).toContain("Map PalletTown_PlayersHouse_2F");
    expect(prompts[1].user).toMatch(/You chose: go 1\n +goTo\(10, 2\): done/);
    const pallet = first(/^Map PalletTown,/m);
    expect(pallet).toMatch(/^\d+\. door at \(6, 7\), to PalletTown_PlayersHouse_1F$/m);
    expect(pallet).toMatch(/^\d+\. unseen cells north of \(\d+, \d+\)$/m);
    expect(pallet).toMatch(/^- PalletTown_PlayersHouse_1F: /m);
    const choice = first(/^The game waits for a choice: YES, NO\.$/m);
    expect(choice).toContain('"Hm! SQUIRTLE is your choice.');
    expect(choice).toContain("Objective: Get a Pokémon");
    expect(choice).toMatch(/^Mission: Get my first Pokémon \(the same for \d+ decisions\)\.$/m);
    expect(choice).toContain("Notes: Oak is in his lab.");
    expect(choice).toMatch(/Actions:\n- choose YES\n- choose NO\n- press <button>/);
    expect(choice).not.toContain("goTo <x> <y>");
    const battle = first(/^The game waits for a battle action\.$/m);
    expect(battle).toContain("- fight 1: TAIL WHIP (NORMAL, power ---, accuracy 100, PP 30/30)");
    expect(battle).toContain("Foe BULBASAUR (GRASS, POISON): level 5, HP 100%");
    expect(battle).toMatch(/^- SQUIRTLE: level 5, HP \d+\/\d+, status none\. Type WATER\. Ability TORRENT: Ups WATER moves in a pinch\. Held item none\. Nature [A-Z]+\. Stats: attack \d+, defense \d+, speed \d+, special attack \d+, special defense \d+\. EXP 135, 44 to the next level\.$/m);
    expect(battle).toContain("  - TAIL WHIP: NORMAL, power ---, accuracy 100, PP 30/30. The user wags its tail cutely, making the foe lower its DEFENSE stat.");

    const { header } = harness.record();
    expect(header.bot).toEqual({ name: "model", version: "2", model: { id: "fake/model", costLimit, reasoning: "low", temperature: null, starter: "free" } });
  });

  test("the Run ends with cost limit, with no error and with a Run record, when its cost is more than the cost limit; a starter of the Run goes into the rules", async () => {
    const harness = await Harness.open();
    const bot = modelBot({ costLimit: 2.5 * COST, starter: "CHARMANDER" }, () => answers(reply("goTo 8 6").content));
    expect(await harness.play(bot)).toMatchObject({ endReason: "cost limit" });
    expect(harness.record().result.endReason).toBe("cost limit");
    expect(modelEvents(harness)).toHaveLength(3);
    expect(modelEvents(harness)[0].prompt.system).toContain("Choose CHARMANDER as your first Pokémon.");
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

  test("viewAtlas runs no frames: the code goes on with the same conversation, the answer and the full Atlas in a new user message; a second viewAtlas is refused; the next frame starts a new conversation", async () => {
    const harness = await Harness.open();
    const viewAtlas = reply("viewAtlas").content;
    const bot = modelBot({ costLimit: 3.5 * COST }, () => answers(viewAtlas, viewAtlas, reply("goTo 8 6").content));
    expect(await harness.play(bot)).toMatchObject({ endReason: "cost limit" });
    const calls = modelEvents(harness);
    expect(calls.map((e) => e.decision?.action)).toEqual(["viewAtlas", undefined, "goTo 8 6", "goTo 8 6"]);
    expect(calls[1].error).toBe('"viewAtlas" is not an action now: use go, goTo or press');
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
      { assistant: viewAtlas, user: expect.stringContaining('"viewAtlas" is not an action now: use go, goTo or press') },
    ]);
    expect(calls[2].prompt.user).toBe(calls[0].prompt.user);
    expect(calls[3].prompt.turns).toBeUndefined();
  });

  test("the prompt lists the tries since the last progress: three talks to the same Poké Ball are one line with ×3 and the text; the rival has its name from the save", async () => {
    const harness = await Harness.open();
    const { client, prompts } = ballTalker();
    await expect(harness.play(modelBot({ costLimit: 1 }, () => client))).rejects.toThrow("3 answers in a row that the Bot cannot read");
    const lab = prompts.filter((p) => /^Map PalletTown_ProfessorOaksLab,/m.test(p.user)).map((p) => p.user);
    expect(lab.filter((user) => /^\d+\. BOB \(your rival\) at \(5, 4\)$/m.test(user)).length).toBeGreaterThan(0);
    expect(lab.filter((user) => user.includes("BLUE"))).toEqual([]);
    const afterTalks = lab.findLast((user) => /^- interact\(9, 4\)/m.test(user)) ?? "";
    expect(afterTalks.match(/^- interact\(9, 4\).*$/gm)).toEqual([expect.stringMatching(/^- interact\(9, 4\) ×3: ".+"$/)]);
    expect(afterTalks).toMatch(/^Decision points with no progress: [1-9]\d*\.$/m);
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

// A test Starting save in Pallet Town after the rival battle: SQUIRTLE, then SHELL, a SQUIRTLE with 1 HP.
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
    expect(users.find((user) => user.includes("The game waits for a battle action."))).toContain("- switch <Pokémon>: take your Pokémon out of the battle and send this one. It can be SQUIRTLE.");
    expect(users.find((user) => user.includes("The game waits for a choice: YES, NO."))).toMatch(/^Battle against a wild Pokémon\.$/m);
    expect(users.find((user) => user.includes("The game waits for a Pokémon in the party menu"))).toContain("- send <Pokémon>: send this Pokémon into the battle. It can be SQUIRTLE.");
  });
});
