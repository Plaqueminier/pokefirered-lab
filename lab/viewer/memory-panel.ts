import type { RunEvent, SummaryEvent } from "../src/harness/record";
import { type MemoryNode, type MemoryTree, memoryTree, nodeLine, nodeName, topNodes, zoomNodes } from "../src/model/memory-tree";
import { dollars } from "./runs";

export type OutlineNode = { name: string; line: string; halves: OutlineNode[] };

export type SummaryCallRow = { id: number; frame: number; node: string; result: string; failed: boolean; cost: string; time: string; prompt: string; answer: string };

export type MemoryPanelView = { notes: number; tops: OutlineNode[]; calls: SummaryCallRow[]; cost: number };

export function memoryPanelView(events: readonly RunEvent[]): MemoryPanelView {
  const tree = memoryTree(events);
  const summaries = events.filter((e): e is SummaryEvent => e.type === "summary");
  return {
    notes: tree.notes.length,
    tops: topNodes(tree).map((node) => outline(tree, node)),
    calls: summaries.map(callRow).reverse(),
    cost: summaries.reduce((sum, call) => sum + call.usage.cost, 0),
  };
}

function outline(tree: MemoryTree, node: MemoryNode): OutlineNode {
  return { name: nodeName(node), line: nodeLine(node), halves: (zoomNodes(tree, node) ?? []).map((half) => outline(tree, half)) };
}

function callRow(call: SummaryEvent, id: number): SummaryCallRow {
  return {
    id,
    frame: call.frame,
    node: nodeName(call),
    result: call.summary ?? call.error,
    failed: call.summary === null,
    cost: dollars(call.usage.cost),
    time: `${(call.latencyMs / 1000).toFixed(1)} s`,
    prompt: `${call.prompt.system}\n\n${call.prompt.user}`,
    answer: call.answer ?? "(no answer: the request failed)",
  };
}

export type MemoryPanelElements = { title: HTMLElement; outline: HTMLElement; calls: HTMLElement };

export class MemoryPanel {
  #shown = "";
  #count = 0;
  readonly #open = new Set<string>();

  constructor(private readonly ui: MemoryPanelElements) {}

  onEvents(events: readonly RunEvent[]): void {
    if (events.length < this.#count) this.#open.clear();
    this.#count = events.length;
    const view = memoryPanelView(events);
    const key = JSON.stringify(view);
    if (key === this.#shown) return;
    this.#shown = key;
    const failed = view.calls.filter((call) => call.failed).length;
    this.ui.title.textContent = [`${view.notes} notes`, `${view.calls.length} Summary calls`, dollars(view.cost), failed ? `${failed} failed` : ""].filter(Boolean).join(" · ");
    this.ui.outline.replaceChildren(...(view.tops.length ? view.tops.map((node) => this.outlineNode(node)) : [element("div", "no note yet", "muted")]));
    this.ui.calls.replaceChildren(view.calls.length ? this.callTable(view.calls) : element("div", "no Summary call yet", "muted"));
  }

  private outlineNode(node: OutlineNode): HTMLElement {
    const line = element("div", node.line, "memory-line");
    if (node.halves.length === 0) return line;
    const summary = element("summary", "");
    summary.append(line);
    return this.details(`node ${node.name}`, "memory-node", summary, ...node.halves.map((half) => this.outlineNode(half)));
  }

  private callTable(calls: SummaryCallRow[]): HTMLElement {
    const table = document.createElement("table");
    table.className = "memory-calls";
    const head = table.createTHead().insertRow();
    for (const title of ["frame", "node", "result", "cost", "time"]) head.append(element("th", title));
    const body = table.createTBody();
    for (const call of calls) {
      const row = body.insertRow();
      row.insertCell().textContent = String(call.frame);
      row.insertCell().textContent = call.node;
      const result = row.insertCell();
      const text = element("summary", call.result, call.failed ? "model-error" : "");
      result.append(this.details(`call ${call.id}`, "", text, element("pre", call.prompt, "model-pre"), element("pre", call.answer, "model-pre")));
      row.insertCell().textContent = call.cost;
      row.insertCell().textContent = call.time;
    }
    return table;
  }

  private details(key: string, className: string, summary: HTMLElement, ...content: HTMLElement[]): HTMLElement {
    const details = document.createElement("details");
    details.className = className;
    details.open = this.#open.has(key);
    details.addEventListener("toggle", () => (details.open ? this.#open.add(key) : this.#open.delete(key)));
    details.append(summary, ...content);
    return details;
  }
}

function element(tag: string, text: string, className?: string): HTMLElement {
  const node = document.createElement(tag);
  node.textContent = text;
  if (className) node.className = className;
  return node;
}
