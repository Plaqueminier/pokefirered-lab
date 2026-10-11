import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import starter from "../../bots/starter";
import { ROM_FILE, START_SAVE } from "../run";
import { type AvailableAction, type Bot, Harness } from "./harness";

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

const BULBASAUR_QUESTION = "I see! BULBASAUR is your choice. It's very easy to raise. So, PLOK, you want to go with the GRASS POKéMON BULBASAUR?";

async function toLab(harness: Harness) {
  await harness.goTo(12, 3, "PalletTown");
  await harness.goTo(12, 1);
  while (harness.observe().waitingFor.kind !== "walk") await harness.readText();
}

describe.skipIf(!ready)("Harness on the Starting save", () => {
  test("the starter Bot follows Oak to his lab, takes SQUIRTLE and refuses the nickname with no Raw input, with the same frames on each start", async () => {
    const first = await play(starter);
    const second = await play(starter);
    expect(first.actions.map((e) => [e.action, e.result.status, "reason" in e.result ? e.result.reason : null, "text" in e.result ? e.result.text : null])).toEqual([
      [{ name: "goTo", x: 12, y: 3, map: "PalletTown" }, "done", null, null],
      [{ name: "goTo", x: 12, y: 1 }, "interrupted", "trigger", null],
      ...OAK_TEXTS.map((text) => [{ name: "readText" as const }, "done", null, text]),
      [{ name: "goTo", x: 9, y: 5 }, "done", null, null],
      [{ name: "interact", x: 9, y: 4 }, "done", null, null],
      [{ name: "readText" }, "done", null, ["Hm! SQUIRTLE is your choice. It's one worth raising. So, PLOK, you've decided on the WATER POKéMON SQUIRTLE?"]],
      [{ name: "choose", option: "YES" }, "done", null, null],
      [
        { name: "readText" },
        "done",
        null,
        ["This POKéMON is really quite energetic!", "PLOK received the SQUIRTLE from PROF. OAK!", "Do you want to give a nickname to this SQUIRTLE?"],
      ],
      [{ name: "choose", option: "NO" }, "done", null, null],
      [{ name: "readText" }, "done", null, ["BOB: I'll take this one, then!", "BOB received the BULBASAUR from PROF. OAK!"]],
    ]);
    // One A press per text Decision point, and none while "Hey! Wait!" closes by itself: the frames do not change.
    expect(first.actions.slice(2, 2 + OAK_TEXTS.length).map((e) => e.result.frames)).toEqual([1787, 156, 1363, 183]);
    expect(first.observation.map.name).toBe("PalletTown_ProfessorOaksLab");
    expect(first.observation.waitingFor).toEqual({ kind: "walk" });
    expect(first.observation.milestones).toEqual(["has-pokemon"]);
    expect(first.observation.party).toEqual([
      {
        species: "SQUIRTLE",
        nickname: "SQUIRTLE",
        level: 5,
        hp: expect.any(Number),
        maxHp: expect.any(Number),
        status: "none",
        moves: [
          { name: "TACKLE", pp: 35, maxPp: 35 },
          { name: "TAIL WHIP", pp: 30, maxPp: 30 },
        ],
      },
    ]);
    expect(first.observation.party[0].hp).toBe(first.observation.party[0].maxHp);
    expect(first.observation.party[0].maxHp).toBeWithin(19, 21);
    expect(first.rawInputs).toBe(0);
    expect(second).toEqual(first);
  });

  test("at each Decision point of the starter path, availableActions gives the actions that the game accepts now", async () => {
    const seen: AvailableAction[][] = [];
    const harness = await Harness.open({ onAction: (_, h) => seen.push(h.availableActions()) });
    seen.push(harness.availableActions());
    await starter.play(harness);
    const goTo = { name: "goTo" as const };
    const readText = [{ name: "readText" as const }];
    expect(seen).toEqual([
      [goTo, { name: "interact", x: 6, y: 5 }],
      [goTo],
      readText,
      ...OAK_TEXTS.slice(1).map(() => readText),
      [goTo, { name: "interact", x: 6, y: 3 }, { name: "interact", x: 5, y: 4 }],
      [goTo, { name: "interact", x: 9, y: 4 }],
      readText,
      [{ name: "choose", option: "YES" }, { name: "choose", option: "NO" }],
      readText,
      [{ name: "choose", option: "YES" }, { name: "choose", option: "NO" }],
      readText,
      // BOB stops at (8, 5) after he takes BULBASAUR.
      [goTo, { name: "interact", x: 8, y: 5 }],
    ]);
    harness.actions.forEach(({ action }, i) => {
      if (action.name === "press") throw new Error("the starter Bot uses a Raw input");
      expect(seen[i]).toContainEqual(action.name === "goTo" ? goTo : action);
    });
    const result = await harness.interact(9, 4);
    expect(result).toMatchObject({ status: "impossible", reason: "nothing at (9, 4) starts a script" });
    expect(result.frames).toBeGreaterThan(0);
  });

  test("each interact that availableActions lists on the path, and that the Bot does not use, starts a script", async () => {
    const atStart = await Harness.open();
    expect(await atStart.interact(6, 5)).toMatchObject({ status: "done" });
    for (const [x, y] of [
      [6, 3],
      [5, 4],
    ]) {
      const inLab = await Harness.open();
      await toLab(inLab);
      expect(await inLab.interact(x, y)).toMatchObject({ status: "done" });
      expect(inLab.observe().waitingFor).not.toEqual({ kind: "walk" });
    }
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
    expect(harness.observe().player).toMatchObject({ x: 6, y: 4 });
    expect(harness.observe().party).toEqual([]);
    expect(harness.observe().milestones).toEqual([]);
  });

  test("at a Poké Ball in the lab, the yes/no is a choice, and choose moves the cursor and selects", async () => {
    const harness = await Harness.open();
    await toLab(harness);
    expect(await harness.readText()).toMatchObject({ status: "impossible", frames: 0, text: [] });
    await harness.goTo(8, 5);
    expect(await harness.interact(8, 4)).toMatchObject({ status: "done" });
    expect(harness.observe().waitingFor).toEqual({ kind: "text" });
    expect(await harness.readText()).toMatchObject({
      status: "done",
      text: [BULBASAUR_QUESTION],
    });
    expect(harness.observe().waitingFor).toEqual({ kind: "choice", options: ["YES", "NO"], cursor: 0 });
    expect(await harness.choose("MAYBE")).toMatchObject({ status: "impossible", frames: 0 });
    expect(await harness.choose("NO")).toMatchObject({ status: "done" });
    expect(harness.observe().waitingFor).toEqual({ kind: "walk" });
    expect(harness.rawInputs).toBe(0);
  });

  test("interact turns the player to an empty cell without a step, and refuses a cell that is not next to the player", async () => {
    const harness = await Harness.open();
    await toLab(harness);
    await harness.goTo(8, 5);
    expect(await harness.interact(8, 7)).toMatchObject({ status: "impossible", frames: 0 });
    expect(await harness.interact(7, 5)).toMatchObject({ status: "impossible", reason: "nothing at (7, 5) starts a script" });
    expect(harness.observe().player).toEqual({ x: 8, y: 5, facing: "west" });
    expect(harness.observe().waitingFor).toEqual({ kind: "walk" });
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
