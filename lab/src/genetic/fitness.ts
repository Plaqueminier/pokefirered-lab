import type { RunEvent, RunRecord } from "../harness/record";

/** A change of a weight or of a count is a new version. */
export const FITNESS_VERSION = "3";

type Term = "milestones" | "maps" | "exits" | "texts" | "triggers" | "levels" | "frames";

type FitnessTerm = { count: number; points: number };

export type Fitness = { version: string; note: number; terms: Record<Term, FitnessTerm> };

const POINTS: Record<Term, (count: number) => number> = {
  milestones: (count) => 1000 * count,
  maps: (count) => 10 * count,
  exits: (count) => 3 * count,
  texts: (count) => 2 * count,
  triggers: (count) => 10 * count,
  levels: (count) => 20 * Math.log2(1 + count),
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
