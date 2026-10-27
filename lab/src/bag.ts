import type { Memory, Ref } from "./memory";
import { activeTask, type Decode, oneLine } from "./prompts";
import { functionName } from "./symbols";

const POCKET_NAMES = ["ITEMS", "KEY ITEMS", "POKé BALLS", "TM CASE", "BERRY POUCH"] as const;
const ITEM_NONE = 0;
const MAX_STRING = 256;
const BATTLE_USAGE: Record<number, ItemUse> = { 1: "pokemon", 2: "alone" };
const UNSUPPORTED_BATTLE_FUNCS = new Set(["BattleUseFunc_Ether", "ItemUseInBattle_EnigmaBerry"]);
const WALK_USE_FUNCS: Record<string, ItemUse> = { FieldUseFunc_Medicine: "pokemon", FieldUseFunc_Repel: "alone", ItemUseOutOfBattle_EscapeRope: "alone" };
const ITEM_ANIM_KEY_STATE = 12;
// The pocket of gItems counts from 1 (POCKET_ITEMS); the Bag counts from 0.
const FIRST_ITEM_POCKET = 1;
export const BATTLE_POCKETS = 3;
export const POKE_BALLS_POCKET = POCKET_NAMES.indexOf("POKé BALLS");

type PocketName = (typeof POCKET_NAMES)[number];

export type ItemUse = "pokemon" | "alone";

export type BagItem = { name: string; quantity: number; description: string; price: number; battle: ItemUse | null; walk: ItemUse | null };

export type BagPocket = { pocket: PocketName; items: BagItem[] };

export type BagPlace = { item: number; pocket: number; row: number; price: number } & Pick<BagItem, "battle" | "walk">;

export type BagMenu = { screen: "list" | "context"; pocket: number; row: number; menuCursor: number };

export function readBag(mem: Memory, decode: Decode): BagPocket[] {
  return pocketSlots(mem).flatMap((slots, pocket) => {
    const items = slots.map(({ item, quantity }): BagItem => ({ ...itemInfo(mem, item, decode), quantity }));
    return items.length === 0 ? [] : [{ pocket: POCKET_NAMES[pocket], items }];
  });
}

export function findInBag(mem: Memory, name: string, decode: Decode): BagPlace | null {
  for (const [pocket, slots] of pocketSlots(mem).entries()) {
    const row = slots.findIndex(({ item }) => itemName(mem, item, decode) === name);
    if (row < 0) continue;
    const { item } = slots[row];
    const data = mem.global("gItems").at(item);
    return { item, pocket, row, price: data.field("price").int(), ...itemUses(mem, data) };
  }
  return null;
}

export function bagQuantity(mem: Memory, item: number): number {
  return pocketSlots(mem).flat().find((slot) => slot.item === item)?.quantity ?? 0;
}

export function itemUses(mem: Memory, data: Ref): Pick<BagItem, "battle" | "walk"> {
  if (data.field("pocket").int() - FIRST_ITEM_POCKET >= BATTLE_POCKETS) return { battle: null, walk: null };
  return { battle: itemBattleUse(mem, data), walk: WALK_USE_FUNCS[functionName(mem.symbols, data.field("fieldUseFunc").pointer()) ?? ""] ?? null };
}

function itemBattleUse(mem: Memory, data: Ref): ItemUse | null {
  const use = BATTLE_USAGE[data.field("battleUsage").int()] ?? null;
  return use && !UNSUPPORTED_BATTLE_FUNCS.has(functionName(mem.symbols, data.field("battleUseFunc").pointer()) ?? "") ? use : null;
}

export function battleItems(bag: BagPocket[], kind: "trainer" | "wild"): BagItem[] {
  return bag.flatMap((pocket) => pocket.items.filter((item) => item.battle && (kind === "wild" || pocket.pocket !== "POKé BALLS")));
}

export function walkItems(bag: BagPocket[]): BagItem[] {
  return bag.flatMap((pocket) => pocket.items.filter((item) => item.walk));
}

/** Why the Poké Mart does not buy an item of this pocket (the index of the Bag) and this price, or null when it buys it. */
export function sellRefusal(pocket: number, price: number, item: string): string | null {
  if (pocket >= BATTLE_POCKETS) return "the sale of the TM Case and of the Berry Pouch is not covered yet";
  return price > 0 ? null : `the shop does not buy ${item}`;
}

export function sellableItems(bag: BagPocket[]): BagItem[] {
  return bag.flatMap(({ pocket, items }) => items.filter((item) => sellRefusal(POCKET_NAMES.indexOf(pocket), item.price, item.name) === null));
}

export function bagMenu(mem: Memory): BagMenu | null {
  if (functionName(mem.symbols, mem.global("gMain").field("callback2").pointer()) !== "CB2_BagMenuRun" || mem.global("gPaletteFade").field("active").int()) return null;
  const list = activeTask(mem, "Task_BagMenu_HandleInput") !== null && activeTask(mem, "Task_AnimateWin0v") === null;
  const context = activeTask(mem, "Task_FieldItemContextMenuHandleInput") !== null;
  if (!list && !context) return null;
  const state = mem.global("gBagMenuState");
  const pocket = state.field("pocket").int();
  return {
    screen: list ? "list" : "context",
    pocket,
    row: state.field("cursorPos").at(pocket).int() + state.field("itemsAbove").at(pocket).int(),
    menuCursor: mem.global("sMenu").field("cursorPos").int(),
  };
}

export function itemAnimWaits(mem: Memory): boolean {
  return activeTask(mem, "Task_UseItem_Normal") !== null && mem.global("sPSAWork").deref().field("state").int() === ITEM_ANIM_KEY_STATE;
}

function pocketSlots(mem: Memory): { item: number; quantity: number }[][] {
  const key = mem.global("gSaveBlock2Ptr").deref().field("encryptionKey").int() & 0xffff;
  const pockets = mem.global("gBagPockets");
  return POCKET_NAMES.map((_, i) => {
    const pocket = pockets.at(i);
    const slots = pocket.field("itemSlots");
    return Array.from({ length: pocket.field("capacity").int() }, (_, slot) => slots.at(slot)).flatMap((slot) => {
      const item = slot.field("itemId").int();
      return item === ITEM_NONE ? [] : [{ item, quantity: slot.field("quantity").int() ^ key }];
    });
  });
}

function itemName(mem: Memory, item: number, decode: Decode): string {
  return decode(mem.global("gItems").at(item).field("name").bytes());
}

function itemInfo(mem: Memory, item: number, decode: Decode): Omit<BagItem, "quantity"> {
  const data = mem.global("gItems").at(item);
  const description = oneLine(decode(mem.bus.read(data.field("description").pointer(), MAX_STRING)));
  return { name: itemName(mem, item, decode), description, price: data.field("price").int(), ...itemUses(mem, data) };
}
