import { CELL } from "../src/race/file";

const FIT_MARGIN_PIXELS = 56;
const MIN_FIT_ZOOM = 0.12;
const MAX_FIT_ZOOM = 3;
const MIN_ZOOM = 0.08;
const MAX_ZOOM = 6;
/** The share of the way to the target at each drawing. */
const FOLLOW = 0.08;
const WHEEL_SPEED = 0.0015;

export type CellBox = { left: number; top: number; right: number; bottom: number };

export class RaceCamera {
  #x = 0;
  #y = 0;
  zoom = 0.2;
  /** False after a wheel or a drag. */
  auto = true;
  #snap = true;

  /** The automatic camera frames at once at the next drawing, with no long move. */
  snap(): void {
    this.#snap = this.auto;
  }

  frameAgain(): void {
    this.auto = true;
    this.#snap = true;
  }

  screenX(cell: number): number {
    return (cell * CELL - this.#x) * this.zoom;
  }

  screenY(cell: number): number {
    return (cell * CELL - this.#y) * this.zoom;
  }

  follow(box: CellBox, width: number, height: number): void {
    const free = (size: number) => Math.max(1, size - FIT_MARGIN_PIXELS * 2);
    const zoom = Math.max(MIN_FIT_ZOOM, Math.min(MAX_FIT_ZOOM, free(width) / ((box.right - box.left) * CELL), free(height) / ((box.bottom - box.top) * CELL)));
    const part = this.#snap ? 1 : FOLLOW;
    this.#snap = false;
    const nextZoom = Math.exp(Math.log(this.zoom) + (Math.log(zoom) - Math.log(this.zoom)) * part);
    const fromX = this.#x + width / 2 / this.zoom;
    const fromY = this.#y + height / 2 / this.zoom;
    const nextX = fromX + (((box.left + box.right) / 2) * CELL - fromX) * part;
    const nextY = fromY + (((box.top + box.bottom) / 2) * CELL - fromY) * part;
    this.zoom = nextZoom;
    this.#x = nextX - width / 2 / nextZoom;
    this.#y = nextY - height / 2 / nextZoom;
  }

  zoomAt(x: number, y: number, wheel: number): void {
    const next = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, this.zoom * Math.exp(-wheel * WHEEL_SPEED)));
    this.#x += x / this.zoom - x / next;
    this.#y += y / this.zoom - y / next;
    this.zoom = next;
    this.auto = false;
  }

  pan(dx: number, dy: number): void {
    this.#x -= dx / this.zoom;
    this.#y -= dy / this.zoom;
    this.auto = false;
  }
}
