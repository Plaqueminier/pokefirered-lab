import type { Memory, Ref } from "./memory";
import { canLearnTmHm, monIds, nameAt, newMove, PARTY_SIZE, type PartyMon, type PartyMove } from "./party";
import { activeTask, type Decode, oneLine } from "./prompts";
import { functionName } from "./symbols";

export const BICYCLE = "BICYCLE";
export const POCKET_NAMES = ["ITEMS", "KEY ITEMS", "POKé BALLS", "TM CASE", "BERRY POUCH"] as const;
const ITEM_NONE = 0;
const MAX_STRING = 256;
const BATTLE_USAGE: Record<number, ItemUse> = { 1: "pokemon", 2: "alone" };
const UNSUPPORTED_BATTLE_FUNCS = new Set(["ItemUseInBattle_EnigmaBerry"]);
const WALK_USE_FUNCS: Record<string, ItemUse> = { FieldUseFunc_Medicine: "pokemon", FieldUseFunc_RareCandy: "pokemon", FieldUseFunc_EvoItem: "pokemon", FieldUseFunc_PpUp: "move", FieldUseFunc_Repel: "alone", ItemUseOutOfBattle_EscapeRope: "alone", FieldUseFunc_Bike: "alone" };
const FIELD_ETHER = "FieldUseFunc_Ether";
const BATTLE_ETHER = "BattleUseFunc_Ether";
const FIELD_STONE = "FieldUseFunc_EvoItem";
// The ETHER and ELIXIR items share their use functions in the game: only this bit of gItemEffectTable, which counts from ITEM_POTION, is different.
const ITEM_POTION = 13;
const ITEM_EFFECT_PP_BYTE = 4;
const ITEM4_HEAL_PP_ONE = 0x10;
const EVO_ITEM = 7;
const HOLD_EFFECT_PREVENT_EVOLVE = 38;
const KANTO_DEX_COUNT = 151;
const ITEM_SCENE_CALLBACKS = new Set(["CB2_PSA", "CB2_EvolutionSceneUpdate"]);
const ITEM_SCENE_TASKS = ["Task_DisplayLevelUpStatsPg1", "Task_DisplayLevelUpStatsPg2", "Task_TryLearnNewMoves", "Task_LearnNextMoveOrClosePartyMenu", "Task_HandleSwitchItemsFromBagYesNoInput"];
// The pocket of gItems counts from 1 (POCKET_ITEMS); the Bag counts from 0.
const FIRST_ITEM_POCKET = 1;
const BATTLE_POCKETS = 3;
export const POKE_BALLS_POCKET = POCKET_NAMES.indexOf("POKé BALLS");
export const ITEMS_POCKET = POCKET_NAMES.indexOf("ITEMS");
export const TM_CASE_POCKET = POCKET_NAMES.indexOf("TM CASE");
export const BERRY_POUCH_POCKET = POCKET_NAMES.indexOf("BERRY POUCH");
const ITEM_TM01 = 289;

export type PocketName = (typeof POCKET_NAMES)[number];

export type ItemUse = "pokemon" | "move" | "alone";

export type Stone = { item: string; evolutions: { slot: number; species: string }[] };

export type BagItem = { name: string; quantity: number; description: string; price: number; battle: ItemUse | null; walk: ItemUse | null; holdable?: true };

export type ItemFacts = Pick<BagItem, "name" | "description" | "price">;

export type BagPocket = { pocket: PocketName; items: BagItem[] };

export type BagPlace = { item: number; pocket: number; row: number; price: number } & Pick<BagItem, "battle" | "walk" | "holdable">;

export type BagMenu = { screen: "list" | "context"; pocket: number; row: number; menuCursor: number };

export type BerryPouchMenu = { screen: "list"; row: number } | { screen: "context"; menuCursor: number };

export type Teachable = { item: string; move: PartyMove; able: number[]; knowing: number[] };

export function readTeachables(mem: Memory, decode: Decode, party: PartyMon[]): Teachable[] {
  return pocketSlots(mem)[TM_CASE_POCKET].map(({ item }) => {
    const tm = item - ITEM_TM01;
    const move = newMove(mem, decode, mem.global("sTMHMMoves").at(tm).int());
    const slots = [...party.keys()].filter((slot) => !party[slot].isEgg);
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

export function berryPouchMenu(mem: Memory): BerryPouchMenu | null {
  if (functionName(mem.symbols, mem.global("gMain").field("callback2").pointer()) !== "CB2_BerryPouchIdle" || mem.global("gPaletteFade").field("active").int()) return null;
  if (activeTask(mem, "Task_NormalContextMenu_HandleInput")) return { screen: "context", menuCursor: mem.global("sMenu").field("cursorPos").int() };
  if (!activeTask(mem, "Task_BerryPouchMain")) return null;
  const list = mem.global("sStaticCnt");
  return { screen: "list", row: list.field("listMenuScrollOffset").int() + list.field("listMenuSelectedRow").int() };
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
    return { item, pocket, row, price: data.field("price").int(), ...itemUses(mem, data), ...holdableOf(data) };
  }
  return null;
}

export function bagQuantity(mem: Memory, item: number): number {
  return pocketSlots(mem).flat().find((slot) => slot.item === item)?.quantity ?? 0;
}

export function itemUses(mem: Memory, data: Ref): Pick<BagItem, "battle" | "walk"> {
  if (data.field("pocket").int() - FIRST_ITEM_POCKET === TM_CASE_POCKET) return { battle: null, walk: null };
  return { battle: itemBattleUse(mem, data), walk: itemWalkUse(mem, data) };
}

function itemWalkUse(mem: Memory, data: Ref): ItemUse | null {
  const func = fieldFunc(mem, data);
  return func === FIELD_ETHER ? etherUse(mem, data) : (WALK_USE_FUNCS[func] ?? null);
}

function itemBattleUse(mem: Memory, data: Ref): ItemUse | null {
  const use = BATTLE_USAGE[data.field("battleUsage").int()] ?? null;
  const func = functionName(mem.symbols, data.field("battleUseFunc").pointer()) ?? "";
  if (func === BATTLE_ETHER) return etherUse(mem, data);
  return use && !UNSUPPORTED_BATTLE_FUNCS.has(func) ? use : null;
}

function etherUse(mem: Memory, data: Ref): ItemUse {
  const effect = mem.global("gItemEffectTable").at(data.field("itemId").int() - ITEM_POTION).pointer();
  return mem.u8(effect + ITEM_EFFECT_PP_BYTE) & ITEM4_HEAL_PP_ONE ? "move" : "pokemon";
}

function fieldFunc(mem: Memory, data: Ref): string {
  return functionName(mem.symbols, data.field("fieldUseFunc").pointer()) ?? "";
}

function holdableOf(data: Ref): Pick<BagItem, "holdable"> {
  return data.field("holdEffect").int() === 0 ? {} : { holdable: true };
}

// The rule of GetEvolutionTargetSpecies with EVO_MODE_ITEM_USE and of MonCanEvolve in the decomp, not the party menu check.
export function readStones(mem: Memory, decode: Decode, nationalDex: boolean): Stone[] {
  const items = mem.global("gItems");
  const stones = pocketSlots(mem)[ITEMS_POCKET].filter(({ item }) => fieldFunc(mem, items.at(item)) === FIELD_STONE);
  return stones.map(({ item }) => ({ item: itemName(mem, item, decode), evolutions: stoneEvolutions(mem, item, decode, nationalDex) }));
}

function stoneEvolutions(mem: Memory, stone: number, decode: Decode, nationalDex: boolean): Stone["evolutions"] {
  return Array.from({ length: Math.min(mem.global("gPlayerPartyCount").int(), PARTY_SIZE) }, (_, slot) => slot).flatMap((slot) => {
    const { species, item, isEgg } = monIds(mem, slot);
    if (isEgg || mem.global("gItems").at(item).field("holdEffect").int() === HOLD_EFFECT_PREVENT_EVOLVE) return [];
    const rows = mem.global("gEvolutionTable").at(species);
    const row = Array.from({ length: rows.length }, (_, i) => rows.at(i)).find((evolution) => evolution.field("method").int() === EVO_ITEM && evolution.field("param").int() === stone);
    const target = row?.field("targetSpecies").int();
    return target === undefined || (target > KANTO_DEX_COUNT && !nationalDex) ? [] : [{ slot, species: nameAt(mem, "gSpeciesNames", target, decode) }];
  });
}

export function battleItems(bag: BagPocket[], kind: "trainer" | "wild"): BagItem[] {
  return bag.flatMap((pocket) => pocket.items.filter((item) => item.battle && (kind === "wild" || pocket.pocket !== "POKé BALLS")));
}

export function walkItems(bag: BagPocket[], stones: Stone[]): BagItem[] {
  const idle = new Set(stones.filter(({ evolutions }) => evolutions.length === 0).map(({ item }) => item));
  return bag.flatMap((pocket) => pocket.items.filter((item) => item.walk && !idle.has(item.name)));
}

export function holdableItems(bag: BagPocket[]): BagItem[] {
  return bag.flatMap((pocket) => pocket.items.filter((item) => item.holdable));
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

export function itemSceneRuns(mem: Memory): boolean {
  return ITEM_SCENE_CALLBACKS.has(functionName(mem.symbols, mem.global("gMain").field("callback2").pointer()) ?? "") || ITEM_SCENE_TASKS.some((task) => activeTask(mem, task));
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
  const data = mem.global("gItems").at(item);
  return { ...itemFacts(mem, item, decode), ...itemUses(mem, data), ...holdableOf(data) };
}
