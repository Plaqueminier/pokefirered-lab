import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { CACHE_DIR } from "./core";
import { Memory } from "./memory";
import { nameAt, readWatchedParty } from "./party";
import { ROM_FILE } from "./run";
import { loadSymbols } from "./symbols";

const ELF_FILE = ROM_FILE.replace(/\.gba$/, ".elf");
const ROM_START = 0x08000000;
const RAM_START = 0x02000000;
const RAM_SIZE = 0x01010000; // EWRAM and IWRAM (0x03000000)
const SPECIES_BULBASAUR = 1;
const PERSONALITY = 24; // The order of the substructs is growth, attacks, EVs, misc.
const OT_ID = 0x1234abcd;

const decode = (bytes: Uint8Array) => bytes.join(",");

describe.skipIf(!existsSync(ROM_FILE) || !existsSync(ELF_FILE))("the party of the Game events", () => {
  test("a box that the game decrypts in place has a bad checksum: the read gives no party", async () => {
    const rom = new Uint8Array(await Bun.file(ROM_FILE).arrayBuffer());
    const ram = new Uint8Array(RAM_SIZE);
    const read = (memory: Uint8Array, start: number) => (address: number, length: number) => memory.subarray(address - start, address - start + length);
    const bus = { read: (address: number, length: number) => (address >= ROM_START ? read(rom, ROM_START) : read(ram, RAM_START))(address, length) };
    const mem = new Memory(bus, await loadSymbols(ELF_FILE, CACHE_DIR));
    const view = new DataView(ram.buffer);
    const at = (address: number) => address - RAM_START;
    view.setUint8(at(mem.global("gPlayerPartyCount").addr), 1);
    const box = mem.global("gPlayerParty").at(0).field("box");
    const secure = at(box.field("secure").addr);
    view.setUint32(at(box.field("personality").addr), PERSONALITY, true);
    view.setUint32(at(box.field("otId").addr), OT_ID, true);
    view.setUint16(secure, SPECIES_BULBASAUR, true);
    view.setUint16(at(box.field("checksum").addr), SPECIES_BULBASAUR, true);
    const plain = ram.slice(secure, secure + 48);
    for (let offset = 0; offset < 48; offset += 4) view.setUint32(secure + offset, (view.getUint32(secure + offset, true) ^ PERSONALITY ^ OT_ID) >>> 0, true);

    expect(readWatchedParty(mem, decode, "player")?.map((mon) => mon.species)).toEqual([nameAt(mem, "gSpeciesNames", SPECIES_BULBASAUR, decode)]);
    ram.set(plain, secure);
    expect(readWatchedParty(mem, decode, "player")).toBeNull();
  });
});
