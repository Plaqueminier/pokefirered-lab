import { describe, expect, setDefaultTimeout, test } from "bun:test";
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import starter from "./scripted-bot";
import { ROM_FILE, Run, START_SAVE, screenHash } from "../run";
import { Harness, type HarnessOptions } from "./harness";
import { RunPool } from "./pool";
import { RecordPlayer, type RunRecord } from "./record";

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

async function screenAt(record: RunRecord, frame: number): Promise<string> {
  const run = await Run.open({ names: record.header.names });
  try {
    const player = new RecordPlayer(record);
    while (player.frame < frame) run.runFrame(player.next());
    return run.screenHash();
  } finally {
    run.core.close();
  }
}

describe.skipIf(!ready)("RunPool", () => {
  test("one call starts N Runs, a start past the free places starts nothing, a Run frees its place at its end, and a Run that cannot start ends with an error and no Run record", async () => {
    const pool = new RunPool(3);
    const first = pool.start({ bot: "nobody" });
    expect(() => pool.startAll({ bot: STARTER }, 3)).toThrow("the pool has 2 free places of 3");
    expect(pool.runs).toHaveLength(1);
    const others = pool.startAll({ bot: "nobody" }, 2);
    expect(others.map((run) => run.id)).toEqual([2, 3]);
    expect(pool.free).toBe(0);
    expect(() => pool.start({ bot: STARTER })).toThrow("the pool has 0 free places of 3");
    const { record, error } = await first.done;
    expect(record).toBeNull();
    expect(error).toContain("bots/nobody.ts");
    await Promise.all(others.map((run) => run.done));
    expect((await pool.start({ bot: STARTER, frameBudget: 10 }).done).record?.result.endReason).toBe("frame budget");
    const notModel = await pool.start({ bot: STARTER, model: { id: "a/b", costLimit: 0.5, reasoning: "off", thinking: "off", temperature: null, starter: "free", stopAtWhiteout: true } }).done;
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

  test("stop reaches a Model call that waits in the worker: the Run ends at once with user stop and a Run record", async () => {
    const bot = join(mkdtempSync(join(tmpdir(), "lab-bot-")), "waiting-model.ts");
    await Bun.write(bot, `import { modelBot as real } from ${JSON.stringify(join(import.meta.dir, "../../bots/model.ts"))};
export const modelBot = (options) => real(options, () => (_prompt, { signal }) => new Promise((_resolve, reject) => signal.addEventListener("abort", () => reject(signal.reason))));`);
    const run = new RunPool().start({ bot, model: { id: "a/b", costLimit: 1, reasoning: "off", thinking: "off", temperature: null, starter: "free", stopAtWhiteout: true } });
    while (run.modelCallsStarted === 0) await Bun.sleep(5);
    run.stop();
    const { record, error } = await run.done;
    expect(error).toBeNull();
    expect(record?.result.endReason).toBe("user stop");
    expect(record?.events.at(-1)).toMatchObject({ type: "model", error: "the request failed: a person stopped the Run" });
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
    expect(run.view.screen && screenHash(run.view.screen)).toBe(alone.screen);
    expect(run.view.state).toMatchObject({ map: { name: alone.record.events.findLast((e) => e.type === "map")?.map } });
  });

  test("a Grid replay of a Run with names boots with these names: it reaches the last screen of the Run, then goes back", async () => {
    const harness = await Harness.open();
    await harness.play({
      ...starter,
      async play(h) {
        h.nameTrainers({ player: "Mira", rival: "Crumb" });
        await starter.play(h);
      },
    });
    const record = harness.record();
    const end = harness.frame;
    const screen = harness.screenHash();
    harness.close();
    const replay = new RunPool(1).replay(record);
    for (const [frame, expected] of [
      [end, screen],
      [700, await screenAt(record, 700)],
    ] as const) {
      replay.seek(frame);
      while (replay.view.frame !== frame && !replay.error) await Bun.sleep(5);
      expect(replay.error).toBeNull();
      expect(replay.view.screen && screenHash(replay.view.screen)).toBe(expected);
    }
    replay.stop();
  });

  test("a Grid replay takes a place; moved to a frame, forward or back, it shows the screen of the replay on the main thread at that frame", async () => {
    const { record } = await playAlone({ frameBudget: 2000 });
    const pool = new RunPool(1);
    const replay = pool.replay(record);
    expect(pool.free).toBe(0);
    for (const frame of [1500, 700]) {
      replay.seek(frame);
      while (replay.view.frame !== frame) await Bun.sleep(5);
      expect(replay.view.screen && screenHash(replay.view.screen)).toBe(await screenAt(record, frame));
    }
    replay.stop();
    expect(pool.free).toBe(1);
  });
});
