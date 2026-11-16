import { lineOf, STARTER_SPECIES, type StarterSpecies, type TeamMon } from "../src/protocol";
import type { RaceFile, RaceRun, RaceWhiteout, RaceWords } from "../src/race/file";

export const STARTER_TYPE: Record<StarterSpecies, string> = { BULBASAUR: "GRASS", SQUIRTLE: "WATER", CHARMANDER: "FIRE" };

/** `run`: the index of the Run in the Race, not its Run id. `order`: the index of the death in the order of the Runs, as the Tour shows them. */
export type RaceDeath = RaceWhiteout & { id: string; run: number; number: number; order: number; starter: StarterSpecies | null; endedRun: boolean; epitaph: string };

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

export function raceDeaths(race: RaceFile, starters = race.runs.map(starterOf)): RaceDeath[] {
  const deaths = race.runs.flatMap((run, index) => {
    const starter = starters[index];
    const last = run.whiteouts.at(-1);
    return run.whiteouts.map(
      (whiteout): Omit<RaceDeath, "order"> => ({
        ...whiteout,
        id: `${run.number}:${whiteout.frame}`,
        run: index,
        number: run.number,
        starter,
        endedRun: run.end.result === "whiteout" && whiteout === last,
        epitaph: epitaphOf(whiteout.lastWords),
      }),
    );
  });
  return deaths.sort((a, b) => a.number - b.number || a.frame - b.frame).map((death, order) => ({ ...death, order }));
}
