import { describe, expect, setDefaultTimeout, test } from "bun:test";
import { existsSync } from "node:fs";
import starter from "./scripted-bot";
import { ROM_FILE, START_SAVE } from "../run";
import { type Bot, Harness, must, type RunResult } from "./harness";
import { isRunRecord, type ModelAnswer, type ModelEvent, RecordPlayer, replay, type RunRecord } from "./record";

const ready = existsSync(ROM_FILE) && existsSync(START_SAVE);
setDefaultTimeout(60_000);

let starterRun: Promise<{ harness: Harness; result: RunResult }> | null = null;

function playStarter() {
  starterRun ??= Harness.open().then(async (harness) => ({ harness, result: await harness.play(starter) }));
  return starterRun;
}

const result: RunResult = { endReason: "goal", frames: 6, milestones: [], rawInputs: 0 };
const header = { rom: "rom", seed: 1, startSave: null, knowledge: "player", bot: { name: "test", version: "1" } } as const;
const ANSWER: ModelAnswer = {
  model: "a/b",
  situation: "a walk on PalletTown (6, 1)",
  prompt: { system: "rules", user: "now" },
  answer: '{"reason":"I go north.","action":"goTo 6 0","mission":"","objective":"","note":""}',
  decision: { reason: "I go north.", action: "goTo 6 0", mission: "", objective: "", note: "" },
  error: null,
  usage: { promptTokens: 100, completionTokens: 20, reasoningTokens: 0, cost: 0.0001 },
};

describe("RecordPlayer", () => {
  test("it gives the keys of each frame from frame 0, then it ends", () => {
    const record: RunRecord = { header, buttons: [[0, 2], [1, 3], [64, 1]], events: [], result };
    const player = new RecordPlayer(record);
    expect(player.frames).toBe(6);
    const keys: number[] = [];
    while (!player.ended) keys.push(player.next());
    expect(keys).toEqual([0, 0, 1, 1, 1, 64]);
    expect(player.frame).toBe(6);
    expect(() => player.next()).toThrow("the Run record has no more frames");
  });

  test("it gives the events up to the current frame: an action from the frame where the Bot asked for it", () => {
    const goTo = { type: "action", frame: 2, action: { name: "goTo", x: 1, y: 2 }, result: { status: "done", frames: 3 } } as const;
    const map = { type: "map", frame: 2, map: "PalletTown" } as const;
    const model: ModelEvent = { type: "model", frame: 5, latencyMs: 300, ...ANSWER };
    const milestone = { type: "milestone", frame: 6, milestone: "has-pokemon" } as const;
    const record: RunRecord = { header, buttons: [[0, 6]], events: [goTo, map, model, milestone], result };
    const player = new RecordPlayer(record);
    const playedAt: [number, number][] = [[player.frame, player.played().length]];
    while (!player.ended) {
      player.next();
      playedAt.push([player.frame, player.played().length]);
    }
    expect(playedAt).toEqual([[0, 0], [1, 0], [2, 2], [3, 2], [4, 2], [5, 3], [6, 4]]);
    expect(player.played()).toEqual([goTo, map, model, milestone]);
    expect(player.result).toEqual(result);
  });
});

describe("isRunRecord", () => {
  const record = { header, buttons: [[0, 6]], events: [{ type: "map", frame: 2, map: "PalletTown" }], result };

  test("it accepts a Run record", () => {
    expect(isRunRecord(record)).toBe(true);
    expect(isRunRecord(JSON.parse(JSON.stringify(record)))).toBe(true);
  });

  test("it refuses a file with no header or result, bad button holds, or events that are not in frame order", () => {
    expect(isRunRecord(null)).toBe(false);
    expect(isRunRecord({ ...record, header: null })).toBe(false);
    expect(isRunRecord({ ...record, result: null })).toBe(false);
    expect(isRunRecord({ ...record, buttons: [[0, 0]] })).toBe(false);
    expect(isRunRecord({ ...record, events: [null] })).toBe(false);
    expect(isRunRecord({ ...record, events: [{ type: "map" }] })).toBe(false);
    expect(isRunRecord({ ...record, events: [{ type: "dance", frame: 1 }] })).toBe(false);
    expect(isRunRecord({ ...record, events: [{ type: "action", frame: 1 }] })).toBe(false);
    expect(isRunRecord({ ...record, events: [{ type: "map", frame: 3, map: "A" }, { type: "map", frame: 2, map: "B" }] })).toBe(false);
  });
});

describe.skipIf(!ready)("Run record on the Starting save", () => {
  test("the Run record of the scripted bot has its header, its buttons at each frame and its events; the replay of the buttons alone gives the same map changes, battles and Milestones, the same frames and the same screen", async () => {
    const { harness, result } = await playStarter();
    const record = harness.record();

    expect(record.header).toMatchObject({ seed: 0x4c41, knowledge: "player", bot: { name: "starter", version: "3" } });
    expect(record.header.rom).toMatch(/^[0-9a-f]{64}$/);
    expect(record.header.startSave).toMatch(/^[0-9a-f]{64}$/);
    expect(record.result).toEqual(result);

    expect(new RecordPlayer(record).frames).toBe(harness.frame);
    record.buttons.forEach(([keys], i) => expect(keys).not.toBe(record.buttons[i - 1]?.[0]));

    const actions = record.events.flatMap((e) => (e.type === "action" ? [e.action.name] : []));
    expect(actions).toHaveLength(26);
    expect(actions.slice(0, 3)).toEqual(["goTo", "goTo", "readText"]);
    const gameEvents = record.events.filter((e) => e.type !== "action").map(({ frame, ...event }) => event);
    expect(gameEvents).toEqual([
      { type: "map", map: "PalletTown_PlayersHouse_2F" },
      { type: "map", map: "PalletTown_PlayersHouse_1F" },
      { type: "map", map: "PalletTown" },
      { type: "map", map: "PalletTown_ProfessorOaksLab" },
      { type: "milestone", milestone: "has-pokemon" },
      { type: "battle", state: "start" },
      { type: "battle", state: "end" },
      { type: "milestone", milestone: "first-rival-battle" },
    ]);
    const frames = record.events.map((e) => e.frame);
    expect(frames).toEqual(frames.toSorted((a, b) => a - b));

    const replayed = await replay(record);
    expect(replayed.events).toEqual(record.events.filter((e) => e.type === "map" || e.type === "battle" || e.type === "milestone"));
    expect(replayed.events.length).toBeGreaterThan(0);
    expect(replayed.frame).toBe(harness.frame);
    expect(replayed.screen).toBe(harness.screenHash());
    await expect(replay({ ...record, header: { ...record.header, seed: 1 } })).rejects.toThrow("the Run record does not replay here: different seed");
  });

  test("a Bot that walks in a loop ends with no progress after N Decision points with no new cell and no new Milestone", async () => {
    const harness = await Harness.open({ noProgressLimit: 10 });
    const cell = (i: number) => ({ x: 6, y: i % 2 ? 6 : 7 });
    const loop: Bot = {
      name: "loop",
      version: "1",
      async play(h) {
        for (let i = 0; ; i++) must(await h.goTo(cell(i).x, cell(i).y));
      },
    };
    expect(await harness.play(loop)).toMatchObject({ endReason: "no progress", milestones: [], rawInputs: 0 });
    expect(harness.actions.map((e) => [e.action, e.result.status])).toEqual(Array.from({ length: 11 }, (_, i) => [{ name: "goTo", ...cell(i) }, "done"]));
  });

  test("the walk Decision points since a new map, a new Milestone, a level up or a new text of a person: new cells and a text heard before do not reset them", async () => {
    const harness = await Harness.open();
    const walks: number[] = [];
    const explorer: Bot = {
      name: "explorer",
      version: "1",
      async play(h) {
        const walk = async (x: number, y: number, map?: string) => {
          must(await h.goTo(x, y, map));
          walks.push(h.noProgress.walks);
        };
        const talkToMom = async () => {
          must(await h.interact(8, 4));
          while (h.observe().waitingFor.kind !== "walk") await h.readText();
          walks.push(h.noProgress.walks);
        };
        await walk(6, 6);
        await walk(6, 7);
        await walk(8, 5, "PalletTown_PlayersHouse_1F");
        await walk(8, 6);
        await walk(8, 5);
        await talkToMom();
        await talkToMom();
      },
    };
    await harness.play(explorer);
    expect(walks).toEqual([1, 2, 0, 1, 2, 0, 1]);
  });

  test("a continued Run replays the buttons of its parent: the same Atlas with the texts of the people, and a Run result for the whole Run", async () => {
    const talker: Bot = {
      name: "talker",
      version: "1",
      async play(h) {
        must(await h.goTo(8, 5, "PalletTown_PlayersHouse_1F"));
        must(await h.interact(8, 4));
        while (h.observe().waitingFor.kind !== "walk") await h.readText();
      },
    };
    const parent = await Harness.open();
    await parent.play(talker);
    const record = parent.record();
    const harness = await Harness.open({ parent: { name: "talker.json", record } });
    const atlas = harness.observe().atlas;
    expect(atlas).toEqual(parent.observe().atlas);
    expect(atlas.maps.flatMap((m) => m.people.flatMap((p) => p.texts)).length).toBeGreaterThan(0);
    const parentFrame = parent.frame;
    parent.close();
    const presser: Bot = { name: "presser", version: "1", play: async (h) => void (await h.press("B")) };
    expect(await harness.play(presser)).toEqual({ endReason: "bot stopped", frames: record.result.frames + harness.frame - parentFrame, milestones: [], rawInputs: 1 });
    expect(harness.record().header.parent).toBe("talker.json");
  });

  test("the frame budget ends the Run at its last frame, also in a Macro-action, and the Run record has the buttons to that frame", async () => {
    const harness = await Harness.open({ frameBudget: 2000 });
    const start = harness.frame;
    expect(await harness.play(starter)).toEqual({ endReason: "frame budget", frames: 2000, milestones: [], rawInputs: 0 });
    expect(harness.frame).toBe(start + 2000);
    expect(harness.actions.reduce((frames, e) => frames + e.result.frames, 0)).toBeLessThan(2000);
    const record = harness.record();
    expect(new RecordPlayer(record).frames).toBe(start + 2000);
    expect(record.result.endReason).toBe("frame budget");
  });

  test("each Raw input of the play counts in the Run result and is an event of the Run record, as a Model call", async () => {
    const harness = await Harness.open();
    await harness.press("B");
    const presser: Bot = {
      name: "presser",
      version: "1",
      async play(h) {
        await h.modelCall(async () => ({ answer: ANSWER, action: null }));
        for (let i = 0; i < 3; i++) await h.press("B");
      },
    };
    expect(await harness.play(presser)).toMatchObject({ endReason: "bot stopped", rawInputs: 3 });
    const events = harness.record().events.filter((e) => e.type === "action" || e.type === "model");
    expect(events.map(({ frame, ...e }) => ("action" in e ? e.action : e))).toEqual([
      { name: "press", button: "B" },
      { type: "model", latencyMs: expect.any(Number), ...ANSWER },
      { name: "press", button: "B" },
      { name: "press", button: "B" },
      { name: "press", button: "B" },
    ]);
    await expect(harness.play(presser)).rejects.toThrow("a Harness plays one Run");
  });

  test("a stop request ends the Run with user stop after the Model call or the Raw input that plays, and the Run record keeps them", async () => {
    let stop = false;
    const harness = await Harness.open({ stopAsked: () => stop });
    const stopped: Bot = {
      name: "stopped",
      version: "1",
      async play(h) {
        await h.press("B");
        await h.modelCall(async () => {
          stop = true;
          return { answer: ANSWER, action: null };
        });
        await h.press("B");
      },
    };
    expect(await harness.play(stopped)).toMatchObject({ endReason: "user stop", rawInputs: 1 });
    expect(harness.record().events.filter((e) => e.type === "action" || e.type === "model").map((e) => e.type)).toEqual(["action", "model"]);

    const pressed = await Harness.open({ stopAsked: () => true });
    expect(await pressed.play(stopped)).toMatchObject({ endReason: "user stop", rawInputs: 1 });
  });

  test("when the Bot throws an error, play throws it again and the Run record keeps the Run, with the end reason bot stopped", async () => {
    const harness = await Harness.open();
    const failing: Bot = {
      name: "failing",
      version: "1",
      async play(h) {
        must(await h.goTo(8, 2));
      },
    };
    await expect(harness.play(failing)).rejects.toThrow("impossible");
    const { result, events } = harness.record();
    expect(result).toEqual({ endReason: "bot stopped", frames: 0, milestones: [], rawInputs: 0 });
    expect(events.at(-1)).toMatchObject({ type: "action", action: { name: "goTo", x: 8, y: 2 }, result: { status: "impossible" } });
  });
});
