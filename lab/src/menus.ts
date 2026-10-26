import type { Memory } from "./memory";
import { activeTask, type Choice, type Decode, oneLine } from "./prompts";
import { functionName } from "./symbols";

const PARTY_ACTION_SWITCH = 8;
const MAX_MENU_TEXT = 32;
// tMultichoiceId (script_menu.c).
const MULTICHOICE_ID = 7;
const START_MENU_INPUT_STEP = 1;

export type PartyMenu = { kind: "pick"; cursor: number; swapping: boolean } | ({ kind: "actions" } & Choice) | { kind: "refusal"; text: string } | { kind: "busy" };

// Task_StartMenuHandleInput reads input only at step 1; sStartMenuCallback keeps the callback of the last Start menu.
export function startMenu(mem: Memory, decode: Decode): Choice | null {
  const task = activeTask(mem, "Task_StartMenuHandleInput");
  if (task?.field("data").at(0).int() !== START_MENU_INPUT_STEP || functionName(mem.symbols, mem.global("sStartMenuCallback").pointer()) !== "StartCB_HandleInput") return null;
  const order = mem.global("sStartMenuOrder");
  const items = mem.global("sStartMenuActionTable");
  const options = Array.from({ length: mem.global("sNumStartMenuItems").int() }, (_, i) => menuText(mem, items.at(order.at(i).int()).field("text").pointer(), decode));
  return { options, cursor: mem.global("sStartMenuCursorPos").int() };
}

// Task_MultichoiceMenu_HandleInput reads no input while sDelay counts down or the palette fades.
export function multichoice(mem: Memory, decode: Decode): Choice | null {
  const task = activeTask(mem, "Task_MultichoiceMenu_HandleInput");
  if (!task || mem.global("sDelay").int() !== 0 || mem.global("gPaletteFade").field("active").int()) return null;
  const menu = mem.global("sMultichoiceLists").at(task.field("data").at(MULTICHOICE_ID).int());
  const list = menu.field("list");
  const options = Array.from({ length: menu.field("count").int() }, (_, i) => menuText(mem, list.at(i).field("text").pointer(), decode));
  return { options, cursor: mem.global("sMenu").field("cursorPos").int() };
}

export function partyMenu(mem: Memory, decode: Decode): PartyMenu | null {
  const callback = functionName(mem.symbols, mem.global("gMain").field("callback2").pointer());
  if (callback !== "CB2_UpdatePartyMenu" && callback !== "CB2_InitPartyMenu") return null;
  if (callback === "CB2_InitPartyMenu" || mem.global("gPaletteFade").field("active").int()) return { kind: "busy" };
  const menu = mem.global("gPartyMenu");
  if (activeTask(mem, "Task_HandleChooseMonInput")) {
    const swapping = menu.field("action").int() === PARTY_ACTION_SWITCH;
    return { kind: "pick", cursor: menu.field(swapping ? "slotId2" : "slotId").int(), swapping };
  }
  if (activeTask(mem, "Task_HandleSelectionMenuInput")) {
    const internal = mem.global("sPartyMenuInternal").deref();
    const options = mem.global("sCursorOptions");
    const actions = internal.field("actions");
    return {
      kind: "actions",
      options: Array.from({ length: internal.field("numActions").int() }, (_, i) => menuText(mem, options.at(actions.at(i).int()).field("text").pointer(), decode)),
      cursor: mem.global("sMenu").field("cursorPos").int(),
    };
  }
  if (activeTask(mem, "Task_ReturnToChooseMonAfterText")) return { kind: "refusal", text: oneLine(decode(mem.global("gStringVar4").bytes())) };
  return { kind: "busy" };
}

function menuText(mem: Memory, address: number, decode: Decode): string {
  return decode(mem.bus.read(address, MAX_MENU_TEXT));
}
