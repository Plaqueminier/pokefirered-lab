// Frames run only inside a Macro-action or a Raw input: the game is frozen at each Decision point (docs/adr/0002).
import { readdir } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { BATTLE_POCKETS, type BagPlace, type BagPocket, battleItems, walkItems } from "../bag";
import { type Battle, type BattleMenu, type BattleMon, BattleWatch, type EnemyMon, enemyView } from "../battle";
import {
  DIRECTION_STEP,
  DIRECTION_STEPS,
  type Direction,
  type Game,
  type GameInterruption,
  type GameState,
  type MapActors,
  type MapGrid,
  MILESTONES,
  type Milestone,
  type PlayerPosition,
  type WaitingFor,
} from "../game";
import { type PartyMon, sendableSlots } from "../party";
import type { Messages } from "../prompts";
import { type BotInfo, Keys } from "../protocol";
import { Run, START_SAVE } from "../run";
import { type Atlas, AtlasWatch, type Sight } from "./atlas";
import { destinationOf, findRoute, type Leg, MAX_ROUTE_MAPS, type MapSource, type Place, type RouteMap, reached } from "./path";
import {
  ButtonTrack,
  GameWatch,
  type ModelAnswer,
  type ModelEvent,
  type ModelOptions,
  type ModelSettings,
  modelTotals,
  type RunEvent,
  type RunHeader,
  type RunRecord,
  type SummaryAnswer,
  type SummaryEvent,
} from "./record";

const STEP_FRAME_LIMIT = 60;
const SETTLE_FRAME_LIMIT = 600;
const DECISION_FRAME_LIMIT = 3600;
const MAX_TEXT_PRESSES = 256;
const BLOCKED_TRIES = 3;
const BLOCKED_WAIT_FRAMES = 30;
const MAX_LEGS = 64;
const RIVAL_GRAPHICS = "BLUE";
const DIRECTION_KEYS: Record<Direction, number> = { south: Keys.Down, north: Keys.Up, west: Keys.Left, east: Keys.Right };
// readText also runs a busy game to its next text.
const ACCEPTS: Record<WaitingFor["kind"], AvailableAction["name"][]> = {
  walk: ["goTo", "interact", "swap", "use"],
  choice: ["choose"],
  text: ["readText"],
  battleAction: ["fight", "switch", "run", "use"],
  battleMove: ["fight"],
  partyPick: ["send"],
  buyList: ["buy", "sell"],
  busy: ["readText"],
};
// Each Macro-action is in ACCEPTS: a Macro-action that no kind accepts can never run.
export const MACRO_ACTIONS: readonly MacroAction["name"][] = [...new Set(Object.values(ACCEPTS).flat())];
const FIGHT_CURSOR = 0;
const BAG_CURSOR = 1;
const POKEMON_CURSOR = 2;
const RUN_CURSOR = 3;
const POKE_BALLS_POCKET = 2;
const SHOP_BUY = 0;
const SHOP_SELL = 1;
const MAX_TRADE = 99;
const START_MENU_POKEMON = "POKéMON";
const START_MENU_BAG = "BAG";
const SEND_OUT_ACTIONS = ["SEND OUT", "SHIFT"];
const SWAP_ACTION = "SWITCH";
const CURSOR_COLUMN = 1;
const CURSOR_ROW = 2;
export const KNOWLEDGE_LEVELS = ["player", "full"] as const;

export type KnowledgeLevel = (typeof KNOWLEDGE_LEVELS)[number];

export type BattleState = { kind: Battle["kind"]; player: Battle["player"]; enemy: EnemyMon };

type ObservationBase = { waitingFor: WaitingFor; party: PartyMon[]; bag: BagPocket[]; money: number; milestones: Milestone[]; atlas: Atlas };

/** The game tells the player the name of the rival at the start, so the player Knowledge level shows it. */
export type Person = Pick<MapActors["people"][number], "x" | "y" | "graphics"> & { rival?: string };

export type Observation = ObservationBase &
  ({ mode: "overworld"; map: GameState["map"]; player: PlayerPosition; grid: MapGrid; people: Person[] } | { mode: "battle"; battle: BattleState });

export type EndReason = "goal" | "bot stopped" | "user stop" | "cost limit" | "frame budget" | "no progress";

export type RunResult = { endReason: EndReason; frames: number; milestones: Milestone[]; rawInputs: number };

/** `since`: the number of events of the Run at the last progress. */
export type NoProgress = { decisions: number; since: number };

export type Interruption = GameInterruption | "map";

type LegResult = "done" | "stuck" | "no move" | "no warp" | Interruption;

type Outcome =
  | { status: "done" }
  | { status: "impossible"; reason: string }
  | { status: "blocked"; reason: string }
  | { status: "interrupted"; reason: Interruption };

export type ActionResult = Outcome & {
  frames: number;
};

type Texts = { text: string[] };

export type TextResult = ActionResult & Texts;

export type MacroAction =
  | { name: "goTo"; x: number; y: number; map?: string }
  | { name: "interact"; x: number; y: number }
  | { name: "readText" }
  | { name: "choose"; option: string }
  | { name: "fight"; move: number }
  | { name: "switch"; slot: number }
  | { name: "send"; slot: number }
  | { name: "swap"; first: number; second: number }
  | { name: "run" }
  | { name: "use"; item: string; on?: number }
  | { name: "buy"; item: string; quantity: number }
  | { name: "sell"; item: string; quantity: number };

export type AvailableAction =
  | { name: "goTo" }
  | { name: "swap" }
  | { name: "use" | "buy" | "sell"; item: string }
  | Exclude<MacroAction, { name: "goTo" | "swap" | "use" | "buy" | "sell" }>;

export type Button = keyof typeof Keys;

export type RawInput = { name: "press"; button: Button };

export type ActionEntry = { action: MacroAction | RawInput; result: ActionResult | TextResult };

const BOTS_DIR = join(import.meta.dir, "..", "..", "bots");

export async function botNames(): Promise<string[]> {
  return (await readdir(BOTS_DIR)).flatMap((file) => (file.endsWith(".ts") ? [file.slice(0, -3)] : [])).sort();
}

export async function loadBot(name: string, model: ModelOptions = {}): Promise<Bot> {
  const path = isAbsolute(name) ? name : join(BOTS_DIR, `${name}.ts`);
  const file = path === name ? name : `bots/${name}.ts`;
  const module = await import(path);
  if (typeof module.modelBot === "function") return module.modelBot(model);
  if (Object.values(model).some((option) => option !== undefined)) throw new Error(`${file} is not a model bot: it does not export modelBot(model)`);
  const bot: Bot | undefined = module.default;
  if (typeof bot?.play !== "function") throw new Error(`${file} must export by default a Bot: { name, version, play(harness) }`);
  return bot;
}

export async function botInfos(): Promise<BotInfo[]> {
  return Promise.all(
    (await botNames()).map((name) =>
      loadBot(name).then(
        (bot): BotInfo => ({ name, kind: bot.model ? "model" : "scripted", version: bot.version, goal: bot.goal ?? null }),
        (error: unknown): BotInfo => ({ name, error: errorText(error) }),
      ),
    ),
  );
}

export function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function must(result: ActionResult): void {
  if (result.status !== "done") throw new Error(`${result.status}${"reason" in result ? `: ${result.reason}` : ""}`);
}

type ActionListener = (entry: ActionEntry, harness: Harness) => void;

type ModelCallStartListener = (harness: Harness) => void;

type ModelCallListener = (event: ModelEvent, harness: Harness) => void;

type SummaryCallListener = (event: SummaryEvent, harness: Harness) => void;

export type HarnessOptions = {
  knowledge?: KnowledgeLevel;
  startSave?: string;
  onAction?: ActionListener;
  onFrame?: (harness: Harness) => void;
  onModelCallStart?: ModelCallStartListener;
  onModelCall?: ModelCallListener;
  onSummaryCall?: SummaryCallListener;
  frameBudget?: number;
  noProgressLimit?: number;
  /** When it gives true, the Run ends with "user stop" after the Macro-action, the Raw input or the Model call that plays. */
  stopAsked?: () => boolean;
};

export type Bot = {
  name: string;
  version: string;
  goal?: Milestone;
  model?: ModelSettings;
  frameBudget?: number;
  play(harness: Harness): Promise<void>;
};

class RunEnd extends Error {
  constructor(readonly reason: EndReason) {
    super(`the Run ends: ${reason}`);
  }
}

class RunLimits {
  #noProgress: NoProgress = { decisions: 0, since: 0 };

  constructor(
    private readonly goal: Milestone,
    private readonly lastFrame: number,
    private readonly noProgressLimit: number,
    private readonly costLimit: number,
    private progress: number,
  ) {}

  beforeFrame(frame: number): void {
    if (frame >= this.lastFrame) throw new RunEnd("frame budget");
  }

  get noProgress(): NoProgress {
    return this.#noProgress;
  }

  atDecision(milestones: Milestone[], progress: number, events: number): void {
    if (milestones.includes(this.goal)) throw new RunEnd("goal");
    this.#noProgress = progress > this.progress ? { decisions: 0, since: events } : { ...this.#noProgress, decisions: this.#noProgress.decisions + 1 };
    this.progress = progress;
    if (this.#noProgress.decisions >= this.noProgressLimit) throw new RunEnd("no progress");
  }

  afterCall(events: readonly RunEvent[]): void {
    if (modelTotals(events).cost > this.costLimit) throw new RunEnd("cost limit");
  }
}

type Phase = { kind: "ready" } | { kind: "playing"; limits: RunLimits } | { kind: "ended"; bot: RunHeader["bot"]; result: RunResult };

export class Harness {
  readonly #run: Run;
  readonly #knowledge: KnowledgeLevel;
  readonly #onAction?: ActionListener;
  readonly #onFrame?: (harness: Harness) => void;
  readonly #onModelCallStart?: ModelCallStartListener;
  readonly #onModelCall?: ModelCallListener;
  readonly #onSummaryCall?: SummaryCallListener;
  readonly #frameBudget?: number;
  readonly #noProgressLimit?: number;
  readonly #stopAsked: () => boolean;
  readonly #battles = new BattleWatch();
  readonly #buttons = new ButtonTrack();
  readonly #watch: GameWatch;
  readonly #atlas: AtlasWatch;
  readonly #events: RunEvent[] = [];
  #phase: Phase = { kind: "ready" };

  private constructor(run: Run, options: HarnessOptions) {
    this.#run = run;
    this.#knowledge = options.knowledge ?? "player";
    this.#onAction = options.onAction;
    this.#onFrame = options.onFrame;
    this.#onModelCallStart = options.onModelCallStart;
    this.#onModelCall = options.onModelCall;
    this.#onSummaryCall = options.onSummaryCall;
    this.#frameBudget = options.frameBudget;
    this.#noProgressLimit = options.noProgressLimit;
    this.#stopAsked = options.stopAsked ?? (() => false);
    this.#watch = new GameWatch(run.game);
    this.#atlas = new AtlasWatch(run.game);
  }

  /** The Harness owns the Run, also a Run that the caller opened: it closes the Run when the Run cannot start. */
  static async open(options: HarnessOptions = {}, run?: Run): Promise<Harness> {
    const startSave = run?.startSavePath ?? options.startSave ?? START_SAVE;
    if (!(await Bun.file(startSave).exists())) {
      run?.core.close();
      throw new Error(`${startSave} not found: make the Starting save first (lab/README.md)`);
    }
    const opened = run ?? (await Run.open(startSave));
    try {
      const harness = new Harness(opened, options);
      const interruption = harness.settle();
      if (interruption) throw new Error(`the game interrupts the start of the Run: ${interruption}`);
      return harness;
    } catch (error) {
      opened.core.close();
      throw error;
    }
  }

  get actions(): ActionEntry[] {
    return this.#events.flatMap((e) => (e.type === "action" ? [{ action: e.action, result: e.result }] : []));
  }

  get events(): readonly RunEvent[] {
    return this.#events;
  }

  get noProgress(): NoProgress {
    if (this.#phase.kind !== "playing") throw new Error("noProgress exists only while a Bot plays");
    return this.#phase.limits.noProgress;
  }

  get rawInputs(): number {
    return this.#events.filter((e) => e.type === "action" && e.action.name === "press").length;
  }

  get frame(): number {
    return this.#run.frame;
  }

  screenHash(): string {
    return this.#run.screenHash();
  }

  close(): void {
    this.#run.core.close();
  }

  async play(bot: Bot): Promise<RunResult> {
    if (this.#phase.kind !== "ready") throw new Error("a Harness plays one Run");
    const start = this.frame;
    const rawInputs = this.rawInputs;
    const frameBudget = this.#frameBudget ?? bot.frameBudget ?? Number.POSITIVE_INFINITY;
    const goal = bot.goal ?? MILESTONES[MILESTONES.length - 1];
    const limits = new RunLimits(goal, start + frameBudget, this.#noProgressLimit ?? Number.POSITIVE_INFINITY, bot.model?.costLimit ?? Number.POSITIVE_INFINITY, this.#watch.progress);
    this.#phase = { kind: "playing", limits };
    let endReason: EndReason = "bot stopped";
    let result: RunResult | null = null;
    try {
      await bot.play(this);
    } catch (error) {
      if (!(error instanceof RunEnd)) throw error;
      endReason = error.reason;
    } finally {
      result = { endReason, frames: this.frame - start, milestones: this.#run.game.milestones(), rawInputs: this.rawInputs - rawInputs };
      this.#phase = { kind: "ended", bot: { name: bot.name, version: bot.version, ...(bot.model ? { model: bot.model } : {}) }, result };
    }
    return result;
  }

  /** A model bot asks its AI model in `ask`, which must not throw an error. The Run record keeps the answer as a `model` event; the Harness returns the action to the Bot. */
  async modelCall<T>(ask: () => Promise<{ answer: ModelAnswer; action: T }>): Promise<T> {
    this.#onModelCallStart?.(this);
    const start = performance.now();
    const { answer, action } = await ask();
    const event: ModelEvent = { type: "model", frame: this.frame, latencyMs: Math.round(performance.now() - start), ...answer };
    this.#events.push(event);
    this.#onModelCall?.(event, this);
    if (this.#phase.kind === "playing") this.#phase.limits.afterCall(this.#events);
    this.stopIfAsked();
    return action;
  }

  async summaryCall(ask: () => Promise<SummaryAnswer>): Promise<SummaryEvent> {
    const start = performance.now();
    const answer = await ask();
    const event: SummaryEvent = { type: "summary", frame: this.frame, latencyMs: Math.round(performance.now() - start), ...answer };
    this.#events.push(event);
    this.#onSummaryCall?.(event, this);
    if (this.#phase.kind === "playing") this.#phase.limits.afterCall(this.#events);
    this.stopIfAsked();
    return event;
  }

  record(): RunRecord {
    if (this.#phase.kind !== "ended") throw new Error("no Run record: play a Bot first");
    const { bot, result } = this.#phase;
    const header = { ...this.#run.origin, knowledge: this.#knowledge, bot };
    return { header, buttons: this.#buttons.holds.map(([keys, frames]) => [keys, frames]), events: [...this.#events], result };
  }

  waitingFor(): WaitingFor {
    return this.#run.game.waitingFor();
  }

  sight(): Sight {
    return this.#atlas.sight();
  }

  observe(): Observation {
    const game = this.#run.game;
    const base = {
      waitingFor: game.waitingFor(),
      party: game.partyOnScreen(),
      bag: game.bag(),
      money: game.money(),
      milestones: game.milestones(),
      atlas: this.#atlas.atlas(this.#knowledge),
    };
    const battle = game.battle();
    if (battle) return { ...base, mode: "battle", battle: this.battleState(battle) };
    const { player, grid, actors } = this.overworld();
    const people = actors.people.map(({ x, y, graphics }): Person => (graphics === RIVAL_GRAPHICS ? { x, y, graphics, rival: game.rivalName() } : { x, y, graphics }));
    return { ...base, mode: "overworld", map: game.map(), player, grid, people };
  }

  availableActions(): AvailableAction[] {
    const waiting = this.#run.game.waitingFor();
    return ACCEPTS[waiting.kind].flatMap((name): AvailableAction[] => {
      switch (name) {
        case "goTo":
        case "readText":
          return [{ name }];
        case "swap":
          return this.#run.game.party().length > 1 ? [{ name }] : [];
        case "switch":
        case "send":
          return sendableSlots(this.#run.game.partyOnScreen(), this.battle().player.partyIndex).map((slot) => ({ name, slot }));
        case "interact":
          return this.interactions();
        case "choose":
          return waiting.kind === "choice" ? waiting.options.map((option) => ({ name, option })) : [];
        case "fight":
          return this.battle().player.moves.flatMap((m, move) => (m.pp > 0 ? [{ name, move }] : []));
        case "run":
          return this.battle().kind === "wild" ? [{ name }] : [];
        case "use": {
          const bag = this.#run.game.bag();
          return (waiting.kind === "walk" ? walkItems(bag) : battleItems(bag, this.battle().kind)).map((item) => ({ name, item: item.name }));
        }
        case "buy":
          return waiting.kind === "buyList" ? waiting.items.map((item) => ({ name, item: item.name })) : [];
        case "sell":
          return this.#run.game.bag().flatMap(({ items }) => items.flatMap((item) => (saleRefusal(item.name, this.#run.game.findInBag(item.name)) === null ? [{ name, item: item.name }] : [])));
      }
    });
  }

  async goTo(x: number, y: number, map?: string): Promise<ActionResult> {
    return this.act({ name: "goTo", x, y, ...(map ? { map } : {}) }, () => {
      const asked = { map: map ?? this.place().map, x, y };
      const destination = destinationOf(asked, map === undefined, this.routeMaps());
      let tries = 0;
      let stuckAt: Place | null = null;
      for (let legs = 0; legs < MAX_LEGS; legs++) {
        const here = this.place();
        if (reached(destination, here)) return { status: "done" };
        const maps = this.routeMaps();
        const route = findRoute(here, destination, maps);
        if (!route && !findRoute(here, destination, (name) => withoutPeople(maps(name)))) {
          return { status: "impossible", reason: `no route from ${at(here)} to ${at(asked)} in ${MAX_ROUTE_MAPS} maps` };
        }
        const result = route ? this.walkLeg(route[0], route[1]?.map ?? route[0].map) : "stuck";
        switch (result) {
          case "done":
            tries = 0;
            break;
          case "stuck": {
            const now = this.place();
            tries = stuckAt && at(stuckAt) === at(now) ? tries + 1 : 1;
            stuckAt = now;
            if (tries >= BLOCKED_TRIES) return { status: "blocked", reason: `a person stays in the way after ${tries} tries; the player is at ${at(now)}` };
            const interruption = this.wait(BLOCKED_WAIT_FRAMES);
            if (interruption) return { status: "interrupted", reason: interruption };
            break;
          }
          case "no move":
            return { status: "impossible", reason: `the player cannot move from ${at(this.place())}` };
          case "no warp":
            return { status: "impossible", reason: `the warp does not start from ${at(this.place())}` };
          default:
            return { status: "interrupted", reason: result };
        }
      }
      return { status: "impossible", reason: `the player is not at the target after ${MAX_LEGS} legs` };
    });
  }

  async interact(x: number, y: number): Promise<ActionResult> {
    return this.act({ name: "interact", x, y }, () => {
      const game = this.#run.game;
      const here = this.place();
      const direction = neighbours(here).find((n) => n.x === x && n.y === y)?.direction;
      if (!direction) return { status: "impossible", reason: `(${x}, ${y}) is not next to the player at ${at(here)}` };
      const turned = this.face(direction);
      if (turned.status !== "done") return turned;
      const battle = this.tap(Keys.A);
      if (battle) return { status: "interrupted", reason: battle };
      // ScriptContext_SetupScript locks the field controls, so an unlocked field means A started no script.
      if (!game.fieldLocked()) return { status: "impossible", reason: `nothing at (${x}, ${y}) starts a script` };
      return this.untilDecision();
    });
  }

  async readText(): Promise<TextResult> {
    return this.act<Texts>({ name: "readText" }, () => {
      const game = this.#run.game;
      const reader = new MessageReader(game);
      for (let presses = 0; presses < MAX_TEXT_PRESSES; presses++) {
        const outcome = this.untilDecision(() => reader.update());
        if (outcome.status !== "done" || game.waitingFor().kind !== "text") return { ...outcome, text: reader.text };
        if (reader.closedAfterPress) return { status: "done", text: reader.textBeforeWaitingText() };
        const battle = this.tap(Keys.A);
        if (battle) return { status: "interrupted", reason: battle, text: reader.text };
        reader.pressed();
      }
      return { status: "impossible", reason: `the text still waits for A after ${MAX_TEXT_PRESSES} presses`, text: reader.text };
    }, { text: [] });
  }

  async choose(option: string): Promise<ActionResult> {
    return this.act({ name: "choose", option }, () => {
      const game = this.#run.game;
      const choice = game.waitingFor();
      if (choice.kind !== "choice") throw new Error("choose is available only at a choice");
      const target = choice.options.indexOf(option);
      if (target < 0) return { status: "impossible", reason: `no option "${option}" in ${choice.options.join(", ")}` };
      const cursor = () => {
        const now = game.waitingFor();
        return now.kind === "choice" ? now.cursor : null;
      };
      const moved = this.moveCursor(target, cursor, (at) => (target > at ? Keys.Down : Keys.Up));
      return moved.status === "done" ? this.input(Keys.A) : moved;
    });
  }

  async fight(move: number): Promise<TextResult> {
    return this.act<Texts>({ name: "fight", move }, () => {
      const game = this.#run.game;
      const chosen = this.battle().player.moves[move];
      if (!chosen) return { status: "impossible", reason: `the Pokémon has no move ${move}` };
      if (chosen.pp === 0) return { status: "impossible", reason: `${chosen.name} has no PP` };
      if (game.waitingFor().kind === "battleAction") {
        const opened = this.select("battleAction", FIGHT_CURSOR);
        if (opened.status !== "done") return opened;
        if (game.waitingFor().kind !== "battleMove") return { status: "impossible", reason: "the move menu does not open" };
      }
      return this.turn("battleMove", move);
    }, { text: [] });
  }

  async run(): Promise<TextResult> {
    return this.act<Texts>({ name: "run" }, () => {
      if (this.battle().kind === "trainer") return { status: "impossible", reason: "there is no running from a trainer battle" };
      return this.turn("battleAction", RUN_CURSOR);
    }, { text: [] });
  }

  async use(item: string, on?: number): Promise<TextResult> {
    return this.act<Texts>({ name: "use", item, ...(on === undefined ? {} : { on }) }, () => {
      const game = this.#run.game;
      const walk = game.waitingFor().kind === "walk";
      const place = game.findInBag(item);
      if (!place || place.pocket >= BATTLE_POCKETS) return { status: "impossible", reason: `there is no ${item} in the Bag${walk ? "" : " of a battle"}` };
      const use = walk ? place.walk : place.battle;
      if (!use) return { status: "impossible", reason: `${item} does not work ${walk ? "outside" : "in"} a battle` };
      if (!walk && place.pocket === POKE_BALLS_POCKET && this.battle().kind === "trainer") return { status: "impossible", reason: "the trainer blocks a ball: there is no catching in a trainer battle" };
      if (use === "pokemon" && on === undefined) return { status: "impossible", reason: `${item} works on a Pokémon: give the Pokémon` };
      if (use === "alone" && on !== undefined) return { status: "impossible", reason: `${item} does not work on a Pokémon` };
      if (on !== undefined && !game.party()[on]) return { status: "impossible", reason: `the party has no Pokémon ${on}` };
      const before = game.bagQuantity(place.item);
      const opened = walk ? this.openStartMenu(START_MENU_BAG, () => game.bagMenu()?.screen === "list") : this.openBag();
      if (opened.status !== "done") return opened;
      const row = this.toBagItem(place);
      if (row.status !== "done") return row;
      const context = this.tapUntil(Keys.A, () => game.bagMenu()?.screen === "context", "the menu of the item");
      if (context.status !== "done") return context;
      const pick = () => {
        const menu = game.partyMenu();
        return menu?.kind === "pick" ? menu.cursor : null;
      };
      if (on !== undefined) {
        const party = this.tapUntil(Keys.A, () => pick() !== null, "the party menu");
        if (party.status !== "done") return party;
        const picked = this.moveMenuCursor(walk ? on : game.battleMenuSlot(on), pick);
        if (picked.status !== "done") return picked;
      }
      if (walk) return this.useOnWalk(item, place.item, before);
      const reader = new MessageReader(game);
      const pressed = this.pressUntilRead(Keys.A);
      if (pressed.status !== "done") return pressed;
      const used = this.untilDecision(() => reader.update());
      if (used.status !== "done") return used;
      if (!game.battleScreen() && game.bagQuantity(place.item) === before) return this.refused(item, game.waitingTexts().join(" "));
      const effect = game.battleScreen() ? [] : game.waitingTexts();
      if (effect.length > 0) {
        const after = this.input(Keys.A, () => reader.update());
        if (after.status !== "done") return after;
      }
      return { status: "done", text: [...effect, ...reader.textBeforeWaitingText()] };
    }, { text: [] });
  }

  async buy(item: string, quantity: number): Promise<ActionResult> {
    return this.act({ name: "buy", item, quantity }, () => {
      const game = this.#run.game;
      const list = () => game.buyList();
      const items = list()?.items ?? [];
      const row = items.findIndex((i) => i.name === item);
      if (row < 0) return { status: "impossible", reason: `the shop does not sell ${item}` };
      // The quantity box stops without error at the quantity that the money pays: check the money first.
      const cost = items[row].price * quantity;
      if (cost > game.money()) return { status: "impossible", reason: `${quantity} ${item} cost ${cost} and the money is ${game.money()}` };
      if (quantity < 1 || quantity > MAX_TRADE) return { status: "impossible", reason: `the quantity of ${item} to buy is 1 to ${MAX_TRADE}` };
      const inList = (keys: number) => this.tapUntil(keys, () => list() !== null, "the buy list");
      const moved = this.moveCursor(row, () => list()?.row ?? null, (at) => (row > at ? Keys.Down : Keys.Up), inList);
      return moved.status === "done" ? this.trade(quantity) : moved;
    });
  }

  async sell(item: string, quantity: number): Promise<ActionResult> {
    return this.act({ name: "sell", item, quantity }, () => {
      const game = this.#run.game;
      const place = game.findInBag(item);
      const refusal = saleRefusal(item, place);
      if (!place || refusal) return { status: "impossible", reason: refusal ?? `there is no ${item} in the Bag` };
      const most = Math.min(game.bagQuantity(place.item), MAX_TRADE);
      if (quantity < 1 || quantity > most) return { status: "impossible", reason: `the quantity of ${item} to sell is 1 to ${most}` };
      const menu = this.tapUntil(Keys.B, () => game.shopMenu() !== null, "the shop menu");
      if (menu.status !== "done") return menu;
      const opened = this.shopOption(SHOP_SELL, () => game.bagMenu()?.screen === "list", "the Bag");
      if (opened.status !== "done") return opened;
      const row = this.toBagItem(place);
      if (row.status !== "done") return row;
      const sold = this.trade(quantity);
      if (sold.status !== "done") return sold;
      const back = this.tapUntil(Keys.B, () => game.shopMenu() !== null, "the shop menu");
      return back.status === "done" ? this.shopOption(SHOP_BUY, () => game.buyList() !== null, "the buy list") : back;
    });
  }

  async switch(slot: number): Promise<TextResult> {
    return this.act<Texts>({ name: "switch", slot }, () => {
      const game = this.#run.game;
      if (!game.party()[slot]) return { status: "impossible", reason: `the party has no Pokémon ${slot}` };
      const opened = this.select("battleAction", POKEMON_CURSOR);
      if (opened.status !== "done") return opened;
      if (game.waitingFor().kind !== "partyPick") return { status: "impossible", reason: "the party menu does not open" };
      const sent = this.sendOut(game.battleMenuSlot(slot));
      if (sent.status !== "impossible") return sent;
      const closed = this.menuInput(Keys.B, () => game.waitingFor().kind !== "busy");
      return closed.status === "done" ? sent : { ...closed, text: sent.text };
    }, { text: [] });
  }

  async send(slot: number): Promise<TextResult> {
    return this.act<Texts>({ name: "send", slot }, () => {
      const game = this.#run.game;
      if (!game.party()[slot]) return { status: "impossible", reason: `the party has no Pokémon ${slot}` };
      return this.sendOut(game.battleMenuSlot(slot));
    }, { text: [] });
  }

  async swap(first: number, second: number): Promise<ActionResult> {
    return this.act({ name: "swap", first, second }, () => {
      const game = this.#run.game;
      const party = game.party();
      for (const slot of [first, second]) if (!party[slot]) return { status: "impossible", reason: `the party has no Pokémon ${slot}` };
      if (first === second) return { status: "impossible", reason: "a Pokémon cannot swap with itself" };
      const opened = this.openStartMenu(START_MENU_POKEMON, () => game.partyMenu()?.kind === "pick");
      if (opened.status !== "done") return opened;
      const actions = this.openPartyActions(first);
      if (actions.status !== "done") return actions;
      const pick = () => {
        const menu = game.partyMenu();
        return menu?.kind === "pick" ? menu : null;
      };
      const chosen = this.selectPartyAction((options) => options.indexOf(SWAP_ACTION), () => pick()?.swapping === true);
      if (chosen.status !== "done") return chosen;
      const moved = this.moveMenuCursor(second, () => pick()?.cursor ?? null);
      if (moved.status !== "done") return moved;
      const swapped = this.menuInput(Keys.A, () => pick()?.swapping === false);
      return swapped.status === "done" ? this.closeStartMenu() : swapped;
    });
  }

  async press(button: Button): Promise<ActionResult> {
    return this.act({ name: "press", button }, () => this.input(Keys[button]));
  }

  private act(action: MacroAction | RawInput, body: () => Outcome): ActionResult;
  private act<T extends object>(action: MacroAction | RawInput, body: () => Outcome & Partial<T>, defaults: T): ActionResult & T;
  private act(action: MacroAction | RawInput, body: () => Outcome, defaults = {}): ActionResult {
    const start = this.frame;
    const firstEvent = this.#events.length;
    const kind = this.#run.game.waitingFor().kind;
    const refused = action.name !== "press" && !ACCEPTS[kind].includes(action.name);
    const outcome: Outcome = refused ? { status: "impossible", reason: `${action.name} is not available: the game waits for a ${kind}` } : body();
    const result = { ...defaults, ...outcome, frames: this.frame - start };
    const entry = { action, result };
    // The action event goes before the game events of its frames.
    this.#events.splice(firstEvent, 0, { type: "action", frame: start, ...entry });
    this.#atlas.onAction(entry);
    this.#onAction?.(entry, this);
    if (this.#phase.kind === "playing") this.#phase.limits.atDecision(this.#run.game.milestones(), this.#watch.progress, this.#events.length);
    this.stopIfAsked();
    return result;
  }

  private openBag(): Outcome {
    const game = this.#run.game;
    const cursor = () => (game.waitingFor().kind === "battleAction" ? game.battleCursor("battleAction") : null);
    const moved = this.moveCursor(BAG_CURSOR, cursor, (at) => gridKey(at, BAG_CURSOR));
    if (moved.status !== "done") return moved;
    return this.tapUntil(Keys.A, () => game.bagMenu()?.screen === "list", "the Bag");
  }

  private shopOption(option: number, shown: () => boolean, screen: string): Outcome {
    const game = this.#run.game;
    const cursor = () => game.shopMenu()?.cursor ?? null;
    const inMenu = (keys: number) => this.tapUntil(keys, () => cursor() !== null, "the shop menu");
    const moved = this.moveCursor(option, cursor, (at) => (option > at ? Keys.Down : Keys.Up), inMenu);
    return moved.status === "done" ? this.tapUntil(Keys.A, shown, screen) : moved;
  }

  private toBagItem(place: BagPlace): Outcome {
    const game = this.#run.game;
    const list = () => {
      const menu = game.bagMenu();
      return menu?.screen === "list" ? menu : null;
    };
    const inList = (keys: number) => this.tapUntil(keys, () => list() !== null, "the Bag list");
    const pocket = this.moveCursor(place.pocket, () => list()?.pocket ?? null, (at) => (place.pocket > at ? Keys.Right : Keys.Left), inList);
    if (pocket.status !== "done") return pocket;
    return this.moveCursor(place.row, () => list()?.row ?? null, (at) => (place.row > at ? Keys.Down : Keys.Up), inList);
  }

  private trade(quantity: number): Outcome {
    const game = this.#run.game;
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
    return back.status !== "done" || refusal === null ? back : { status: "impossible", reason: `the game refuses: ${refusal}` };
  }

  private useOnWalk(item: string, id: number, before: number): Outcome & Texts {
    const game = this.#run.game;
    const pressed = this.pressUntilRead(Keys.A);
    if (pressed.status !== "done") return { ...pressed, text: [] };
    const told = this.untilReady(() => game.waitingTexts().length > 0 || game.itemAnimWaits());
    if (told.status !== "done") return { ...told, text: [] };
    if (game.itemAnimWaits()) {
      const effect = this.menuInput(Keys.A, () => game.waitingTexts().length > 0);
      if (effect.status !== "done") return { ...effect, text: [] };
    }
    const text = game.waitingTexts();
    const back = this.menuInput(Keys.A, () => game.bagMenu()?.screen === "list");
    if (back.status !== "done") return { ...back, text };
    const closed = this.closeStartMenu();
    if (closed.status !== "done") return { ...closed, text };
    return game.bagQuantity(id) === before ? { status: "impossible", reason: `the game refuses the ${item}: ${text.join(" ")}`, text: [] } : { status: "done", text };
  }

  private refused(item: string, message: string): Outcome {
    const game = this.#run.game;
    const back = this.tapUntil(Keys.A, () => game.bagMenu()?.screen === "list", "the Bag");
    if (back.status !== "done") return back;
    const closed = this.input(Keys.B);
    if (closed.status !== "done") return closed;
    return { status: "impossible", reason: `the game refuses the ${item}: ${message}` };
  }

  // A menu reads the keys from the frame after the frame that shows it.
  private tapUntil(keys: number, shown: () => boolean, screen: string): Outcome {
    if (this.tap(keys)) return { status: "interrupted", reason: "battle" };
    for (let frames = 0; !shown(); frames++) {
      if (frames === DECISION_FRAME_LIMIT) return { status: "impossible", reason: `the game does not show ${screen} after ${DECISION_FRAME_LIMIT} frames` };
      if (this.advance(0)) return { status: "interrupted", reason: "battle" };
    }
    return this.advance(0) ? { status: "interrupted", reason: "battle" } : { status: "done" };
  }

  private stopIfAsked(): void {
    if (this.#phase.kind === "playing" && this.#stopAsked()) throw new RunEnd("user stop");
  }

  private battle(): Battle {
    const battle = this.#run.game.battle();
    if (!battle) throw new Error("the game is not in a battle");
    return battle;
  }

  private battleState({ kind, player, enemy }: Battle): BattleState {
    const movesSeen = this.#battles.movesSeen(enemy.partyIndex).map((move) => this.#run.game.moveName(move));
    return { kind, player, enemy: enemyView(enemy, movesSeen, this.#knowledge === "full") };
  }

  private sendOut(menuSlot: number): Outcome & Texts {
    const game = this.#run.game;
    const actions = this.openPartyActions(menuSlot);
    if (actions.status !== "done") return { ...actions, text: [] };
    const sent = this.selectPartyAction(
      (options) => options.findIndex((o) => SEND_OUT_ACTIONS.includes(o)),
      () => {
        const menu = game.partyMenu();
        return menu === null || menu.kind === "refusal";
      },
    );
    if (sent.status !== "done") return { ...sent, text: [] };
    const refusal = game.partyMenu();
    if (refusal?.kind === "refusal") {
      const back = this.untilReady(
        () => game.partyMenu()?.kind === "pick",
        () => {
          if (game.waitingFor().kind === "text") this.pressUntilRead(Keys.A);
        },
      );
      return { ...(back.status === "done" ? { status: "impossible", reason: refusal.text } : back), text: [] };
    }
    // The battle message windows share their numbers with the party menu windows: read only after the menu.
    const reader = new MessageReader(game);
    return { ...this.untilDecision(() => reader.update()), text: reader.textBeforeWaitingText() };
  }

  private openStartMenu(option: string, shown: () => boolean): Outcome {
    const game = this.#run.game;
    const opened = this.menuInput(Keys.Start, () => game.startMenu() !== null);
    if (opened.status !== "done") return opened;
    const item = game.startMenu()?.options.indexOf(option) ?? -1;
    if (item < 0) return { status: "impossible", reason: `the Start menu has no ${option}` };
    const moved = this.moveMenuCursor(item, () => game.startMenu()?.cursor ?? null);
    return moved.status === "done" ? this.menuInput(Keys.A, shown) : moved;
  }

  private closeStartMenu(): Outcome {
    const game = this.#run.game;
    const closed = this.menuInput(Keys.B, () => game.startMenu() !== null);
    return closed.status === "done" ? this.menuInput(Keys.B, () => game.waitingFor().kind === "walk") : closed;
  }

  private openPartyActions(menuSlot: number): Outcome {
    const game = this.#run.game;
    const moved = this.moveMenuCursor(menuSlot, () => {
      const menu = game.partyMenu();
      return menu?.kind === "pick" ? menu.cursor : null;
    });
    return moved.status === "done" ? this.menuInput(Keys.A, () => game.partyMenu()?.kind === "actions") : moved;
  }

  private selectPartyAction(find: (options: string[]) => number, done: () => boolean): Outcome {
    const game = this.#run.game;
    const menu = game.partyMenu();
    if (menu?.kind !== "actions") throw new Error("the party menu does not show the actions of a Pokémon");
    const target = find(menu.options);
    if (target < 0) return { status: "impossible", reason: `the party menu has no such action: ${menu.options.join(", ")}` };
    const moved = this.moveMenuCursor(target, () => {
      const now = game.partyMenu();
      return now?.kind === "actions" ? now.cursor : null;
    });
    return moved.status === "done" ? this.menuInput(Keys.A, done) : moved;
  }

  private turn(menu: BattleMenu, target: number): Outcome & Texts {
    const reader = new MessageReader(this.#run.game);
    return { ...this.select(menu, target, () => reader.update()), text: reader.textBeforeWaitingText() };
  }

  private select(menu: BattleMenu, target: number, watch?: () => void): Outcome {
    const game = this.#run.game;
    const cursor = () => (game.waitingFor().kind === menu ? game.battleCursor(menu) : null);
    const moved = this.moveCursor(target, cursor, (at) => gridKey(at, target));
    if (moved.status !== "done") return moved;
    const battle = this.tap(Keys.A);
    return battle ? { status: "interrupted", reason: battle } : this.untilDecision(watch);
  }

  private moveCursor(target: number, read: () => number | null, key: (cursor: number) => number, press = (keys: number) => this.input(keys)): Outcome {
    for (let cursor = read(); cursor !== target; ) {
      if (cursor === null) return { status: "impossible", reason: "the menu closed when the cursor moved" };
      const moved = press(key(cursor));
      if (moved.status !== "done") return moved;
      const now = read();
      if (now === cursor) return { status: "impossible", reason: `the cursor does not move from ${cursor}` };
      cursor = now;
    }
    return { status: "done" };
  }

  private overworld(): { player: PlayerPosition; grid: MapGrid; actors: MapActors } {
    const game = this.#run.game;
    const player = game.player();
    const grid = game.grid();
    const actors = grid && game.actors(grid);
    if (!player || !grid || !actors) throw new Error("the player is not on the overworld");
    return { player, grid: { ...grid, signs: grid.signs.filter((s) => s.kind === "sign") }, actors };
  }

  private input(keys: number, watch?: () => void): Outcome {
    const battle = this.tap(keys);
    return battle ? { status: "interrupted", reason: battle } : this.untilDecision(watch);
  }

  private moveMenuCursor(target: number, cursor: () => number | null): Outcome {
    for (let at = cursor(); at !== target; ) {
      if (at === null) return { status: "impossible", reason: "the menu reads no input" };
      const from = at;
      const moved = this.menuInput(target > at ? Keys.Down : Keys.Up, () => {
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

  // A slow menu reads the input on some frames only: wait for it to read the release, then press the keys until it reads them.
  private pressUntilRead(keys: number): Outcome {
    const game = this.#run.game;
    for (const [held, read] of [
      [0, () => (game.keysRead().held & keys) === 0],
      [keys, () => (game.keysRead().pressed & keys) === keys],
    ] as const) {
      for (let frames = 0; !read(); frames++) {
        if (frames === DECISION_FRAME_LIMIT) return { status: "impossible", reason: `the game does not read the input for ${DECISION_FRAME_LIMIT} frames` };
        if (this.advance(held)) return { status: "interrupted", reason: "battle" };
      }
    }
    return this.advance(0) ? { status: "interrupted", reason: "battle" } : { status: "done" };
  }

  private untilDecision(watch: () => void = () => {}): Outcome {
    return this.untilReady(() => this.#run.game.waitingFor().kind !== "busy", watch);
  }

  private untilReady(ready: () => boolean, watch: () => void = () => {}): Outcome {
    for (let frames = 0; ; frames++) {
      watch();
      if (ready()) return { status: "done" };
      if (frames === DECISION_FRAME_LIMIT) return { status: "impossible", reason: `the game waits for no known input for ${DECISION_FRAME_LIMIT} frames` };
      if (this.advance(0)) return { status: "interrupted", reason: "battle" };
    }
  }

  // JOY_NEW sees a press only after a frame with the button up.
  private tap(keys: number): "battle" | null {
    return this.advance(keys) || this.advance(0) ? "battle" : null;
  }

  // A script runs during a whole text, choice or Raw input, so only a battle stops them.
  private advance(keys: number): boolean {
    if (this.#phase.kind === "playing") this.#phase.limits.beforeFrame(this.frame);
    this.#run.runFrame(keys);
    this.#buttons.push(keys);
    const events = this.#watch.onFrame(this.frame);
    this.#events.push(...events);
    this.#atlas.onFrame();
    const started = events.some((e) => e.type === "battle" && e.state === "start");
    this.#battles.onFrame(started, this.#run.game.enemyMovePrinted());
    this.#onFrame?.(this);
    return started;
  }

  private place(): Place {
    const player = this.#run.game.player();
    if (!player) throw new Error("the player is not on the overworld");
    return { map: this.#run.game.map().name, x: player.x, y: player.y };
  }

  private routeMaps(): MapSource {
    const maps = new Map<string, RouteMap | null>();
    return (name) => {
      if (!maps.has(name)) {
        const view = this.#run.game.mapView(name);
        maps.set(name, view && { ...view.grid, people: view.actors.people });
      }
      return maps.get(name)!;
    };
  }

  private walkLeg(leg: Leg, next: string): LegResult {
    for (const move of leg.moves) {
      const result = move.kind === "push" ? this.push(move.direction) : this.step(move.direction, move.kind === "jump" ? 2 : 1);
      if (result !== "done") return result;
      if (this.#run.game.map().name !== leg.map) break;
    }
    const interruption = this.settle();
    if (interruption) return interruption;
    return this.#run.game.map().name === next ? "done" : "map";
  }

  // Hold the direction: a short press only turns a player who faces another way. A jump moves the
  // player two times (InitJump, then the jump halfway), so a step ends on its arrival cell.
  private step(direction: Direction, cells: number): LegResult {
    const game = this.#run.game;
    const before = this.place();
    const [dx, dy] = DIRECTION_STEP[direction];
    const path = Array.from({ length: cells }, (_, i) => ({ x: before.x + dx * (i + 1), y: before.y + dy * (i + 1) }));
    const arrival = path.at(-1)!;
    const result = this.hold(DIRECTION_KEYS[direction], STEP_FRAME_LIMIT, () => {
      const now = game.player();
      return !now || game.map().name !== before.map || (now.x === arrival.x && now.y === arrival.y);
    });
    if (result !== "limit") return result;
    const people = game.mapView(before.map)?.actors.people ?? [];
    return people.some((p) => path.some((c) => c.x === p.x && c.y === p.y)) ? "stuck" : "no move";
  }

  private interactions(): AvailableAction[] {
    const { player, grid, actors } = this.overworld();
    return neighbours(player)
      .filter(
        ({ direction, x, y }) =>
          actors.people.some((p) => p.loaded && p.x === x && p.y === y) ||
          grid.signs.some((s) => s.kind === "sign" && s.x === x && s.y === y && (s.playerFacing === "any" || s.playerFacing === direction)),
      )
      .map(({ x, y }) => ({ name: "interact" as const, x, y }));
  }

  private face(direction: Direction): Outcome {
    const game = this.#run.game;
    if (game.player()?.facing === direction) return { status: "done" };
    const before = this.place();
    const turned = this.hold(DIRECTION_KEYS[direction], STEP_FRAME_LIMIT, () => game.player()?.facing === direction);
    if (turned === "limit") return { status: "impossible", reason: `the player does not turn ${direction}` };
    if (turned !== "done") return { status: "interrupted", reason: turned };
    const interruption = this.settle();
    if (interruption) return { status: "interrupted", reason: interruption };
    if (at(this.place()) !== at(before)) return { status: "impossible", reason: `the player walked to ${at(this.place())} when it turned ${direction}` };
    return { status: "done" };
  }

  private push(direction: Direction): LegResult {
    const result = this.hold(DIRECTION_KEYS[direction], STEP_FRAME_LIMIT, () => this.#run.game.fieldLocked());
    return result === "limit" ? "no warp" : result;
  }

  private settle(): Interruption | null {
    const result = this.hold(0, SETTLE_FRAME_LIMIT, () => this.#run.game.waitingFor().kind === "walk");
    if (result === "limit") throw new Error(`the game waits for no input for more than ${SETTLE_FRAME_LIMIT} frames`);
    return result === "done" ? null : result;
  }

  private hold(keys: number, limit: number, done: () => boolean): "done" | "limit" | Interruption {
    for (let frames = 0; ; frames++) {
      if (done()) return "done";
      if (frames === limit) return "limit";
      const interruption = this.frameOrInterruption(keys);
      if (interruption) return interruption;
    }
  }

  private wait(frames: number): Interruption | null {
    for (let i = 0; i < frames; i++) {
      const interruption = this.frameOrInterruption(0);
      if (interruption) return interruption;
    }
    return null;
  }

  private frameOrInterruption(keys: number): Interruption | null {
    this.advance(keys);
    return this.#run.game.interruption();
  }
}

class MessageReader {
  readonly text: string[] = [];
  private messages: Messages;
  private pressedOnce = false;
  private lastWindow: number | null = null;
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
    if (this.pressedOnce && this.messages.boxClosed) this.closedAfterPress = true;
  }

  textBeforeWaitingText(): string[] {
    const waits = this.game.waitingFor().kind === "text" && this.lastWindow !== null && this.game.messages().onScreen.includes(this.lastWindow);
    return waits ? this.text.slice(0, -1) : this.text;
  }

  private push(window: number): void {
    const text = plain(this.game.messageText(window));
    if (!text) return;
    this.text.push(text);
    this.lastWindow = window;
  }
}

function withoutPeople(map: RouteMap | null): RouteMap | null {
  return map && { ...map, people: [] };
}

function plain(text: string): string {
  return text.split("\n").join(" ").trim();
}

function neighbours(cell: { x: number; y: number }): { direction: Direction; x: number; y: number }[] {
  return DIRECTION_STEPS.map(([direction, [dx, dy]]) => ({ direction, x: cell.x + dx, y: cell.y + dy }));
}

function at(place: Place): string {
  return `${place.map} (${place.x}, ${place.y})`;
}

function saleRefusal(item: string, place: BagPlace | null): string | null {
  if (!place) return `there is no ${item} in the Bag`;
  if (place.pocket >= BATTLE_POCKETS) return "the sale of the TM Case and of the Berry Pouch is not covered yet";
  return place.price > 0 ? null : `the shop does not buy ${item}`;
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
