import { describe, expect, setDefaultTimeout, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { ROM_FILE, SAVES_DIR, START_SAVE } from "../run";
import starter from "./scripted-bot";
import { cellAt, mapNamed } from "./atlas";
import { type AvailableAction, type BattleState, type Bot, botInfos, Harness, must } from "./harness";

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

test("the list of the Bots gives the model bot only, with its kind, its version and its goal", async () => {
  expect(await botInfos()).toEqual([{ name: "model", kind: "model", version: "8", goal: null }]);
});

test("a Bot that does not load gives its error in the list of the Bots", async () => {
  const costLimit = process.env.LAB_COST_LIMIT;
  process.env.LAB_COST_LIMIT = "abc";
  try {
    expect(await botInfos()).toEqual([{ name: "model", error: 'the cost limit must be a number of dollars above 0, not "abc"' }]);
  } finally {
    if (costLimit === undefined) delete process.env.LAB_COST_LIMIT;
    else process.env.LAB_COST_LIMIT = costLimit;
  }
});

describe.skipIf(!ready)("Harness on the Starting save", () => {
  test("the scripted bot follows Oak to his lab, takes SQUIRTLE and wins the rival battle with no Raw input, and the Run ends at its goal", async () => {
    const first = await play(starter);
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
      [{ name: "choose", option: "YES" }, "done", null, null],
      [{ name: "name", text: "" }, "done", null, ["BOB: I'll take this one, then!", "BOB received the BULBASAUR from PROF. OAK!"]],
      [{ name: "goTo", x: 6, y: 11 }, "interrupted", "trigger", null],
      [{ name: "readText" }, "interrupted", "battle", ["BOB: Wait, PLOK! Let's check out our POKéMON! Come on, I'll take you on!"]],
      [{ name: "readText" }, "done", null, BATTLE_INTRO_TEXTS],
      [{ name: "fight", move: 1 }, "done", null, ["Foe BULBASAUR used TACKLE!", "SQUIRTLE used TAIL WHIP!", "Foe BULBASAUR's DEFENSE fell!"]],
      [{ name: "readText" }, "done", null, ["OAK: Lowering the foe's stats will put you at an advantage."]],
      [{ name: "fight", move: 0 }, "done", null, ["Foe BULBASAUR used TACKLE!", "SQUIRTLE used TACKLE!"]],
      [{ name: "readText" }, "done", null, ["OAK: Inflicting damage on the foe is the key to any battle."]],
      ...[1, 2, 3].map(() => [{ name: "fight" as const, move: 0 }, "done", null, ["Foe BULBASAUR used TACKLE!", "SQUIRTLE used TACKLE!"]]),
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
    expect(first.observation.party).toMatchObject([
      {
        species: "SQUIRTLE",
        nickname: "SQUIRTLE",
        level: 6,
        status: "none",
        moves: [
          { name: "TACKLE", pp: 35, maxPp: 35 },
          { name: "TAIL WHIP", pp: 30, maxPp: 30 },
        ],
      },
    ]);
    expect(first.observation.party).toHaveLength(1);
    expect(first.observation.party[0].hp).toBe(first.observation.party[0].maxHp);
    expect(first.observation.party[0].maxHp).toBeWithin(21, 24);
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
      [{ name: "name" }],
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
      readText,
      readText,
      [goTo],
    ]);
    harness.actions.forEach(({ action }, i) => {
      if (action.name === "press") throw new Error("the scripted bot uses a Raw input");
      expect(seen[i]).toContainEqual(action.name === "goTo" || action.name === "name" ? { name: action.name } : action);
    });
  });

  test("observe gives what the Summary screen shows: the types, the ability, the held item, the nature, the stats and the EXP, and for each move its type, power, accuracy, PP and description", async () => {
    const harness = await Harness.open();
    await toStarter(harness);
    const [squirtle] = harness.observe().party;
    expect(squirtle).toMatchObject({
      species: "SQUIRTLE",
      level: 5,
      types: ["WATER"],
      ability: { name: "TORRENT", description: "Ups WATER moves in a pinch." },
      heldItem: null,
      // Medium Slow growth: 135 EXP at level 5, 179 at level 6.
      exp: 135,
      expToNextLevel: 44,
      moves: [
        { name: "TACKLE", type: "NORMAL", power: 35, accuracy: 95, pp: 35, maxPp: 35, description: "A physical attack in which the user charges, full body, into the foe." },
        { name: "TAIL WHIP", type: "NORMAL", power: null, accuracy: 100, pp: 30, maxPp: 30, description: "The user wags its tail cutely, making the foe lower its DEFENSE stat." },
      ],
    });
    expect(squirtle.nature).toMatch(/^[A-Z]+$/);
    expect(squirtle.stats.defense).toBeWithin(11, 14);
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
    expect(battle.enemy).toEqual({ species: "BULBASAUR", types: ["GRASS", "POISON"], level: 5, hpPercent: 100, status: "none", statStages: NO_STAGES, movesSeen: [] });
    expect(harness.availableActions()).toEqual([
      { name: "fight", move: 0 },
      { name: "fight", move: 1 },
    ]);
    expect(await harness.run()).toMatchObject({ status: "impossible", reason: "there is no running from a trainer battle", frames: 0 });
    expect(await harness.readText()).toMatchObject({ status: "impossible", frames: 0 });
  });

  test("fight moves the cursors of the battle menus, also from the move menu; in the party menu with one Pokémon, the game waits for a partyPick with no available action", async () => {
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
    expect(await harness.readText()).toMatchObject({ status: "done", text: ["Wild PIDGEY appeared!", "Go! SQUIRTLE!"] });
    expect(battleOf(harness)).toMatchObject({ kind: "wild", enemy: { species: "PIDGEY", level: 2, hpPercent: 100 } });
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
    expect(await harness.fight(1)).toMatchObject({ status: "done", text: expect.arrayContaining(["Wild PIDGEY used TACKLE!"]) });
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
    expect(seen).toEqual({ species: "BULBASAUR", types: ["GRASS", "POISON"], level: 5, hpPercent: 100, status: "none", statStages: NO_STAGES, movesSeen: [] });
    if (!exact) throw new Error("no exact values at the full level");
    expect(exact.hp).toBe(exact.maxHp);
    expect(exact.maxHp).toBeWithin(19, 22);
    expect(exact.stats.attack).toBeWithin(9, 12);
    expect(Object.keys(exact.stats)).toEqual(["attack", "defense", "speed", "spAttack", "spDefense"]);
  });

  test("on the overworld, observe gives the people of the map with the name of their sprite; the Atlas gives the rival with its name from the save", async () => {
    const harness = await Harness.open();
    await toLab(harness);
    const observation = harness.observe();
    if (observation.mode !== "overworld") throw new Error("not on the overworld");
    expect(observation.people).toEqual(expect.arrayContaining([expect.objectContaining({ x: 6, y: 3, graphics: "PROF_OAK" }), expect.objectContaining({ x: 9, y: 4, graphics: "ITEM_BALL" })]));
    const lab = observation.atlas.maps.find((m) => m.name === "PalletTown_ProfessorOaksLab");
    expect(lab?.people).toContainEqual(expect.objectContaining({ x: 5, y: 4, graphics: "BLUE", rival: "BOB" }));
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
    expect(harness.observe().waitingFor).toEqual({ kind: "choice", options: ["YES", "NO"], cursor: 0, columns: 1 });
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

  test("goTo a cell outside the map is impossible with no frames, and the reason gives the cells of the map", async () => {
    const harness = await Harness.open();
    const range = "the cells of PalletTown_PlayersHouse_2F are x from 0 to 11, y from 0 to 8";
    expect(await harness.goTo(6, 9)).toEqual({ status: "impossible", reason: `no map connects to the south edge of PalletTown_PlayersHouse_2F; ${range}`, frames: 0 });
    expect(await harness.goTo(6, 20)).toEqual({ status: "impossible", reason: `(6, 20) is outside PalletTown_PlayersHouse_2F; ${range}`, frames: 0 });
    expect(await harness.goTo(6, -1, "PalletTown")).toEqual({
      status: "impossible",
      reason: "(6, -1) is outside PalletTown, and a cell past an edge crosses it only in a goTo with no map; the cells of PalletTown are x from 0 to 23, y from 0 to 19",
      frames: 0,
    });
  });

  test("goTo to an exit of the map takes it: the stairs, the door mat, a door and the north edge, and it is done on the other map", async () => {
    const harness = await Harness.open();
    expect(await harness.goTo(10, 2)).toMatchObject({ status: "done" });
    expect(harness.observe()).toMatchObject({ map: { name: "PalletTown_PlayersHouse_1F" } });
    expect(await harness.goTo(4, 8)).toMatchObject({ status: "done" });
    expect(harness.observe()).toMatchObject({ map: { name: "PalletTown" } });
    expect(await harness.goTo(4, 20)).toEqual({ status: "impossible", reason: "you cannot go there now: the south edge of PalletTown is water. Only a Pokémon that knows SURF can cross water, and you have none", frames: 0 });
    expect(await harness.goTo(15, 7)).toMatchObject({ status: "done" });
    expect(harness.observe()).toMatchObject({ map: { name: "PalletTown_RivalsHouse" } });
    expect(await harness.goTo(12, -1, "PalletTown")).toMatchObject({ status: "impossible", frames: 0 });

    const after = await Harness.open();
    await starter.play(after);
    expect(await after.goTo(6, 12)).toMatchObject({ status: "done" });
    expect(after.observe()).toMatchObject({ map: { name: "PalletTown" } });
    expect(await after.goTo(12, -1)).toMatchObject({ status: "done" });
    expect(after.observe()).toMatchObject({ map: { name: "Route1" } });
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

  test("at the player level, the Atlas of the starter Run has only the maps and the cells that the Run saw; a door shows its destination only when the Run went through it", async () => {
    const harness = await Harness.open();
    await harness.play(starter);
    const { atlas } = harness.observe();
    expect(atlas.maps.map((m) => m.name)).toEqual(["PalletTown_PlayersHouse_2F", "PalletTown_PlayersHouse_1F", "PalletTown", "PalletTown_ProfessorOaksLab"]);
    const pallet = mapNamed(atlas, "PalletTown");
    expect(cellAt(pallet, { x: 6, y: 8 })).not.toBe("?");
    expect(cellAt(pallet, { x: 0, y: 19 })).toBe("?");
    expect(pallet.warps).toContainEqual(expect.objectContaining({ x: 6, y: 7, to: "PalletTown_PlayersHouse_1F" }));
    expect(pallet.warps).toContainEqual(expect.objectContaining({ x: 15, y: 7, to: null }));
  });

  test("at the full level, the Atlas has all the maps of the game, with all their cells and the destinations of all their exits; a map with no warps has an entry on an edge", async () => {
    const harness = await Harness.open({ knowledge: "full" });
    const { atlas } = harness.observe();
    expect(atlas.maps.map((m) => m.name)).toEqual(expect.arrayContaining(["PalletTown", "Route1", "ViridianCity", "CeruleanCity_Gym"]));
    const pallet = mapNamed(atlas, "PalletTown");
    expect(pallet.cells).not.toContain("?");
    expect(pallet.warps).toContainEqual(expect.objectContaining({ x: 15, y: 7, to: "PalletTown_RivalsHouse" }));
    expect(pallet.edges).toEqual([
      { side: "north", to: "Route1" },
      { side: "south", to: "Route21_North", blocked: "water" },
    ]);
    const route3 = mapNamed(atlas, "Route3");
    expect(route3.warps).toEqual([]);
    expect(route3.entry).not.toBeNull();
  });

  test("a sign that the player read has its text in the Atlas", async () => {
    const harness = await Harness.open();
    await harness.goTo(10, 2);
    await harness.goTo(4, 8, "PalletTown");
    expect(await harness.interact(4, 7)).toMatchObject({ status: "done" });
    await harness.readText();
    expect(mapNamed(harness.observe().atlas, "PalletTown").signs).toContainEqual(expect.objectContaining({ x: 4, y: 7, text: "PLOK's house" }));
  });

  test("a talk to a person adds its whole text to the Atlas once, and a new text of the same person adds a second one", async () => {
    const harness = await Harness.open();
    const talkToMom = async () => {
      await harness.goTo(8, 5, "PalletTown_PlayersHouse_1F");
      expect(await harness.interact(8, 4)).toMatchObject({ status: "done" });
      while (harness.observe().waitingFor.kind !== "walk") await harness.readText();
    };
    const momTexts = () => mapNamed(harness.observe().atlas, "PalletTown_PlayersHouse_1F").people.find((p) => p.graphics === "MOM")?.texts;
    await talkToMom();
    await talkToMom();
    expect(momTexts()).toEqual(["MOM: …Right. All boys leave home someday. It said so on TV. Oh, yes. PROF. OAK, next door, was looking for you."]);
    await starter.play(harness);
    await talkToMom();
    expect(momTexts()).toHaveLength(2);
    expect(momTexts()?.[1]).toStartWith("MOM: PLOK! You should take a quick rest.");
  });

  test("goTo to a blocked cell returns impossible and runs no frames", async () => {
    const harness = await Harness.open();
    const frame = harness.frame;
    const result = await harness.goTo(8, 2);
    expect(result).toMatchObject({ status: "impossible", frames: 0 });
    expect(harness.frame).toBe(frame);
  });
});

const TEST_BAG = join(SAVES_DIR, "test-bag.sav");
const TAIL_WHIP = 1;

describe.skipIf(!existsSync(ROM_FILE) || !existsSync(TEST_BAG))("Harness on the test Starting save with the Bag", () => {
  async function toWildBattle(): Promise<Harness> {
    const harness = await Harness.open({ startSave: TEST_BAG });
    const observation = harness.observe();
    if (observation.mode !== "overworld") throw new Error("the test Starting save is not on the overworld");
    const { x, y } = observation.player;
    for (let step = 0; harness.waitingFor().kind === "walk"; step++) {
      if (step === 100) throw new Error("no wild battle in 100 steps");
      await harness.goTo(x, step % 2 === 0 ? y - 1 : y);
    }
    while (harness.waitingFor().kind !== "battleAction") await harness.readText();
    return harness;
  }

  async function toNextAction(harness: Harness): Promise<void> {
    while (harness.observe().mode === "battle" && !["battleAction", "choice"].includes(harness.waitingFor().kind)) await harness.readText();
  }

  test("observe() gives the Bag by pocket and the money, and a battle accepts use for the items that work now", async () => {
    const harness = await toWildBattle();
    const observation = harness.observe();
    expect(observation.money).toBe(3080);
    expect(observation.bag).toEqual([
      { pocket: "ITEMS", items: [{ name: "POTION", quantity: 5, description: "A spray-type wound medicine. It restores the HP of one POKéMON by 20 points.", price: 300, battle: "pokemon", walk: "pokemon" }] },
      { pocket: "POKé BALLS", items: [{ name: "POKé BALL", quantity: 20, description: "A BALL thrown to catch a wild POKéMON. It is designed in a capsule style.", price: 200, battle: "alone", walk: null }] },
    ]);
    expect(harness.availableActions()).toEqual(expect.arrayContaining([{ name: "use", item: "POTION" }, { name: "use", item: "POKé BALL" }]));
  });

  test("a Potion on a Pokémon with full HP is impossible, with the reason of the game, and the Bag keeps it", async () => {
    const harness = await toWildBattle();
    expect(await harness.use("POTION", 0)).toMatchObject({ status: "impossible", reason: "the game refuses the POTION: It won't have any effect." });
    expect(harness.observe()).toMatchObject({ waitingFor: { kind: "battleAction" }, bag: [{ items: [{ name: "POTION", quantity: 5 }] }, expect.anything()] });
  });

  test("use POTION on a hurt Pokémon heals it in a battle", async () => {
    const harness = await toWildBattle();
    for (let turn = 0; harness.observe().party[0].hp === harness.observe().party[0].maxHp; turn++) {
      if (turn === 10) throw new Error("SQUIRTLE is not hurt after 10 turns");
      await harness.fight(TAIL_WHIP);
      await toNextAction(harness);
    }
    const { hp, maxHp } = harness.observe().party[0];
    const result = await harness.use("POTION", 0);
    expect(result).toMatchObject({ status: "done" });
    const restored = Math.min(20, maxHp - hp);
    expect(result.text[0]).toBe(`SQUIRTLE's HP was restored by ${restored} point(s).`);
    expect(harness.observe().bag[0].items[0].quantity).toBe(4);
  });

  test("use POKé BALL throws a ball in a wild battle; after YES at the nickname question, name types the nickname on two pages of the keyboard, and the caught Pokémon joins the party with it", async () => {
    const harness = await toWildBattle();
    const enemy = harness.observe();
    if (enemy.mode !== "battle") throw new Error("not in a battle");
    for (let ball = 0; harness.waitingFor().kind !== "choice"; ball++) {
      if (ball === 20) throw new Error("no catch with 20 balls");
      expect(await harness.use("POKé BALL")).toMatchObject({ status: "done" });
      await toNextAction(harness);
    }
    expect(harness.observe()).toMatchObject({ mode: "battle", waitingFor: { kind: "choice", options: ["YES", "NO"] } });
    expect(await harness.choose("YES")).toMatchObject({ status: "done" });
    expect(harness.waitingFor()).toMatchObject({ kind: "naming", subject: `a nickname for ${enemy.battle.enemy.species}`, maxLength: 10 });
    expect(await harness.name("Bird")).toMatchObject({ status: "done" });
    while (harness.observe().mode === "battle" || harness.waitingFor().kind !== "walk") await harness.readText();
    expect(harness.observe().party.map((m) => [m.species, m.nickname])).toEqual([
      ["SQUIRTLE", "SQUIRTLE"],
      [enemy.battle.enemy.species, "Bird"],
    ]);
  });

  test("on a walk, use lists only the items that work outside a battle; use POTION heals a hurt Pokémon, and the game refuses it at full HP each time", async () => {
    const harness = await Harness.open({ startSave: TEST_BAG });
    expect(harness.availableActions()).toContainEqual({ name: "use", item: "POTION" });
    expect(harness.availableActions()).not.toContainEqual({ name: "use", item: "POKé BALL" });
    expect(await harness.use("POKé BALL")).toMatchObject({ status: "impossible", reason: "POKé BALL does not work outside a battle", frames: 0 });
    for (let use = 0; use < 2; use++) expect(await harness.use("POTION", 0)).toMatchObject({ status: "impossible", reason: "the game refuses the POTION: It won't have any effect." });
    expect(harness.observe()).toMatchObject({ waitingFor: { kind: "walk" }, bag: [{ items: [{ name: "POTION", quantity: 5 }] }, expect.anything()] });
    harness.close();

    const hurt = await toWildBattle();
    for (let turn = 0; hurt.observe().party[0].hp === hurt.observe().party[0].maxHp; turn++) {
      if (turn === 10) throw new Error("SQUIRTLE is not hurt after 10 turns");
      await hurt.fight(TAIL_WHIP);
      await toNextAction(hurt);
    }
    for (let turn = 0; hurt.waitingFor().kind !== "walk"; turn++) {
      if (turn === 40) throw new Error("the battle does not end");
      await (hurt.waitingFor().kind === "battleAction" ? hurt.run() : hurt.readText());
    }
    const { hp, maxHp } = hurt.observe().party[0];
    const result = await hurt.use("POTION", 0);
    expect(result).toMatchObject({ status: "done", text: [`SQUIRTLE's HP was restored by ${Math.min(20, maxHp - hp)} point(s).`] });
    expect(hurt.observe()).toMatchObject({ waitingFor: { kind: "walk" }, party: [{ hp: Math.min(maxHp, hp + 20) }], bag: [{ items: [{ name: "POTION", quantity: 4 }] }, expect.anything()] });
    expect(hurt.rawInputs).toBe(0);
  });
});

const PARTY_SAVE = join(SAVES_DIR, "test-party.sav");

describe.skipIf(!existsSync(ROM_FILE) || !existsSync(PARTY_SAVE))("Harness on the test Starting save with 2 Pokémon", () => {
  async function toWildBattle(harness: Harness) {
    for (let leg = 0; (await harness.goTo(12, leg % 2 ? 2 : 30, "Route1")).status !== "interrupted"; leg++) {
      if (leg === 8) throw new Error("no wild battle");
    }
    while (harness.observe().waitingFor.kind !== "battleAction") await harness.readText();
  }

  test("switch changes the Pokémon in a battle", async () => {
    const harness = await Harness.open({ startSave: PARTY_SAVE });
    await toWildBattle(harness);
    expect(battleOf(harness).player.nickname).toBe("SQUIRTLE");
    expect(harness.availableActions()).toContainEqual({ name: "switch", slot: 1 });
    expect(await harness.switch(1)).toMatchObject({ status: "done", text: expect.arrayContaining(["Go! SHELL!"]) });
    expect(battleOf(harness).player.nickname).toBe("SHELL");
    expect(harness.rawInputs).toBe(0);
  });

  test("a switch that the game refuses is impossible, with the text of the game as its reason, and the battle waits again for an action", async () => {
    const harness = await Harness.open({ startSave: PARTY_SAVE });
    await toWildBattle(harness);
    expect(harness.availableActions()).not.toContainEqual({ name: "switch", slot: 0 });
    expect(await harness.switch(0)).toMatchObject({ status: "impossible", reason: "SQUIRTLE is already in battle!" });
    expect(harness.observe().waitingFor).toEqual({ kind: "battleAction" });
    expect(await harness.switch(2)).toMatchObject({ status: "impossible", reason: "the party has no Pokémon 2", frames: 0 });
  });

  test("after a faint in a wild battle, YES at the choice opens the party menu, and send sends the chosen Pokémon", async () => {
    const harness = await Harness.open({ startSave: PARTY_SAVE });
    await toWildBattle(harness);
    await harness.switch(1);
    for (let turn = 0; harness.observe().waitingFor.kind !== "choice"; turn++) {
      if (turn === 20) throw new Error("SHELL does not faint");
      await (harness.observe().waitingFor.kind === "battleAction" ? harness.fight(0) : harness.readText());
    }
    expect(harness.observe().waitingFor).toEqual({ kind: "choice", options: ["YES", "NO"], cursor: 0, columns: 1 });
    expect(await harness.choose("YES")).toMatchObject({ status: "done" });
    expect(harness.observe().waitingFor).toEqual({ kind: "partyPick" });
    const squirtle = harness.observe().party.findIndex((mon) => mon.nickname === "SQUIRTLE");
    expect(harness.availableActions()).toEqual([{ name: "send", slot: squirtle }]);
    expect(await harness.send(squirtle)).toMatchObject({ status: "done", text: expect.arrayContaining(["Go! SQUIRTLE!"]) });
    expect(battleOf(harness).player.nickname).toBe("SQUIRTLE");
    expect(harness.rawInputs).toBe(0);
  });

  test("swap changes the order of the party on a walk", async () => {
    const harness = await Harness.open({ startSave: PARTY_SAVE });
    expect(harness.availableActions()).toContainEqual({ name: "swap" });
    expect(await harness.swap(0, 1)).toMatchObject({ status: "done" });
    expect(harness.observe().party.map((mon) => mon.nickname)).toEqual(["SHELL", "SQUIRTLE"]);
    expect(harness.observe().waitingFor).toEqual({ kind: "walk" });
    expect(harness.rawInputs).toBe(0);
  });
});

const MART_SAVE = join(SAVES_DIR, "test-mart.sav");
const MART_COUNTER = { x: 3, y: 3 };

describe.skipIf(!existsSync(ROM_FILE) || !existsSync(MART_SAVE))("Harness on the test Starting save at a Poké Mart", () => {
  async function toShopMenu(): Promise<Harness> {
    const harness = await Harness.open({ startSave: MART_SAVE });
    await harness.interact(MART_COUNTER.x, MART_COUNTER.y);
    return harness;
  }

  test("buy POTION 2 from the shop menu, on the second row of the buy list, puts 2 Potions in the Bag, takes their price from the money and ends at the shop menu", async () => {
    const harness = await toShopMenu();
    expect(harness.observe()).toMatchObject({
      money: 3080,
      waitingFor: {
        kind: "shopMenu",
        items: [
          { name: "POKé BALL", price: 200 },
          { name: "POTION", price: 300 },
          { name: "ANTIDOTE", price: 100 },
          { name: "PARLYZ HEAL", price: 200 },
        ],
      },
    });
    expect(await harness.buy("POTION", 2)).toMatchObject({ status: "done" });
    expect(harness.observe()).toMatchObject({ money: 2480, waitingFor: { kind: "shopMenu" }, bag: [{ pocket: "ITEMS", items: [{ name: "POTION", quantity: 7 }] }, expect.anything()] });
    expect(harness.rawInputs).toBe(0);
  });

  test("sell gives money for an item of the Bag: half of its price for each one, and leave says goodbye and gives back the walk", async () => {
    const harness = await toShopMenu();
    expect(harness.availableActions()).toContainEqual({ name: "sell", item: "POTION" });
    expect(await harness.sell("POTION", 2)).toMatchObject({ status: "done" });
    expect(harness.observe()).toMatchObject({ money: 3380, waitingFor: { kind: "shopMenu" }, bag: [{ pocket: "ITEMS", items: [{ name: "POTION", quantity: 3 }] }, expect.anything()] });
    expect(await harness.leave()).toMatchObject({ status: "done", text: ["Please come again!"] });
    expect(harness.observe().waitingFor).toEqual({ kind: "walk" });
    expect(harness.rawInputs).toBe(0);
  });

  test("a buy with not enough money is impossible, with a reason, and runs no frames", async () => {
    const harness = await toShopMenu();
    expect(await harness.buy("POKé BALL", 20)).toEqual({ status: "impossible", reason: "20 POKé BALL cost 4000 and the money is 3080", frames: 0 });
    expect(harness.observe()).toMatchObject({ money: 3080, waitingFor: { kind: "shopMenu" } });
  });
});

describe.skipIf(!existsSync(ROM_FILE) || !existsSync(MART_SAVE))("Harness on the test Starting save at a Pokémon Center", () => {
  test("the Nurse asks with a multichoice menu: it is a choice, and choose YES heals the party", async () => {
    const harness = await Harness.open({ startSave: MART_SAVE });
    must(await harness.goTo(7, 4, "ViridianCity_PokemonCenter_1F"));
    must(await harness.interact(7, 3));
    expect(await harness.readText()).toMatchObject({ status: "done", text: ["Welcome to our POKéMON CENTER! Would you like me to heal your POKéMON back to perfect health?"] });
    expect(harness.waitingFor()).toEqual({ kind: "choice", options: ["YES", "NO"], cursor: 0, columns: 1 });
    must(await harness.choose("YES"));
    expect(await harness.readText()).toMatchObject({ status: "done", text: ["Thank you for waiting. We've restored your POKéMON to full health.", "We hope to see you again!"] });
    expect(harness.waitingFor().kind).toBe("walk");
  });
});

const WHITEOUT_SAVE = join(SAVES_DIR, "test-whiteout.sav");

describe.skipIf(!existsSync(ROM_FILE) || !existsSync(WHITEOUT_SAVE))("Harness on the test Starting save before a whiteout", () => {
  test("after a whiteout, readText reads the texts through the warp to the Pokémon Center and ends at the walk there", async () => {
    const harness = await Harness.open({ startSave: WHITEOUT_SAVE });
    expect(await harness.goTo(26, 26)).toMatchObject({ status: "interrupted", reason: "script" });
    const before = harness.frame;
    expect(await harness.readText()).toMatchObject({
      status: "done",
      text: [
        "SQUIRTLE fainted…",
        "PLOK is out of usable POKéMON! PLOK panicked and lost ¥48… … … … … PLOK whited out!",
        "PLOK scurried to a POKéMON CENTER, protecting the exhausted and fainted POKéMON from further harm…",
        "First, you should restore your POKéMON to full health.",
        "Your POKéMON have been healed to perfect health. If your POKéMON's energy, HP, is down, please come see us. If you're planning to go far in the field, you should buy some POTIONS at the POKéMON MART. We hope you excel!",
      ],
    });
    expect(harness.frame - before).toBeLessThan(3600);
    expect(harness.observe()).toMatchObject({ map: { name: "ViridianCity_PokemonCenter_1F" }, waitingFor: { kind: "walk" }, party: [{ hp: 22, maxHp: 22, status: "none" }] });
  });
});

describe.skipIf(!existsSync(ROM_FILE) || !existsSync(MART_SAVE))("Harness on the test Starting save at the school of Viridian City", () => {
  test("the blackboard of the school asks with a grid menu: it is a choice with its 6 options, and choose FRZ moves the cursor right and down and reads the topic", async () => {
    const harness = await Harness.open({ startSave: MART_SAVE });
    must(await harness.goTo(5, 2, "ViridianCity_School"));
    must(await harness.interact(5, 1));
    expect(await harness.readText()).toMatchObject({ status: "done", text: ["The blackboard lists POKéMON STATUS problems during battles.", "Which topic do you want to read?"] });
    expect(harness.waitingFor()).toEqual({ kind: "choice", options: ["SLP", "PSN", "PAR", "BRN", "FRZ", "EXIT"], cursor: 0, columns: 3 });
    must(await harness.choose("FRZ"));
    expect(await harness.readText()).toMatchObject({
      status: "done",
      text: ["A frozen POKéMON becomes helplessly immobile. It stays frozen even after the battle ends. Use ICE HEAL to thaw out the suffering POKéMON.", "Which topic do you want to read?"],
    });
    expect(harness.waitingFor()).toMatchObject({ kind: "choice", cursor: 0 });
  });
});
