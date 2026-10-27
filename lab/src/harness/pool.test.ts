import { describe, expect, setDefaultTimeout, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import starter from "./scripted-bot";
import { ROM_FILE, START_SAVE } from "../run";
import { Harness, type HarnessOptions } from "./harness";
import { RunPool } from "./pool";
import { RecordPlayer } from "./record";

const STARTER = join(import.meta.dir, "scripted-bot.ts");
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
  test("a Run frees its place at its end, and a Run that cannot start ends with an error and no Run record", async () => {
    const pool = new RunPool(1);
    const first = pool.start({ bot: "nobody" });
    expect(() => pool.start({ bot: STARTER })).toThrow("the pool plays 1 Runs at most");
    const { record, error } = await first.done;
    expect(record).toBeNull();
    expect(error).toContain("bots/nobody.ts");
    expect((await pool.start({ bot: STARTER, frameBudget: 10 }).done).record?.result.endReason).toBe("frame budget");
    const notModel = await pool.start({ bot: STARTER, model: { id: "a/b", costLimit: 0.5, reasoning: "off", temperature: null, starter: "free", stopAtWhiteout: true } }).done;
    expect(notModel).toEqual({ record: null, error: `Error: ${STARTER} is not a model bot: it does not export modelBot(model)` });
  });

  test("stop ends a Run of a scripted Bot at its next decision, with the end reason user stop and a Run record", async () => {
    const run = new RunPool().start({ bot: STARTER });
    expect(run.stopAsked).toBe(false);
    run.stop();
    expect(run.stopAsked).toBe(true);
    const { record, error } = await run.done;
    expect(error).toBeNull();
    expect(record?.result.endReason).toBe("user stop");
    expect(record?.events.filter((e) => e.type === "action")).toHaveLength(1);
  });

  test("a Run in a worker gives the same Run record as the Run alone; while it plays, the pool has its screen, its state and its events; at the end, the last screen and all the events of the Run record", async () => {
    const alone = await playAlone({ frameBudget: 2000 });
    const run = new RunPool().start({ bot: STARTER, frameBudget: 2000 });
    while (run.view.frame === 0) await Bun.sleep(5);
    expect(run.end).toBeNull();
    while (run.view.state === null || run.events.length === 0) await Bun.sleep(5);
    expect(run.end).toBeNull();
    const end = await run.done;
    expect(end).toEqual({ record: alone.record, error: null });
    expect(run.end).toEqual(end);
    expect(run.events).toEqual(alone.record.events);
    expect(run.view.frame).toBe(new RecordPlayer(alone.record).frames);
    expect(new Bun.CryptoHasher("sha256").update(run.view.screen ?? "").digest("hex").slice(0, 16)).toBe(alone.screen);
    expect(run.view.state).toMatchObject({ map: { name: alone.record.events.findLast((e) => e.type === "map")?.map } });
  });
});
