import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import oak from "../../bots/oak";
import { ROM_FILE, START_SAVE } from "../run";
import { type Bot, Harness } from "./harness";

const ready = existsSync(ROM_FILE) && existsSync(START_SAVE);

async function play(bot: Bot) {
  const harness = await Harness.open();
  await bot.play(harness);
  return { actions: harness.actions, rawInputs: harness.rawInputs, frame: harness.frame, observation: harness.observe(), screen: harness.screenHash() };
}

const OAK_TEXTS = [
  [
    "OAK: Hey! Wait! Don't go out!",
    "OAK: It's unsafe! Wild POKéMON live in tall grass! You need your own POKéMON for your protection. I know! Here, come with me!",
  ],
  ["BOB: Gramps! I'm fed up with waiting!"],
  [
    "OAK: BOB? Let me think… Oh, that's right, I told you to come! Just wait! Here, PLOK. There are three POKéMON here. Haha! " +
      "The POKéMON are held inside these POKé BALLS. When I was young, I was a serious POKéMON TRAINER. " +
      "But now, in my old age, I have only these three left. You can have one. Go on, choose!",
  ],
  ["BOB: Hey! Gramps! No fair! What about me?", "OAK: Be patient, BOB. You can have one, too!"],
];

describe.skipIf(!ready)("Harness on the Starting save", () => {
  test("the oak Bot follows Oak to his lab with readText only, with the same frames on each start", async () => {
    const first = await play(oak);
    const second = await play(oak);
    expect(first.actions.map((e) => [e.action, e.result.status, "reason" in e.result ? e.result.reason : null])).toEqual([
      [{ name: "goTo", x: 12, y: 3, map: "PalletTown" }, "done", null],
      [{ name: "goTo", x: 12, y: 1 }, "interrupted", "trigger"],
      ...OAK_TEXTS.map(() => [{ name: "readText" as const }, "done", null]),
    ]);
    expect(first.actions.slice(2).map((e) => ("text" in e.result ? e.result.text : null))).toEqual(OAK_TEXTS);
    // One A press per text Decision point, and none while "Hey! Wait!" closes by itself: the frames do not change.
    expect(first.actions.slice(2).map((e) => e.result.frames)).toEqual([1787, 156, 1363, 183]);
    expect(first.observation.map.name).toBe("PalletTown_ProfessorOaksLab");
    expect(first.observation.player).toMatchObject({ x: 6, y: 4 });
    expect(first.observation.waitingFor).toEqual({ kind: "walk" });
    expect(first.rawInputs).toBe(0);
    expect(second).toEqual(first);
  });

  test("on the way to the lab, the game waits for a text before each readText after the first", async () => {
    const harness = await Harness.open();
    await harness.goTo(12, 3, "PalletTown");
    await harness.goTo(12, 1);
    const seen = [harness.observe().waitingFor];
    for (const _ of OAK_TEXTS) {
      await harness.readText();
      seen.push(harness.observe().waitingFor);
    }
    expect(seen).toEqual([{ kind: "busy" }, { kind: "text" }, { kind: "text" }, { kind: "text" }, { kind: "walk" }]);
  });

  test("at a Poké Ball in the lab, the yes/no is a choice, and choose moves the cursor and selects", async () => {
    const harness = await Harness.open();
    await oak.play(harness);
    expect(await harness.readText()).toMatchObject({ status: "impossible", frames: 0, text: [] });
    await harness.goTo(8, 5);
    await harness.press("Up");
    await harness.press("A");
    expect(harness.observe().waitingFor).toEqual({ kind: "text" });
    expect(await harness.readText()).toMatchObject({
      status: "done",
      text: ["I see! BULBASAUR is your choice. It's very easy to raise. So, PLOK, you want to go with the GRASS POKéMON BULBASAUR?"],
    });
    expect(harness.observe().waitingFor).toEqual({ kind: "choice", options: ["YES", "NO"], cursor: 0 });
    expect(await harness.choose("MAYBE")).toMatchObject({ status: "impossible", frames: 0 });
    expect(await harness.choose("NO")).toMatchObject({ status: "done" });
    expect(harness.observe().waitingFor).toEqual({ kind: "walk" });
    expect(harness.rawInputs).toBe(2);
  });

  test("goTo to the cell of Mom waits, plans again, and returns blocked", async () => {
    const harness = await Harness.open();
    const result = await harness.goTo(8, 4, "PalletTown_PlayersHouse_1F");
    expect(result).toMatchObject({ status: "blocked", frames: 60 });
    expect(harness.observe().map.name).toBe("PalletTown_PlayersHouse_2F");
  });

  test("goTo to a blocked cell returns impossible and runs no frames", async () => {
    const harness = await Harness.open();
    const frame = harness.frame;
    const result = await harness.goTo(8, 2);
    expect(result).toMatchObject({ status: "impossible", frames: 0 });
    expect(harness.frame).toBe(frame);
  });
});
