// The menus of the game: the keys that a Macro-action presses in the battle menus, the Bag, the Poké Mart, the item PC and the party menu.
import { type BagPlace, BATTLE_POCKETS, ITEMS_POCKET, POKE_BALLS_POCKET, sellRefusal } from "../bag";
import type { BattleMenu } from "../battle";
import type { Game } from "../game";
import type { NamingScreen } from "../menus";
import { type Messages, oneLine } from "../prompts";
import { Keys } from "../protocol";
import type { Interruption } from "./harness";

const DECISION_FRAME_LIMIT = 3600;
const FIGHT_CURSOR = 0;
const BAG_CURSOR = 1;
const POKEMON_CURSOR = 2;
const RUN_CURSOR = 3;
const SHOP_BUY = 0;
const SHOP_SELL = 1;
const SHOP_QUIT = 2;
const MAX_TRADE = 99;
const PC_WITHDRAW = 0;
const PC_DEPOSIT = 1;
const WITHDRAW_MENU_WITHDRAW = 0;
// The first option of the PC menu of a Pokémon Center opens the Pokémon Storage System: the Harness does not cover the boxes.
const POKEMON_STORAGE_OPTIONS = ["SOMEONE'S PC", "BILL'S PC"];
const MAX_TEXT_PRESSES = 256;
const START_MENU_POKEMON = "POKéMON";
const START_MENU_BAG = "BAG";
const SEND_OUT_ACTIONS = ["SEND OUT", "SHIFT"];
const SWAP_ACTION = "SWITCH";
const CURSOR_COLUMN = 1;
const CURSOR_ROW = 2;
// Decomp MoveCursorToOKButton: the OK button is in the third row of the button column, the column after the keys.
const NAMING_OK_ROW = 2;
// moveMenuCursor reads the cursor as one number: y * NAMING_CURSOR_STRIDE + x. A row of the keyboard has less than 16 columns.
const NAMING_CURSOR_STRIDE = 16;
const YES = 0;
const NO = 1;
// sHMMoves (pokemon.c): the learn-move flow refuses to forget them.
const HM_MOVES = new Set(["CUT", "FLY", "SURF", "STRENGTH", "FLASH", "ROCK SMASH", "WATERFALL", "DIVE"]);

export type Outcome =
  | { status: "done" }
  | { status: "impossible"; reason: string }
  | { status: "blocked"; reason: string }
  | { status: "interrupted"; reason: Interruption };

export type Texts = { text: string[] };

/** The frames of the Harness. `advance` runs one frame with the keys, and it gives true when a battle starts. */
export type Input = { advance(keys: number): boolean };

const impossible = (reason: string): Outcome => ({ status: "impossible", reason });

const withText = (outcome: Outcome, text: string[] = []): Outcome & Texts => ({ ...outcome, text });

const BATTLE_INTERRUPTION: Outcome = { status: "interrupted", reason: "battle" };

const DONE: Outcome = { status: "done" };

/** The key that moves a cursor from `at` toward `target`. */
function toward(target: number, more: number, less: number): (at: number) => number {
  return (at) => (target > at ? more : less);
}

function quantityKey(at: number, target: number): number {
  if (target - at >= 10) return Keys.Right;
  if (at - target >= 10) return Keys.Left;
  return target > at ? Keys.Up : Keys.Down;
}

// The battle menus are 2x2 grids. The game does not move the cursor to an empty move slot, and the moves fill
// the slots in order: so the cursor goes left and up first, and passes only on cells before the target.
function gridKey(cursor: number, target: number): number {
  if (cursor & CURSOR_COLUMN & ~target) return Keys.Left;
  if (cursor & CURSOR_ROW & ~target) return Keys.Up;
  return target & CURSOR_COLUMN & ~cursor ? Keys.Right : Keys.Down;
}

type Cell = { row: number; column: number };

/** The key that moves a cursor of a grid toward the target: along the `first` axis until it matches, then along the other axis. */
function towardCell(at: Cell, target: Cell, first: "row" | "column"): number {
  const rowKey = toward(target.row, Keys.Down, Keys.Up)(at.row);
  const columnKey = toward(target.column, Keys.Right, Keys.Left)(at.column);
  const aligned = first === "row" ? at.row === target.row : at.column === target.column;
  const [firstKey, secondKey] = first === "row" ? [rowKey, columnKey] : [columnKey, rowKey];
  return aligned ? secondKey : firstKey;
}

function choiceKey(target: number, columns: number): (at: number) => number {
  const cell = (index: number): Cell => ({ row: Math.floor(index / columns), column: index % columns });
  return (at) => towardCell(cell(at), cell(target), "column");
}

type Sale = { place: BagPlace; refusal: null } | { place: null; refusal: string };

function sale(item: string, place: BagPlace | null): Sale {
  if (!place) return { place, refusal: `there is no ${item} in the Bag` };
  const refusal = sellRefusal(place.pocket, place.price, item);
  return refusal === null ? { place, refusal } : { place: null, refusal };
}

// The keyboard has a curly quote for each side: the first " of the text opens, the next closes.
function keyboardCharacters(text: string): string[] {
  const characters = Array.from(text);
  let open = true;
  for (const [i, char] of characters.entries()) {
    if (char !== '"') continue;
    characters[i] = open ? "“" : "”";
    open = !open;
  }
  return characters;
}

function keyAt(keys: string[], char: string): { x: number; y: number } | null {
  const y = keys.findIndex((row) => row.includes(char));
  return y < 0 ? null : { x: keys[y].indexOf(char), y };
}

function isOnOk({ cursor, columns }: NamingScreen): boolean {
  return cursor.x === columns && cursor.y === NAMING_OK_ROW;
}

class MessageReader {
  readonly text: string[] = [];
  private messages: Messages;
  private pressedOnce = false;
  private lastWindow: number | null = null;
  // The texts of a whiteout close their box between them: after a whiteout, only the end of the texts ends the reading.
  private sawWhiteOut = false;
  closedAfterPress = false;

  constructor(private readonly game: Game) {
    this.messages = game.messages();
    for (const window of this.messages.onScreen) this.push(window);
  }

  pressed(): void {
    this.pressedOnce = true;
  }

  update(): void {
    const before = this.messages.printing;
    this.messages = this.game.messages();
    for (const window of this.messages.printing) if (!before.includes(window)) this.push(window);
    if (this.game.whitingOut()) this.sawWhiteOut = true;
    const closedNow = this.pressedOnce && this.messages.boxClosed && !this.sawWhiteOut;
    this.closedAfterPress = this.closedAfterPress || closedNow;
  }

  textBeforeWaitingText(): string[] {
    const waits = this.game.waitingFor().kind === "text" && this.lastWindow !== null && this.game.messages().onScreen.includes(this.lastWindow);
    return waits ? this.text.slice(0, -1) : this.text;
  }

  private push(window: number): void {
    const text = oneLine(this.game.messageText(window)).trim();
    if (!text) return;
    this.text.push(text);
    this.lastWindow = window;
  }
}

export class MenuDriver {
  constructor(
    private readonly game: Game,
    private readonly frames: Input,
  ) {}

  // JOY_NEW sees a press only after a frame with the button up.
  tap(keys: number): "battle" | null {
    return this.frames.advance(keys) || this.frames.advance(0) ? "battle" : null;
  }

  input(keys: number, watch?: () => void): Outcome {
    const battle = this.tap(keys);
    return battle ? BATTLE_INTERRUPTION : this.untilDecision(watch);
  }

  untilDecision(watch: () => void = () => {}): Outcome {
    return this.untilReady(() => this.game.waitingFor().kind !== "busy", watch);
  }

  choose(option: string): Outcome {
    const { game } = this;
    const choice = game.waitingFor();
    if (choice.kind !== "choice") throw new Error("choose is available only at a choice");
    const target = choice.options.indexOf(option);
    if (target < 0) return impossible(`no option "${option}" in ${choice.options.join(", ")}`);
    if (POKEMON_STORAGE_OPTIONS.includes(option)) return impossible(`${option} opens the Pokémon storage (the boxes), and the program does not cover it: choose another option`);
    const cursor = () => {
      const now = game.waitingFor();
      return now.kind === "choice" ? now.cursor : null;
    };
    // The wireless tasks of a Pokémon Center make some frames skip the keys: press until the game reads them.
    const press = (keys: number) => this.menuInput(keys, () => game.waitingFor().kind !== "busy");
    const moved = this.moveCursor(target, cursor, choiceKey(target, choice.columns), press);
    return moved.status === "done" ? press(Keys.A) : moved;
  }

  fight(move: number): Outcome & Partial<Texts> {
    const { game } = this;
    const chosen = game.requireBattle().player.moves[move];
    if (!chosen) return impossible(`the Pokémon has no move ${move}`);
    if (chosen.pp === 0) return impossible(`${chosen.name} has no PP`);
    if (game.waitingFor().kind === "battleAction") {
      const opened = this.select("battleAction", FIGHT_CURSOR);
      if (opened.status !== "done") return opened;
      if (game.waitingFor().kind !== "battleMove") return impossible("the move menu does not open");
    }
    return this.turn("battleMove", move);
  }

  run(): Outcome & Partial<Texts> {
    if (this.game.requireBattle().kind === "trainer") return impossible("there is no running from a trainer battle");
    return this.turn("battleAction", RUN_CURSOR);
  }

  use(item: string, on?: number): Outcome & Partial<Texts> {
    const { game } = this;
    const walk = game.waitingFor().kind === "walk";
    const place = this.usablePlace(item, on, walk);
    if ("status" in place) return place;
    const before = game.bagQuantity(place.item);
    const opened = walk ? this.openStartMenu(START_MENU_BAG, () => game.bagMenu()?.screen === "list") : this.openBag();
    if (opened.status !== "done") return opened;
    const picked = this.pickItem(place, on, walk);
    if (picked.status !== "done") return picked;
    return walk ? this.useOnWalk(item, place.item, before) : this.useInBattle(item, place.item, before);
  }

  buy(item: string, quantity: number): Outcome {
    const { game } = this;
    const items = (game.buyList() ?? game.shopMenu())?.items ?? [];
    const row = items.findIndex((i) => i.name === item);
    if (row < 0) return impossible(`the shop does not sell ${item}`);
    // The quantity box stops without error at the quantity that the money pays: check the money first.
    const cost = items[row].price * quantity;
    if (cost > game.money()) return impossible(`${quantity} ${item} cost ${cost} and the money is ${game.money()}`);
    if (quantity < 1 || quantity > MAX_TRADE) return impossible(`the quantity of ${item} to buy is 1 to ${MAX_TRADE}`);
    const list = () => game.buyList();
    const opened = list() ? DONE : this.shopOption(SHOP_BUY, () => list() !== null, "the buy list");
    if (opened.status !== "done") return opened;
    const moved = this.moveMenuCursor(row, () => list()?.row ?? null);
    if (moved.status !== "done") return moved;
    return this.backToShopMenu(this.trade(quantity));
  }

  sell(item: string, quantity: number): Outcome {
    const { game } = this;
    const { place, refusal } = sale(item, game.findInBag(item));
    if (refusal !== null) return impossible(refusal);
    const most = Math.min(game.bagQuantity(place.item), MAX_TRADE);
    if (quantity < 1 || quantity > most) return impossible(`the quantity of ${item} to sell is 1 to ${most}`);
    const menu = this.toShopMenu();
    if (menu.status !== "done") return menu;
    const opened = this.shopOption(SHOP_SELL, () => game.bagMenu()?.screen === "list", "the Bag");
    if (opened.status !== "done") return opened;
    const row = this.toBagItem(place);
    if (row.status !== "done") return row;
    return this.backToShopMenu(this.trade(quantity));
  }

  withdraw(item: string, quantity: number): Outcome {
    const { game } = this;
    const items = game.pcItems();
    const row = items.findIndex((i) => i.name === item);
    if (row < 0) return impossible(`there is no ${item} in the PC`);
    const most = items[row].quantity;
    if (quantity < 1 || quantity > most) return impossible(`the quantity of ${item} to withdraw is 1 to ${most}`);
    const opened = this.itemStorageOption(PC_WITHDRAW, () => game.withdrawRow() !== null);
    if (opened.status !== "done") return opened;
    const moved = this.moveMenuCursor(row, () => game.withdrawRow());
    if (moved.status !== "done") return moved;
    const menu = this.tapUntil(Keys.A, () => game.withdrawMenuCursor() !== null, "the menu of the item");
    if (menu.status !== "done") return menu;
    const withdrawn = this.moveMenuCursor(WITHDRAW_MENU_WITHDRAW, () => game.withdrawMenuCursor());
    if (withdrawn.status !== "done") return withdrawn;
    return this.backToItemStorage(this.transfer(item, quantity, "the Bag"));
  }

  deposit(item: string, quantity: number): Outcome {
    const { game } = this;
    const place = game.findInBag(item);
    if (!place) return impossible(`there is no ${item} in the Bag`);
    if (place.pocket !== ITEMS_POCKET) return impossible("only the items of the ITEMS pocket go into the PC");
    const most = game.bagQuantity(place.item);
    if (quantity < 1 || quantity > most) return impossible(`the quantity of ${item} to deposit is 1 to ${most}`);
    const opened = this.itemStorageOption(PC_DEPOSIT, () => game.bagMenu()?.screen === "list");
    if (opened.status !== "done") return opened;
    const row = this.toBagItem(place);
    if (row.status !== "done") return row;
    return this.backToItemStorage(this.transfer(item, quantity, "the PC"));
  }

  leave(): Outcome & Texts {
    if (this.game.waitingFor().kind === "itemPc") return withText(this.menuInput(Keys.B, () => this.game.waitingFor().kind !== "busy"));
    const menu = this.toShopMenu();
    if (menu.status !== "done") return withText(menu);
    const left = this.shopOption(SHOP_QUIT, () => this.game.shopMenu() === null, "the end of the shop");
    return left.status === "done" ? this.readText() : withText(left);
  }

  name(text: string): Outcome & Texts {
    const screen = this.namingScreen();
    if (!screen) throw new Error("name is available only at the naming screen");
    const characters = keyboardCharacters(text);
    if (characters.length > screen.maxLength) return withText(impossible(`"${text}" has ${characters.length} characters: ${screen.subject} has ${screen.maxLength} at most`));
    const keyboard = screen.characters();
    const missing = characters.find((char) => !keyboard.includes(char));
    if (missing !== undefined) return withText(impossible(`"${missing}" is not on the keyboard of the naming screen`));
    for (const char of characters) {
      const typed = this.typeCharacter(char);
      if (typed.status !== "done") return withText(typed);
    }
    const onOk = this.menuInput(Keys.Start, () => {
      const now = this.namingScreen();
      return now !== null && isOnOk(now);
    });
    if (onOk.status !== "done") return withText(onOk);
    const pressed = this.pressUntilRead(Keys.A);
    return pressed.status === "done" ? this.readText() : withText(pressed);
  }

  /** At the "Delete a move?" question: YES, then the move on the summary screen. It ends at the first text after the summary screen. */
  forget(move: string): Outcome {
    const { game } = this;
    const learn = game.waitingFor();
    if (learn.kind !== "learnMove") throw new Error("forget is available only at a learnMove");
    const pokemon = game.party()[learn.slot];
    const slot = pokemon.moves.findIndex((m) => m.name === move);
    if (slot < 0) return impossible(`${pokemon.nickname} does not know ${move}: its moves are ${pokemon.moves.map((m) => m.name).join(", ")}`);
    if (HM_MOVES.has(move)) return impossible(`${move} is an HM move, and HM moves cannot be forgotten now`);
    const yes = this.answerLearnMove(YES);
    if (yes.status !== "done") return yes;
    const shown = this.tapUntil(Keys.A, () => game.forgetMoveCursor() !== null, "the moves of the Pokémon");
    if (shown.status !== "done") return shown;
    const moved = this.moveMenuCursor(slot, () => game.forgetMoveCursor());
    return moved.status === "done" ? this.input(Keys.A) : moved;
  }

  /** At the "Delete a move?" question: NO, then YES at "Stop learning …?". It ends at the text that the Pokémon did not learn the move. */
  keep(): Outcome {
    const no = this.answerLearnMove(NO);
    if (no.status !== "done") return no;
    const asked = this.tapUntil(Keys.A, () => this.game.learnMoveBox()?.question === "stop", "the question to stop learning the move");
    if (asked.status !== "done") return asked;
    // The game shows the cursor of this yes/no on YES.
    return this.input(Keys.A);
  }

  private answerLearnMove(target: number): Outcome {
    return this.moveCursor(target, () => this.game.learnMoveBox()?.cursor ?? null, toward(target, Keys.Down, Keys.Up));
  }

  readText(): Outcome & Texts {
    const reader = new MessageReader(this.game);
    for (let presses = 0; presses < MAX_TEXT_PRESSES; presses++) {
      const outcome = this.untilDecision(() => reader.update());
      if (outcome.status !== "done" || this.game.waitingFor().kind !== "text") return { ...outcome, text: reader.text };
      if (reader.closedAfterPress) return { status: "done", text: reader.textBeforeWaitingText() };
      const battle = this.tap(Keys.A);
      if (battle) return { status: "interrupted", reason: battle, text: reader.text };
      reader.pressed();
    }
    return { status: "impossible", reason: `the text still waits for A after ${MAX_TEXT_PRESSES} presses`, text: reader.text };
  }

  switch(slot: number): Outcome & Texts {
    const { game } = this;
    const missing = this.missingPokemon(slot);
    if (missing) return withText(missing);
    const opened = this.select("battleAction", POKEMON_CURSOR);
    if (opened.status !== "done") return withText(opened);
    if (game.waitingFor().kind !== "partyPick") return withText(impossible("the party menu does not open"));
    const sent = this.sendOut(game.battleMenuSlot(slot));
    if (sent.status !== "impossible") return sent;
    const closed = this.menuInput(Keys.B, () => game.waitingFor().kind !== "busy");
    return closed.status === "done" ? sent : withText(closed, sent.text);
  }

  send(slot: number): Outcome & Texts {
    const missing = this.missingPokemon(slot);
    return missing ? withText(missing) : this.sendOut(this.game.battleMenuSlot(slot));
  }

  swap(first: number, second: number): Outcome {
    for (const slot of [first, second]) {
      const missing = this.missingPokemon(slot);
      if (missing) return missing;
    }
    if (first === second) return impossible("a Pokémon cannot swap with itself");
    const opened = this.openStartMenu(START_MENU_POKEMON, () => this.pickMenu() !== null);
    if (opened.status !== "done") return opened;
    const actions = this.openPartyActions(first);
    if (actions.status !== "done") return actions;
    const chosen = this.selectPartyAction((options) => options.indexOf(SWAP_ACTION), () => this.pickMenu()?.swapping === true);
    if (chosen.status !== "done") return chosen;
    const moved = this.moveMenuCursor(second, () => this.pickMenu()?.cursor ?? null);
    if (moved.status !== "done") return moved;
    const swapped = this.menuInput(Keys.A, () => this.pickMenu()?.swapping === false);
    return swapped.status === "done" ? this.closeStartMenu() : swapped;
  }

  private namingScreen() {
    const screen = this.game.namingScreen();
    return screen?.ready ? screen : null;
  }

  private typeCharacter(char: string): Outcome {
    const shown = this.showPageOf(char);
    return shown.status === "done" ? this.pressKey(char) : shown;
  }

  // name checked that a page has the character: the pages come back to the first one.
  private showPageOf(char: string): Outcome {
    let screen = this.namingScreen();
    while (screen && !keyAt(screen.keys, char)) {
      const { page } = screen;
      const swapped = this.menuInput(Keys.Select, () => (this.namingScreen()?.page ?? page) !== page);
      if (swapped.status !== "done") return swapped;
      screen = this.namingScreen();
    }
    return screen ? { status: "done" } : impossible("the naming screen reads no input");
  }

  private pressKey(char: string): Outcome {
    const screen = this.namingScreen();
    const key = screen && keyAt(screen.keys, char);
    if (!screen || !key) return impossible("the naming screen reads no input");
    const { x, y } = key;
    const cursor = () => {
      const now = this.namingScreen();
      return now && now.cursor.y * NAMING_CURSOR_STRIDE + now.cursor.x;
    };
    const direction = (at: number) => {
      const [atX, atY] = [at % NAMING_CURSOR_STRIDE, Math.floor(at / NAMING_CURSOR_STRIDE)];
      if (atX === screen.columns) return Keys.Left;
      return towardCell({ row: atY, column: atX }, { row: y, column: x }, "row");
    };
    const moved = this.moveMenuCursor(y * NAMING_CURSOR_STRIDE + x, cursor, direction);
    if (moved.status !== "done") return moved;
    const length = screen.text.length;
    return this.menuInput(Keys.A, () => (this.namingScreen()?.text.length ?? length) > length);
  }

  private missingPokemon(slot: number): Outcome | null {
    return this.game.party()[slot] ? null : impossible(`the party has no Pokémon ${slot}`);
  }

  private pickMenu() {
    const menu = this.game.partyMenu();
    return menu?.kind === "pick" ? menu : null;
  }

  /** The place of the item in the Bag, or why the item cannot be used now. */
  private usablePlace(item: string, on: number | undefined, walk: boolean): BagPlace | Outcome {
    const { game } = this;
    const place = game.findInBag(item);
    if (!place || place.pocket >= BATTLE_POCKETS) return impossible(`there is no ${item} in the Bag${walk ? "" : " of a battle"}`);
    const use = walk ? place.walk : place.battle;
    if (!use) return impossible(`${item} does not work ${walk ? "outside" : "in"} a battle`);
    if (!walk && place.pocket === POKE_BALLS_POCKET && game.requireBattle().kind === "trainer") return impossible("the trainer blocks a ball: there is no catching in a trainer battle");
    if (use === "pokemon" && on === undefined) return impossible(`${item} works on a Pokémon: give the Pokémon`);
    if (use === "alone" && on !== undefined) return impossible(`${item} does not work on a Pokémon`);
    return (on === undefined ? null : this.missingPokemon(on)) ?? place;
  }

  /** From the list of the Bag to the menu of the item, and the Pokémon when the item needs one. */
  private pickItem(place: BagPlace, on: number | undefined, walk: boolean): Outcome {
    const { game } = this;
    const row = this.toBagItem(place);
    if (row.status !== "done") return row;
    const context = this.tapUntil(Keys.A, () => game.bagMenu()?.screen === "context", "the menu of the item");
    if (context.status !== "done" || on === undefined) return context;
    const party = this.tapUntil(Keys.A, () => this.pickMenu() !== null, "the party menu");
    if (party.status !== "done") return party;
    return this.moveMenuCursor(walk ? on : game.battleMenuSlot(on), () => this.pickMenu()?.cursor ?? null);
  }

  private useInBattle(item: string, id: number, before: number): Outcome & Partial<Texts> {
    const { game } = this;
    const reader = new MessageReader(game);
    const pressed = this.pressUntilRead(Keys.A);
    if (pressed.status !== "done") return pressed;
    const used = this.untilDecision(() => reader.update());
    if (used.status !== "done") return used;
    if (!game.battleScreen() && game.bagQuantity(id) === before) return this.refused(item, game.waitingTexts().join(" "));
    const effect = game.battleScreen() ? [] : game.waitingTexts();
    if (effect.length > 0) {
      const after = this.input(Keys.A, () => reader.update());
      if (after.status !== "done") return after;
    }
    return { status: "done", text: [...effect, ...reader.textBeforeWaitingText()] };
  }

  private useOnWalk(item: string, id: number, before: number): Outcome & Partial<Texts> {
    const { game } = this;
    const pressed = this.pressUntilRead(Keys.A);
    if (pressed.status !== "done") return pressed;
    const told = this.untilReady(() => game.waitingTexts().length > 0 || game.itemAnimWaits());
    if (told.status !== "done") return told;
    if (game.itemAnimWaits()) {
      const effect = this.menuInput(Keys.A, () => game.waitingTexts().length > 0);
      if (effect.status !== "done") return effect;
    }
    return this.endWalkUse(item, id, before, game.waitingTexts());
  }

  // The medicines and the REPEL items go back to the Bag and then to the field. ESCAPE ROPE closes the Bag and shows its text on the field, then warps to another map.
  private endWalkUse(item: string, id: number, before: number, text: string[]): Outcome & Partial<Texts> {
    const { game } = this;
    if (game.mode() === "overworld") {
      const escaped = this.menuInput(Keys.A, () => game.waitingFor().kind !== "busy");
      return escaped.status === "done" ? { status: "done", text } : withText(escaped, text);
    }
    const back = this.menuInput(Keys.A, () => game.bagMenu()?.screen === "list");
    if (back.status !== "done") return withText(back, text);
    const closed = this.closeStartMenu();
    if (closed.status !== "done") return withText(closed, text);
    return game.bagQuantity(id) === before ? impossible(`the game refuses the ${item}: ${text.join(" ")}`) : { status: "done", text };
  }

  private refused(item: string, message: string): Outcome {
    const { game } = this;
    const back = this.tapUntil(Keys.A, () => game.bagMenu()?.screen === "list", "the Bag");
    if (back.status !== "done") return back;
    const closed = this.input(Keys.B);
    if (closed.status !== "done") return closed;
    return impossible(`the game refuses the ${item}: ${message}`);
  }

  private openBag(): Outcome {
    const { game } = this;
    const cursor = () => (game.waitingFor().kind === "battleAction" ? game.battleCursor("battleAction") : null);
    const moved = this.moveCursor(BAG_CURSOR, cursor, (at) => gridKey(at, BAG_CURSOR));
    if (moved.status !== "done") return moved;
    return this.tapUntil(Keys.A, () => game.bagMenu()?.screen === "list", "the Bag");
  }

  private shopOption(option: number, shown: () => boolean, screen: string): Outcome {
    const moved = this.moveMenuCursor(option, () => this.game.shopMenu()?.cursor ?? null);
    return moved.status === "done" ? this.tapUntil(Keys.A, shown, screen) : moved;
  }

  // A refused trade stays in its list, and the Bag of the shop is not a Decision point: go back to the shop menu also then.
  private backToShopMenu(traded: Outcome): Outcome {
    if (traded.status === "interrupted") return traded;
    const back = this.toShopMenu();
    return traded.status === "done" || back.status !== "done" ? back : traded;
  }

  private toShopMenu(): Outcome {
    const { game } = this;
    return game.shopMenu() ? DONE : this.tapUntil(Keys.B, () => game.shopMenu() !== null, "the shop menu");
  }

  private toBagItem(place: BagPlace): Outcome {
    const { game } = this;
    const list = () => {
      const menu = game.bagMenu();
      return menu?.screen === "list" ? menu : null;
    };
    const pocket = this.moveMenuCursor(place.pocket, () => list()?.pocket ?? null, toward(place.pocket, Keys.Right, Keys.Left));
    if (pocket.status !== "done") return pocket;
    return this.moveMenuCursor(place.row, () => list()?.row ?? null);
  }

  private trade(quantity: number): Outcome {
    const { game } = this;
    const box = this.tapUntil(Keys.A, () => game.tradeQuantity() !== null || game.tradeYesNo() !== null, "the quantity box");
    if (box.status !== "done") return box;
    const count = () => game.tradeQuantity();
    const inBox = (keys: number) => this.tapUntil(keys, () => count() !== null, "the quantity box");
    if (count() !== null) {
      const moved = this.moveCursor(quantity, count, (at) => quantityKey(at, quantity), inBox);
      if (moved.status !== "done") return moved;
      const asked = this.tapUntil(Keys.A, () => game.tradeYesNo() !== null, "the yes/no");
      if (asked.status !== "done") return asked;
    }
    const yes = this.tapUntil(Keys.A, () => game.tradeDone() || game.waitingTexts().length > 0, "the end of the trade");
    if (yes.status !== "done") return yes;
    const refusal = game.tradeDone() ? null : game.menuMessage();
    const back = this.tapUntil(Keys.A, () => game.buyList() !== null || game.bagMenu()?.screen === "list", "the list");
    return back.status !== "done" || refusal === null ? back : impossible(`the game refuses: ${refusal}`);
  }

  private itemStorageOption(option: number, shown: () => boolean): Outcome {
    const moved = this.moveMenuCursor(option, () => this.game.itemStorageCursor());
    return moved.status === "done" ? this.menuInput(Keys.A, shown) : moved;
  }

  // A refused withdraw or deposit goes back to its list too: go back to the item PC menu also then.
  private backToItemStorage(moved: Outcome): Outcome {
    if (moved.status === "interrupted") return moved;
    const { game } = this;
    const back = game.itemStorageCursor() !== null ? DONE : this.menuInput(Keys.B, () => game.itemStorageCursor() !== null);
    return moved.status === "done" || back.status !== "done" ? back : moved;
  }

  // A presses WITHDRAW in the menu of the item, or selects the item in the Bag of the PC. With one item only, the game asks no quantity.
  private transfer(item: string, quantity: number, place: string): Outcome {
    const { game } = this;
    const box = this.tapUntil(Keys.A, () => game.pcQuantity() !== null || game.pcTransfer() !== null, "the quantity box");
    if (box.status !== "done") return box;
    const count = () => game.pcQuantity();
    if (count() !== null) {
      const inBox = (keys: number) => this.tapUntil(keys, () => count() !== null, "the quantity box");
      const moved = this.moveCursor(quantity, count, (at) => quantityKey(at, quantity), inBox);
      if (moved.status !== "done") return moved;
      const chosen = this.tapUntil(Keys.A, () => game.pcTransfer() !== null, "the end of the transfer");
      if (chosen.status !== "done") return chosen;
    }
    const refused = game.pcTransfer() === "refused";
    // The message reads the keys on the frames after it shows: wait until the game reads the release of the last A.
    const back = this.menuInput(Keys.A, () => game.withdrawRow() !== null || game.bagMenu()?.screen === "list");
    return back.status !== "done" || !refused ? back : impossible(`${place} has no room for ${quantity} ${item}`);
  }

  private sendOut(menuSlot: number): Outcome & Texts {
    const { game } = this;
    const actions = this.openPartyActions(menuSlot);
    if (actions.status !== "done") return withText(actions);
    const sent = this.selectPartyAction(
      (options) => options.findIndex((o) => SEND_OUT_ACTIONS.includes(o)),
      () => {
        const menu = game.partyMenu();
        return menu === null || menu.kind === "refusal";
      },
    );
    if (sent.status !== "done") return withText(sent);
    const refusal = game.partyMenu();
    if (refusal?.kind === "refusal") {
      const back = this.untilReady(
        () => game.partyMenu()?.kind === "pick",
        () => {
          if (game.waitingFor().kind === "text") this.pressUntilRead(Keys.A);
        },
      );
      return withText(back.status === "done" ? impossible(refusal.text) : back);
    }
    // The battle message windows share their numbers with the party menu windows: read only after the menu.
    const reader = new MessageReader(game);
    return withText(this.untilDecision(() => reader.update()), reader.textBeforeWaitingText());
  }

  private openStartMenu(option: string, shown: () => boolean): Outcome {
    const { game } = this;
    const opened = this.menuInput(Keys.Start, () => game.startMenu() !== null);
    if (opened.status !== "done") return opened;
    const item = game.startMenu()?.options.indexOf(option) ?? -1;
    if (item < 0) return impossible(`the Start menu has no ${option}`);
    const moved = this.moveMenuCursor(item, () => game.startMenu()?.cursor ?? null);
    return moved.status === "done" ? this.menuInput(Keys.A, shown) : moved;
  }

  private closeStartMenu(): Outcome {
    const { game } = this;
    const closed = this.menuInput(Keys.B, () => game.startMenu() !== null);
    return closed.status === "done" ? this.menuInput(Keys.B, () => game.waitingFor().kind === "walk") : closed;
  }

  private openPartyActions(menuSlot: number): Outcome {
    const { game } = this;
    const moved = this.moveMenuCursor(menuSlot, () => this.pickMenu()?.cursor ?? null);
    return moved.status === "done" ? this.menuInput(Keys.A, () => game.partyMenu()?.kind === "actions") : moved;
  }

  private selectPartyAction(find: (options: string[]) => number, done: () => boolean): Outcome {
    const { game } = this;
    const menu = game.partyMenu();
    if (menu?.kind !== "actions") throw new Error("the party menu does not show the actions of a Pokémon");
    const target = find(menu.options);
    if (target < 0) return impossible(`the party menu has no such action: ${menu.options.join(", ")}`);
    const moved = this.moveMenuCursor(target, () => {
      const now = game.partyMenu();
      return now?.kind === "actions" ? now.cursor : null;
    });
    return moved.status === "done" ? this.menuInput(Keys.A, done) : moved;
  }

  private turn(menu: BattleMenu, target: number): Outcome & Texts {
    const reader = new MessageReader(this.game);
    return withText(this.select(menu, target, () => reader.update()), reader.textBeforeWaitingText());
  }

  private select(menu: BattleMenu, target: number, watch?: () => void): Outcome {
    const { game } = this;
    const cursor = () => (game.waitingFor().kind === menu ? game.battleCursor(menu) : null);
    const moved = this.moveCursor(target, cursor, (at) => gridKey(at, target));
    if (moved.status !== "done") return moved;
    const battle = this.tap(Keys.A);
    return battle ? BATTLE_INTERRUPTION : this.untilDecision(watch);
  }

  private moveCursor(target: number, read: () => number | null, key: (cursor: number) => number, press = (keys: number) => this.input(keys)): Outcome {
    for (let cursor = read(); cursor !== target; ) {
      if (cursor === null) return impossible("the menu closed when the cursor moved");
      const moved = press(key(cursor));
      if (moved.status !== "done") return moved;
      const now = read();
      if (now === cursor) return impossible(`the cursor does not move from ${cursor}`);
      cursor = now;
    }
    return { status: "done" };
  }

  private moveMenuCursor(target: number, cursor: () => number | null, key = toward(target, Keys.Down, Keys.Up)): Outcome {
    for (let at = cursor(); at !== target; ) {
      if (at === null) return impossible("the menu reads no input");
      const from = at;
      const moved = this.menuInput(key(at), () => {
        const now = cursor();
        return now !== null && now !== from;
      });
      if (moved.status !== "done") return moved;
      at = cursor();
    }
    return { status: "done" };
  }

  private menuInput(keys: number, ready: () => boolean): Outcome {
    const pressed = this.pressUntilRead(keys);
    return pressed.status === "done" ? this.untilReady(ready) : pressed;
  }

  // A menu reads the keys from the frame after the frame that shows it.
  private tapUntil(keys: number, shown: () => boolean, screen: string): Outcome {
    if (this.tap(keys)) return BATTLE_INTERRUPTION;
    for (let frames = 0; !shown(); frames++) {
      if (frames === DECISION_FRAME_LIMIT) return impossible(`the game does not show ${screen} after ${DECISION_FRAME_LIMIT} frames`);
      if (this.frames.advance(0)) return BATTLE_INTERRUPTION;
    }
    return this.frames.advance(0) ? BATTLE_INTERRUPTION : { status: "done" };
  }

  // A slow menu reads the input on some frames only: wait for it to read the release, then press the keys until it reads them.
  private pressUntilRead(keys: number): Outcome {
    const { game } = this;
    for (const [held, read] of [
      [0, () => (game.keysRead().held & keys) === 0],
      [keys, () => (game.keysRead().pressed & keys) === keys],
    ] as const) {
      for (let frames = 0; !read(); frames++) {
        if (frames === DECISION_FRAME_LIMIT) return impossible(`the game does not read the input for ${DECISION_FRAME_LIMIT} frames`);
        if (this.frames.advance(held)) return BATTLE_INTERRUPTION;
      }
    }
    return this.frames.advance(0) ? BATTLE_INTERRUPTION : { status: "done" };
  }

  private untilReady(ready: () => boolean, watch: () => void = () => {}): Outcome {
    for (let frames = 0; ; frames++) {
      watch();
      if (ready()) return { status: "done" };
      if (frames === DECISION_FRAME_LIMIT) return impossible(`the game waits for no known input for ${DECISION_FRAME_LIMIT} frames`);
      if (this.frames.advance(0)) return BATTLE_INTERRUPTION;
    }
  }
}
