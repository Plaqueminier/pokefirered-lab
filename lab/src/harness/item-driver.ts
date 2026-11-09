import { type BagPlace, BERRY_POUCH_POCKET, POKE_BALLS_POCKET, TM_CASE_POCKET } from "../bag";
import type { Game, WaitingFor } from "../game";
import { isHmMove, type PartyMon } from "../party";
import { Keys } from "../protocol";
import { DONE, gridKey, impossible, type MenuDriver, MessageReader, type Outcome, START_MENU_POKEMON, type Texts, toward, withText } from "./menu-driver";

const BAG_CURSOR = 1;
const START_MENU_BAG = "BAG";
const YES = 0;
const NO = 1;
const ITEM_MENU_REGISTER = 1;
// The second option in sContextMenuItems_Field and in sOptions_UseGiveTossExit of the game.
const ITEM_MENU_GIVE = 1;
const ITEM_ACTION = "ITEM";
const TAKE_ACTION = "TAKE";

type ItemResult = Outcome & Partial<Texts>;

export class ItemDriver {
  constructor(
    private readonly game: Game,
    private readonly menus: MenuDriver,
  ) {}

  use(item: string, on?: number, move?: string): ItemResult {
    const { game } = this;
    const walk = game.waitingFor().kind === "walk";
    const place = this.usablePlace(item, on, walk, move);
    if ("status" in place) return place;
    const before = game.bagQuantity(place.item);
    const opened = walk ? this.openBagOnWalk() : this.openBagInBattle();
    if (opened.status !== "done") return opened;
    const context = this.toItemMenu(item, place);
    if (context.status !== "done") return context;
    const picked = on === undefined ? DONE : this.toPokemon(walk ? on : game.battleMenuSlot(on));
    if (picked.status !== "done") return picked;
    if (move !== undefined && on !== undefined) {
      const moved = this.toMove(on, move);
      if (moved.status !== "done") return moved;
    }
    if (!walk) return this.useInBattle(item, place.item, before);
    return on === undefined ? this.useAloneOnWalk(item, place.item, before) : this.useOnPokemon(item, place.item, before, on);
  }

  register(item: string): Outcome {
    const { game, menus } = this;
    const place = game.findInBag(item);
    if (!place) return impossible(`there is no ${item} in the Bag`);
    const context = this.openToItemMenu(item, place);
    if (context.status !== "done") return context;
    const moved = menus.moveMenuCursor(ITEM_MENU_REGISTER, () => game.bagMenu()?.menuCursor ?? null);
    if (moved.status !== "done") return moved;
    const back = menus.menuInput(Keys.A, () => game.bagMenu()?.screen === "list");
    return back.status === "done" ? menus.closeStartMenu() : back;
  }

  usablePlace(item: string, on: number | undefined, walk: boolean, move?: string): BagPlace | Outcome {
    const { game } = this;
    const place = game.findInBag(item);
    if (!place || place.pocket === TM_CASE_POCKET) return impossible(`there is no ${item} in the Bag${walk ? "" : " of a battle"}`);
    const use = walk ? place.walk : place.battle;
    if (!use) return impossible(`${item} does not work ${walk ? "outside" : "in"} a battle`);
    if (!walk && place.pocket === POKE_BALLS_POCKET && game.requireBattle().kind === "trainer") return impossible("the trainer blocks a ball: there is no catching in a trainer battle");
    if (use === "alone" && on !== undefined) return impossible(`${item} does not work on a Pokémon`);
    if (use !== "alone" && on === undefined) return impossible(`${item} works on a Pokémon: give the Pokémon`);
    if (use !== "move" && move !== undefined) return impossible(`${item} does not work on one move`);
    const refused = on === undefined ? null : this.pokemonRefusal(on);
    if (refused) return refused;
    if (use === "move" && on !== undefined && !game.party()[on].moves.some((known) => known.name === move)) return impossible(`${item} works on one move: give a move of ${game.party()[on].nickname}: ${moveNames(game.party()[on])}`);
    return place;
  }

  teach(item: string, on: number): ItemResult {
    const { game, menus } = this;
    const teachable = game.teachables().find((t) => t.item === item);
    if (!teachable) return impossible(`there is no ${item} in the TM Case`);
    const missing = menus.missingPokemon(on);
    if (missing) return missing;
    const { nickname } = game.party()[on];
    const move = teachable.move.name;
    if (teachable.knowing.includes(on)) return impossible(`${nickname} already knows ${move}`);
    if (!teachable.able.includes(on)) return impossible(`${nickname} cannot learn ${move}`);
    const place = game.findInBag(item);
    if (!place) return impossible(`there is no ${item} in the TM Case`);
    const context = this.openToItemMenu(item, place);
    if (context.status !== "done") return context;
    const picked = this.toPokemon(on);
    if (picked.status !== "done") return picked;
    const pressed = menus.pressUntilRead(Keys.A);
    return pressed.status === "done" ? this.finishLearning(on, move) : pressed;
  }

  forget(move: string): ItemResult {
    const { game, menus } = this;
    const learn = game.waitingFor();
    if (learn.kind !== "learnMove") throw new Error("forget is available only at a learnMove");
    const pokemon = game.party()[learn.slot];
    const slot = pokemon.moves.findIndex((m) => m.name === move);
    if (slot < 0) return impossible(`${pokemon.nickname} does not know ${move}: its moves are ${moveNames(pokemon)}`);
    if (isHmMove(move)) return impossible(`${move} is an HM move, and HM moves cannot be forgotten now`);
    const yes = this.answerLearnMove(YES);
    if (yes.status !== "done") return yes;
    const shown = this.showForgetMoves();
    if (shown.status !== "done") return shown;
    const moved = menus.moveMenuCursor(slot, () => game.forgetMoveCursor());
    return moved.status === "done" ? this.endLearnMove(learn) : moved;
  }

  keep(): ItemResult {
    const { game, menus } = this;
    const learn = game.waitingFor();
    if (learn.kind !== "learnMove") throw new Error("keep is available only at a learnMove");
    const no = this.answerLearnMove(NO);
    if (no.status !== "done") return no;
    const asked = menus.tapUntil(Keys.A, () => game.learnMoveBox()?.question === "stop", "the question to stop learning the move");
    return asked.status === "done" ? this.endLearnMove(learn) : asked;
  }

  give(item: string, on: number): ItemResult {
    const { game, menus } = this;
    const place = game.findInBag(item);
    if (!place) return impossible(`there is no ${item} in the Bag`);
    if (!place.holdable) return impossible(`${item} has no effect when a Pokémon holds it`);
    const refused = this.pokemonRefusal(on);
    if (refused) return refused;
    const { nickname, heldItem: held } = game.party()[on];
    if (held?.name === item) return impossible(`${nickname} already holds ${item}`);
    if (held?.mail) return impossible(mailRefusal(nickname, held.name));
    const context = this.openToItemMenu(item, place);
    if (context.status !== "done") return context;
    const moved = menus.moveMenuCursor(ITEM_MENU_GIVE, () => this.itemMenuCursor());
    if (moved.status !== "done") return moved;
    const picked = this.toPokemon(on);
    if (picked.status !== "done") return picked;
    // At the question of a swap, the cursor starts on YES, so the A of the scene answers it.
    const given = this.pressThroughScene(() => this.itemListShown());
    if (given.status !== "done") return given;
    const closed = this.closeItemLists();
    if (closed.status !== "done") return closed;
    if (game.party()[on].heldItem?.name !== item) return impossible(`the Bag has no room for ${held?.name}`);
    return { status: "done", text: [`${nickname} holds ${item}.`, ...(held ? [`${held.name} went back to the Bag.`] : [])] };
  }

  take(on: number): ItemResult {
    const { game, menus } = this;
    const refused = this.pokemonRefusal(on);
    if (refused) return refused;
    const { nickname, heldItem: held } = game.party()[on];
    if (!held) return impossible(`${nickname} holds no item`);
    if (held.mail) return impossible(mailRefusal(nickname, held.name));
    const opened = menus.openStartMenu(START_MENU_POKEMON, () => menus.pickMenu() !== null);
    if (opened.status !== "done") return opened;
    const actions = menus.openPartyActions(on);
    if (actions.status !== "done") return actions;
    const items = menus.selectPartyAction((options) => options.indexOf(ITEM_ACTION), () => this.partyActionsHave(TAKE_ACTION));
    if (items.status !== "done") return items;
    const chosen = menus.selectPartyAction((options) => options.indexOf(TAKE_ACTION), () => !this.partyActionsHave(TAKE_ACTION));
    if (chosen.status !== "done") return chosen;
    const taken = this.sceneUntil(() => menus.pickMenu() !== null);
    if (taken.status !== "done") return taken;
    const closed = menus.closeStartMenu();
    if (closed.status !== "done") return closed;
    return game.party()[on].heldItem ? impossible(`the Bag has no room for ${held.name}`) : { status: "done", text: [`${held.name} of ${nickname} went to the Bag.`] };
  }

  // IsSelectedMonNotEgg: the game refuses an Egg with a sound and no text, and it stays in the party menu.
  private pokemonRefusal(on: number): Outcome | null {
    const pokemon = this.game.party()[on];
    return this.menus.missingPokemon(on) ?? (pokemon.isEgg ? impossible(`${pokemon.nickname} is an Egg, and the game allows no item on an Egg`) : null);
  }

  private openToItemMenu(item: string, place: BagPlace): Outcome {
    const opened = this.openBagOnWalk();
    return opened.status === "done" ? this.toItemMenu(item, place) : opened;
  }

  private partyActionsHave(option: string): boolean {
    const menu = this.game.partyMenu();
    return menu?.kind === "actions" && menu.options.includes(option);
  }

  private openBagOnWalk(): Outcome {
    return this.menus.openStartMenu(START_MENU_BAG, () => this.game.bagMenu()?.screen === "list");
  }

  private openBagInBattle(): Outcome {
    const { game, menus } = this;
    const cursor = () => (game.waitingFor().kind === "battleAction" ? game.battleCursor("battleAction") : null);
    const moved = menus.moveCursor(BAG_CURSOR, cursor, (at) => gridKey(at, BAG_CURSOR));
    if (moved.status !== "done") return moved;
    return menus.tapUntil(Keys.A, () => game.bagMenu()?.screen === "list", "the Bag");
  }

  private toItemMenu(item: string, place: BagPlace): Outcome {
    const { game, menus } = this;
    const list = this.itemListOf(place.pocket);
    if (!list) return this.toBagItemMenu(place);
    const keyItem = game.findInBag(list.keyItem);
    if (!keyItem) return impossible(`there is no ${list.keyItem} in the Bag`);
    const context = this.toBagItemMenu(keyItem);
    if (context.status !== "done") return context;
    const shown = menus.tapUntil(Keys.A, () => list.row() !== null, `the list of the ${list.keyItem}`);
    if (shown.status !== "done") return shown;
    // The game sorts these pockets when they open (SortAndCountBerries, InitTMCase): the row of an item changes.
    const sorted = game.findInBag(item);
    if (!sorted) return impossible(`there is no ${item} in the ${list.keyItem}`);
    const row = menus.moveMenuCursor(sorted.row, list.row);
    return row.status === "done" ? menus.tapUntil(Keys.A, list.contextShown, "the menu of the item") : row;
  }

  private itemListOf(pocket: number): { keyItem: string; row: () => number | null; contextShown: () => boolean } | null {
    const { game } = this;
    if (pocket === TM_CASE_POCKET) return { keyItem: "TM CASE", row: () => game.tmCaseRow(), contextShown: () => game.tmCaseItemMenu() };
    if (pocket === BERRY_POUCH_POCKET) return { keyItem: "BERRY POUCH", row: () => this.berryPouchRow(), contextShown: () => game.berryPouchMenu()?.screen === "context" };
    return null;
  }

  private toBagItemMenu(place: BagPlace): Outcome {
    const { game, menus } = this;
    const row = menus.toBagItem(place);
    return row.status === "done" ? menus.tapUntil(Keys.A, () => game.bagMenu()?.screen === "context", "the menu of the item") : row;
  }

  private berryPouchRow(): number | null {
    const menu = this.game.berryPouchMenu();
    return menu?.screen === "list" ? menu.row : null;
  }

  private itemMenuCursor(): number | null {
    const pouch = this.game.berryPouchMenu();
    return pouch?.screen === "context" ? pouch.menuCursor : (this.game.bagMenu()?.menuCursor ?? null);
  }

  private toPokemon(menuSlot: number): Outcome {
    const { menus } = this;
    const party = menus.tapUntil(Keys.A, () => menus.pickMenu() !== null, "the party menu");
    return party.status === "done" ? menus.moveMenuCursor(menuSlot, () => menus.pickMenu()?.cursor ?? null) : party;
  }

  private toMove(on: number, move: string): Outcome {
    const { game, menus } = this;
    const window = menus.tapUntil(Keys.A, () => game.ppMoveCursor() !== null, "the moves of the Pokémon");
    if (window.status !== "done") return window;
    return menus.moveMenuCursor(game.party()[on].moves.findIndex((known) => known.name === move), () => game.ppMoveCursor());
  }

  private useInBattle(item: string, id: number, before: number): ItemResult {
    const { game, menus } = this;
    const reader = new MessageReader(game);
    const pressed = menus.pressUntilRead(Keys.A);
    if (pressed.status !== "done") return pressed;
    const used = menus.untilDecision(() => reader.update());
    if (used.status !== "done") return used;
    if (!game.battleScreen() && game.bagQuantity(id) === before) return this.refusedInBattle(item, game.waitingTexts().join(" "));
    const effect = game.battleScreen() ? [] : game.waitingTexts();
    if (effect.length > 0) {
      const after = menus.input(Keys.A, () => reader.update());
      if (after.status !== "done") return after;
    }
    return { status: "done", text: [...effect, ...reader.textBeforeWaitingText()] };
  }

  private refusedInBattle(item: string, message: string): Outcome {
    const { game, menus } = this;
    const back = menus.tapUntil(Keys.A, () => this.itemListShown(), "the Bag");
    if (back.status !== "done") return back;
    const bag = game.bagMenu() ? DONE : menus.tapUntil(Keys.B, () => game.bagMenu()?.screen === "list", "the Bag");
    if (bag.status !== "done") return bag;
    const closed = menus.input(Keys.B);
    return closed.status === "done" ? impossible(`the game refuses the ${item}: ${message}`) : closed;
  }

  // The REPEL items go back to the Bag and then to the field. ESCAPE ROPE closes the Bag and shows its text on the field, then warps to another map.
  private useAloneOnWalk(item: string, id: number, before: number): ItemResult {
    const { game, menus } = this;
    const pressed = menus.pressUntilRead(Keys.A);
    if (pressed.status !== "done") return pressed;
    const told = menus.untilReady(() => game.waitingTexts().length > 0);
    if (told.status !== "done") return told;
    const text = game.waitingTexts();
    if (game.mode() === "overworld") {
      const escaped = menus.input(Keys.A);
      return escaped.status === "done" ? { status: "done", text } : withText(escaped, text);
    }
    const back = menus.menuInput(Keys.A, () => game.bagMenu()?.screen === "list");
    if (back.status !== "done") return withText(back, text);
    const closed = menus.closeStartMenu();
    if (closed.status !== "done") return withText(closed, text);
    return game.bagQuantity(id) === before ? impossible(`the game refuses the ${item}: ${text.join(" ")}`) : { status: "done", text };
  }

  private useOnPokemon(item: string, id: number, before: number, on: number): ItemResult {
    const { game } = this;
    const { species: speciesBefore, nickname } = game.party()[on];
    const text: string[] = [];
    const ended = this.pressThroughScene(() => this.itemListShown() || this.asksToLearn(), text);
    if (ended.status !== "done" || this.asksToLearn()) return withText(ended, text);
    const closed = this.closeItemLists();
    if (closed.status !== "done") return withText(closed, text);
    // A stone that the game refuses shows only "Huh?" in its scene: no window has a text to read.
    if (game.bagQuantity(id) === before) return impossible(text.length > 0 ? `the game refuses the ${item}: ${text.join(" ")}` : `the game refuses the ${item}`);
    const { species } = game.party()[on];
    return { status: "done", text: species === speciesBefore ? text : [...text, `${nickname} evolved into ${species}!`] };
  }

  private pressThroughScene(ready: () => boolean, text: string[] = []): Outcome {
    const pressed = this.menus.pressUntilRead(Keys.A);
    return pressed.status === "done" ? this.sceneUntil(ready, text) : pressed;
  }

  // B cancels the scene of a TM, and A only passes its texts (pokemon_special_anim.c).
  private sceneUntil(ready: () => boolean, text: string[] = []): Outcome {
    const { game, menus } = this;
    return menus.untilReady(ready, () => {
      const waiting = game.waitingTexts();
      for (const line of waiting) if (text.at(-1) !== line) text.push(line);
      if (!ready() && (waiting.length > 0 || game.itemSceneRuns())) menus.tap(Keys.A);
    });
  }

  private asksToLearn(): boolean {
    return this.game.learnMoveBox()?.question === "learn";
  }

  private itemListShown(): boolean {
    const { game } = this;
    return game.bagMenu()?.screen === "list" || game.tmCaseRow() !== null || game.berryPouchMenu()?.screen === "list";
  }

  private closeItemLists(): Outcome {
    const { game, menus } = this;
    const bag = game.bagMenu() ? DONE : menus.menuInput(Keys.B, () => game.bagMenu()?.screen === "list");
    return bag.status === "done" ? menus.closeStartMenu() : bag;
  }

  private finishLearning(slot: number, move: string): ItemResult {
    const { game } = this;
    const after = this.sceneUntil(() => this.itemListShown() || this.asksToLearn());
    if (after.status !== "done" || this.asksToLearn()) return after;
    const closed = this.closeItemLists();
    if (closed.status !== "done") return withText(closed);
    const { nickname, moves } = game.party()[slot];
    return withText(DONE, [moves.some((known) => known.name === move) ? `${nickname} learned ${move}!` : `${nickname} did not learn the move ${move}.`]);
  }

  private showForgetMoves(): Outcome {
    const { game, menus } = this;
    const moves = () => game.forgetMoveCursor() !== null;
    const screen = "the moves of the Pokémon";
    if (game.learnsInBattleWindows()) return menus.tapUntil(Keys.A, moves, screen);
    const text = menus.tapUntil(Keys.A, () => game.waitingTexts().length > 0, "the question of the move to forget");
    return text.status === "done" ? menus.tapUntil(Keys.A, moves, screen) : text;
  }

  private endLearnMove({ slot, move }: Extract<WaitingFor, { kind: "learnMove" }>): ItemResult {
    const { game, menus } = this;
    if (game.mode() === "battle") return menus.input(Keys.A);
    const pressed = menus.pressUntilRead(Keys.A);
    return pressed.status === "done" ? this.finishLearning(slot, move.name) : pressed;
  }

  private answerLearnMove(target: number): Outcome {
    return this.menus.moveCursor(target, () => this.game.learnMoveBox()?.cursor ?? null, toward(target, Keys.Down, Keys.Up));
  }
}

function moveNames({ moves }: PartyMon): string {
  return moves.map((known) => known.name).join(", ");
}

function mailRefusal(nickname: string, mail: string): string {
  return `${nickname} holds ${mail}, and the program does not take Mail`;
}
