import { describe, expect, test } from "bun:test";
import { type Battle, enemyView } from "../battle";
import { battleTurn, fightFacts } from "../battle-facts";
import type { AtlasPerson } from "../harness/atlas";
import type { ActionEntry, Observation } from "../harness/harness";
import type { BoxMon } from "../party";
import type { ModelEvent, RunEvent } from "../harness/record";
import { CHARACTER_SCHEMA, characterTurn, forcedAnswer, readCharacterDecision, shownCharacter } from "./character";
import { type Asked, askedOf, readAction } from "./decision";
import { importantEvents } from "./important-events";
import { adviceLine, coachRole, MAX_ADVICE_PART, readAdvice, withAdvice } from "./coach";
import type { CoachAdvice } from "../protocol";
import { MAX_TRIES, missionLine, nextMilestone, systemPrompt, tries, turnKind, turnRequest, userPrompt } from "./prompt";

const BALLS = "Those are POKé BALLS. They contain POKéMON!";

function move(name: string, type: string, power: number | null, pp: number, maxPp: number, description: string) {
  return { name, type, effect: 0, power, accuracy: 100, pp, maxPp, description };
}

function learnMovePrompt(known: ReturnType<typeof move>[], newMove: ReturnType<typeof move>): string {
  const observation = route1(22, []);
  const [mon] = observation.party;
  const party = [{ ...mon, nickname: "Sage", species: "METAPOD", types: ["BUG"] }, { ...mon, nickname: "Sage", species: "IVYSAUR", types: ["GRASS", "POISON"], moves: known }];
  const learning: Observation = { ...observation, party, waitingFor: { kind: "learnMove", slot: 1, move: newMove } };
  return userPrompt(learning, askedOf(learning, false)!, [], NO_TURN);
}

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

const NO_TURN = { noProgress: { stuck: 0, since: 0 }, turn: "normal" as const, happened: [], request: [], memory: [], advice: [] };
const SYSTEM = { starter: "free", stopAtWhiteout: false } as const;
const POTION = { name: "POTION", quantity: 5, description: "It restores the HP of one POKéMON by 20 points.", price: 300, battle: "pokemon", walk: "pokemon" };

function route1(hp: number, items: object[], people: AtlasPerson[] = []): Observation {
  const stats = { attack: 10, defense: 10, speed: 10, spAttack: 10, spDefense: 10 };
  const map = { name: "Route1", width: 3, height: 3, cells: "...".repeat(3), warps: [], edges: [], hasEdges: false, signs: [], people, obstacles: [], entry: null, stepExits: [], slides: [], parts: [] };
  return {
    mode: "overworld",
    waitingFor: { kind: "walk" },
    party: [{ nickname: "SQUIRTLE", species: "SQUIRTLE", types: ["WATER"], level: 6, hp, maxHp: 22, status: "none", moves: [], ability: { name: "TORRENT", description: "" }, nature: "BOLD", stats, exp: 0, levelExp: 0, expToNextLevel: 1 }],
    boxes: [],
    pcItems: [],
    repelActive: false,
    money: 3080,
    bag: [{ pocket: "ITEMS", items }],
    teachables: [],
    milestones: [],
    map: { group: 0, num: 0, name: "Route1" },
    mapKind: "outdoor",
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

  test("a goTo to a spin tile tells where the player stopped", () => {
    const events = [call("goTo 3 1"), played({ name: "goTo", x: 3, y: 1 }, { status: "done", slidTo: { x: 6, y: 1 }, frames: 40 })];
    expect(tries(events, 0)).toEqual(["- goTo(3, 1) ×1: done, you stepped on the spin tile and slid to (6, 1)"]);
  });

  test(`past ${MAX_TRIES} different tries, it keeps the last ones`, () => {
    const events = Array.from({ length: MAX_TRIES + 5 }, (_, i) => [call(`goTo ${i} 0`), played({ name: "goTo", x: i, y: 0 }, { status: "blocked", reason: "a person", frames: 60 })]).flat();
    const lines = tries(events, 0);
    expect(lines).toHaveLength(MAX_TRIES + 1);
    expect(lines[0]).toBe("- … and 5 other tries before");
    expect(lines.at(-1)).toBe(`- goTo(${MAX_TRIES + 4}, 0) ×1: blocked (a person)`);
  });
});

describe("goTo on a map with spin tiles", () => {
  const SLIDE_LINE = "  On this map, goTo never steps on a spin tile on the way. A goTo to a spin tile next to your part walks next to it, then steps on it, and you slide.";

  test("the action tells how goTo and the spin tiles work, only on a map with spin tiles", () => {
    const plain = route1(22, []);
    const cells = "→..".repeat(3);
    const spin = route1(22, []) as Observation & { mode: "overworld" };
    const withSpin = { ...spin, grid: { ...spin.grid, kinds: cells }, atlas: { ...spin.atlas, maps: [{ ...spin.atlas.maps[0], cells, parts: [0, 1, 1, 0, 1, 1, 0, 1, 1] }] } } as Observation;
    expect(userPrompt(withSpin, askedOf(withSpin, false)!, [], NO_TURN)).toContain(SLIDE_LINE);
    expect(userPrompt(plain, askedOf(plain, false)!, [], NO_TURN)).not.toContain(SLIDE_LINE);
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

describe("the word screen", () => {
  test("after the program left the word screen of a profile, the past decisions say that a profile gives nothing", () => {
    const observation = route1(22, []);
    const asked = askedOf(observation, false)!;
    const events = [call("choose YES"), played({ name: "readText" }, { status: "done", frames: 400, text: ["What's your profile?"], leftWordScreen: true })];
    expect(userPrompt(observation, asked, events, NO_TURN)).toContain(
      "The game opened a screen to write the words of a profile, and you cannot write words: the program left it. A profile gives nothing in the game: choose NO when a person asks for your profile.",
    );
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
  test("it is the first Milestone, in the order of the story, that the Run did not reach, with a short text", () => {
    expect(nextMilestone([])).toBe("Get your first Pokémon from Professor Oak in Pallet Town.");
    expect(nextMilestone(["has-pokemon", "first-rival-battle"])).toBe("Get the Pokédex.");
    expect(nextMilestone(["first-rival-battle"])).toBe("Get your first Pokémon from Professor Oak in Pallet Town.");
    expect(nextMilestone(["has-pokemon", "first-rival-battle", "pokedex", "badge-1", "badge-2", "badge-3", "badge-4", "badge-5", "badge-6", "badge-7"])).toBe(
      "Earn the Earth Badge from Giovanni, the Gym Leader of Viridian City.",
    );
  });
});

function wildPidgey({ party = 0, pc = 0 } = {}): Observation {
  const stages = { attack: 0, defense: 0, speed: 0, spAttack: 0, spDefense: 0, accuracy: 0, evasion: 0 };
  const stats = { attack: 10, defense: 10, speed: 10, spAttack: 10, spDefense: 10 };
  const pidgey = { nickname: "PIDGEY", isEgg: false, species: "PIDGEY", types: ["NORMAL", "FLYING"], level: 3, hp: 10, maxHp: 10, status: "none", moves: [], ability: { name: "KEEN EYE", description: "" }, heldItem: null, nature: "BOLD", stats, exp: 0, levelExp: 0, expToNextLevel: 1 };
  return {
    mode: "battle",
    waitingFor: { kind: "battleAction" },
    party: Array.from({ length: party }, () => pidgey),
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
      player: { species: "SQUIRTLE", nickname: "SQUIRTLE", types: ["WATER"], level: 6, hp: 20, maxHp: 22, status: "none", states: [], encoredSlot: null, stats, moves: [], statStages: stages, partyIndex: 0 },
      enemy: { species: "PIDGEY", types: ["NORMAL", "FLYING"], level: 3, hpPercent: 100, status: "none", states: [], statStages: stages, movesSeen: [] },
      inPc: pc,
      fights: [],
      lastTurn: null,
      foeTurns: [],
    },
  } as Observation;
}

describe("the Bag", () => {
  test("each prompt shows the money and the Bag once, with the effect of each item; a battle has one use line for the items that work now", () => {
    const observation = wildPidgey();
    const prompt = userPrompt(observation, askedOf(observation, false)!, [], NO_TURN);
    expect(prompt).toContain(
      [
        "Bag:",
        "- ITEMS: POTION ×5 (It restores the HP of one POKéMON by 20 points.)",
        "- KEY ITEMS: TOWN MAP ×1 (A very convenient map.)",
        "- POKé BALLS: POKé BALL ×20 (A BALL thrown to catch a wild POKéMON.)",
        "Money: 3080",
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
  test("each fight shows its effect on the foe, STAB and a damage estimate from the formula of the game, and a move with no PP shows no PP and no estimate; the prompt shows the last turn and the moves used on this foe", () => {
    const stages = { attack: 0, defense: 0, speed: 0, spAttack: 0, spDefense: 0, accuracy: 0, evasion: 0 };
    const moves = [
      { name: "BUBBLE", type: "WATER", effect: 70, power: 20, accuracy: 100, pp: 29, maxPp: 30, description: "" },
      { name: "TAIL WHIP", type: "NORMAL", effect: 19, power: null, accuracy: 100, pp: 30, maxPp: 30, description: "" },
      { name: "SEISMIC TOSS", type: "FIGHTING", effect: 87, power: null, fixedDamage: true as const, accuracy: 100, pp: 20, maxPp: 20, description: "" },
      { name: "WATER GUN", type: "WATER", effect: 0, power: 40, accuracy: 100, pp: 0, maxPp: 25, description: "" },
    ];
    const squirtle: Battle["player"] = { species: "SQUIRTLE", nickname: "SQUIRTLE", types: ["WATER"], level: 6, hp: 15, maxHp: 22, status: "none", states: [], encoredSlot: null, stats: { attack: 11, defense: 13, speed: 10, spAttack: 11, spDefense: 12 }, statStages: stages, moves, partyIndex: 0 };
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
        "- fight 3: WATER GUN (WATER, power 40, accuracy 100, PP 0/25). No PP: you cannot use it.",
      ].join("\n"),
    );
    expect(prompt).toContain("Last turn: SQUIRTLE moved first. SQUIRTLE used BUBBLE: not very effective. Foe BULBASAUR used TACKLE: a critical hit. Your SQUIRTLE: HP 22/22 → 15/22. Foe BULBASAUR: HP 100% → 90%.");
    expect(prompt).toContain("Your moves on this foe: BUBBLE (not very effective, its HP 100% → 90%).");
  });
  test("a wild battle shows how many Pokémon of the foe species you own, in the party and in the PC, after the foe line", () => {
    const owned = wildPidgey({ party: 1, pc: 1 });
    expect(userPrompt(owned, askedOf(owned, false)!, [], NO_TURN)).toContain("Moves seen: none.\nYou own 2 PIDGEY: 1 in the party, 1 in the PC.");
    const none = wildPidgey();
    expect(userPrompt(none, askedOf(none, false)!, [], NO_TURN)).toContain("Moves seen: none.\nYou own no PIDGEY.");
  });

  test("each side of a battle shows its states after its status", () => {
    const observation = wildPidgey();
    if (observation.mode !== "battle") throw new Error("not a battle");
    observation.battle.enemy.states = ["seeded", "confused"];
    const prompt = userPrompt(observation, askedOf(observation, false)!, [], NO_TURN);
    expect(prompt).toContain("Your SQUIRTLE: level 6, HP 20/22, status none. States: none. Stats:");
    expect(prompt).toContain("Foe PIDGEY (NORMAL, FLYING): level 3, HP 100%, status none. States: seeded, confused. Stat stages:");
  });

  test("when no move has PP, the fight line tells that the Pokémon uses STRUGGLE", () => {
    const observation = wildPidgey();
    if (observation.mode !== "battle") throw new Error("not a battle");
    observation.battle.player.moves = [{ name: "TACKLE", type: "NORMAL", effect: 0, power: 35, accuracy: 95, pp: 0, maxPp: 35, description: "" }];
    expect(userPrompt(observation, askedOf(observation, false)!, [], NO_TURN)).toContain(
      "Actions:\n- fight 0: no move of SQUIRTLE has PP, so SQUIRTLE uses STRUGGLE (NORMAL, power 50) and loses 1/4 of the damage that it does.\n- run",
    );
  });

  test("a move with no damage tells why it has no effect when the facts make it sure, and few PP in the damage moves add a line", () => {
    const stages = { attack: 0, defense: 0, speed: 0, spAttack: 0, spDefense: 0, accuracy: 0, evasion: 0 };
    const stats = { attack: 10, defense: 10, speed: 10, spAttack: 10, spDefense: 10 };
    const move = (name: string, type: string, effect: number, pp = 10) => ({ name, type, effect, power: null, accuracy: 100, pp, maxPp: 10, description: "" });
    const ivysaur: Battle["player"] = { species: "IVYSAUR", nickname: "IVY", types: ["GRASS", "POISON"], level: 18, hp: 40, maxHp: 53, status: "none", states: [], encoredSlot: null, stats, statStages: { ...stages, defense: 6 }, moves: [], partyIndex: 0 };
    const nidoran = { ...ivysaur, species: "NIDORAN♀", nickname: "NIDORAN♀", types: ["POISON"], status: "sleep" as const, states: ["seeded"], statStages: { ...stages, attack: -6 } };
    const geodude = { ...nidoran, species: "GEODUDE", nickname: "GEODUDE", types: ["ROCK", "GROUND"], status: "none" as const, states: ["behind a SUBSTITUTE"], statStages: stages };
    const chart = { effects: [{ attack: "ELECTRIC", defense: "GROUND", multiplier: 0 }], special: ["ELECTRIC", "GRASS"] };
    const prompt = (player: Battle["player"], enemy: Battle["player"]) => {
      const observation = wildPidgey();
      if (observation.mode !== "battle") throw new Error("not a battle");
      observation.battle = { ...observation.battle, player, enemy: enemyView(enemy, [], false), fights: fightFacts({ kind: "wild", player, enemy }, chart, []) };
      return userPrompt(observation, askedOf(observation, false)!, [], NO_TURN);
    };
    const statusMoves = [move("POISONPOWDER", "POISON", 66), move("SLEEP POWDER", "GRASS", 1), move("LEECH SEED", "GRASS", 84), move("GROWL", "NORMAL", 18)];
    const underEncore = prompt({ ...ivysaur, moves: statusMoves, encoredSlot: 1 }, nidoran);
    expect(underEncore).toMatch(/^- fight 1: SLEEP POWDER .* The ENCORE allows only this move\.$/m);
    expect(underEncore).not.toContain("- fight 0:");
    expect(prompt({ ...ivysaur, moves: statusMoves }, nidoran)).toContain(
      [
        "- fight 0: POISONPOWDER (POISON, power ---, accuracy 100, PP 10/10). No effect: the foe is a POISON type.",
        "- fight 1: SLEEP POWDER (GRASS, power ---, accuracy 100, PP 10/10). No effect: the foe already has a status.",
        "- fight 2: LEECH SEED (GRASS, power ---, accuracy 100, PP 10/10). No effect: the foe is already seeded.",
        "- fight 3: GROWL (NORMAL, power ---, accuracy 100, PP 10/10). No effect: the attack of the foe is already at -6.",
      ].join("\n"),
    );
    const vineWhip = { ...move("VINE WHIP", "GRASS", 0, 2), power: 35 };
    const otherMoves = [move("THUNDER WAVE", "ELECTRIC", 67), move("HARDEN", "NORMAL", 11), move("GROWL", "NORMAL", 18), vineWhip];
    const lowPp = prompt({ ...ivysaur, moves: otherMoves }, geodude);
    expect(lowPp).toContain(
      [
        "- fight 0: THUNDER WAVE (ELECTRIC, power ---, accuracy 100, PP 10/10). No effect: the foe is behind a SUBSTITUTE.",
        "- fight 1: HARDEN (NORMAL, power ---, accuracy 100, PP 10/10). No effect: the defense of IVY is already at +6.",
        "- fight 2: GROWL (NORMAL, power ---, accuracy 100, PP 10/10). No effect: the foe is behind a SUBSTITUTE.",
      ].join("\n"),
    );
    expect(lowPp).toContain("Your damage moves have few PP: use the other moves that have an effect, or switch.");
    const thunderWave = prompt({ ...ivysaur, moves: [move("THUNDER WAVE", "ELECTRIC", 67), move("GROWL", "NORMAL", 18), { ...vineWhip, pp: 3 }] }, { ...geodude, states: [] });
    expect(thunderWave).toContain("- fight 0: THUNDER WAVE (ELECTRIC, power ---, accuracy 100, PP 10/10). No effect: the foe is a GROUND type.\n- fight 1: GROWL (NORMAL, power ---, accuracy 100, PP 10/10)\n");
    expect(thunderWave).not.toContain("few PP");
  });

  test("at a battle action, the actions have no press", () => {
    const observation = wildPidgey();
    const asked = askedOf(observation, false)!;
    expect(userPrompt(observation, asked, [], NO_TURN)).not.toContain("- press");
    expect(() => readAction("press B", asked)).toThrow('"press" is not an action now: use fight, run, use or zoom');
  });
});

describe("a choice", () => {

  test("the choice line shows the question (with the nickname line for a nickname), the last text of the last decision, or the old line with no text; the actions are choose and zoom, with no press", () => {
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

  test("the program answers YES to a nickname, YES at the Poké Ball of the wanted starter and NO at another; the Name Rater, an old question and a Run with no character get a Model call", () => {
    const observation = { ...route1(22, []), waitingFor: { kind: "choice", options: ["YES", "NO"] } } as Observation;
    const asked = askedOf(observation, false)!;
    const after = (text: string) => [call("go A"), played({ name: "readText" }, { status: "done", frames: 50, text: [text] })];
    for (const question of ["Do you want to give a nickname to this BULBASAUR?", "Give a nickname to the captured CATERPIE?"]) expect(forcedAnswer(asked, after(question), "free")).toBe("YES");
    expect(forcedAnswer(asked, after("Shall I rate the nicknames of your POKéMON?"), "free")).toBeNull();
    expect(forcedAnswer(asked, after("Do you want to heal?"), "free")).toBeNull();
    const old = [...after("Give a nickname to the captured CATERPIE?"), played({ name: "goTo", x: 1, y: 1 }, { status: "done", frames: 5 })];
    expect(forcedAnswer(asked, old, "free")).toBeNull();

    const ball = (name: string) => after(`Hm! ${name} is your choice. It's one worth raising.`);
    const invented: ModelEvent = { ...call("go A"), decision: { ...call("go A").decision!, character: "A shy baker who fears CHARMANDER.", starter: "SQUIRTLE" }, error: null };
    expect(forcedAnswer(asked, [invented, ...ball("CHARMANDER")], "free")).toBe("NO");
    expect(forcedAnswer(asked, [invented, ...ball("SQUIRTLE")], "free")).toBe("YES");
    expect(forcedAnswer(asked, ball("SQUIRTLE"), "BULBASAUR")).toBe("NO");
    expect(forcedAnswer(asked, ball("SQUIRTLE"), "free")).toBeNull();
  });
});

describe("a REPEL", () => {
  test("a walk shows one line when a REPEL is active, and no line when none is active", () => {
    const walk = route1(22, []);
    expect(userPrompt(walk, askedOf(walk, false)!, [], NO_TURN)).not.toContain("A REPEL is active.");
    const repelled = { ...walk, repelActive: true } as Observation;
    expect(userPrompt(repelled, askedOf(repelled, false)!, [], NO_TURN)).toContain("A REPEL is active.");
  });
});

describe("the REPEL facts", () => {
  const REPEL = { name: "REPEL", quantity: 2, description: "Prevents weak wild POKéMON from appearing for 100 steps.", price: 350, battle: null, walk: "alone" };
  const FACTS = "A REPEL stops wild battles with Pokémon of a lower level than the first Pokémon of your party that has not fainted, for 100 steps (SUPER REPEL 200, MAX REPEL 250). Use it to explore without fights. Do not use it when your Pokémon need experience.";
  const on = (mapKind: string, items: object[], repelActive = false) => ({ ...route1(22, items), mapKind, repelActive }) as Observation;
  const prompt = (observation: Observation, events: RunEvent[] = []) => userPrompt(observation, askedOf(observation, false)!, events, NO_TURN);

  test("in a cave, with a REPEL in the Bag and none active, the walk tells what a REPEL does", () => {
    expect(prompt(on("underground", [REPEL]))).toContain(`You have REPEL ×2. ${FACTS}`);
    expect(prompt(on("outdoor", [REPEL]))).not.toContain("You have REPEL");
    expect(prompt(on("underground", [POTION]))).not.toContain("You have REPEL");
    const active = prompt(on("underground", [REPEL], true));
    expect(active).toContain("A REPEL is active.");
    expect(active).not.toContain("You have REPEL");
  });

  test("after a REPEL wore off, the next walk tells that another REPEL is in the Bag", () => {
    const woreOff = [call("go A"), played({ name: "readText" }, { status: "done", frames: 10, text: ["REPEL's effect wore off…"] })];
    expect(prompt(on("outdoor", [REPEL]), woreOff)).toContain("You can use another REPEL.");
    expect(prompt(on("outdoor", [REPEL]), [...woreOff, call("go B")])).not.toContain("You can use another REPEL.");
    expect(prompt(on("outdoor", [POTION]), woreOff)).not.toContain("You can use another REPEL.");
    const cave = prompt(on("underground", [REPEL]), woreOff);
    expect(cave).toContain(`You have REPEL ×2. ${FACTS}\nYou can use another REPEL.`);
  });

  test("the Poké Mart and the rules tell the same facts, and the rules do not ask to buy REPELS", () => {
    const shop = { ...route1(22, []), waitingFor: { kind: "shopMenu", items: [{ name: "POKé BALL", price: 200, description: "A BALL." }, { name: "SUPER REPEL", price: 500, description: "Prevents weak wild POKéMON from appearing for 200 steps." }] } } as unknown as Observation;
    const mart = prompt(shop);
    expect(mart).toContain(`- SUPER REPEL: 500. Prevents weak wild POKéMON from appearing for 200 steps. ${FACTS}`);
    expect(mart).toContain("- POKé BALL: 200. A BALL.\n");
    expect(systemPrompt(SYSTEM, true)).toContain(`- ${FACTS}`);
    expect(systemPrompt(SYSTEM, true)).toContain("- Buy Poké Balls and Potions at a Poké Mart.");
  });
});

describe("the Coach advice", () => {
  const advised = (advice: CoachAdvice | string, turn: "character" | "reflection" | "review" = "reflection"): ModelEvent => {
    const event = call("go A");
    return { ...event, [turn]: true, decision: { ...event.decision!, advice } } as ModelEvent;
  };

  const decided = (event: ModelEvent): RunEvent[] => [event, played({ name: "goTo", x: 1, y: 1 }, { status: "done", frames: 10 })];

  test("each prompt shows the last advice of each part, in the order of the parts, and the number of decisions after it; a turn with no text for a part keeps the last one", () => {
    expect(adviceLine(decided(call("go A")))).toEqual([]);
    const first = advised({ team: "Catch a PIDGEY on Route 1.", battles: "Use WATER GUN on Geodude." }, "character");
    const second = advised({ progress: "Go north to Pewter.", team: "Train the PIDGEY to level 10." }, "review");
    expect(adviceLine([...decided(first), ...decided(call("go A")), ...decided(second), ...decided(call("go B"))])).toEqual([
      "Coach advice, the last one of your Coach for each part:",
      "- Team (review turn, 1 decision ago): Train the PIDGEY to level 10.",
      "- Progress (review turn, 1 decision ago): Go north to Pewter.",
      "- Battles (character turn, 3 decisions ago): Use WATER GUN on Geodude.",
    ]);
  });

  test("the one advice of a Run record before bot version 34 shows as one part, until the first advice in parts of an Extended Run", () => {
    const old = decided(advised("Heal first."));
    expect(adviceLine([...old, ...decided(call("go A"))])).toEqual(["Coach advice, the last one of your Coach for each part:", "- Advice (reflection turn, 1 decision ago): Heal first."]);
    expect(adviceLine([...old, ...decided(advised({ team: "Catch a PIDGEY." }, "review"))])).toEqual(["Coach advice, the last one of your Coach for each part:", "- Team (review turn, 0 decisions ago): Catch a PIDGEY."]);
  });

  test("a zoom or a viewAtlas after the advice is no decision", () => {
    expect(adviceLine([...decided(advised({ shopping: "Buy 5 POTIONS." })), call("zoom 1-2"), call("viewAtlas"), ...decided(call("go A"))])).toEqual(["Coach advice, the last one of your Coach for each part:", "- Shopping (reflection turn, 1 decision ago): Buy 5 POTIONS."]);
  });

  test("under the advice, the program tells what happened since the oldest part in force, with the same count of decisions", () => {
    const fact = (event: object) => ({ frame: 1, ...event }) as RunEvent;
    const beforeAdvice = [...decided(call("go A")), fact({ type: "map", map: "Route1" }), fact({ type: "catch", species: "RATTATA" })];
    const healed = [fact({ type: "heal", source: "center", item: null, party: [{ species: "SQUIRTLE", before: 3, after: 22, maxHp: 22 }] }), fact({ type: "map", map: "Route1" }), fact({ type: "map", map: "PewterCity" })];
    const fights = [
      fact({ type: "faint", species: "WEEDLE", side: "enemy" }),
      fact({ type: "faint", species: "PIDGEY", side: "player" }),
      fact({ type: "level", species: "SQUIRTLE", from: 9, level: 10, moves: [], evolution: null }),
      fact({ type: "trainer", trainer: "BUG CATCHER Rick", id: 102 }),
      fact({ type: "money", before: 100, after: 200, cause: "battle" }),
    ];
    const bought = [fact({ type: "purchase", item: "POTION", count: 5, money: 1500 }), fact({ type: "heal", source: "item", item: "POTION", party: [{ species: "SQUIRTLE", before: 25, after: 25, maxHp: 34 }, { species: "PIDGEY", before: 1, after: 21, maxHp: 30 }] }), fact({ type: "heal", source: "item", item: "ANTIDOTE", party: [{ species: "SQUIRTLE", before: 25, after: 25, maxHp: 34 }] }), fact({ type: "heal", source: "other", item: null, party: [{ species: "SQUIRTLE", before: 25, after: 34, maxHp: 34 }, { species: "PIDGEY", before: 21, after: 21, maxHp: 30 }] }), fact({ type: "item", how: "found", item: "ANTIDOTE", count: 1 }), fact({ type: "whiteout" })];
    expect(adviceLine([...beforeAdvice, ...decided(advised({ team: "Heal, then train." })), ...decided(call("go A")), ...healed, ...decided(call("go B")), ...fights, ...decided(call("go C")), ...bought])).toEqual([
      "Coach advice, the last one of your Coach for each part:",
      "- Team (reflection turn, 3 decisions ago): Heal, then train.",
      "What happened since this advice, oldest first:",
      "- 2 decisions ago: you healed at a Pokémon Center; you reached PewterCity for the first time.",
      "- 1 decision ago: your PIDGEY fainted; SQUIRTLE reached level 10; you beat BUG CATCHER Rick.",
      "- 0 decisions ago: you bought 5 POTION; you used POTION on PIDGEY; you used ANTIDOTE; SQUIRTLE healed; you found 1 ANTIDOTE; all your Pokémon fainted.",
    ]);
  });

  test("the list of what happened keeps the last lines, and starts at the oldest part in force", () => {
    const fact = (event: object) => ({ frame: 1, ...event }) as RunEvent;
    const catches = Array.from({ length: 15 }, (_, at) => [...decided(call("go A")), fact({ type: "catch", species: `MON${at}` })]).flat();
    const lines = adviceLine([...decided(advised({ team: "Catch." })), ...catches]);
    expect(lines.slice(2).length).toBe(13);
    expect(lines.at(-1)).toBe("- 0 decisions ago: you caught a MON14.");
    expect(adviceLine([...decided(advised({ team: "Catch." })), ...decided(call("go A")), fact({ type: "catch", species: "PIDGEY" }), ...decided(advised({ shopping: "Buy." }, "review"))])).toContain("- 1 decision ago: you caught a PIDGEY.");
  });

  test("the Coach writes the 4 parts, and the program keeps a part with text, cut at the last full sentence that fits", () => {
    const long = "x".repeat(MAX_ADVICE_PART + 20);
    const sentence = "Train the PIDGEY in the tall grass of Route 1 up to level 10.";
    expect(readAdvice(JSON.stringify({ advice: { team: " Catch a PIDGEY. ", shopping: "", progress: long, battles: "" } }))).toEqual({ team: "Catch a PIDGEY.", progress: "x".repeat(MAX_ADVICE_PART) });
    expect(readAdvice(JSON.stringify({ advice: { team: `${sentence} ${sentence} ${sentence} ${sentence}`, progress: `${"word ".repeat(50)}end` } }))).toEqual({ team: `${sentence} ${sentence} ${sentence}`, progress: "word ".repeat(40).trim() });
    expect(readAdvice(JSON.stringify({ advice: { team: `${"a".repeat(MAX_ADVICE_PART - 1)}. Next` } }))).toEqual({ team: `${"a".repeat(MAX_ADVICE_PART - 1)}.` });
    expect(readAdvice(JSON.stringify({ advice: "one text" }))).toEqual({});
    const schema = withAdvice({ type: "object", properties: {}, required: [] });
    expect(schema.required).toContain("advice");
    expect(schema.properties).toMatchObject({ advice: { type: "object", required: ["team", "shopping", "progress", "battles"], additionalProperties: false } });
  });

  test("the advice shows in every prompt of a Run with a Coach, and in none of a Run with no Coach", () => {
    const walk = route1(22, []);
    const learning = { ...walk, party: [{ ...walk.party[0], moves: [move("TACKLE", "NORMAL", 35, 35, 35, "")] }], waitingFor: { kind: "learnMove", slot: 0, move: move("BITE", "DARK", 60, 25, 25, "") } } as Observation;
    const events = decided(advised({ team: "Catch a PIDGEY." }));
    for (const shown of [walk, learning]) expect(userPrompt(shown, askedOf(shown, false)!, events, { ...NO_TURN, advice: adviceLine(events) })).toContain("- Team (reflection turn, 0 decisions ago): Catch a PIDGEY.\nDecision points since");
    expect(userPrompt(walk, askedOf(walk, false)!, events, NO_TURN)).not.toContain("Coach advice");
  });

  test("in a Run with a Coach, the Coach plays the turns that think and the move to forget, and advises only at the turns that think", () => {
    const walk = { kind: "walk" } as Asked;
    for (const turn of ["character", "reflection", "review"] as const) expect(coachRole(true, turn, walk)).toEqual({ plays: true, advises: true });
    expect(coachRole(true, "normal", { kind: "learnMove" } as Asked)).toEqual({ plays: true, advises: false });
    expect(coachRole(true, "normal", walk)).toEqual({ plays: false, advises: false });
    expect(coachRole(false, "review", walk)).toEqual({ plays: false, advises: false });
  });

  test("the rules name the Coach only in a Run with a Coach, and the Coach gets its own rules", () => {
    const player = systemPrompt({ ...SYSTEM, coach: { id: "big" } }, true);
    expect(player).toStartWith("You play Pokémon FireRed.");
    expect(player).toContain("A Coach, a bigger model, plays the character, reflection and review turns");
    expect(systemPrompt(SYSTEM, true)).not.toContain("A Coach, a bigger model");
    const coach = systemPrompt({ ...SYSTEM, coach: { id: "big" } }, true, "coach");
    expect(coach).toStartWith("You are the Coach of a smaller model that plays Pokémon FireRed.");
    expect(coach).not.toContain("A Coach, a bigger model");
    expect(coach).toContain("it rarely catches a Pokémon");
  });
});

describe("the team at the reflection and review turns", () => {
  const tackle = move("TACKLE", "NORMAL", 35, 35, 35, "A full-body charge.");
  const boxMon = (species: string, level: number, moves = [tackle]): BoxMon => ({ box: 0, boxName: "BOX1", position: level, species, nickname: species, level, types: ["NORMAL"], ability: { name: "RUN AWAY", description: "Makes escape easier." }, moves });
  const strong = Array.from({ length: 12 }, (_, i) => boxMon(`MON${i}`, 20 + i));
  const boxes = [boxMon("RATTATA", 3), ...strong, boxMon("RATTATA", 4, [move("BITE", "DARK", 60, 25, 25, "Bites with sharp fangs.")])];
  const observation = { ...route1(22, []), boxes, pcItems: [{ name: "POTION", quantity: 1 }] } as Observation;
  const partyKnows = { ...observation, party: [{ ...observation.party[0], moves: [tackle] }] } as Observation;
  const prompt = (turn: "normal" | "reflection" | "review", events: RunEvent[] = [], shown = partyKnows) => userPrompt(shown, askedOf(shown, turn !== "normal")!, events, { ...NO_TURN, turn });

  test("the turn shows the items of the PC, and 12 box Pokémon of the highest levels with their moves, then the others by species", () => {
    const review = prompt("review");
    expect(review).toContain("The items in the PC: POTION ×1.");
    expect(review).toContain("The Pokémon in the boxes, the 12 of the highest levels:\n- MON11 level 31, BOX1: type NORMAL, ability RUN AWAY. Moves: TACKLE (NORMAL, power 35, accuracy 100, PP 35/35).");
    expect(review).toContain("- MON0 level 20, BOX1");
    expect(review).toContain("- And 2 more: RATTATA ×2 (levels 3, 4).");
    expect(review.indexOf("The items in the PC")).toBeLessThan(review.indexOf("Objective:"));
    expect(review).not.toContain("In the boxes:");
    expect(prompt("reflection")).toContain("The items in the PC: POTION ×1.");
  });

  test("each description shows one time, and none that the party already shows", () => {
    const review = prompt("review");
    expect(review).toContain("What these moves and abilities do:\n- RUN AWAY: Makes escape easier.");
    expect(review.split("Makes escape easier.").length).toBe(2);
    expect(review).not.toContain("- TACKLE: A full-body charge.");
    expect(review).not.toContain("Bites with sharp fangs.");
  });

  test("the review counts the Pokémon caught, the box Pokémon and the whiteouts, and asks nothing about them", () => {
    const events = [{ type: "catch", frame: 1, species: "PIDGEY" }, { type: "whiteout", frame: 2 }] as RunEvent[];
    expect(prompt("review", events)).toContain("So far in the game: 1 Pokémon caught, 14 Pokémon in the boxes, 1 whiteout.");
    expect(prompt("reflection", events)).not.toContain("So far in the game:");
  });

  test("a usual walk keeps the short line of the boxes, and no PC items", () => {
    const walk = prompt("normal");
    expect(walk).toContain("In the boxes: RATTATA level 3, BOX1;");
    expect(walk).not.toContain("The items in the PC");
  });
});

describe("the Poké Mart", () => {
  test("at the shop menu, the prompt shows the items for sale with their prices, the money, the items of the Bag that the Mart buys, and the actions buy, sell and leave, with no press", () => {
    const observation = {
      mode: "overworld",
      waitingFor: { kind: "shopMenu", items: [{ name: "POKé BALL", price: 200, description: "A BALL thrown to catch a wild POKéMON." }, { name: "REPEL", price: 350, description: "Prevents weak wild POKéMON from appearing for 100 steps." }] },
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
    expect(prompt).toContain(["The Poké Mart sells (the price of one item):", "- POKé BALL: 200. A BALL thrown to catch a wild POKéMON.", "- REPEL: 350. Prevents weak wild POKéMON from appearing for 100 steps."].join("\n"));
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
      ].join("\n"),
    );
    expect(prompt).not.toContain("- name: keep");
    expect(prompt).not.toContain("- press");
    const asked = askedOf(observation, false)!;
    expect(readAction("name Bubbles", asked)).toEqual({ name: "name", text: "Bubbles" });
    expect(() => readAction("name", asked)).toThrow("a nickname must be a new name");
    expect(() => readAction("name Bulbasaur", asked)).toThrow("a nickname must be a new name");
    const player = { ...observation, waitingFor: { kind: "naming", subject: "your name", maxLength: 7, keys: ["A"] } } as unknown as Observation;
    expect(readAction("name", askedOf(player, false)!)).toEqual({ name: "name", text: "" });
    expect(userPrompt(player, askedOf(player, false)!, [], NO_TURN)).toContain("- name: keep the name that the game gives.");
  });
});

describe("the rules and the character turn", () => {
  const settings = { starter: "free", stopAtWhiteout: true } as const;

  test("a Run shows its character, nothing while it has none yet, and Normal trainer when it has no Character turn", () => {
    const played = call("go A");
    const unreadable: ModelEvent = { ...played, character: true, decision: null, error: "no JSON" };
    const turn: ModelEvent = { ...played, character: true, decision: { ...played.decision!, character: "Pastry names. A shy baker." }, error: null };
    expect(shownCharacter([unreadable, turn, played])).toBe("Pastry names. A shy baker.");
    expect(shownCharacter([])).toBeNull();
    expect(shownCharacter([unreadable])).toBeNull();
    expect(shownCharacter([played])).toBe("Normal trainer");
  });

  test("a Run shows the names of its character with the character, in the prompt and in the Viewer", () => {
    const played = call("go A");
    const turn: ModelEvent = { ...played, character: true, decision: { ...played.decision!, character: "Pastry names. A shy baker.", starter: "SQUIRTLE", names: { player: "Mira", rival: "Crumb" } }, error: null };
    expect(shownCharacter([turn])).toBe("Mira, rival Crumb. Pastry names. A shy baker.");
    const prompt = userPrompt(route1(22, [POTION]), askedOf(route1(22, [POTION]), false)!, [turn], NO_TURN);
    expect(prompt).toContain("Your character: Pastry names. A shy baker. Your first Pokémon: SQUIRTLE. Your name: Mira. Your rival: Crumb.");
  });

  test("a free starter is the choice of the character; a given starter stays; a stop at a whiteout warns with no fear; with no stop, the rules tell what a whiteout costs", () => {
    expect(systemPrompt(settings, false)).toContain("Take the first Pokémon that your character chose.");
    expect(systemPrompt({ ...settings, starter: "SQUIRTLE" }, false)).toContain("Choose SQUIRTLE as your first Pokémon.");
    expect(systemPrompt(settings, false)).toContain("If all your Pokémon faint, the Run ends.");
    expect(systemPrompt({ ...settings, stopAtWhiteout: false }, false)).toContain("If all your Pokémon faint, the Run continues: you lose some money");
    expect(systemPrompt(settings, false)).toContain("Give a nickname to each Pokémon that you get");
  });

  test("the first Decision point of a Run with no Pokémon is a character turn; then each prompt has the character; a Run that already has a Pokémon and no character has no character turn", () => {
    const noProgress = { stuck: 0, since: 0 };
    expect(turnKind("walk", [], noProgress, 0)).toBe("character");
    expect(turnKind("walk", [], noProgress, 1)).toBe("normal");
    const invented: ModelEvent = { ...call("go A"), decision: { ...call("go A").decision!, character: "A loud fan of fire.", starter: "CHARMANDER" }, error: null };
    expect(turnKind("walk", [invented], noProgress, 0)).toBe("normal");

    const observation = route1(22, []);
    const asked = askedOf(observation, false)!;
    const turn = userPrompt(observation, asked, [], { ...NO_TURN, turn: "character", request: turnRequest("character", "free", null) });
    expect(turn).toContain("Character turn:");
    expect(turn).toContain('Write in "character"');
    expect(userPrompt(observation, asked, [invented], NO_TURN)).toContain("Your character: A loud fan of fire. Your first Pokémon: CHARMANDER.");
    expect(userPrompt(observation, asked, [], NO_TURN)).not.toContain("Your character:");
  });

  const characterAnswer = (fields: { character?: string; starter?: string; name?: string; rival?: string }) => JSON.stringify({ reason: "", action: "go A", mission: "", objective: "", note: "", character: "A shy baker.", starter: "SQUIRTLE", name: "Mira", rival: "Crumb", ...fields });

  test("a character turn with a free starter asks the character for the starter; with a given starter it tells the starter", () => {
    const free = characterTurn("free", null, () => 0.5).join("\n");
    expect(free).toContain("CHARMANDER, BULBASAUR or SQUIRTLE");
    expect(free).toContain("Start from this idea");
    const given = characterTurn("SQUIRTLE", null).join("\n");
    expect(given).toContain("The first Pokémon of this trainer is SQUIRTLE.");
    expect(given).not.toContain("BULBASAUR");
    const answer = (character?: string, starter?: string) => characterAnswer({ character, starter });
    expect(readCharacterDecision(answer(" A shy baker. ", "SQUIRTLE"), "free", null)).toMatchObject({ character: "A shy baker.", starter: "SQUIRTLE" });
    expect(() => readCharacterDecision(answer("A shy baker.", "PIKACHU"), "free", null)).toThrow('"starter" must be BULBASAUR, CHARMANDER or SQUIRTLE');
    expect(readCharacterDecision(answer("A shy baker.", "PIKACHU"), "SQUIRTLE", null).starter).toBe("SQUIRTLE");
    expect(() => readCharacterDecision(answer(), "SQUIRTLE", null)).toThrow('the answer has no string "character"');
  });

  describe("the idea of a character turn", () => {
    const turn = (trait: number, job: number, hobby: number, origin = 0) => {
      const draws = [0, origin, trait, job, hobby];
      return characterTurn("free", null, () => draws.shift() ?? 0);
    };
    const idea = (trait: number, job: number, hobby: number, origin = 0) => turn(trait, job, hobby, origin).find((line) => line.includes("Start from this idea"));

    test("the idea has a trait, a job and a hobby", () => {
      expect(idea(0, 0, 0)).toBe("- Start from this idea, and make it your own: a shy baker who collects old maps.");
      expect(idea(0.999, 0.999, 0.999)).toBe("- Start from this idea, and make it your own: a generous gym teacher who collects rocks.");
    });

    test("the names and the nicknames sound in the language of the country, with no accents, and the other answers stay in English", () => {
      const lines = turn(0, 0, 0, 0.7);
      expect(lines).toContain("- This trainer comes from Russia. The names of this trainer and of the rival, and the nicknames, sound Russian. Write them only with the letters that the game allows: no accents. All your other answers stay in English.");
      expect(lines).toContain("- Choose a style for the nicknames of this trainer, that mixes the job, the hobby and the Russian language.");
      expect(characterTurn("free", { player: "RED", rival: "BLUE" }, () => 0).join("\n")).toContain("- This trainer comes from Japan. The nicknames sound Japanese.");
    });

    test("the program selects from 31 countries, each with its language", () => {
      const countries = new Set(Array.from({ length: 1000 }, (_, i) => turn(0, 0, 0, (i + 0.5) / 1000).find((line) => line.startsWith("- This trainer comes from"))));
      expect(countries.size).toBe(31);
    });

    test("the program selects from 100 jobs, 12 traits and 33 hobbies, with no word two times", () => {
      const distinctIdeas = (draw: (part: number) => string | undefined) => new Set(Array.from({ length: 1000 }, (_, i) => draw((i + 0.5) / 1000))).size;
      expect(distinctIdeas((part) => idea(0, part, 0))).toBe(100);
      expect(distinctIdeas((part) => idea(part, 0, 0))).toBe(12);
      expect(distinctIdeas((part) => idea(0, 0, part))).toBe(33);
    });
  });

  test("the character keeps the country of the trainer", () => {
    expect(characterTurn("free", null, () => 0.5).join("\n")).toContain("the trainer and its country");
    expect(CHARACTER_SCHEMA.properties.character.description).toContain("the country of the trainer");
  });

  test("the character has 400 characters at most", () => {
    expect(characterTurn("free", null, () => 0.5).join("\n")).toContain('Write in "character", in at most 400 characters');
    expect(CHARACTER_SCHEMA.properties.character.description).toContain("400 characters at most");
    expect(readCharacterDecision(characterAnswer({ character: "x".repeat(500) }), "free", null).character).toHaveLength(400);
  });

  describe("the names of a character turn", () => {
    const answer = (name?: string, rival?: string) => characterAnswer({ name, rival });

    test("the turn asks for the two names and tells their rules, and the schema requires them", () => {
      const turn = characterTurn("free", null, () => 0.5).join("\n");
      expect(turn).toContain('"name"');
      expect(turn).toContain('"rival"');
      expect(turn).toContain("7 characters at most");
      expect(turn).toContain("♂♀/-…“”‘'");
      expect(CHARACTER_SCHEMA.required).toEqual(expect.arrayContaining(["name", "rival"]));
    });

    test.each(["I", "Al Bo", "A.B-C", "WWWWWWW", "♂…“”‘'!"])("%s is a name", (name) => {
      expect(readCharacterDecision(answer(name, "O"), "free", null).names).toEqual({ player: name, rival: "O" });
      expect(readCharacterDecision(answer("O", name), "free", null).names).toEqual({ player: "O", rival: name });
    });

    test.each([
      ["", "1 to 7 characters"],
      ["ABCDEFGH", "1 to 7 characters"],
      [" Al", "no space at the start or the end"],
      ["Al ", "no space at the start or the end"],
      ["   ", "no space at the start or the end"],
      ["é", 'the character "é" is not on the keyboard'],
      ["Al:", 'the character ":" is not on the keyboard'],
      ['A"B', 'the character """ is not on the keyboard'],
    ])("%p is not a name: %s", (name, problem) => {
      expect(() => readCharacterDecision(answer(name, "O"), "free", null)).toThrow(`"name": ${problem}`);
      expect(() => readCharacterDecision(answer("O", name), "free", null)).toThrow(`"rival": ${problem}`);
    });

    test("an answer with no name is an error", () => {
      expect(() => readCharacterDecision(answer(undefined, "O"), "free", null)).toThrow('the answer has no string "name"');
      expect(() => readCharacterDecision(answer("O"), "free", null)).toThrow('the answer has no string "rival"');
    });

    test("when the game already plays, the turn tells the names of the game, and an answer cannot change them", () => {
      const names = { player: "PLOK", rival: "BOB" };
      const turn = characterTurn("free", names, () => 0.5).join("\n");
      expect(turn).toContain('The game already has your names: write PLOK in "name" and BOB in "rival".');
      expect(turn).not.toContain("7 characters at most");
      expect(readCharacterDecision(answer("Mira", "?bad?name"), "free", names).names).toEqual(names);
    });
  });
});

describe("the Pokémon in the boxes of the PC", () => {
  const boxes = [
    { box: 0, boxName: "BOX1", position: 0, species: "PIDGEY", nickname: "Sky", level: 5 },
    { box: 1, boxName: "BOX2", position: 3, species: "GEODUDE", nickname: "GEODUDE", level: 7 },
  ];

  test("the rules tell to use the PC: put a weak Pokémon in a box, and take a Pokémon from a box", () => {
    const rules = systemPrompt(SYSTEM, true);
    expect(rules).toContain("Each Pokémon Center has a PC. It keeps your items and your Pokémon. A Pokémon that you catch with 6 Pokémon in your party goes to a box. At the PC, put a weak Pokémon in a box to make a place before you catch a new one, and take a Pokémon from a box when it suits the next battle.");
    expect(rules).not.toContain("lost for your team");
  });

  test("a walk shows one line of the boxes under the party, and no line when the boxes are empty", () => {
    const walk = { ...route1(22, []), boxes } as Observation;
    expect(userPrompt(walk, askedOf(walk, false)!, [], NO_TURN)).toContain("In the boxes: Sky (PIDGEY) level 5, BOX1; GEODUDE level 7, BOX2.");
    const empty = route1(22, []);
    expect(userPrompt(empty, askedOf(empty, false)!, [], NO_TURN)).not.toContain("In the boxes");
  });

  test("the menu of a PC tells which option keeps the items and which option keeps the Pokémon", () => {
    const menu = { ...route1(22, []), waitingFor: { kind: "choice", options: ["BILL'S PC", "RED'S PC", "LOG OFF"], cursor: 0, columns: 1, storage: 0 } } as Observation;
    const prompt = userPrompt(menu, askedOf(menu, false)!, [], NO_TURN);
    expect(prompt).toContain("This is a PC: the PC with your name has ITEM STORAGE, which keeps your items. BILL'S PC opens the boxes, which keep your Pokémon.");
    expect(prompt).not.toContain("not possible");
  });

  test("the Pokémon PC lists the boxes with a number, and gives deposit, withdraw and leave", () => {
    const pc = { ...route1(22, []), waitingFor: { kind: "pokemonPc" }, boxes } as Observation;
    const prompt = userPrompt(pc, askedOf(pc, false)!, [], NO_TURN);
    expect(prompt).toContain("The game waits for the boxes of a PC.");
    expect(prompt).toContain(["The Pokémon in the boxes:", "1. Sky (PIDGEY) level 5, BOX1", "2. GEODUDE level 7, BOX2"].join("\n"));
    expect(prompt).toContain(
      [
        "Actions:",
        "- deposit <Pokémon>: put a Pokémon of your party in a box. <Pokémon> can be 1 SQUIRTLE. Write its place in the party, its name, or both, for example 1 SQUIRTLE.",
        "- withdraw <Pokémon>: take a Pokémon from a box and put it in your party. Write its number in the list of the boxes, its name, or both, for example 1 Sky.",
        "- leave: go back to the menu of the PC, where you can turn the PC off.",
      ].join("\n"),
    );
  });

  test("the Pokémon PC with empty boxes tells it, and gives no withdraw", () => {
    const pc = { ...route1(22, []), waitingFor: { kind: "pokemonPc" } } as Observation;
    const prompt = userPrompt(pc, askedOf(pc, false)!, [], NO_TURN);
    expect(prompt).toContain("The boxes are empty.");
    expect(prompt).not.toContain("- withdraw");
  });
});

describe("the stuck counter and the reflection turn", () => {
  test("the first walk at 20 Decision points with no progress, and at each 20 more, is a reflection turn: the prompt asks for a lesson and a new objective, and adds the full Atlas", () => {
    const observation = route1(22, [POTION]);
    const at = (stuck: number, events: RunEvent[] = []) => turnKind("walk", events, { stuck, since: 0 }, 1);
    const reflected = { ...call("go A"), stuck: 21, reflection: true };
    expect([at(19), at(20), at(21), at(39, [reflected]), at(40, [reflected])]).toEqual(["normal", "reflection", "reflection", "normal", "reflection"]);
    expect([turnKind("battleAction", [], { stuck: 20, since: 0 }, 1), turnKind("battleMove", [], { stuck: 20, since: 0 }, 1)]).toEqual(["normal", "normal"]);
    expect(systemPrompt(SYSTEM, true)).toContain("After 20 Decision points with no progress, and after each 20 more, you get a reflection turn at the next walk");

    const noted = [call("go A", "", "fact 1")];
    const prompt = userPrompt(observation, askedOf(observation, true)!, noted, { ...NO_TURN, noProgress: { stuck: 20, since: 0 }, turn: "reflection", request: turnRequest("reflection", "free", null), memory: ["#1: fact 1"] });
    expect(prompt).toContain("Decision points since your last progress (a new map, a new Milestone, a new exit seen, a level up, a new text of a person, a trainer beaten, an item found or a new species caught): 20.");
    expect(prompt).toContain(
      [
        "Reflection turn: stop and think before you act.",
        "- Read your Memory tree and the full Atlas above. Use zoom freely to see the details of a node: zoom does not end this turn.",
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
    const at = (events: RunEvent[], kind: "walk" | "battleAction" = "walk") => turnKind(kind, events, { stuck: 0, since: 0 }, 1);
    expect([at(decided(19)), at([...decided(19), call("zoom 1-2")]), at(decided(20))]).toEqual(["normal", "normal", "review"]);
    expect([at(decided(20), "battleAction"), at([...decided(5), ...reviewed, ...decided(19)])]).toEqual(["normal", "normal"]);
    expect(systemPrompt(SYSTEM, true)).toContain("Every 20 decisions, you get a review turn");

    const prompt = userPrompt(observation, askedOf(observation, true)!, [], { ...NO_TURN, turn: "review", request: turnRequest("review", "free", null) });
    expect(prompt).toContain(
      [
        "Review turn: check your plan against the facts before you act.",
        "- Where are you on the way to the next Milestone?",
        "- Do the facts of your Memory tree and of the full Atlas above still agree with your Mission?",
        "- What do the things that you checked and the people tell you? Which of your guesses do they confirm?",
        "- Which exits, edges, unseen cells and leads are left to explore?",
        "- Is your team ready for the next Milestone? Look at the levels, the HP, the status and the PP: does a weak Pokémon need training, do you need a Pokémon Center or items from a Poké Mart?",
        '- Write in "remove" the numbers of the sentences of your Memory tree that are false now or useless, 5 at most, or an empty list. The number of a sentence is the [n] before it. You cannot change a sentence.',
        '- Write the result in "mission" (change it only when the facts disagree with it), in "objective", and in a short "note".',
      ].join("\n"),
    );
    expect(prompt).toContain("Full Atlas, the other maps that you know, nearest first:");
  });
});

describe("the TMs and the HMs of the Bag", () => {
  const move = (name: string) => ({ name, type: "NORMAL", effect: 0, power: 50, accuracy: 100, pp: 10, maxPp: 10, description: `What ${name} does.` });
  const teachable = (item: string, name: string, able: number[] = [0], knowing: number[] = []) => ({ item, move: move(name), able, knowing });
  const TM = teachable("TM13", "ICE BEAM");
  const with_ = (teachables: Extract<Observation, { mode: "overworld" }>["teachables"], map: object = {}, grid: object = {}): Observation => {
    const base = route1(22, []) as Extract<Observation, { mode: "overworld" }>;
    return { ...base, teachables, grid: { ...base.grid, ...grid }, atlas: { ...base.atlas, maps: [{ ...base.atlas.maps[0], ...map }] } };
  };
  const promptOf = (observation: Observation, turn: "normal" | "review" | "reflection" = "normal") => userPrompt(observation, askedOf(observation, turn !== "normal")!, [], { ...NO_TURN, turn });
  const action = "- teach <TM or HM> on <Pokémon>: teach its move to a Pokémon of your party, for example teach TM13 on 1. Your Bag has: TM13 (ICE BEAM).";

  test("a normal walk shows one line for the action, and no line with no TM and no HM", () => {
    const prompt = promptOf(with_([TM]));
    expect(prompt).toContain(action);
    expect(prompt).not.toContain("Does one of these moves help your Objective?");
    expect(promptOf(with_([]))).not.toContain("teach");
  });

  test("a Review turn and a Reflection turn at a walk show each TM and HM, its move, who can learn it, and the question", () => {
    const party = with_([teachable("HM06", "ROCK SMASH", [0], []), teachable("TM39", "ROCK TOMB", [], [0])]);
    for (const turn of ["review", "reflection"] as const) {
      const prompt = promptOf(party, turn);
      expect(prompt).toContain(
        [
          "Your TMs and HMs. A TM works one time, then it leaves your Bag. An HM stays in your Bag. A Pokémon with 4 moves must forget a move to learn a new one: you choose the move, or you keep the 4 moves.",
          "- HM06: ROCK SMASH (NORMAL, power 50, accuracy 100, PP 10/10). What ROCK SMASH does. Can learn it: 1 SQUIRTLE.",
          "- TM39: ROCK TOMB (NORMAL, power 50, accuracy 100, PP 10/10). What ROCK TOMB does. Can learn it: none. Knows it: 1 SQUIRTLE.",
          "Does one of these moves help your Objective?",
        ].join("\n"),
      );
    }
    expect(promptOf(with_([]), "review")).not.toContain("Your TMs and HMs.");
  });

  test("the rules tell what a TM and an HM do", () => {
    expect(systemPrompt(SYSTEM, true)).toContain("A TM works one time, then it leaves your Bag. An HM stays in your Bag.");
  });

  describe("the hint of a Field move", () => {
    const HINT = "It can help on this map";
    const tree = { obstacles: [{ x: 0, y: 0, name: "CUT TREE", move: "CUT" }] };
    const cut = teachable("HM01", "CUT");

    test("each Field move has its obstacle on the current map, with one line and no text for a place", () => {
      expect(promptOf(with_([teachable("HM05", "FLASH")], { dark: { missingBadge: null } }))).toContain("Your Bag has HM05 (FLASH). It can help on this map: teach it.");
      expect(promptOf(with_([cut], tree))).toContain("Your Bag has HM01 (CUT). It can help on this map: teach it.");
      expect(promptOf(with_([teachable("HM06", "ROCK SMASH")], { obstacles: [{ x: 0, y: 0, name: "ROCK SMASH ROCK", move: "ROCK SMASH" }] }))).toContain("Your Bag has HM06 (ROCK SMASH). It can help on this map: teach it.");
      expect(promptOf(with_([teachable("HM04", "STRENGTH")], { obstacles: [{ x: 0, y: 0, name: "PUSHABLE BOULDER", move: "STRENGTH" }] }))).toContain("Your Bag has HM04 (STRENGTH). It can help on this map: teach it.");
      expect(promptOf(with_([teachable("HM03", "SURF")], { edges: [{ side: "south", to: null, blocked: "water" }] }))).toContain("Your Bag has HM03 (SURF). It can help on this map: teach it.");
    });

    test("with the TM or HM in the Bag and no Pokémon that can learn it, one line tells this", () => {
      expect(promptOf(with_([teachable("HM01", "CUT", [])], tree))).toContain("Your Bag has HM01 (CUT). It can help on this map, but no Pokémon of your party can learn it.");
    });

    test("no text with no obstacle on this map, with another move, with no TM or HM in the Bag, or when a Pokémon already knows the move", () => {
      expect(promptOf(with_([cut]))).not.toContain(HINT);
      expect(promptOf(with_([teachable("HM05", "FLASH")]))).not.toContain(HINT);
      expect(promptOf(with_([teachable("HM03", "SURF")]))).not.toContain(HINT);
      expect(promptOf(with_([TM], { ...tree, edges: [{ side: "south", to: null, blocked: "water" }], dark: { missingBadge: null } }))).not.toContain(HINT);
      expect(promptOf(with_([], tree))).not.toContain(HINT);
      expect(promptOf(with_([teachable("HM01", "CUT", [], [0])], tree))).not.toContain(HINT);
    });
  });
});

describe("a map that is dark for the model", () => {
  const LINE = "This map is dark: you see about 3 x 3 cells.";
  const base = route1(22, []) as Extract<Observation, { mode: "overworld" }>;
  const observed = (dark?: { missingBadge: number | null }): Observation => ({ ...base, atlas: { ...base.atlas, maps: [{ ...base.atlas.maps[0], ...(dark ? { dark } : {}) }] } });
  const NO_MOVE = { missingBadge: null };
  const promptOf = (observation: Observation) => userPrompt(observation, askedOf(observation, false)!, [], NO_TURN);

  test("with no Pokémon that knows FLASH, the line names the move, and it does not tell where to find the HM", () => {
    const prompt = promptOf(observed(NO_MOVE));
    expect(prompt).toContain(`${LINE} The HM move FLASH lights it, and no Pokémon of your party knows it.`);
    expect(prompt).not.toContain("HM05");
  });

  test("with a Pokémon that knows FLASH and no badge, the line names the missing badge", () => {
    expect(promptOf(observed({ missingBadge: 1 }))).toContain(`${LINE} A Pokémon of your party knows FLASH, but its use on the map needs badge 1.`);
  });

  test("on another map or on a lit map, there is no line", () => {
    expect(promptOf(observed())).not.toContain(LINE);
  });

  test("on a map that is dark for the model, the line of go tells that the walk goes on", () => {
    const WALK_ON = "At unseen cells of this dark map, the walk continues in the same direction";
    const withTarget = (observation: Observation): Observation => {
      const overworld = observation as Extract<Observation, { mode: "overworld" }>;
      return { ...overworld, atlas: { ...overworld.atlas, maps: [{ ...overworld.atlas.maps[0], signs: [{ x: 0, y: 0, facing: "any", text: null }] }] } };
    };
    expect(promptOf(withTarget(observed(NO_MOVE)))).toContain(WALK_ON);
    expect(promptOf(withTarget(observed()))).not.toContain(WALK_ON);
  });

  test("on a map that is dark for the model, a new cell seen is progress", () => {
    expect(promptOf(observed(NO_MOVE))).toContain("an item found, a new species caught or a new cell seen on this dark map)");
    expect(promptOf(observed())).not.toContain("a new cell seen");
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
    expect(importantEvents(before, { ...now, money: before.money - 40 }, [call("go A"), battle, lost])).toEqual([
      "all your Pokémon fainted: you lost 40 money, your party is healed, and you are back at the last Pokémon Center that you entered, or your home",
      "you got ANTIDOTE",
    ]);
    const outside = played({ name: "goTo", x: 9, y: 9 }, { status: "impossible", reason: "outside", frames: 0 });
    expect(importantEvents(now, now, [call("goTo 9 9"), outside, call("zoom 1-2"), call("goTo 9 9"), outside])).toEqual(["your last 2 actions were impossible: they changed nothing in the game"]);
    expect(importantEvents(now, now, [call("goTo 9 9"), outside])).toEqual([]);
    expect(importantEvents({ ...now, party: [] }, now, [call("choose NO")])).toEqual([]);
    const ended: RunEvent = { type: "battle", frame: 0, state: "end" };
    expect(importantEvents(now, route1(5, []), [call("fight 1"), ended])).toEqual(["the battle ended, and your party needs care: 1 SQUIRTLE HP 5/22"]);
  });
});

describe("the learn-move question", () => {
  const TACKLE = move("TACKLE", "NORMAL", 35, 29, 35, "A hit.");
  const POWDER = move("POISONPOWDER", "POISON", null, 35, 35, "Poison.");
  const SEED = move("LEECH SEED", "GRASS", null, 10, 10, "Seed.");
  const WHIP = move("VINE WHIP", "GRASS", 35, 3, 10, "A whip.");
  const SLEEP = move("SLEEP POWDER", "GRASS", null, 15, 15, "Sleep.");

  test("it names the species, shows the maximum PP, and tells what each answer leaves", () => {
    const prompt = learnMovePrompt([TACKLE, POWDER, SEED, WHIP], SLEEP);
    expect(prompt).toContain(
      [
        "Sage (IVYSAUR) wants to learn SLEEP POWDER (GRASS, power ---, accuracy 100, max PP 15). Sleep.",
        "It already knows 4 moves. To learn SLEEP POWDER, it must forget one of them:",
        "- 1. TACKLE: NORMAL, power 35, accuracy 100, max PP 35. A hit. If you forget it: Sage then has 1 damage move: VINE WHIP (GRASS, STAB, max PP 10).",
        "- 2. POISONPOWDER: POISON, power ---, accuracy 100, max PP 35. Poison. If you forget it: Sage then has 2 damage moves: TACKLE (NORMAL, max PP 35), VINE WHIP (GRASS, STAB, max PP 10).",
        "- 3. LEECH SEED: GRASS, power ---, accuracy 100, max PP 10. Seed. If you forget it: Sage then has 2 damage moves: TACKLE (NORMAL, max PP 35), VINE WHIP (GRASS, STAB, max PP 10).",
        "- 4. VINE WHIP: GRASS, power 35, accuracy 100, max PP 10. A whip. If you forget it: Sage then has 1 damage move: TACKLE (NORMAL, max PP 35).",
        "A Pokémon Center gives back all the PP, so this list shows only the maximum PP of each move.",
        "If you keep your moves: Sage then has 2 damage moves: TACKLE (NORMAL, max PP 35), VINE WHIP (GRASS, STAB, max PP 10).",
        "Keep at least 2 damage moves when you can: with only one, a foe can resist it and its PP can run out.",
        "This is an important choice. Before you choose, count your damage moves and compare their PP.",
      ].join("\n"),
    );
  });

  test("a new damage move counts in what an answer leaves, and an answer can leave no damage move", () => {
    const leaf = move("RAZOR LEAF", "GRASS", 55, 25, 25, "A leaf.");
    const prompt = learnMovePrompt([POWDER, SEED, SLEEP, WHIP], leaf);
    expect(prompt).toContain("Poison. If you forget it: Sage then has 2 damage moves: VINE WHIP (GRASS, STAB, max PP 10), RAZOR LEAF (GRASS, STAB, max PP 25).");
    const scent = move("SWEET SCENT", "NORMAL", null, 20, 20, "A scent.");
    expect(learnMovePrompt([POWDER, SEED, SLEEP, WHIP], scent)).toContain("A whip. If you forget it: Sage then has 0 damage moves.");
  });

  test("a move with no fixed power is a damage move", () => {
    const magnitude = { ...move("MAGNITUDE", "GROUND", null, 30, 30, "A quake."), fixedDamage: true as const };
    expect(learnMovePrompt([magnitude, POWDER, SEED, SLEEP], WHIP)).toContain("If you keep your moves: Sage then has 1 damage move: MAGNITUDE (GROUND, max PP 30).");
  });

  test("a move with no fixed power has no STAB, as in the fight lines", () => {
    const toxic = { ...move("VENOM", "POISON", null, 15, 15, "A poison."), fixedDamage: true as const };
    expect(learnMovePrompt([toxic, POWDER, SEED, SLEEP], WHIP)).toContain("If you keep your moves: Sage then has 1 damage move: VENOM (POISON, max PP 15).");
  });

  test("an HM move says that it cannot be forgotten, and not what forgetting it leaves", () => {
    const cut = move("CUT", "NORMAL", 50, 30, 30, "A cut.");
    const prompt = learnMovePrompt([cut, POWDER, SEED, WHIP], SLEEP);
    expect(prompt).toContain("- 1. CUT: NORMAL, power 50, accuracy 100, max PP 30. A cut. It is an HM move: it cannot be forgotten.\n");
  });

  test("the Party keeps the PP of the moment", () => {
    expect(learnMovePrompt([TACKLE, POWDER, SEED, WHIP], SLEEP)).toContain("  - VINE WHIP: GRASS, power 35, accuracy 100, PP 3/10. A whip.");
  });
});
