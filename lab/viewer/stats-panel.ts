import type { Milestone } from "../src/game";
import type { RunEvent } from "../src/harness/record";
import { MODEL_ACTION_NAMES } from "../src/model/decision";
import { memoryTree } from "../src/model/memory-tree";
import { actionText } from "../src/protocol";
import { card, line, rows } from "./dom";
import { dollars } from "./runs";


export type Count = { name: string; count: number };

export type MilestoneStats = { milestone: Milestone | null; calls: number; cost: number };

export type StatsView = {
  events: Count[];
  actions: Count[];
  neverUsed: string[];
  impossible: { frame: number; action: string; reason: string }[];
  unreadable: { frame: number; error: string }[];
  milestones: MilestoneStats[];
  memory: { notes: number; summaryCalls: number };
  cost: number;
};

export function statsView(events: readonly RunEvent[]): StatsView {
  const types = new Map<string, number>();
  const used = new Map<string, number>();
  const view: StatsView = { events: [], actions: [], neverUsed: [], impossible: [], unreadable: [], milestones: [], memory: { notes: memoryTree(events).notes.length, summaryCalls: 0 }, cost: 0 };
  let open: MilestoneStats = { milestone: null, calls: 0, cost: 0 };
  for (const event of events) {
    increment(types, event.type);
    if (event.type === "summary") view.memory.summaryCalls++;
    if ("usage" in event) {
      open.cost += event.usage.cost;
      view.cost += event.usage.cost;
    }
    if (event.type === "model") {
      open.calls++;
      if (event.decision) increment(used, actionName(event.decision.action));
      else view.unreadable.push({ frame: event.frame, error: event.error });
    } else if (event.type === "action" && event.result.status === "impossible") {
      view.impossible.push({ frame: event.frame, action: actionText(event.action), reason: event.result.reason });
    } else if (event.type === "milestone") {
      view.milestones.push({ ...open, milestone: event.milestone });
      open = { milestone: null, calls: 0, cost: 0 };
    }
  }
  if (open.calls > 0 || open.cost > 0) view.milestones.push(open);
  view.events = counts(types);
  view.actions = counts(used).sort((a, b) => b.count - a.count);
  view.neverUsed = MODEL_ACTION_NAMES.filter((name) => !used.has(name));
  return view;
}

function actionName(action: string): string {
  const word = action.trim().split(/\s+/)[0];
  return MODEL_ACTION_NAMES.find((name) => name.toLowerCase() === word.toLowerCase()) ?? word;
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
      card("Memory tree", line(`${view.memory.notes} notes · ${view.memory.summaryCalls} Summary calls`)),
      card("Events", rows(view.events.map((e) => [e.name, String(e.count)]))),
    );
  }
}
