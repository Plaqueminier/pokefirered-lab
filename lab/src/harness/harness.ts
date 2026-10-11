// Frames run only inside a Macro-action or a Raw input: the game is frozen at each Decision point (docs/adr/0002).
import {
  DIRECTION_STEP,
  DIRECTION_STEPS,
  type Direction,
  type FieldMessage,
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
import { Keys } from "../protocol";
import { Run, START_SAVE } from "../run";
import { findRoute, type Leg, MAX_ROUTE_MAPS, type MapSource, type Place, type RouteMap } from "./path";

const STEP_FRAME_LIMIT = 60;
const SETTLE_FRAME_LIMIT = 600;
const DECISION_FRAME_LIMIT = 3600;
const MAX_TEXT_PRESSES = 256;
const BLOCKED_TRIES = 3;
const BLOCKED_WAIT_FRAMES = 30;
const MAX_LEGS = 64;
const DIRECTION_KEYS: Record<Direction, number> = { south: Keys.Down, north: Keys.Up, west: Keys.Left, east: Keys.Right };
// readText also runs a busy game to its next text.
const ACCEPTS: Record<WaitingFor["kind"], AvailableAction["name"][]> = { walk: ["goTo", "interact"], choice: ["choose"], text: ["readText"], busy: ["readText"] };

export type Observation = {
  waitingFor: WaitingFor;
  map: GameState["map"];
  player: PlayerPosition;
  grid: MapGrid;
  party: PartyMon[];
  milestones: Milestone[];
};

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

export type TextResult = ActionResult & { text: string[] };

export type MacroAction =
  | { name: "goTo"; x: number; y: number; map?: string }
  | { name: "interact"; x: number; y: number }
  | { name: "readText" }
  | { name: "choose"; option: string };

export type AvailableAction = { name: "goTo" } | Exclude<MacroAction, { name: "goTo" }>;

export type Button = keyof typeof Keys;

export type RawInput = { name: "press"; button: Button };

export type ActionEntry = { action: MacroAction | RawInput; result: ActionResult | TextResult };

export function must(result: ActionResult): void {
  if (result.status !== "done") throw new Error(`${result.status}${"reason" in result ? `: ${result.reason}` : ""}`);
}

type ActionListener = (entry: ActionEntry, harness: Harness) => void;

export type Bot = {
  name: string;
  version: string;
  play(harness: Harness): Promise<void>;
};

export class Harness {
  readonly actions: ActionEntry[] = [];

  private constructor(
    private readonly run: Run,
    private readonly onAction?: ActionListener,
  ) {}

  static async open(options: { onAction?: ActionListener } = {}): Promise<Harness> {
    if (!(await Bun.file(START_SAVE).exists())) throw new Error(`${START_SAVE} not found: make the Starting save first (lab/README.md)`);
    const harness = new Harness(await Run.open(), options.onAction);
    const interruption = harness.settle();
    if (interruption) throw new Error(`the game interrupts the start of the Run: ${interruption}`);
    return harness;
  }

  get rawInputs(): number {
    return this.actions.filter((e) => e.action.name === "press").length;
  }

  get frame(): number {
    return this.run.frame;
  }

  screenHash(): string {
    return this.run.screenHash();
  }

  observe(): Observation {
    const game = this.run.game;
    const { player, grid } = this.overworld();
    return {
      waitingFor: game.waitingFor(),
      map: game.map(),
      player,
      grid,
      party: game.party(),
      milestones: game.milestones(),
    };
  }

  availableActions(): AvailableAction[] {
    const waiting = this.run.game.waitingFor();
    return ACCEPTS[waiting.kind].flatMap((name): AvailableAction[] => {
      switch (name) {
        case "goTo":
        case "readText":
          return [{ name }];
        case "interact":
          return this.interactions();
        case "choose":
          return waiting.kind === "choice" ? waiting.options.map((option) => ({ name, option })) : [];
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
      const game = this.run.game;
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
    return this.act<{ text: string[] }>({ name: "readText" }, () => {
      const game = this.run.game;
      const reader = new MessageReader(game);
      for (let presses = 0; presses < MAX_TEXT_PRESSES; presses++) {
        const outcome = this.untilDecision(() => reader.update());
        if (outcome.status !== "done" || game.waitingFor().kind !== "text") return { ...outcome, text: reader.text };
        if (reader.closedAfterPress) return { status: "done", text: reader.textBeforeNextText() };
        const battle = this.tap(Keys.A);
        if (battle) return { status: "interrupted", reason: battle, text: reader.text };
        reader.pressed();
      }
      return { status: "impossible", reason: `the text still waits for A after ${MAX_TEXT_PRESSES} presses`, text: reader.text };
    }, { text: [] });
  }

  async choose(option: string): Promise<ActionResult> {
    return this.act({ name: "choose", option }, () => {
      const choice = this.run.game.waitingFor();
      if (choice.kind !== "choice") throw new Error("choose is available only at a choice");
      const target = choice.options.indexOf(option);
      if (target < 0) return { status: "impossible", reason: `no option "${option}" in ${choice.options.join(", ")}` };
      for (let cursor = choice.cursor; cursor !== target; ) {
        const moved = this.input(target > cursor ? Keys.Down : Keys.Up);
        if (moved.status !== "done") return moved;
        const now = this.run.game.waitingFor();
        if (now.kind !== "choice") return { status: "impossible", reason: "the choice closed when the cursor moved" };
        if (now.cursor === cursor) return { status: "impossible", reason: `the cursor does not move from ${cursor}` };
        cursor = now.cursor;
      }
      return this.input(Keys.A);
    });
  }

  async press(button: Button): Promise<ActionResult> {
    return this.act({ name: "press", button }, () => this.input(Keys[button]));
  }

  private act<T extends object = object>(action: MacroAction | RawInput, body: () => Outcome & T, onRefusal = {} as T): ActionResult & T {
    const start = this.frame;
    const kind = this.run.game.waitingFor().kind;
    const refused = action.name !== "press" && !ACCEPTS[kind].includes(action.name);
    const outcome = refused ? { status: "impossible" as const, reason: `${action.name} is not available: the game waits for a ${kind}`, ...onRefusal } : body();
    const result: ActionResult & T = { ...outcome, frames: this.frame - start };
    const entry = { action, result };
    this.actions.push(entry);
    this.onAction?.(entry, this);
    return result;
  }

  private overworld(): { player: PlayerPosition; grid: MapGrid; actors: MapActors } {
    const game = this.run.game;
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
      if (this.run.game.waitingFor().kind !== "busy") return { status: "done" };
      if (frames === DECISION_FRAME_LIMIT) return { status: "impossible", reason: `the game waits for no known input for ${DECISION_FRAME_LIMIT} frames` };
      const battle = this.battleFrame(0);
      if (battle) return { status: "interrupted", reason: battle };
    }
  }

  // JOY_NEW sees a press only after a frame with the button up.
  private tap(keys: number): "battle" | null {
    return this.battleFrame(keys) ?? this.battleFrame(0);
  }

  // A script runs during a whole text, choice or Raw input, so only a battle stops them.
  private battleFrame(keys: number): "battle" | null {
    this.run.runFrame(keys);
    return this.run.game.battleStarting() ? "battle" : null;
  }

  private place(): Place {
    const player = this.run.game.player();
    if (!player) throw new Error("the player is not on the overworld");
    return { map: this.run.game.map().name, x: player.x, y: player.y };
  }

  private routeMaps(): MapSource {
    const maps = new Map<string, RouteMap | null>();
    return (name) => {
      if (!maps.has(name)) {
        const view = this.run.game.mapView(name);
        maps.set(name, view && { ...view.grid, people: view.actors.people });
      }
      return maps.get(name)!;
    };
  }

  private walkLeg(leg: Leg, next: string): LegResult {
    for (const move of leg.moves) {
      const result = move.kind === "push" ? this.push(move.direction) : this.step(move.direction, move.kind === "jump" ? 2 : 1);
      if (result !== "done") return result;
      if (this.run.game.map().name !== leg.map) break;
    }
    const interruption = this.settle();
    if (interruption) return interruption;
    return this.run.game.map().name === next ? "done" : "map";
  }

  // Hold the direction: a short press only turns a player who faces another way. A jump moves the
  // player two times (InitJump, then the jump halfway), so a step ends on its arrival cell.
  private step(direction: Direction, cells: number): LegResult {
    const game = this.run.game;
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
    const game = this.run.game;
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
    const result = this.hold(DIRECTION_KEYS[direction], STEP_FRAME_LIMIT, () => this.run.game.fieldLocked());
    return result === "limit" ? "no warp" : result;
  }

  private settle(): Interruption | null {
    const result = this.hold(0, SETTLE_FRAME_LIMIT, () => this.run.game.waitingFor().kind === "walk");
    if (result === "limit") throw new Error(`the game waits for no input for more than ${SETTLE_FRAME_LIMIT} frames`);
    return result === "done" ? null : result;
  }

  private hold(keys: number, limit: number, done: () => boolean): "done" | "limit" | Interruption {
    for (let frames = 0; ; frames++) {
      if (done()) return "done";
      if (frames === limit) return "limit";
      const interruption = this.runFrame(keys);
      if (interruption) return interruption;
    }
  }

  private wait(frames: number): Interruption | null {
    for (let i = 0; i < frames; i++) {
      const interruption = this.runFrame(0);
      if (interruption) return interruption;
    }
    return null;
  }

  private runFrame(keys: number): Interruption | null {
    this.run.runFrame(keys);
    return this.run.game.interruption();
  }
}

class MessageReader {
  readonly text: string[] = [];
  private message: FieldMessage;
  private pressedOnce = false;
  private readBeforeClose: number | null = null;

  constructor(private readonly game: Game) {
    this.message = game.fieldMessage();
    if (this.message.shown) this.text.push(plain(game.fieldMessageText()));
  }

  get closedAfterPress(): boolean {
    return this.readBeforeClose !== null;
  }

  pressed(): void {
    this.pressedOnce = true;
  }

  update(): void {
    const wasActive = this.message.printerActive;
    this.message = this.game.fieldMessage();
    if (this.message.printerActive && !wasActive) this.text.push(plain(this.game.fieldMessageText()));
    if (this.pressedOnce && !this.message.shown && this.readBeforeClose === null) this.readBeforeClose = this.text.length;
  }

  // A text that waits for A after the box closed belongs to the next readText.
  textBeforeNextText(): string[] {
    return this.text.length > (this.readBeforeClose ?? this.text.length) ? this.text.slice(0, -1) : this.text;
  }
}

function withoutPeople(map: RouteMap | null): RouteMap | null {
  return map && { ...map, people: [] };
}

function plain(text: string): string {
  return text.split("\n").join(" ");
}

function neighbours(cell: { x: number; y: number }): { direction: Direction; x: number; y: number }[] {
  return DIRECTION_STEPS.map(([direction, [dx, dy]]) => ({ direction, x: cell.x + dx, y: cell.y + dy }));
}

function at(place: Place): string {
  return `${place.map} (${place.x}, ${place.y})`;
}
