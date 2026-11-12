import type { RunEvent, RunRecord } from "../harness/record";

/** A change of a weight or of a count is a new version. */
export const FITNESS_VERSION = "1";

type Term = "milestones" | "maps" | "exits" | "texts" | "levels" | "frames";

type FitnessTerm = { count: number; points: number };

export type Fitness = { version: string; note: number; terms: Record<Term, FitnessTerm> };

const POINTS: Record<Term, (count: number) => number> = {
  milestones: (count) => 1000 * count,
  maps: (count) => 10 * count,
  exits: (count) => 3 * count,
  texts: (count) => 2 * count,
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
    texts: new Set(textsOfPeople(record.events)).size,
    levels: team?.kind === "team" ? team.team.reduce((sum, mon) => sum + mon.level, 0) : 0,
    frames: record.result.frames,
  };
  const terms = Object.fromEntries(Object.entries(counts).map(([term, count]) => [term, { count, points: POINTS[term as Term](count) }])) as Record<Term, FitnessTerm>;
  return { version: FITNESS_VERSION, note: Object.values(terms).reduce((note, term) => note + term.points, 0), terms };
}

// The record has no text event and does not tell a sign from a person: the text of a sign counts too.
function textsOfPeople(events: readonly RunEvent[]): string[] {
  const texts: string[] = [];
  let talk: string[] | null = null;
  for (const event of events) {
    if (event.type !== "action") continue;
    if (event.action.name === "readText" && talk && "text" in event.result) {
      talk.push(...event.result.text);
      continue;
    }
    if (talk && talk.length > 0) texts.push(talk.join(" "));
    talk = event.action.name === "interact" && event.result.status === "done" ? [] : null;
  }
  if (talk && talk.length > 0) texts.push(talk.join(" "));
  return texts;
}
