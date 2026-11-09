import { BICYCLE } from "../bag";
import { DIRECTION_STEP, type Direction } from "../cells";
import type { Game } from "../game";
import { Keys } from "../protocol";
import type { ActionEntry, Interruption } from "./harness";
import type { ItemDriver } from "./item-driver";
import { type Input, type MenuDriver, type Outcome, tap } from "./menu-driver";
import type { Cell, Leg } from "./path";
import { at } from "./route-reasons";

const STEP_FRAME_LIMIT = 60;
const SETTLE_FRAME_LIMIT = 600;
const SLIDE_START_FRAMES = 4;
const DIRECTION_KEYS: Record<Direction, number> = { south: Keys.Down, north: Keys.Up, west: Keys.Left, east: Keys.Right };

export type LegResult = "done" | "stuck" | "no move" | "no warp" | Interruption;
export type Slid = { slidTo?: Cell };

/** The frames of a walk on the field: its steps, its speed and the Ride choice of the Bot. */
export class WalkDriver {
  private chosen = false;
  private readonly frames: Input;

  constructor(
    private readonly game: Game,
    frames: Input,
    private readonly menus: MenuDriver,
    private readonly items: ItemDriver,
  ) {
    // A slope pulls a rider to the south unless the rider holds B, and B slows each way on a slope to 16 frames, so a way south holds no B.
    // B has no other effect on a rider, and the game reads the slope cell in the same frame as the keys: a read before that frame is stale.
    this.frames = { advance: (keys) => frames.advance(game.riding() && (keys & Keys.Down) === 0 ? keys | Keys.B : keys) };
  }

  get rideChosen(): boolean {
    return this.chosen;
  }

  chooseRide(on?: number): Outcome {
    const place = this.items.usablePlace(BICYCLE, on, true);
    return "status" in place ? place : this.matchRide(!this.chosen);
  }

  /** For a live action and for an action of a parent Run, so a Continued Run keeps the choice. */
  onAction({ action, result }: ActionEntry): void {
    if (action.name === "use" && action.item === BICYCLE && result.status !== "impossible") this.chosen = !this.chosen;
  }

  matchRide(wanted = this.chosen): Outcome {
    const { game } = this;
    if (wanted === game.riding() || !game.canChangeBicycle() || game.waitingFor().kind !== "walk") return { status: "done" };
    const bicycle = game.findInBag(BICYCLE);
    if (!bicycle) return { status: "done" };
    if (game.registeredItem() !== bicycle.item) {
      const registered = this.items.register(BICYCLE);
      if (registered.status !== "done") return registered;
    }
    const battle = this.tap(Keys.Select);
    if (battle) return { status: "interrupted", reason: battle };
    const interruption = this.settle();
    return interruption ? { status: "interrupted", reason: interruption } : { status: "done" };
  }

  tap(keys: number): "battle" | null {
    return tap(this.frames, keys);
  }

  walkLeg(leg: Leg, next: string): LegResult {
    for (const move of leg.moves) {
      const result = this.playMove(move);
      if (result !== "done") return result;
      if (this.game.map().name !== leg.map) break;
    }
    const interruption = this.stopWalking();
    if (interruption) return interruption;
    return this.game.map().name === next ? "done" : "map";
  }

  private stopWalking(): Interruption | null {
    return (this.game.stepStarts() ? this.wait(1) : null) ?? this.settle();
  }

  slide(direction: Direction): Outcome & Slid {
    const before = this.game.playerPlace();
    const stepped = this.hold(this.stepKeys(direction), STEP_FRAME_LIMIT, () => at(this.game.playerPlace()) !== at(before));
    if (stepped === "limit") return { status: "impossible", reason: `the player does not step ${direction} from ${at(before)} on the spin tile` };
    if (stepped !== "done") return { status: "interrupted", reason: stepped };
    // The game starts the slide one player_step after the step on the tile ends, and the game can wait for a walk in that frame.
    for (let last = before; at(this.game.playerPlace()) !== at(last); ) {
      last = this.game.playerPlace();
      const interruption = this.wait(SLIDE_START_FRAMES) ?? this.settle();
      if (interruption) return { status: "interrupted", reason: interruption };
    }
    const { map, x, y } = this.game.playerPlace();
    return map === before.map ? { status: "done", slidTo: { x, y } } : { status: "done" };
  }

  face(direction: Direction): Outcome {
    const { game } = this;
    if (game.player()?.facing === direction) return { status: "done" };
    const before = this.game.playerPlace();
    const turned = this.hold(DIRECTION_KEYS[direction], STEP_FRAME_LIMIT, () => game.player()?.facing === direction);
    if (turned === "limit") return { status: "impossible", reason: `the player does not turn ${direction}` };
    if (turned !== "done") return { status: "interrupted", reason: turned };
    const interruption = this.settle();
    if (interruption) return { status: "interrupted", reason: interruption };
    if (at(this.game.playerPlace()) !== at(before)) return { status: "impossible", reason: `the player walked to ${at(this.game.playerPlace())} when it turned ${direction}` };
    return { status: "done" };
  }

  settle(): Interruption | null {
    const result = this.hold(0, SETTLE_FRAME_LIMIT, () => this.game.waitingFor().kind === "walk");
    if (result === "limit") throw new Error(`the game waits for no input for more than ${SETTLE_FRAME_LIMIT} frames`);
    return result === "done" ? null : result;
  }

  wait(frames: number): Interruption | null {
    for (let i = 0; i < frames; i++) {
      const interruption = this.frameOrInterruption(0);
      if (interruption) return interruption;
    }
    return null;
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

  private removeObstacle(direction: Direction): LegResult {
    const interruption = this.stopWalking();
    if (interruption) return interruption;
    const turned = this.face(direction);
    if (turned.status !== "done") return turned.status === "interrupted" ? turned.reason : "no move";
    const used = this.menus.useFieldMove();
    return used.status === "interrupted" ? used.reason : this.step(direction, 1);
  }

  // Hold the direction: a short press only turns a player who faces another way. A jump moves the
  // player two times (InitJump, then the jump halfway), so a step ends on its arrival cell.
  private step(direction: Direction, cells: number): LegResult {
    const { game } = this;
    const before = this.game.playerPlace();
    const [dx, dy] = DIRECTION_STEP[direction];
    const path = Array.from({ length: cells }, (_, i) => ({ x: before.x + dx * (i + 1), y: before.y + dy * (i + 1) }));
    const arrival = path.at(-1)!;
    const result = this.hold(this.stepKeys(direction), STEP_FRAME_LIMIT, () => {
      const now = game.player();
      return !now || game.map().name !== before.map || (now.x === arrival.x && now.y === arrival.y);
    });
    if (result !== "limit") return result;
    const people = game.mapView(before.map)?.actors.people ?? [];
    return people.some((p) => path.some((c) => c.x === p.x && c.y === p.y)) ? "stuck" : "no move";
  }

  private push(direction: Direction): LegResult {
    const result = this.hold(this.stepKeys(direction), STEP_FRAME_LIMIT, () => this.game.fieldLocked());
    return result === "limit" ? "no warp" : result;
  }

  private stepKeys(direction: Direction): number {
    const key = DIRECTION_KEYS[direction];
    return !this.game.riding() && this.game.hasRunningShoes() ? key | Keys.B : key;
  }

  private hold(keys: number, limit: number, done: () => boolean): "done" | "limit" | Interruption {
    for (let frames = 0; ; frames++) {
      if (done()) return "done";
      if (frames === limit) return "limit";
      const interruption = this.frameOrInterruption(keys);
      if (interruption) return interruption;
    }
  }

  private frameOrInterruption(keys: number): Interruption | null {
    this.frames.advance(keys);
    return this.game.interruption();
  }
}
