import { type BagPlace, ITEMS_POCKET, sellRefusal } from "../bag";
import { type BattleMenu, foeBattler, struggles } from "../battle";
import type { Game } from "../game";
import type { NamingScreen, WordScreen } from "../menus";
import { PARTY_SIZE } from "../party";
import { freeBox, IN_BOX_COLUMNS, type StorageScreen } from "../pc";
import { type Messages, oneLine } from "../prompts";
import { Keys } from "../protocol";
import type { Interruption } from "./harness";

const DECISION_FRAME_LIMIT = 3600;
const FIGHT_CURSOR = 0;
const POKEMON_CURSOR = 2;
const RUN_CURSOR = 3;
const SHOP_BUY = 0;
const SHOP_SELL = 1;
const SHOP_QUIT = 2;
const MAX_TRADE = 99;
const PC_WITHDRAW = 0;
const PC_DEPOSIT = 1;
const WITHDRAW_MENU_WITHDRAW = 0;
// The longest way out: the message of a full box, the box choice, the main screen and the question to close.
const MAX_CLOSE_PRESSES = 4;
const MAX_TEXT_PRESSES = 256;
export const START_MENU_POKEMON = "POKéMON";
const SEND_OUT_ACTIONS = ["SEND OUT", "SHIFT"];
const SWAP_ACTION = "SWITCH";
const FLASH_ACTION = "FLASH";
const CURSOR_COLUMN = 1;
const CURSOR_ROW = 2;
// Decomp MoveCursorToOKButton: the OK button is in the third row of the button column, the column after the keys.
const NAMING_OK_ROW = 2;
// moveMenuCursor reads the cursor as one number: y * NAMING_CURSOR_STRIDE + x. A row of the keyboard has less than 16 columns.
const NAMING_CURSOR_STRIDE = 16;

export type Outcome =
  | { status: "done" }
  | { status: "impossible"; reason: string }
  | { status: "blocked"; reason: string }
  | { status: "interrupted"; reason: Interruption };

export type Texts = { text: string[] };

/** The frames of the Harness. `advance` runs one frame with the keys, and it gives true when a battle starts. */
export type Input = { advance(keys: number): boolean };

export const impossible = (reason: string): Outcome => ({ status: "impossible", reason });

const quantityRefusal = (verb: string, item: string, quantity: number, most: number): Outcome | null => (quantity < 1 || quantity > most ? impossible(`the quantity of ${item} to ${verb} is 1 to ${most}`) : null);

export const withText = (outcome: Outcome, text: string[] = []): Outcome & Texts => ({ ...outcome, text });

const BATTLE_INTERRUPTION: Outcome = { status: "interrupted", reason: "battle" };

export const DONE: Outcome = { status: "done" };

/** The key that moves a cursor from `at` toward `target`. */
export function toward(target: number, more: number, less: number): (at: number) => number {
  return (at) => (target > at ? more : less);
}

function quantityKey(at: number, target: number): number {
  if (target - at >= 10) return Keys.Right;
  if (at - target >= 10) return Keys.Left;
  return target > at ? Keys.Up : Keys.Down;
}

// The battle menus are 2x2 grids. The game does not move the cursor to an empty move slot, and the moves fill
// the slots in order: so the cursor goes left and up first, and passes only on cells before the target.
export function gridKey(cursor: number, target: number): number {
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

export class MessageReader {
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

// JOY_NEW sees a press only after a frame with the button up.
export function tap(frames: Input, keys: number): "battle" | null {
  return frames.advance(keys) || frames.advance(0) ? "battle" : null;
}

export class MenuDriver {
  private leftWordScreen = false;

  constructor(
    private readonly game: Game,
    private readonly frames: Input,
  ) {}

  input(keys: number, watch?: () => void): Outcome {
    const pressed = this.pressUntilRead(keys);
    return pressed.status === "done" ? this.untilDecision(watch) : pressed;
  }

  untilDecision(watch: () => void = () => {}): Outcome {
    return this.untilReady(() => this.game.waitingFor().kind !== "busy" || this.game.battleTargetCursor() !== null, watch);
  }

  choose(option: string): Outcome {
    const { game } = this;
    const choice = game.waitingFor();
    if (choice.kind !== "choice") throw new Error("choose is available only at a choice");
    const target = choice.options.indexOf(option);
    if (target < 0) return impossible(`no option "${option}" in ${choice.options.join(", ")}`);
    const cursor = () => {
      const now = game.waitingFor();
      return now.kind === "choice" ? now.cursor : null;
    };
    const moved = this.moveCursor(target, cursor, choiceKey(target, choice.columns));
    return moved.status === "done" ? this.input(Keys.A) : moved;
  }

  useFieldMove(): Outcome {
    if (tap(this.frames, Keys.A)) return BATTLE_INTERRUPTION;
    for (let screens = 0; screens < MAX_TEXT_PRESSES; screens++) {
      const { kind } = this.game.waitingFor();
      if (kind === "walk") return DONE;
      const outcome = kind === "choice" ? this.choose("YES") : this.readText();
      if (outcome.status === "interrupted") return { status: "interrupted", reason: outcome.reason };
      if (outcome.status !== "done") throw new Error(`the script of the obstacle stops: ${outcome.reason}`);
    }
    throw new Error(`the script of the obstacle still runs after ${MAX_TEXT_PRESSES} screens`);
  }

  /** `foe`: 1 or 2 in a double battle. With no foe, a move that hits one foe hits the first one, as the cursor of the game starts there. */
  fight(move: number, foe?: number): Outcome & Partial<Texts> {
    const { game } = this;
    const { player, double } = game.requireBattle();
    const chosen = player.moves[move];
    if (!chosen) return impossible(`the Pokémon has no move ${move}`);
    if (foe !== undefined && !double?.otherFoe) return impossible("there is only one foe to choose: write the fight with no foe");
    // The game opens no move menu: FIGHT plays STRUGGLE or the ENCORE move at once (HandleTurnActionSelectionState).
    if (struggles(player)) return game.waitingFor().kind === "battleAction" ? this.turn("battleAction", FIGHT_CURSOR) : impossible("the move menu is open, but no move has PP");
    if (player.encoredSlot !== null) return move === player.encoredSlot ? this.turn("battleAction", FIGHT_CURSOR) : impossible(`the ENCORE allows only fight ${player.encoredSlot}`);
    if (chosen.pp === 0) return impossible(`${chosen.name} has no PP`);
    if (game.waitingFor().kind === "battleAction") {
      const opened = this.select("battleAction", FIGHT_CURSOR);
      if (opened.status !== "done") return opened;
      if (game.waitingFor().kind !== "battleMove") return impossible("the move menu does not open");
    }
    const played = this.turn("battleMove", move);
    return played.status === "done" && game.battleTargetCursor() !== null ? this.confirmTarget(foe) : played;
  }

  private confirmTarget(foe: number | undefined): Outcome & Texts {
    const reader = new MessageReader(this.game);
    // HandleInputChooseTarget: Left goes from the left foe straight to the right foe.
    const moved = foe === undefined ? { status: "done" as const } : this.moveCursor(foeBattler(foe), () => this.game.battleTargetCursor(), () => Keys.Left);
    if (moved.status !== "done") return withText(moved);
    return withText(this.input(Keys.A, () => reader.update()), reader.textBeforeWaitingText());
  }

  run(): Outcome & Partial<Texts> {
    if (this.game.requireBattle().kind === "trainer") return impossible("there is no running from a trainer battle");
    return this.turn("battleAction", RUN_CURSOR);
  }

  buy(item: string, quantity: number): Outcome {
    const { game } = this;
    const items = (game.buyList() ?? game.shopMenu())?.items ?? [];
    const row = items.findIndex((i) => i.name === item);
    if (row < 0) return impossible(`the shop does not sell ${item}`);
    // The quantity box stops without error at the quantity that the money pays: check the money first.
    const cost = items[row].price * quantity;
    if (cost > game.money()) return impossible(`${quantity} ${item} cost ${cost} and the money is ${game.money()}`);
    const refused = quantityRefusal("buy", item, quantity, MAX_TRADE);
    if (refused) return refused;
    const list = () => game.buyList();
    const opened = list() ? DONE : this.shopOption(SHOP_BUY, () => list() !== null, "the buy list");
    if (opened.status !== "done") return opened;
    const moved = this.moveMenuCursor(row, () => list()?.row ?? null);
    if (moved.status !== "done") return moved;
    return this.backToMenu(this.trade(quantity), () => this.toShopMenu());
  }

  sell(item: string, quantity: number): Outcome {
    const { game } = this;
    const { place, refusal } = sale(item, game.findInBag(item));
    if (refusal !== null) return impossible(refusal);
    const most = Math.min(game.bagQuantity(place.item), MAX_TRADE);
    const refused = quantityRefusal("sell", item, quantity, most);
    if (refused) return refused;
    const menu = this.toShopMenu();
    if (menu.status !== "done") return menu;
    const opened = this.shopOption(SHOP_SELL, () => game.bagMenu()?.screen === "list", "the Bag");
    if (opened.status !== "done") return opened;
    const row = this.toBagItem(place);
    if (row.status !== "done") return row;
    return this.backToMenu(this.trade(quantity), () => this.toShopMenu());
  }

  withdraw(item: string, quantity: number): Outcome {
    const { game } = this;
    const items = game.pcItems();
    const row = items.findIndex((i) => i.name === item);
    if (row < 0) return impossible(`there is no ${item} in the PC`);
    const most = items[row].quantity;
    const refused = quantityRefusal("withdraw", item, quantity, most);
    if (refused) return refused;
    const opened = this.itemStorageOption(PC_WITHDRAW, () => game.itemPcRow() !== null);
    if (opened.status !== "done") return opened;
    const moved = this.moveMenuCursor(row, () => game.itemPcRow());
    if (moved.status !== "done") return moved;
    const menu = this.tapUntil(Keys.A, () => game.withdrawMenuCursor() !== null, "the menu of the item");
    if (menu.status !== "done") return menu;
    const withdrawn = this.moveMenuCursor(WITHDRAW_MENU_WITHDRAW, () => game.withdrawMenuCursor());
    if (withdrawn.status !== "done") return withdrawn;
    return this.backToMenu(this.transfer(item, quantity, "the Bag"), () => this.toItemStorage());
  }

  deposit(item: string, quantity: number): Outcome {
    const { game } = this;
    const place = game.findInBag(item);
    if (!place) return impossible(`there is no ${item} in the Bag`);
    if (place.pocket !== ITEMS_POCKET) return impossible("only the items of the ITEMS pocket go into the PC");
    const most = game.bagQuantity(place.item);
    const refused = quantityRefusal("deposit", item, quantity, most);
    if (refused) return refused;
    const opened = this.itemStorageOption(PC_DEPOSIT, () => game.bagMenu()?.screen === "list");
    if (opened.status !== "done") return opened;
    const row = this.toBagItem(place);
    if (row.status !== "done") return row;
    return this.backToMenu(this.transfer(item, quantity, "the PC"), () => this.toItemStorage());
  }

  depositPokemon(slot: number): Outcome {
    const { game } = this;
    const party = game.party();
    const missing = this.missingPokemon(slot);
    if (missing) return missing;
    if (party.length === 1) return impossible("your party has only 1 Pokémon: a Pokémon must stay with you");
    if (!party.some((mon, other) => other !== slot && mon.hp > 0 && !mon.isEgg)) return impossible(`${party[slot].nickname} is the last Pokémon of your party that can fight`);
    const box = freeBox(game.boxMons(), game.currentBox());
    if (box === null) return impossible("all the boxes are full");
    return this.inBoxes(PC_DEPOSIT, [
      () => this.moveMenuCursor(slot, () => this.boxesIn("party")?.position ?? null),
      () => this.menuInput(Keys.A, () => this.onStorage("monMenu")),
      () => this.toBoxChoice(),
      () => this.moveMenuCursor(box, () => this.boxChoice(), toward(box, Keys.Right, Keys.Left)),
      () => this.menuInput(Keys.A, () => this.boxesMain() !== null),
    ]);
  }

  withdrawPokemon(box: number, position: number): Outcome {
    const { game } = this;
    if (game.party().length === PARTY_SIZE) return impossible(`your party has ${PARTY_SIZE} Pokémon: deposit one first`);
    if (!game.boxMons().some((mon) => mon.box === box && mon.position === position)) return impossible("there is no Pokémon at this place of the boxes");
    return this.inBoxes(PC_WITHDRAW, [
      () => this.toBox(box),
      () => this.moveMenuCursor(position, () => this.boxesIn("box")?.position ?? null, choiceKey(position, IN_BOX_COLUMNS)),
      () => this.menuInput(Keys.A, () => this.onStorage("monMenu")),
      () => this.menuInput(Keys.A, () => this.boxesMain() !== null),
    ]);
  }

  leave(): Outcome & Texts {
    const { kind } = this.game.waitingFor();
    if (kind === "itemPc" || kind === "pokemonPc") return withText(this.input(Keys.B));
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

  tap(keys: number): "battle" | null {
    return tap(this.frames, keys);
  }

  readText(): Outcome & Texts {
    const reader = new MessageReader(this.game);
    for (let presses = 0; presses < MAX_TEXT_PRESSES; presses++) {
      const outcome = this.untilDecision(() => reader.update());
      // A press of the model on the move menu can open the target screen. No action covers it, so the Bot presses B.
      if (outcome.status === "done" && this.game.battleTargetCursor() !== null) return { ...impossible("the game waits for the target of a move"), text: reader.text };
      if (outcome.status !== "done" || this.game.waitingFor().kind !== "text") return { ...outcome, text: reader.text };
      if (reader.closedAfterPress) return { status: "done", text: reader.textBeforeWaitingText() };
      const battle = tap(this.frames, Keys.A);
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
    const closed = this.input(Keys.B);
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

  useFlash(slot: number): Outcome {
    const { game } = this;
    const opened = this.openStartMenu(START_MENU_POKEMON, () => this.pickMenu() !== null);
    if (opened.status !== "done") return opened;
    const actions = this.openPartyActions(slot);
    if (actions.status !== "done") return actions;
    const chosen = this.selectPartyAction((options) => options.indexOf(FLASH_ACTION), () => game.flashActive());
    return chosen.status === "done" ? this.untilReady(() => game.waitingFor().kind === "walk") : chosen;
  }

  private namingScreen() {
    const screen = this.game.namingScreen();
    return screen?.phase === "input" ? screen : null;
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

  missingPokemon(slot: number): Outcome | null {
    return this.game.party()[slot] ? null : impossible(`the party has no Pokémon ${slot}`);
  }

  pickMenu() {
    const menu = this.game.partyMenu();
    return menu?.kind === "pick" ? menu : null;
  }

  private shopOption(option: number, shown: () => boolean, screen: string): Outcome {
    const moved = this.moveMenuCursor(option, () => this.game.shopMenu()?.cursor ?? null);
    return moved.status === "done" ? this.tapUntil(Keys.A, shown, screen) : moved;
  }

  // A refused trade stays in its list, and the Bag of the shop is not a Decision point: go back to the menu also then. The same is true for a transfer of the item PC.
  private backToMenu(done: Outcome, toMenu: () => Outcome): Outcome {
    if (done.status === "interrupted") return done;
    const back = toMenu();
    return done.status === "done" || back.status !== "done" ? back : done;
  }

  private toShopMenu(): Outcome {
    const { game } = this;
    return game.shopMenu() ? DONE : this.tapUntil(Keys.B, () => game.shopMenu() !== null, "the shop menu");
  }

  toBagItem(place: BagPlace): Outcome {
    const { game } = this;
    const list = () => {
      const menu = game.bagMenu();
      return menu?.screen === "list" ? menu : null;
    };
    const pocket = this.moveMenuCursor(place.pocket, () => list()?.pocket ?? null, toward(place.pocket, Keys.Right, Keys.Left));
    if (pocket.status !== "done") return pocket;
    return this.moveMenuCursor(place.row, () => list()?.row ?? null);
  }

  /** Opens the quantity box with A, sets the quantity and confirms it. `next` is true when the game shows what follows the box; the game can skip the box. */
  private setQuantity(quantity: number, count: () => number | null, next: () => boolean, after: string): Outcome {
    const box = this.tapUntil(Keys.A, () => count() !== null || next(), "the quantity box");
    if (box.status !== "done" || count() === null) return box;
    const inBox = (keys: number) => this.tapUntil(keys, () => count() !== null, "the quantity box");
    const moved = this.moveCursor(quantity, count, (at) => quantityKey(at, quantity), inBox);
    return moved.status === "done" ? this.tapUntil(Keys.A, next, after) : moved;
  }

  private trade(quantity: number): Outcome {
    const { game } = this;
    const box = this.setQuantity(quantity, () => game.tradeQuantity(), () => game.tradeYesNo() !== null, "the yes/no");
    if (box.status !== "done") return box;
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

  private toItemStorage(): Outcome {
    const { game } = this;
    return game.itemStorageCursor() !== null ? DONE : this.menuInput(Keys.B, () => game.itemStorageCursor() !== null);
  }

  private boxesMain() {
    const screen = this.game.storageScreen();
    return screen?.screen === "main" ? screen : null;
  }

  private boxesIn(area: (StorageScreen & { screen: "main" })["area"]) {
    const main = this.boxesMain();
    return main?.area === area ? main : null;
  }

  private onStorage(screen: StorageScreen["screen"]): boolean {
    return this.game.storageScreen()?.screen === screen;
  }

  private boxChoice(): number | null {
    const screen = this.game.storageScreen();
    return screen?.screen === "boxChoice" ? screen.box : null;
  }

  /** Opens the boxes, plays the steps, and closes the boxes also after a step that fails: the boxes are not a Decision point. */
  private inBoxes(option: number, steps: (() => Outcome)[]): Outcome {
    const moved = this.moveMenuCursor(option, () => this.game.pokemonPcCursor());
    if (moved.status !== "done") return moved;
    const opened = this.menuInput(Keys.A, () => this.boxesMain() !== null);
    if (opened.status !== "done") return opened;
    for (const step of steps) {
      const outcome = step();
      if (outcome.status !== "done") return this.backToMenu(outcome, () => this.closeBoxes());
    }
    return this.closeBoxes();
  }

  private toBoxChoice(): Outcome {
    const shown = this.menuInput(Keys.A, () => this.boxChoice() !== null || this.onStorage("monRefusal"));
    return shown.status === "done" && this.onStorage("monRefusal") ? impossible("the game refuses this deposit") : shown;
  }

  private toBox(box: number): Outcome {
    if (this.boxesMain()?.box === box) return DONE;
    const onTitle = this.menuInput(Keys.Up, () => this.boxesIn("title") !== null);
    if (onTitle.status !== "done") return onTitle;
    const shown = this.moveMenuCursor(box, () => this.boxesIn("title")?.box ?? null, toward(box, Keys.Right, Keys.Left));
    return shown.status === "done" ? this.menuInput(Keys.Down, () => this.boxesIn("box") !== null) : shown;
  }

  // Task_OnBPressed: at the main screen, B asks to continue, and a second B answers NO.
  private closeBoxes(): Outcome {
    const { game } = this;
    for (let presses = 0; presses < MAX_CLOSE_PRESSES && game.pokemonPcCursor() === null; presses++) {
      const before = game.storageScreen()?.screen;
      const changed = this.menuInput(Keys.B, () => {
        const now = game.storageScreen()?.screen;
        return game.pokemonPcCursor() !== null || (now !== undefined && now !== before);
      });
      if (changed.status !== "done") return changed;
    }
    return game.pokemonPcCursor() === null ? impossible("the boxes do not close") : DONE;
  }

  private transfer(item: string, quantity: number, place: string): Outcome {
    const { game } = this;
    const box = this.setQuantity(quantity, () => game.pcQuantity(), () => game.pcTransfer() !== null, "the end of the transfer");
    if (box.status !== "done") return box;
    const refused = game.pcTransfer() === "refused";
    // The message reads the keys on the frames after it shows.
    const back = this.menuInput(Keys.A, () => game.itemPcRow() !== null || game.bagMenu()?.screen === "list");
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

  openStartMenu(option: string, shown: () => boolean): Outcome {
    const { game } = this;
    const opened = this.menuInput(Keys.Start, () => game.startMenu() !== null);
    if (opened.status !== "done") return opened;
    const item = game.startMenu()?.options.indexOf(option) ?? -1;
    if (item < 0) return impossible(`the Start menu has no ${option}`);
    const moved = this.moveMenuCursor(item, () => game.startMenu()?.cursor ?? null);
    return moved.status === "done" ? this.menuInput(Keys.A, shown) : moved;
  }

  closeStartMenu(): Outcome {
    const { game } = this;
    const closed = this.menuInput(Keys.B, () => game.startMenu() !== null);
    return closed.status === "done" ? this.menuInput(Keys.B, () => game.waitingFor().kind === "walk") : closed;
  }

  openPartyActions(menuSlot: number): Outcome {
    const { game } = this;
    const moved = this.moveMenuCursor(menuSlot, () => this.pickMenu()?.cursor ?? null);
    return moved.status === "done" ? this.menuInput(Keys.A, () => game.partyMenu()?.kind === "actions") : moved;
  }

  selectPartyAction(find: (options: string[]) => number, done: () => boolean): Outcome {
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
    return this.input(Keys.A, watch);
  }

  moveCursor(target: number, read: () => number | null, key: (cursor: number) => number, press = (keys: number) => this.input(keys)): Outcome {
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

  moveMenuCursor(target: number, cursor: () => number | null, key = toward(target, Keys.Down, Keys.Up)): Outcome {
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

  menuInput(keys: number, ready: () => boolean): Outcome {
    const pressed = this.pressUntilRead(keys);
    return pressed.status === "done" ? this.untilReady(ready) : pressed;
  }

  // A menu reads the keys from the frame after the frame that shows it.
  tapUntil(keys: number, shown: () => boolean, screen: string): Outcome {
    const pressed = this.pressUntilRead(keys);
    if (pressed.status !== "done") return pressed;
    for (let frames = 0; !shown(); frames++) {
      if (frames === DECISION_FRAME_LIMIT) return impossible(`the game does not show ${screen} after ${DECISION_FRAME_LIMIT} frames`);
      if (this.frames.advance(0)) return BATTLE_INTERRUPTION;
    }
    return this.frames.advance(0) ? BATTLE_INTERRUPTION : { status: "done" };
  }

  // A slow frame of the game skips the keys, so a press of one frame can be lost.
  pressUntilRead(keys: number): Outcome {
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

  untilReady(ready: () => boolean, watch: () => void = () => {}): Outcome {
    for (let frames = 0; ; frames++) {
      watch();
      if (ready()) return { status: "done" };
      if (frames === DECISION_FRAME_LIMIT) return impossible(`the game waits for no known input for ${DECISION_FRAME_LIMIT} frames`);
      const screen = this.game.wordScreen();
      if (screen ? this.leaveWordScreen(screen) : this.frames.advance(0)) return BATTLE_INTERRUPTION;
    }
  }

  takeLeftWordScreen(): boolean {
    const left = this.leftWordScreen;
    this.leftWordScreen = false;
    return left;
  }

  // B opens a menu to quit with its cursor on NO (easy_chat_3.c): Up, then A, chooses YES.
  private leaveWordScreen({ quitMenu }: WordScreen): "battle" | null {
    this.leftWordScreen = true;
    for (const keys of quitMenu ? [Keys.Up, Keys.A] : [Keys.B]) if (tap(this.frames, keys)) return "battle";
    return null;
  }
}
