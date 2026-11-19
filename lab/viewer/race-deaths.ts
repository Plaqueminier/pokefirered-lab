import { type EndReason, lineOf, STARTER_SPECIES, type StarterSpecies, type TeamMon } from "../src/protocol";
import type { RaceFile, RaceRun, RaceWhiteout, RaceWords } from "../src/race/file";

export const STARTER_TYPE: Record<StarterSpecies, string> = { BULBASAUR: "GRASS", SQUIRTLE: "WATER", CHARMANDER: "FIRE" };

/** `run`: the index of the Run in the Race, not its Run id. */
type GraveBase = { id: string; run: number; number: number; frame: number; starter: StarterSpecies | null };

export type RaceDeath = GraveBase & RaceWhiteout & { kind: "whiteout"; endedRun: boolean; epitaph: string };

export type OtherEnd = Exclude<EndReason, "whiteout">;

type RaceEnd = GraveBase & { kind: "end"; result: OtherEnd };

export type RaceGrave = RaceDeath | RaceEnd;

export function isDeath<G extends RaceGrave>(grave: G): grave is Extract<G, { kind: "whiteout" }> {
  return grave.kind === "whiteout";
}

export function isEnd<G extends RaceGrave>(grave: G): grave is Extract<G, { kind: "end" }> {
  return grave.kind === "end";
}

export function starterOf(run: Pick<RaceRun, "state">): StarterSpecies | null {
  const first = run.state.find((entry) => entry.kind === "team" && entry.team.length > 0);
  return first?.kind === "team" ? lineOf(first.team[0].species) : null;
}

export function leadOf<M extends Pick<TeamMon, "species">>(team: readonly M[], starter: StarterSpecies | null): M | undefined {
  return team.find((mon) => starter !== null && lineOf(mon.species) === starter) ?? team[0];
}

function firstSentence(text: string): string {
  return text.trim().split(/(?<=[.!?])\s/)[0];
}

function epitaphOf(words: readonly RaceWords[]): string {
  const last = words.at(-1);
  return last ? (last.say ?? firstSentence(last.reason)) : "";
}

export type StarterStats = { starter: StarterSpecies; runs: number; whiteouts: number; badges: { badge: number; runs: number }[] };

/** `starters`: the starter of each Run, by its index in the Race. */
export function starterStats(starters: readonly (StarterSpecies | null)[], ghosts: readonly { run: number; stats: { badges: readonly boolean[] } }[], deaths: readonly Pick<RaceDeath, "starter">[], badges: readonly number[]): StarterStats[] {
  return STARTER_SPECIES.map((starter) => {
    const runs = ghosts.filter((ghost) => starters[ghost.run] === starter);
    return {
      starter,
      runs: runs.length,
      whiteouts: deaths.filter((death) => death.starter === starter).length,
      badges: badges.map((badge) => ({ badge, runs: runs.filter((ghost) => ghost.stats.badges[badge - 1]).length })),
    };
  });
}

export function raceGraves(race: RaceFile, starters = race.runs.map(starterOf)): RaceGrave[] {
  const graves = race.runs.flatMap((run, index): RaceGrave[] => {
    const starter = starters[index];
    const last = run.whiteouts.at(-1);
    const { frame, result } = run.end;
    const deaths = run.whiteouts.map(
      (whiteout): RaceDeath => ({
        ...whiteout,
        kind: "whiteout",
        id: `${run.number}:${whiteout.frame}`,
        run: index,
        number: run.number,
        starter,
        endedRun: run.end.result === "whiteout" && whiteout === last,
        epitaph: epitaphOf(whiteout.lastWords),
      }),
    );
    return result === "whiteout" ? deaths : [...deaths, { kind: "end", id: `end:${run.number}`, run: index, number: run.number, frame, result, starter }];
  });
  return graves.sort((a, b) => a.number - b.number || a.frame - b.frame);
}
