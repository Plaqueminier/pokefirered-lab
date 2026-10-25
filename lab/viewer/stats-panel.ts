import type { Milestone } from "../src/game";
import type { RunEvent } from "../src/harness/record";
import type { ModelAction } from "../src/model/decision";
import { actionLabel } from "./replay";
import { dollars } from "./runs";

// A Record and not a list: the type check fails when a new action of the model bot is not here.
const ACTION_LIST: Record<ModelAction["name"], true> = {
  go: true,
  goTo: true,
  swap: true,
  choose: true,
  fight: true,
  switch: true,
  send: true,
  run: true,
  use: true,
  press: true,
  viewAtlas: true,
};
const ACTION_NAMES = Object.keys(ACTION_LIST);

export type Count = { name: string; count: number };

/** The calls and the cost from the Milestone before to this one. `milestone` is null for the calls after the last Milestone. */
export type MilestoneStats = { milestone: Milestone | null; calls: number; cost: number };

export type StatsView = {
  events: Count[];
  actions: Count[];
  neverUsed: string[];
  impossible: { frame: number; action: string; reason: string }[];
  unreadable: { frame: number; error: string }[];
  milestones: MilestoneStats[];
  cost: number;
};

/** The stats read only the events, so a new event type shows with no change. An event with a usage (a Model call or another call) counts in the cost. */
export function statsView(events: readonly RunEvent[]): StatsView {
  const types = new Map<string, number>();
  const used = new Map<string, number>();
  const view: StatsView = { events: [], actions: [], neverUsed: [], impossible: [], unreadable: [], milestones: [], cost: 0 };
  let open: MilestoneStats = { milestone: null, calls: 0, cost: 0 };
  for (const event of events) {
    increment(types, event.type);
    if ("usage" in event) {
      open.cost += event.usage.cost;
      view.cost += event.usage.cost;
    }
    if (event.type === "model") {
      open.calls++;
      if (event.decision) increment(used, actionName(event.decision.action));
      else view.unreadable.push({ frame: event.frame, error: event.error });
    } else if (event.type === "action" && event.result.status === "impossible") {
      view.impossible.push({ frame: event.frame, action: actionLabel(event), reason: event.result.reason });
    } else if (event.type === "milestone") {
      view.milestones.push({ ...open, milestone: event.milestone });
      open = { milestone: null, calls: 0, cost: 0 };
    }
  }
  if (open.calls > 0 || open.cost > 0) view.milestones.push(open);
  view.events = counts(types);
  view.actions = counts(used).sort((a, b) => b.count - a.count);
  view.neverUsed = ACTION_NAMES.filter((name) => !used.has(name));
  return view;
}

function actionName(action: string): string {
  const word = action.trim().split(/\s+/)[0];
  return ACTION_NAMES.find((name) => name.toLowerCase() === word.toLowerCase()) ?? word;
}

function increment(map: Map<string, number>, key: string): void {
  map.set(key, (map.get(key) ?? 0) + 1);
}

function counts(map: Map<string, number>): Count[] {
  return [...map].map(([name, count]) => ({ name, count }));
}

export type StatsPanelElements = { cost: HTMLElement; body: HTMLElement };

export class StatsPanel {
  #shown = "";

  constructor(private readonly ui: StatsPanelElements) {}

  onEvents(events: readonly RunEvent[]): void {
    const view = statsView(events);
    const key = JSON.stringify(view);
    if (key === this.#shown) return;
    this.#shown = key;
    const calls = view.milestones.reduce((sum, m) => sum + m.calls, 0);
    this.ui.cost.textContent = `${calls} Model calls · ${dollars(view.cost)}`;
    this.ui.body.replaceChildren(
      card("Calls by Milestone", rows(view.milestones.map((m) => [m.milestone ?? "not reached yet", `${m.calls} calls`, dollars(m.cost)]))),
      card("Actions", rows(view.actions.map((a) => [a.name, String(a.count)])), line(`never used: ${view.neverUsed.join(", ") || "–"}`)),
      card("Impossible", rows(view.impossible.map((a) => [String(a.frame), a.action, a.reason]))),
      card("Unreadable answers", rows(view.unreadable.map((a) => [String(a.frame), a.error]))),
      card("Events", rows(view.events.map((e) => [e.name, String(e.count)]))),
    );
  }
}

function card(title: string, ...content: HTMLElement[]): HTMLElement {
  const section = document.createElement("div");
  section.className = "stats-card";
  const heading = document.createElement("h3");
  heading.textContent = title;
  section.append(heading, ...content);
  return section;
}

function rows(cells: string[][]): HTMLElement {
  if (cells.length === 0) return line("–");
  const table = document.createElement("table");
  for (const texts of cells) {
    const row = table.insertRow();
    for (const text of texts) row.insertCell().textContent = text;
  }
  return table;
}

function line(text: string): HTMLElement {
  const div = document.createElement("div");
  div.className = "muted";
  div.textContent = text;
  return div;
}
