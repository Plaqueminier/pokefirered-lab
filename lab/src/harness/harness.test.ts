import { describe, expect, setDefaultTimeout, test } from "bun:test";
import { existsSync } from "node:fs";
import starter from "../../bots/starter";
import { ROM_FILE, START_SAVE } from "../run";
import { type AvailableAction, type BattleState, type Bot, Harness } from "./harness";

const ready = existsSync(ROM_FILE) && existsSync(START_SAVE);
setDefaultTimeout(60_000);

async function play(bot: Bot) {
  const harness = await Harness.open();
  const start = harness.frame;
  const result = await harness.play(bot);
  return { start, result, actions: harness.actions, frame: harness.frame, observation: harness.observe(), screen: harness.screenHash() };
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

async function toStarter(harness: Harness) {
  await toLab(harness);
  await harness.goTo(9, 5);
  await harness.interact(9, 4);
  await harness.readText();
  await harness.choose("YES");
  await harness.readText();
  await harness.choose("NO");
  await harness.readText();
}

const BATTLE_INTRO_TEXTS = [
  "RIVAL BOB would like to battle!",
  "RIVAL BOB sent out BULBASAUR!",
  "Go! SQUIRTLE!",
  "OAK: Oh, for Pete's sake… So pushy, as always. PLOK. You've never had a POKéMON battle before, have you? " +
    "A POKéMON battle is when TRAINERS pit their POKéMON against each other.",
  "The TRAINER that makes the other TRAINER's POKéMON faint by lowering their HP to “0,” wins.",
  "But rather than talking about it, you'll learn more from experience. Try battling and see for yourself.",
];

function battleOf(harness: Harness): BattleState {
  const observation = harness.observe();
  if (observation.mode !== "battle") throw new Error("not in a battle");
  return observation.battle;
}

const NO_STAGES = { attack: 0, defense: 0, speed: 0, spAttack: 0, spDefense: 0, accuracy: 0, evasion: 0 };

async function toRivalBattle(harness: Harness) {
  await toStarter(harness);
  await harness.goTo(6, 11);
  await harness.readText();
  await harness.readText();
}

describe.skipIf(!ready)("Harness on the Starting save", () => {
  test("on the way out of the lab, the rival stops the player and starts a battle; readText reads the battle texts to the first battle action", async () => {
    const harness = await Harness.open();
    await toStarter(harness);
    const empty = await harness.interact(9, 4);
    expect(empty).toMatchObject({ status: "impossible", reason: "nothing at (9, 4) starts a script" });
    expect(empty.frames).toBeGreaterThan(0);
    expect(await harness.goTo(6, 11)).toMatchObject({ status: "interrupted", reason: "trigger" });
    expect(await harness.readText()).toMatchObject({
      status: "interrupted",
      reason: "battle",
      text: ["BOB: Wait, PLOK! Let's check out our POKéMON! Come on, I'll take you on!"],
    });
    expect(harness.observe().waitingFor).toEqual({ kind: "busy" });
    expect(await harness.readText()).toMatchObject({ status: "done", text: BATTLE_INTRO_TEXTS });
    expect(harness.observe()).toMatchObject({ mode: "battle", waitingFor: { kind: "battleAction" } });
    expect(harness.rawInputs).toBe(0);
  });

  test("the starter Bot follows Oak to his lab, takes SQUIRTLE and wins the rival battle with no Raw input, and the Run ends at its goal, with the same frames on each start", async () => {
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
      [{ name: "goTo", x: 6, y: 11 }, "interrupted", "trigger", null],
      [{ name: "readText" }, "interrupted", "battle", ["BOB: Wait, PLOK! Let's check out our POKéMON! Come on, I'll take you on!"]],
      [{ name: "readText" }, "done", null, BATTLE_INTRO_TEXTS],
      [{ name: "fight", move: 1 }, "done", null, ["Foe BULBASAUR used GROWL!", "SQUIRTLE's ATTACK fell!", "SQUIRTLE used TAIL WHIP!", "Foe BULBASAUR's DEFENSE fell!"]],
      [{ name: "readText" }, "done", null, ["OAK: Lowering the foe's stats will put you at an advantage."]],
      [{ name: "fight", move: 0 }, "done", null, ["Foe BULBASAUR used TACKLE!", "SQUIRTLE used TACKLE!"]],
      [{ name: "readText" }, "done", null, ["OAK: Inflicting damage on the foe is the key to any battle."]],
      ...[1, 2, 3, 4].map(() => [{ name: "fight" as const, move: 0 }, "done", null, ["Foe BULBASAUR used TACKLE!", "SQUIRTLE used TACKLE!"]]),
      [
        { name: "readText" },
        "done",
        null,
        [
          "Foe BULBASAUR fainted!",
          "SQUIRTLE gained 67 EXP. Points!",
          "SQUIRTLE grew to LV. 6!",
          "Player defeated RIVAL BOB!",
          "WHAT? Unbelievable! I picked the wrong POKéMON!",
          "PLOK got ¥80 for winning!",
          "OAK: Hm! Excellent! If you win, you earn prize money, and your POKéMON will grow! Battle other TRAINERS and make your POKéMON strong!",
        ],
      ],
      [{ name: "readText" }, "done", null, ["BOB: Okay! I'll make my POKéMON battle to toughen it up! PLOK! Gramps! Smell you later!"]],
    ]);
    // One A press per text Decision point, and none while "Hey! Wait!" closes by itself: the frames do not change.
    expect(first.actions.slice(2, 2 + OAK_TEXTS.length).map((e) => e.result.frames)).toEqual([1787, 156, 1363, 183]);
    expect(first.result).toEqual({ endReason: "goal", frames: first.frame - first.start, milestones: ["has-pokemon", "first-rival-battle"], rawInputs: 0 });
    expect(first.observation).toMatchObject({ mode: "overworld", map: { name: "PalletTown_ProfessorOaksLab" }, player: { x: 7, y: 8 } });
    expect(first.observation.waitingFor).toEqual({ kind: "walk" });
    expect(first.observation.party).toEqual([
      {
        species: "SQUIRTLE",
        nickname: "SQUIRTLE",
        level: 6,
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
    expect(first.observation.party[0].maxHp).toBeWithin(21, 24);
    expect(second).toEqual(first);
  });

  test("at each Decision point of the starter path, availableActions gives the actions that the game accepts now", async () => {
    const seen: AvailableAction[][] = [];
    const harness = await Harness.open({ onAction: (_, h) => seen.push(h.availableActions()) });
    seen.push(harness.availableActions());
    await starter.play(harness);
    const goTo = { name: "goTo" as const };
    const readText = [{ name: "readText" as const }];
    const fights: AvailableAction[] = [
      { name: "fight", move: 0 },
      { name: "fight", move: 1 },
    ];
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
      readText,
      readText,
      fights,
      readText,
      fights,
      readText,
      fights,
      fights,
      fights,
      fights,
      readText,
      readText,
      [goTo],
    ]);
    harness.actions.forEach(({ action }, i) => {
      if (action.name === "press") throw new Error("the starter Bot uses a Raw input");
      expect(seen[i]).toContainEqual(action.name === "goTo" ? goTo : action);
    });
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

  test("at the first battle action, the player level shows the enemy HP bar but not its exact stats, and run is impossible against a trainer", async () => {
    const harness = await Harness.open();
    await toRivalBattle(harness);
    const battle = battleOf(harness);
    expect(battle.kind).toBe("trainer");
    expect(battle.player).toMatchObject({
      species: "SQUIRTLE",
      nickname: "SQUIRTLE",
      level: 5,
      status: "none",
      moves: [
        { name: "TACKLE", pp: 35, maxPp: 35 },
        { name: "TAIL WHIP", pp: 30, maxPp: 30 },
      ],
    });
    expect(battle.player.hp).toBe(harness.observe().party[0].hp);
    expect(battle.player.stats.defense).toBeWithin(11, 14);
    expect(battle.player.statStages).toEqual(NO_STAGES);
    expect(battle.enemy).toEqual({ species: "BULBASAUR", level: 5, hpPercent: 100, status: "none", statStages: NO_STAGES, movesSeen: [] });
    expect(harness.availableActions()).toEqual([
      { name: "fight", move: 0 },
      { name: "fight", move: 1 },
    ]);
    expect(await harness.run()).toMatchObject({ status: "impossible", reason: "there is no running from a trainer battle", frames: 0 });
    expect(await harness.readText()).toMatchObject({ status: "impossible", frames: 0 });
  });

  test("fight moves the cursors of the battle menus, also from the move menu; in the party menu, the game waits for a partyPick that no Macro-action accepts", async () => {
    const harness = await Harness.open();
    await toRivalBattle(harness);
    await harness.press("Down");
    await harness.press("A");
    expect(await harness.readText()).toMatchObject({ status: "done" });
    expect(harness.observe()).toMatchObject({ mode: "battle", waitingFor: { kind: "partyPick" } });
    expect(harness.availableActions()).toEqual([]);
    expect(await harness.fight(0)).toMatchObject({ status: "impossible", frames: 0 });
    await harness.press("B");
    expect(harness.observe().waitingFor).toEqual({ kind: "battleAction" });
    expect(await harness.fight(2)).toMatchObject({ status: "impossible", reason: "the Pokémon has no move 2", frames: 0 });
    expect(await harness.fight(1)).toMatchObject({
      status: "done",
      text: ["Foe BULBASAUR used GROWL!", "SQUIRTLE's ATTACK fell!", "SQUIRTLE used TAIL WHIP!", "Foe BULBASAUR's DEFENSE fell!"],
    });
    const battle = battleOf(harness);
    expect(battle.enemy.movesSeen).toEqual(["GROWL"]);
    expect(battle.enemy.statStages.defense).toBe(-1);
    expect(battle.player.statStages.attack).toBe(-1);
    expect(battle.player.moves[1].pp).toBe(29);
    await harness.readText();
    await harness.press("A");
    expect(harness.observe().waitingFor).toEqual({ kind: "battleMove" });
    expect(harness.availableActions()).toEqual([
      { name: "fight", move: 0 },
      { name: "fight", move: 1 },
    ]);
    expect(await harness.fight(0)).toMatchObject({ status: "done", text: ["Foe BULBASAUR used TACKLE!", "SQUIRTLE used TACKLE!"] });
    expect(harness.rawInputs).toBe(4);
  });

  test("in a wild battle, availableActions lists run, and run leaves the battle", async () => {
    const harness = await Harness.open();
    await starter.play(harness);
    expect(await harness.goTo(12, 0, "Route1")).toMatchObject({ status: "interrupted", reason: "battle" });
    expect(await harness.readText()).toMatchObject({ status: "done", text: ["Wild RATTATA appeared!", "Go! SQUIRTLE!"] });
    expect(battleOf(harness)).toMatchObject({ kind: "wild", enemy: { species: "RATTATA", level: 3, hpPercent: 100 } });
    expect(harness.availableActions()).toEqual([{ name: "fight", move: 0 }, { name: "fight", move: 1 }, { name: "run" }]);
    expect(await harness.run()).toMatchObject({ status: "done", text: [] });
    expect(await harness.readText()).toMatchObject({ status: "done", text: ["Got away safely!"] });
    expect(harness.observe()).toMatchObject({ mode: "overworld", waitingFor: { kind: "walk" }, map: { name: "Route1" } });
  });

  test("the moves seen of the enemy do not keep a move from the previous battle", async () => {
    const harness = await Harness.open();
    await starter.play(harness);
    await harness.goTo(12, 0, "Route1");
    await harness.readText();
    expect(await harness.fight(1)).toMatchObject({ status: "done", text: expect.arrayContaining(["Wild RATTATA used TACKLE!"]) });
    while (harness.observe().waitingFor.kind !== "battleAction") await harness.readText();
    expect(await harness.run()).toMatchObject({ status: "done" });
    await harness.readText();
    for (let leg = 0; (await harness.goTo(12, leg % 2 ? 2 : 30, "Route1")).status !== "interrupted"; leg++) {
      if (leg === 8) throw new Error("no second wild battle");
    }
    await harness.readText();
    expect(harness.observe().waitingFor).toEqual({ kind: "battleAction" });
    expect(battleOf(harness).enemy.movesSeen).toEqual([]);
  });

  test("at the full Knowledge level, the battle state has the exact HP and stats of the enemy", async () => {
    const harness = await Harness.open({ knowledge: "full" });
    await toRivalBattle(harness);
    const { exact, ...seen } = battleOf(harness).enemy;
    expect(seen).toEqual({ species: "BULBASAUR", level: 5, hpPercent: 100, status: "none", statStages: NO_STAGES, movesSeen: [] });
    if (!exact) throw new Error("no exact values at the full level");
    expect(exact.hp).toBe(exact.maxHp);
    expect(exact.maxHp).toBeWithin(19, 22);
    expect(exact.stats.attack).toBeWithin(9, 12);
    expect(Object.keys(exact.stats)).toEqual(["attack", "defense", "speed", "spAttack", "spDefense"]);
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
    expect(harness.observe()).toMatchObject({ mode: "overworld", player: { x: 6, y: 4 } });
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
    expect(harness.observe()).toMatchObject({ mode: "overworld", player: { x: 8, y: 5, facing: "west" } });
    expect(harness.observe().waitingFor).toEqual({ kind: "walk" });
  });

  test("goTo to the cell of Mom waits, plans again, and returns blocked", async () => {
    const harness = await Harness.open();
    const result = await harness.goTo(8, 4, "PalletTown_PlayersHouse_1F");
    expect(result).toMatchObject({ status: "blocked", frames: 60 });
    expect(harness.observe()).toMatchObject({ mode: "overworld", map: { name: "PalletTown_PlayersHouse_2F" } });
  });

  test("a Run without a goal ends when its Bot stops", async () => {
    const harness = await Harness.open();
    const result = await harness.play({ name: "idle", version: "1", play: async () => {} });
    expect(result).toEqual({ endReason: "bot stopped", frames: 0, milestones: [], rawInputs: 0 });
  });

  test("goTo to a blocked cell returns impossible and runs no frames", async () => {
    const harness = await Harness.open();
    const frame = harness.frame;
    const result = await harness.goTo(8, 2);
    expect(result).toMatchObject({ status: "impossible", frames: 0 });
    expect(harness.frame).toBe(frame);
  });
});
