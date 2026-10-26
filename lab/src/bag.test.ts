import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { itemUses } from "./bag";
import { CACHE_DIR } from "./core";
import { Memory } from "./memory";
import { ROM_FILE } from "./run";
import { loadSymbols } from "./symbols";

const ELF_FILE = ROM_FILE.replace(/\.gba$/, ".elf");
const ROM_START = 0x08000000;
const WALK_ITEMS = [83, 84, 85, 86]; // SUPER REPEL, MAX REPEL, ESCAPE ROPE, REPEL

async function romMemory(): Promise<Memory> {
  const rom = new Uint8Array(await Bun.file(ROM_FILE).arrayBuffer());
  const bus = { read: (address: number, length: number) => rom.subarray(address - ROM_START, address - ROM_START + length) };
  return new Memory(bus, await loadSymbols(ELF_FILE, CACHE_DIR));
}

describe.skipIf(!existsSync(ROM_FILE) || !existsSync(ELF_FILE))("the uses of an item", () => {
  test("the REPEL items and ESCAPE ROPE work alone on a walk and not in a battle", async () => {
    const mem = await romMemory();
    for (const item of WALK_ITEMS) expect(itemUses(mem, mem.global("gItems").at(item))).toEqual({ battle: null, walk: "alone" });
  });
});
