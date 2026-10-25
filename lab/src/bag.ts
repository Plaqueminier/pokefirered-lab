// The Bag: its pockets and items from the save block, the data of the items from gItems, the Bag menu, and the animation of an item on a Pokémon.
import type { Memory } from "./memory";
import { activeTask, type Decode } from "./prompts";
import { functionName } from "./symbols";

// gBagPockets in the order of the POCKET_* constants (constants/item.h), minus one.
const POCKET_NAMES = ["ITEMS", "KEY ITEMS", "POKé BALLS", "TM CASE", "BERRY POUCH"] as const;
const ITEM_NONE = 0;
const MAX_STRING = 256;
// ITEM_B_USE_MEDICINE and ITEM_B_USE_OTHER (item.h): an item that needs a Pokémon of the party, or no target.
const BATTLE_USAGE: Record<number, ItemUse> = { 1: "pokemon", 2: "alone" };
// The Ether opens a move menu after the party menu: no Macro-action covers it yet.
const UNSUPPORTED_BATTLE_FUNCS = new Set(["BattleUseFunc_Ether", "ItemUseInBattle_EnigmaBerry"]);
// On a walk, the Medicine items (Potion, Antidote, Revive...) work on a Pokémon of the party. The other field items open other screens: no Macro-action covers them yet.
const WALK_USE_FUNCS: Record<string, ItemUse> = { FieldUseFunc_Medicine: "pokemon" };
// Task_UseItem_Normal (pokemon_special_anim.c) waits for A or B in state 12, at the end of the animation of an item on a Pokémon.
const ITEM_ANIM_KEY_STATE = 12;
// The Bag menu shows the first three pockets, in a battle and on a walk (ProcessPocketSwitchInput, item_menu.c).
export const BATTLE_POCKETS = 3;

export type PocketName = (typeof POCKET_NAMES)[number];

/** How an item works: on a Pokémon of the party, alone (a Poké Ball, an X item), or not at all (null). */
export type ItemUse = "pokemon" | "alone";

/** `battle`: how the item works in a battle. `walk`: how it works outside a battle. */
export type BagItem = { name: string; quantity: number; description: string; battle: ItemUse | null; walk: ItemUse | null };

export type BagPocket = { pocket: PocketName; items: BagItem[] };

/** Where an item is in the Bag: its pocket and its row in the list of the Bag menu. `price`: the price in a Poké Mart, 0 when the shop does not buy it. */
export type BagPlace = { item: number; pocket: number; row: number; price: number } & Pick<BagItem, "battle" | "walk">;

/** The Bag menu waits for a key: at the list of a pocket, or at the menu USE / CANCEL of an item. */
export type BagMenu = { screen: "list" | "context"; pocket: number; row: number; menuCursor: number };

/** The pockets that have items, with the quantities that the Bag screen shows. */
export function readBag(mem: Memory, decode: Decode): BagPocket[] {
  return pocketSlots(mem).flatMap((slots, pocket) => {
    const items = slots.map(({ item, quantity }): BagItem => ({ ...itemInfo(mem, item, decode, pocket), quantity }));
    return items.length === 0 ? [] : [{ pocket: POCKET_NAMES[pocket], items }];
  });
}

export function findInBag(mem: Memory, name: string, decode: Decode): BagPlace | null {
  for (const [pocket, slots] of pocketSlots(mem).entries()) {
    const row = slots.findIndex(({ item }) => itemName(mem, item, decode) === name);
    if (row < 0) continue;
    const { item } = slots[row];
    return { item, pocket, row, price: mem.global("gItems").at(item).field("price").int(), ...itemUses(mem, item, pocket) };
  }
  return null;
}

export function bagQuantity(mem: Memory, item: number): number {
  return pocketSlots(mem).flat().find((slot) => slot.item === item)?.quantity ?? 0;
}

function itemUses(mem: Memory, item: number, pocket: number): Pick<BagItem, "battle" | "walk"> {
  if (pocket >= BATTLE_POCKETS) return { battle: null, walk: null };
  return { battle: itemBattleUse(mem, item), walk: WALK_USE_FUNCS[functionName(mem.symbols, mem.global("gItems").at(item).field("fieldUseFunc").pointer()) ?? ""] ?? null };
}

function itemBattleUse(mem: Memory, item: number): ItemUse | null {
  const data = mem.global("gItems").at(item);
  const use = BATTLE_USAGE[data.field("battleUsage").int()] ?? null;
  return use && !UNSUPPORTED_BATTLE_FUNCS.has(functionName(mem.symbols, data.field("battleUseFunc").pointer()) ?? "") ? use : null;
}

/** The items that work in a battle now: a Poké Ball only in a wild battle. */
export function battleItems(bag: BagPocket[], kind: "trainer" | "wild"): BagItem[] {
  return bag.flatMap((pocket) => pocket.items.filter((item) => item.battle && (kind === "wild" || pocket.pocket !== "POKé BALLS")));
}

/** The items that work outside a battle. */
export function walkItems(bag: BagPocket[]): BagItem[] {
  return bag.flatMap((pocket) => pocket.items.filter((item) => item.walk));
}

export function bagMenu(mem: Memory): BagMenu | null {
  // CB2_OpenBagMenu makes the tasks of the Bag before its fade starts: the Bag reads keys only in CB2_BagMenuRun.
  if (functionName(mem.symbols, mem.global("gMain").field("callback2").pointer()) !== "CB2_BagMenuRun" || mem.global("gPaletteFade").field("active").int()) return null;
  // Task_AnimateWin0v opens and closes the Bag: the list reads no input while it runs.
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

/** The animation of an item on a Pokémon, after the party menu of a walk, waits for A or B. */
export function itemAnimWaits(mem: Memory): boolean {
  return activeTask(mem, "Task_UseItem_Normal") !== null && mem.global("sPSAWork").deref().field("state").int() === ITEM_ANIM_KEY_STATE;
}

// The pockets keep their items first, in the order of the Bag screen.
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

function itemInfo(mem: Memory, item: number, decode: Decode, pocket: number): Omit<BagItem, "quantity"> {
  const description = decode(mem.bus.read(mem.global("gItems").at(item).field("description").pointer(), MAX_STRING)).split("\n").join(" ");
  return { name: itemName(mem, item, decode), description, ...itemUses(mem, item, pocket) };
}
