import { describe, expect, setDefaultTimeout, test } from "bun:test";
import { existsSync } from "node:fs";
import starter from "../../bots/starter";
import { ROM_FILE, START_SAVE } from "../run";
import { type Bot, Harness, must, type RunResult } from "./harness";
import { type ButtonHold, replay } from "./record";

const ready = existsSync(ROM_FILE) && existsSync(START_SAVE);
setDefaultTimeout(60_000);

let starterRun: Promise<{ harness: Harness; result: RunResult }> | null = null;

function playStarter() {
  starterRun ??= Harness.open().then(async (harness) => ({ harness, result: await harness.play(starter) }));
  return starterRun;
}

function frameCount(buttons: ButtonHold[]): number {
  return buttons.reduce((frames, [, count]) => frames + count, 0);
}

describe.skipIf(!ready)("Run record on the Starting save", () => {
  test("the Run record of the starter Bot has its header, its buttons at each frame and its events", async () => {
    const { harness, result } = await playStarter();
    const record = harness.record();

    expect(record.header).toMatchObject({ seed: 0x4c41, knowledge: "player", bot: { name: "starter", version: "3" } });
    expect(record.header.rom).toMatch(/^[0-9a-f]{64}$/);
    expect(record.header.startSave).toMatch(/^[0-9a-f]{64}$/);
    expect(record.result).toEqual(result);

    expect(frameCount(record.buttons)).toBe(harness.frame);
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
  });

  test("the replay of the buttons alone gives the same map changes, battles and Milestones, the same frames and the same screen", async () => {
    const { harness } = await playStarter();
    const record = harness.record();
    const replayed = await replay(record);
    expect(replayed.events).toEqual(record.events.filter((e) => e.type !== "action" && e.type !== "model"));
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

  test("the frame budget ends the Run at its last frame, also in a Macro-action, and the Run record has the buttons to that frame", async () => {
    const harness = await Harness.open({ frameBudget: 2000 });
    const start = harness.frame;
    expect(await harness.play(starter)).toEqual({ endReason: "frame budget", frames: 2000, milestones: [], rawInputs: 0 });
    expect(harness.frame).toBe(start + 2000);
    expect(harness.actions.reduce((frames, e) => frames + e.result.frames, 0)).toBeLessThan(2000);
    const { buttons, result } = harness.record();
    expect(frameCount(buttons)).toBe(start + 2000);
    expect(result.endReason).toBe("frame budget");
  });

  test("each Raw input of the play counts in the Run result and is an event of the Run record, as the text of a model Bot", async () => {
    const harness = await Harness.open();
    await harness.press("B");
    const presser: Bot = {
      name: "presser",
      version: "1",
      async play(h) {
        h.modelText("I press B three times.");
        for (let i = 0; i < 3; i++) await h.press("B");
      },
    };
    expect(await harness.play(presser)).toMatchObject({ endReason: "bot stopped", rawInputs: 3 });
    const events = harness.record().events.filter((e) => e.type === "action" || e.type === "model");
    expect(events.map(({ frame, ...e }) => ("action" in e ? e.action : e))).toEqual([
      { name: "press", button: "B" },
      { type: "model", text: "I press B three times." },
      { name: "press", button: "B" },
      { name: "press", button: "B" },
      { name: "press", button: "B" },
    ]);
    await expect(harness.play(presser)).rejects.toThrow("a Harness plays one Run");
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
