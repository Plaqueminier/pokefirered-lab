import { deserialize, serialize } from "bun:jsc";
import { open, rename, rm } from "node:fs/promises";
import { join } from "node:path";
import type { BattleWatchSnapshot } from "../battle";
import type { InventorySnapshot } from "../inventory";
import type { AtlasSnapshot } from "./atlas";
import type { Run } from "../run";
import { type GameWatchSnapshot, originDifferences, type RunRecord, RUNS_DIR } from "./record";

// The shape check finds a new or a removed field only: a field with a new meaning needs a new format.
const CHECKPOINT_FORMAT = 1;

type EmulatorState = { state: Uint8Array; flash: Uint8Array };

export type HarnessState = { game: GameWatchSnapshot; atlas: AtlasSnapshot; battles: BattleWatchSnapshot; rideChosen: boolean };

export type HarnessCheckpoint = { emulator: EmulatorState; harness: HarnessState };

export type Checkpoint = HarnessCheckpoint & { format: number; key: string; inventory: InventorySnapshot };

export type CheckpointRead = { checkpoint: Checkpoint } | { problem: string };

export type Resume = { from: "checkpoint" } | { from: "replay"; problem: string | null } | { from: "live" };

// `bun run migrate` can change the state events of a record, so the key has only the count of the events.
export function checkpointKey({ header, buttons, events }: RunRecord): string {
  const { rom, seed, startSave, names } = header;
  return new Bun.CryptoHasher("sha256").update(JSON.stringify([rom, seed, startSave ?? null, names ?? null, buttons, events.length])).digest("hex");
}

export function checkpointOf(record: RunRecord, { emulator, harness }: HarnessCheckpoint, inventory: InventorySnapshot): Checkpoint {
  return { format: CHECKPOINT_FORMAT, key: checkpointKey(record), emulator, harness, inventory };
}

/** `fresh`: the state of a new Harness of this version, on `run`. */
export function checkpointProblem(checkpoint: Checkpoint, record: RunRecord, run: Run, fresh: HarnessState): string | null {
  if (checkpoint.format !== CHECKPOINT_FORMAT) return "the Checkpoint has another format";
  if (checkpoint.key !== checkpointKey(record)) return "the Checkpoint is for another Run record";
  if (!sameShape(checkpoint.harness, fresh)) return "the Checkpoint keeps the state of another version of the Harness";
  if (originDifferences(run, record).length > 0) return "the Run record does not replay here";
  return null;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && Object.getPrototypeOf(value) === Object.prototype;
}

function sameShape(a: unknown, b: unknown): boolean {
  if (!isPlainObject(a) || !isPlainObject(b)) return true;
  const keys = Object.keys(a);
  if (keys.length !== Object.keys(b).length) return false;
  return keys.every((key) => key in b && sameShape(a[key], b[key]));
}

export function checkpointPath(name: string, dir = RUNS_DIR): string {
  return join(dir, `${name}.checkpoint`);
}

export async function writeCheckpoint(name: string, checkpoint: Checkpoint, dir = RUNS_DIR): Promise<void> {
  const path = checkpointPath(name, dir);
  const file = await open(`${path}.tmp`, "w");
  try {
    await file.writeFile(serialize(checkpoint, { binaryType: "nodebuffer" }));
    await file.sync();
  } finally {
    await file.close();
  }
  await rename(`${path}.tmp`, path);
}

export function removeCheckpoint(name: string, dir = RUNS_DIR): Promise<void> {
  return rm(checkpointPath(name, dir), { force: true });
}

// The parts that the Harness reads before the shape check: the rest of the file is the state of the watches.
function isCheckpoint(value: unknown): value is Checkpoint {
  if (!isPlainObject(value) || typeof value.format !== "number" || typeof value.key !== "string") return false;
  const { emulator, harness, inventory } = value;
  return isPlainObject(emulator) && emulator.state instanceof Uint8Array && emulator.flash instanceof Uint8Array && isPlainObject(harness) && isPlainObject(inventory) && Array.isArray(inventory.entries);
}

/** Null with no file. */
export async function readCheckpoint(name: string, dir = RUNS_DIR): Promise<CheckpointRead | null> {
  const file = Bun.file(checkpointPath(name, dir));
  if (!(await file.exists())) return null;
  try {
    const value: unknown = deserialize(await file.arrayBuffer());
    return isCheckpoint(value) ? { checkpoint: value } : { problem: "the Checkpoint file has no Checkpoint" };
  } catch {
    return { problem: "the Checkpoint file does not read" };
  }
}
