// The menus that the Macro-actions of the party drive: the Start menu and the party menu (start_menu.c, party_menu.c).
import type { Memory } from "./memory";
import { activeTask, type Choice, type Decode } from "./prompts";
import { functionName } from "./symbols";

// PARTY_ACTION_SWITCH (constants/party_menu.h): the party menu waits for the second Pokémon of a swap, in slotId2.
const PARTY_ACTION_SWITCH = 8;
const MAX_MENU_TEXT = 32;

/** The party menu as it is on the screen: it waits for a Pokémon, for an action on the Pokémon, or for A after a text that refuses the action. */
export type PartyMenu = { kind: "pick"; cursor: number; swapping: boolean } | ({ kind: "actions" } & Choice) | { kind: "refusal"; text: string } | { kind: "busy" };

/** The Start menu when it reads the input. */
export function startMenu(mem: Memory, decode: Decode): Choice | null {
  if (!activeTask(mem, "Task_StartMenuHandleInput") || functionName(mem.symbols, mem.global("sStartMenuCallback").pointer()) !== "StartCB_HandleInput") return null;
  const order = mem.global("sStartMenuOrder");
  const items = mem.global("sStartMenuActionTable");
  const options = Array.from({ length: mem.global("sNumStartMenuItems").int() }, (_, i) => menuText(mem, items.at(order.at(i).int()).field("text").pointer(), decode));
  return { options, cursor: mem.global("sStartMenuCursorPos").int() };
}

/** Null when the party menu is not on the screen. */
export function partyMenu(mem: Memory, decode: Decode): PartyMenu | null {
  const callback = functionName(mem.symbols, mem.global("gMain").field("callback2").pointer());
  if (callback !== "CB2_UpdatePartyMenu" && callback !== "CB2_InitPartyMenu") return null;
  // CB2_InitPartyMenu does not run the tasks: the menu reads no input yet.
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
  // CursorCB_SendMon prints in gStringVar4 the reason of TrySwitchInPokemon.
  if (activeTask(mem, "Task_ReturnToChooseMonAfterText")) return { kind: "refusal", text: decode(mem.global("gStringVar4").bytes()).split("\n").join(" ") };
  return { kind: "busy" };
}

function menuText(mem: Memory, address: number, decode: Decode): string {
  return decode(mem.bus.read(address, MAX_MENU_TEXT));
}
