import { expect, test } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type EvolutionRun, EvolveProcess } from "./evolve-process";

async function fakeEvolve(code: string): Promise<(name: string, parallel: number) => string[]> {
  const script = join(await mkdtemp(join(tmpdir(), "evolve-")), "evolve.ts");
  await Bun.write(script, code);
  return () => [process.execPath, script];
}

async function until(done: () => boolean): Promise<void> {
  for (let wait = 0; !done(); wait += 10) {
    if (wait > 5000) throw new Error("no change after 5 s");
    await Bun.sleep(10);
  }
}

test("the Evolution of the page shows its Generation and its Runs, refuses a second Evolution, and ends after its Generation when a person stops it", async () => {
  const command = await fakeEvolve(`
    process.send({ kind: "start", generation: 7, population: 50 });
    process.send({ kind: "run" });
    process.send({ kind: "run" });
    process.on("message", (message) => {
      if (message !== "stop") return;
      process.send({ kind: "generation", number: 7, seconds: 3.5 });
      process.exit(0);
    });
  `);
  const problems: string[] = [];
  const evolutions = new EvolveProcess((_run, problem) => problem && problems.push(problem), command);
  expect(evolutions.start("night-1", 12)).toBeNull();
  await until(() => evolutions.run?.played === 2);
  expect(evolutions.run).toEqual<EvolutionRun>({ name: "night-1", parallel: 12, generation: 7, played: 2, population: 50, lastSeconds: null, stopping: false });
  expect(evolutions.start("night-2", 4)).toBe("The Evolution night-1 plays: one Evolution at a time.");
  evolutions.stop();
  expect(evolutions.run?.stopping).toBe(true);
  await until(() => evolutions.run === null);
  expect(problems).toEqual([]);
});

test("an Evolution that stops with an error gives the last line of its errors", async () => {
  const command = await fakeEvolve(`
    console.error("A Run stops with an error of the Bot (its Run record counts): no route");
    console.error("The Evolution night-1 stops: the Fitness is now version 2");
    process.exit(1);
  `);
  const problems: string[] = [];
  const evolutions = new EvolveProcess((_run, problem) => problem && problems.push(problem), command);
  evolutions.start("night-1", 12);
  await until(() => evolutions.run === null);
  expect(problems).toEqual(["The Evolution night-1 stops: the Fitness is now version 2"]);
});
