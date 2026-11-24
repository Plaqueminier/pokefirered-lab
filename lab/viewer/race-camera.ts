import { CELL } from "../src/race/file";

const FIT_MARGIN_PIXELS = 56;
const MIN_FIT_ZOOM = 0.12;
const MAX_FIT_ZOOM = 3;
const MIN_ZOOM = 0.08;
const MAX_ZOOM = 6;
/** The share of the way to the target at each drawing. */
const FOLLOW = 0.08;
const WHEEL_SPEED = 0.0015;

/** `free`: after a drag, or a wheel when it does not follow a Ghost. `all`: it frames the Ghosts. `selected`: it follows the selected Ghost alone, also after a wheel. */
type CameraAim = "free" | "all" | "selected";

export type CellBox = { left: number; top: number; right: number; bottom: number };

export class RaceCamera {
  #x = 0;
  #y = 0;
  zoom = 0.2;
  aim: CameraAim = "all";
  #snap = true;
  /** The zoom of a wheel while the camera follows a Ghost: the follow continues at this zoom, until the aim changes. */
  #followZoom: number | null = null;

  /** The automatic camera frames at once at the next drawing, with no long move. */
  snap(): void {
    this.#snap = this.aim !== "free";
  }

  frameAgain(): void {
    this.aim = "all";
    this.#snap = true;
  }

  /** The automatic camera frames again, with a move: the box of a focus in the memorial. */
  glide(): void {
    this.aim = "all";
  }

  screenX(cell: number): number {
    return (cell * CELL - this.#x) * this.zoom;
  }

  screenY(cell: number): number {
    return (cell * CELL - this.#y) * this.zoom;
  }

  frame(box: CellBox, width: number, height: number): void {
    const free = (size: number) => Math.max(1, size - FIT_MARGIN_PIXELS * 2);
    if (this.aim !== "selected") this.#followZoom = null;
    const zoom = this.#followZoom ?? Math.max(MIN_FIT_ZOOM, Math.min(MAX_FIT_ZOOM, free(width) / ((box.right - box.left) * CELL), free(height) / ((box.bottom - box.top) * CELL)));
    const fromX = this.#x + width / 2 / this.zoom;
    const fromY = this.#y + height / 2 / this.zoom;
    const toX = ((box.left + box.right) / 2) * CELL;
    const toY = ((box.top + box.bottom) / 2) * CELL;
    // A followed Ghost that warps more than one screen away (a floor, a cave, a FLY): the camera cuts to it.
    const warp = this.aim === "selected" && (Math.abs(toX - fromX) > width / this.zoom || Math.abs(toY - fromY) > height / this.zoom);
    const part = this.#snap || warp ? 1 : FOLLOW;
    this.#snap = false;
    const nextZoom = Math.exp(Math.log(this.zoom) + (Math.log(zoom) - Math.log(this.zoom)) * part);
    const nextX = fromX + (toX - fromX) * part;
    const nextY = fromY + (toY - fromY) * part;
    this.zoom = nextZoom;
    this.#x = nextX - width / 2 / nextZoom;
    this.#y = nextY - height / 2 / nextZoom;
  }

  zoomAt(x: number, y: number, wheel: number): void {
    const next = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, this.zoom * Math.exp(-wheel * WHEEL_SPEED)));
    this.#x += x / this.zoom - x / next;
    this.#y += y / this.zoom - y / next;
    this.zoom = next;
    if (this.aim === "selected") this.#followZoom = next;
    else this.aim = "free";
  }

  pan(dx: number, dy: number): void {
    this.#x -= dx / this.zoom;
    this.#y -= dy / this.zoom;
    this.aim = "free";
  }
}
