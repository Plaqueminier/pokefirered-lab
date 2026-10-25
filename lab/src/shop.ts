import type { Memory } from "./memory";
import { activeTask, type Choice, type Decode } from "./prompts";
import { functionName } from "./symbols";

const MAX_MENU_TEXT = 32;
const BUY_QUANTITY = 1;
const SELL_QUANTITY = 8;

export type ShopItem = { name: string; price: number };

export type BuyList = { items: ShopItem[]; row: number };

export function shopMenu(mem: Memory, decode: Decode): Choice | null {
  if (!activeTask(mem, "Task_ShopMenu")) return null;
  const actions = mem.global("sShopMenuActions_BuySellQuit");
  const options = Array.from({ length: actions.length }, (_, i) => decode(mem.bus.read(actions.at(i).field("text").pointer(), MAX_MENU_TEXT)));
  return { options, cursor: mem.global("sMenu").field("cursorPos").int() };
}

export function buyList(mem: Memory, decode: Decode): BuyList | null {
  if (functionName(mem.symbols, mem.global("gMain").field("callback2").pointer()) !== "CB2_BuyMenu") return null;
  if (!activeTask(mem, "Task_BuyMenu") || mem.global("gPaletteFade").field("active").int()) return null;
  const shop = mem.global("sShopData");
  const list = shop.field("itemList").pointer();
  const items = Array.from({ length: shop.field("itemCount").int() }, (_, i) => {
    const data = mem.global("gItems").at(mem.u16(list + 2 * i));
    return { name: decode(data.field("name").bytes()), price: data.field("price").int() };
  });
  return { items, row: shop.field("scrollOffset").int() + shop.field("selectedRow").int() };
}

export function tradeQuantity(mem: Memory): number | null {
  const buy = activeTask(mem, "Task_BuyHowManyDialogueHandleInput");
  if (buy) return buy.field("data").at(BUY_QUANTITY).int();
  const sell = activeTask(mem, "Task_SelectQuantityToSell");
  return sell ? sell.field("data").at(SELL_QUANTITY).int() : null;
}

export function tradeYesNo(mem: Memory): number | null {
  return activeTask(mem, "Task_CallYesOrNoCallback") ? mem.global("sMenu").field("cursorPos").int() : null;
}

export function tradeDone(mem: Memory): boolean {
  return activeTask(mem, "Task_ReturnToItemListAfterItemPurchase") !== null || activeTask(mem, "Task_WaitPressAB_AfterSell") !== null;
}
