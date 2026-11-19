import { expect } from "bun:test";
import { join } from "node:path";
import { Run, SAVES_DIR } from "../run";
import { Harness } from "./harness";

// The helpers of the tests that play on the real game: they open a Run at a cell of a map, and write flags and vars in its save.
export const PARTY_SAVE = join(SAVES_DIR, "test-party.sav");
export const PALLET_DOOR = { x: 6, y: 7 };
export const VARS_START = 0x4000;

export type WarpTo = { map: string; x: number; y: number };

export function warpPatch(run: Run, first: WarpTo, wild: boolean): { onFrame: () => void; warpTo: (next: WarpTo) => void } {
  let target: WarpTo | null = first;
  const warp = run.game.mem.global("sWarpDestination");
  return {
    warpTo: (next) => {
      target = next;
    },
    onFrame: () => {
      if (!wild) run.core.patch16(run.game.mem.global("sWildEncountersDisabled").addr, 1);
      if (!target) return;
      if (run.game.map().name === target.map) {
        target = null;
        return;
      }
      const group = run.game.allMapNames.findIndex((names) => target !== null && names.includes(target.map));
      run.core.patch16(warp.addr, group | (run.game.allMapNames[group].indexOf(target.map) << 8));
      run.core.patch16(warp.field("warpId").addr, 0xff);
      run.core.patch16(warp.field("x").addr, target.x);
      run.core.patch16(warp.field("y").addr, target.y);
    },
  };
}

/** The Run starts at the door of Pallet Town, and the first `goTo` warps it to the cell. */
export async function openAt(map: string, x: number, y: number, wild = true, before: (run: Run) => void = () => {}): Promise<{ harness: Harness; run: Run; warpTo: (next: WarpTo) => void }> {
  const run = await Run.open({ startSave: PARTY_SAVE });
  const { onFrame, warpTo } = warpPatch(run, { map, x, y }, wild);
  const harness = await Harness.open({ onFrame }, run);
  before(run);
  await harness.goTo(PALLET_DOOR.x, PALLET_DOOR.y);
  expect(harness.observe()).toMatchObject({ map: { name: map }, player: { x, y } });
  return { harness, run, warpTo };
}

export function overworld(harness: Harness) {
  const seen = harness.observe();
  if (seen.mode !== "overworld") throw new Error(`the game waits for a ${seen.waitingFor.kind}`);
  return seen;
}

export function writeFlag(run: Run, flag: number, on: boolean): void {
  const flags = run.game.mem.global("gSaveBlock1Ptr").deref().field("flags");
  const at = flags.addr + (flag >> 3);
  const even = at & ~1;
  const [low, high] = run.core.read(even, 2);
  const bit = 1 << ((flag & 7) + (at === even ? 0 : 8));
  const word = low | (high << 8);
  run.core.patch16(even, on ? word | bit : word & ~bit);
}

export function setFlag(run: Run, flag: number): void {
  writeFlag(run, flag, true);
}

export function writeVar(run: Run, id: number, value: number): void {
  run.core.patch16(run.game.mem.global("gSaveBlock1Ptr").deref().field("vars").at(id - VARS_START).addr, value);
}
