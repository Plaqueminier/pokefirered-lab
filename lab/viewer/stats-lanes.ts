import { REFLECTION_EVERY } from "../src/model/decision";
import { GBA_FPS } from "../src/protocol";
import type { Span } from "./cursor";
import { dollars, tokens } from "./runs";
import type { Call, StatsView } from "./stats-panel";

const PLOT_LEFT = 118;
const PLOT_RIGHT = 80;
const LANE_GAP = 10;
const AXIS_HEIGHT = 24;
const AREA_COLORS = ["#5b8def", "#e8643c", "#3fb47a", "#b07ae8", "#e0a85a", "#e05797", "#4fc1c9", "#c9c24f"];
const PLAYED_HEIGHTS = { done: 10, interrupted: 22, blocked: 30, impossible: 40 };

export type AxisScale = { width: number; end: number; x(frame: number): number; frame(x: number): number; clamp(x: number): number };

export function axisScale(width: number, end: number): AxisScale {
  const plot = Math.max(1, width - PLOT_LEFT - PLOT_RIGHT);
  const clamp = (x: number) => Math.min(Math.max(x, PLOT_LEFT), PLOT_LEFT + plot);
  return {
    width,
    end,
    x: (frame) => PLOT_LEFT + (Math.min(Math.max(frame, 0), end) / end) * plot,
    frame: (x) => Math.round(((clamp(x) - PLOT_LEFT) / plot) * end),
    clamp,
  };
}

type Plot = { view: StatsView; scale: AxisScale; top: number; height: number; costLimit: number | null };

type Lane = { name: string; height: number; model: boolean; draw: (plot: Plot) => string };

const LANES: Lane[] = [
  { name: "Milestones", height: 24, model: false, draw: milestonesLane },
  { name: "Areas", height: 38, model: false, draw: areasLane },
  { name: "Cost", height: 90, model: true, draw: costLane },
  { name: "Stuck", height: 60, model: true, draw: stuckLane },
  { name: "Prompt tokens", height: 50, model: true, draw: promptLane },
  { name: "Model calls", height: 22, model: true, draw: callsLane },
  { name: "Played actions", height: 40, model: false, draw: playedLane },
  { name: "Summary calls", height: 16, model: true, draw: summariesLane },
  { name: "Battles", height: 14, model: false, draw: battlesLane },
];

export function lanes(view: StatsView, modelBot: boolean): Lane[] {
  const model = modelBot || view.calls.length > 0 || view.summaries.length > 0;
  return LANES.filter((lane) => model || !lane.model);
}

export type StuckLevel = "low" | "mid" | "high";

export function stuckLevel(stuck: number): StuckLevel {
  if (stuck < REFLECTION_EVERY / 3) return "low";
  return stuck < (2 * REFLECTION_EVERY) / 3 ? "mid" : "high";
}

/** A scale up to a limit far above the cost gives a flat curve. `base`: the cost of the parent of a Continued Run, which its limit does not count. */
export function costScale(cost: number, limit: number | null, base = 0): { max: number; limitLine: boolean } {
  const limitLine = limit !== null && cost > limit / 2;
  return { max: Math.max(limitLine ? base + limit : 0, base + cost), limitLine };
}

export function clock(frame: number): string {
  const seconds = Math.round(frame / GBA_FPS);
  const minutes = Math.floor(seconds / 60);
  const mmss = `${String(minutes % 60).padStart(minutes >= 60 ? 2 : 1, "0")}:${String(seconds % 60).padStart(2, "0")}`;
  return minutes >= 60 ? `${Math.floor(minutes / 60)}:${mmss}` : mmss;
}

function spanText({ from, to }: Span): string {
  return `${clock(from)} → ${clock(to)} (${clock(to - from)})`;
}

function paler(hex: string): string {
  const mix = (i: number) => Math.round(Number.parseInt(hex.slice(i, i + 2), 16) * 0.55 + 255 * 0.45);
  return `rgb(${mix(1)}, ${mix(3)}, ${mix(5)})`;
}

function esc(text: string): string {
  return text.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] ?? c);
}

function fitLabel(text: string, className: string, x: number, width: number, y: number): string {
  return width > text.length * 6.6 + 8 ? `<text class="${className}" x="${x + 4}" y="${y}">${esc(text)}</text>` : "";
}

/** `cursor`: the frame of the shared cursor of the Viewer, a line through all the lanes. */
export type LanesInput = { view: StatsView; scale: AxisScale; played: number; costLimit: number | null; selection: Span | null; cursor?: number | null };

export function lanesSvg({ view, scale, played, costLimit, selection, cursor = null }: LanesInput): string {
  const { x } = scale;
  const right = x(scale.end);
  const parts: string[] = [];
  let top = 0;
  for (const lane of lanes(view, costLimit !== null)) {
    parts.push(`<text class="lane" x="0" y="${top + 14}">${lane.name}</text>`);
    parts.push(lane.draw({ view, scale, top, height: lane.height, costLimit }));
    top += lane.height;
    parts.push(`<line class="rule" x1="${x(0)}" x2="${right}" y1="${top}" y2="${top}"/>`);
    top += LANE_GAP;
  }
  const bottom = top - LANE_GAP;
  for (const chapter of view.chapters.slice(0, -1)) parts.push(`<line class="milestone" x1="${x(chapter.to)}" x2="${x(chapter.to)}" y1="0" y2="${bottom}"/>`);
  if (view.parentEnd) {
    const cx = x(view.parentEnd.frame);
    parts.push(`<line class="continued" x1="${cx}" x2="${cx}" y1="0" y2="${bottom}" data-tip="continued here, at ${clock(view.parentEnd.frame)}"/><text class="continued-text" x="${cx + 4}" y="${bottom - 6}">continued here</text>`);
  }
  if (played < scale.end) parts.unshift(`<rect class="future" x="${x(played)}" y="0" width="${right - x(played)}" height="${bottom}"/><text x="${x(played) + 6}" y="${bottom - 6}">not played yet</text>`);
  for (let i = 0; i <= 6; i++) parts.push(`<text x="${x((scale.end * i) / 6)}" y="${bottom + AXIS_HEIGHT - 6}" text-anchor="middle">${clock((scale.end * i) / 6)}</text>`);
  const span = selection ?? { from: 0, to: 0 };
  parts.push(`<rect class="selection" x="${x(span.from)}" y="0" width="${selection ? Math.max(2, x(span.to) - x(span.from)) : 0}" height="${bottom}"/>`);
  if (cursor !== null) parts.push(`<line class="cursor" x1="${x(cursor)}" x2="${x(cursor)}" y1="0" y2="${bottom}"/>`);
  parts.push(`<line class="cross" x1="0" x2="0" y1="0" y2="${bottom}"/>`);
  return `<svg width="${scale.width}" height="${bottom + AXIS_HEIGHT}">${parts.join("")}</svg>`;
}

function milestonesLane({ view, scale: { x }, top, height }: Plot): string {
  return view.chapters
    .map((chapter, i) => {
      const x0 = x(chapter.from);
      const width = Math.max(0, x(chapter.to) - x0);
      const name = chapter.milestone ?? "→ next Milestone";
      return `<rect class="chapter c${i % 4}" x="${x0}" y="${top}" width="${width}" height="${height}" data-tip="${esc(`${name}: ${spanText(chapter)}`)}"/>${fitLabel(name, `chapter-name c${i % 4}`, x0, width, top + 16)}`;
    })
    .join("");
}

function areasLane({ view, scale: { x }, top }: Plot): string {
  const block = (span: Span, className: string, color: string, y: number, height: number, tip: string) =>
    `<rect class="area ${className}" x="${x(span.from)}" y="${y}" width="${Math.max(1, x(span.to) - x(span.from))}" height="${height}" style="fill:${color}" data-tip="${esc(`${tip}: ${spanText(span)}`)}"/>`;
  const color = (order: number) => AREA_COLORS[order % AREA_COLORS.length];
  const parts: string[] = [];
  for (const stay of view.areas) {
    parts.push(block(stay, "", color(stay.order), top, 20, stay.area), fitLabel(stay.area, "area-name", x(stay.from), x(stay.to) - x(stay.from), top + 14));
  }
  for (const stay of view.maps) {
    if (stay.place === null) {
      parts.push(block(stay, "outside", color(stay.order), top + 21, 17, stay.area));
      continue;
    }
    parts.push(block(stay, "inside", paler(color(stay.order)), top + 21, 17, stay.place ? `${stay.area} · ${stay.place}` : stay.area));
    parts.push(fitLabel(stay.place, "place-name", x(stay.from), x(stay.to) - x(stay.from), top + 33));
  }
  return parts.join("");
}

function costLane({ view, scale: { x }, top, height, costLimit }: Plot): string {
  const base = view.parentEnd?.cost ?? 0;
  const ownCost = view.cost - base;
  const scale = costScale(ownCost, costLimit, base);
  const max = Math.max(scale.max, 0.0001) * 1.15;
  const y = (cost: number) => top + height - (cost / max) * height;
  let path = `M ${x(0)} ${y(0)}`;
  for (const step of view.costSteps) path += ` H ${x(step.frame)} V ${y(step.cost)}`;
  path += ` H ${x(view.now)}`;
  const parts = [`<path class="cost-area" d="${path} V ${y(0)} Z"/>`, `<path class="cost" d="${path}"/>`, `<text class="cost-now" x="${x(view.now) + 6}" y="${y(view.cost) + 4}">${dollars(view.cost)}</text>`];
  if (costLimit === null) return parts.join("");
  if (scale.limitLine) parts.push(`<line class="limit" x1="${x(0)}" x2="${x(view.now)}" y1="${y(base + costLimit)}" y2="${y(base + costLimit)}"/>`);
  parts.push(`<text class="limit-text" x="0" y="${top + height / 2 + 20}">limit ${dollars(costLimit)}</text><text x="0" y="${top + height / 2 + 34}">${Math.round((100 * ownCost) / costLimit)} % used</text>`);
  return parts.join("");
}

function callsWith<K extends "stuck" | "prompt">(view: StatsView, key: K): (Call & Record<K, number>)[] {
  return view.calls.filter((c): c is Call & Record<K, number> => c[key] !== null);
}

function stuckLane({ view, scale: { x, end }, top, height }: Plot): string {
  const known = callsWith(view, "stuck");
  if (known.length === 0) return `<text x="${x(0) + 6}" y="${top + 34}">no Stuck counter in this Run record (a model bot before version 4)</text>`;
  const max = Math.max(...known.map((c) => c.stuck));
  const now = known[known.length - 1].stuck;
  const yMax = Math.max(REFLECTION_EVERY, max) * 1.1;
  const y = (stuck: number) => top + height - (stuck / yMax) * height;
  const parts: string[] = [];
  known.forEach((c, i) => {
    if (c.stuck === 0) return;
    const x0 = x(c.frame);
    const tip = `Stuck counter ${c.stuck} at ${clock(c.frame)}: ${c.situation}`;
    parts.push(`<rect class="stuck ${stuckLevel(c.stuck)}" x="${x0}" y="${y(c.stuck)}" width="${Math.max(1, x(known[i + 1]?.frame ?? view.now) - x0)}" height="${top + height - y(c.stuck)}" data-tip="${esc(tip)}"/>`);
  });
  parts.push(`<line class="reflection" x1="${x(0)}" x2="${x(end)}" y1="${y(REFLECTION_EVERY)}" y2="${y(REFLECTION_EVERY)}"/>`);
  parts.push(`<text class="reflection-text" x="${x(end) + 6}" y="${y(REFLECTION_EVERY) + 4}">reflection ${REFLECTION_EVERY}</text>`);
  for (const c of known.filter((call) => call.reflection)) {
    const cx = x(c.frame);
    parts.push(`<path class="reflection-mark" d="M ${cx - 5} ${top - 2} L ${cx + 5} ${top - 2} L ${cx} ${top + 6} Z" data-tip="Reflection turn at ${clock(c.frame)} (Stuck counter ${c.stuck})"/>`);
  }
  parts.push(`<text class="stuck-now ${stuckLevel(now)}" x="0" y="${top + 38}">${now}</text><text x="${8 + String(now).length * 12}" y="${top + 38}">now</text>`);
  parts.push(`<text class="stuck-max ${stuckLevel(max)}" x="0" y="${top + 54}">max ${max}</text>`);
  return parts.join("");
}

function promptLane({ view, scale: { x }, top, height }: Plot): string {
  const known = callsWith(view, "prompt");
  if (known.length === 0) return `<text x="${x(0) + 6}" y="${top + 28}">no prompt tokens in this Run record</text>`;
  const max = Math.max(...known.map((c) => c.prompt));
  const y = (count: number) => top + height - (count / (max * 1.1)) * height;
  const path = known.map((c, i) => `${i === 0 ? "M" : "L"} ${x(c.frame)} ${y(c.prompt)}`).join(" ");
  const parts = [`<path class="prompt" d="${path}"/>`];
  for (const c of known) parts.push(`<circle class="prompt-dot" cx="${x(c.frame)}" cy="${y(c.prompt)}" r="2.5" data-tip="prompt of ${tokens(c.prompt)} tokens at ${clock(c.frame)}"/>`);
  parts.push(`<text class="prompt-now" x="0" y="${top + 32}">${tokens(known[known.length - 1].prompt)} now</text><text x="0" y="${top + 46}">max ${tokens(max)}</text>`);
  return parts.join("");
}

function tick(className: string, frame: number, x: AxisScale["x"], bottom: number, height: number): string {
  return `<line class="${className}" x1="${x(frame)}" x2="${x(frame)}" y1="${bottom - height}" y2="${bottom}"/>`;
}

function callsLane({ view, scale: { x }, top, height }: Plot): string {
  return view.calls.map((c) => (c.answer.kind === "unreadable" ? tick("call unreadable", c.frame, x, top + height, height) : tick("call", c.frame, x, top + height, 12))).join("");
}

function playedLane({ view, scale: { x }, top, height }: Plot): string {
  const sorted = [...view.played].sort((a, b) => PLAYED_HEIGHTS[a.status] - PLAYED_HEIGHTS[b.status]);
  return sorted.map((p) => tick(`played ${p.status}`, p.frame, x, top + height, PLAYED_HEIGHTS[p.status])).join("");
}

function summariesLane({ view, scale: { x }, top, height }: Plot): string {
  return view.summaries.map((s) => tick("summary", s.frame, x, top + height, height)).join("");
}

function battlesLane({ view, scale: { x }, top, height }: Plot): string {
  return view.battles.map((b) => `<rect class="battle" x="${x(b.from)}" y="${top}" width="${Math.max(2, x(b.to) - x(b.from))}" height="${height}" data-tip="battle: ${spanText(b)}"/>`).join("");
}
