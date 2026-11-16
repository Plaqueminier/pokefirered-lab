import { expect, test } from "bun:test";
import { partyOf } from "./state-track";
import type { StateEntry } from "./protocol";

const BULBASAUR = { species: "BULBASAUR", nickname: "LEAF", level: 5, maxHp: 20, moves: ["TACKLE"] };
const PIDGEY = { species: "PIDGEY", nickname: "PIDGEY", level: 3, maxHp: 14, moves: ["TACKLE"] };

test("the party of a replay at a frame joins the last team and the last HP of the State track at this frame", () => {
  const state: StateEntry[] = [
    { frame: 100, kind: "team", team: [BULBASAUR] },
    { frame: 100, kind: "health", health: [{ hp: 20, status: "none" }] },
    { frame: 150, kind: "battle", trainer: null, player: null, foe: null },
    { frame: 200, kind: "health", health: [{ hp: 7, status: "poison" }] },
    { frame: 300, kind: "team", team: [{ ...BULBASAUR, level: 6, maxHp: 22 }, PIDGEY] },
    { frame: 300, kind: "health", health: [{ hp: 9, status: "none" }, { hp: 0, status: "none" }] },
  ];
  const at = partyOf(state);
  expect(at(99)).toEqual([]);
  expect(at(100)).toEqual([{ species: "BULBASAUR", nickname: "LEAF", level: 5, hp: 20, maxHp: 20, status: "none" }]);
  expect(at(299)).toEqual([{ species: "BULBASAUR", nickname: "LEAF", level: 5, hp: 7, maxHp: 20, status: "poison" }]);
  expect(at(5000)).toEqual([
    { species: "BULBASAUR", nickname: "LEAF", level: 6, hp: 9, maxHp: 22, status: "none" },
    { species: "PIDGEY", nickname: "PIDGEY", level: 3, hp: 0, maxHp: 14, status: "none" },
  ]);
});

test("a Run record with no State track gives no party", () => {
  expect(partyOf(undefined)(100)).toBeNull();
});
