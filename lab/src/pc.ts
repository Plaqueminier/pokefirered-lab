import type { Memory } from "./memory";
import { activeTask, type Decode } from "./prompts";
import { functionName } from "./symbols";

const ITEM_NONE = 0;
// data[8] of the task is the quantity (item_pc.c, item_menu.c).
const PC_QUANTITY = 8;

export type PcItem = { name: string; quantity: number };

export function itemStorageCursor(mem: Memory): number | null {
  if (!activeTask(mem, "Task_TopMenu_ItemStorageSubmenu_HandleInput") || mem.global("gPaletteFade").field("active").int()) return null;
  return mem.global("sMenu").field("cursorPos").int();
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
