import { afterAll, beforeAll, describe, expect, setDefaultTimeout, spyOn, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { canWalkAgain, modelBot, unknownScreen, walkGoesOn } from "../../bots/model";
import { Harness } from "../harness/harness";
import { type ModelEvent, type ModelSettings, modelTotals, type Prompt, type RunEvent, replay, type SummaryEvent } from "../harness/record";
import { ROM_FILE, SAVES_DIR, START_SAVE } from "../run";
import { modelPanelView } from "../../viewer/model-calls";
import type { PartyMon } from "../party";
import type { ModelClient } from "./openrouter";
import { PlanLimitError } from "./providers";

const ready = existsSync(ROM_FILE) && existsSync(START_SAVE);
setDefaultTimeout(60_000);
const COST = 0.001;
const AFTER_RIVAL = ["go A", "go C"];
const DECISIONS = ["go A", "go B", "go B", "go D", "go B", "go K", "name Shelly", "go A", "fight 1", "fight 0", "fight 0", "fight 0"];

const CHARACTER = "Spices as nicknames. A loud fan of water.";

function reply(action: string, objective = "Get a Pokémon", note = "") {
  return { content: JSON.stringify({ reason: `I choose ${action}.`, action, mission: "Get my first Pokémon", objective, note, character: CHARACTER, starter: "SQUIRTLE", name: "PLOK", rival: "BOB" }), usage: { promptTokens: 1000, completionTokens: 30, reasoningTokens: 0, cost: COST } };
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
    if (now.startsWith("a name")) return reply("name Shelly");
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
  const client: ModelClient = async (prompt, options) => {
    if (options?.format?.name === "summary") {
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

describe("the guard of a walk after a wild battle", () => {
  const tackle = { power: 35, fixedDamage: false, pp: 10 };
  const mon = (more: object = {}) => ({ hp: 20, maxHp: 30, status: "none", moves: [tackle], ...more }) as unknown as PartyMon;

  test("the walk goes on with a healthy first Pokémon", () => {
    expect(walkGoesOn([mon()], 0)).toBe(true);
    expect(walkGoesOn([mon({ hp: 0 }), mon()], 1)).toBe(true);
  });

  test("the model chooses after a faint, with a status, with less than half of the HP, or with no damage move with PP", () => {
    expect(walkGoesOn([mon({ hp: 0 }), mon()], 0)).toBe(false);
    expect(walkGoesOn([mon({ status: "poison" })], 0)).toBe(false);
    expect(walkGoesOn([mon({ hp: 14 })], 0)).toBe(false);
    expect(walkGoesOn([mon({ moves: [{ ...tackle, pp: 0 }] })], 0)).toBe(false);
    expect(walkGoesOn([mon({ moves: [{ power: null, fixedDamage: false, pp: 40 }] })], 0)).toBe(false);
  });
});

describe("the walks that continue after a wild battle", () => {
  const asked = (kind: string, dark = false) => ({ view: { targets: [{ kind }] }, overworld: { map: { name: "Cave" }, atlas: { maps: [{ name: "Cave", ...(dark ? { dark: {} } : {}) }] } } }) as unknown as Parameters<typeof canWalkAgain>[1];
  const go = { name: "go", target: 0 } as const;

  test("a target that names its map continues on another map; the other targets and a goTo with no map need the map of the prompt", () => {
    expect(canWalkAgain(go, asked("lead"), "Other")).toBe(true);
    expect(canWalkAgain(go, asked("map"), "Other")).toBe(true);
    expect(canWalkAgain({ name: "goTo", x: 1, y: 1, map: "Far" }, asked("exit"), "Other")).toBe(true);
    expect(canWalkAgain({ name: "goTo", x: 1, y: 1 }, asked("exit"), "Other")).toBe(false);
    expect(canWalkAgain(go, asked("exit"), "Other")).toBe(false);
    expect(canWalkAgain(go, asked("exit"), "Cave")).toBe(true);
  });

  test("a walk into unseen cells on a dark map stops, and an action that is no walk does not continue", () => {
    expect(canWalkAgain(go, asked("frontier", true), "Cave")).toBe(false);
    expect(canWalkAgain(go, asked("frontier"), "Cave")).toBe(true);
    expect(canWalkAgain({ name: "fight", move: 0 }, asked("exit"), "Cave")).toBe(false);
  });
});

describe.skipIf(!ready)("model bot", () => {
  test("with a fake model, it plays past the first rival battle: the code reads the texts, the model chooses at each walk, choice and battle action, and the next Milestone in the prompt moves with the story", async () => {
    const { client, prompts } = fakeModel();
    const seen: string[] = [];
    const harness = await Harness.open({
      onCallStart: (kind) => kind === "model" && seen.push("thinks"),
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
      "Get the Pokédex.",
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
    const titles = calls.flatMap((_, i) => modelPanelView(harness.events, false, i).call?.blocks.map((b) => b.title) ?? []);
    expect(titles).not.toContain("Other");
    expect(titles).toEqual(expect.arrayContaining(["Local view", "Battle", "Actions", "Rules"]));

    const first = (pattern: RegExp) => {
      const prompt = prompts.find((p) => pattern.test(p.user));
      if (!prompt) throw new Error(`no prompt matches ${pattern}`);
      return prompt.user;
    };
    expect(prompts[0].system).toContain("Become the Champion: earn the 8 gym badges, then beat the Elite Four");
    expect(prompts[0].system).toContain("Take the first Pokémon that your character chose.");
    expect(prompts[0].system).not.toContain("answer NO");
    expect(prompts[0].system).toContain("When your last decisions give nothing new, do not do them again");
    expect(prompts[0].system).toContain("heal your Pokémon at a Pokémon Center");
    expect(prompts[0].system).not.toMatch(/goal of this run|rival|Oak/i);
    expect(prompts[0].user).toContain("Map PalletTown_PlayersHouse_2F");
    expect(prompts[1].user).toMatch(/You chose: go A\n +goTo\(10, 2\): done/);
    const pallet = first(/^Map PalletTown:/m);
    expect(pallet).toMatch(/^A\. door at \(6, 7\), adjacent north: a house, to PalletTown_PlayersHouse_1F \(4, 8\), taken; beyond it: nothing new$/m);
    expect(pallet).toMatch(/^[A-Z]\. unseen cells north of \(\d+, \d+\), /m);
    expect(pallet).toMatch(/^- A \(door\) leads to PalletTown_PlayersHouse_1F\. /m);
    expect(harness.actions.filter((e) => e.action.name === "choose").map((e) => "option" in e.action && e.action.option)).toEqual(["YES", "YES"]);
    const battle = first(/^The game waits for a battle action\.$/m);
    expect(battle).toContain("- fight 1: TAIL WHIP (NORMAL, power ---, accuracy 100, PP 30/30)");
    expect(battle).toContain("Foe BULBASAUR (GRASS, POISON): level 5, HP 100%");
    expect(battle).toMatch(/^1\. Shelly \(SQUIRTLE\): level 5, HP \d+\/\d+, status none\. Type WATER\. Ability TORRENT: Ups WATER moves in a pinch\. Held item none\. Nature [A-Z]+\. Stats: attack \d+, defense \d+, speed \d+, special attack \d+, special defense \d+\. EXP 135, 44 to the next level\.$/m);
    expect(battle).toContain("  - TAIL WHIP: NORMAL, power ---, accuracy 100, PP 30/30. The user wags its tail cutely, making the foe lower its DEFENSE stat.");

    const { header } = harness.record();
    expect(header.bot).toEqual({ name: "model", version: "36", model: { id: "fake/model", provider: "openrouter", costLimit, reasoning: "off", thinking: "medium", temperature: null, starter: "free", stopAtWhiteout: true } });
  });

  test("a stop ends the Model call that waits: the Run ends with user stop, and the record keeps the call with its error and no cost", async () => {
    let stop = false;
    const harness = await Harness.open({ stopAsked: () => stop });
    const client: ModelClient = (_prompt, options) =>
      new Promise((_resolve, reject) => {
        stop = true;
        options?.signal?.addEventListener("abort", () => reject(options.signal?.reason));
      });
    expect(await harness.play(modelBot({ costLimit: 1 }, () => client))).toMatchObject({ endReason: "user stop" });
    const calls = modelEvents(harness);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ answer: null, decision: null, error: "the request failed: a person stopped the Run", usage: { cost: 0 } });
  });

  test("the Run ends with cost limit, with no error and with a Run record, when its cost is more than the cost limit; a starter of the Run and the stop at a whiteout are in the rules", async () => {
    const harness = await Harness.open();
    const bot = modelBot({ costLimit: 2.5 * COST, starter: "CHARMANDER" }, () => answers(reply("goTo 8 6").content));
    expect(await harness.play(bot)).toMatchObject({ endReason: "cost limit" });
    expect(harness.record().result.endReason).toBe("cost limit");
    expect(modelEvents(harness)).toHaveLength(3);
    expect(modelEvents(harness)[0].prompt.system).toContain("Choose CHARMANDER as your first Pokémon.\nIf all your Pokémon faint, the Run ends.");
  });

  test("the character turn thinks, with the schema of the character, and the next calls do not; the record keeps the reasoning, and the next prompt has the character", async () => {
    const harness = await Harness.open();
    const asks: { format?: string; reasoning?: string }[] = [];
    const client: ModelClient = async (_prompt, options) => {
      asks.push({ format: options?.format?.name, reasoning: options?.reasoning });
      return { ...reply("goTo 8 6"), reasoning: "I think." };
    };
    await harness.play(modelBot({ costLimit: 3 * COST - COST / 2 }, () => client));
    expect(asks).toEqual([{ format: "character", reasoning: "medium" }, { format: "decision", reasoning: undefined }, { format: "decision", reasoning: undefined }]);
    const [first, second] = modelEvents(harness);
    expect(first.decision?.character).toBe(CHARACTER);
    expect(first.reasoning).toBe("I think.");
    expect(second.prompt.user).toContain(`Your character: ${CHARACTER} Your first Pokémon: SQUIRTLE.`);
  });

  describe("a Run with a Coach", () => {
    type Ask = { model: string; format?: string; reasoning?: string; advice: boolean };

    function coached(advice: string, client: (settings: ModelSettings) => ModelClient = (settings) => async () => {
      const { content, usage } = reply("goTo 8 6");
      return { content: JSON.stringify({ ...JSON.parse(content), advice: { team: `${advice} ${settings.id}`, shopping: "", progress: "", battles: "" } }), usage };
    }) {
      const asks: Ask[] = [];
      const connect = (settings: ModelSettings): ModelClient => {
        const answer = client(settings);
        return async (prompt, options) => {
          asks.push({ model: settings.id, format: options?.format?.name, reasoning: options?.reasoning, advice: JSON.stringify(options?.format?.schema ?? {}).includes('"advice"') });
          return answer(prompt, options);
        };
      };
      return { asks, connect };
    }

    test("the Coach plays the character turn at the thinking level and writes an advice; the player plays the next decisions and gets the advice", async () => {
      const harness = await Harness.open();
      const { asks, connect } = coached("Catch a second Pokémon.");
      await harness.play(modelBot({ id: "small", thinking: "high", coach: { id: "big" }, costLimit: 3 * COST - COST / 2 }, connect));
      expect(asks).toEqual([
        { model: "big", format: "character", reasoning: "high", advice: true },
        { model: "small", format: "decision", reasoning: undefined, advice: false },
        { model: "small", format: "decision", reasoning: undefined, advice: false },
      ]);
      const [first, second] = modelEvents(harness);
      expect(first).toMatchObject({ model: "big", decision: { advice: { team: "Catch a second Pokémon. big" } } });
      expect(first.prompt.user).toContain('- A smaller model plays the next decisions, about 20, until your next turn. It reads your advice at each of these decisions');
      expect(first.prompt.user).toContain('- Write in "advice" what it must do, in 4 parts');
      expect(first.prompt.system).toStartWith("You are the Coach of a smaller model");
      expect(second.prompt.system).toContain("A Coach, a bigger model");
      expect(second.model).toBe("small");
      expect(second.decision).not.toHaveProperty("advice");
      expect(second.prompt.user).toContain("- Team (character turn, 0 decisions ago): Catch a second Pokémon. big");
      expect(harness.record().header.bot.model?.coach).toEqual({ id: "big" });
    });

    test("the Coach writes the summaries of the Memory tree, and a Coach with the model of the player is no Coach", async () => {
      const summaries = async (coach: string) => {
        const notes = noteTaker("goTo 8 6");
        const harness = await Harness.open();
        const { asks, connect } = coached("", () => notes.client);
        await harness.play(modelBot({ id: "small", coach: { id: coach }, costLimit: 3.5 * COST }, connect)).catch(() => {});
        return { asks, events: harness.events.filter((e): e is SummaryEvent => e.type === "summary") };
      };
      const withCoach = await summaries("big");
      expect(withCoach.events[0]).toMatchObject({ model: "big" });
      expect(withCoach.asks.find((ask) => ask.format === "summary")).toMatchObject({ model: "big", reasoning: "medium" });
      const alone = await summaries("small");
      expect(new Set(alone.asks.map((ask) => ask.model))).toEqual(new Set(["small"]));
      expect(alone.asks.some((ask) => ask.advice)).toBe(false);
    });

    test("a conversation keeps its model: the retry after an impossible action of the Coach goes to the Coach, and of the player to the player", async () => {
      const harness = await Harness.open();
      const { asks, connect } = coached("", () => {
        let calls = 0;
        return async () => reply(calls++ === 0 ? "goTo 0 0" : "goTo 8 6");
      });
      await harness.play(modelBot({ id: "small", coach: { id: "big" }, costLimit: 4 * COST - COST / 2 }, connect));
      const impossible = harness.actions.filter(({ result }) => result.status === "impossible").length;
      expect(impossible).toBe(2);
      expect(asks.map((ask) => ask.model)).toEqual(["big", "big", "small", "small"]);
      expect(modelEvents(harness)[1].prompt.turns?.[0].user).toContain('Your action "goTo 0 0" is impossible');
    });

    test("each Reflection or Review turn goes to the Coach with the advice schema, and the other walks go to the player", async () => {
      const harness = await Harness.open();
      const { asks, connect } = coached("Look north.");
      await harness.play(modelBot({ id: "small", coach: { id: "big" }, costLimit: 30 * COST - COST / 2 }, connect));
      const calls = modelEvents(harness);
      const thinking = calls.filter((call) => call.character || call.reflection || call.review);
      expect(thinking.some((call) => call.reflection || call.review)).toBe(true);
      expect(calls.map((call, i) => [call.model, asks[i].advice])).toEqual(calls.map((call) => (thinking.includes(call) ? ["big", true] : ["small", false])));
    });

    test("a plan limit of the Coach ends the Run", async () => {
      const harness = await Harness.open();
      const { connect } = coached("", (settings) => async () => {
        if (settings.id === "big") throw new PlanLimitError("You hit your usage limit");
        return reply("goTo 8 6");
      });
      expect(await harness.play(modelBot({ id: "small", coach: { id: "big" }, costLimit: 1 }, connect))).toMatchObject({ endReason: "plan limit" });
    });
  });

  describe("the names of the character turn", () => {
    function named(action: string, name: string, rival: string) {
      const { content, usage } = reply(action);
      return { content: JSON.stringify({ ...JSON.parse(content), name, rival }), usage };
    }

    function client(...replies: ReturnType<typeof named>[]): { client: ModelClient; prompts: Prompt[] } {
      const prompts: Prompt[] = [];
      return {
        prompts,
        client: async (prompt) => {
          prompts.push(prompt);
          return replies[Math.min(prompts.length - 1, replies.length - 1)];
        },
      };
    }

    test("the Run boots with the names of the answer, before its first action, and its record replays to the same screen", async () => {
      const harness = await Harness.open();
      const { frame } = harness;
      const model = client(named("goTo 8 6", "Mira", "Crumb"));
      await harness.play(modelBot({ costLimit: 2 * COST - COST / 2 }, () => model.client));
      expect(harness.trainerNames()).toEqual({ player: "Mira", rival: "Crumb" });
      const record = harness.record();
      expect(record.header.names).toEqual({ player: "Mira", rival: "Crumb" });
      const [first] = modelEvents(harness);
      expect(first.frame).toBe(frame);
      expect(first.decision?.names).toEqual({ player: "Mira", rival: "Crumb" });
      expect(model.prompts[1].user).toContain("Your name: Mira. Your rival: Crumb.");
      const replayed = await replay(record);
      expect(replayed.frame).toBe(harness.frame);
      expect(replayed.screen).toBe(harness.screenHash());
      harness.close();
    });

    test("a limit that ends the Run at the character turn still gives a record that agrees with its game", async () => {
      const harness = await Harness.open();
      const model = client(named("goTo 8 6", "Mira", "Crumb"));
      await harness.play(modelBot({ costLimit: COST / 2 }, () => model.client));
      const record = harness.record();
      expect(record.header.names).toEqual({ player: "Mira", rival: "Crumb" });
      expect(harness.trainerNames()).toEqual({ player: "Mira", rival: "Crumb" });
      expect(modelEvents(harness)[0].decision?.names).toEqual({ player: "Mira", rival: "Crumb" });
      harness.close();
    });

    test("a bad name asks the model again and changes nothing", async () => {
      const harness = await Harness.open();
      const model = client(named("goTo 8 6", "Too long name", "Crumb"), named("goTo 8 6", "Mira", "Crumb"));
      await harness.play(modelBot({ costLimit: 2 * COST - COST / 2 }, () => model.client));
      const [bad, good] = modelEvents(harness);
      expect(bad.decision).toBeNull();
      expect(bad.error).toContain('"name": 1 to 7 characters');
      expect(good.frame).toBe(bad.frame);
      expect(model.prompts[1].turns?.at(-1)?.user).toContain('"name": 1 to 7 characters');
      expect(harness.record().header.names).toEqual({ player: "Mira", rival: "Crumb" });
      harness.close();
    });

    test("before the first action, a new answer of the same turn gives the names of the Run", async () => {
      const harness = await Harness.open();
      const model = client(named("viewAtlas", "Old", "Older"), named("goTo 8 6", "Mira", "Crumb"));
      await harness.play(modelBot({ costLimit: 2 * COST - COST / 2 }, () => model.client));
      expect(harness.record().header.names).toEqual({ player: "Mira", rival: "Crumb" });
      harness.close();
    });

    test("a continued Run with no character and no names keeps the names of the game: its record still replays", async () => {
      const parent = await Harness.open();
      await parent.play({ name: "walker", version: "1", play: async (h) => void (await h.goTo(8, 6)) });
      const record = parent.record();
      parent.close();
      expect(record.header.names).toBeNull();
      const harness = await Harness.open({ parent: { name: "parent.json", record } });
      const model = client(named("goTo 6 6", "Mira", "Crumb"));
      await harness.play(modelBot({ costLimit: COST / 2 }, () => model.client));
      expect(model.prompts[0].user).toContain('The game already has your names: write PLOK in "name" and BOB in "rival".');
      expect(modelEvents(harness)[0].decision?.names).toEqual({ player: "PLOK", rival: "BOB" });
      expect(harness.trainerNames()).toEqual({ player: "PLOK", rival: "BOB" });
      const continued = harness.record();
      expect(continued.header.names).toBeNull();
      const replayed = await replay(continued);
      expect(replayed.screen).toBe(harness.screenHash());
      harness.close();
    });
  });

  test("after an empty answer, the next calls of the same turn do not think: the reasoning took all the tokens of the empty answer", async () => {
    const harness = await Harness.open();
    const asks: (string | undefined)[] = [];
    const client: ModelClient = async (_prompt, options) => {
      asks.push(options?.reasoning);
      return asks.length === 1 ? { ...reply("goTo 8 6"), content: "" } : reply("goTo 8 6");
    };
    await harness.play(modelBot({ costLimit: 2 * COST - COST / 2 }, () => client));
    expect(asks).toEqual(["medium", undefined]);
    expect(modelEvents(harness).map((e) => e.error)).toEqual(["the answer is empty", null]);
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
    const recording: ModelClient = async (prompt, options) => {
      prompts.push(prompt);
      return client(prompt, options);
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
    expect(afterTalks).toContain("Decision points since your last progress (a new map, a new Milestone, a new exit seen, a level up, a new text of a person, a trainer beaten, an item found or a new species caught): 2.");
    expect(modelEvents(harness).find((e) => e.prompt.user === afterTalks)).toMatchObject({ stuck: 2, reflection: false });
  });

  test("a Review turn numbers the sentences of the top nodes, its answer removes the sentences that it names, and the next prompt does not show them", async () => {
    const harness = await Harness.open();
    const prompts: Prompt[] = [];
    let calls = 0;
    let reviewed = 0;
    const client: ModelClient = async (prompt, options) => {
      if (options?.format?.name === "summary") return { content: JSON.stringify({ summary: "Use Tackle. The Gym is locked." }), usage: { promptTokens: 100, completionTokens: 20, reasoningTokens: 0, cost: COST } };
      prompts.push(prompt);
      calls++;
      const action = calls === 3 ? target(prompt, "stairs") : "goTo 8 6";
      if (options?.format?.name !== "review") return reply(action, "Leave the house", calls === 1 || calls === 2 ? `fact ${calls}` : "");
      reviewed = calls;
      return { ...reply(action), content: JSON.stringify({ ...JSON.parse(reply(action).content), remove: [1, 99] }) };
    };
    await harness.play(modelBot({ costLimit: 24.5 * COST }, () => client)).catch(() => {});
    expect(reviewed).toBeGreaterThan(0);
    expect(prompts[reviewed - 1].user).toContain("#1-2: [1] Use Tackle. [2] The Gym is locked.");
    expect(modelEvents(harness)[reviewed - 1].removed).toEqual([{ from: 1, to: 2, sentence: "Use Tackle." }]);
    expect(prompts[reviewed].user).toContain("#1-2: The Gym is locked.");
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
      if (!man) return reply(/^[A-Z]+\. unseen cells south/m.test(prompt.user) ? target(prompt, "unseen cells south") : "goTo 12 14");
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
