// Frames run only inside a Macro-action or a Raw input: the game is frozen at each Decision point (docs/adr/0002).
import { readdir } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { type BagPocket, battleItems, depositableItems, sellableItems, walkItems } from "../bag";
import { type Battle, type BattleTurn, BattleWatch, type EnemyMon, enemyView, type FightFacts, fightFacts } from "../battle";
import {
  DIRECTION_STEP,
  DIRECTION_STEPS,
  type Direction,
  isDecisionPoint,
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
import { type BotInfo, Keys, obstacleRemedy } from "../protocol";
import { Run, START_SAVE } from "../run";
import { type Atlas, AtlasWatch, blockedText, type Sight } from "./atlas";
import { MenuDriver, type Outcome, type Texts } from "./menu-driver";
import { type BlockOf, type Destination, destinationOf, findRoute, inside, type Leg, MAX_ROUTE_MAPS, type MapSource, obstacleOnRoute, pastEdge, type Place, type RouteMap, reached } from "./path";
import {
  ButtonTrack,
  GameWatch,
  type ModelAnswer,
  type ModelEvent,
  type ModelOptions,
  type ModelSettings,
  modelTotals,
  originDifferences,
  RecordPlayer,
  type RunEvent,
  type RunHeader,
  type RunRecord,
  type SummaryAnswer,
  type SummaryEvent,
} from "./record";

const STEP_FRAME_LIMIT = 60;
const SETTLE_FRAME_LIMIT = 600;
const BLOCKED_TRIES = 3;
const BLOCKED_WAIT_FRAMES = 30;
const MAX_LEGS = 64;
const DIRECTION_KEYS: Record<Direction, number> = { south: Keys.Down, north: Keys.Up, west: Keys.Left, east: Keys.Right };
// readText also runs a busy game to its next text.
const ACCEPTS: Record<WaitingFor["kind"], AvailableAction["name"][]> = {
  walk: ["goTo", "interact", "swap", "use"],
  choice: ["choose"],
  text: ["readText"],
  battleAction: ["fight", "switch", "run", "use"],
  battleMove: ["fight"],
  partyPick: ["send"],
  shopMenu: ["buy", "sell", "leave"],
  itemPc: ["withdraw", "deposit", "leave"],
  naming: ["name"],
  busy: ["readText"],
};
// Each Macro-action is in ACCEPTS: a Macro-action that no kind accepts can never run.
export const MACRO_ACTIONS: readonly MacroAction["name"][] = [...new Set(Object.values(ACCEPTS).flat())];
export const KNOWLEDGE_LEVELS = ["player", "full"] as const;

export type KnowledgeLevel = (typeof KNOWLEDGE_LEVELS)[number];

/** `fights`: the facts of each move of the player, in the order of its moves. `foeTurns`: the turns of the battle against the current foe. */
export type BattleState = { kind: Battle["kind"]; player: Battle["player"]; enemy: EnemyMon; fights: (FightFacts | null)[]; lastTurn: BattleTurn | null; foeTurns: BattleTurn[] };

type ObservationBase = { waitingFor: WaitingFor; party: PartyMon[]; bag: BagPocket[]; money: number; milestones: Milestone[]; atlas: Atlas };

export type Person = Pick<MapActors["people"][number], "localId" | "x" | "y" | "graphics" | "loaded">;

export type Observation = ObservationBase &
  ({ mode: "overworld"; map: GameState["map"]; player: PlayerPosition; grid: MapGrid; people: Person[] } | { mode: "battle"; battle: BattleState } | { mode: "naming" });

export type EndReason = "goal" | "bot stopped" | "user stop" | "cost limit" | "frame budget" | "no progress" | "whiteout" | "unknown screen";

/** `lastText`: the last text of the game, at the end reason `unknown screen`. */
export type RunResult = { endReason: EndReason; frames: number; milestones: Milestone[]; rawInputs: number; lastText?: string };

/** `since`: the number of events of the Run at the last progress. */
export type NoProgress = { stuck: number; since: number };

export type Interruption = GameInterruption | "map";

type LegResult = "done" | "stuck" | "no move" | "no warp" | Interruption;

export type ActionResult = Outcome & {
  frames: number;
};

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
  | { name: "sell"; item: string; quantity: number }
  | { name: "withdraw" | "deposit"; item: string; quantity: number }
  | { name: "leave" }
  | { name: "name"; text: string };

export type AvailableAction =
  | { name: "goTo" | "swap" | "name" }
  | { name: "use" | "buy" | "sell" | "withdraw" | "deposit"; item: string }
  | Exclude<MacroAction, { name: "goTo" | "swap" | "name" | "use" | "buy" | "sell" | "withdraw" | "deposit" }>;

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
  /** The Run continues this Run record: the Harness replays its buttons and keeps its events. `name` is its file in lab/runs/. */
  parent?: ParentRecord;
};

export type ParentRecord = { name: string; record: RunRecord };

export type Bot = {
  name: string;
  version: string;
  goal?: Milestone;
  model?: ModelSettings;
  frameBudget?: number;
  play(harness: Harness): Promise<void>;
};

class RunEnd extends Error {
  constructor(
    readonly reason: EndReason,
    readonly lastText?: string,
  ) {
    super(`the Run ends: ${reason}`);
  }
}

class RunLimits {
  #noProgress: NoProgress;
  #whitedOut = false;

  /** The cost limit counts the Model calls from `firstEvent`: a continued Run does not count the calls of its parent. */
  constructor(
    private readonly goal: Milestone,
    private readonly lastFrame: number,
    private readonly noProgressLimit: number,
    private readonly costLimit: number,
    private progress: number,
    private readonly firstEvent: number,
    private readonly stopAtWhiteout: boolean,
  ) {
    this.#noProgress = { stuck: 0, since: firstEvent };
  }

  beforeFrame(frame: number): void {
    if (frame >= this.lastFrame) throw new RunEnd("frame budget");
  }

  // The battle and the field poison both white out through CB2_WhiteOut. The Run ends after the action, at the walk in the Pokémon Center.
  afterFrame(whitingOut: boolean): void {
    this.#whitedOut ||= whitingOut;
  }

  get noProgress(): NoProgress {
    return this.#noProgress;
  }

  atAction(milestones: Milestone[], progress: number, decisionPoint: boolean, events: number): void {
    if (milestones.includes(this.goal)) throw new RunEnd("goal");
    if (this.#whitedOut && this.stopAtWhiteout) throw new RunEnd("whiteout");
    if (progress > this.progress) this.#noProgress = { stuck: 0, since: events };
    else if (decisionPoint) this.#noProgress = { ...this.#noProgress, stuck: this.#noProgress.stuck + 1 };
    // A text of a talk changes while it is read: keep the highest count, so a lower one does not reset the count later.
    this.progress = Math.max(this.progress, progress);
    if (this.#noProgress.stuck >= this.noProgressLimit) throw new RunEnd("no progress");
  }

  afterCall(events: readonly RunEvent[]): void {
    if (modelTotals(events.slice(this.firstEvent)).cost > this.costLimit) throw new RunEnd("cost limit");
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
  readonly #menus: MenuDriver;
  readonly #parent: string | null;
  /** Where the play of a continued Run started, in its parent: the Run result counts the frames and the Raw inputs of the whole Run. */
  #playStart: { frame: number; rawInputs: number } | null = null;
  #phase: Phase = { kind: "ready" };

  private constructor(run: Run, options: HarnessOptions) {
    this.#run = run;
    this.#knowledge = options.knowledge ?? options.parent?.record.header.knowledge ?? "player";
    this.#onAction = options.onAction;
    this.#onFrame = options.onFrame;
    this.#onModelCallStart = options.onModelCallStart;
    this.#onModelCall = options.onModelCall;
    this.#onSummaryCall = options.onSummaryCall;
    this.#frameBudget = options.frameBudget;
    this.#noProgressLimit = options.noProgressLimit;
    this.#stopAsked = options.stopAsked ?? (() => false);
    this.#parent = options.parent?.name ?? null;
    this.#watch = new GameWatch(run.game);
    this.#atlas = new AtlasWatch(run.game);
    this.#menus = new MenuDriver(run.game, { advance: (keys) => this.advance(keys) });
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
      if (options.parent) {
        harness.replayParent(options.parent.record);
        return harness;
      }
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
    const { frame: start, rawInputs } = this.#playStart ?? { frame: this.frame, rawInputs: this.rawInputs };
    const frameBudget = this.#frameBudget ?? bot.frameBudget ?? Number.POSITIVE_INFINITY;
    const goal = bot.goal ?? MILESTONES[MILESTONES.length - 1];
    const noProgressLimit = this.#noProgressLimit ?? Number.POSITIVE_INFINITY;
    const costLimit = bot.model?.costLimit ?? Number.POSITIVE_INFINITY;
    const limits = new RunLimits(goal, this.frame + frameBudget, noProgressLimit, costLimit, this.progress(), this.#events.length, bot.model?.stopAtWhiteout ?? false);
    this.#phase = { kind: "playing", limits };
    let endReason: EndReason = "bot stopped";
    let lastText: string | undefined;
    let result: RunResult | null = null;
    try {
      await bot.play(this);
    } catch (error) {
      if (!(error instanceof RunEnd)) throw error;
      endReason = error.reason;
      lastText = error.lastText;
    } finally {
      result = { endReason, frames: this.frame - start, milestones: this.#run.game.milestones(), rawInputs: this.rawInputs - rawInputs, ...(lastText === undefined ? {} : { lastText }) };
      this.#phase = { kind: "ended", bot: { name: bot.name, version: bot.version, ...(bot.model ? { model: bot.model } : {}) }, result };
    }
    return result;
  }

  /** A Bot ends its Run at a screen that it cannot play. The Run result keeps the last text of the game. */
  end(reason: "unknown screen"): never {
    const texts = this.#events.flatMap((e) => (e.type === "action" && "text" in e.result ? e.result.text : []));
    throw new RunEnd(reason, texts.at(-1) ?? "");
  }

  /** A model bot asks its AI model in `ask`, which must not throw an error. The Run record keeps the answer as a `model` event; the Harness returns the action to the Bot. */
  async modelCall<T>(ask: () => Promise<{ answer: ModelAnswer; action: T }>): Promise<T> {
    this.#onModelCallStart?.(this);
    const start = performance.now();
    const { answer, action } = await ask();
    this.callEnded({ type: "model", frame: this.frame, latencyMs: Math.round(performance.now() - start), ...answer }, this.#onModelCall);
    return action;
  }

  async summaryCall(ask: () => Promise<SummaryAnswer>): Promise<SummaryEvent> {
    const start = performance.now();
    const answer = await ask();
    return this.callEnded({ type: "summary", frame: this.frame, latencyMs: Math.round(performance.now() - start), ...answer }, this.#onSummaryCall);
  }

  record(): RunRecord {
    if (this.#phase.kind !== "ended") throw new Error("no Run record: play a Bot first");
    const { bot, result } = this.#phase;
    const header = { ...this.#run.origin, knowledge: this.#knowledge, bot, ...(this.#parent ? { parent: this.#parent } : {}) };
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
    this.#atlas.lookAround();
    const base = {
      waitingFor: game.waitingFor(),
      party: game.partyOnScreen(),
      bag: game.bag(),
      money: game.money(),
      milestones: game.milestones(),
      atlas: this.#atlas.atlas(this.#knowledge),
    };
    // The naming screen has no map and no grid: overworld() would fail there.
    if (base.waitingFor.kind === "naming") return { ...base, mode: "naming" };
    const battle = game.battle();
    if (battle) return { ...base, mode: "battle", battle: this.battleState(battle) };
    const { player, grid, actors } = this.overworld();
    const people = actors.people.map(({ localId, x, y, graphics, loaded }): Person => ({ localId, x, y, graphics, loaded }));
    return { ...base, mode: "overworld", map: game.map(), player, grid, people };
  }

  availableActions(): AvailableAction[] {
    const game = this.#run.game;
    const waiting = game.waitingFor();
    return ACCEPTS[waiting.kind].flatMap((name): AvailableAction[] => {
      switch (name) {
        case "goTo":
        case "readText":
        case "leave":
        case "name":
          return [{ name }];
        case "swap":
          return game.party().length > 1 ? [{ name }] : [];
        case "switch":
        case "send":
          return sendableSlots(game.partyOnScreen(), game.requireBattle().player.partyIndex).map((slot) => ({ name, slot }));
        case "interact":
          return this.interactions();
        case "choose":
          return waiting.kind === "choice" ? waiting.options.map((option) => ({ name, option })) : [];
        case "fight":
          return game.requireBattle().player.moves.flatMap((m, move) => (m.pp > 0 ? [{ name, move }] : []));
        case "run":
          return game.requireBattle().kind === "wild" ? [{ name }] : [];
        case "use": {
          const bag = game.bag();
          return (waiting.kind === "walk" ? walkItems(bag) : battleItems(bag, game.requireBattle().kind)).map((item) => ({ name, item: item.name }));
        }
        case "buy":
          return waiting.kind === "shopMenu" ? waiting.items.map((item) => ({ name, item: item.name })) : [];
        case "sell":
          return sellableItems(game.bag()).map((item) => ({ name, item: item.name }));
        case "withdraw":
          return waiting.kind === "itemPc" ? waiting.items.map((item) => ({ name, item: item.name })) : [];
        case "deposit":
          return depositableItems(game.bag()).map((item) => ({ name, item: item.name }));
      }
    });
  }

  async goTo(x: number, y: number, map?: string): Promise<ActionResult> {
    return this.act({ name: "goTo", x, y, ...(map ? { map } : {}) }, () => {
      const asked = { map: map ?? this.place().map, x, y };
      const destination = destinationOf(asked, map === undefined, this.routeMaps());
      const outside = destination.exit ? null : outsideReason(asked, this.routeMaps()(asked.map), map === undefined, this.#atlas.blockOf);
      if (outside) return { status: "impossible", reason: outside };
      let tries = 0;
      let stuckAt: Place | null = null;
      for (let legs = 0; legs < MAX_LEGS; legs++) {
        const here = this.place();
        if (reached(destination, here)) return { status: "done" };
        const maps = this.routeMaps();
        const route = findRoute(here, destination, maps);
        if (!route && !findRoute(here, destination, (name) => withoutPeople(maps(name)))) {
          return { status: "impossible", reason: noRouteReason(here, destination, asked, maps) };
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
      const battle = this.#menus.tap(Keys.A);
      if (battle) return { status: "interrupted", reason: battle };
      // ScriptContext_SetupScript locks the field controls, so an unlocked field means A started no script.
      if (!game.fieldLocked()) return { status: "impossible", reason: `nothing at (${x}, ${y}) starts a script` };
      return this.#menus.untilDecision();
    });
  }

  async readText(): Promise<TextResult> {
    return this.act<Texts>({ name: "readText" }, () => this.#menus.readText(), { text: [] });
  }

  async choose(option: string): Promise<ActionResult> {
    return this.act({ name: "choose", option }, () => this.#menus.choose(option));
  }

  async fight(move: number): Promise<TextResult> {
    return this.act<Texts>({ name: "fight", move }, () => this.#menus.fight(move), { text: [] });
  }

  async run(): Promise<TextResult> {
    return this.act<Texts>({ name: "run" }, () => this.#menus.run(), { text: [] });
  }

  async use(item: string, on?: number): Promise<TextResult> {
    return this.act<Texts>({ name: "use", item, ...(on === undefined ? {} : { on }) }, () => this.#menus.use(item, on), { text: [] });
  }

  async buy(item: string, quantity: number): Promise<ActionResult> {
    return this.act({ name: "buy", item, quantity }, () => this.#menus.buy(item, quantity));
  }

  async sell(item: string, quantity: number): Promise<ActionResult> {
    return this.act({ name: "sell", item, quantity }, () => this.#menus.sell(item, quantity));
  }

  async withdraw(item: string, quantity: number): Promise<ActionResult> {
    return this.act({ name: "withdraw", item, quantity }, () => this.#menus.withdraw(item, quantity));
  }

  async deposit(item: string, quantity: number): Promise<ActionResult> {
    return this.act({ name: "deposit", item, quantity }, () => this.#menus.deposit(item, quantity));
  }

  async leave(): Promise<TextResult> {
    return this.act<Texts>({ name: "leave" }, () => this.#menus.leave(), { text: [] });
  }

  async name(text: string): Promise<TextResult> {
    return this.act<Texts>({ name: "name", text }, () => this.#menus.name(text), { text: [] });
  }

  async switch(slot: number): Promise<TextResult> {
    return this.act<Texts>({ name: "switch", slot }, () => this.#menus.switch(slot), { text: [] });
  }

  async send(slot: number): Promise<TextResult> {
    return this.act<Texts>({ name: "send", slot }, () => this.#menus.send(slot), { text: [] });
  }

  async swap(first: number, second: number): Promise<ActionResult> {
    return this.act({ name: "swap", first, second }, () => this.#menus.swap(first, second));
  }

  /** Runs a Macro-action or a Raw input from its description. */
  async perform(action: MacroAction | RawInput): Promise<ActionResult> {
    switch (action.name) {
      case "goTo":
        return this.goTo(action.x, action.y, action.map);
      case "interact":
        return this.interact(action.x, action.y);
      case "readText":
        return this.readText();
      case "choose":
        return this.choose(action.option);
      case "fight":
        return this.fight(action.move);
      case "switch":
        return this.switch(action.slot);
      case "send":
        return this.send(action.slot);
      case "swap":
        return this.swap(action.first, action.second);
      case "run":
        return this.run();
      case "use":
        return this.use(action.item, action.on);
      case "buy":
        return this.buy(action.item, action.quantity);
      case "sell":
        return this.sell(action.item, action.quantity);
      case "withdraw":
        return this.withdraw(action.item, action.quantity);
      case "deposit":
        return this.deposit(action.item, action.quantity);
      case "leave":
        return this.leave();
      case "name":
        return this.name(action.text);
      case "press":
        return this.press(action.button);
    }
  }

  async press(button: Button): Promise<ActionResult> {
    return this.act({ name: "press", button }, () => this.#menus.input(Keys[button]));
  }

  private act(action: MacroAction | RawInput, body: () => Outcome): ActionResult;
  private act<T extends object>(action: MacroAction | RawInput, body: () => Outcome & Partial<T>, defaults: T): ActionResult & T;
  private act(action: MacroAction | RawInput, body: () => Outcome, defaults = {}): ActionResult {
    const start = this.frame;
    const firstEvent = this.#events.length;
    const game = this.#run.game;
    const kind = game.waitingFor().kind;
    const refused = action.name !== "press" && !ACCEPTS[kind].includes(action.name);
    const before = !refused && action.name !== "press" && (kind === "battleAction" || kind === "battleMove") ? game.battle() : null;
    const outcome: Outcome = refused ? { status: "impossible", reason: `${action.name} is not available: the game waits for a ${kind}` } : body();
    const result = { ...defaults, ...outcome, frames: this.frame - start };
    const entry = { action, result };
    this.#battles.onAction(outcome.status === "impossible" ? null : before, "text" in result ? (result.text as string[]) : [], game.battle(), isDecisionPoint(game.waitingFor()));
    // The action event goes before the game events of its frames.
    this.#events.splice(firstEvent, 0, { type: "action", frame: start, ...entry });
    this.#atlas.onAction(entry);
    this.#onAction?.(entry, this);
    if (this.#phase.kind === "playing") this.#phase.limits.atAction(this.#run.game.milestones(), this.progress(), isDecisionPoint(this.#run.game.waitingFor()), this.#events.length);
    this.stopIfAsked();
    return result;
  }

  // The watches see the same frames and the same actions as in the parent Run, so the Atlas and the Memory tree go on from where the parent stopped.
  private replayParent(record: RunRecord): void {
    const differences = originDifferences(this.#run, record);
    if (differences.length > 0) throw new Error(`the Run record does not replay here: different ${differences.join(", ")}`);
    const player = new RecordPlayer(record);
    const actions = record.events.filter((e) => e.type === "action");
    let next = 0;
    const actionsEnded = () => {
      for (; next < actions.length && actions[next].frame + actions[next].result.frames <= this.frame; next++) this.#atlas.onAction(actions[next]);
    };
    while (!player.ended) {
      actionsEnded();
      this.advance(player.next());
    }
    actionsEnded();
    const gameEvents = record.events.filter((e) => e.type === "map" || e.type === "battle" || e.type === "milestone");
    if (!Bun.deepEquals(this.#events, gameEvents)) throw new Error("the Run record does not replay the same game: its map, battle and Milestone events are different");
    this.#events.splice(0, this.#events.length, ...record.events);
    this.#playStart = { frame: this.frame - record.result.frames, rawInputs: this.rawInputs - record.result.rawInputs };
  }

  private progress(): number {
    return this.#watch.gameProgress + this.#atlas.heard + this.#atlas.exits;
  }

  private callEnded<E extends ModelEvent | SummaryEvent>(event: E, listener?: (event: E, harness: Harness) => void): E {
    this.#events.push(event);
    listener?.(event, this);
    if (this.#phase.kind === "playing") this.#phase.limits.afterCall(this.#events);
    this.stopIfAsked();
    return event;
  }

  private stopIfAsked(): void {
    if (this.#phase.kind === "playing" && this.#stopAsked()) throw new RunEnd("user stop");
  }

  private battleState(battle: Battle): BattleState {
    const { kind, player, enemy } = battle;
    const game = this.#run.game;
    const movesSeen = this.#battles.movesSeen(enemy.partyIndex).map((move) => game.moveName(move));
    return {
      kind,
      player,
      enemy: enemyView(enemy, movesSeen, this.#knowledge === "full"),
      fights: fightFacts(battle, game.typeChart(), game.milestones()),
      lastTurn: this.#battles.lastTurn(),
      foeTurns: this.#battles.turnsAgainst(enemy.partyIndex),
    };
  }

  private overworld(): { player: PlayerPosition; grid: MapGrid; actors: MapActors } {
    const game = this.#run.game;
    const player = game.player();
    const grid = game.grid();
    const actors = grid && game.actors(grid);
    if (!player || !grid || !actors) throw new Error("the player is not on the overworld");
    return { player, grid: { ...game.withObstacles(grid, actors), signs: grid.signs.filter((s) => s.kind === "sign") }, actors };
  }

  // A script runs during a whole text, choice or Raw input, so only a battle stops them.
  private advance(keys: number): boolean {
    if (this.#phase.kind === "playing") this.#phase.limits.beforeFrame(this.frame);
    this.#run.runFrame(keys);
    if (this.#phase.kind === "playing") this.#phase.limits.afterFrame(this.#run.game.whitingOut());
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
        maps.set(name, view && { ...view.grid, people: view.actors.people, obstacles: view.actors.obstacles });
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

function outsideReason(cell: Place, map: RouteMap | null, canExit: boolean, blockOf: BlockOf): string | null {
  if (!map || inside(map, cell)) return null;
  const range = `the cells of ${map.name} are x from 0 to ${map.mapWidth - 1}, y from 0 to ${map.mapHeight - 1}`;
  const side = pastEdge(map, cell);
  if (!side) return `(${cell.x}, ${cell.y}) is outside ${map.name}; ${range}`;
  if (!canExit) return `(${cell.x}, ${cell.y}) is outside ${map.name}, and a cell past an edge crosses it only in a goTo with no map; ${range}`;
  const block = blockOf(map.name, side);
  if (block) return blockedText(map.name, side, block);
  if (map.connections.some((c) => c.direction === side)) return `(${cell.x}, ${cell.y}) leads to a cell of the next map where the player cannot stand: cross the ${side} edge at another cell`;
  return `no map connects to the ${side} edge of ${map.name}; ${range}`;
}

function noRouteReason(here: Place, destination: Destination, asked: Place, maps: MapSource): string {
  const obstacle = obstacleOnRoute(here, destination, maps);
  if (obstacle) return `you cannot go there now: a ${obstacle.name} at ${at(obstacle)} blocks the way. ${obstacleRemedy(obstacle.move)}`;
  return `no route from ${at(here)} to ${at(asked)} in ${MAX_ROUTE_MAPS} maps`;
}

function withoutPeople(map: RouteMap | null): RouteMap | null {
  return map && { ...map, people: [] };
}

function neighbours(cell: { x: number; y: number }): { direction: Direction; x: number; y: number }[] {
  return DIRECTION_STEPS.map(([direction, [dx, dy]]) => ({ direction, x: cell.x + dx, y: cell.y + dy }));
}

function at(place: Place): string {
  return `${place.map} (${place.x}, ${place.y})`;
}
