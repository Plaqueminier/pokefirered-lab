import { describe, expect, setDefaultTimeout, test } from "bun:test";
import { existsSync } from "node:fs";
import starter from "../../bots/starter";
import { ROM_FILE, START_SAVE } from "../run";
import { Harness, type HarnessOptions } from "./harness";
import { RunPool } from "./pool";
import { RecordPlayer } from "./record";

const ready = existsSync(ROM_FILE) && existsSync(START_SAVE);
setDefaultTimeout(120_000);

async function playAlone(options: HarnessOptions = {}) {
  const harness = await Harness.open(options);
  try {
    await harness.play(starter);
    return { record: harness.record(), screen: harness.screenHash() };
  } finally {
    harness.close();
  }
}

describe.skipIf(!ready)("RunPool", () => {
  test("a Run in a worker gives the same Run record as the Run alone", async () => {
    const alone = await playAlone({ frameBudget: 2000 });
    const run = new RunPool().start({ bot: "starter", frameBudget: 2000 });
    expect(run.end).toBeNull();
    const end = await run.done;
    expect(end).toEqual({ record: alone.record, error: null });
    expect(run.end).toEqual(end);
  });

  test("4 Runs of the starter Bot play at the same time, the pool refuses a fifth Run, and each Run gives the same Run record as the Run alone", async () => {
    const alone = await playAlone();
    expect(alone.record.result.endReason).toBe("goal");
    const pool = new RunPool();
    const runs = Array.from({ length: 4 }, () => pool.start({ bot: "starter" }));
    expect(() => pool.start({ bot: "starter" })).toThrow("the pool plays 4 Runs at most");
    while (runs.some((run) => run.view.frame === 0)) await Bun.sleep(5);
    expect(runs.map((run) => run.end)).toEqual([null, null, null, null]);
    for (const { done } of runs) expect(await done).toEqual({ record: alone.record, error: null });
    expect(pool.runs).toEqual(runs);
  });

  test("a Run frees its place at its end, and a Run that cannot start ends with an error and no Run record", async () => {
    const pool = new RunPool(1);
    const first = pool.start({ bot: "nobody" });
    expect(() => pool.start({ bot: "starter" })).toThrow("the pool plays 1 Runs at most");
    const { record, error } = await first.done;
    expect(record).toBeNull();
    expect(error).toContain("bots/nobody.ts");
    expect((await pool.start({ bot: "starter", frameBudget: 10 }).done).record?.result.endReason).toBe("frame budget");
    const notModel = await pool.start({ bot: "starter", model: { id: "a/b", costLimit: 0.5, reasoning: "off", temperature: null } }).done;
    expect(notModel).toEqual({ record: null, error: "Error: bots/starter.ts is not a model bot: it does not export modelBot(model)" });
  });

  test("stop ends a Run of a scripted Bot at its next decision, with the end reason user stop and a Run record", async () => {
    const run = new RunPool().start({ bot: "starter" });
    expect(run.stopAsked).toBe(false);
    run.stop();
    expect(run.stopAsked).toBe(true);
    const { record, error } = await run.done;
    expect(error).toBeNull();
    expect(record?.result.endReason).toBe("user stop");
    expect(record?.events.filter((e) => e.type === "action")).toHaveLength(1);
  });

  test("while a Run plays, the pool has its screen, its state and its events; at the end, the last screen and all the events of the Run record", async () => {
    const alone = await playAlone();
    const run = new RunPool().start({ bot: "starter" });
    while (run.view.frame === 0) await Bun.sleep(5);
    expect(run.end).toBeNull();
    while (run.view.state === null || run.events.length === 0) await Bun.sleep(5);
    expect(run.end).toBeNull();
    await run.done;
    expect(run.events).toEqual(alone.record.events);
    expect(run.view.frame).toBe(new RecordPlayer(alone.record).frames);
    expect(new Bun.CryptoHasher("sha256").update(run.view.screen ?? "").digest("hex").slice(0, 16)).toBe(alone.screen);
    expect(run.view.state).toMatchObject({ map: { name: "PalletTown_ProfessorOaksLab" } });
  });
});
