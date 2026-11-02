import { describe, expect, test } from "bun:test";
import { hasCompleteSlot, type SaveLayout, saveWithNames } from "./save-file";

const SECTOR = 0x1000;
const DATA = 3968;
const SECTORS_PER_SLOT = 14;
const SIGNATURE = 0x08012025;
const LAYOUT: SaveLayout = { saveBlock2Size: 100, saveBlock1Size: DATA * 3 + 40, player: 8, rival: DATA * 3 + 16 };
const NAMES = { player: Uint8Array.of(1, 2, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff), rival: Uint8Array.of(3, 4, 5, 0xff, 0xff, 0xff, 0xff, 0xff) };

function checksum(save: Uint8Array, base: number, size: number): number {
  const view = new DataView(save.buffer);
  let sum = 0;
  for (let i = 0; i < Math.floor(size / 4); i++) sum = (sum + view.getUint32(base + i * 4, true)) >>> 0;
  return ((sum >>> 16) + sum) & 0xffff;
}

function sizeOf(id: number): number {
  if (id === 0) return LAYOUT.saveBlock2Size;
  return id <= 4 ? Math.max(0, Math.min(LAYOUT.saveBlock1Size - (id - 1) * DATA, DATA)) : DATA;
}

function sector(slot: number, place: number): number {
  return (slot * SECTORS_PER_SLOT + place) * SECTOR;
}

function makeSave(counters: [number, number], rotation = 0): Uint8Array {
  const save = new Uint8Array(SECTOR * 32).fill(0x11);
  const view = new DataView(save.buffer);
  for (const slot of [0, 1]) {
    for (let place = 0; place < SECTORS_PER_SLOT; place++) {
      const base = sector(slot, place);
      const id = (place + rotation) % SECTORS_PER_SLOT;
      view.setUint16(base + 0xff4, id, true);
      view.setUint16(base + 0xff6, checksum(save, base, sizeOf(id)), true);
      view.setUint32(base + 0xff8, SIGNATURE, true);
      view.setUint32(base + 0xffc, counters[slot], true);
    }
  }
  return save;
}

function placeOf(save: Uint8Array, slot: number, id: number): number {
  const view = new DataView(save.buffer);
  for (let place = 0; place < SECTORS_PER_SLOT; place++) if (view.getUint16(sector(slot, place) + 0xff4, true) === id) return sector(slot, place);
  throw new Error(`no sector ${id}`);
}

function expectValid(save: Uint8Array, slot: number): void {
  const view = new DataView(save.buffer);
  for (let place = 0; place < SECTORS_PER_SLOT; place++) {
    const base = sector(slot, place);
    expect(view.getUint16(base + 0xff6, true)).toBe(checksum(save, base, sizeOf(view.getUint16(base + 0xff4, true))));
  }
}

describe("saveWithNames", () => {
  test("it writes the player in SaveBlock2 and the rival in its sector of SaveBlock1, in each slot, and each checksum stays right", () => {
    const save = makeSave([4, 5]);
    const named = saveWithNames(save, NAMES, LAYOUT);
    for (const slot of [0, 1]) {
      expect([...named.subarray(placeOf(named, slot, 0) + 8, placeOf(named, slot, 0) + 16)]).toEqual([...NAMES.player]);
      expect([...named.subarray(placeOf(named, slot, 4) + 16, placeOf(named, slot, 4) + 24)]).toEqual([...NAMES.rival]);
      expectValid(named, slot);
    }
  });

  test("it finds the sectors by their ids, and it does not change the save that it gets", () => {
    const save = makeSave([4, 5], 3);
    const copy = save.slice();
    const named = saveWithNames(save, NAMES, LAYOUT);
    expect(save).toEqual(copy);
    expect(named[placeOf(named, 1, 0) + 8]).toBe(1);
    expect(named[placeOf(named, 1, 4) + 16]).toBe(3);
    expectValid(named, 1);
  });

  test("a slot with a wrong checksum stays as it is, because the game does not load it", () => {
    const save = makeSave([4, 5]);
    save[sector(0, 0)] ^= 0xff;
    const named = saveWithNames(save, NAMES, LAYOUT);
    expect(named[sector(0, 0) + 8]).toBe(0x11);
    expect(named[sector(1, 0) + 8]).toBe(1);
  });

  test("a save with no sector for a name is an error, not a Run with the wrong names", () => {
    expect(() => saveWithNames(new Uint8Array(SECTOR * 32), NAMES, LAYOUT)).toThrow("the save has no valid sector for the names");
  });
});

test("hasCompleteSlot needs one slot with all its sectors and one counter", () => {
  expect(hasCompleteSlot(makeSave([4, 5]))).toBe(true);
  expect(hasCompleteSlot(new Uint8Array(SECTOR * 32))).toBe(false);
});
