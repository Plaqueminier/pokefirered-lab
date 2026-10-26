import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { itemUses } from "./bag";
import { CACHE_DIR } from "./core";
import { Memory } from "./memory";
import { ROM_FILE } from "./run";
import { loadSymbols } from "./symbols";

const ELF_FILE = ROM_FILE.replace(/\.gba$/, ".elf");
const ROM_START = 0x08000000;
const ITEMS = { POKE_BALL: 4, POTION: 13, SUPER_REPEL: 83, MAX_REPEL: 84, ESCAPE_ROPE: 85, REPEL: 86 };

async function romMemory(): Promise<Memory> {
  const rom = new Uint8Array(await Bun.file(ROM_FILE).arrayBuffer());
  const bus = { read: (address: number, length: number) => rom.subarray(address - ROM_START, address - ROM_START + length) };
  return new Memory(bus, await loadSymbols(ELF_FILE, CACHE_DIR));
}

describe.skipIf(!existsSync(ROM_FILE) || !existsSync(ELF_FILE))("the uses of an item", () => {
  test("the REPEL items and ESCAPE ROPE work alone on a walk and not in a battle; POTION works on a Pokémon, POKé BALL only in a battle", async () => {
    const mem = await romMemory();
    for (const item of [ITEMS.REPEL, ITEMS.SUPER_REPEL, ITEMS.MAX_REPEL, ITEMS.ESCAPE_ROPE]) expect(itemUses(mem, item)).toEqual({ battle: null, walk: "alone" });
    expect(itemUses(mem, ITEMS.POTION)).toEqual({ battle: "pokemon", walk: "pokemon" });
    expect(itemUses(mem, ITEMS.POKE_BALL)).toEqual({ battle: "alone", walk: null });
  });
});
