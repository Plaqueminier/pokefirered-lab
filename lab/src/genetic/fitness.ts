import type { RunEvent, RunRecord } from "../harness/record";
import { TRACK_FIELD, TRACK_POINT } from "../protocol";

/** A change of a weight or of a count is a new version. */
export const FITNESS_VERSION = "4";

type Term = "milestones" | "maps" | "exits" | "texts" | "triggers" | "levels" | "parcel" | "towardOak" | "frames";

type FitnessTerm = { count: number; points: number };

export type Fitness = { version: string; note: number; terms: Record<Term, FitnessTerm> };

const POINTS: Record<Term, (count: number) => number> = {
  milestones: (count) => 1000 * count,
  maps: (count) => 10 * count,
  exits: (count) => 3 * count,
  texts: (count) => 2 * count,
  triggers: (count) => 10 * count,
  levels: (count) => 20 * Math.log2(1 + count),
  parcel: (count) => 200 * count,
  towardOak: (count) => 3 * count,
  frames: (count) => -count / 100_000,
};

export function fitness(record: RunRecord): Fitness {
  const maps = record.events.flatMap((e) => (e.type === "map" ? [e.map] : []));
  const team = record.state?.findLast((entry) => entry.kind === "team");
  const counts: Record<Term, number> = {
    milestones: record.result.milestones.length,
    maps: new Set(maps).size,
    // The record has no exit event: each change of map is an exit.
    exits: new Set(maps.slice(1).map((map, i) => `${maps[i]} > ${map}`)).size,
    texts: new Set(textsAfter(record.events, isTalk).map((text) => text.join(" "))).size,
    // A trigger can stop the player again with the same text (OAK: "Don't go away yet!"): its first text tells it.
    triggers: new Set(textsAfter(record.events, isTrigger).map((text) => text[0])).size,
    levels: team?.kind === "team" ? team.team.reduce((sum, mon) => sum + mon.level, 0) : 0,
    parcel: parcelFrame(record.events) === null ? 0 : 1,
    towardOak: cellsTowardOak(record),
    frames: record.result.frames,
  };
  const terms = Object.fromEntries(Object.entries(counts).map(([term, count]) => [term, { count, points: POINTS[term as Term](count) }])) as Record<Term, FitnessTerm>;
  return { version: FITNESS_VERSION, note: Object.values(terms).reduce((note, term) => note + term.points, 0), terms };
}

type ActionEvent = Extract<RunEvent, { type: "action" }>;

// The record has no text event and does not tell a sign from a person: the text of a sign counts too.
const isTalk = (event: ActionEvent) => event.action.name === "interact" && event.result.status === "done";

// The reason `script` is a sign that the game reads when the walk bumps into it ("Press START to open the MENU!"): it is not a trigger of the story.
const isTrigger = (event: ActionEvent) => event.result.status === "interrupted" && event.result.reason === "trigger";

/** The texts that the `readText` actions read after each action that `starts` accepts. */
function textsAfter(events: readonly RunEvent[], starts: (event: ActionEvent) => boolean): string[][] {
  const texts: string[][] = [];
  let read: string[] | null = null;
  for (const event of events) {
    if (event.type !== "action") continue;
    if (event.action.name === "readText" && read && "text" in event.result) {
      read.push(...event.result.text);
      continue;
    }
    if (read && read.length > 0) texts.push(read);
    read = starts(event) ? [] : null;
  }
  if (read && read.length > 0) texts.push(read);
  return texts;
}

// A guide to the Milestone `pokedex` only: the next Milestones will need their own guide.
// The clerk of the Viridian City shop gives OAK'S PARCEL as soon as the player goes in (ViridianCity_Mart_OnFrame).
const PARCEL_MAP = "ViridianCity_Mart";

const parcelFrame = (events: readonly RunEvent[]) => events.find((e) => e.type === "map" && e.map === PARCEL_MAP)?.frame ?? null;

// The outdoor maps from the shop to the lab, with the position of their cell (0, 0) in the cells of Pallet Town (the connections of their map.json).
const OUTDOOR: Record<string, { x: number; y: number }> = { PalletTown: { x: 0, y: 0 }, Route1: { x: 0, y: -40 }, ViridianCity: { x: -12, y: -80 } };
const LAB_DOOR = { x: 16, y: 13 };
// The player gives the parcel from the cell below PROF. OAK (6, 3), 8 cells from the door of the lab (6, 12).
const IN_FRONT_OF_OAK = { x: 6, y: 4 };
const DOOR_TO_OAK = 8;
const SHOP_DOOR = { map: "ViridianCity", x: 36, y: 19 };

/** The cells from a cell to PROF. OAK, with no walls: `null` out of the way from the shop to the lab. */
function cellsToOak(map: string, x: number, y: number): number | null {
  if (map === "PalletTown_ProfessorOaksLab") return Math.abs(x - IN_FRONT_OF_OAK.x) + Math.abs(y - IN_FRONT_OF_OAK.y);
  const origin = OUTDOOR[map];
  if (!origin) return null;
  return Math.abs(origin.x + x - LAB_DOOR.x) + Math.abs(origin.y + y - LAB_DOOR.y) + DOOR_TO_OAK;
}

/** How many cells nearer to PROF. OAK than the door of the shop the player went with the parcel: the nearest cell counts, so a step back loses nothing. */
function cellsTowardOak(record: RunRecord): number {
  const from = parcelFrame(record.events);
  if (from === null || !record.track) return 0;
  const start = cellsToOak(SHOP_DOOR.map, SHOP_DOOR.x, SHOP_DOOR.y) ?? 0;
  const maps = record.events.flatMap((e) => (e.type === "map" ? [e] : []));
  let nearest = start;
  let next = 0;
  let map = "";
  for (let i = 0; i < record.track.length; i += TRACK_POINT) {
    const frame = record.track[i + TRACK_FIELD.frame];
    // A `map` event has the frame of the first point of the track on its map.
    while (next < maps.length && maps[next].frame <= frame) map = maps[next++].map;
    if (frame < from) continue;
    const cells = cellsToOak(map, record.track[i + TRACK_FIELD.x], record.track[i + TRACK_FIELD.y]);
    if (cells !== null) nearest = Math.min(nearest, cells);
  }
  return start - nearest;
}
