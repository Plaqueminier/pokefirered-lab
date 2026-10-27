import { describe, expect, test } from "bun:test";
import { type Battle, enemyView } from "../battle";
import { battleTurn, fightFacts } from "../battle-facts";
import type { AtlasPerson } from "../harness/atlas";
import type { ActionEntry, Observation } from "../harness/harness";
import type { ModelEvent, RunEvent } from "../harness/record";
import { askedOf, readAction } from "./decision";
import { importantEvents } from "./important-events";
import { MAX_TRIES, missionLine, nextMilestone, systemPrompt, tries, turnKind, userPrompt } from "./prompt";

const BALLS = "Those are POKé BALLS. They contain POKéMON!";

function call(action: string, mission = "", note = ""): ModelEvent {
  return {
    type: "model",
    frame: 0,
    latencyMs: 1,
    model: "a/b",
    situation: "a walk on PalletTown_ProfessorOaksLab (8, 5)",
    prompt: { system: "", user: "" },
    answer: "",
    usage: { promptTokens: 0, completionTokens: 0, reasoningTokens: 0, cost: 0 },
    decision: { reason: "", action, mission, objective: "", note },
    error: null,
  };
}

const NO_TURN = { noProgress: { stuck: 0, since: 0 }, turn: "normal" as const, happened: [] };
const SYSTEM = { starter: "free", stopAtWhiteout: false } as const;
const POTION = { name: "POTION", quantity: 5, description: "It restores the HP of one POKéMON by 20 points.", price: 300, battle: "pokemon", walk: "pokemon" };

function route1(hp: number, items: object[], people: AtlasPerson[] = []): Observation {
  const stats = { attack: 10, defense: 10, speed: 10, spAttack: 10, spDefense: 10 };
  const map = { name: "Route1", width: 3, height: 3, cells: "...".repeat(3), warps: [], edges: [], hasEdges: false, signs: [], people, obstacles: [], entry: null };
  return {
    mode: "overworld",
    waitingFor: { kind: "walk" },
    party: [{ nickname: "SQUIRTLE", species: "SQUIRTLE", types: ["WATER"], level: 6, hp, maxHp: 22, status: "none", moves: [], ability: { name: "TORRENT", description: "" }, nature: "BOLD", stats, exp: 0, expToNextLevel: 1 }],
    money: 3080,
    bag: [{ pocket: "ITEMS", items }],
    milestones: [],
    map: { group: 0, num: 0, name: "Route1" },
    player: { x: 1, y: 1, facing: "north" },
    grid: { name: "Route1", x0: 0, y0: 0, width: 3, height: 3, mapWidth: 3, mapHeight: 3, kinds: map.cells, connections: [], signs: [] },
    people: [],
    atlas: { maps: [map], lastTalk: people[0] ? { map: "Route1", localId: people[0].localId } : null },
  } as unknown as Observation;
}

function played(action: ActionEntry["action"], result: ActionEntry["result"]): RunEvent {
  return { type: "action", frame: 0, action, result };
}

const talk: RunEvent[] = [
  call("go 3"),
  played({ name: "interact", x: 8, y: 4 }, { status: "done", frames: 10 }),
  played({ name: "readText" }, { status: "done", frames: 50, text: [BALLS] }),
];

describe("the tries since the last progress", () => {
  test("it lists each action that the model chose, one time, with the number of times, its result and the texts that the program read after it", () => {
    const events = [
      ...talk,
      ...talk,
      ...talk,
      call("goTo 3 3"),
      played({ name: "goTo", x: 3, y: 3 }, { status: "impossible", reason: "no route", frames: 0 }),
      call("press Start"),
      played({ name: "press", button: "Start" }, { status: "done", frames: 2 }),
      played({ name: "readText" }, { status: "impossible", reason: "the game waits for no known input", frames: 3600, text: [] }),
      ...[1, 2, 3].map(() => played({ name: "press", button: "B" }, { status: "done", frames: 2 })),
    ];
    expect(tries(events, 0)).toEqual([`- interact(8, 4) ×3: "${BALLS}"`, "- goTo(3, 3) ×1: impossible (no route)", "- press(Start) ×1: done"]);
  });

  test("in the turn of the last progress, the answer after the progress is a try, and the B presses of the code are not", () => {
    const walk = played({ name: "goTo", x: 8, y: 5 }, { status: "done", frames: 30 });
    const presses = [1, 2, 3].map(() => played({ name: "press", button: "B" }, { status: "done", frames: 2 }));
    const progressInAnswer = [call("go 3"), walk, ...talk.slice(1)];
    expect(tries(progressInAnswer, 2)).toEqual([`- interact(8, 4) ×1: "${BALLS}"`]);
    const progressInText = [call("go 3"), walk, talk[1], played({ name: "readText" }, { status: "impossible", reason: "the game waits for no known input", frames: 3600, text: [] }), ...presses];
    expect(tries(progressInText, 4)).toEqual([]);
  });

  test(`past ${MAX_TRIES} different tries, it keeps the last ones`, () => {
    const events = Array.from({ length: MAX_TRIES + 5 }, (_, i) => [call(`goTo ${i} 0`), played({ name: "goTo", x: i, y: 0 }, { status: "blocked", reason: "a person", frames: 60 })]).flat();
    const lines = tries(events, 0);
    expect(lines).toHaveLength(MAX_TRIES + 1);
    expect(lines[0]).toBe("- … and 5 other tries before");
    expect(lines.at(-1)).toBe(`- goTo(${MAX_TRIES + 4}, 0) ×1: blocked (a person)`);
  });
});

describe("the loop warning", () => {
  test("when the last 3 decisions played the same action with the same result, the prompt shows one warning line", () => {
    const observation = route1(22, []);
    const asked = askedOf(observation, false)!;
    const blocked = [call("goTo 3 3"), played({ name: "goTo", x: 3, y: 3 }, { status: "blocked", reason: "a person", frames: 60 })];
    const warning = 'Warning: your last 3 decisions played the same action with the same result: goTo(3, 3): blocked (a person). If it does not bring you closer to your objective, choose another action.';
    expect(userPrompt(observation, asked, [...blocked, call("zoom 1-2"), ...blocked, ...blocked], NO_TURN)).toContain(warning);
    expect(userPrompt(observation, asked, [...blocked, ...blocked], NO_TURN)).not.toContain("Warning:");
  });
});

describe("the Mission", () => {
  test("the prompt shows the last Mission that the model gave, and for how many decisions it did not change", () => {
    expect(missionLine([])).toBe("Mission: none yet.");
    const events = [call("go 1", "Leave the house"), call("go 2", "Get my first Pokémon"), call("go 3", ""), call("go 4", "Get my first Pokémon"), call("go 5", "Get my first Pokémon")];
    expect(missionLine(events)).toBe("Mission: Get my first Pokémon (the same for 4 decisions).");
    expect(missionLine(events.slice(0, 2))).toBe("Mission: Get my first Pokémon (the same for 1 decision).");
  });
});

describe("the next Milestone", () => {
  test("it is the first Milestone, in the order of the story, that the Run did not reach, with a name and a place only", () => {
    expect(nextMilestone([])).toBe("Get your first Pokémon from Professor Oak in Pallet Town.");
    expect(nextMilestone(["has-pokemon", "first-rival-battle"])).toBe("Get OAK'S PARCEL in Viridian City and bring it back to Professor Oak.");
    expect(nextMilestone(["first-rival-battle"])).toBe("Get your first Pokémon from Professor Oak in Pallet Town.");
    expect(nextMilestone(["has-pokemon", "first-rival-battle", "pokedex", "badge-1", "badge-2", "badge-3", "badge-4", "badge-5", "badge-6", "badge-7"])).toBe(
      "Earn the Earth Badge from Giovanni, the Gym Leader of Viridian City.",
    );
  });
});

describe("the Bag", () => {
  test("each prompt shows the money and the Bag once, with the effect of each item; a battle has one use line for the items that work now", () => {
    const stages = { attack: 0, defense: 0, speed: 0, spAttack: 0, spDefense: 0, accuracy: 0, evasion: 0 };
    const stats = { attack: 10, defense: 10, speed: 10, spAttack: 10, spDefense: 10 };
    const observation = {
      mode: "battle",
      waitingFor: { kind: "battleAction" },
      party: [],
      money: 3080,
      bag: [
        { pocket: "ITEMS", items: [{ name: "POTION", quantity: 5, description: "It restores the HP of one POKéMON by 20 points.", price: 300, battle: "pokemon", walk: "pokemon" }] },
        { pocket: "KEY ITEMS", items: [{ name: "TOWN MAP", quantity: 1, description: "A very convenient map.", price: 0, battle: null, walk: null }] },
        { pocket: "POKé BALLS", items: [{ name: "POKé BALL", quantity: 20, description: "A BALL thrown to catch a wild POKéMON.", price: 200, battle: "alone", walk: null }] },
      ],
      milestones: [],
      atlas: { maps: [], lastTalk: null },
      battle: {
        kind: "wild",
        player: { species: "SQUIRTLE", nickname: "SQUIRTLE", types: ["WATER"], level: 6, hp: 20, maxHp: 22, status: "none", stats, moves: [], statStages: stages, partyIndex: 0 },
        enemy: { species: "PIDGEY", types: ["NORMAL", "FLYING"], level: 3, hpPercent: 100, status: "none", statStages: stages, movesSeen: [] },
        fights: [],
        lastTurn: null,
        foeTurns: [],
      },
    } as Observation;
    const prompt = userPrompt(observation, askedOf(observation, false)!, [], NO_TURN);
    expect(prompt).toContain(
      [
        "Money: 3080",
        "Bag:",
        "- ITEMS: POTION ×5 (It restores the HP of one POKéMON by 20 points.)",
        "- KEY ITEMS: TOWN MAP ×1 (A very convenient map.)",
        "- POKé BALLS: POKé BALL ×20 (A BALL thrown to catch a wild POKéMON.)",
      ].join("\n"),
    );
    expect(prompt).toContain("- use <item> [on <Pokémon>]: use an item of your Bag. The items that work now: POTION (on a Pokémon), POKé BALL.");
  });

  test("on a walk, the use line lists only the items that work outside a battle; the model uses POTION on a Pokémon of the party, and REPEL alone; the press line has no Start", () => {
    const repel = { name: "REPEL", quantity: 1, description: "Prevents weak wild POKéMON from appearing for 100 steps.", price: 350, battle: null, walk: "alone" };
    const observation = route1(10, [POTION, repel]);
    observation.bag.push({ pocket: "POKé BALLS", items: [{ name: "POKé BALL", quantity: 20, description: "A BALL thrown to catch a wild POKéMON.", price: 200, battle: "alone", walk: null }] });
    const asked = askedOf(observation, false)!;
    const prompt = userPrompt(observation, asked, [], NO_TURN);
    expect(prompt).toContain("- use <item> [on <Pokémon>]: use an item of your Bag. The items that work now: POTION (on a Pokémon), REPEL.");
    expect(prompt).toContain("- press <button>: one press of A, B, Select, Up, Down, Left, Right, L or R.");
    expect(readAction("use potion on squirtle", asked)).toEqual({ name: "use", item: "POTION", on: 0 });
    expect(readAction("use repel", asked)).toEqual({ name: "use", item: "REPEL" });
    expect(() => readAction("use POKé BALL", asked)).toThrow('"POKé BALL" is not an item that works now: POTION, REPEL');
  });
});

describe("the battle facts", () => {
  test("each fight shows its effect on the foe, STAB and a damage estimate from the formula of the game; the prompt shows the last turn and the moves used on this foe", () => {
    const stages = { attack: 0, defense: 0, speed: 0, spAttack: 0, spDefense: 0, accuracy: 0, evasion: 0 };
    const moves = [
      { name: "BUBBLE", type: "WATER", power: 20, accuracy: 100, pp: 29, maxPp: 30, description: "" },
      { name: "TAIL WHIP", type: "NORMAL", power: null, accuracy: 100, pp: 30, maxPp: 30, description: "" },
      { name: "SEISMIC TOSS", type: "FIGHTING", power: null, fixedDamage: true as const, accuracy: 100, pp: 20, maxPp: 20, description: "" },
    ];
    const squirtle: Battle["player"] = { species: "SQUIRTLE", nickname: "SQUIRTLE", types: ["WATER"], level: 6, hp: 15, maxHp: 22, status: "none", stats: { attack: 11, defense: 13, speed: 10, spAttack: 11, spDefense: 12 }, statStages: stages, moves, partyIndex: 0 };
    const bulbasaur = { ...squirtle, species: "BULBASAUR", nickname: "BULBASAUR", types: ["GRASS", "POISON"], hp: 20, stats: { attack: 11, defense: 11, speed: 10, spAttack: 13, spDefense: 13 }, moves: [] };
    const now: Battle = { kind: "trainer", player: squirtle, enemy: bulbasaur };
    const before: Battle = { kind: "trainer", player: { ...squirtle, hp: 22 }, enemy: { ...bulbasaur, hp: 22 } };
    const turn = battleTurn(before, now, ["SQUIRTLE used BUBBLE!", "It's not very effective…", "Foe BULBASAUR used TACKLE!", "A critical hit!"]);
    const chart = { effects: [{ attack: "WATER", defense: "GRASS", multiplier: 5 }], special: ["WATER"] };
    const observation = {
      mode: "battle",
      waitingFor: { kind: "battleMove" },
      party: [],
      money: 0,
      bag: [],
      milestones: [],
      atlas: { maps: [], lastTalk: null },
      battle: { kind: "trainer", player: squirtle, enemy: enemyView(bulbasaur, [], false), fights: fightFacts(now, chart, []), lastTurn: turn, foeTurns: [turn] },
    } as unknown as Observation;
    const prompt = userPrompt(observation, askedOf(observation, false)!, [], NO_TURN);
    expect(prompt).toContain(
      [
        "- fight 0: BUBBLE (WATER, power 20, accuracy 100, PP 29/30). On the foe: not very effective ×½, STAB, 5% to 10% of its HP now, 10 to 20 hits to KO.",
        "- fight 1: TAIL WHIP (NORMAL, power ---, accuracy 100, PP 30/30)",
        "- fight 2: SEISMIC TOSS (FIGHTING, power ---, accuracy 100, PP 20/20). On the foe: normal effect ×1.",
      ].join("\n"),
    );
    expect(prompt).toContain("Last turn: SQUIRTLE moved first. SQUIRTLE used BUBBLE: not very effective. Foe BULBASAUR used TACKLE: a critical hit. Your SQUIRTLE: HP 22/22 → 15/22. Foe BULBASAUR: HP 100% → 90%.");
    expect(prompt).toContain("Your moves on this foe: BUBBLE (not very effective, its HP 100% → 90%).");
  });
});

describe("a choice", () => {
  test("the choice line shows the question, the last text of the last decision, or the old line with no text; the actions are choose and zoom, with no press", () => {
    const observation = { ...route1(22, []), waitingFor: { kind: "choice", options: ["YES", "NO"] } } as Observation;
    const asked = askedOf(observation, false)!;
    const question = "Do you want to give a nickname to this BULBASAUR?";
    const events = [call("choose YES"), played({ name: "choose", option: "YES" }, { status: "done", frames: 10 }), played({ name: "readText" }, { status: "done", frames: 50, text: ["PLOK received the BULBASAUR from PROF. OAK!", question] })];
    const prompt = userPrompt(observation, asked, events, NO_TURN);
    expect(prompt).toContain(`The game asks: "${question}" Choose YES or NO.`);
    expect(userPrompt(observation, asked, [...events, call("zoom 1-2")], NO_TURN)).toContain(`The game asks: "${question}" Choose YES or NO.`);
    expect(prompt).not.toContain("The game waits for");
    expect(prompt).not.toContain("The question is the last text");
    expect(prompt).toMatch(/Actions:\n- choose YES\n- choose NO\n- zoom <a-b>: [^\n]*$/);
    expect(userPrompt(observation, asked, [], NO_TURN)).toContain("The game waits for a choice: YES, NO.");
    expect(() => readAction("press A", asked)).toThrow('"press" is not an action now: use choose or zoom');
  });
});

describe("the Poké Mart", () => {
  test("at the shop menu, the prompt shows the items for sale with their prices, the money, the items of the Bag that the Mart buys, and the actions buy, sell and leave, with no press", () => {
    const observation = {
      mode: "overworld",
      waitingFor: { kind: "shopMenu", items: [{ name: "POKé BALL", price: 200 }, { name: "POTION", price: 300 }] },
      party: [],
      money: 3080,
      bag: [
        { pocket: "ITEMS", items: [POTION] },
        { pocket: "KEY ITEMS", items: [{ name: "TOWN MAP", quantity: 1, description: "A very convenient map.", price: 0, battle: null, walk: null }] },
      ],
      milestones: [],
      atlas: { maps: [], lastTalk: null },
    } as unknown as Observation;
    const prompt = userPrompt(observation, askedOf(observation, false)!, [], NO_TURN);
    expect(prompt).toContain("The game waits for the shop menu of a Poké Mart.");
    expect(prompt).toContain("Money: 3080");
    expect(prompt).toContain(["The Poké Mart sells (the price of one item):", "- POKé BALL: 200", "- POTION: 300"].join("\n"));
    expect(prompt).toContain(["The Poké Mart buys these items of your Bag (the money for one item):", "- POTION ×5: 150"].join("\n"));
    expect(prompt).toContain(
      [
        "Actions:",
        "- buy <item> <quantity>: buy items for sale, for example buy POTION 2. Your money must pay the price of all the items.",
        "- sell <item> <quantity>: sell items of your Bag that the Poké Mart buys, for example sell POTION 1.",
        "- leave: say goodbye to the clerk and walk again.",
      ].join("\n"),
    );
    expect(prompt).not.toContain("- press");
  });
});

describe("the naming screen", () => {
  test("the prompt tells what the screen names and the maximum length, and gives name <text> and name, with no press", () => {
    const observation = {
      mode: "naming",
      waitingFor: { kind: "naming", subject: "a nickname for BULBASAUR", maxLength: 10, keys: [..."AB .ab,01!?♂♀/-…“”‘'"] },
      party: [],
      money: 0,
      bag: [],
      milestones: [],
      atlas: { maps: [], lastTalk: null },
    } as unknown as Observation;
    const prompt = userPrompt(observation, askedOf(observation, false)!, [], NO_TURN);
    expect(prompt).toContain("The game waits for a name on the naming screen.");
    expect(prompt).toContain("The naming screen asks for a nickname for BULBASAUR, 10 characters at most.");
    expect(prompt).toContain(
      [
        "Actions:",
        "- name <text>: type the text and press OK, for example name Sparky. The keys of the keyboard: AB.ab,01!?♂♀/-…“”‘' and the space. A \" in the text types “ or ”.",
        "- name: keep the name that the game gives.",
      ].join("\n"),
    );
    expect(prompt).not.toContain("- press");
  });
});

describe("the stuck counter and the reflection turn", () => {
  test("the first walk at 20 Decision points with no progress, and at each 20 more, is a reflection turn: the prompt adds the full Atlas and asks for a lesson and a new objective", () => {
    const observation = route1(22, [POTION]);
    const at = (stuck: number, events: RunEvent[] = []) => turnKind("walk", events, { stuck, since: 0 });
    const reflected = { ...call("go A"), stuck: 21, reflection: true };
    expect([at(19), at(20), at(21), at(39, [reflected]), at(40, [reflected])]).toEqual(["normal", "reflection", "reflection", "normal", "reflection"]);
    expect(turnKind("battleAction", [], { stuck: 20, since: 0 })).toBe("normal");
    expect(systemPrompt(SYSTEM)).toContain("After 20 Decision points with no progress, and after each 20 more, you get a reflection turn");

    const noted = [call("go A", "", "fact 1")];
    const prompt = userPrompt(observation, askedOf(observation, true)!, noted, { ...NO_TURN, noProgress: { stuck: 20, since: 0 }, turn: "reflection" });
    expect(prompt).toContain("Decision points since your last progress (a new map, a new Milestone, a new exit seen, a level up or a new text of a person): 20.");
    expect(prompt).toContain(
      [
        "Reflection turn: stop and think before you act.",
        "- Read your Memory tree above and the full Atlas below. Use zoom freely to see the details of a node: zoom does not end this turn.",
        '- Write in "note" a lesson: what you tried, why it failed, and what you will do now.',
        '- Set a new "objective" that follows this lesson.',
      ].join("\n"),
    );
    expect(prompt).toContain("Memory tree, the top nodes (zoom <a-b> opens a node):\n#1: fact 1");
    expect(prompt).toContain("Full Atlas, the other maps that you know, nearest first:");
    expect(prompt).not.toContain("- viewAtlas");
    const normal = userPrompt(observation, askedOf(observation, false)!, noted, NO_TURN);
    expect(normal).not.toContain("Reflection turn");
    expect(normal).not.toContain("Full Atlas");
  });
});

describe("the review turn", () => {
  test("the first walk after 20 decisions since the last Review or Reflection turn is a review turn: the prompt adds the full Atlas and the check of the Mission", () => {
    const observation = route1(22, [POTION]);
    const decided = (n: number) => Array.from({ length: n }, () => [call("go A"), played({ name: "goTo", x: 1, y: 1 }, { status: "done", frames: 10 })]).flat();
    const reviewed = [{ ...call("go A"), review: true }, played({ name: "goTo", x: 1, y: 1 }, { status: "done", frames: 10 })];
    const at = (events: RunEvent[], kind: "walk" | "battleAction" = "walk") => turnKind(kind, events, { stuck: 0, since: 0 });
    expect([at(decided(19)), at([...decided(19), call("zoom 1-2")]), at(decided(20))]).toEqual(["normal", "normal", "review"]);
    expect([at(decided(20), "battleAction"), at([...decided(5), ...reviewed, ...decided(19)])]).toEqual(["normal", "normal"]);
    expect(systemPrompt(SYSTEM)).toContain("Every 20 decisions, you get a review turn");

    const prompt = userPrompt(observation, askedOf(observation, true)!, [], { ...NO_TURN, turn: "review" });
    expect(prompt).toContain(
      [
        "Review turn: check your plan against the facts before you act.",
        "- Where are you on the way to the next Milestone?",
        "- Do the facts of your Memory tree and of the full Atlas below still agree with your Mission?",
        "- What do the signs and the people tell you? Which of your guesses do they confirm?",
        "- Which exits, edges and unseen cells are left to explore?",
        '- Write the result in "mission" (change it only when the facts disagree with it), in "objective", and in a short "note".',
      ].join("\n"),
    );
    expect(prompt).toContain("Full Atlas, the other maps that you know, nearest first:");
  });
});

describe("the events that ask for a note", () => {
  test("a new map, a heal with the person who healed, a new item, a lost battle and impossible actions in a row each give a line, then the prompt asks for a note", () => {
    const before = route1(10, [POTION]);
    const now = route1(22, [POTION, { ...POTION, name: "ANTIDOTE" }], [{ localId: 1, graphics: "MOM", x: 1, y: 0, texts: ["MOM: You should rest."] }]);
    const events: RunEvent[] = [
      { type: "map", frame: 0, map: "PalletTown" },
      call("go A"),
      { type: "map", frame: 0, map: "Route1" },
      played({ name: "interact", x: 1, y: 0 }, { status: "done", frames: 10 }),
      played({ name: "readText" }, { status: "done", frames: 50, text: ["MOM: You should rest."] }),
    ];
    const happened = importantEvents(before, now, events);
    expect(happened).toEqual(["you entered the map Route1 for the first time", "your party was healed on Route1, after you talked to MOM", "you got ANTIDOTE"]);
    expect(userPrompt(now, askedOf(now, false)!, events, { ...NO_TURN, happened })).toContain(
      [
        "Something important happened: you entered the map Route1 for the first time.",
        "Something important happened: your party was healed on Route1, after you talked to MOM.",
        "Something important happened: you got ANTIDOTE.",
        "Write a note if it can help you later.",
      ].join("\n"),
    );

    const battle: RunEvent = { type: "battle", frame: 0, state: "start" };
    const lost = played({ name: "readText" }, { status: "done", frames: 50, text: ["BOB whited out!"] });
    expect(importantEvents(before, now, [call("go A"), battle, lost])).toEqual(["you lost a battle", "you got ANTIDOTE"]);
    const outside = played({ name: "goTo", x: 9, y: 9 }, { status: "impossible", reason: "outside", frames: 0 });
    expect(importantEvents(now, now, [call("goTo 9 9"), outside, call("zoom 1-2"), call("goTo 9 9"), outside])).toEqual(["your last 2 actions were impossible: they changed nothing in the game"]);
    expect(importantEvents(now, now, [call("goTo 9 9"), outside])).toEqual([]);
    expect(importantEvents({ ...now, party: [] }, now, [call("choose NO")])).toEqual([]);
  });
});
