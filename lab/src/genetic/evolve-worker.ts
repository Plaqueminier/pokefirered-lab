import { geneticBot } from "../../bots/genetic";
import { errorText, Harness } from "../harness/harness";
import type { Played, PlayerRun } from "./evolution";
import { fitness } from "./fitness";
import type { Genome } from "./genome";

declare const self: Worker;

export type EvolveJob = { job: number; genome: Genome } & PlayerRun;

export type EvolveEnd = { job: number } & ({ played: Played; error: string | null } | { played: null; error: string });

self.onmessage = async ({ data: { job, genome, seed, frameBudget, noProgressLimit } }: MessageEvent<EvolveJob>) => {
  let harness: Harness | null = null;
  try {
    harness = await Harness.open({ seed, frameBudget, noProgressLimit });
    const error = await harness.play(geneticBot(genome)).then(
      () => null,
      (e: unknown) => errorText(e),
    );
    const record = harness.record();
    self.postMessage({ job, played: { record, fitness: fitness(record) }, error } satisfies EvolveEnd);
  } catch (error) {
    self.postMessage({ job, played: null, error: errorText(error) } satisfies EvolveEnd);
  } finally {
    harness?.close();
  }
};
