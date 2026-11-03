import type { Memory } from "./memory";
import { activeTask, type Decode } from "./prompts";
import { functionName } from "./symbols";

const ITEM_NONE = 0;
// data[8] of the task is the quantity (item_pc.c, item_menu.c).
const PC_QUANTITY = 8;
const TOTAL_BOXES_COUNT = 14;
export const IN_BOX_COLUMNS = 6;
export const IN_BOX_COUNT = 30;
// Decomp STATE_HANDLE_INPUT of Task_PCMainMenu, in data[0].
const PC_MENU_INPUT_STATE = 2;
// The decomp value of gStorage->state where each task of the storage reads the input.
const MAIN_INPUT_STATE = 0;
const MON_MENU_INPUT_STATE = 2;
const MON_REFUSAL_INPUT_STATE = 6;
const BOX_CHOICE_INPUT_STATE = 1;
const CLOSE_QUESTION_INPUT_STATE = 2;
// The order of the decomp CURSOR_AREA_*.
const CURSOR_AREAS = ["box", "party", "title", "buttons"] as const;

export type PcItem = { name: string; quantity: number };

export type StorageScreen = { screen: "main"; area: (typeof CURSOR_AREAS)[number]; position: number; box: number } | { screen: "monMenu" } | { screen: "monRefusal" } | { screen: "boxChoice"; box: number } | { screen: "closeQuestion" };

export function itemStorageCursor(mem: Memory): number | null {
  if (!activeTask(mem, "Task_TopMenu_ItemStorageSubmenu_HandleInput") || mem.global("gPaletteFade").field("active").int()) return null;
  return mem.global("sMenu").field("cursorPos").int();
}

export function pokemonPcCursor(mem: Memory): number | null {
  const task = activeTask(mem, "Task_PCMainMenu");
  if (task?.field("data").at(0).int() !== PC_MENU_INPUT_STATE || mem.global("gPaletteFade").field("active").int()) return null;
  return mem.global("sMenu").field("cursorPos").int();
}

export function currentBox(mem: Memory): number {
  return mem.global("gPokemonStoragePtr").deref().field("currentBox").int();
}

export function freeBox(mons: readonly { box: number }[], current: number): number | null {
  for (let step = 0; step < TOTAL_BOXES_COUNT; step++) {
    const box = (current + step) % TOTAL_BOXES_COUNT;
    if (mons.filter((mon) => mon.box === box).length < IN_BOX_COUNT) return box;
  }
  return null;
}

export function storageScreen(mem: Memory): StorageScreen | null {
  if (mem.global("gPaletteFade").field("active").int()) return null;
  const inState = (task: string, state: number) => activeTask(mem, task) !== null && mem.global("gStorage").deref().field("state").int() === state;
  if (inState("Task_PokeStorageMain", MAIN_INPUT_STATE)) {
    return { screen: "main", area: CURSOR_AREAS[mem.global("sCursorArea").int()], position: mem.global("sCursorPosition").int(), box: currentBox(mem) };
  }
  if (inState("Task_OnSelectedMon", MON_MENU_INPUT_STATE)) return { screen: "monMenu" };
  if (inState("Task_OnSelectedMon", MON_REFUSAL_INPUT_STATE)) return { screen: "monRefusal" };
  if (inState("Task_DepositMenu", BOX_CHOICE_INPUT_STATE)) return { screen: "boxChoice", box: mem.global("sChooseBoxMenu").deref().field("curBox").int() };
  return inState("Task_OnBPressed", CLOSE_QUESTION_INPUT_STATE) ? { screen: "closeQuestion" } : null;
}

export function pcItems(mem: Memory, decode: Decode): PcItem[] {
  const slots = mem.global("gSaveBlock1Ptr").deref().field("pcItems");
  return Array.from({ length: slots.length }, (_, i) => slots.at(i)).flatMap((slot) => {
    const item = slot.field("itemId").int();
    return item === ITEM_NONE ? [] : [{ name: decode(mem.global("gItems").at(item).field("name").bytes()), quantity: slot.field("quantity").int() }];
  });
}

/** The row of the list of the PC screen: the screen of a withdraw, and the screen that a deposit returns to. */
export function itemPcRow(mem: Memory): number | null {
  if (functionName(mem.symbols, mem.global("gMain").field("callback2").pointer()) !== "ItemPc_MainCB") return null;
  if (!activeTask(mem, "Task_ItemPcMain") || mem.global("gPaletteFade").field("active").int() || activeTask(mem, "Task_PCScreenEffect_TurnOn")) return null;
  const state = mem.global("sListMenuState");
  return state.field("scroll").int() + state.field("row").int();
}

export function withdrawMenuCursor(mem: Memory): number | null {
  return activeTask(mem, "Task_ItemPcSubmenuRun") ? mem.global("sMenu").field("cursorPos").int() : null;
}

export function pcQuantity(mem: Memory): number | null {
  const task = activeTask(mem, "Task_ItemPcHandleWithdrawMultiple") ?? activeTask(mem, "Task_SelectQuantityToDeposit");
  return task ? task.field("data").at(PC_QUANTITY).int() : null;
}

export function pcTransfer(mem: Memory): "done" | "refused" | null {
  if (activeTask(mem, "Task_ItemPcWaitButtonAndFinishWithdrawMultiple") || activeTask(mem, "Task_WaitAB_RedrawAndReturnToBag")) return "done";
  return activeTask(mem, "Task_ItemPcWaitButtonWithdrawMultipleFailed") || activeTask(mem, "Task_WaitAButtonAndCloseContextMenu") ? "refused" : null;
}
