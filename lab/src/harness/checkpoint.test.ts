import { describe, expect, setDefaultTimeout, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdtemp, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { InventoryHistory } from "../inventory";
import { ROM_FILE, START_SAVE } from "../run";
import { type Checkpoint, type CheckpointRead, checkpointOf, checkpointPath, readCheckpoint, writeCheckpoint } from "./checkpoint";
import { type Bot, Harness, must, type Observation } from "./harness";
import type { RunRecord } from "./record";
import starter from "./scripted-bot";

const ready = existsSync(ROM_FILE) && existsSync(START_SAVE);

setDefaultTimeout(120_000);

const NO_INVENTORY = new InventoryHistory().snapshot();

// The audio state in serialize.h of mGBA: after a load, it drifts from a played state, and the game does not read it.
const AUDIO_BYTES: readonly [number, number][] = [
  [0x130, 0x1f0],
  [0x370, 0x3d0],
];

function sameGameState(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i] && !AUDIO_BYTES.some(([start, end]) => i >= start && i < end)) return false;
  return true;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && Object.getPrototypeOf(value) === Object.prototype;
}

function differentPaths(a: unknown, b: unknown, path: string): string[] {
  if (isPlainObject(a) && isPlainObject(b)) return [...new Set([...Object.keys(a), ...Object.keys(b)])].flatMap((key) => differentPaths(a[key], b[key], `${path}.${key}`));
  return Bun.deepEquals(a, b) ? [] : [path];
}

/** The parts of two Checkpoints that are not the same, for example `harness.atlas.visits`. */
function checkpointDifferences(a: Checkpoint, b: Checkpoint): string[] {
  return [
    ...(a.key === b.key ? [] : ["key"]),
    ...(sameGameState(a.emulator.state, b.emulator.state) ? [] : ["emulator.state"]),
    ...(Bun.deepEquals(a.emulator.flash, b.emulator.flash) ? [] : ["emulator.flash"]),
    ...differentPaths(a.harness, b.harness, "harness"),
    ...(Bun.deepEquals(a.inventory, b.inventory) ? [] : ["inventory"]),
  ];
}

const finisher: Bot = {
  name: "finisher",
  version: "1",
  async play(h) {
    for (;;) {
      const { waitingFor } = h.observe();
      if (waitingFor.kind === "walk") return;
      must(waitingFor.kind === "battleAction" ? await h.fight(0) : await h.readText());
    }
  },
};

function withoutAtlas({ atlas: _, ...observed }: Observation): Omit<Observation, "atlas"> {
  return observed;
}

async function inBattle(): Promise<{ record: RunRecord; checkpoint: Checkpoint }> {
  let stop = false;
  const harness = await Harness.open({
    stopAsked: () => stop,
    onAction: ({ action }) => {
      if (action.name === "fight") stop = true;
    },
  });
  try {
    await harness.play(starter);
    const record = harness.record();
    return { record, checkpoint: checkpointOf(record, harness.checkpoint(), NO_INVENTORY) };
  } finally {
    harness.close();
  }
}

describe.skipIf(!ready)("checkpoint of a Run", () => {
  test("a Run that resumes from the checkpoint of its parent, in a battle, has the state of the checkpoint, and then plays the Run record of a full replay", async () => {
    const { record, checkpoint } = await inBattle();
    expect(record.result.endReason).toBe("user stop");
    expect(record.events.findLast((e) => e.type === "battle")).toMatchObject({ state: "start" });
    const dir = await mkdtemp(join(tmpdir(), "runs-"));
    await writeCheckpoint("parent.json", checkpoint, dir);
    expect(await readdir(dir)).toEqual(["parent.json.checkpoint"]);
    const read = await readCheckpoint("parent.json", dir);
    const parent = { name: "parent.json", record };
    const replayed = await Harness.open({ parent });
    const resumed = await Harness.open({ parent, checkpoint: read ?? undefined });
    try {
      expect(replayed.resumed).toEqual({ from: "replay", problem: null });
      expect(resumed.resumed).toEqual({ from: "checkpoint" });
      expect(resumed.frame).toBe(replayed.frame);
      expect(checkpointDifferences(checkpointOf(record, resumed.checkpoint(), NO_INVENTORY), checkpoint)).toEqual([]);
      const observed = withoutAtlas(resumed.observe());
      expect(observed).toMatchObject({ mode: "battle", waitingFor: { kind: "text" } });
      expect(observed).toEqual(withoutAtlas(replayed.observe()));
      await replayed.play(finisher);
      await resumed.play(finisher);
      const played = replayed.record();
      expect(played.events.findLast((e) => e.type === "battle")).toMatchObject({ state: "end" });
      expect(resumed.record()).toEqual(played);
    } finally {
      replayed.close();
      resumed.close();
    }
  });

  test("nextPart plays one more part in the Harness of the Run; a Run that resumes from its checkpoint plays the same Run record and ends with the same state", async () => {
    let stop: boolean | null = false;
    const live = await Harness.open({
      stopAsked: () => stop === true,
      onAction: ({ action }) => {
        if (stop === false && action.name === "fight") stop = true;
      },
    });
    const start = live.frame;
    try {
      await live.play(starter);
      const record = live.record();
      const checkpoint = checkpointOf(record, live.checkpoint(), NO_INVENTORY);
      const parentEnd = live.frame;
      stop = null;
      live.nextPart();
      const result = await live.play(finisher);
      expect(result).toMatchObject({ endReason: "bot stopped", frames: live.frame - start, rawInputs: 0 });
      const played = live.record();
      expect(played.header.bot).toEqual({ name: "finisher", version: "1" });
      expect(played.events.slice(0, record.events.length)).toEqual(record.events);
      const resumed = await Harness.open({ parent: { name: "parent.json", record }, checkpoint: { checkpoint } });
      try {
        await resumed.play(finisher);
        expect(resumed.record()).toEqual({ ...played, header: { ...played.header, parent: "parent.json", runStart: parentEnd } });
        expect(checkpointDifferences(checkpointOf(played, resumed.checkpoint(), NO_INVENTORY), checkpointOf(played, live.checkpoint(), NO_INVENTORY))).toEqual([]);
      } finally {
        resumed.close();
      }
    } finally {
      live.close();
    }
  });

  test("a bad checkpoint gives a full replay and the reason: another Run record, another shape, another format, a short savestate, a state that does not load, or a file that does not read", async () => {
    const { record, checkpoint } = await inBattle();
    const shorter: RunRecord = { ...record, events: record.events.slice(0, -1) };
    const otherShape = { ...checkpoint.harness, game: { ...checkpoint.harness.game, removed: 1 } };
    const dir = await mkdtemp(join(tmpdir(), "runs-"));
    expect(await readCheckpoint("parent.json", dir)).toBeNull();
    await Bun.write(checkpointPath("parent.json", dir), "not a checkpoint");
    expect(await readCheckpoint("parent.json", dir)).toEqual({ problem: "the Checkpoint file does not read" });
    const bad = (changed: Partial<Checkpoint>): CheckpointRead => ({ checkpoint: { ...checkpoint, ...changed } });
    const cases: [CheckpointRead, string][] = [
      [{ problem: "the Checkpoint file does not read" }, "the Checkpoint file does not read"],
      [{ checkpoint: checkpointOf(shorter, checkpoint, NO_INVENTORY) }, "the Checkpoint is for another Run record"],
      [bad({ harness: otherShape }), "the Checkpoint keeps the state of another version of the Harness"],
      [bad({ format: checkpoint.format + 1 }), "the Checkpoint has another format"],
      [bad({ emulator: { ...checkpoint.emulator, state: checkpoint.emulator.state.slice(0, 100) } }), "the Checkpoint does not load: the emulator does not load the savestate"],
      // A file of another version can hold a value that the restore does not take.
      [bad({ harness: { ...checkpoint.harness, game: { ...checkpoint.harness.game, stateTrack: JSON.parse("null") } } }), expect.stringMatching(/^the Checkpoint does not load: /)],
    ];
    for (const [read, problem] of cases) {
      const harness = await Harness.open({ parent: { name: "parent.json", record }, checkpoint: read });
      try {
        expect(harness.resumed).toEqual({ from: "replay", problem });
        expect(harness.frame).toBe(record.buttons.reduce((frames, [, count]) => frames + count, 0));
      } finally {
        harness.close();
      }
    }
  });
});
