// Follows OptMem: https://github.com/rafmyr/OptMem
import type { NodeRange, Prompt, RunEvent } from "../harness/record";
import { MAX_SENTENCE, readJson } from "./decision";

export type MemoryTree = { notes: string[]; summaries: Map<string, string> };

export type MemoryNode = NodeRange & { text: string };

export function summarySchema(node: NodeRange): object {
  return {
    type: "object",
    properties: { summary: { type: "string", description: `The summary of the two parts, ${summaryRule(node)}.` } },
    required: ["summary"],
    additionalProperties: false,
  };
}

const SUMMARY_SYSTEM = `You keep the memory of a player of Pokémon FireRed. The memory is the list of the notes that the player wrote, oldest first. Two neighbour parts of the memory get one summary, and the player then sees the summary in place of the two parts.`;

export function memoryTree(events: readonly RunEvent[]): MemoryTree {
  const tree: MemoryTree = { notes: newNotes(events).map(({ note }) => note), summaries: new Map() };
  for (const event of events) {
    if (event.type === "summary" && event.summary !== null) tree.summaries.set(key(event), event.summary);
  }
  return tree;
}

export type NewNote = { note: string; call: number; frame: number };

export function newNotes(events: readonly RunEvent[]): NewNote[] {
  const notes: NewNote[] = [];
  let call = -1;
  for (const event of events) {
    if (event.type !== "model") continue;
    call++;
    if (event.decision && isNewNote(event.decision.note, notes.at(-1)?.note)) notes.push({ note: event.decision.note, call, frame: event.frame });
  }
  return notes;
}

// The answer after viewAtlas or zoom can give the same note again.
export function isNewNote(note: string, last: string | undefined): boolean {
  return note !== "" && note !== last;
}

export function nodeName({ from, to }: NodeRange): string {
  return from === to ? `#${from}` : `#${from}-${to}`;
}

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

export function topNodes(tree: MemoryTree): MemoryNode[] {
  return tops(tree.notes.length).flatMap((node) => shown(tree, node));
}

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

export function summaryPrompt(tree: MemoryTree, node: NodeRange): Prompt {
  const parts = halves(node).flatMap((half) => shown(tree, half)).map(nodeLine);
  return {
    system: SUMMARY_SYSTEM,
    user: [
      `Write the summary of these two parts of the memory, ${summaryRule(node)}. Keep the facts that help to play: places, people, items, and what works or does not work. When a later note makes a fact false or ends it, drop this fact and keep the later one.`,
      "",
      ...parts,
      "",
      'Answer with JSON: {"summary": "..."}.',
    ].join("\n"),
  };
}

export function readSummary(content: string, node: NodeRange): string {
  const value = readJson(content);
  const summary = typeof value === "object" && value !== null ? (value as Record<string, unknown>).summary : undefined;
  if (typeof summary !== "string" || summary.trim() === "") throw new Error('the answer has no "summary"');
  return cut(summary.trim(), summaryLimit(node));
}

function cut(text: string, limit: number): string {
  if (text.length <= limit) return text;
  const sentences = text.slice(0, limit + 1).match(/^.*[.!?](?=\s)/s);
  if (sentences) return sentences[0];
  const space = text.lastIndexOf(" ", limit);
  return text.slice(0, space > 0 ? space : limit).trimEnd();
}

// The limit grows with the logarithm of the number of notes: it is the same for the prompt, the schema and the cut.
function summaryRule(node: NodeRange): string {
  return `newest facts first, in short sentences, in one line of ${summaryLimit(node)} characters at most`;
}

function summaryLimit({ from, to }: NodeRange): number {
  return MAX_SENTENCE * (Math.log2(to - from + 1) + 1);
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

function isNode(tree: MemoryTree, { from, to }: NodeRange): boolean {
  const size = to - from + 1;
  return Number.isInteger(from) && Number.isInteger(to) && from >= 1 && to <= tree.notes.length && size >= 1 && (size & (size - 1)) === 0 && (from - 1) % size === 0;
}

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
