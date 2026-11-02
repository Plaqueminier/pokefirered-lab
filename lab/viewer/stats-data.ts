import type { Areas } from "../src/game";
import type { ActionResult } from "../src/harness/harness";
import type { Continuation, RunEvent } from "../src/harness/record";
import { MODEL_ACTION_NAMES } from "../src/model/decision";
import { isNewNote } from "../src/model/memory-tree";
import { actionText, GBA_FPS, type SpendUnit, spentIn } from "../src/protocol";
import type { Moment, Span } from "./cursor";
import { clock, spanText } from "./stats-format";
import { areaOf, MILESTONE_NAMES } from "./timeline-events";

type Count = { name: string; count: number };

type Call = {
  index: number;
  frame: number;
  situation: string;
  stuck: number | null;
  reflection: boolean;
  prompt: number | null;
  note: boolean;
  answer: { kind: "action"; name: string; text: string } | { kind: "unreadable"; error: string };
};

type Played = { frame: number; call: number | null; name: string; text: string; status: ActionResult["status"]; reason: string };

type AreaStay = Span & { area: string; order: number };

export type StatsOptions = { now: number; areas: Areas; continued: Continuation | null; unit?: SpendUnit };

export type StatsView = {
  now: number;
  calls: Call[];
  played: Played[];
  summaries: { frame: number }[];
  unit: SpendUnit;
  spentSteps: { frame: number; spent: number }[];
  spent: number;
  /** A chapter is the time up to a Milestone, with its name; the last one is open: "After Pokédex", or "Start". */
  chapters: (Span & { name: string })[];
  areas: AreaStay[];
  /** For a Continued Run: its first frame, and the cost of its parent, which its cost limit does not count. */
  parentEnd: { frame: number; spent: number } | null;
};

export function statsView(events: readonly RunEvent[], { now, areas, continued, unit = "dollars" }: StatsOptions): StatsView {
  const view: StatsView = { now, calls: [], played: [], summaries: [], unit, spentSteps: [], spent: 0, chapters: [], areas: [], parentEnd: null };
  const visited: string[] = [];
  let chapter = 0;
  let lastNote: string | undefined;
  events.forEach((event, i) => {
    if (continued && i === continued.events) view.parentEnd = { frame: continued.frame, spent: view.spent };
    if ("usage" in event) {
      view.spent += spentIn(unit, event.usage);
      view.spentSteps.push({ frame: event.frame, spent: view.spent });
    }
    switch (event.type) {
      case "map": {
        const { area } = areaOf(areas, event.map);
        if (!visited.includes(area)) visited.push(area);
        const last = view.areas.at(-1);
        if (last?.area === area) break;
        if (last) last.to = event.frame - 1;
        view.areas.push({ area, order: visited.indexOf(area), from: event.frame, to: now });
        break;
      }
      case "milestone":
        // An event at the frame of a Milestone belongs to the chapter that it ends.
        view.chapters.push({ name: MILESTONE_NAMES[event.milestone] ?? event.milestone, from: chapter, to: event.frame });
        chapter = event.frame + 1;
        break;
      case "model": {
        const { decision } = event;
        // An unreadable call has the usage 0 (NO_USAGE of the model bot): it has no prompt to show.
        const promptTokens = event.usage?.promptTokens ?? 0;
        view.calls.push({
          index: view.calls.length,
          frame: event.frame,
          situation: event.situation,
          stuck: event.stuck ?? null,
          reflection: event.reflection ?? false,
          prompt: promptTokens > 0 ? promptTokens : null,
          note: decision !== null && isNewNote(decision.note, lastNote),
          answer: decision ? { kind: "action", name: actionName(decision.action), text: decision.action } : { kind: "unreadable", error: event.error },
        });
        if (decision?.note) lastNote = decision.note;
        break;
      }
      case "action": {
        const { result } = event;
        const call = view.calls.length > 0 ? view.calls.length - 1 : null;
        view.played.push({ frame: event.frame, call, name: event.action.name, text: actionText(event.action), status: result.status, reason: result.status === "done" ? "" : result.reason });
        break;
      }
      case "summary":
        view.summaries.push({ frame: event.frame });
        break;
    }
  });
  if (continued && !view.parentEnd) view.parentEnd = { frame: continued.frame, spent: view.spent };
  const reached = view.chapters.at(-1)?.name;
  view.chapters.push({ name: reached ? `After ${reached}` : "Start", from: chapter, to: now });
  view.areas = withoutShortStays(view.areas);
  return view;
}

function actionName(action: string): string {
  const word = action.trim().split(/\s+/)[0];
  return MODEL_ACTION_NAMES.find((name) => name.toLowerCase() === word.toLowerCase()) ?? word;
}

export type Selected = {
  calls: Call[];
  played: Played[];
  summaries: { frame: number }[];
  spent: number;
  notes: number;
  stuckMax: number | null;
  reflections: number;
  prompt: { min: number; max: number } | null;
  actions: Count[];
  impossible: Count[];
  unreadable: Count[];
};

export function selected(view: StatsView, spans: readonly Span[]): Selected {
  const inside = ({ frame }: { frame: number }) => isInside(spans, frame);
  const calls = view.calls.filter(inside);
  const played = view.played.filter(inside);
  const summaries = view.summaries.filter(inside);
  const stucks = calls.flatMap((c) => (c.stuck === null ? [] : [c.stuck]));
  const prompts = calls.flatMap((c) => (c.prompt === null ? [] : [c.prompt]));
  const chosen = counts(calls.flatMap((c) => (c.answer.kind === "action" ? [c.answer.name] : [])));
  return {
    calls,
    played,
    summaries,
    spent: spans.reduce((sum, s) => sum + spentAt(view, s.to) - spentAt(view, s.from - 1), 0),
    notes: calls.filter((c) => c.note).length,
    stuckMax: stucks.length > 0 ? Math.max(...stucks) : null,
    reflections: calls.filter((c) => c.reflection).length,
    prompt: prompts.length > 0 ? { min: Math.min(...prompts), max: Math.max(...prompts) } : null,
    actions: MODEL_ACTION_NAMES.map((name) => ({ name, count: chosen.find((c) => c.name === name)?.count ?? 0 })).sort((a, b) => b.count - a.count),
    impossible: counts(played.flatMap((p) => (p.status === "impossible" ? [withoutNumbers(`${p.name}: ${p.reason}`)] : []))),
    unreadable: counts(calls.flatMap((c) => (c.answer.kind === "unreadable" ? [withoutNumbers(c.answer.error)] : []))),
  };
}

export function spentAt(view: StatsView, frame: number): number {
  return view.spentSteps.findLast((s) => s.frame <= frame)?.spent ?? 0;
}

/** A Model call goes from its frame to the frame before the next call at a later frame, or to now. */
export function callSpan(view: StatsView, index: number): Span {
  const call = view.calls[index];
  const next = view.calls.find((c) => c.frame > call.frame);
  return { from: call.frame, to: next ? next.frame - 1 : view.now };
}

export function stuckAt(view: StatsView, frame: number): number | null {
  return view.calls.findLast((c) => c.frame <= frame)?.stuck ?? null;
}

export function promptAt(view: StatsView, frame: number): number | null {
  return view.calls.findLast((c) => c.frame <= frame && c.prompt !== null)?.prompt ?? null;
}

function withoutNumbers(text: string): string {
  return text.replace(/-?\d+/g, "#");
}

function counts(names: string[]): Count[] {
  const map = new Map<string, number>();
  for (const name of names) map.set(name, (map.get(name) ?? 0) + 1);
  return [...map].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count);
}

export function isInside(spans: readonly Span[], frame: number): boolean {
  return spans.some((s) => frame >= s.from && frame <= s.to);
}

/** The span from the first frame to the last frame of the spans. */
export function hull(spans: readonly Span[]): Span {
  return { from: Math.min(...spans.map((s) => s.from)), to: Math.max(...spans.map((s) => s.to)) };
}

/** The parts of the spans up to a frame: a replay has the Game events of the whole record. */
export function upTo(spans: readonly Span[], frame: number): Span[] {
  return spans.filter((s) => s.from <= frame).map((s) => ({ from: s.from, to: Math.min(s.to, frame) }));
}

/** A scale up to a limit far above the cost gives a flat curve. `base`: the cost of the parent of a Continued Run, which its limit does not count. */
export function spentScale(spent: number, limit: number | null, base = 0): { max: number; limitLine: boolean } {
  const limitLine = limit !== null && spent > limit / 2;
  return { max: Math.max(limitLine ? base + limit : 0, base + spent), limitLine };
}

export function hasModel(view: StatsView, limit: number | null): boolean {
  return limit !== null || view.calls.length > 0 || view.summaries.length > 0;
}

const SHORT_STAY = 10 * GBA_FPS;

// A stay of less than 10 s is a step over the border of an Area, not a visit (issue #60).
function withoutShortStays(raw: readonly AreaStay[]): AreaStay[] {
  const stays: AreaStay[] = [];
  for (const stay of raw) {
    const last = stays.at(-1);
    if (last && (stay.to - stay.from < SHORT_STAY || last.area === stay.area)) last.to = stay.to;
    else stays.push({ ...stay });
  }
  if (stays.length > 1 && stays[0].to - stays[0].from < SHORT_STAY) {
    stays[1].from = stays[0].from;
    stays.shift();
  }
  return stays;
}

// An Area with all its visits is a state of the panel: the shared range is only its first visit.
export type Scope =
  | { kind: "run" }
  | { kind: "chapter"; index: number }
  | { kind: "stay"; index: number }
  | { kind: "area"; area: string }
  | ({ kind: "range" } & Span)
  | { kind: "call"; index: number };

// The last chapter and the last stay end now, so they also match the shorter range of an earlier click.
function matches(spans: readonly Span[], range: Span): number {
  return spans.findIndex((s, i) => s.from === range.from && (s.to === range.to || (i === spans.length - 1 && range.to <= s.to)));
}

export function scopeOf(view: StatsView, { cursor, range }: Moment, area: string | null): Scope {
  if (range) {
    const visits = view.areas.filter((stay) => stay.area === area);
    if (visits.length > 1 && visits[0].from === range.from && visits[0].to === range.to) return { kind: "area", area: visits[0].area };
    const chapter = matches(view.chapters, range);
    if (chapter >= 0) return { kind: "chapter", index: chapter };
    const stay = matches(view.areas, range);
    if (stay >= 0) return { kind: "stay", index: stay };
    return { kind: "range", ...range };
  }
  if (cursor?.call != null && view.calls[cursor.call]) return { kind: "call", index: cursor.call };
  return { kind: "run" };
}

export function scopeSpans(view: StatsView, scope: Scope): Span[] {
  const span = ({ from, to }: Span) => ({ from, to });
  switch (scope.kind) {
    case "run":
      return [{ from: 0, to: view.now }];
    case "chapter":
      return [span(view.chapters[scope.index])];
    case "stay":
      return [span(view.areas[scope.index])];
    case "area":
      return view.areas.filter((stay) => stay.area === scope.area).map(span);
    case "range":
      return [span(scope)];
    case "call":
      return [callSpan(view, scope.index)];
  }
}

export function scopeText(view: StatsView, scope: Scope): { short: string; title: string; detail: string } {
  const [first] = scopeSpans(view, scope);
  switch (scope.kind) {
    case "run":
      return { short: "the Run", title: "Stats of the whole Run", detail: `${clock(0)} → ${clock(view.now)}` };
    case "chapter": {
      const { name } = view.chapters[scope.index];
      const open = scope.index === view.chapters.length - 1;
      return { short: name, title: `Stats of the chapter ${open ? name : `up to ${name}`}`, detail: spanText(first) };
    }
    case "stay": {
      const stay = view.areas[scope.index];
      const visits = view.areas.filter((s) => s.area === stay.area);
      const visit = visits.length > 1 ? `, visit ${visits.indexOf(stay) + 1} of ${visits.length}` : "";
      return { short: stay.area, title: `Stats of ${stay.area}${visit}`, detail: spanText(first) };
    }
    case "area": {
      const visits = scopeSpans(view, scope);
      const frames = visits.reduce((sum, s) => sum + s.to - s.from, 0);
      return { short: scope.area, title: `Stats of ${scope.area}, all ${visits.length} visits`, detail: `${clock(frames)} in total` };
    }
    case "range":
      return { short: "the selection", title: "Stats of the selection", detail: spanText(first) };
    case "call": {
      const last = !view.calls.some((c) => c.frame > first.from);
      return { short: "this call", title: `Stats of the Model call at ${clock(first.from)}`, detail: `up to ${last ? "now" : "the next call"}, ${clock(first.to)}` };
    }
  }
}

const ZOOM_MARGIN = 0.08;
const MIN_MARGIN = 30 * GBA_FPS;

/** The frames of the graphs: the played Run, a zoom on the selection with darker margins, or the 2 h before the cursor. `zooms`: the scope is a selection that the graphs zoom on. */
export type GraphWindow = { kind: "run" | "zoom" | "last"; extent: Span; zooms: boolean };

// A picked Model call does not zoom: a click in a chart must not move the chart.
export function graphWindow(scope: Scope, spans: readonly Span[], last: Span | null, end: number): GraphWindow {
  const played = upTo(spans, end);
  const zooms = scope.kind !== "run" && scope.kind !== "call" && played.length > 0;
  if (last) return { kind: "last", extent: last, zooms };
  if (!zooms) return { kind: "run", extent: { from: 0, to: end }, zooms };
  const { from, to } = hull(played);
  const margin = Math.max((to - from) * ZOOM_MARGIN, MIN_MARGIN);
  return { kind: "zoom", extent: { from: Math.max(0, from - margin), to: Math.min(end, to + margin) }, zooms };
}

export function windowText({ kind, extent, zooms }: GraphWindow, spans: readonly Span[], short: string): string {
  switch (kind) {
    case "run":
      return "The whole Run · click a chapter or an Area to zoom on it";
    case "zoom":
      return `Zoom on ${short}, with a little before and after (darker)`;
    case "last": {
      const range = `${clock(extent.from)} → ${clock(extent.to)}`;
      if (!zooms) return range;
      const lit = spans.some((s) => s.to >= extent.from && s.from <= extent.to);
      return `${range} · ${short} is ${lit ? "lit" : "outside this window"}`;
    }
  }
}
