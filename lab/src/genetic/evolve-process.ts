import { join } from "node:path";
import type { Subprocess } from "bun";

export type EvolveNews = { kind: "start"; generation: number; population: number } | { kind: "run" } | { kind: "generation"; number: number; seconds: number };

export const STOP_EVOLUTION = "stop";

export type EvolutionRun = { name: string; parallel: number; generation: number | null; played: number; population: number; lastSeconds: number | null; stopping: boolean };

type Command = (name: string, parallel: number) => string[];

const EVOLVE_SCRIPT = join(import.meta.dir, "evolve.ts");

const evolveCommand: Command = (name, parallel) => [process.execPath, EVOLVE_SCRIPT, name, "--parallel", String(parallel)];

export class EvolveProcess {
  #run: EvolutionRun | null = null;
  #child: Subprocess | null = null;

  constructor(
    private readonly onChange: (run: EvolutionRun | null, problem: string | null) => void,
    private readonly command: Command = evolveCommand,
  ) {}

  get run(): EvolutionRun | null {
    return this.#run;
  }

  start(name: string, parallel: number): string | null {
    if (this.#run) return `The Evolution ${this.#run.name} plays: one Evolution at a time.`;
    this.#run = { name, parallel, generation: null, played: 0, population: 0, lastSeconds: null, stopping: false };
    let errors = "";
    const child = Bun.spawn(this.command(name, parallel), {
      stdout: "inherit",
      stderr: "pipe",
      ipc: (news: EvolveNews) => this.#change(this.#news(news)),
    });
    this.#child = child;
    const readErrors = (async () => {
      for await (const chunk of child.stderr.pipeThrough(new TextDecoderStream())) {
        process.stderr.write(chunk);
        errors += chunk;
      }
    })();
    void Promise.all([child.exited, readErrors]).then(([code]) => {
      this.#run = null;
      this.#child = null;
      const last = errors.trim().split("\n").at(-1) ?? "";
      this.onChange(null, code === 0 ? null : last || `bun run evolve ${name} ended with the code ${code}`);
    });
    this.#change(this.#run);
    return null;
  }

  stop(): void {
    if (!this.#run || !this.#child) return;
    this.#child.send(STOP_EVOLUTION);
    this.#change({ ...this.#run, stopping: true });
  }

  #news(news: EvolveNews): EvolutionRun | null {
    const run = this.#run;
    if (!run) return null;
    if (news.kind === "start") return { ...run, generation: news.generation, population: news.population };
    if (news.kind === "run") return { ...run, played: run.played + 1 };
    return { ...run, generation: news.number + 1, played: 0, lastSeconds: news.seconds };
  }

  #change(run: EvolutionRun | null): void {
    if (!run) return;
    this.#run = run;
    this.onChange(run, null);
  }
}
