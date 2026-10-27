// The item PC of the player's PC: the menu WITHDRAW ITEM, DEPOSIT ITEM, CANCEL, the items of the PC, the withdraw list,
// and the quantity box and the end of a withdraw or a deposit.
import type { Memory } from "./memory";
import { activeTask, type Decode } from "./prompts";
import { functionName } from "./symbols";

const ITEM_NONE = 0;
// data[8] of the task holds the quantity in the withdraw box (item_pc.c) and in the deposit box (item_menu.c).
const PC_QUANTITY = 8;

export type PcItem = { name: string; quantity: number };

/** The cursor of the item PC menu: 0 WITHDRAW ITEM, 1 DEPOSIT ITEM, 2 CANCEL. */
export function itemStorageCursor(mem: Memory): number | null {
  if (!activeTask(mem, "Task_TopMenu_ItemStorageSubmenu_HandleInput") || mem.global("gPaletteFade").field("active").int()) return null;
  return mem.global("sMenu").field("cursorPos").int();
}

/** The items in the PC, in the order of the withdraw list. The game keeps no key for the PC quantities (GetPcItemQuantity). */
export function pcItems(mem: Memory, decode: Decode): PcItem[] {
  const slots = mem.global("gSaveBlock1Ptr").deref().field("pcItems");
  return Array.from({ length: slots.length }, (_, i) => slots.at(i)).flatMap((slot) => {
    const item = slot.field("itemId").int();
    return item === ITEM_NONE ? [] : [{ name: decode(mem.global("gItems").at(item).field("name").bytes()), quantity: slot.field("quantity").int() }];
  });
}

/** The row of the cursor in the withdraw list, when the list reads the keys. The task of the list exists before the end of the setup of the screen. */
export function withdrawRow(mem: Memory): number | null {
  if (functionName(mem.symbols, mem.global("gMain").field("callback2").pointer()) !== "ItemPc_MainCB") return null;
  if (!activeTask(mem, "Task_ItemPcMain") || mem.global("gPaletteFade").field("active").int() || activeTask(mem, "Task_PCScreenEffect_TurnOn")) return null;
  const state = mem.global("sListMenuState");
  return state.field("scroll").int() + state.field("row").int();
}

/** The cursor of the menu of an item in the withdraw list: 0 WITHDRAW, 1 GIVE, 2 CANCEL. */
export function withdrawMenuCursor(mem: Memory): number | null {
  return activeTask(mem, "Task_ItemPcSubmenuRun") ? mem.global("sMenu").field("cursorPos").int() : null;
}

export function pcQuantity(mem: Memory): number | null {
  const task = activeTask(mem, "Task_ItemPcHandleWithdrawMultiple") ?? activeTask(mem, "Task_SelectQuantityToDeposit");
  return task ? task.field("data").at(PC_QUANTITY).int() : null;
}

/** The end of a withdraw or of a deposit: "done", or "refused" when the Bag or the PC has no room. */
export function pcTransfer(mem: Memory): "done" | "refused" | null {
  if (activeTask(mem, "Task_ItemPcWaitButtonAndFinishWithdrawMultiple") || activeTask(mem, "Task_WaitAB_RedrawAndReturnToBag")) return "done";
  return activeTask(mem, "Task_ItemPcWaitButtonWithdrawMultipleFailed") || activeTask(mem, "Task_WaitAButtonAndCloseContextMenu") ? "refused" : null;
}
