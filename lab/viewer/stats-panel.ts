import type { Areas, Milestone } from "../src/game";
import type { ActionResult } from "../src/harness/harness";
import type { Continuation, RunEvent } from "../src/harness/record";
import { MODEL_ACTION_NAMES } from "../src/model/decision";
import { isNewNote } from "../src/model/memory-tree";
import { actionText, type ShownRun } from "../src/protocol";
import { card, element, line, rows, showTooltip } from "./dom";
import { dollars, runKey } from "./runs";
import { type AxisScale, axisScale, clock, lanesSvg, stuckLevel, tokens } from "./stats-lanes";

type Count = { name: string; count: number };

export type Call = {
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

export type Span = { from: number; to: number };

type AreaStay = Span & { area: string; order: number };

type MapStay = AreaStay & { map: string; place: string | null };

export type StatsOptions = { now: number; areas: Areas; continued: Continuation | null };

export type StatsView = {
  now: number;
  calls: Call[];
  played: Played[];
  summaries: { frame: number }[];
  costSteps: { frame: number; cost: number }[];
  cost: number;
  battles: Span[];
  chapters: (Span & { milestone: Milestone | null })[];
  areas: AreaStay[];
  maps: MapStay[];
  /** For a Continued Run: its first frame, and the cost of its parent, which its cost limit does not count. */
  parentEnd: { frame: number; cost: number } | null;
};

export function statsView(events: readonly RunEvent[], { now, areas, continued }: StatsOptions): StatsView {
  const view: StatsView = { now, calls: [], played: [], summaries: [], costSteps: [], cost: 0, battles: [], chapters: [], areas: [], maps: [], parentEnd: null };
  const visited: string[] = [];
  let battle: Span | null = null;
  let chapter = 0;
  let lastNote: string | undefined;
  events.forEach((event, i) => {
    if (continued && i === continued.events) view.parentEnd = { frame: continued.frame, cost: view.cost };
    if ("usage" in event) {
      view.cost += event.usage.cost;
      view.costSteps.push({ frame: event.frame, cost: view.cost });
    }
    switch (event.type) {
      case "map": {
        const { area, place } = areas[event.map] ?? { area: event.map, place: null };
        if (!visited.includes(area)) visited.push(area);
        const last = view.maps.at(-1);
        if (last) last.to = event.frame;
        view.maps.push({ map: event.map, area, place, order: visited.indexOf(area), from: event.frame, to: now });
        break;
      }
      case "battle":
        if (event.state === "start") {
          battle = { from: event.frame, to: now };
          view.battles.push(battle);
        } else if (battle) {
          battle.to = event.frame;
          battle = null;
        }
        break;
      case "milestone":
        view.chapters.push({ milestone: event.milestone, from: chapter, to: event.frame });
        chapter = event.frame;
        break;
      case "model": {
        const { decision } = event;
        view.calls.push({
          index: view.calls.length,
          frame: event.frame,
          situation: event.situation,
          stuck: event.stuck ?? null,
          reflection: event.reflection ?? false,
          prompt: event.usage?.promptTokens || null,
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
  if (continued && !view.parentEnd) view.parentEnd = { frame: continued.frame, cost: view.cost };
  view.chapters.push({ milestone: null, from: chapter, to: now });
  view.areas = view.maps.reduce<AreaStay[]>((stays, { area, order, from, to }) => {
    const last = stays.at(-1);
    if (last?.area === area) last.to = to;
    else stays.push({ area, order, from, to });
    return stays;
  }, []);
  return view;
}

function actionName(action: string): string {
  const word = action.trim().split(/\s+/)[0];
  return MODEL_ACTION_NAMES.find((name) => name.toLowerCase() === word.toLowerCase()) ?? word;
}

type Selection = ({ kind: "range" } & Span) | { kind: "call"; index: number };

type Selected = Span & {
  calls: Call[];
  played: Played[];
  summaries: { frame: number }[];
  cost: number;
  notes: number;
  stuck: { end: number; max: number } | null;
  reflections: number;
  prompt: { min: number; max: number } | null;
  actions: Count[];
  impossible: Count[];
  unreadable: Count[];
};

function selectionSpan(view: StatsView, selection: Selection | null): Span {
  if (selection?.kind === "range") return selection;
  const call = selection && view.calls[selection.index];
  if (!call) return { from: 0, to: view.now };
  const next = view.calls.find((c) => c.frame > call.frame);
  return { from: call.frame, to: next ? next.frame - 1 : view.now };
}

export function selected(view: StatsView, selection: Selection | null): Selected {
  const { from, to } = selectionSpan(view, selection);
  const inside = ({ frame }: { frame: number }) => frame >= from && frame <= to;
  const calls = view.calls.filter(inside);
  const played = view.played.filter(inside);
  const summaries = view.summaries.filter(inside);
  const stucks = calls.flatMap((c) => (c.stuck === null ? [] : [c.stuck]));
  const prompts = calls.flatMap((c) => (c.prompt === null ? [] : [c.prompt]));
  const chosen = counts(calls.flatMap((c) => (c.answer.kind === "action" ? [c.answer.name] : [])));
  return {
    from,
    to,
    calls,
    played,
    summaries,
    cost: costAt(view, to) - costAt(view, from - 1),
    notes: calls.filter((c) => c.note).length,
    stuck: stucks.length > 0 ? { end: stucks[stucks.length - 1], max: Math.max(...stucks) } : null,
    reflections: calls.filter((c) => c.reflection).length,
    prompt: prompts.length > 0 ? { min: Math.min(...prompts), max: Math.max(...prompts) } : null,
    actions: MODEL_ACTION_NAMES.map((name) => ({ name, count: chosen.find((c) => c.name === name)?.count ?? 0 })).sort((a, b) => b.count - a.count),
    impossible: counts(played.flatMap((p) => (p.status === "impossible" ? [withoutNumbers(`${p.name}: ${p.reason}`)] : []))),
    unreadable: counts(calls.flatMap((c) => (c.answer.kind === "unreadable" ? [withoutNumbers(c.answer.error)] : []))),
  };
}

function costAt(view: StatsView, frame: number): number {
  return view.costSteps.findLast((s) => s.frame <= frame)?.cost ?? 0;
}

function withoutNumbers(text: string): string {
  return text.replace(/-?\d+/g, "#");
}

function counts(names: string[]): Count[] {
  const map = new Map<string, number>();
  for (const name of names) map.set(name, (map.get(name) ?? 0) + 1);
  return [...map].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count);
}

function pointLines(view: StatsView, frame: number, near: number): string[] {
  if (frame > view.now) return [`frame ${frame} (${clock(frame)}): not played yet`];
  const stuck = view.calls.findLast((c) => c.frame <= frame)?.stuck ?? null;
  const stay = view.maps.findLast((m) => m.from <= frame);
  const facts = [`frame ${frame} (${clock(frame)})`, `cost so far ${dollars(costAt(view, frame))}`];
  if (stuck !== null) facts.push(`Stuck counter ${stuck}`);
  if (stay) facts.push(stay.place ? `${stay.area}, ${stay.place}` : stay.area);
  const lines = [facts.join(" · ")];
  const distance = (item: { frame: number }) => Math.abs(item.frame - frame);
  const nearest = view.calls.filter((c) => distance(c) <= near).sort((a, b) => distance(a) - distance(b))[0];
  if (nearest) lines.push(nearest.answer.kind === "action" ? `Model call: ${nearest.situation} → ${nearest.answer.text}` : `unreadable answer: ${nearest.answer.error}`);
  for (const p of view.played.filter((p) => p.status !== "done" && distance(p) <= near).slice(0, 3)) lines.push(`${p.status}: ${p.text} · ${p.reason}`);
  return lines;
}

export type StatsPanelElements = { cost: HTMLElement; body: HTMLElement; tooltip: HTMLElement };

type Shown = { key: string; replayFrames: number | null; costLimit: number | null; continued: Continuation | null };

function shownOf(shown: ShownRun): Shown {
  const key = runKey(shown);
  if (shown.kind === "bot") return { key, replayFrames: null, costLimit: shown.run.model?.costLimit ?? null, continued: shown.run.continued };
  const { replay } = shown;
  return { key, replayFrames: replay?.frames ?? null, costLimit: replay?.model?.costLimit ?? null, continued: replay?.continued ?? null };
}

const EVENT_REDRAW_MS = 250;
const FRAME_REDRAW_MS = 1000;
const DRAG_PIXELS = 4;
const NEAR_PIXELS = 6;
const MAX_CALL_ROWS = 400;

export class StatsPanel {
  #events: readonly RunEvent[] = [];
  #areas: Areas = {};
  #shown: Shown = { key: "", replayFrames: null, costLimit: null, continued: null };
  #frame = 0;
  #selection: Selection | null = null;
  #view: StatsView | null = null;
  #scale: AxisScale = axisScale(0, 1);
  #dragStart: number | null = null;
  #mouseX: number | null = null;
  #drawnAt = 0;
  #timer: ReturnType<typeof setTimeout> | null = null;
  #due = 0;
  readonly #lanes = element("div", "", "stats-lanes");
  readonly #readout = element("div", "", "stats-readout mono");
  readonly #head = element("div", "", "stats-head");
  readonly #cards = element("div", "", "stats-cards");

  constructor(private readonly ui: StatsPanelElements) {
    ui.body.replaceChildren(this.#lanes, this.#readout, this.#head, this.#cards);
    this.#lanes.addEventListener("mousedown", (event) => this.onDown(event));
    this.#lanes.addEventListener("mousemove", (event) => this.onMove(event));
    this.#lanes.addEventListener("mouseleave", () => {
      this.#mouseX = null;
      this.#readout.replaceChildren();
      showTooltip(ui.tooltip, null, 0, 0);
    });
    document.addEventListener("mouseup", (event) => this.onUp(event));
    window.addEventListener("blur", () => {
      if (this.#dragStart === null) return;
      this.#dragStart = null;
      this.draw();
    });
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && this.#selection) this.select(null);
    });
    // Draw in the next animation frame: a draw in the observer can change the scroll bar, and so the width, and the browser reports a loop.
    new ResizeObserver(() => requestAnimationFrame(() => ui.body.clientWidth !== this.#scale.width && this.draw())).observe(ui.body);
  }

  onAreas(areas: Areas): void {
    this.#areas = areas;
    this.draw();
  }

  onEvents(events: readonly RunEvent[]): void {
    // A replay that starts again sends fewer events, with the same name.
    const restarted = events.length < this.#events.length;
    this.#events = events;
    if (restarted) this.select(null);
    else this.drawWithin(EVENT_REDRAW_MS);
  }

  onStatus(frame: number, shown: ShownRun): void {
    const next = shownOf(shown);
    const old = this.#shown;
    const otherRun = next.key !== old.key;
    const changed = next.replayFrames !== old.replayFrames || next.costLimit !== old.costLimit || next.continued?.frame !== old.continued?.frame || next.continued?.events !== old.continued?.events;
    this.#shown = next;
    const moved = frame !== this.#frame;
    this.#frame = frame;
    if (otherRun) this.select(null);
    else if (changed) this.draw();
    else if (moved) this.drawWithin(FRAME_REDRAW_MS);
  }

  private select(selection: Selection | null): void {
    this.#selection = selection;
    this.draw();
  }

  private drawWithin(ms: number): void {
    const due = this.#drawnAt + ms;
    if (this.#timer !== null && this.#due <= due) return;
    if (this.#timer !== null) clearTimeout(this.#timer);
    this.#due = due;
    this.#timer = setTimeout(() => this.draw(), Math.max(0, due - performance.now()));
  }

  private draw(): void {
    if (this.#timer !== null) clearTimeout(this.#timer);
    this.#timer = null;
    // A new event during a drag would delete the selection in progress.
    if (this.#dragStart !== null) return;
    this.#drawnAt = performance.now();
    const now = Math.max(this.#frame, this.#events.at(-1)?.frame ?? 0);
    const view = statsView(this.#events, { now, areas: this.#areas, continued: this.#shown.continued });
    const part = selected(view, this.#selection);
    const width = this.ui.body.clientWidth;
    this.#view = view;
    this.#scale = axisScale(width, Math.max(1, now, this.#shown.replayFrames ?? 0));
    this.ui.cost.textContent = `${view.calls.length} Model calls · ${dollars(view.cost)}`;
    this.#lanes.innerHTML = lanesSvg({ view, scale: this.#scale, played: now, costLimit: this.#shown.costLimit, selection: this.#selection && part });
    if (this.#mouseX !== null) this.follow(this.#mouseX);
    this.#head.replaceChildren(...this.head(view, part));
    this.#cards.replaceChildren(actionsCard(part), problemsCard(part), callsCard(part));
  }

  private head(view: StatsView, part: Selected): Node[] {
    const nodes: Node[] = [element("b", this.selectionLabel(view, part))];
    const add = (...items: Node[]) => nodes.push(document.createTextNode(" · "), ...items);
    add(element("span", `${part.calls.length} Model calls`));
    add(element("span", dollars(part.cost)));
    add(element("span", `${part.played.length} played actions`));
    add(element("span", `${part.impossible.reduce((sum, c) => sum + c.count, 0)} impossible`, "bad"));
    add(element("span", `${part.unreadable.reduce((sum, c) => sum + c.count, 0)} unreadable`));
    add(element("span", `${part.summaries.length} Summary calls`));
    add(element("span", `${part.notes} notes`));
    if (part.stuck) add(pill(`Stuck counter ${part.stuck.end}`, part.stuck.end), element("span", ` max ${part.stuck.max}`, `stuck-text ${stuckLevel(part.stuck.max)}`));
    if (part.stuck) add(element("span", `${part.reflections} Reflection turns`, "violet"));
    if (part.prompt) add(element("span", `prompt ${tokens(part.prompt.min)} to ${tokens(part.prompt.max)} tokens`, "blue"));
    if (this.#selection) {
      const all = element("button", "select all");
      all.addEventListener("click", () => this.select(null));
      nodes.push(document.createTextNode(" "), all);
    }
    return nodes;
  }

  private selectionLabel(view: StatsView, part: Selected): string {
    const selection = this.#selection;
    const call = selection?.kind === "call" ? view.calls[selection.index] : undefined;
    if (call) return `Model call at ${clock(call.frame)}: ${call.situation}`;
    return `${selection ? "" : "the whole Run: "}${clock(part.from)} → ${clock(part.to)}`;
  }

  private xOf(event: MouseEvent): number {
    return event.clientX - this.#lanes.getBoundingClientRect().left;
  }

  private follow(x: number): void {
    const cross = this.#lanes.querySelector(".cross");
    cross?.setAttribute("x1", String(this.#scale.clamp(x)));
    cross?.setAttribute("x2", String(this.#scale.clamp(x)));
    if (!this.#view || this.#dragStart !== null) return;
    const near = this.#scale.frame(this.#scale.clamp(0) + NEAR_PIXELS);
    this.#readout.replaceChildren(...pointLines(this.#view, this.#scale.frame(x), near).map((text) => element("div", text)));
  }

  private onDown(event: MouseEvent): void {
    if (event.button !== 0 || !this.#view) return;
    event.preventDefault();
    this.#dragStart = this.xOf(event);
  }

  private onMove(event: MouseEvent): void {
    const target = (event.target as Element).closest("[data-tip]");
    showTooltip(this.ui.tooltip, target?.getAttribute("data-tip") ?? null, event.clientX, event.clientY);
    if (this.#dragStart !== null && event.buttons === 0) return this.onUp(event);
    const x = this.xOf(event);
    this.#mouseX = x;
    this.follow(x);
    if (this.#dragStart !== null) {
      const [from, to] = [this.#scale.clamp(this.#dragStart), this.#scale.clamp(x)].sort((a, b) => a - b);
      const rect = this.#lanes.querySelector(".selection");
      rect?.setAttribute("x", String(from));
      rect?.setAttribute("width", String(to - from));
    }
  }

  private onUp(event: MouseEvent): void {
    const start = this.#dragStart;
    if (start === null || !this.#view) return;
    this.#dragStart = null;
    const x = this.xOf(event);
    if (Math.abs(x - start) < DRAG_PIXELS) {
      const frame = this.#scale.frame(x);
      const call = this.#view.calls.findLast((c) => c.frame <= frame);
      return this.select(call ? { kind: "call", index: call.index } : null);
    }
    const [from, to] = [this.#scale.frame(start), this.#scale.frame(x)].sort((a, b) => a - b);
    this.select({ kind: "range", from, to });
  }
}

function pill(text: string, stuck: number): HTMLElement {
  return element("span", text, `pill ${stuckLevel(stuck)}`);
}

function actionsCard(part: Selected): HTMLElement {
  const max = Math.max(1, ...part.actions.map((a) => a.count));
  const bars = part.actions.map(({ name, count }) => {
    const row = element("div", "", count === 0 ? "bar-row never" : "bar-row");
    const track = element("div", "", "track");
    const bar = element("div", "");
    bar.style.width = `${(100 * count) / max}%`;
    track.append(bar);
    row.append(element("span", name), track, element("span", String(count), "mono"));
    return row;
  });
  return card("Actions chosen", ...bars);
}

function problemsCard(part: Selected): HTMLElement {
  const grouped = (groups: Count[]) => rows(groups.map((g) => [`${g.count}×`, g.name]));
  return card("Impossible actions", grouped(part.impossible), element("h3", "Unreadable answers"), grouped(part.unreadable));
}

function callsCard(part: Selected): HTMLElement {
  const table = document.createElement("table");
  const shownCalls = new Set(part.calls.map((c) => c.index));
  const alone = part.played.filter((p) => p.call === null || !shownCalls.has(p.call));
  const items = [...alone, ...part.calls.flatMap((call) => [call, ...part.played.filter((p) => p.call === call.index)])];
  for (const item of items.slice(0, MAX_CALL_ROWS)) {
    const row = table.insertRow();
    if ("answer" in item) callRow(row, item);
    else playedRow(row, item);
  }
  const more = items.length > MAX_CALL_ROWS ? [line(`+ ${items.length - MAX_CALL_ROWS} more rows: select a smaller range`)] : [];
  return card("Model calls and their actions", items.length > 0 ? table : line("–"), ...more);
}

function callRow(row: HTMLTableRowElement, call: Call): void {
  const when = row.insertCell();
  when.append(element("span", clock(call.frame), "mono"));
  if (call.stuck !== null) when.append(document.createTextNode(" "), pill(String(call.stuck), call.stuck));
  if (call.reflection) when.append(element("div", "reflection", "violet"));
  row.insertCell().textContent = call.situation;
  const answer = row.insertCell();
  if (call.answer.kind === "action") answer.textContent = call.answer.text;
  else answer.append(element("span", call.answer.error, "bad"));
}

function playedRow(row: HTMLTableRowElement, played: Played): void {
  row.className = "played";
  row.insertCell().textContent = clock(played.frame);
  row.insertCell().append(element("span", `↳ ${played.status}`, played.status));
  row.insertCell().textContent = played.reason ? `${played.text} · ${played.reason}` : played.text;
}
