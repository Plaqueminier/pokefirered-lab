import { CircleDollarSign, CircleQuestionMark, Crown, Flag, House, type LucideIcon, Skull, Square, Swords } from "lucide-preact";
import { h, render } from "preact";
import type { EndReason } from "../src/harness/harness";
import { TILE } from "../src/race/file";

export type RaceTheme = { accent: string; accentFg: string; bg: string; fg: string; faint: string; muted: string; ok: string; info: string; bad: string; warn: string; line: string; font: string; textSm: string; radius: number };

export function raceTheme(element: Element): RaceTheme {
  const style = getComputedStyle(element);
  const value = (name: string) => style.getPropertyValue(`--${name}`).trim();
  const token = (name: string) => value(`color-${name}`);
  return {
    accent: token("accent"),
    accentFg: token("accent-fg"),
    bg: token("bg"),
    fg: token("fg"),
    faint: token("faint"),
    muted: token("muted"),
    ok: token("ok"),
    info: token("info"),
    bad: token("bad"),
    warn: token("warn"),
    line: token("line-strong"),
    font: value("font-sans"),
    textSm: value("text-sm"),
    radius: Number.parseFloat(value("radius-sm")),
  };
}

// A canvas draws a picture, not a component: the icon goes through an SVG image.
function iconImage(icon: LucideIcon, color: string): HTMLImageElement {
  const holder = document.createElement("div");
  render(h(icon, { size: 48, color, strokeWidth: 2.4 }), holder);
  const image = new Image();
  image.src = `data:image/svg+xml,${encodeURIComponent(holder.innerHTML)}`;
  return image;
}

const LABEL_HEIGHT = 14;
const ICON = 13;
const BADGE_SIZE = TILE * 2;

export type Box = { x: number; y: number; w: number; h: number };

export function inBox(box: Box, x: number, y: number): boolean {
  return x >= box.x && x <= box.x + box.w && y >= box.y && y <= box.y + box.h;
}

function touches(a: Box, b: Box): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

export type GhostLabel = {
  x: number;
  y: number;
  text: string | null;
  ended: boolean;
  group: boolean;
  battle: { trainer: boolean; count: number } | null;
  crown: boolean;
  result: EndReason | null;
  selected: string | null;
};

export class RaceMarks {
  readonly #theme: RaceTheme;
  readonly #swords: HTMLImageElement;
  readonly #house: HTMLImageElement;
  readonly #crown: HTMLImageElement;
  readonly #results: Record<EndReason, HTMLImageElement>;
  readonly #labelFont: string;
  readonly #smallFont: string;
  readonly #nameFont: string;
  readonly #townFont: string;

  constructor(theme: RaceTheme) {
    this.#theme = theme;
    this.#swords = iconImage(Swords, theme.warn);
    this.#house = iconImage(House, theme.fg);
    this.#crown = iconImage(Crown, theme.warn);
    const stop = iconImage(Square, theme.muted);
    const coin = iconImage(CircleDollarSign, theme.warn);
    const lost = iconImage(CircleQuestionMark, theme.info);
    this.#results = { goal: iconImage(Flag, theme.ok), "user stop": stop, "bot stopped": stop, "cost limit": coin, "frame budget": coin, whiteout: iconImage(Skull, theme.bad), "no progress": lost, "unknown screen": lost };
    this.#labelFont = `700 10px ${theme.font}`;
    this.#smallFont = `700 9px ${theme.font}`;
    this.#nameFont = `600 11px ${theme.font}`;
    this.#townFont = `700 ${theme.textSm} ${theme.font}`;
  }

  #disc(ctx: CanvasRenderingContext2D, x: number, y: number, radius: number, ring: string | null): void {
    ctx.fillStyle = this.#theme.bg;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();
    if (!ring) return;
    ctx.strokeStyle = ring;
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }

  #pill(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, color: string): void {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, h / 2);
    ctx.fill();
  }

  /** Gives the box of the label on the screen. */
  label(ctx: CanvasRenderingContext2D, { x, y, text, ended, group, battle, crown, result, selected }: GhostLabel): Box {
    const { accent, accentFg, faint, fg, bad, warn } = this.#theme;
    ctx.font = this.#labelFont;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const width = text === null ? 0 : Math.max(16, ctx.measureText(text).width + 8);
    if (text !== null) {
      this.#pill(ctx, x - width / 2, y - LABEL_HEIGHT / 2, width, LABEL_HEIGHT, ended ? faint : group ? fg : accent);
      ctx.fillStyle = ended ? fg : accentFg;
      ctx.fillText(text, x, y + 0.5);
    }
    if (result && text !== null) {
      const left = x - width / 2 - ICON - 3;
      this.#disc(ctx, left + ICON / 2, y, ICON / 2 + 2.5, null);
      ctx.drawImage(this.#results[result], left, y - ICON / 2, ICON, ICON);
    }
    if (crown) ctx.drawImage(this.#crown, x - 7, y - 21, 14, 14);
    if (battle) {
      const center = x + width / 2 + ICON / 2 + 4;
      this.#disc(ctx, center, y, ICON / 2 + 3, battle.trainer ? bad : warn);
      ctx.drawImage(this.#swords, center - ICON / 2, y - ICON / 2, ICON, ICON);
      if (battle.count > 1) {
        ctx.fillStyle = warn;
        ctx.font = this.#smallFont;
        ctx.fillText(`${battle.count}`, center + ICON / 2 + 9, y + 0.5);
      }
    }
    if (selected) this.selectedName(ctx, x, crown ? y - 40 : y - 26, selected);
    const top = y - (crown ? 21 : LABEL_HEIGHT / 2);
    return { x: x - width / 2, y: top, w: width, h: y + LABEL_HEIGHT / 2 - top };
  }

  selectedName(ctx: CanvasRenderingContext2D, x: number, top: number, name: string): void {
    const { bg, fg, radius } = this.#theme;
    ctx.font = this.#nameFont;
    const w = ctx.measureText(name).width + 12;
    ctx.fillStyle = bg;
    ctx.beginPath();
    ctx.roundRect(x - w / 2, top, w, 16, radius);
    ctx.fill();
    ctx.fillStyle = fg;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(name, x, top + 8);
  }

  ring(ctx: CanvasRenderingContext2D, x: number, y: number, scale: number): void {
    ctx.strokeStyle = this.#theme.accent;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.ellipse(x, y - 2 * scale, 9 * scale, 4 * scale, 0, 0, Math.PI * 2);
    ctx.stroke();
  }

  doorCount(ctx: CanvasRenderingContext2D, x: number, y: number, count: number, crown: boolean): Box {
    const { accent, bg, fg } = this.#theme;
    const text = `×${count}`;
    ctx.font = this.#labelFont;
    const w = ctx.measureText(text).width + 26;
    const h = 18;
    const left = x - w / 2;
    const top = y - h;
    ctx.fillStyle = bg;
    ctx.strokeStyle = accent;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.roundRect(left, top, w, h, h / 2);
    ctx.fill();
    ctx.stroke();
    ctx.drawImage(this.#house, left + 5, top + 3, 12, 12);
    ctx.fillStyle = fg;
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillText(text, left + 19, top + h / 2 + 0.5);
    ctx.textAlign = "center";
    if (crown) ctx.drawImage(this.#crown, x - 7, top - 15, 14, 14);
    return crown ? { x: left, y: top - 15, w, h: h + 15 } : { x: left, y: top, w, h };
  }

  gym(ctx: CanvasRenderingContext2D, sheet: HTMLCanvasElement, badge: number, x: number, y: number, size: number, winners: number): Box {
    const { accentFg, line, warn } = this.#theme;
    const radius = size / 2 + 3;
    const disc: Box = { x: x - radius, y: y - radius, w: radius * 2, h: radius * 2 };
    this.#disc(ctx, x, y, radius, winners > 0 ? warn : line);
    ctx.save();
    if (winners === 0) {
      ctx.filter = "grayscale(1) brightness(0.75)";
      ctx.globalAlpha = 0.8;
    }
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(sheet, badge * BADGE_SIZE, 0, BADGE_SIZE, BADGE_SIZE, x - size / 2, y - size / 2, size, size);
    ctx.restore();
    if (winners === 0) return disc;
    const text = `×${winners}`;
    ctx.font = this.#labelFont;
    const w = ctx.measureText(text).width + 10;
    this.#pill(ctx, x + size / 2 + 2, y - LABEL_HEIGHT / 2, w, LABEL_HEIGHT, warn);
    ctx.fillStyle = accentFg;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(text, x + size / 2 + 2 + w / 2, y + 0.5);
    return { ...disc, w: disc.w + w };
  }

  /** A town goes under what it would touch, and a route has no name then. */
  mapName(ctx: CanvasRenderingContext2D, name: string, town: boolean, visible: Box, placed: Box[]): void {
    const { bg, fg, radius } = this.#theme;
    ctx.font = town ? this.#townFont : this.#nameFont;
    const w = ctx.measureText(name).width + 14;
    const h = town ? 22 : 18;
    const box: Box = { x: Math.max(4, Math.min(visible.x + 6, visible.x + visible.w - w - 4)), y: visible.y + 6, w, h };
    if (placed.some((other) => touches(box, other))) {
      if (!town) return;
      while (placed.some((other) => touches(box, other))) box.y += 2;
    }
    placed.push(box);
    ctx.globalAlpha = town ? 0.82 : 0.62;
    ctx.fillStyle = bg;
    ctx.beginPath();
    ctx.roundRect(box.x, box.y, w, h, radius);
    ctx.fill();
    ctx.globalAlpha = town ? 1 : 0.8;
    ctx.fillStyle = fg;
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillText(name, box.x + 7, box.y + h / 2 + 0.5);
    ctx.globalAlpha = 1;
    ctx.textAlign = "center";
  }
}
