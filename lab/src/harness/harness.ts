// Frames run only inside a Macro-action: the game is frozen at each Decision point (docs/adr/0002).
import { DIRECTION_STEP, type Direction, type GameInterruption, type GameState, type MapGrid, type PlayerPosition, type WaitingFor } from "../game";
import { Keys } from "../protocol";
import { Run, START_SAVE } from "../run";
import { findRoute, type Leg, MAX_ROUTE_MAPS, type MapSource, type Place, type RouteMap } from "./path";

const STEP_FRAME_LIMIT = 60;
const SETTLE_FRAME_LIMIT = 600;
const BLOCKED_TRIES = 3;
const BLOCKED_WAIT_FRAMES = 30;
const MAX_LEGS = 64;
const DIRECTION_KEYS: Record<Direction, number> = { south: Keys.Down, north: Keys.Up, west: Keys.Left, east: Keys.Right };

export type Observation = {
  waitingFor: WaitingFor;
  map: GameState["map"];
  player: PlayerPosition;
  grid: MapGrid;
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

export type MacroAction = { name: "goTo"; x: number; y: number; map?: string };

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
    const interruption = harness.settle();
    if (interruption) throw new Error(`the game interrupts the start of the Run: ${interruption}`);
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

  async goTo(x: number, y: number, map?: string): Promise<ActionResult> {
    return this.act({ name: "goTo", x, y, ...(map ? { map } : {}) }, () => {
      if (this.run.game.waitingFor() !== "walk") return { status: "impossible", reason: "the game does not wait for the player to walk" };
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

  private act(action: MacroAction, body: () => Outcome): ActionResult {
    const start = this.frame;
    const outcome = body();
    const entry = { action, result: { ...outcome, frames: this.frame - start } };
    this.actions.push(entry);
    this.onAction?.(entry);
    return entry.result;
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

  private push(direction: Direction): LegResult {
    const result = this.hold(DIRECTION_KEYS[direction], STEP_FRAME_LIMIT, () => this.run.game.fieldLocked());
    return result === "limit" ? "no warp" : result;
  }

  private settle(): Interruption | null {
    const result = this.hold(0, SETTLE_FRAME_LIMIT, () => this.run.game.waitingFor() === "walk");
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

function withoutPeople(map: RouteMap | null): RouteMap | null {
  return map && { ...map, people: [] };
}

function at(place: Place): string {
  return `${place.map} (${place.x}, ${place.y})`;
}
