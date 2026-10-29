import type { Prompt, RunEvent, SummaryEvent } from "../src/harness/record";
import { type MemoryNode, memoryTree, type NewNote, newNotes, nodeLine, nodeName, topNodes, zoomNodes } from "../src/model/memory-tree";
import type { Cursor, Span } from "./cursor";

export type SummaryCallRow = {
  id: number;
  frame: number;
  node: string;
  result: string;
  failed: boolean;
  cost: number;
  latencyMs: number;
  promptTokens: number;
  completionTokens: number;
  prompt: Prompt;
  answer: string;
};

export type TreeNode = {
  name: string;
  line: string;
  text: string;
  size: number;
  top: boolean;
  inSelection: boolean;
  note: NewNote | null;
  call: SummaryCallRow | null;
  failed: SummaryCallRow[];
  halves: TreeNode[];
};

// unmade: the failed Summary calls at the cursor of a node that no call made yet, so the node is not in the tree.
export type MemoryPanelView = {
  notes: number;
  tops: TreeNode[];
  unmade: Map<string, SummaryCallRow[]>;
  calls: SummaryCallRow[];
  selection: boolean;
  cost: number;
  failed: number;
};

export type Focus = { kind: "tops" } | { kind: "node"; path: TreeNode[] } | { kind: "unmade"; name: string; failed: SummaryCallRow[] };

export function memoryPanelView(all: readonly RunEvent[], cursor: Cursor | null = null, range: Span | null = null): MemoryPanelView {
  const events = eventsAt(all, cursor);
  const tree = memoryTree(events);
  const notes = newNotes(events);
  const atCursor = summaryCalls(events);
  const tries = Map.groupBy(atCursor, (call) => call.node);
  const calls = range ? summaryCalls(all).filter((call) => call.frame >= range.from && call.frame <= range.to) : atCursor;
  const selected = new Set(range ? calls.map((call) => call.id) : []);
  const node = (memory: MemoryNode, top: boolean): TreeNode => {
    const name = nodeName(memory);
    const own = tries.get(name) ?? [];
    tries.delete(name);
    const call = own.find((t) => !t.failed) ?? null;
    return {
      name,
      line: nodeLine(memory),
      text: memory.text,
      size: memory.to - memory.from + 1,
      top,
      inSelection: call !== null && selected.has(call.id),
      note: memory.from === memory.to ? (notes[memory.from - 1] ?? null) : null,
      call,
      failed: own.filter((t) => t.failed),
      halves: (zoomNodes(tree, memory) ?? []).map((half) => node(half, false)),
    };
  };
  const tops = topNodes(tree).map((top) => node(top, true));
  return {
    notes: tree.notes.length,
    tops,
    unmade: tries,
    calls,
    selection: range !== null,
    cost: calls.reduce((sum, call) => sum + call.cost, 0),
    failed: calls.filter((call) => call.failed).length,
  };
}

export function focusOn(view: MemoryPanelView, name: string | null): Focus {
  if (name === null) return { kind: "tops" };
  const path = nodePath(view.tops, name);
  if (path.length > 0) return { kind: "node", path };
  const failed = view.unmade.get(name);
  return failed ? { kind: "unmade", name, failed } : { kind: "tops" };
}

function nodePath(tops: readonly TreeNode[], name: string): TreeNode[] {
  for (const top of tops) {
    if (top.name === name) return [top];
    const below = nodePath(top.halves, name);
    if (below.length > 0) return [top, ...below];
  }
  return [];
}

// At a picked call, keep the Summary calls that its note started: they come after it, before the next Model call.
function eventsAt(events: readonly RunEvent[], cursor: Cursor | null): readonly RunEvent[] {
  if (!cursor) return events;
  const { frame, call } = cursor;
  if (call === null) return events.filter((event) => event.frame <= frame);
  let calls = 0;
  for (let i = 0; i < events.length; i++) {
    if (events[i].type !== "model") continue;
    if (calls > call) return events.slice(0, i);
    calls++;
  }
  return events;
}

// An id is the same at the cursor and in the whole Run: the events at the cursor are a prefix of the events.
function summaryCalls(events: readonly RunEvent[]): SummaryCallRow[] {
  return events
    .filter((e): e is SummaryEvent => e.type === "summary")
    .map(callRow)
    .reverse();
}

function callRow(call: SummaryEvent, id: number): SummaryCallRow {
  return {
    id,
    frame: call.frame,
    node: nodeName(call),
    result: call.summary ?? call.error,
    failed: call.summary === null,
    cost: call.usage.cost,
    latencyMs: call.latencyMs,
    promptTokens: call.usage.promptTokens,
    completionTokens: call.usage.completionTokens,
    prompt: call.prompt,
    answer: call.answer ?? `(no answer: ${call.error})`,
  };
}
