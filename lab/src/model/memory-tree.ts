// The Memory tree follows OptMem (https://github.com/rafmyr/OptMem): pair summaries in a binary tree, and a zoom that opens a node.
// Its state comes from the events of the Run only, so the Viewer and a replay build it again.
import type { NodeRange, Prompt, RunEvent } from "../harness/record";
import { MAX_SENTENCE } from "./decision";

/** notes: the notes in their order (the note n is notes[n - 1]). summaries: the summary of each node, by its range "a-b". */
export type MemoryTree = { notes: string[]; summaries: Map<string, string> };

export type MemoryNode = NodeRange & { text: string };

export const SUMMARY_SCHEMA = {
  type: "object",
  properties: { summary: { type: "string", description: `The summary of the two parts, in one line of ${MAX_SENTENCE} characters at most.` } },
  required: ["summary"],
  additionalProperties: false,
} as const;

const SUMMARY_SYSTEM = `You keep the memory of a player of Pokémon FireRed. The memory is the list of the notes that the player wrote, oldest first. Two neighbour parts of the memory get one summary, and the player then sees the summary in place of the two parts.`;

export function memoryTree(events: readonly RunEvent[]): MemoryTree {
  const tree: MemoryTree = { notes: [], summaries: new Map() };
  for (const event of events) {
    if (event.type === "summary" && event.summary !== null) tree.summaries.set(key(event), event.summary);
    if (event.type !== "model" || !event.decision || !("note" in event.decision)) continue;
    const { note } = event.decision;
    // The answer after viewAtlas or zoom can give the same note again.
    if (note !== "" && note !== tree.notes.at(-1)) tree.notes.push(note);
  }
  return tree;
}

export function nodeName({ from, to }: NodeRange): string {
  return from === to ? `#${from}` : `#${from}-${to}`;
}

/** The nodes that need a summary, in the order of a binary counter: each one has a text for its two halves. */
export function dueMerges(tree: MemoryTree): NodeRange[] {
  const due: NodeRange[] = [];
  for (let to = 2; to <= tree.notes.length; to++) {
    for (let size = 2; size <= to && to % size === 0; size *= 2) {
      const node = { from: to - size + 1, to };
      if (text(tree, node) === null && halves(node).every((half) => text(tree, half) !== null)) due.push(node);
    }
  }
  return due;
}

/** The top nodes as the prompt shows them. A node with no summary shows its two halves in its place. */
export function topNodes(tree: MemoryTree): MemoryNode[] {
  return tops(tree.notes.length).flatMap((node) => shown(tree, node));
}

/** The two halves of a node, as zoom shows them; null when the range is a note or not a node of the tree. */
export function zoomNodes(tree: MemoryTree, node: NodeRange): MemoryNode[] | null {
  if (!isNode(tree, node) || node.from === node.to) return null;
  return halves(node).flatMap((half) => shown(tree, half));
}

export function memoryLines(tree: MemoryTree): string[] {
  return topNodes(tree).map(nodeLine);
}

export function zoomLines(tree: MemoryTree, node: NodeRange): string[] | null {
  return zoomNodes(tree, node)?.map(nodeLine) ?? null;
}

/** The prompt of the Summary call of a due node. */
export function summaryPrompt(tree: MemoryTree, node: NodeRange): Prompt {
  const parts = halves(node).flatMap((half) => shown(tree, half)).map(nodeLine);
  return {
    system: SUMMARY_SYSTEM,
    user: [
      `Write the summary of these two parts of the memory, oldest first, in one line of ${MAX_SENTENCE} characters at most. Keep the facts that help to play: places, people, items, and what works or does not work. When two facts do not agree, keep the newest.`,
      "",
      ...parts,
      "",
      'Answer with JSON: {"summary": "..."}.',
    ].join("\n"),
  };
}

export function readSummary(content: string): string {
  let value: unknown;
  try {
    value = JSON.parse(content);
  } catch {
    throw new Error("the answer is not JSON");
  }
  const summary = typeof value === "object" && value !== null ? (value as Record<string, unknown>).summary : undefined;
  if (typeof summary !== "string" || summary.trim() === "") throw new Error('the answer has no "summary"');
  return summary.trim().slice(0, MAX_SENTENCE);
}

function key({ from, to }: NodeRange): string {
  return `${from}-${to}`;
}

export function nodeLine(node: MemoryNode): string {
  return `${nodeName(node)}: ${node.text}`;
}

function text(tree: MemoryTree, node: NodeRange): string | null {
  return node.from === node.to ? (tree.notes[node.from - 1] ?? null) : (tree.summaries.get(key(node)) ?? null);
}

function shown(tree: MemoryTree, node: NodeRange): MemoryNode[] {
  const known = text(tree, node);
  return known === null ? halves(node).flatMap((half) => shown(tree, half)) : [{ ...node, text: known }];
}

function halves({ from, to }: NodeRange): [NodeRange, NodeRange] {
  const middle = from + (to - from + 1) / 2;
  return [
    { from, to: middle - 1 },
    { from: middle, to },
  ];
}

// A node covers 2^k notes and starts after a multiple of 2^k notes.
function isNode(tree: MemoryTree, { from, to }: NodeRange): boolean {
  const size = to - from + 1;
  return Number.isInteger(from) && Number.isInteger(to) && from >= 1 && to <= tree.notes.length && size >= 1 && (size & (size - 1)) === 0 && (from - 1) % size === 0;
}

// The top nodes of n notes: one node for each bit of n, the largest first.
function tops(count: number): NodeRange[] {
  const nodes: NodeRange[] = [];
  let from = 1;
  for (let size = 2 ** Math.floor(Math.log2(Math.max(count, 1))); size >= 1; size /= 2) {
    if (from + size - 1 > count) continue;
    nodes.push({ from, to: from + size - 1 });
    from += size;
  }
  return nodes;
}
