import { describe, expect, test } from "bun:test";
import type { ActionEntry } from "../harness/harness";
import type { RunEvent } from "../harness/record";
import { MAX_TRIES, missionLine, nextMilestone, tries } from "./prompt";

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
