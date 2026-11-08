import type { Memory, Ref } from "./memory";
import { canLearnTmHm, newMove, type PartyMon, type PartyMove } from "./party";
import { activeTask, type Decode, oneLine } from "./prompts";
import { functionName } from "./symbols";

export const BICYCLE = "BICYCLE";
export const POCKET_NAMES = ["ITEMS", "KEY ITEMS", "POKé BALLS", "TM CASE", "BERRY POUCH"] as const;
const ITEM_NONE = 0;
const MAX_STRING = 256;
const BATTLE_USAGE: Record<number, ItemUse> = { 1: "pokemon", 2: "alone" };
const UNSUPPORTED_BATTLE_FUNCS = new Set(["BattleUseFunc_Ether", "ItemUseInBattle_EnigmaBerry"]);
const WALK_USE_FUNCS: Record<string, ItemUse> = { FieldUseFunc_Medicine: "pokemon", FieldUseFunc_Repel: "alone", ItemUseOutOfBattle_EscapeRope: "alone", FieldUseFunc_Bike: "alone" };
const ITEM_ANIM_KEY_STATE = 12;
// The pocket of gItems counts from 1 (POCKET_ITEMS); the Bag counts from 0.
const FIRST_ITEM_POCKET = 1;
export const BATTLE_POCKETS = 3;
export const POKE_BALLS_POCKET = POCKET_NAMES.indexOf("POKé BALLS");
export const ITEMS_POCKET = POCKET_NAMES.indexOf("ITEMS");
const TM_CASE_POCKET = POCKET_NAMES.indexOf("TM CASE");
const ITEM_TM01 = 289;

export type PocketName = (typeof POCKET_NAMES)[number];

export type ItemUse = "pokemon" | "alone";

export type BagItem = { name: string; quantity: number; description: string; price: number; battle: ItemUse | null; walk: ItemUse | null };

export type ItemFacts = Pick<BagItem, "name" | "description" | "price">;

export type BagPocket = { pocket: PocketName; items: BagItem[] };

export type BagPlace = { item: number; pocket: number; row: number; price: number } & Pick<BagItem, "battle" | "walk">;

export type BagMenu = { screen: "list" | "context"; pocket: number; row: number; menuCursor: number };

export type Teachable = { item: string; move: PartyMove; able: number[]; knowing: number[] };

export function readTeachables(mem: Memory, decode: Decode, party: PartyMon[]): Teachable[] {
  return pocketSlots(mem)[TM_CASE_POCKET].map(({ item }) => {
    const tm = item - ITEM_TM01;
    const move = newMove(mem, decode, mem.global("sTMHMMoves").at(tm).int());
    const slots = [...party.keys()];
    const knowing = slots.filter((slot) => party[slot].moves.some((known) => known.name === move.name));
    return { item: itemName(mem, item, decode), move, able: slots.filter((slot) => !knowing.includes(slot) && canLearnTmHm(mem, slot, tm)), knowing };
  });
}

export function tmCaseRow(mem: Memory): number | null {
  if (functionName(mem.symbols, mem.global("gMain").field("callback2").pointer()) !== "CB2_Idle" || mem.global("gPaletteFade").field("active").int() || !activeTask(mem, "Task_HandleListInput")) return null;
  const list = mem.global("sTMCaseStaticResources");
  return list.field("scrollOffset").int() + list.field("selectedRow").int();
}

export function tmCaseItemMenu(mem: Memory): boolean {
  return activeTask(mem, "Task_ContextMenu_HandleInput") !== null;
}

export function readBag(mem: Memory, decode: Decode): BagPocket[] {
  return pocketSlots(mem).flatMap((slots, pocket) => {
    const items = slots.map(({ item, quantity }): BagItem => ({ ...itemWithUses(mem, item, decode), quantity }));
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

export function depositableItems(bag: BagPocket[]): BagItem[] {
  return bag.find(({ pocket }) => pocket === POCKET_NAMES[ITEMS_POCKET])?.items ?? [];
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

export function itemFacts(mem: Memory, item: number, decode: Decode): ItemFacts {
  const data = mem.global("gItems").at(item);
  return { name: itemName(mem, item, decode), description: oneLine(decode(mem.bus.read(data.field("description").pointer(), MAX_STRING))), price: data.field("price").int() };
}

function itemWithUses(mem: Memory, item: number, decode: Decode): Omit<BagItem, "quantity"> {
  return { ...itemFacts(mem, item, decode), ...itemUses(mem, mem.global("gItems").at(item)) };
}
