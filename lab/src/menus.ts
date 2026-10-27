import type { Memory } from "./memory";
import { nameAt } from "./party";
import { activeTask, type Choice, type Decode, oneLine } from "./prompts";
import { functionName } from "./symbols";

const PARTY_ACTION_SWITCH = 8;
const MAX_MENU_TEXT = 32;
// tMultichoiceId (script_menu.c).
const MULTICHOICE_ID = 7;
const MULTICHOICE_NONE = 255;
// While the script waits, the id of the special is the u16 3 bytes before the script pointer.
const SPECIAL_ID_OFFSET = 3;
const FLAG_SYS_POKEDEX_GET = 0x829;
const FLAG_SYS_GAME_CLEAR = 0x82c;
const FLAG_SYS_NOT_SOMEONES_PC = 0x834;
// The script pointer is past the command multichoicegrid: the id of the menu is the third of its five bytes, so it is 3 bytes before the pointer.
const GRID_MULTICHOICE_ID_OFFSET = 3;
// The enum in script.c is RUNNING, WAITING, SHUTDOWN.
const SCRIPT_CONTEXT_WAITING = 1;
export const SCRIPT_CONTEXT_SHUTDOWN = 2;
const START_MENU_INPUT_STEP = 1;
// NAMING_SCREEN_* of the game. The two Pokémon templates (2 and 3) are not here: they name a Pokémon by its species.
const NAMING_SUBJECTS = new Map([
  [0, "the name of the player"],
  [1, "the name of a PC box"],
  [4, "the name of the rival"],
]);
// Decomp STATE_HANDLE_INPUT of Task_NamingScreen: the only state that reads the keys.
const NAMING_INPUT_STATE = 2;
const NAMING_PAGES = 3;

/** `keys` are the rows of the page that the screen shows, one text for each row; `characters` are the characters of all the pages, each one once. */
export type NamingScreen = {
  subject: string;
  maxLength: number;
  ready: boolean;
  page: number;
  keys: string[];
  columns: number;
  characters: () => string[];
  cursor: { x: number; y: number };
  text: string;
};

export type GridChoice = Choice & { columns: number };

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
export function multichoice(mem: Memory, decode: Decode, flag: (id: number) => boolean): Choice | null {
  const task = activeTask(mem, "Task_MultichoiceMenu_HandleInput");
  if (!task || mem.global("sDelay").int() !== 0 || mem.global("gPaletteFade").field("active").int()) return null;
  const id = task.field("data").at(MULTICHOICE_ID).int();
  const options = id !== MULTICHOICE_NONE ? multichoiceOptions(mem, id, decode) : pcMenuSpecial(mem) ? pcMenuOptions(mem, decode, flag) : null;
  return options && { options, cursor: mem.global("sMenu").field("cursorPos").int() };
}

function pcMenuSpecial(mem: Memory): boolean {
  const special = mem.u16(mem.global("sGlobalScriptContext").field("scriptPtr").pointer() - SPECIAL_ID_OFFSET);
  return functionName(mem.symbols, mem.global("gSpecials").at(special).pointer()) === "CreatePCMenu";
}

function pcMenuOptions(mem: Memory, decode: Decode, flag: (id: number) => boolean): string[] {
  const text = (name: string) => decode(mem.global(name).bytes());
  const player = decode(mem.global("gSaveBlock2Ptr").deref().field("playerName").bytes());
  const oak = flag(FLAG_SYS_POKEDEX_GET) || flag(FLAG_SYS_GAME_CLEAR) ? [text("gText_ProfOakSPc")] : [];
  const hallOfFame = flag(FLAG_SYS_GAME_CLEAR) ? [text("gText_HallOfFame_2")] : [];
  return [text(flag(FLAG_SYS_NOT_SOMEONES_PC) ? "gText_BillSPc" : "gText_SomeoneSPc"), `${player}'s PC`, ...oak, ...hallOfFame, text("gText_LogOff")];
}

export function playerPcMenu(mem: Memory, decode: Decode): Choice | null {
  if (!activeTask(mem, "Task_TopMenuHandleInput") || mem.global("gPaletteFade").field("active").int()) return null;
  const order = mem.global("sItemOrder");
  const actions = mem.global("sMenuActions_TopMenu");
  const options = Array.from({ length: mem.global("sTopMenuItemCount").int() }, (_, i) => menuText(mem, actions.at(order.at(i).int()).field("text").pointer(), decode));
  return { options, cursor: mem.global("sMenu").field("cursorPos").int() };
}

// The game draws the menu over several frames: it is ready when the script stops.
export function multichoiceGrid(mem: Memory, decode: Decode): GridChoice | null {
  if (!activeTask(mem, "Hask_MultichoiceGridMenu_HandleInput") || mem.global("sGlobalScriptContextStatus").int() !== SCRIPT_CONTEXT_WAITING) return null;
  const id = mem.u8(mem.global("sGlobalScriptContext").field("scriptPtr").pointer() - GRID_MULTICHOICE_ID_OFFSET);
  const menu = mem.global("sMenu");
  return { options: multichoiceOptions(mem, id, decode), cursor: menu.field("cursorPos").int(), columns: menu.field("columns").int() };
}

function multichoiceOptions(mem: Memory, id: number, decode: Decode): string[] {
  const menu = mem.global("sMultichoiceLists").at(id);
  const list = menu.field("list");
  return Array.from({ length: menu.field("count").int() }, (_, i) => menuText(mem, list.at(i).field("text").pointer(), decode));
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

function keyboardRows(mem: Memory, decode: Decode, page: number): string[] {
  const keyboard = mem.global("sPageToKeyboardId").at(page).int();
  const columns = mem.global("sPageColumnCounts").at(keyboard).int();
  const rows = mem.global("sKeyboardChars").at(keyboard);
  return Array.from({ length: rows.length }, (_, row) => decode(rows.at(row).bytes()).slice(0, columns));
}

export function namingScreen(mem: Memory, decode: Decode): NamingScreen | null {
  if (functionName(mem.symbols, mem.global("gMain").field("callback2").pointer()) !== "CB2_NamingScreen") return null;
  const screen = mem.global("sNamingScreen").deref();
  const page = screen.field("currentPage").int();
  const keys = keyboardRows(mem, decode, page);
  const cursor = mem.global("gSprites").at(screen.field("cursorSpriteId").int()).field("data");
  return {
    subject: NAMING_SUBJECTS.get(screen.field("templateNum").int()) ?? `a nickname for ${nameAt(mem, "gSpeciesNames", screen.field("monSpecies").int(), decode)}`,
    maxLength: screen.field("template").deref().field("maxChars").int(),
    ready: screen.field("state").int() === NAMING_INPUT_STATE,
    page,
    keys,
    columns: keys[0].length,
    characters: () => [...new Set(Array.from({ length: NAMING_PAGES }, (_, i) => Array.from(keyboardRows(mem, decode, i).join(""))).flat())],
    cursor: { x: cursor.at(0).int(), y: cursor.at(1).int() },
    text: decode(screen.field("textBuffer").bytes()),
  };
}
