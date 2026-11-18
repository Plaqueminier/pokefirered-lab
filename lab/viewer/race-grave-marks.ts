import type { EndReason } from "../src/protocol";
import type { StarterSpecies } from "../src/protocol";
import type { RaceKiller } from "../src/race/file";
import { STARTER_TYPE } from "./race-deaths";
import type { RaceMarks, RaceTheme } from "./race-marks";
import { FRAME_WIDTH, SHEET_HEIGHT } from "./race-sprite";

/** `x` and `y`: the middle of the base, in pixels on the screen. */
export type GraveSpot = { x: number; y: number; s: number };

type Stone = { starter: StarterSpecies | null; killer: RaceKiller | null };

/** `order`: the place of the whiteout in the Tour. */
export type GraveLook = GraveSpot & ({ kind: "stone"; death: Stone & { order: number } } | { kind: "end"; result: EndReason });

/** A place that kills, for the memorial: `top` is above its highest stone. */
export type PlaceMark = { name: string; count: number; x: number; y: number; top: number; s: number };

export type TourAt = { index: number; since: number; now: number };

const SPIRIT_MS = [0, 1500] as const;
const FALL_MS = [450, 800] as const;
const BOUNCE_MS = [800, 1000] as const;
const DUST_MS = [800, 1400] as const;
const KILLER_MS = 950;
const END_FADE_MS = 400;
const DUST_GRAINS = 12;

const clamp = (value: number, low: number, high: number) => Math.max(low, Math.min(high, value));

function stepOf(t: number, [from, to]: readonly [number, number]): number {
  return clamp((t - from) / (to - from), 0, 1);
}

const easeOut = (p: number) => 1 - (1 - p) ** 3;

function withAlpha(color: string, alpha: number): string {
  return `color-mix(in srgb, ${color} ${Math.round(alpha * 100)}%, transparent)`;
}

export class GraveMarks {
  readonly #theme: RaceTheme;
  readonly #marks: RaceMarks;
  readonly #icon: (species: string) => CanvasImageSource | null;
  readonly #labelFont: string;
  readonly #tagFont: string;

  constructor(theme: RaceTheme, marks: RaceMarks, icon: (species: string) => CanvasImageSource | null) {
    this.#theme = theme;
    this.#marks = marks;
    this.#icon = icon;
    this.#labelFont = `600 12px ${theme.font}`;
    this.#tagFont = `700 10px ${theme.font}`;
  }

  #stone(ctx: CanvasRenderingContext2D, { x, y, s }: GraveSpot, starter: StarterSpecies | null, tinted: boolean, alpha = 1): void {
    const { bg, fg, muted, faint } = this.#theme;
    const color = starter ? this.#theme.typeColor(STARTER_TYPE[starter]) : muted;
    const w = s * 0.6;
    const height = s * 0.82;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = withAlpha(bg, 0.45);
    ctx.beginPath();
    ctx.ellipse(x + s * 0.06, y + s * 0.02, w * 0.75, s * 0.09, 0, 0, Math.PI * 2);
    ctx.fill();
    const body = new Path2D();
    body.moveTo(x - w / 2, y);
    body.lineTo(x - w / 2, y - height + w / 2);
    body.arc(x, y - height + w / 2, w / 2, Math.PI, 0);
    body.lineTo(x + w / 2, y);
    body.closePath();
    const gradient = ctx.createLinearGradient(x - w / 2, y - height, x + w / 2, y);
    gradient.addColorStop(0, tinted ? color : fg);
    gradient.addColorStop(0.55, tinted ? faint : muted);
    gradient.addColorStop(1, faint);
    ctx.fillStyle = gradient;
    ctx.fill(body);
    ctx.lineWidth = Math.max(1.5, s / 16);
    ctx.strokeStyle = bg;
    ctx.stroke(body);
    ctx.strokeStyle = tinted ? withAlpha(fg, 0.6) : withAlpha(bg, 0.7);
    ctx.lineWidth = Math.max(1.5, s / 14);
    ctx.beginPath();
    ctx.moveTo(x, y - height * 0.78);
    ctx.lineTo(x, y - height * 0.3);
    ctx.moveTo(x - w * 0.24, y - height * 0.6);
    ctx.lineTo(x + w * 0.24, y - height * 0.6);
    ctx.stroke();
    ctx.fillStyle = color;
    ctx.strokeStyle = bg;
    ctx.lineWidth = Math.max(1, s / 22);
    ctx.beginPath();
    ctx.roundRect(x - w * 0.72, y - s * 0.1, w * 1.44, s * 0.14, s * 0.03);
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }

  /** The PSN of a poison out of battle: a small tag with a line, so that it stays clear on the map. */
  #killer(ctx: CanvasRenderingContext2D, killer: RaceKiller | null, { x, y, s }: GraveSpot): void {
    if (!killer) return;
    const cx = x + s * 0.32;
    const cy = y - s * 0.82;
    const r = s * 0.22;
    ctx.save();
    if (killer.poison) {
      const { bg, line, warn } = this.#theme;
      ctx.font = this.#tagFont;
      const w = ctx.measureText("PSN").width + 12;
      const h = 16;
      ctx.fillStyle = bg;
      ctx.strokeStyle = line;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.roundRect(cx - w / 2, cy - h / 2, w, h, h / 2);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = warn;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("PSN", cx, cy + 0.5);
    } else {
      this.#marks.disc(ctx, cx, cy, r, this.#theme.line);
      const image = this.#icon(killer.species);
      ctx.imageSmoothingEnabled = false;
      if (image) ctx.drawImage(image, cx - r * 1.05, cy - r * 1.15, r * 2.1, r * 2.1);
    }
    ctx.restore();
  }

  #end(ctx: CanvasRenderingContext2D, result: EndReason, { x, y, s }: GraveSpot, t: number): void {
    const r = s * 0.5;
    ctx.save();
    ctx.globalAlpha = 0.85 * stepOf(t, [0, END_FADE_MS]);
    this.#marks.disc(ctx, x, y - r, r, this.#theme.line);
    ctx.drawImage(this.#marks.resultIcon(result), x - r * 0.62, y - r * 1.62, r * 1.24, r * 1.24);
    ctx.restore();
  }

  #spirit(ctx: CanvasRenderingContext2D, sheet: CanvasImageSource, { x, y, s }: GraveSpot, p: number): void {
    if (p <= 0 || p >= 1) return;
    const scale = s / 22;
    const w = FRAME_WIDTH * scale;
    const h = SHEET_HEIGHT * scale;
    ctx.save();
    ctx.globalAlpha = 0.85 * (1 - p) ** 1.3;
    ctx.filter = "grayscale(1) brightness(1.9)";
    ctx.shadowColor = this.#theme.info;
    ctx.shadowBlur = 14;
    ctx.imageSmoothingEnabled = false;
    const rise = easeOut(p) * s * 2.6;
    const wobble = Math.sin(p * Math.PI * 3) * s * 0.15;
    ctx.drawImage(sheet, 0, 0, FRAME_WIDTH, SHEET_HEIGHT, x - w / 2 + wobble, y - h - rise, w, h);
    ctx.restore();
  }

  #dust(ctx: CanvasRenderingContext2D, { x, y, s }: GraveSpot, p: number): void {
    if (p <= 0 || p >= 1) return;
    ctx.save();
    ctx.fillStyle = this.#theme.muted;
    ctx.globalAlpha = (1 - p) * 0.75;
    for (let i = 0; i < DUST_GRAINS; i++) {
      const angle = Math.PI + (i / (DUST_GRAINS - 1)) * Math.PI + Math.sin(i * 7.3) * 0.15;
      const reach = easeOut(p) * s * (0.7 + ((i * 37) % 10) / 20);
      ctx.beginPath();
      ctx.arc(x + Math.cos(angle) * reach, y + Math.sin(angle) * reach * 0.45, s * 0.06 * (1 - p * 0.6), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  /** `t`: the ms after the whiteout; Infinity: the stone stands. */
  #fall(ctx: CanvasRenderingContext2D, spot: GraveSpot, stone: Stone, sheet: CanvasImageSource, t: number): void {
    this.#spirit(ctx, sheet, spot, stepOf(t, SPIRIT_MS));
    const fall = stepOf(t, FALL_MS);
    if (fall <= 0) return;
    const bounce = t > BOUNCE_MS[0] && t < BOUNCE_MS[1] ? Math.sin(stepOf(t, BOUNCE_MS) * Math.PI) * spot.s * 0.08 : 0;
    const lifted = { ...spot, y: spot.y - (1 - fall ** 2) * spot.s * 4 - bounce };
    this.#stone(ctx, lifted, stone.starter, false, Math.min(1, fall * 2));
    this.#dust(ctx, spot, stepOf(t, DUST_MS));
    if (t > KILLER_MS) this.#killer(ctx, stone.killer, lifted);
  }

  #grey(ctx: CanvasRenderingContext2D, width: number, height: number): void {
    ctx.save();
    ctx.globalCompositeOperation = "saturation";
    ctx.fillStyle = this.#theme.muted;
    ctx.fillRect(0, 0, width, height);
    ctx.globalCompositeOperation = "source-over";
    ctx.fillStyle = withAlpha(this.#theme.bg, 0.35);
    ctx.fillRect(0, 0, width, height);
    ctx.restore();
  }

  #heat(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, deaths: number): void {
    const heat = ctx.createRadialGradient(x, y, 0, x, y, r);
    heat.addColorStop(0, withAlpha(this.#theme.bad, Math.min(0.6, 0.25 + deaths * 0.07)));
    heat.addColorStop(1, withAlpha(this.#theme.bad, 0));
    ctx.fillStyle = heat;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }

  #placeLabel(ctx: CanvasRenderingContext2D, x: number, y: number, text: string): void {
    const { bg, fg, line, radius } = this.#theme;
    ctx.save();
    ctx.font = this.#labelFont;
    const w = ctx.measureText(text).width + 34;
    ctx.fillStyle = bg;
    ctx.strokeStyle = line;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(x - w / 2, y - 11, w, 22, radius);
    ctx.fill();
    ctx.stroke();
    ctx.drawImage(this.#marks.resultIcon("whiteout"), x - w / 2 + 8, y - 6, 12, 12);
    ctx.fillStyle = fg;
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillText(text, x - w / 2 + 25, y + 0.5);
    ctx.restore();
  }

  /** The box of a stone and its killer. */
  hits({ x, y, s }: GraveSpot, px: number, py: number): boolean {
    return Math.abs(x - px) < s * 0.45 && py < y + s * 0.15 && py > y - s * 1.05;
  }

  /** `ageOf`: the ms since the mark showed; Infinity for a mark that stands. */
  cemetery<G extends GraveLook>(ctx: CanvasRenderingContext2D, graves: readonly G[], ageOf: (grave: G) => number, sheetOf: (grave: G) => CanvasImageSource): void {
    for (const grave of graves) {
      if (grave.kind === "stone") this.#fall(ctx, grave, grave.death, sheetOf(grave), ageOf(grave));
      else this.#end(ctx, grave.result, grave, ageOf(grave));
    }
  }

  memorial(ctx: CanvasRenderingContext2D, graves: readonly GraveLook[], places: readonly PlaceMark[], focused: GraveLook | undefined, width: number, height: number): void {
    this.#grey(ctx, width, height);
    for (const place of places) this.#heat(ctx, place.x, place.y, place.s * (1.4 + place.count * 0.4), place.count);
    for (const grave of graves) {
      if (grave.kind === "end") {
        this.#end(ctx, grave.result, grave, Number.POSITIVE_INFINITY);
        continue;
      }
      this.#stone(ctx, grave, grave.death.starter, true);
      this.#killer(ctx, grave.death.killer, grave);
      if (grave === focused) this.#ring(ctx, grave);
    }
    for (const place of places) this.#placeLabel(ctx, place.x, place.top, `${place.count} · ${place.name}`);
  }

  /** The whiteout at `index` falls; the ones before it stand with their killer, the ones after it are faint. */
  tour<G extends GraveLook>(ctx: CanvasRenderingContext2D, graves: readonly G[], { index, since, now }: TourAt, sheetOf: (grave: G) => CanvasImageSource, width: number, height: number): void {
    this.#night(ctx, width, height);
    for (const grave of graves) {
      if (grave.kind !== "stone") continue;
      const { order } = grave.death;
      if (order === index) {
        this.#candle(ctx, grave, now, order, 1.4);
        this.#fall(ctx, grave, grave.death, sheetOf(grave), now - since);
        continue;
      }
      const seen = order < index;
      this.#candle(ctx, grave, now, order, seen ? 0.7 : 0.35);
      this.#stone(ctx, grave, grave.death.starter, false, seen ? 0.95 : 0.45);
      if (seen) this.#killer(ctx, grave.death.killer, grave);
    }
  }

  #ring(ctx: CanvasRenderingContext2D, { x, y, s }: GraveSpot): void {
    ctx.save();
    ctx.strokeStyle = this.#theme.accent;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.ellipse(x, y, s * 0.55, s * 0.2, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  #night(ctx: CanvasRenderingContext2D, width: number, height: number): void {
    const { bg, black } = this.#theme;
    ctx.save();
    ctx.fillStyle = withAlpha(bg, 0.7);
    ctx.fillRect(0, 0, width, height);
    const vignette = ctx.createRadialGradient(width / 2, height / 2, Math.min(width, height) * 0.25, width / 2, height / 2, Math.max(width, height) * 0.75);
    vignette.addColorStop(0, withAlpha(black, 0));
    vignette.addColorStop(1, withAlpha(black, 0.75));
    ctx.fillStyle = vignette;
    ctx.fillRect(0, 0, width, height);
    ctx.restore();
  }

  /** `now` in ms: the light flickers with the time. */
  #candle(ctx: CanvasRenderingContext2D, { x, y, s }: GraveSpot, now: number, seed: number, strength: number): void {
    const flicker = 0.85 + Math.sin(now / 90 + seed) * 0.08 + Math.sin(now / 37 + seed * 3) * 0.05;
    const r = s * 1.6 * strength;
    const cy = y - s * 0.4;
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    const glow = ctx.createRadialGradient(x, cy, 0, x, cy, r);
    glow.addColorStop(0, withAlpha(this.#theme.warn, 0.5 * flicker * Math.min(1, strength)));
    glow.addColorStop(1, withAlpha(this.#theme.warn, 0));
    ctx.fillStyle = glow;
    ctx.fillRect(x - r, cy - r, r * 2, r * 2);
    ctx.restore();
  }
}
