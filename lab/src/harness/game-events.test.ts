import { describe, expect, setDefaultTimeout, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { ROM_FILE, Run, SAVES_DIR } from "../run";
import { StateWatch } from "./game-events";
import { Harness } from "./harness";

setDefaultTimeout(60_000);

const BAG_SAVE = join(SAVES_DIR, "test-bag.sav");
const MALLOC_SYSTEM_ID = 0xa3a3;
const HEAP_SIZE = 0x1c000;
const MEM_BLOCK_SIZE = 16;
const KEY_CHANGE = 0x20a9;

function bagQuantities(run: Run): number[] {
  const pockets = run.game.mem.global("gBagPockets");
  return Array.from({ length: pockets.length }, (_, i) => pockets.at(i)).flatMap((pocket) => {
    const slots = pocket.field("itemSlots");
    return Array.from({ length: pocket.field("capacity").int() }, (_, slot) => slots.at(slot).field("quantity").addr);
  });
}

describe.skipIf(!existsSync(ROM_FILE) || !existsSync(BAG_SAVE))("the move of the save blocks", () => {
  test("a frame that ends after the new key of the Bag quantities, and before the write of the key, gives no item event", async () => {
    const run = await Run.open({ startSave: BAG_SAVE });
    await Harness.open({}, run);
    const { mem } = run.game;
    const watch = new StateWatch(run.game);
    expect(watch.onFrame("overworld")).toEqual([]);
    expect(watch.onFrame("overworld")).toEqual([]);

    const heap = mem.global("gHeap").addr;
    const header = mem.bus.read(heap, MEM_BLOCK_SIZE).slice();
    run.core.patch16(heap, 0);
    run.core.patch16(heap + 2, MALLOC_SYSTEM_ID);
    run.core.patch32(heap + 4, HEAP_SIZE - MEM_BLOCK_SIZE);
    run.core.patch32(heap + 8, heap);
    run.core.patch32(heap + 12, heap);
    for (const address of bagQuantities(run)) run.core.patch16(address, mem.u16(address) ^ KEY_CHANGE);
    const money = mem.global("gSaveBlock1Ptr").deref().field("money").addr;
    run.core.patch32(money, (mem.u32(money) ^ KEY_CHANGE) >>> 0);
    expect(watch.onFrame("overworld")).toEqual([]);

    const key = mem.global("gSaveBlock2Ptr").deref().field("encryptionKey");
    run.core.patch32(key.addr, (key.int() ^ KEY_CHANGE) >>> 0);
    for (let i = 0; i < MEM_BLOCK_SIZE; i += 2) run.core.patch16(heap + i, header[i] | (header[i + 1] << 8));
    expect(watch.onFrame("overworld")).toEqual([]);
    expect(watch.onFrame("overworld")).toEqual([]);

    const potion = run.game.findInBag("POTION");
    if (!potion) throw new Error("the Bag of the save has no POTION");
    const quantity = mem.global("gBagPockets").at(potion.pocket).field("itemSlots").at(potion.row).field("quantity").addr;
    const newKey = key.int() & 0xffff;
    run.core.patch16(quantity, ((mem.u16(quantity) ^ newKey) + 1) ^ newKey);
    expect(watch.onFrame("overworld")).toEqual([{ type: "item", how: "received", item: "POTION", count: 1 }]);
  });
});
