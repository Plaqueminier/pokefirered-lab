import { expect, test } from "bun:test";
import { RACE_VERSION, type RaceFile, type RaceRun, type RaceWhiteout } from "../src/race/file";
import { leadOf, raceDeaths, starterOf, starterStats } from "./race-deaths";

const SQUIRTLE = { species: "SQUIRTLE", nickname: "BOB", level: 5, maxHp: 20, moves: ["TACKLE"] };

function run(number: number, whiteouts: RaceWhiteout[], result: RaceRun["end"]["result"]): RaceRun {
  return {
    number,
    record: `${number}.json`,
    bot: "model 43",
    model: "a/b",
    character: "Normal trainer",
    track: [],
    battles: [],
    trainers: [],
    milestones: [],
    end: { frame: 1000, result },
    state: [{ frame: 1, kind: "team", team: [SQUIRTLE] }],
    cost: [],
    faints: [],
    money: [],
    whiteouts,
  };
}

const killer = { poison: false, trainer: null, species: "PIDGEY", level: 3 };

test("the deaths of a Race are its whiteouts in the order of the Runs; only the last whiteout of a Run that a whiteout ended ended its Run", () => {
  const race: RaceFile = {
    version: RACE_VERSION,
    runs: [
      run(7, [{ frame: 50, killer, lastWords: [] }], "whiteout"),
      run(3, [{ frame: 20, killer: null, lastWords: [] }, { frame: 80, killer, lastWords: [] }], "whiteout"),
      run(9, [{ frame: 10, killer, lastWords: [] }], "user stop"),
    ],
  };
  expect(raceDeaths(race).map(({ id, run, number, frame, endedRun, starter }) => ({ id, run, number, frame, endedRun, starter }))).toEqual([
    { id: "3:20", run: 1, number: 3, frame: 20, endedRun: false, starter: "SQUIRTLE" },
    { id: "3:80", run: 1, number: 3, frame: 80, endedRun: true, starter: "SQUIRTLE" },
    { id: "7:50", run: 0, number: 7, frame: 50, endedRun: true, starter: "SQUIRTLE" },
    { id: "9:10", run: 2, number: 9, frame: 10, endedRun: false, starter: "SQUIRTLE" },
  ]);
});

test("the lead of a team is the starter of its Run, also when it evolved, else the first Pokémon", () => {
  const charmeleon = { species: "CHARMELEON", nickname: "EMBER" };
  const pidgey = { species: "PIDGEY", nickname: "PIDGEY" };
  expect(leadOf([pidgey, charmeleon], "CHARMANDER")).toBe(charmeleon);
  expect(leadOf([pidgey, charmeleon], "SQUIRTLE")).toBe(pidgey);
  expect(leadOf([pidgey], null)).toBe(pidgey);
  expect(starterOf({ state: [{ frame: 1, kind: "team", team: [] }, { frame: 2, kind: "team", team: [{ ...SQUIRTLE, species: "IVYSAUR" }] }] })).toBe("BULBASAUR");
  expect(starterOf({ state: [] })).toBeNull();
});

test("the stats of a starter count its Runs, its whiteouts and its Runs with each badge at the cursor", () => {
  const badges = (got: number) => ({ stats: { badges: Array.from({ length: 8 }, (_, i) => i < got) } });
  const ghosts = [
    { run: 0, ...badges(2) },
    { run: 1, ...badges(1) },
    { run: 2, ...badges(0) },
    { run: 3, ...badges(2) },
  ];
  const stats = starterStats(["SQUIRTLE", "SQUIRTLE", "CHARMANDER", null], ghosts, [{ starter: "CHARMANDER" }, { starter: "CHARMANDER" }, { starter: "SQUIRTLE" }], [1, 2]);
  expect(stats).toEqual([
    { starter: "BULBASAUR", runs: 0, whiteouts: 0, badges: [{ badge: 1, runs: 0 }, { badge: 2, runs: 0 }] },
    { starter: "CHARMANDER", runs: 1, whiteouts: 2, badges: [{ badge: 1, runs: 0 }, { badge: 2, runs: 0 }] },
    { starter: "SQUIRTLE", runs: 2, whiteouts: 1, badges: [{ badge: 1, runs: 2 }, { badge: 2, runs: 1 }] },
  ]);
});

test("the epitaph of a death is the last line that the model said, else the first sentence of its last reason", () => {
  const said = run(1, [{ frame: 5, killer, lastWords: [{ reason: "Old. Text.", say: "Not this one" }, { reason: "Heal now. Then go.", say: "Bob, hold on!" }] }], "whiteout");
  const reasoned = run(2, [{ frame: 5, killer, lastWords: [{ reason: "Old.", say: "Not this one" }, { reason: "A Potion cannot revive it! So I stop." }] }], "whiteout");
  const silent = run(3, [{ frame: 5, killer, lastWords: [] }], "whiteout");
  expect(raceDeaths({ version: RACE_VERSION, runs: [said, reasoned, silent] }).map((death) => death.epitaph)).toEqual(["Bob, hold on!", "A Potion cannot revive it!", ""]);
});
