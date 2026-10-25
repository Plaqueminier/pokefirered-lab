import type { Memory, Ref } from "./memory";
import { functionName } from "./symbols";

// RENDER_STATE_WAIT, RENDER_STATE_CLEAR and RENDER_STATE_SCROLL_START (text.h) wait for A or B.
const PRINTER_WAIT_STATES = new Set([1, 2, 3]);
// Task_YesNoMenu_HandleInput (script_menu.c) reads no input while its tTimer (data[2]) is below 5.
const YES_NO_TIMER = 2;
const YES_NO_INPUT_DELAY = 5;
// The field message box is window 0 (sStandardTextBox_WindowTemplates, new_menu_helpers.c); text printer n prints in window n.
const FIELD_MESSAGE_WINDOW = 0;
// B_WIN_MSG and B_WIN_OAK_OLD_MAN, Oak's box in the first battle (constants/battle.h).
const BATTLE_MESSAGE_WINDOWS = [0, 24];
// Long battle texts overflow the 300 bytes of gDisplayedStringBattle (BattleStringExpandPlaceholders).
const MESSAGE_BUFFERS: { name: string; length?: number }[] = [{ name: "gStringVar4" }, { name: "gDisplayedStringBattle", length: 1024 }];
// The background tilemap of the text windows is 32 tiles wide; bits 0-9 of an entry are the tile.
const TILEMAP_WIDTH = 32;
const TILE_INDEX_MASK = 0x3ff;
// Character codes (characters.h).
const CHAR_DYNAMIC = 0xf7;
const CHAR_KEYPAD_ICON = 0xf8;
const CHAR_EXTRA_SYMBOL = 0xf9;
const CHAR_PROMPT_SCROLL = 0xfa;
const CHAR_PROMPT_CLEAR = 0xfb;
const EXT_CTRL_CODE_BEGIN = 0xfc;
const PLACEHOLDER_BEGIN = 0xfd;
const CHAR_NEWLINE = 0xfe;
const CHAR_EOS = 0xff;
const ONE_ARG_CODES = new Set([CHAR_DYNAMIC, CHAR_KEYPAD_ICON, CHAR_EXTRA_SYMBOL, PLACEHOLDER_BEGIN]);
// The table of GetExtCtrlCodeLength (string_util.c): the length of each extended code, with the code byte.
const EXT_CTRL_CODE_LENGTHS = [1, 2, 2, 2, 4, 2, 2, 1, 2, 1, 1, 3, 2, 2, 2, 1, 3, 2, 2, 2, 2, 1, 1, 1, 1];
const CHARMAP_JAPANESE = "@ Hiragana";
const ROM_START = 0x08000000;
const MAX_ROM_TEXT = 256;

export type Decode = (bytes: Uint8Array) => string;

export type Choice = { options: string[]; cursor: number };

export type Messages = { onScreen: number[]; printing: number[]; boxClosed: boolean };

/** The text of a game message on one line. */
export function oneLine(text: string): string {
  return text.split("\n").join(" ");
}

export function decoder(charmapText: string): Decode {
  // The Japanese part gives the same bytes again. In the Latin part, a later line wins ('\'' over '’').
  const japanese = charmapText.indexOf(CHARMAP_JAPANESE);
  if (japanese < 0) throw new Error(`charmap.txt: no "${CHARMAP_JAPANESE}" line`);
  const charmap: string[] = [];
  for (const m of charmapText.slice(0, japanese).matchAll(/^'(\\'|.)'\s*=\s*([0-9A-F]{2})\s*$/gm)) charmap[parseInt(m[2], 16)] = m[1].replace("\\", "");
  return (bytes) => {
    let out = "";
    for (let i = 0; i < bytes.length && bytes[i] !== CHAR_EOS; i++) {
      const b = bytes[i];
      if (b === CHAR_NEWLINE || b === CHAR_PROMPT_SCROLL || b === CHAR_PROMPT_CLEAR) out += "\n";
      else if (b === EXT_CTRL_CODE_BEGIN) i += extCtrlCodeLength(bytes[i + 1]);
      else if (ONE_ARG_CODES.has(b)) i++;
      else out += charmap[b] ?? "?";
    }
    return out;
  };
}

export function activeTask(mem: Memory, func: string): Ref | null {
  const tasks = mem.global("gTasks");
  for (let i = 0; i < tasks.length; i++) {
    const task = tasks.at(i);
    if (task.field("isActive").int() && functionName(mem.symbols, task.field("func").pointer()) === func) return task;
  }
  return null;
}

export class Prompts {
  constructor(
    private readonly mem: Memory,
    private readonly decode: Decode,
  ) {}

  fieldPrinterWaits(): boolean {
    return this.printerWaits(FIELD_MESSAGE_WINDOW);
  }

  fieldPrinterActive(): boolean {
    return this.printerActive(FIELD_MESSAGE_WINDOW);
  }

  choice(): Choice | null {
    const task = activeTask(this.mem, "Task_YesNoMenu_HandleInput");
    if (!task || task.field("data").at(YES_NO_TIMER).int() < YES_NO_INPUT_DELAY) return null;
    return { options: this.yesNo(), cursor: this.mem.global("sMenu").field("cursorPos").int() };
  }

  yesNo(): string[] {
    return ["gText_Yes", "gText_No"].map((name) => this.decode(this.mem.global(name).bytes()));
  }

  // Battle menus also print in windows that they make, for example Oak in the party menu of the first battle.
  anyPrinterWaits(): boolean {
    return this.waitingWindows().length > 0;
  }

  waitingWindows(): number[] {
    const printers = this.mem.global("sTextPrinters");
    return Array.from({ length: printers.length }, (_, w) => w).filter((w) => this.printerWaits(w));
  }

  fieldMessages(): Messages {
    const shown = this.fieldMessageBoxShown();
    return { onScreen: shown ? [FIELD_MESSAGE_WINDOW] : [], printing: this.printingIn([FIELD_MESSAGE_WINDOW]), boxClosed: !shown };
  }

  // The battle message box stays on the screen for the whole battle.
  battleMessages(): Messages {
    const printing = this.printingIn(BATTLE_MESSAGE_WINDOWS);
    return { onScreen: printing, printing, boxClosed: false };
  }

  messageText(window: number): string {
    const printer = this.printer(window);
    const at = printer.field("printerTemplate").field("currentChar").pointer();
    for (const { name, length } of MESSAGE_BUFFERS) {
      const buffer = this.mem.global(name);
      const size = length ?? buffer.size;
      if (at >= buffer.addr && at < buffer.addr + size) return this.decode(this.mem.bus.read(buffer.addr, size));
    }
    const text = at >= ROM_START && printer.field("active").int() ? this.mem.globalBefore(at) : null;
    if (text) return this.decode(this.mem.bus.read(text.addr, at - text.addr + MAX_ROM_TEXT));
    if (this.mem.u8(at) === CHAR_EOS || !printer.field("active").int()) return "";
    throw new Error(`window ${window} prints a string at 0x${at.toString(16)}, not from ${MESSAGE_BUFFERS.map((b) => b.name).join(" or ")}`);
  }

  private printer(window: number): Ref {
    return this.mem.global("sTextPrinters").at(window);
  }

  private printerActive(window: number): boolean {
    return this.printer(window).field("active").int() !== 0;
  }

  private printingIn(windows: number[]): number[] {
    return windows.filter((w) => this.printerActive(w));
  }

  private printerWaits(window: number): boolean {
    const printer = this.printer(window);
    return printer.field("active").int() !== 0 && PRINTER_WAIT_STATES.has(printer.field("state").int()) && !this.mem.global("gTextFlags").field("autoScroll").int();
  }

  private fieldMessageBoxShown(): boolean {
    const window = this.mem.global("gWindows").at(FIELD_MESSAGE_WINDOW).field("window");
    const tilemap = this.mem.global("sGpuBgConfigs2").at(window.field("bg").int()).field("tilemap").pointer();
    if (tilemap === 0) return false;
    const cell = window.field("tilemapTop").int() * TILEMAP_WIDTH + window.field("tilemapLeft").int();
    return (this.mem.u16(tilemap + cell * 2) & TILE_INDEX_MASK) === window.field("baseBlock").int();
  }
}

function extCtrlCodeLength(code: number): number {
  const length = EXT_CTRL_CODE_LENGTHS[code];
  if (length === undefined) throw new Error(`unknown extended control code 0x${code.toString(16)} in a game string`);
  return length;
}
