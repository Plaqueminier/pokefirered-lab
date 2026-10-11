// Frames run only inside a Macro-action or a Raw input: the game is frozen at each Decision point (docs/adr/0002).
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
  type Milestone,
  type PlayerPosition,
  type WaitingFor,
} from "../game";
import type { PartyMon } from "../party";
import type { Messages } from "../prompts";
import { Keys } from "../protocol";
import { Run, START_SAVE } from "../run";
import { findRoute, type Leg, MAX_ROUTE_MAPS, type MapSource, type Place, type RouteMap } from "./path";
import { ButtonTrack, GameWatch, type RunEvent, type RunHeader, type RunRecord } from "./record";

const STEP_FRAME_LIMIT = 60;
const SETTLE_FRAME_LIMIT = 600;
const DECISION_FRAME_LIMIT = 3600;
const MAX_TEXT_PRESSES = 256;
const BLOCKED_TRIES = 3;
const BLOCKED_WAIT_FRAMES = 30;
const MAX_LEGS = 64;
const FRAME_BUDGET = 30_000;
const NO_PROGRESS_LIMIT = 200;
const DIRECTION_KEYS: Record<Direction, number> = { south: Keys.Down, north: Keys.Up, west: Keys.Left, east: Keys.Right };
// readText also runs a busy game to its next text.
const ACCEPTS: Record<WaitingFor["kind"], AvailableAction["name"][]> = {
  walk: ["goTo", "interact"],
  choice: ["choose"],
  text: ["readText"],
  battleAction: ["fight", "run"],
  battleMove: ["fight"],
  partyPick: [],
  busy: ["readText"],
};
const FIGHT_CURSOR = 0;
const RUN_CURSOR = 3;
const CURSOR_COLUMN = 1;
const CURSOR_ROW = 2;
export const KNOWLEDGE_LEVELS = ["player", "full"] as const;

export type KnowledgeLevel = (typeof KNOWLEDGE_LEVELS)[number];

export type BattleState = { kind: Battle["kind"]; player: BattleMon; enemy: EnemyMon };

type ObservationBase = { waitingFor: WaitingFor; party: PartyMon[]; milestones: Milestone[] };

export type Observation = ObservationBase & ({ mode: "overworld"; map: GameState["map"]; player: PlayerPosition; grid: MapGrid } | { mode: "battle"; battle: BattleState });

export type EndReason = "goal" | "bot stopped" | "frame budget" | "no progress";

export type RunResult = { endReason: EndReason; frames: number; milestones: Milestone[]; rawInputs: number };

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
  | { name: "run" };

export type AvailableAction = { name: "goTo" } | Exclude<MacroAction, { name: "goTo" }>;

export type Button = keyof typeof Keys;

export type RawInput = { name: "press"; button: Button };

export type ActionEntry = { action: MacroAction | RawInput; result: ActionResult | TextResult };

export function must(result: ActionResult): void {
  if (result.status !== "done") throw new Error(`${result.status}${"reason" in result ? `: ${result.reason}` : ""}`);
}

type ActionListener = (entry: ActionEntry, harness: Harness) => void;

export type HarnessOptions = { knowledge?: KnowledgeLevel; onAction?: ActionListener; frameBudget?: number; noProgressLimit?: number };

/** The Harness ends a Run with an error that a Macro-action or a Raw input throws: `play` must not catch it. */
export type Bot = {
  name: string;
  version: string;
  goal?: Milestone;
  play(harness: Harness): Promise<void>;
};

class RunEnd extends Error {
  constructor(readonly reason: EndReason) {
    super(`the Run ends: ${reason}`);
  }
}

class RunLimits {
  #decisionsWithNoProgress = 0;

  constructor(
    private readonly goal: Milestone | null,
    private readonly lastFrame: number,
    private readonly noProgressLimit: number,
    private progress: number,
  ) {}

  beforeFrame(frame: number): void {
    if (frame >= this.lastFrame) throw new RunEnd("frame budget");
  }

  atDecision(milestones: Milestone[], progress: number): void {
    if (this.goal && milestones.includes(this.goal)) throw new RunEnd("goal");
    this.#decisionsWithNoProgress = progress > this.progress ? 0 : this.#decisionsWithNoProgress + 1;
    this.progress = progress;
    if (this.#decisionsWithNoProgress >= this.noProgressLimit) throw new RunEnd("no progress");
  }
}

type Phase = { kind: "ready" } | { kind: "playing"; limits: RunLimits } | { kind: "ended"; bot: RunHeader["bot"]; result: RunResult };

export class Harness {
  readonly #run: Run;
  readonly #knowledge: KnowledgeLevel;
  readonly #onAction?: ActionListener;
  readonly #frameBudget: number;
  readonly #noProgressLimit: number;
  readonly #battles = new BattleWatch();
  readonly #buttons = new ButtonTrack();
  readonly #watch: GameWatch;
  readonly #events: RunEvent[] = [];
  #phase: Phase = { kind: "ready" };

  private constructor(run: Run, options: HarnessOptions) {
    this.#run = run;
    this.#knowledge = options.knowledge ?? "player";
    this.#onAction = options.onAction;
    this.#frameBudget = options.frameBudget ?? FRAME_BUDGET;
    this.#noProgressLimit = options.noProgressLimit ?? NO_PROGRESS_LIMIT;
    this.#watch = new GameWatch(run.game);
  }

  static async open(options: HarnessOptions = {}): Promise<Harness> {
    if (!(await Bun.file(START_SAVE).exists())) throw new Error(`${START_SAVE} not found: make the Starting save first (lab/README.md)`);
    const harness = new Harness(await Run.open(), options);
    const interruption = harness.settle();
    if (interruption) throw new Error(`the game interrupts the start of the Run: ${interruption}`);
    return harness;
  }

  get actions(): ActionEntry[] {
    return this.#events.flatMap((e) => (e.type === "action" ? [{ action: e.action, result: e.result }] : []));
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

  async play(bot: Bot): Promise<RunResult> {
    if (this.#phase.kind !== "ready") throw new Error("a Harness plays one Run");
    const start = this.frame;
    const rawInputs = this.rawInputs;
    this.#phase = { kind: "playing", limits: new RunLimits(bot.goal ?? null, start + this.#frameBudget, this.#noProgressLimit, this.#watch.progress) };
    let endReason: EndReason = "bot stopped";
    let result: RunResult | null = null;
    try {
      await bot.play(this);
    } catch (error) {
      if (!(error instanceof RunEnd)) throw error;
      endReason = error.reason;
    } finally {
      result = { endReason, frames: this.frame - start, milestones: this.#run.game.milestones(), rawInputs: this.rawInputs - rawInputs };
      this.#phase = { kind: "ended", bot: { name: bot.name, version: bot.version }, result };
    }
    return result;
  }

  modelText(text: string): void {
    this.#events.push({ type: "model", frame: this.frame, text });
  }

  record(): RunRecord {
    if (this.#phase.kind !== "ended") throw new Error("no Run record: play a Bot first");
    const { bot, result } = this.#phase;
    const header = { ...this.#run.origin, knowledge: this.#knowledge, bot };
    return { header, buttons: this.#buttons.holds.map(([keys, frames]) => [keys, frames]), events: [...this.#events], result };
  }

  observe(): Observation {
    const game = this.#run.game;
    const base = { waitingFor: game.waitingFor(), party: game.party(), milestones: game.milestones() };
    const battle = game.battle();
    if (battle) return { ...base, mode: "battle", battle: this.battleState(battle) };
    const { player, grid } = this.overworld();
    return { ...base, mode: "overworld", map: game.map(), player, grid };
  }

  availableActions(): AvailableAction[] {
    const waiting = this.#run.game.waitingFor();
    return ACCEPTS[waiting.kind].flatMap((name): AvailableAction[] => {
      switch (name) {
        case "goTo":
        case "readText":
          return [{ name }];
        case "interact":
          return this.interactions();
        case "choose":
          return waiting.kind === "choice" ? waiting.options.map((option) => ({ name, option })) : [];
        case "fight":
          return this.battle().player.moves.flatMap((m, move) => (m.pp > 0 ? [{ name, move }] : []));
        case "run":
          return this.battle().kind === "wild" ? [{ name }] : [];
      }
    });
  }

  async goTo(x: number, y: number, map?: string): Promise<ActionResult> {
    return this.act({ name: "goTo", x, y, ...(map ? { map } : {}) }, () => {
      const target = { map: map ?? this.place().map, x, y };
      let tries = 0;
      let stuckAt: Place | null = null;
      for (let legs = 0; legs < MAX_LEGS; legs++) {
        const here = this.place();
        if (here.map === target.map && here.x === x && here.y === y) return { status: "done" };
        const maps = this.routeMaps();
        const route = findRoute(here, target, maps);
        if (!route && !findRoute(here, target, (name) => withoutPeople(maps(name)))) {
          return { status: "impossible", reason: `no route from ${at(here)} to ${at(target)} in ${MAX_ROUTE_MAPS} maps` };
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
    this.#onAction?.(entry, this);
    if (this.#phase.kind === "playing") this.#phase.limits.atDecision(this.#run.game.milestones(), this.#watch.progress);
    return result;
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

  private moveCursor(target: number, read: () => number | null, key: (cursor: number) => number): Outcome {
    for (let cursor = read(); cursor !== target; ) {
      if (cursor === null) return { status: "impossible", reason: "the menu closed when the cursor moved" };
      const moved = this.input(key(cursor));
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

  private input(keys: number): Outcome {
    const battle = this.tap(keys);
    return battle ? { status: "interrupted", reason: battle } : this.untilDecision();
  }

  private untilDecision(watch: () => void = () => {}): Outcome {
    for (let frames = 0; ; frames++) {
      watch();
      if (this.#run.game.waitingFor().kind !== "busy") return { status: "done" };
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
    const started = events.some((e) => e.type === "battle" && e.state === "start");
    this.#battles.onFrame(started, this.#run.game.enemyMovePrinted());
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

// The battle menus are 2x2 grids. The game does not move the cursor to an empty move slot, and the moves fill
// the slots in order: so the cursor goes left and up first, and passes only on cells before the target.
function gridKey(cursor: number, target: number): number {
  if (cursor & CURSOR_COLUMN & ~target) return Keys.Left;
  if (cursor & CURSOR_ROW & ~target) return Keys.Up;
  return target & CURSOR_COLUMN & ~cursor ? Keys.Right : Keys.Down;
}
