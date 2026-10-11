// Frames run only inside a Macro-action: the game is frozen at each Decision point (docs/adr/0002).
import type { Direction, GameState, MapGrid, PlayerPosition, WaitingFor } from "../game";
import { Keys } from "../protocol";
import { Run, START_SAVE } from "../run";
import { findPath } from "./path";

const STEP_FRAME_LIMIT = 60;
const SETTLE_FRAME_LIMIT = 600;
const DIRECTION_KEYS: Record<Direction, number> = { south: Keys.Down, north: Keys.Up, west: Keys.Left, east: Keys.Right };

export type Observation = {
  waitingFor: WaitingFor;
  map: GameState["map"];
  player: PlayerPosition;
  grid: MapGrid;
};

type Outcome = { status: "done" } | { status: "impossible"; reason: string };

export type ActionResult = Outcome & {
  frames: number;
};

export type MacroAction = { name: "goTo"; x: number; y: number };

export type ActionEntry = { action: MacroAction; result: ActionResult };

export type Bot = {
  name: string;
  version: string;
  play(harness: Harness): Promise<void>;
};

export class Harness {
  readonly actions: ActionEntry[] = [];

  private constructor(
    private readonly run: Run,
    private readonly onAction?: (entry: ActionEntry) => void,
  ) {}

  static async open(options: { onAction?: (entry: ActionEntry) => void } = {}): Promise<Harness> {
    if (!(await Bun.file(START_SAVE).exists())) throw new Error(`${START_SAVE} not found: make the Starting save first (lab/README.md)`);
    const harness = new Harness(await Run.open(), options.onAction);
    harness.settle();
    return harness;
  }

  get frame(): number {
    return this.run.frame;
  }

  screenHash(): string {
    return this.run.screenHash();
  }

  observe(): Observation {
    const game = this.run.game;
    const player = game.player();
    const grid = game.grid();
    if (!player || !grid) throw new Error("observe: the player is not on the overworld");
    return {
      waitingFor: game.waitingFor(),
      map: game.map(),
      player,
      grid: { ...grid, signs: grid.signs.filter((s) => s.kind === "sign") },
    };
  }

  async goTo(x: number, y: number): Promise<ActionResult> {
    return this.act({ name: "goTo", x, y }, () => {
      const { player, grid } = this.observe();
      const path = findPath(grid, player, { x, y });
      if (!path) return { status: "impossible", reason: `no path from (${player.x}, ${player.y}) to (${x}, ${y})` };
      for (const direction of path) this.step(direction);
      this.settle();
      return { status: "done" };
    });
  }

  private act(action: MacroAction, body: () => Outcome): ActionResult {
    const start = this.frame;
    const outcome = body();
    const entry = { action, result: { ...outcome, frames: this.frame - start } };
    this.actions.push(entry);
    this.onAction?.(entry);
    return entry.result;
  }

  // Hold until the cell changes: a short press only turns a player who faces another way.
  private step(direction: Direction): void {
    const before = this.run.game.player()!;
    for (let i = 0; i < STEP_FRAME_LIMIT; i++) {
      this.run.runFrame(DIRECTION_KEYS[direction]);
      const now = this.run.game.player();
      if (now && (now.x !== before.x || now.y !== before.y)) return;
    }
    throw new Error(`step ${direction} from (${before.x}, ${before.y}): the player did not move in ${STEP_FRAME_LIMIT} frames`);
  }

  private settle(): void {
    for (let i = 0; i < SETTLE_FRAME_LIMIT; i++) {
      if (this.run.game.waitingFor() !== "busy") return;
      this.run.runFrame(0);
    }
    throw new Error(`the game waits for no input for more than ${SETTLE_FRAME_LIMIT} frames`);
  }
}
