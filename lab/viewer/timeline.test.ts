import { expect, test } from "bun:test";
import type { RunEvent } from "../src/harness/record";
import { timelineEvents } from "./timeline-events";

const AREAS = {
  PalletTown: { area: "Pallet Town", place: null },
  PalletTown_ProfessorOaksLab: { area: "Pallet Town", place: "Professor Oak's Lab" },
  Route1: { area: "Route 1", place: null },
  ViridianCity_PokemonCenter_1F: { area: "Viridian City", place: "Pokémon Center" },
};

test("the Timeline shows the Game events of a Run with names, and groups the levels and the wild battles of one stay in an Area", () => {
  const events: RunEvent[] = [
    { frame: 10, type: "map", map: "PalletTown" },
    { frame: 20, type: "map", map: "PalletTown_ProfessorOaksLab" },
    { frame: 30, type: "milestone", milestone: "has-pokemon" },
    { frame: 100, type: "battle", state: "start" },
    { frame: 120, type: "faint", species: "BULBASAUR", side: "enemy" },
    { frame: 100 + 60 * 72, type: "money", before: 3000, after: 3080, cause: "battle" },
    { frame: 100 + 60 * 72, type: "battle", state: "end" },
    { frame: 100 + 60 * 72 + 5, type: "trainer", trainer: "RIVAL BOB", id: 327 },
    { frame: 4500, type: "level", species: "SQUIRTLE", from: 5, level: 6, moves: [], evolution: null },
    { frame: 5000, type: "map", map: "Route1" },
    { frame: 5100, type: "battle", state: "start" },
    { frame: 5200, type: "faint", species: "SQUIRTLE", side: "player" },
    { frame: 5300, type: "battle", state: "end" },
    { frame: 5400, type: "level", species: "SQUIRTLE", from: 6, level: 7, moves: ["BUBBLE"], evolution: null },
    { frame: 5500, type: "battle", state: "start" },
    { frame: 5600, type: "catch", species: "PIDGEY" },
    { frame: 5700, type: "battle", state: "end" },
    { frame: 5800, type: "level", species: "SQUIRTLE", from: 7, level: 16, moves: [], evolution: "WARTORTLE" },
    { frame: 6000, type: "item", how: "received", item: "OAK'S PARCEL", count: 1 },
    { frame: 6100, type: "purchase", item: "POTION", count: 3, money: 900 },
    { frame: 6200, type: "map", map: "ViridianCity_PokemonCenter_1F" },
    { frame: 6300, type: "heal", source: "center", item: null, party: [] },
    { frame: 6400, type: "heal", source: "item", item: "POTION", party: [] },
    { frame: 6500, type: "map", map: "PalletTown" },
    { frame: 7000, type: "whiteout" },
    { frame: 7100, type: "battle", state: "start", trainer: true },
    { frame: 10700, type: "battle", state: "end" },
    { frame: 10800, type: "whiteout" },
  ];

  expect(timelineEvents(events, AREAS)).toEqual([
    { frame: 10, kind: "place", text: "Pallet Town" },
    { frame: 30, kind: "milestone", text: "First Pokémon" },
    { frame: 100, kind: "trainer", text: "Trainer battle: Rival Bob (1:12)" },
    { frame: 4500, kind: "level", text: "Squirtle Lv 5 → 6" },
    { frame: 5000, kind: "place", text: "Route 1" },
    { frame: 5100, kind: "wild", text: "2 wild battles in Route 1" },
    { frame: 5200, kind: "faint", text: "Squirtle fainted" },
    { frame: 5400, kind: "level", text: "Squirtle Lv 6 → 16" },
    { frame: 5600, kind: "catch", text: "New Pokémon: Pidgey" },
    { frame: 5800, kind: "evolution", text: "Squirtle evolved into Wartortle" },
    { frame: 6000, kind: "item", text: "Got OAK'S PARCEL" },
    { frame: 6100, kind: "purchase", text: "Bought 3 × POTION" },
    { frame: 6200, kind: "place", text: "Viridian City" },
    { frame: 6300, kind: "heal", text: "Healed at the Pokémon Center" },
    { frame: 6400, kind: "heal", text: "Healed with POTION" },
    { frame: 7100, kind: "trainer", text: "Trainer battle (1:00)" },
  ]);
});
