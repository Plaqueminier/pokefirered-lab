// Frames run only inside a Macro-action or a Raw input: the game is frozen at each Decision point (docs/adr/0002).
import { readdir } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { BICYCLE, type BagPocket, battleItems, depositableItems, holdableItems, sellableItems, type Stone, type Teachable, walkItems } from "../bag";
import { type Battle, BattleWatch, type EnemyMon, enemyView, type MoveReach, struggles } from "../battle";
import { type BattleTurn, type FightFacts, fightFacts } from "../battle-facts";
import { DIRECTION_STEP, type Direction, KIND, OPPOSITE, SWITCH, withSurf } from "../cells";
import type { FlyDestination } from "../fly-destinations";
import { type FieldMove, isDecisionPoint, type GameInterruption, type GameState, type MapActors, type MapGrid, type MapKind, type MapScriptCells, MILESTONES, type Milestone, type Obstacle, type PlayerPosition, type SafariZone, type WaitingFor, walkRemoves } from "../game";
import { type BoxMon, hasTakableItem, isHmMove, type PartyMon, sendableSlots } from "../party";
import type { PcItem } from "../pc";
import { type BotInfo, type EndReason, type FieldMoveUse, Keys, moveRemedy, obstacleRemedy } from "../protocol";
import { Run, START_SAVE } from "../run";
import type { TrainerNames } from "../save-file";
import { type Atlas, AtlasWatch, type Sight } from "./atlas";
import { type Checkpoint, checkpointProblem, type CheckpointRead, type HarnessCheckpoint, type HarnessState, type Resume } from "./checkpoint";
import type { Genome } from "../genetic/genome";
import { isStateEvent, withoutFormat } from "./game-events";
import { ItemDriver } from "./item-driver";
import { MenuDriver, type Outcome, type Texts } from "./menu-driver";
import { type Cell, type Destination, destinationOf, findRoute, headingAlong, kindAt, type MapSource, neighbours, nextStepAlong, nextStraightStep, onlySeen, type Place, reached, type RouteMap, startsSurf, whyNoRoute } from "./path";
import { at, LoopGuard, noRouteReason, outsideReason, stayingReason } from "./route-reasons";
import { afterAction, modelLimits, RunEnd, RunLimits } from "./run-limits";
import { routeOntoSpin, spinDirection, withOpenTile } from "./slides";
import {
  type ActionEvent,
  ButtonTrack,
  GameWatch,
  isCurrentRecord,
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
  runWhiteouts,
  type SummaryAnswer,
  type SummaryEvent,
  withStateEvents,
} from "./record";
import { type Slid, WalkDriver } from "./walk-driver";

const BLOCKED_TRIES = 3;
const BLOCKED_WAIT_FRAMES = 30;
const MAX_LEGS = 64;
// A flight ends the Safari game: the player loses the balls and the steps.
const isSafariZone = (map: string) => map.startsWith("SafariZone_");
// readText also runs a busy game to its next text.
const ACCEPTS: Record<WaitingFor["kind"], AvailableAction["name"][]> = {
  walk: ["goTo", "walkOn", "interact", "push", "swap", "use", "teach", "give", "take"],
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

export type BattleState = { player: Battle["player"]; enemy: EnemyMon; fights: (FightFacts | null)[]; double?: { ally: Battle["player"] | null; otherFoe: { enemy: EnemyMon; fights: (FightFacts | null)[] } | null; reach: MoveReach[] }; lastTurn: BattleTurn | null; foeTurns: BattleTurn[] } & Pick<Battle, "ghost" | "safari"> & ({ kind: "trainer" } | { kind: "wild"; inPc: number });

type ObservationBase = { waitingFor: WaitingFor; party: PartyMon[]; bag: BagPocket[]; money: number; milestones: Milestone[]; atlas: Atlas };

/** `unbeatenTrainer`: a trainer that the player did not beat yet. A talk or its sight starts a battle. */
export type Person = Pick<MapActors["people"][number], "localId" | "x" | "y" | "graphics" | "loaded" | "stays"> & { unbeatenTrainer?: boolean };

export type StrengthUse = FieldMoveUse & { moved: boolean };

type FlyTarget = Pick<FlyDestination, "name" | "area" | "map" | "x" | "y">;
export type FlyUse = { usable: boolean; destinations: FlyTarget[] };

export type Observation = ObservationBase &
  ({ mode: "overworld"; map: GameState["map"]; mapKind: MapKind; player: PlayerPosition; grid: MapGrid; people: Person[]; boxes: BoxMon[]; pcItems: PcItem[]; repelActive: boolean; safari?: SafariZone; riding: boolean; rideChosen: boolean; surfing: boolean; strength: StrengthUse; fly: FlyUse; teachables: Teachable[]; stones: Stone[] } | { mode: "battle"; battle: BattleState } | { mode: "naming" } | { mode: "menu" });

export type RunResult = { endReason: EndReason; frames: number; milestones: Milestone[]; rawInputs: number; lastText?: string; planLimit?: string };

/** `since`: the number of events of the Run at the last progress. */
export type NoProgress = { stuck: number; since: number };

export type Interruption = GameInterruption | "map";

export type PushReport = { pushes: number; x: number; y: number; direction: Direction } & ({ stop: "steps" | "blocked" | "switch" | "interrupted" } | { stop: "hole"; into: string | null });

export type ActionResult = Outcome & Slid & { push?: PushReport } & {
  frames: number;
  leftWordScreen?: true;
};

export type TextResult = ActionResult & Texts;

export type MacroAction =
  | { name: "goTo"; x: number; y: number; map?: string }
  | { name: "walkOn"; x: number; y: number; direction: Direction }
  | { name: "interact"; x: number; y: number }
  | { name: "push"; x: number; y: number; direction: Direction; steps?: number }
  | { name: "readText" }
  | { name: "choose"; option: string }
  | { name: "fight"; move: number; foe?: number }
  | { name: "switch"; slot: number }
  | { name: "send"; slot: number }
  | { name: "swap"; first: number; second: number }
  | { name: "teach" | "give"; item: string; on: number }
  | { name: "take"; on: number }
  | { name: "run" }
  | { name: "use"; item: string; on?: number; move?: string }
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
  | { name: "goTo" | "walkOn" | "push" | "swap" | "name" }
  | { name: "use" | "teach" | "give" | "buy" | "sell" | "withdraw" | "deposit"; item: string }
  | Exclude<MacroAction, { name: "goTo" | "walkOn" | "push" | "swap" | "name" | "use" | "teach" | "give" | "buy" | "sell" | "withdraw" | "deposit" }>;

export type Button = keyof typeof Keys;

export type RawInput = { name: "press"; button: Button };

export type ActionEntry = { action: MacroAction | RawInput; result: ActionResult | TextResult };

const BOTS_DIR = join(import.meta.dir, "..", "..", "bots");

export async function botNames(): Promise<string[]> {
  return (await readdir(BOTS_DIR)).flatMap((file) => (file.endsWith(".ts") ? [file.slice(0, -3)] : [])).sort();
}

export async function loadBot(name: string, model: ModelOptions = {}, genome?: Genome): Promise<Bot> {
  const path = isAbsolute(name) ? name : join(BOTS_DIR, `${name}.ts`);
  const file = path === name ? name : `bots/${name}.ts`;
  const module = await import(path);
  const withModel = Object.values(model).some((option) => option !== undefined);
  if (genome && typeof module.geneticBot !== "function") throw new Error(`${file} is not a Genetic bot: it does not export geneticBot(genome)`);
  if (typeof module.modelBot === "function") return module.modelBot(model);
  if (typeof module.geneticBot === "function") {
    if (withModel) throw new Error(`${file} plays with a Genome, not with a model: bun run bot ${name} --genome <file>`);
    return module.geneticBot(genome);
  }
  if (withModel) throw new Error(`${file} is not a model bot: it does not export modelBot(model)`);
  const bot: Bot | undefined = module.default;
  if (typeof bot?.play !== "function") throw new Error(`${file} must export by default a Bot: { name, version, play(harness) }`);
  return bot;
}

export async function botInfos(): Promise<BotInfo[]> {
  return Promise.all(
    (await botNames()).map((name) =>
      loadBot(name).then(
        (bot): BotInfo => ({ name, kind: bot.model ? "model" : bot.genome ? "genetic" : "scripted", version: bot.version, goal: bot.goal ?? null, costLimit: bot.model?.costLimit ?? null }),
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
  seed?: number;
  onAction?: ActionListener;
  onFrame?: (harness: Harness) => void;
  onCallStart?: CallStartListener;
  onModelCall?: ModelCallListener;
  onSummaryCall?: SummaryCallListener;
  frameBudget?: number;
  noProgressLimit?: number;
  /** When it gives true, the Run ends with "user stop" after the Macro-action or the Raw input that plays, and at once in a Model call: see `untilStop`. */
  stopAsked?: () => boolean;
  /** The Run continues this Run record: the Harness loads its Checkpoint or replays its buttons, and keeps its events. `name` is its file in lab/runs/. */
  parent?: ParentRecord;
  /** The first frame of the Run, from which its whiteouts count. An Extended Run gives the start of its first part. By default: the frame where the play starts. */
  runStart?: number;
  /** The read of the Checkpoint at the end of the parent: a good one replaces the replay, and else `resumed` gives the problem. */
  checkpoint?: CheckpointRead;
};

export type ParentRecord = { name: string; record: RunRecord };

export type ReplayStop = { frame: number; events: number };

export type ReplayedState = { observation: Observation; events: RunEvent[]; noProgress: NoProgress; names: TrainerNames | null; frame: number; whiteouts: number };

// A mark of a replay, at the index of an event of the record: the start of a part of the Run, or the end of an action.
type ReplayMark = { index: number } & ({ kind: "partStart" } | { kind: "action"; progressed: boolean; decisionPoint: boolean });

type ReplayAction = { event: ActionEvent; index: number; turnStart: Battle | null };

type ReplaySpy = { stops: readonly ReplayStop[]; onStop: (stop: ReplayStop, state: ReplayedState) => void };

function buttonsUpTo(buttons: RunRecord["buttons"], frame: number): RunRecord["buttons"] {
  const kept: RunRecord["buttons"] = [];
  let left = frame;
  for (const [keys, frames] of buttons) {
    if (left <= 0) break;
    kept.push([keys, Math.min(frames, left)]);
    left -= frames;
  }
  return kept;
}

export type Bot = {
  name: string;
  version: string;
  goal?: Milestone;
  model?: ModelSettings;
  genome?: Genome;
  frameBudget?: number;
  noProgressLimit?: number;
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
  #events: RunEvent[] = [];
  readonly #menus: MenuDriver;
  readonly #items: ItemDriver;
  readonly #parent: string | null;
  #runStart: number | undefined;
  readonly #walk: WalkDriver;
  /** Where the play of a continued Run started, in its parent: the Run result counts the frames and the Raw inputs of the whole Run. */
  #playStart: { frame: number; rawInputs: number } | null = null;
  #phase: Phase = { kind: "ready" };
  #resumed: Resume | null = null;

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
    this.#runStart = options.runStart;
    this.#watch = new GameWatch(run.game);
    this.#atlas = new AtlasWatch(run.game, this.#knowledge);
    // A replay does not pass here, so an old Run record that stopped an evolution with B stays the same game.
    const frames = { advance: (keys: number) => this.advance(keys & Keys.B && run.game.evolutionCanStop() ? keys & ~Keys.B : keys) };
    this.#menus = new MenuDriver(run.game, frames);
    this.#items = new ItemDriver(run.game, this.#menus);
    this.#walk = new WalkDriver(run.game, frames, this.#menus, this.#items);
  }

  /** The Harness owns the Run, also a Run that the caller opened: it closes the Run when the Run cannot start. */
  static async open(options: HarnessOptions = {}, run?: Run): Promise<Harness> {
    const startSave = run?.startSavePath ?? options.startSave ?? START_SAVE;
    if (!(await Bun.file(startSave).exists())) {
      run?.core.close();
      throw new Error(`${startSave} not found: make the Starting save first (lab/README.md)`);
    }
    const opened = run ?? (await Run.open({ startSave, names: options.parent?.record.header.names, seed: options.seed ?? options.parent?.record.header.seed }));
    try {
      if (options.parent) return Harness.fromParent(opened, options, options.parent.record);
      const harness = new Harness(opened, options);
      const interruption = harness.#walk.settle();
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

  get whiteouts(): number {
    if (this.#phase.kind !== "playing") throw new Error("whiteouts exist only while a Bot plays");
    return this.#phase.limits.whiteouts;
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

  get resumed(): Resume | null {
    return this.#resumed;
  }

  checkpoint(): HarnessCheckpoint {
    const { core } = this.#run;
    return { emulator: { state: core.saveState(), flash: core.saveData() }, harness: structuredClone(this.watchState()) };
  }

  private watchState(): HarnessState {
    return { game: this.#watch.snapshot(), atlas: this.#atlas.snapshot(), battles: this.#battles.snapshot(), rideChosen: this.#walk.rideChosen };
  }

  private static fromParent(run: Run, options: HarnessOptions, record: RunRecord): Harness {
    const read = options.checkpoint ?? null;
    const harness = new Harness(run, options);
    if (read === null || "problem" in read) return harness.replayed(record, read?.problem ?? null);
    const problem = checkpointProblem(read.checkpoint, record, run, harness.watchState());
    if (problem) return harness.replayed(record, problem);
    try {
      harness.load(record, read.checkpoint);
      harness.#resumed = { from: "checkpoint" };
      return harness;
    } catch (error) {
      // A load that fails can leave a part of the Checkpoint in the emulator and in the watches.
      run.reboot();
      return new Harness(run, options).replayed(record, `the Checkpoint does not load: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private replayed(record: RunRecord, problem: string | null): Harness {
    this.replayParent(record);
    this.#resumed = { from: "replay", problem };
    return this;
  }

  // The watches take the objects of the Checkpoint: one Checkpoint loads in one Harness only.
  private load(record: RunRecord, { emulator, harness }: Checkpoint): void {
    if (!isCurrentRecord(record)) throw new Error("the Run record has no track or no State track");
    const { core } = this.#run;
    if (!core.loadSaveData(emulator.flash) || !core.loadState(emulator.state)) throw new Error("the emulator does not load the savestate");
    const frames = new RecordPlayer(record).frames;
    if (this.frame !== frames) throw new Error(`the savestate is at frame ${this.frame}, and the Run record ends at frame ${frames}`);
    this.#watch.restore(harness.game, record);
    this.#atlas.restore(harness.atlas);
    this.#battles.restore(harness.battles);
    this.#walk.restore(harness.rideChosen);
    this.#buttons.restore(record.buttons);
    this.#events = Array.from(record.events);
    this.#playStart = this.startOfPlay(record);
  }

  private startOfPlay({ result }: RunRecord): { frame: number; rawInputs: number } {
    return { frame: this.frame - result.frames, rawInputs: this.rawInputs - result.rawInputs };
  }

  close(): void {
    this.#run.core.close();
  }

  async play(bot: Bot): Promise<RunResult> {
    if (this.#phase.kind !== "ready") throw new Error("a Harness plays one Run");
    this.#playStart ??= { frame: this.frame, rawInputs: this.rawInputs };
    const { frame: start, rawInputs } = this.#playStart;
    const frameBudget = this.#frameBudget ?? bot.frameBudget ?? Number.POSITIVE_INFINITY;
    const goal = bot.goal ?? MILESTONES[MILESTONES.length - 1];
    const noProgressLimit = this.#noProgressLimit ?? bot.noProgressLimit ?? Number.POSITIVE_INFINITY;
    const limits = new RunLimits({ goal, lastFrame: this.frame + frameBudget, noProgressLimit, progress: this.progress(), ...modelLimits(bot.model), runStart: (this.#runStart ??= this.frame) }, this.#events);
    this.#phase = { kind: "playing", limits };
    let endReason: EndReason = "bot stopped";
    let planLimit: string | undefined;
    let result: RunResult | null = null;
    try {
      limits.beforeFrame(this.frame);
      this.lightDarkMap();
      await bot.play(this);
    } catch (error) {
      if (!(error instanceof RunEnd)) throw error;
      endReason = error.reason;
      planLimit = error.planLimit;
    } finally {
      result = { endReason, frames: this.frame - start, milestones: this.#run.game.milestones(), rawInputs: this.rawInputs - rawInputs, ...(ENDS_WITH_TEXT.includes(endReason) ? { lastText: this.lastText() } : {}), ...(planLimit === undefined ? {} : { planLimit }) };
      this.#phase = { kind: "ended", bot: { name: bot.name, version: bot.version, ...(bot.model ? { model: bot.model } : {}), ...(bot.genome ? { genome: bot.genome } : {}) }, result };
    }
    return result;
  }

  /** After the end of a part, the next `play` continues the same Run in this Harness, with no replay. */
  nextPart(): void {
    if (this.#phase.kind !== "ended") throw new Error("the next part starts after the end of a part");
    this.#phase = { kind: "ready" };
    this.#resumed = { from: "live" };
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
    const header = { ...this.#run.origin, knowledge: this.#knowledge, bot, ...(this.#parent ? { parent: this.#parent, runStart: this.#runStart } : {}) };
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
    const safari = game.safariZone();
    const people = actors.people.map(({ localId, x, y, graphics, loaded, stays, trainer }): Person => ({ localId, x, y, graphics, loaded, stays, ...(trainer && !trainer.defeated ? { unbeatenTrainer: true } : {}) }));
    return { ...base, mode: "overworld", map: game.map(), mapKind: game.mapKindHere(), player, grid, people, boxes: game.boxMons(), pcItems: game.pcItems(), repelActive: game.repelActive(), ...(safari ? { safari } : {}), riding: game.riding(), rideChosen: this.#walk.rideChosen, surfing: game.surfing(), strength: this.strengthUse(grid, actors), fly: this.flyUse(grid.name), teachables: game.teachables(), stones: game.stones() };
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
        case "push":
          return game.usableFieldMoves().has("STRENGTH") ? [{ name }] : [];
        case "forget":
          return waiting.kind === "learnMove" ? game.party()[waiting.slot].moves.flatMap((move) => (isHmMove(move.name) ? [] : [{ name, move: move.name }])) : [];
        case "swap":
          return game.party().length > 1 ? [{ name }] : [];
        case "teach":
          return game.teachables().map(({ item }) => ({ name, item }));
        case "give":
          return holdableItems(game.bag()).map((item) => ({ name, item: item.name }));
        case "take":
          return game.party().flatMap((mon, on) => (hasTakableItem(mon) ? [{ name, on }] : []));
        case "switch":
        case "send":
          return sendableSlots(game.partyOnScreen(), [game.requireBattle().player.partyIndex, game.requireBattle().double?.ally?.partyIndex]).map((slot) => ({ name, slot }));
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
          return (waiting.kind === "walk" ? walkItems(bag, game.stones()) : battleItems(bag, game.requireBattle().kind)).map((item) => ({ name, item: item.name }));
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
    return this.act({ name: "goTo", x, y, ...(map ? { map } : {}) }, () => {
      const asked = { map: map ?? this.#run.game.playerPlace().map, x, y };
      const target = this.routeMaps()(asked.map);
      return target && spinDirection(target, asked) ? this.slideFrom(asked) : this.walkTo(asked, map === undefined);
    });
  }

  private slideFrom(tile: Place): Outcome & Slid {
    const here = this.#run.game.playerPlace();
    const opened = withOpenTile(this.routeMaps(), tile);
    const approach = routeOntoSpin(here, tile, opened);
    if (!approach) return this.noRouteOutcome(here, tile, tile, opened) ?? { status: "blocked", reason: `a person who walks stands on the way to the spin tile at ${at(tile)}` };
    const walked = this.walkTo(approach.from, false);
    return walked.status === "done" ? this.#walk.slide(approach.direction) : walked;
  }

  private noRouteOutcome(here: Place, destination: Destination, asked: Place, maps: MapSource): Outcome | null {
    const why = whyNoRoute(here, destination, maps);
    if (why.kind === "closed") return { status: "impossible", reason: noRouteReason(here, destination, asked, maps, this.#atlas.atlas(), { move: (move) => this.obstacleRemedyNow(move), obstacle: (o) => obstacleRemedy(o, this.fieldMoveUse(o.move)) }) };
    if (why.kind === "staying") return { status: "blocked", reason: stayingReason(why.person, this.#atlas.atlas()) };
    return null;
  }

  // One Model call for each step would cost too much on a floor of 48 x 40 cells (#74).
  async walkOn(x: number, y: number, direction: Direction): Promise<ActionResult> {
    return this.act({ name: "walkOn", x, y, direction }, () => {
      const start = this.#run.game.playerPlace();
      const { map } = start;
      const heading = headingAlong(start, { x, y }, direction);
      this.#atlas.lookAround();
      const peopleBefore = this.#atlas.peopleSeen(map);
      let outcome = this.walkTo({ map, x, y }, true);
      while (outcome.status === "done") {
        const next = this.nextDarkStep(map, peopleBefore, direction, heading);
        if (!next) break;
        outcome = this.walkTo({ map, ...next }, true);
      }
      return outcome;
    });
  }

  private nextDarkStep(map: string, peopleBefore: number, direction: Direction, heading: Direction | null): Cell | null {
    if (this.#run.game.waitingFor().kind !== "walk" || this.#run.game.playerPlace().map !== map) return null;
    this.#atlas.lookAround();
    if (this.#atlas.peopleSeen(map) > peopleBefore) return null;
    const { player, grid, actors } = this.overworld();
    const seen = this.#atlas.darkSight(grid);
    if (!seen) return null;
    const cells = { ...grid, people: actors.people };
    return nextStraightStep(cells, player, direction) ?? (heading && nextStepAlong(cells, player, direction, heading, seen));
  }

  private walkTo(asked: Place, canExit: boolean): Outcome {
    const destination = destinationOf(asked, canExit, this.routeMaps());
    const outside = destination.exit ? null : outsideReason(asked, this.routeMaps()(asked.map), canExit, this.#atlas.blockOf, (move) => this.obstacleRemedyNow(move));
    if (outside) return { status: "impossible", reason: outside };
    let tries = 0;
    let stuckAt: Place | null = null;
    const loop = new LoopGuard();
    for (let legs = 0; legs < MAX_LEGS; legs++) {
      const here = this.#run.game.playerPlace();
      if (reached(destination, here)) return { status: "done" };
      const again = loop.arrive(here);
      if (again) return { status: "impossible", reason: again };
      const changed = this.#walk.matchRide();
      if (changed.status !== "done") return changed;
      const maps = this.routeMaps();
      // A map script can read a flag that changed on another map (the switch of Pokémon Mansion): then the ROM cells can be right.
      const lastStepRoute = findRoute(here, destination, maps);
      const rom = this.romMaps();
      const route = lastStepRoute ?? findRoute(here, destination, rom);
      if (!lastStepRoute && route) loop.romRoute(route, maps, rom);
      const failed = route ? null : this.noRouteOutcome(here, destination, asked, maps);
      if (failed) return failed;
      const leg = route?.[0];
      if (leg && "fly" in leg) {
        const flown = this.#menus.fly(leg.fly.tile);
        if (flown.status !== "done") return flown;
        tries = 0;
        continue;
      }
      const result = leg ? this.#walk.walkLeg(leg, route[1]?.map ?? leg.map) : "stuck";
      switch (result) {
        case "done":
          tries = 0;
          this.lightDarkMap();
          break;
        case "stuck": {
          const now = this.#run.game.playerPlace();
          tries = stuckAt && at(stuckAt) === at(now) ? tries + 1 : 1;
          stuckAt = now;
          if (tries >= BLOCKED_TRIES) return { status: "blocked", reason: `a person or an object stays in the way after ${tries} tries; the player is at ${at(now)}` };
          const interruption = this.#walk.wait(BLOCKED_WAIT_FRAMES);
          if (interruption) return { status: "interrupted", reason: interruption };
          break;
        }
        case "no move":
          return { status: "impossible", reason: `the player cannot move from ${at(this.#run.game.playerPlace())}` };
        case "no warp":
          return { status: "impossible", reason: `the warp does not start from ${at(this.#run.game.playerPlace())}` };
        default:
          return { status: "interrupted", reason: result };
      }
    }
    return { status: "impossible", reason: `the player is not at the target after ${MAX_LEGS} legs` };
  }

  async interact(x: number, y: number): Promise<ActionResult> {
    return this.act({ name: "interact", x, y }, () => {
      const game = this.#run.game;
      const here = this.#run.game.playerPlace();
      const direction = neighbours(here).find((n) => n.x === x && n.y === y)?.direction;
      if (!direction) return { status: "impossible", reason: `(${x}, ${y}) is not next to the player at ${at(here)}` };
      const turned = this.#walk.face(direction);
      if (turned.status !== "done") return turned;
      const battle = this.#walk.tap(Keys.A);
      if (battle) return { status: "interrupted", reason: battle };
      // ScriptContext_SetupScript locks the field controls, so an unlocked field means A started no script.
      if (!game.fieldLocked()) return { status: "impossible", reason: `nothing at (${x}, ${y}) starts a script` };
      return this.#menus.untilDecision();
    });
  }

  async push(x: number, y: number, direction: Direction, steps = 1): Promise<ActionResult> {
    return this.act({ name: "push", x, y, direction, ...(steps === 1 ? {} : { steps }) }, () => this.pushBoulder({ x, y }, direction, steps));
  }

  private pushBoulder(cell: Cell, direction: Direction, steps: number): Outcome & { push?: PushReport } {
    const game = this.#run.game;
    const grid = game.grid();
    if (!grid) throw new Error("a push needs the overworld");
    if (!Number.isInteger(steps) || steps < 1) return { status: "impossible", reason: `steps is a whole number of 1 or more, not ${steps}` };
    if (!game.usableFieldMoves().has("STRENGTH")) return { status: "impossible", reason: this.obstacleRemedyNow("STRENGTH") };
    const { map } = game.playerPlace();
    const boulders = () => game.mapView(map)?.actors.obstacles.filter((o) => o.move === "STRENGTH") ?? [];
    const seen = boulders().find((o) => o.x === cell.x && o.y === cell.y && this.#atlas.sawObstacle(map, o.localId));
    if (!seen) return { status: "impossible", reason: `you saw no boulder at (${cell.x}, ${cell.y}) of ${map}` };
    const [dx, dy] = DIRECTION_STEP[direction];
    const behind = (c: Cell): Cell => ({ x: c.x - dx, y: c.y - dy });
    if (game.surfing() || kindAt(grid, behind(cell)) === KIND.water) return { status: "impossible", reason: "you push a boulder only from the land, not from the water" };
    const boulder = () => boulders().find((o) => o.localId === seen.localId) ?? null;
    let at: Cell = seen;
    let pushes = 0;
    const report = (stop: PushReport["stop"], into: string | null = null): PushReport => (stop === "hole" ? { pushes, x: at.x, y: at.y, direction, stop, into } : { pushes, x: at.x, y: at.y, direction, stop });
    while (pushes < steps) {
      const walked = this.walkTo({ map, ...behind(at) }, false);
      if (walked.status !== "done") {
        if (pushes > 0) return walked.status === "interrupted" ? { ...walked, push: report("interrupted") } : { status: "blocked", reason: walked.reason, push: report("interrupted") };
        if (walked.status !== "impossible") return walked;
        const { x, y } = behind(at);
        return { status: "impossible", reason: `no route to (${x}, ${y}), the cell ${OPPOSITE[direction]} of the boulder` };
      }
      const pushed = this.#walk.pushOnce(direction, boulder);
      if (pushed.moved) {
        pushes++;
        at = pushed.at ?? { x: at.x + dx, y: at.y + dy };
      }
      if (pushed.result === "no move") return { status: "done", push: report("blocked") };
      if (pushed.result !== "done") return { status: "interrupted", reason: pushed.result, push: report("interrupted") };
      if (pushed.at === null) return { status: "done", push: report("hole", grid.warps.find((w) => w.x === at.x && w.y === at.y)?.to ?? null) };
      if (kindAt(grid, at) === SWITCH) return { status: "done", push: report("switch") };
    }
    return { status: "done", push: report("steps") };
  }

  async readText(): Promise<TextResult> {
    return this.act<Texts>({ name: "readText" }, () => this.#menus.readText(), { text: [] });
  }

  async choose(option: string): Promise<ActionResult> {
    return this.act({ name: "choose", option }, () => this.#menus.choose(option));
  }

  async fight(move: number, foe?: number): Promise<TextResult> {
    return this.act<Texts>({ name: "fight", move, ...(foe === undefined ? {} : { foe }) }, () => this.#menus.fight(move, foe), { text: [] });
  }

  async run(): Promise<TextResult> {
    return this.act<Texts>({ name: "run" }, () => this.#menus.run(), { text: [] });
  }

  async use(item: string, on?: number, move?: string): Promise<TextResult> {
    return this.act<Texts>({ name: "use", item, ...(on === undefined ? {} : { on }), ...(move === undefined ? {} : { move }) }, () => (item === BICYCLE && this.#run.game.waitingFor().kind === "walk" ? this.#walk.chooseRide(on) : this.#items.use(item, on, move)), { text: [] });
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
    return this.act<Texts>({ name: "forget", move }, () => this.#items.forget(move), { text: [] });
  }

  async keep(): Promise<TextResult> {
    return this.act<Texts>({ name: "keep" }, () => this.#items.keep(), { text: [] });
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
    return this.act<Texts>({ name: "teach", item, on }, () => this.#items.teach(item, on), { text: [] });
  }

  async give(item: string, on: number): Promise<TextResult> {
    return this.act<Texts>({ name: "give", item, on }, () => this.#items.give(item, on), { text: [] });
  }

  async take(on: number): Promise<TextResult> {
    return this.act<Texts>({ name: "take", on }, () => this.#items.take(on), { text: [] });
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
      case "push":
        return this.push(action.x, action.y, action.direction, action.steps);
      case "readText":
        return this.readText();
      case "choose":
        return this.choose(action.option);
      case "fight":
        return this.fight(action.move, action.foe);
      case "switch":
        return this.switch(action.slot);
      case "send":
        return this.send(action.slot);
      case "swap":
        return this.swap(action.first, action.second);
      case "teach":
        return this.teach(action.item, action.on);
      case "give":
        return this.give(action.item, action.on);
      case "take":
        return this.take(action.on);
      case "run":
        return this.run();
      case "use":
        return this.use(action.item, action.on, action.move);
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
    return this.act({ name: "press", button }, () => (button === "A" && this.facesFieldMoveTarget() ? this.#menus.useFieldMove() : this.#menus.input(Keys[button])));
  }

  private act(action: MacroAction | RawInput, body: () => Outcome): ActionResult;
  private act<T extends object>(action: MacroAction | RawInput, body: () => Outcome & Partial<T>, defaults: T): ActionResult & T;
  private act(action: MacroAction | RawInput, body: () => Outcome & Partial<Texts>, defaults = {}): ActionResult {
    const start = this.frame;
    const firstEvent = this.#events.length;
    const game = this.#run.game;
    const kind = game.waitingFor().kind;
    const refused = action.name !== "press" && !ACCEPTS[kind].includes(action.name);
    const turnStart = this.turnStartOf(action, kind);
    const outcome: Outcome & Partial<Texts> = refused ? { status: "impossible", reason: `${action.name} is not available: the game waits for a ${kind}` } : body();
    // #74: a teach in the dark and a trainer at the entry must also give a lit map at the next walk prompt.
    if (!refused) this.lightDarkMap();
    const left = this.#menus.takeLeftWordScreen() ? { leftWordScreen: true as const } : {};
    const result = { ...defaults, ...outcome, ...left, frames: this.frame - start };
    const entry = { action, result };
    this.battleActionEnded(outcome.status, turnStart, outcome.text ?? []);
    // The action event goes before the game events of its frames.
    this.#events.splice(firstEvent, 0, { type: "action", frame: start, ...entry });
    this.actionEnded(entry);
    this.#onAction?.(entry, this);
    if (this.#phase.kind === "playing") {
      const waiting = this.#run.game.waitingFor();
      this.#phase.limits.atAction(this.#run.game.milestones(), this.progress(), this.#events.length, { frame: this.frame, decisionPoint: isDecisionPoint(waiting), walk: waiting.kind === "walk" });
    }
    this.stopIfAsked();
    return result;
  }

  private actionEnded(entry: ActionEntry): void {
    this.#walk.onAction(entry);
    this.#atlas.onAction(entry);
  }

  /** The battle before an action that plays a turn: the battle watch reads the turn from it. */
  private turnStartOf(action: MacroAction | RawInput, kind: WaitingFor["kind"]): Battle | null {
    return action.name !== "press" && (kind === "battleAction" || kind === "battleMove") ? this.#run.game.battle() : null;
  }

  /** Tells the battle watch that an action ended, and returns if the game then waits for a decision. */
  private battleActionEnded(status: ActionResult["status"], turnStart: Battle | null, texts: string[]): boolean {
    const game = this.#run.game;
    const decisionPoint = isDecisionPoint(game.waitingFor());
    this.#battles.onAction(status === "impossible" ? null : turnStart, texts, game.battle(), decisionPoint);
    return decisionPoint;
  }

  static async replayStops(parent: ParentRecord, stops: readonly ReplayStop[], onStop: ReplaySpy["onStop"]): Promise<void> {
    const last = stops.at(-1);
    if (!last) return;
    const { record } = parent;
    const run = await Run.open({ names: record.header.names, seed: record.header.seed });
    try {
      const cut = { ...record, buttons: buttonsUpTo(record.buttons, last.frame), events: record.events.slice(0, last.events) };
      new Harness(run, { knowledge: record.header.knowledge }).replayParent(cut, { stops, onStop });
    } finally {
      run.core.close();
    }
  }

  // The watches see the same frames and the same actions as in the parent Run, so the Atlas and the Memory tree go on from where the parent stopped.
  private replayParent(record: RunRecord, spy?: ReplaySpy): void {
    const differences = originDifferences(this.#run, record);
    if (differences.length > 0) throw new Error(`the Run record does not replay here: different ${differences.join(", ")}`);
    const player = new RecordPlayer(record);
    const game = this.#run.game;
    const actions = record.events.flatMap((event, index): ReplayAction[] => (event.type === "action" ? [{ event, index, turnStart: null }] : []));
    const stops = spy?.stops ?? [];
    const partStarts = [0, ...(record.header.parts ?? []).map((part) => part.events)];
    const marks: ReplayMark[] = [];
    let best = 0;
    let started = 0;
    let ended = 0;
    let nextStop = 0;
    let nextPart = 0;
    const feed = (below: number) => {
      for (; started < actions.length && actions[started].event.frame <= this.frame && actions[started].index < below; started++) {
        const { event, index } = actions[started];
        if (partStarts[nextPart] <= index) best = this.progress();
        while (partStarts[nextPart] <= index) nextPart++;
        actions[started].turnStart = this.turnStartOf(event.action, game.waitingFor().kind);
      }
      for (; ended < started && actions[ended].event.frame + actions[ended].event.result.frames <= this.frame; ended++) {
        const { event, index, turnStart } = actions[ended];
        const decisionPoint = this.battleActionEnded(event.result.status, turnStart, "text" in event.result ? event.result.text : []);
        this.actionEnded(event);
        const now = this.progress();
        marks.push({ kind: "action", index, progressed: now > best, decisionPoint });
        best = Math.max(best, now);
      }
    };
    const settle = () => {
      for (; stops[nextStop]?.frame === this.frame; nextStop++) {
        const stop = stops[nextStop];
        feed(stop.events);
        spy?.onStop(stop, this.replayedState(record.events.slice(0, stop.events), marks, partStarts));
      }
      feed(Number.POSITIVE_INFINITY);
    };
    while (!player.ended) {
      settle();
      this.advance(player.next());
    }
    settle();
    // The maps, the battles and the Milestones tell that it is the same game. The state events come from the replay: a better read of the game can change them (run 68: a party read that skipped frames lost 7 heals).
    if (!Bun.deepEquals(withoutFormat(this.#events), withoutFormat(record.events.filter(isGameEvent)))) throw new Error("the Run record does not replay the same game: its maps, battles or Milestones are different");
    this.#events.splice(0, this.#events.length, ...withStateEvents(record.events.filter((event) => !isStateEvent(event)), this.#events));
    this.#playStart = this.startOfPlay(record);
  }

  private replayedState(before: readonly RunEvent[], actionMarks: readonly ReplayMark[], partStarts: readonly number[]): ReplayedState {
    const events = withStateEvents(before.filter((event) => !isStateEvent(event)), this.#events);
    const places = new Map(events.map((event, place) => [event, place]));
    const placeOf = (index: number) => {
      for (let i = index; i < before.length; i++) {
        const place = places.get(before[i]);
        if (place !== undefined) return place;
      }
      return events.length;
    };
    const endOf = (place: number) => {
      let end = place + 1;
      while (end < events.length && isGameEvent(events[end])) end++;
      return end;
    };
    // At the same index, the start of a part comes before an action.
    const marks: ReplayMark[] = [...partStarts.map((index): ReplayMark => ({ kind: "partStart", index })), ...actionMarks].toSorted((a, b) => a.index - b.index || Number(a.kind === "action") - Number(b.kind === "action"));
    let noProgress: NoProgress = { stuck: 0, since: 0 };
    for (const mark of marks.filter((m) => m.index < before.length)) noProgress = mark.kind === "partStart" ? { stuck: 0, since: placeOf(mark.index) } : afterAction(noProgress, mark.progressed, mark.decisionPoint, endOf(placeOf(mark.index)));
    return { observation: this.observe(), events, noProgress, names: events.some((event) => event.type === "action") ? this.trainerNames() : null, frame: this.frame, whiteouts: runWhiteouts(events, 0) };
  }

  private progress(): number {
    return this.#watch.gameProgress + this.#atlas.heard + this.#atlas.exits + this.#atlas.darkCells;
  }

  private flyUse(map: string): FlyUse {
    const game = this.#run.game;
    const destinations = isSafariZone(map) ? [] : game.flyDestinations().flatMap(({ name, area, map: to, x, y }) => (to === map ? [] : [{ name, area, map: to, x, y }]));
    return { usable: game.flyUser() !== null, destinations };
  }

  private flyDestinations(): FlyDestination[] {
    const game = this.#run.game;
    return game.flyUser() === null ? [] : game.flyDestinations();
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
    const { kind, player, enemy, double, ghost, safari } = battle;
    const game = this.#run.game;
    const view = (foe: Battle["enemy"]) => enemyView(foe, this.#battles.movesSeen(foe.partyIndex).map((move) => game.moveName(move)), this.#knowledge === "full");
    const facts = (foe: Battle["enemy"]) => fightFacts({ ...battle, enemy: foe }, game.typeChart(), game.milestones(), this.#battles.battleTexts());
    return {
      ...(kind === "wild" ? { kind, inPc: game.pcCount(enemy.species) } : { kind }),
      player,
      enemy: view(enemy),
      ...(ghost ? { fights: player.moves.map(() => null), ghost } : { fights: facts(enemy) }),
      ...(safari ? { safari } : {}),
      ...(double ? { double: { ally: double.ally, otherFoe: double.otherFoe && { enemy: view(double.otherFoe), fights: facts(double.otherFoe) }, reach: double.reach } } : {}),
      lastTurn: this.#battles.lastTurn(),
      // The text of a double battle does not tell the foe of a move.
      foeTurns: double ? [] : this.#battles.turnsAgainst(enemy.partyIndex),
    };
  }

  private overworld(): { player: PlayerPosition; grid: MapGrid; actors: MapActors } {
    const game = this.#run.game;
    const player = game.player();
    const grid = game.grid();
    const actors = grid && game.actors(grid);
    if (!player || !grid || !actors) throw new Error("the player is not on the overworld");
    const { kinds, closed } = this.fieldMovesOn(grid, actors);
    return { player, grid: { ...game.withObstacles({ ...grid, kinds }, closed), signs: grid.signs.filter((s) => s.kind === "sign") }, actors };
  }

  // A script runs during a whole text, choice or Raw input, so only a battle stops them.
  private advance(keys: number): boolean {
    if (this.#phase.kind === "playing") this.#phase.limits.beforeFrame(this.frame);
    this.#run.runFrame(keys);
    this.#buttons.push(keys);
    const events = this.#watch.onFrame(this.frame);
    this.#events.push(...events);
    if (this.#phase.kind === "playing") this.#phase.limits.afterFrame(events);
    this.#atlas.onFrame();
    const started = events.some((e) => e.type === "battle" && e.state === "start");
    this.#battles.onFrame(started, this.#run.game.enemyMovesPrinted());
    this.#onFrame?.(this);
    return started;
  }

  private obstacleRemedyNow(move: FieldMove): string {
    return moveRemedy(move, this.#run.game.missingBadge(move));
  }

  private fieldMoveUse(move: FieldMove): FieldMoveUse {
    return { usable: this.#run.game.usableFieldMoves().has(move), missingBadge: this.#run.game.missingBadge(move) };
  }

  /** The maps of a route: another map has the cells of the last step of the player on it. */
  private routeMaps(): MapSource {
    return this.mapsWith((name) => this.#atlas.lastStepCells(name));
  }

  /** The maps of a route, with the cells of the ROM for each map other than the map of the player. */
  private romMaps(): MapSource {
    return this.mapsWith(() => null);
  }

  private mapsWith(lastStepCells: (name: string) => MapScriptCells | null): MapSource {
    const maps = new Map<string, RouteMap | null>();
    const destinations = this.flyDestinations();
    return (name) => {
      if (!maps.has(name)) {
        const view = this.#run.game.mapView(name, lastStepCells(name));
        if (!view) {
          maps.set(name, null);
          return null;
        }
        const { kinds, usable, closed } = this.fieldMovesOn(view.grid, view.actors);
        const flyDestinations = view.grid.outside && !isSafariZone(name) ? destinations : [];
        const map = { ...view.grid, kinds, people: view.actors.people, obstacles: closed, removable: usable, flyDestinations, stepFrames: this.#walk.stepFramesOn(view.grid) };
        const sight = this.#atlas.darkSight(view.grid);
        maps.set(name, sight ? onlySeen(map, sight) : map);
      }
      return maps.get(name)!;
    };
  }

  private facesFieldMoveTarget(): boolean {
    const game = this.#run.game;
    if (game.waitingFor().kind !== "walk") return false;
    const player = game.player();
    const map = this.routeMaps()(game.map().name);
    if (!player || !map) return false;
    const [dx, dy] = DIRECTION_STEP[player.facing];
    const front = { x: player.x + dx, y: player.y + dy };
    return startsSurf(map, player, front) || map.removable.some((o) => o.x === front.x && o.y === front.y);
  }

  private fieldMovesOn(grid: MapGrid, { obstacles }: Pick<MapActors, "obstacles">): { kinds: string; usable: Obstacle[]; closed: Obstacle[] } {
    const moves = this.#run.game.usableFieldMoves();
    return { kinds: withSurf(grid.kinds, moves.has("SURF")), usable: obstacles.filter((o) => walkRemoves(o, moves)), closed: obstacles.filter((o) => !walkRemoves(o, moves)) };
  }

  private strengthUse(grid: MapGrid, { obstacles }: Pick<MapActors, "obstacles">): StrengthUse {
    const first = new Map(this.#run.game.obstaclesOf(grid).map((o) => [o.localId, o]));
    const moved = obstacles.some((o) => {
      const start = first.get(o.localId);
      return o.move === "STRENGTH" && start !== undefined && (start.x !== o.x || start.y !== o.y);
    });
    return { ...this.fieldMoveUse("STRENGTH"), moved };
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
}

