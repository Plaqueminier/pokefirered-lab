import { describe, expect, test } from "bun:test";
import type { ActionEntry, Observation } from "../harness/harness";
import type { RunEvent } from "../harness/record";
import { askedOf, readAction } from "./decision";
import { MAX_TRIES, missionLine, nextMilestone, tries, userPrompt } from "./prompt";

const BALLS = "Those are POKé BALLS. They contain POKéMON!";

function call(action: string, mission = ""): RunEvent {
  return {
    type: "model",
    frame: 0,
    latencyMs: 1,
    model: "a/b",
    situation: "a walk on PalletTown_ProfessorOaksLab (8, 5)",
    prompt: { system: "", user: "" },
    answer: "",
    usage: { promptTokens: 0, completionTokens: 0, reasoningTokens: 0, cost: 0 },
    decision: { reason: "", action, mission, objective: "", note: "" },
    error: null,
  };
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
    expect(nextMilestone(["has-pokemon", "first-rival-battle"])).toBe("Get the Pokédex from Professor Oak in Pallet Town.");
    expect(nextMilestone(["has-pokemon", "has-pokedex"])).toBe("Battle your rival for the first time, in Professor Oak's lab in Pallet Town.");
    expect(nextMilestone(["has-pokemon", "first-rival-battle", "has-pokedex"])).toBe("Earn the Boulder Badge from Brock, the Gym Leader of Pewter City.");
    expect(nextMilestone(["has-pokemon", "first-rival-battle", "has-pokedex", "badge-1", "badge-2", "badge-3", "badge-4", "badge-5", "badge-6", "badge-7"])).toBe(
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
        { pocket: "ITEMS", items: [{ name: "POTION", quantity: 5, description: "It restores the HP of one POKéMON by 20 points.", battle: "pokemon", walk: "pokemon" }] },
        { pocket: "KEY ITEMS", items: [{ name: "TOWN MAP", quantity: 1, description: "A very convenient map.", battle: null, walk: null }] },
        { pocket: "POKé BALLS", items: [{ name: "POKé BALL", quantity: 20, description: "A BALL thrown to catch a wild POKéMON.", battle: "alone", walk: null }] },
      ],
      milestones: [],
      atlas: { maps: [] },
      battle: {
        kind: "wild",
        player: { species: "SQUIRTLE", nickname: "SQUIRTLE", types: ["WATER"], level: 6, hp: 20, maxHp: 22, status: "none", stats, moves: [], statStages: stages, partyIndex: 0 },
        enemy: { species: "PIDGEY", types: ["NORMAL", "FLYING"], level: 3, hpPercent: 100, status: "none", statStages: stages, movesSeen: [] },
      },
    } as Observation;
    const prompt = userPrompt(observation, askedOf(observation, false)!, [], { decisions: 0, since: 0 });
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

  test("on a walk, the use line lists only the items that work outside a battle, and the model uses them on a Pokémon of the party", () => {
    const stats = { attack: 10, defense: 10, speed: 10, spAttack: 10, spDefense: 10 };
    const map = { name: "Route1", width: 3, height: 3, cells: "...".repeat(3), warps: [], edges: [], signs: [], people: [], entry: null };
    const observation = {
      mode: "overworld",
      waitingFor: { kind: "walk" },
      party: [{ nickname: "SQUIRTLE", species: "SQUIRTLE", types: ["WATER"], level: 6, hp: 10, maxHp: 22, status: "none", moves: [], ability: { name: "TORRENT", description: "" }, nature: "BOLD", stats, exp: 0, expToNextLevel: 1 }],
      money: 3080,
      bag: [
        { pocket: "ITEMS", items: [{ name: "POTION", quantity: 5, description: "It restores the HP of one POKéMON by 20 points.", battle: "pokemon", walk: "pokemon" }] },
        { pocket: "POKé BALLS", items: [{ name: "POKé BALL", quantity: 20, description: "A BALL thrown to catch a wild POKéMON.", battle: "alone", walk: null }] },
      ],
      milestones: [],
      map: { group: 0, num: 0, name: "Route1" },
      player: { x: 1, y: 1, facing: "north" },
      grid: { name: "Route1", x0: 0, y0: 0, width: 3, height: 3, mapWidth: 3, mapHeight: 3, kinds: map.cells, signs: [] },
      people: [],
      atlas: { maps: [map] },
    } as unknown as Observation;
    const asked = askedOf(observation, false)!;
    expect(userPrompt(observation, asked, [], { decisions: 0, since: 0 })).toContain("- use <item> [on <Pokémon>]: use an item of your Bag. The items that work now: POTION (on a Pokémon).");
    expect(readAction("use potion on squirtle", asked)).toEqual({ name: "use", item: "POTION", on: 0 });
    expect(() => readAction("use POKé BALL", asked)).toThrow('"POKé BALL" is not an item that works now: POTION');
  });
});

describe("the Poké Mart", () => {
  test("at the buy list, the prompt shows the items with their prices and the money, and the action lines buy and sell", () => {
    const observation = {
      mode: "overworld",
      waitingFor: { kind: "buyList", items: [{ name: "POKé BALL", price: 200 }, { name: "POTION", price: 300 }] },
      party: [],
      money: 3080,
      bag: [{ pocket: "ITEMS", items: [{ name: "POTION", quantity: 5, description: "It restores the HP of one POKéMON by 20 points.", battle: "pokemon", walk: "pokemon" }] }],
      milestones: [],
      atlas: { maps: [] },
    } as unknown as Observation;
    const prompt = userPrompt(observation, askedOf(observation, false)!, [], { decisions: 0, since: 0 });
    expect(prompt).toContain("The game waits for the buy list of a Poké Mart.");
    expect(prompt).toContain("Money: 3080");
    expect(prompt).toContain(["The Poké Mart sells (the price of one item):", "- POKé BALL: 200", "- POTION: 300"].join("\n"));
    expect(prompt).toContain(
      [
        "- buy <item> <quantity>: buy items of the list, for example buy POTION 2. Your money must pay the price of all the items.",
        "- sell <item> <quantity>: sell items of your Bag. The shop pays half of the price of each item. It does not buy the KEY ITEMS.",
      ].join("\n"),
    );
  });
});
