// Frames run only inside a Macro-action or a Raw input: the game is frozen at each Decision point (docs/adr/0002).
import { readdir } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { type BagPocket, battleItems, depositableItems, sellableItems, type Teachable, walkItems } from "../bag";
import { type Battle, BattleWatch, type EnemyMon, enemyView, struggles } from "../battle";
import { type BattleTurn, type FightFacts, fightFacts } from "../battle-facts";
import { DIRECTION_STEP, DIRECTION_STEPS, type Direction } from "../cells";
import { type FieldMove, isDecisionPoint, type GameInterruption, type GameState, type MapActors, type MapGrid, MILESTONES, type Milestone, type Obstacle, type PlayerPosition, type WaitingFor } from "../game";
import { type BoxMon, isHmMove, type PartyMon, sendableSlots } from "../party";
import { badgeNeeded, type BotInfo, Keys, obstacleRemedy } from "../protocol";
import { Run, START_SAVE } from "../run";
import type { TrainerNames } from "../save-file";
import { type Atlas, AtlasWatch, type Sight } from "./atlas";
import { withoutFormat } from "./game-events";
import { MenuDriver, type Outcome, type Texts } from "./menu-driver";
import { type Cell, destinationOf, findRoute, type Leg, type MapSource, nextStraightStep, onlySeen, type Place, reached, type RouteMap, whyNoRoute } from "./path";
import { at, noRouteReason, outsideReason, stayingReason } from "./route-reasons";
import { RunEnd, RunLimits } from "./run-limits";
import {
  ButtonTrack,
  GameWatch,
  hasStateEvents,
  isGameEvent,
  type ModelAnswer,
  type ModelEvent,
  type ModelOptions,
  type ModelSettings,
  originDifferences,
  RECORD_FORMAT,
  RecordPlayer,
  type RunEvent,
  type RunHeader,
  type RunRecord,
  type SummaryAnswer,
  type SummaryEvent,
  withStateEvents,
} from "./record";

const STEP_FRAME_LIMIT = 60;
const SETTLE_FRAME_LIMIT = 600;
const BLOCKED_TRIES = 3;
const BLOCKED_WAIT_FRAMES = 30;
const MAX_LEGS = 64;
const DIRECTION_KEYS: Record<Direction, number> = { south: Keys.Down, north: Keys.Up, west: Keys.Left, east: Keys.Right };
// readText also runs a busy game to its next text.
const ACCEPTS: Record<WaitingFor["kind"], AvailableAction["name"][]> = {
  walk: ["goTo", "walkOn", "interact", "swap", "use", "teach"],
  choice: ["choose"],
  text: ["readText"],
  battleAction: ["fight", "switch", "run", "use"],
  battleMove: ["fight"],
  partyPick: ["send"],
  shopMenu: ["buy", "sell", "leave"],
  itemPc: ["withdraw", "deposit", "leave"],
  pokemonPc: ["depositPokemon", "withdrawPokemon", "leave"],
  naming: ["name"],
  learnMove: ["forget", "keep"],
  busy: ["readText"],
};
// Each Macro-action is in ACCEPTS: a Macro-action that no kind accepts can never run.
export const MACRO_ACTIONS: readonly MacroAction["name"][] = [...new Set(Object.values(ACCEPTS).flat())];
export const KNOWLEDGE_LEVELS = ["player", "full"] as const;

export type KnowledgeLevel = (typeof KNOWLEDGE_LEVELS)[number];

export type BattleState = { player: Battle["player"]; enemy: EnemyMon; fights: (FightFacts | null)[]; lastTurn: BattleTurn | null; foeTurns: BattleTurn[] } & ({ kind: "trainer" } | { kind: "wild"; inPc: number });

type ObservationBase = { waitingFor: WaitingFor; party: PartyMon[]; bag: BagPocket[]; money: number; milestones: Milestone[]; atlas: Atlas };

/** `unbeatenTrainer`: a trainer that the player did not beat yet. A talk or its sight starts a battle. */
export type Person = Pick<MapActors["people"][number], "localId" | "x" | "y" | "graphics" | "loaded" | "stays"> & { unbeatenTrainer?: boolean };

export type Observation = ObservationBase &
  ({ mode: "overworld"; map: GameState["map"]; player: PlayerPosition; grid: MapGrid; people: Person[]; boxes: BoxMon[]; repelActive: boolean; teachables: Teachable[] } | { mode: "battle"; battle: BattleState } | { mode: "naming" } | { mode: "menu" });

export type EndReason = "goal" | "bot stopped" | "user stop" | "cost limit" | "token limit" | "plan limit" | "frame budget" | "no progress" | "whiteout" | "unknown screen";

export type RunResult = { endReason: EndReason; frames: number; milestones: Milestone[]; rawInputs: number; lastText?: string; planLimit?: string };

/** `since`: the number of events of the Run at the last progress. */
export type NoProgress = { stuck: number; since: number };

export type Interruption = GameInterruption | "map";

type LegResult = "done" | "stuck" | "no move" | "no warp" | Interruption;

export type ActionResult = Outcome & {
  frames: number;
  leftWordScreen?: true;
};

export type TextResult = ActionResult & Texts;

export type MacroAction =
  | { name: "goTo"; x: number; y: number; map?: string }
  | { name: "walkOn"; x: number; y: number; direction: Direction }
  | { name: "interact"; x: number; y: number }
  | { name: "readText" }
  | { name: "choose"; option: string }
  | { name: "fight"; move: number }
  | { name: "switch"; slot: number }
  | { name: "send"; slot: number }
  | { name: "swap"; first: number; second: number }
  | { name: "teach"; item: string; on: number }
  | { name: "run" }
  | { name: "use"; item: string; on?: number }
  | { name: "buy"; item: string; quantity: number }
  | { name: "sell"; item: string; quantity: number }
  | { name: "withdraw" | "deposit"; item: string; quantity: number }
  | { name: "depositPokemon"; slot: number }
  | { name: "withdrawPokemon"; box: number; position: number }
  | { name: "leave" }
  | { name: "name"; text: string }
  | { name: "forget"; move: string }
  | { name: "keep" };

export type AvailableAction =
  | { name: "goTo" | "walkOn" | "swap" | "name" }
  | { name: "use" | "teach" | "buy" | "sell" | "withdraw" | "deposit"; item: string }
  | Exclude<MacroAction, { name: "goTo" | "walkOn" | "swap" | "name" | "use" | "teach" | "buy" | "sell" | "withdraw" | "deposit" }>;

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
        (bot): BotInfo => ({ name, kind: bot.model ? "model" : "scripted", version: bot.version, goal: bot.goal ?? null, costLimit: bot.model?.costLimit ?? null }),
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

export type CallKind = "model" | "summary";

type CallStartListener = (kind: CallKind, harness: Harness) => void;

type ModelCallListener = (event: ModelEvent, harness: Harness) => void;

type SummaryCallListener = (event: SummaryEvent, harness: Harness) => void;

export type HarnessOptions = {
  knowledge?: KnowledgeLevel;
  startSave?: string;
  onAction?: ActionListener;
  onFrame?: (harness: Harness) => void;
  onCallStart?: CallStartListener;
  onModelCall?: ModelCallListener;
  onSummaryCall?: SummaryCallListener;
  frameBudget?: number;
  noProgressLimit?: number;
  /** When it gives true, the Run ends with "user stop" after the Macro-action or the Raw input that plays, and at once in a Model call: see `untilStop`. */
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

const STOP_CHECK_MS = 100;

/** The end reasons whose result has `lastText`: the Bot reads the last text of the game to know why. */
const ENDS_WITH_TEXT: readonly EndReason[] = ["whiteout", "unknown screen"];

type Phase = { kind: "ready" } | { kind: "playing"; limits: RunLimits } | { kind: "ended"; bot: RunHeader["bot"]; result: RunResult };

export class Harness {
  readonly #run: Run;
  readonly #knowledge: KnowledgeLevel;
  readonly #onAction?: ActionListener;
  readonly #onFrame?: (harness: Harness) => void;
  readonly #onCallStart?: CallStartListener;
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
    this.#onCallStart = options.onCallStart;
    this.#onModelCall = options.onModelCall;
    this.#onSummaryCall = options.onSummaryCall;
    this.#frameBudget = options.frameBudget;
    this.#noProgressLimit = options.noProgressLimit;
    this.#stopAsked = options.stopAsked ?? (() => false);
    this.#parent = options.parent?.name ?? null;
    this.#watch = new GameWatch(run.game);
    this.#atlas = new AtlasWatch(run.game, this.#knowledge);
    this.#menus = new MenuDriver(run.game, { advance: (keys) => this.advance(keys) });
  }

  /** The Harness owns the Run, also a Run that the caller opened: it closes the Run when the Run cannot start. */
  static async open(options: HarnessOptions = {}, run?: Run): Promise<Harness> {
    const startSave = run?.startSavePath ?? options.startSave ?? START_SAVE;
    if (!(await Bun.file(startSave).exists())) {
      run?.core.close();
      throw new Error(`${startSave} not found: make the Starting save first (lab/README.md)`);
    }
    const opened = run ?? (await Run.open({ startSave, names: options.parent?.record.header.names }));
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
    const tokenLimit = bot.model?.tokenLimit ?? Number.POSITIVE_INFINITY;
    const limits = new RunLimits({ goal, lastFrame: this.frame + frameBudget, noProgressLimit, costLimit, tokenLimit, progress: this.progress(), firstEvent: this.#events.length, stopAtWhiteout: bot.model?.stopAtWhiteout ?? false });
    this.#phase = { kind: "playing", limits };
    let endReason: EndReason = "bot stopped";
    let planLimit: string | undefined;
    let result: RunResult | null = null;
    try {
      this.lightDarkMap();
      await bot.play(this);
    } catch (error) {
      if (!(error instanceof RunEnd)) throw error;
      endReason = error.reason;
      planLimit = error.planLimit;
    } finally {
      result = { endReason, frames: this.frame - start, milestones: this.#run.game.milestones(), rawInputs: this.rawInputs - rawInputs, ...(ENDS_WITH_TEXT.includes(endReason) ? { lastText: this.lastText() } : {}), ...(planLimit === undefined ? {} : { planLimit }) };
      this.#phase = { kind: "ended", bot: { name: bot.name, version: bot.version, ...(bot.model ? { model: bot.model } : {}) }, result };
    }
    return result;
  }

  /** The last text of the game in the results of the actions. */
  private lastText(): string {
    return this.#events.flatMap((e) => (e.type === "action" && "text" in e.result ? e.result.text : [])).at(-1) ?? "";
  }

  end(reason: "unknown screen"): never {
    throw new RunEnd(reason);
  }

  endAtPlanLimit(text: string): never {
    throw new RunEnd("plan limit", text);
  }

  trainerNames(): TrainerNames {
    return { player: this.#run.game.playerName(), rival: this.#run.game.rivalName() };
  }

  /** The names that the Bot cannot change, or null before the first action of the Run. */
  fixedNames(): TrainerNames | null {
    return this.#events.some((e) => e.type === "action") ? this.trainerNames() : null;
  }

  // The bootup does not read the names: the same buttons give the same state, so the watches stay right.
  nameTrainers(names: TrainerNames): void {
    if (this.fixedNames()) throw new Error("the names of a Run change only before its first action");
    this.#run.rename(names, this.#buttons.holds);
  }

  /** `ask` must end when its signal aborts, and can throw only through `endAtPlanLimit`. */
  async modelCall<T>(ask: (signal: AbortSignal) => Promise<{ answer: ModelAnswer; action: T }>): Promise<T> {
    this.#onCallStart?.("model", this);
    const start = performance.now();
    const { answer, action } = await this.untilStop(ask);
    // Before callEnded: a limit can end the Run there, and its record must agree with its game.
    const names = answer.decision?.names;
    if (names && !this.fixedNames()) this.nameTrainers(names);
    this.callEnded({ type: "model", frame: this.frame, latencyMs: Math.round(performance.now() - start), ...answer }, this.#onModelCall);
    return action;
  }

  async summaryCall(ask: (signal: AbortSignal) => Promise<SummaryAnswer>): Promise<SummaryEvent> {
    this.#onCallStart?.("summary", this);
    const start = performance.now();
    const answer = await this.untilStop(ask);
    return this.callEnded({ type: "summary", frame: this.frame, latencyMs: Math.round(performance.now() - start), ...answer }, this.#onSummaryCall);
  }

  /** A call waits for the network, so the event loop has turns to read the stop flag: the call does not hold a stop until its answer. */
  private async untilStop<T>(ask: (signal: AbortSignal) => Promise<T>): Promise<T> {
    const controller = new AbortController();
    const check = setInterval(() => {
      if (this.#stopAsked()) controller.abort(new Error("a person stopped the Run"));
    }, STOP_CHECK_MS);
    try {
      return await ask(controller.signal);
    } finally {
      clearInterval(check);
    }
  }

  record(): RunRecord {
    if (this.#phase.kind !== "ended") throw new Error("no Run record: play a Bot first");
    const { bot, result } = this.#phase;
    const header = { ...this.#run.origin, knowledge: this.#knowledge, bot, ...(this.#parent ? { parent: this.#parent } : {}) };
    return { format: RECORD_FORMAT, header, buttons: this.#buttons.holds.map(([keys, frames]) => [keys, frames]), events: [...this.#events], track: [...this.#watch.track], state: [...this.#watch.stateTrack], result };
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
      atlas: this.#atlas.atlas(),
    };
    // The naming screen has no map and no grid: overworld() would fail there.
    if (base.waitingFor.kind === "naming") return { ...base, mode: "naming" };
    const battle = game.battle();
    if (battle) return { ...base, mode: "battle", battle: this.battleState(battle) };
    if (base.waitingFor.kind === "learnMove") return { ...base, mode: "menu" };
    const { player, grid, actors } = this.overworld();
    const people = actors.people.map(({ localId, x, y, graphics, loaded, stays, trainer }): Person => ({ localId, x, y, graphics, loaded, stays, ...(trainer && !trainer.defeated ? { unbeatenTrainer: true } : {}) }));
    return { ...base, mode: "overworld", map: game.map(), player, grid, people, boxes: game.boxMons(), repelActive: game.repelActive(), teachables: game.teachables() };
  }

  availableActions(): AvailableAction[] {
    const game = this.#run.game;
    const waiting = game.waitingFor();
    return ACCEPTS[waiting.kind].flatMap((name): AvailableAction[] => {
      switch (name) {
        case "goTo":
        case "walkOn":
        case "readText":
        case "leave":
        case "name":
        case "keep":
          return [{ name }];
        case "forget":
          return waiting.kind === "learnMove" ? game.party()[waiting.slot].moves.flatMap((move) => (isHmMove(move.name) ? [] : [{ name, move: move.name }])) : [];
        case "swap":
          return game.party().length > 1 ? [{ name }] : [];
        case "teach":
          return game.teachables().map(({ item }) => ({ name, item }));
        case "switch":
        case "send":
          return sendableSlots(game.partyOnScreen(), game.requireBattle().player.partyIndex).map((slot) => ({ name, slot }));
        case "interact":
          return this.interactions();
        case "choose":
          return waiting.kind === "choice" ? waiting.options.map((option) => ({ name, option })) : [];
        case "fight": {
          const { player } = game.requireBattle();
          if (player.encoredSlot !== null) return [{ name, move: player.encoredSlot }];
          return struggles(player) ? [{ name, move: 0 }] : player.moves.flatMap((m, move) => (m.pp > 0 ? [{ name, move }] : []));
        }
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
        case "depositPokemon":
          return game.party().map((_, slot) => ({ name, slot }));
        case "withdrawPokemon":
          return game.boxMons().map(({ box, position }) => ({ name, box, position }));
      }
    });
  }

  async goTo(x: number, y: number, map?: string): Promise<ActionResult> {
    return this.act({ name: "goTo", x, y, ...(map ? { map } : {}) }, () => this.walkTo({ map: map ?? this.place().map, x, y }, map === undefined));
  }

  // One Model call for each step would cost too much on a floor of 48 x 40 cells (#74).
  async walkOn(x: number, y: number, direction: Direction): Promise<ActionResult> {
    return this.act({ name: "walkOn", x, y, direction }, () => {
      const { map } = this.place();
      this.#atlas.lookAround();
      const peopleBefore = this.#atlas.peopleSeen(map);
      let outcome = this.walkTo({ map, x, y }, true);
      while (outcome.status === "done") {
        const next = this.nextDarkStep(map, peopleBefore, direction);
        if (!next) break;
        outcome = this.walkTo({ map, ...next }, true);
      }
      return outcome;
    });
  }

  private nextDarkStep(map: string, peopleBefore: number, direction: Direction): Cell | null {
    if (this.#run.game.waitingFor().kind !== "walk" || this.place().map !== map) return null;
    this.#atlas.lookAround();
    if (this.#atlas.peopleSeen(map) > peopleBefore) return null;
    const { player, grid, actors } = this.overworld();
    return this.#atlas.darkForModel(grid) ? nextStraightStep({ ...grid, people: actors.people }, player, direction) : null;
  }

  private walkTo(asked: Place, canExit: boolean): Outcome {
    const destination = destinationOf(asked, canExit, this.routeMaps());
    const outside = destination.exit ? null : outsideReason(asked, this.routeMaps()(asked.map), canExit, this.#atlas.blockOf);
    if (outside) return { status: "impossible", reason: outside };
    let tries = 0;
    let stuckAt: Place | null = null;
    for (let legs = 0; legs < MAX_LEGS; legs++) {
      const here = this.place();
      if (reached(destination, here)) return { status: "done" };
      const maps = this.routeMaps();
      const route = findRoute(here, destination, maps);
      if (!route) {
        const why = whyNoRoute(here, destination, maps);
        if (why.kind === "closed") return { status: "impossible", reason: noRouteReason(here, destination, asked, maps, this.#atlas.atlas(), (move) => this.obstacleRemedyNow(move)) };
        if (why.kind === "staying") return { status: "blocked", reason: stayingReason(why.person, this.#atlas.atlas()) };
      }
      const result = route ? this.walkLeg(route[0], route[1]?.map ?? route[0].map) : "stuck";
      switch (result) {
        case "done":
          tries = 0;
          this.lightDarkMap();
          break;
        case "stuck": {
          const now = this.place();
          tries = stuckAt && at(stuckAt) === at(now) ? tries + 1 : 1;
          stuckAt = now;
          if (tries >= BLOCKED_TRIES) return { status: "blocked", reason: `a person or an object stays in the way after ${tries} tries; the player is at ${at(now)}` };
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

  async depositPokemon(slot: number): Promise<ActionResult> {
    return this.act({ name: "depositPokemon", slot }, () => this.#menus.depositPokemon(slot));
  }

  async withdrawPokemon(box: number, position: number): Promise<ActionResult> {
    return this.act({ name: "withdrawPokemon", box, position }, () => this.#menus.withdrawPokemon(box, position));
  }

  async leave(): Promise<TextResult> {
    return this.act<Texts>({ name: "leave" }, () => this.#menus.leave(), { text: [] });
  }

  async name(text: string): Promise<TextResult> {
    return this.act<Texts>({ name: "name", text }, () => this.#menus.name(text), { text: [] });
  }

  async forget(move: string): Promise<TextResult> {
    return this.act<Texts>({ name: "forget", move }, () => this.#menus.forget(move), { text: [] });
  }

  async keep(): Promise<TextResult> {
    return this.act<Texts>({ name: "keep" }, () => this.#menus.keep(), { text: [] });
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

  async teach(item: string, on: number): Promise<TextResult> {
    return this.act<Texts>({ name: "teach", item, on }, () => this.#menus.teach(item, on), { text: [] });
  }

  /** Runs a Macro-action or a Raw input from its description. */
  async perform(action: MacroAction | RawInput): Promise<ActionResult> {
    switch (action.name) {
      case "goTo":
        return this.goTo(action.x, action.y, action.map);
      case "walkOn":
        return this.walkOn(action.x, action.y, action.direction);
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
      case "teach":
        return this.teach(action.item, action.on);
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
      case "depositPokemon":
        return this.depositPokemon(action.slot);
      case "withdrawPokemon":
        return this.withdrawPokemon(action.box, action.position);
      case "leave":
        return this.leave();
      case "name":
        return this.name(action.text);
      case "forget":
        return this.forget(action.move);
      case "keep":
        return this.keep();
      case "press":
        return this.press(action.button);
    }
  }

  async press(button: Button): Promise<ActionResult> {
    return this.act({ name: "press", button }, () => (button === "A" && this.facesUsableObstacle() ? this.#menus.useFieldMove() : this.#menus.input(Keys[button])));
  }

  private act(action: MacroAction | RawInput, body: () => Outcome): ActionResult;
  private act<T extends object>(action: MacroAction | RawInput, body: () => Outcome & Partial<T>, defaults: T): ActionResult & T;
  private act(action: MacroAction | RawInput, body: () => Outcome & Partial<Texts>, defaults = {}): ActionResult {
    const start = this.frame;
    const firstEvent = this.#events.length;
    const game = this.#run.game;
    const kind = game.waitingFor().kind;
    const refused = action.name !== "press" && !ACCEPTS[kind].includes(action.name);
    const turnStart = action.name !== "press" && (kind === "battleAction" || kind === "battleMove") ? game.battle() : null;
    const outcome: Outcome & Partial<Texts> = refused ? { status: "impossible", reason: `${action.name} is not available: the game waits for a ${kind}` } : body();
    // #74: a teach in the dark and a trainer at the entry must also give a lit map at the next walk prompt.
    if (!refused) this.lightDarkMap();
    const left = this.#menus.takeLeftWordScreen() ? { leftWordScreen: true as const } : {};
    const result = { ...defaults, ...outcome, ...left, frames: this.frame - start };
    const entry = { action, result };
    this.#battles.onAction(outcome.status === "impossible" ? null : turnStart, outcome.text ?? [], game.battle(), isDecisionPoint(game.waitingFor()));
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
    const current = hasStateEvents(record);
    const watched = current ? this.#events : withoutFormat(this.#events);
    if (!Bun.deepEquals(watched, record.events.filter(isGameEvent))) throw new Error("the Run record does not replay the same game: its Game events are different");
    this.#events.splice(0, this.#events.length, ...(current ? record.events : withStateEvents(record.events, this.#events)));
    this.#playStart = { frame: this.frame - record.result.frames, rawInputs: this.rawInputs - record.result.rawInputs };
  }

  private progress(): number {
    return this.#watch.gameProgress + this.#atlas.heard + this.#atlas.exits + this.#atlas.darkCells;
  }

  private lightDarkMap(): void {
    const game = this.#run.game;
    if (!this.#atlas.darkHere || game.waitingFor().kind !== "walk") return;
    const user = game.flashUser();
    if (user === null) return;
    const used = this.#menus.useFlash(user);
    if (used.status === "impossible" || used.status === "blocked") throw new Error(`the use of FLASH stops: ${used.reason}`);
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
      ...(kind === "wild" ? { kind, inPc: game.pcCount(enemy.species) } : { kind }),
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
    return { player, grid: { ...game.withObstacles(grid, this.obstaclesByUse(actors).closed), signs: grid.signs.filter((s) => s.kind === "sign") }, actors };
  }

  // A script runs during a whole text, choice or Raw input, so only a battle stops them.
  private advance(keys: number): boolean {
    if (this.#phase.kind === "playing") this.#phase.limits.beforeFrame(this.frame);
    this.#run.runFrame(keys);
    if (this.#phase.kind === "playing") this.#phase.limits.afterFrame(() => this.#run.game.whitingOut());
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

  private obstacleRemedyNow(move: FieldMove): string {
    const badge = this.#run.game.missingBadge(move);
    return badge === null ? obstacleRemedy(move) : badgeNeeded(move, badge);
  }

  private routeMaps(): MapSource {
    const maps = new Map<string, RouteMap | null>();
    return (name) => {
      if (!maps.has(name)) {
        const view = this.#run.game.mapView(name);
        if (!view) {
          maps.set(name, null);
          return null;
        }
        const { usable, closed } = this.obstaclesByUse(view.actors);
        const map = { ...view.grid, people: view.actors.people, obstacles: closed, removable: usable };
        const sight = this.#atlas.darkSight(view.grid);
        maps.set(name, sight ? onlySeen(map, sight) : map);
      }
      return maps.get(name)!;
    };
  }

  private walkLeg(leg: Leg, next: string): LegResult {
    for (const move of leg.moves) {
      const result = this.playMove(move);
      if (result !== "done") return result;
      if (this.#run.game.map().name !== leg.map) break;
    }
    const interruption = this.stopWalking();
    if (interruption) return interruption;
    return this.#run.game.map().name === next ? "done" : "map";
  }

  private playMove({ direction, kind }: Leg["moves"][number]): LegResult {
    switch (kind) {
      case "push":
        return this.push(direction);
      case "remove":
        return this.removeObstacle(direction);
      case "jump":
        return this.step(direction, 2);
      case "walk":
        return this.step(direction, 1);
    }
  }

  private stopWalking(): Interruption | null {
    return (this.#run.game.stepStarts() ? this.wait(1) : null) ?? this.settle();
  }

  private facesUsableObstacle(): boolean {
    if (this.#run.game.waitingFor().kind !== "walk") return false;
    const { player, actors } = this.overworld();
    const [dx, dy] = DIRECTION_STEP[player.facing];
    return this.obstaclesByUse(actors).usable.some((o) => o.x === player.x + dx && o.y === player.y + dy);
  }

  private obstaclesByUse({ obstacles }: Pick<MapActors, "obstacles">): { usable: Obstacle[]; closed: Obstacle[] } {
    const moves = this.#run.game.usableFieldMoves();
    return { usable: obstacles.filter((o) => moves.has(o.move)), closed: obstacles.filter((o) => !moves.has(o.move)) };
  }

  private removeObstacle(direction: Direction): LegResult {
    const interruption = this.stopWalking();
    if (interruption) return interruption;
    const turned = this.face(direction);
    if (turned.status !== "done") return turned.status === "interrupted" ? turned.reason : "no move";
    const used = this.#menus.useFieldMove();
    return used.status === "interrupted" ? used.reason : this.step(direction, 1);
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

function neighbours(cell: { x: number; y: number }): { direction: Direction; x: number; y: number }[] {
  return DIRECTION_STEPS.map(([direction, [dx, dy]]) => ({ direction, x: cell.x + dx, y: cell.y + dy }));
}
