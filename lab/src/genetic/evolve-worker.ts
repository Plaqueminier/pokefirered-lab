// One worker plays the Runs of an Evolution one after the other. It posts only the end of each Run: no screen, no state, as nobody watches it live.
import { geneticBot } from "../../bots/genetic";
import { errorText, Harness } from "../harness/harness";
import type { Played } from "./evolution";
import { fitness } from "./fitness";
import type { Genome } from "./genome";

declare const self: Worker;

export type EvolveJob = { job: number; genome: Genome; frameBudget: number; noProgressLimit: number };

/** `error`: the Bot stopped with an error, and the Run record holds the Run until then. */
export type EvolveEnd = { job: number } & ({ played: Played; error: string | null } | { played: null; error: string });

self.onmessage = async ({ data: { job, genome, frameBudget, noProgressLimit } }: MessageEvent<EvolveJob>) => {
  let harness: Harness | null = null;
  try {
    harness = await Harness.open({ frameBudget, noProgressLimit });
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
