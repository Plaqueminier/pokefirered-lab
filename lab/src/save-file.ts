import type { Memory } from "./memory";

const SECTOR_SIZE = 0x1000;
const SECTOR_DATA_SIZE = 3968;
const SECTORS_PER_SLOT = 14;
const SLOTS = 2;
const SECTOR_ID = 0xff4;
const SECTOR_CHECKSUM = 0xff6;
const SECTOR_SIGNATURE = 0xff8;
const SECTOR_COUNTER = 0xffc;
const SIGNATURE = 0x08012025;
const SAVE_BLOCK_2_SECTOR = 0;
const SAVE_BLOCK_1_SECTOR = 1;
const CHAR_EOS = 0xff;

// Decomp PLAYER_NAME_LENGTH and sKeyboardChars.
export const MAX_NAME = 7;
export const NAME_KEYS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789 .,!?♂♀/-…“”‘'";

export type TrainerNames = { player: string; rival: string };

export type SaveLayout = { saveBlock2Size: number; saveBlock1Size: number; player: number; rival: number };

export type EncodedNames = { player: Uint8Array; rival: Uint8Array };

export function nameProblem(name: string): string | null {
  const letters = [...name];
  if (letters.length === 0 || letters.length > MAX_NAME) return `1 to ${MAX_NAME} characters`;
  if (name !== name.trim()) return "no space at the start or the end";
  const missing = letters.find((letter) => !NAME_KEYS.includes(letter));
  return missing ? `the character "${missing}" is not on the keyboard of the game` : null;
}

function sectorBase(at: number): number {
  return at * SECTOR_SIZE;
}

export function hasCompleteSlot(save: Uint8Array): boolean {
  const view = new DataView(save.buffer, save.byteOffset, save.byteLength);
  for (let slot = 0; slot < SLOTS; slot++) {
    const ids = new Set<number>();
    const counters = new Set<number>();
    for (let i = 0; i < SECTORS_PER_SLOT; i++) {
      const base = sectorBase(slot * SECTORS_PER_SLOT + i);
      if (base + SECTOR_SIZE > save.length || view.getUint32(base + SECTOR_SIGNATURE, true) !== SIGNATURE) break;
      ids.add(view.getUint16(base + SECTOR_ID, true));
      counters.add(view.getUint32(base + SECTOR_COUNTER, true));
    }
    if (ids.size === SECTORS_PER_SLOT && counters.size === 1) return true;
  }
  return false;
}

function checksum(view: DataView, base: number, size: number): number {
  let sum = 0;
  for (let i = 0; i < Math.floor(size / 4); i++) sum = (sum + view.getUint32(base + i * 4, true)) >>> 0;
  return ((sum >>> 16) + sum) & 0xffff;
}

function validSectors(view: DataView, id: number, size: number): number[] {
  const bases = Array.from({ length: SLOTS * SECTORS_PER_SLOT }, (_, at) => sectorBase(at));
  return bases.filter((base) => view.getUint32(base + SECTOR_SIGNATURE, true) === SIGNATURE && view.getUint16(base + SECTOR_ID, true) === id && view.getUint16(base + SECTOR_CHECKSUM, true) === checksum(view, base, size));
}

// All slots, so the rule of the game that selects a slot does not matter here.
export function saveWithNames(save: Uint8Array, names: EncodedNames, layout: SaveLayout): Uint8Array {
  const named = save.slice();
  const view = new DataView(named.buffer);
  const chunk = Math.floor(layout.rival / SECTOR_DATA_SIZE);
  const targets = [
    { id: SAVE_BLOCK_2_SECTOR, size: layout.saveBlock2Size, offset: layout.player, bytes: names.player },
    { id: SAVE_BLOCK_1_SECTOR + chunk, size: Math.min(layout.saveBlock1Size - chunk * SECTOR_DATA_SIZE, SECTOR_DATA_SIZE), offset: layout.rival % SECTOR_DATA_SIZE, bytes: names.rival },
  ];
  for (const { id, size, offset, bytes } of targets) {
    const sectors = validSectors(view, id, size);
    if (sectors.length === 0) throw new Error("the save has no valid sector for the names");
    for (const base of sectors) {
      named.set(bytes, base + offset);
      view.setUint16(base + SECTOR_CHECKSUM, checksum(view, base, size), true);
    }
  }
  return named;
}

function encodeName(name: string, size: number, keys: ReadonlyMap<string, number>): Uint8Array {
  const problem = nameProblem(name);
  if (problem) throw new Error(`the name "${name}": ${problem}`);
  const encoded = new Uint8Array(size).fill(CHAR_EOS);
  [...name].forEach((letter, i) => {
    const byte = keys.get(letter);
    if (byte === undefined) throw new Error(`the name "${name}": the ROM has no key "${letter}"`);
    encoded[i] = byte;
  });
  return encoded;
}

export function namedSave(mem: Memory, keys: ReadonlyMap<string, number>, save: Uint8Array, names: TrainerNames): Uint8Array {
  const block2 = mem.global("gSaveBlock2");
  const block1 = mem.global("gSaveBlock1");
  const player = block2.field("playerName");
  const rival = block1.field("rivalName");
  return saveWithNames(
    save,
    { player: encodeName(names.player, player.size, keys), rival: encodeName(names.rival, rival.size, keys) },
    { saveBlock2Size: block2.size, saveBlock1Size: block1.size, player: player.addr - block2.addr, rival: rival.addr - block1.addr },
  );
}
