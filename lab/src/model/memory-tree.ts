// Follows OptMem: https://github.com/rafmyr/OptMem
import type { NodeRange, Prompt, NodeSentence, RunEvent } from "../harness/record";
import { MAX_SENTENCE, readJson } from "./decision";

export type MemoryTree = { notes: string[]; summaries: Map<string, string>; removed: string[] };

export type MemoryNode = NodeRange & { text: string };

export function summarySchema(node: NodeRange): object {
  return {
    type: "object",
    properties: { summary: { type: "string", description: `The summary of the two parts, ${summaryRule(node)}.` } },
    required: ["summary"],
    additionalProperties: false,
  };
}

const SENTENCE_END = /(?<!\b(?:Mt|Prof|Lt|St|Dr|Mr|Mrs|S\.S)\.)(?<=[.!?])\s+/i;
const STATE_VALUES = /\b\d+%?\s*(?:HP|PP)\b|\b(?:HP|PP)\s+(?:(?:is|at|of|to)\s+)?\(?\d|\b\d+\s*\/\s*\d{2,}\b/i;
// Run 00062 kept "Mt. Moon is crossed" for 1,192 prompts, while the Atlas still had unseen cells there.
const PLACE_CLAIMS = [
  /(?<!\bnot\s+)\b(?:fully|completely|entirely|all)\s+(?:explored|seen|searched|checked|crossed|looped)\b/i,
  /\b(?:is|are|was|were|been|has|have)\s+(?:now\s+|just\s+|already\s+)?(?:explored|crossed)\b/i,
  /\b(?:routes?|paths?|leads?|ways?|exits?|areas?)\s+(?:is|are|was|were)\s+exhausted\b/i,
  /(?<!\bnot\s+a\s+)\bdead[ -]?ends?\b/i,
  /\bloops?\s+back\b/i,
  /\bno\s+way\s+out\b|\bno\s+(?:exit|route)\s+to\b/i,
];
const HEDGE = /\b(might|may|maybe|likely|probably|perhaps|possibly|could be)\b/i;
const MARKED = /^(guess|a person said):/i;
const NO_NOTE = /^(empty( string)?|none|n\/a)\.?$/i;
const SAME_WORDS = 0.75;
const KEY_WORD = /\d|n['’]t$|^(not|no|never|cannot|guess)$/;
const RECENT_NOTES = 32;

const SUMMARY_SYSTEM = `You keep the memory of a player of Pokémon FireRed. The memory is the list of the notes that the player wrote, oldest first. Two neighbour parts of the memory get one summary, and the player then sees the summary in place of the two parts.`;

export function memoryTree(events: readonly RunEvent[]): MemoryTree {
  const tree: MemoryTree = { notes: newNotes(events).map(({ note }) => note), summaries: new Map(), removed: [] };
  for (const event of events) {
    if (event.type === "summary" && event.summary !== null) tree.summaries.set(key(event), event.summary);
    if (event.type === "model") {
      for (const { sentence, ...node } of event.removed ?? []) {
        removeSentence(tree, node, sentence);
        tree.removed.push(sentence);
      }
    }
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

// An old Run record can have the same note again after viewAtlas or zoom.
export function isNewNote(note: string, last: string | undefined): boolean {
  return note !== "" && note !== last;
}

// The Run record keeps the result: the summaries of an old record name its notes by number, so a later filter must not change them.
export function keptNote(written: string, { notes, removed }: Pick<MemoryTree, "notes" | "removed">): string {
  const note = cut(sentences(written).filter((sentence) => !STATE_VALUES.test(sentence) && keepsSentence(sentence, removed)).map(marked).join(" "), MAX_SENTENCE);
  return NO_NOTE.test(note) || notes.slice(-RECENT_NOTES).some((other) => sameFacts(note, other)) ? "" : note;
}

function isPlaceClaim(sentence: string): boolean {
  return !MARKED.test(sentence) && PLACE_CLAIMS.some((claim) => claim.test(sentence));
}

function keepsSentence(sentence: string, removed: readonly string[]): boolean {
  return !isPlaceClaim(sentence) && !removed.some((other) => sameFacts(sentence, other));
}

function keptSentences(text: string, keep: (sentence: string) => boolean): string {
  return sentences(text).filter(keep).join(" ");
}

function withoutPlaceClaims(node: MemoryNode): MemoryNode {
  return { ...node, text: keptSentences(node.text, (sentence) => !isPlaceClaim(sentence)) };
}

function promptNodes(nodes: MemoryNode[]): MemoryNode[] {
  return withText(nodes.map(withoutPlaceClaims));
}

function marked(sentence: string): string {
  return !MARKED.test(sentence) && HEDGE.test(sentence) ? `Guess: ${sentence}` : sentence;
}

// A number, a negation or the mark of a guess in only one of the two notes makes them two facts.
function sameFacts(a: string, b: string): boolean {
  const [first, second] = [a, b].map(words);
  const others = [...first.symmetricDifference(second)];
  return !others.some((word) => KEY_WORD.test(word)) && first.intersection(second).size / first.union(second).size >= SAME_WORDS;
}

function words(note: string): Set<string> {
  return new Set(note.toLowerCase().split(/[^\p{L}\p{N}'’]+/u).filter(Boolean));
}

function sentences(text: string): string[] {
  return text.split(SENTENCE_END).filter(Boolean);
}

function removeSentence(tree: MemoryTree, node: NodeRange, removed: string): void {
  const kept = text(tree, node);
  if (kept === null) return;
  const rest = keptSentences(kept, (sentence) => sentence !== removed);
  if (node.from === node.to) tree.notes[node.from - 1] = rest;
  else tree.summaries.set(key(node), rest);
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
  return promptNodes(topNodes(tree)).map(nodeLine);
}

export function reviewMemory(tree: MemoryTree): { lines: string[]; sentences: NodeSentence[] } {
  const numberedSentences: NodeSentence[] = [];
  const lines = promptNodes(topNodes(tree)).map((node) => {
    const numbered = sentences(node.text).map((sentence) => {
      numberedSentences.push({ from: node.from, to: node.to, sentence });
      return `[${numberedSentences.length}] ${sentence}`;
    });
    return `${nodeName(node)}: ${numbered.join(" ")}`;
  });
  return { lines, sentences: numberedSentences };
}

export function zoomLines(tree: MemoryTree, node: NodeRange): string[] | null {
  return zoomNodes(tree, node)?.map(withoutPlaceClaims).map(nodeLine) ?? null;
}

export function summaryPrompt(tree: MemoryTree, node: NodeRange): Prompt {
  const parts = promptNodes(halves(node).flatMap((half) => shown(tree, half))).map(nodeLine);
  return {
    system: SUMMARY_SYSTEM,
    user: [
      `Write the summary of these two parts of the memory, ${summaryRule(node)}. Keep the facts that help to play: places, people, items, and what works or does not work. When a later note makes a fact false or ends it, drop this fact and keep the later one. Keep "Guess:" before each guess. Do not write that a place is explored, crossed or a dead end: the program tells this.`,
      "",
      ...parts,
      "",
      'Answer with JSON: {"summary": "..."}.',
    ].join("\n"),
  };
}

export function readSummary(content: string, node: NodeRange, removed: readonly string[]): string {
  const value = readJson(content);
  const summary = typeof value === "object" && value !== null ? (value as Record<string, unknown>).summary : undefined;
  if (typeof summary !== "string" || summary.trim() === "") throw new Error('the answer has no "summary"');
  const kept = keptSentences(summary.trim(), (sentence) => keepsSentence(sentence, removed));
  if (kept === "") throw new Error("the summary has only sentences that the program removes");
  return cut(kept, summaryLimit(node));
}

function cut(text: string, limit: number): string {
  if (text.length <= limit) return text;
  const whole = text.slice(0, limit + 1).match(/^.*[.!?](?=\s)/s);
  if (whole) return whole[0];
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

export function nodeText(node: MemoryNode): string {
  return node.text || "(removed)";
}

export function nodeLine(node: MemoryNode): string {
  return `${nodeName(node)}: ${nodeText(node)}`;
}

function text(tree: MemoryTree, node: NodeRange): string | null {
  if (node.from === node.to) return tree.notes[node.from - 1] ?? null;
  const summary = tree.summaries.get(key(node));
  if (summary !== undefined) return summary;
  // Two halves with no sentence left need no Summary call.
  return halves(node).every((half) => {
    const known = text(tree, half);
    return known !== null && keptSentences(known, (sentence) => !isPlaceClaim(sentence)) === "";
  }) ? "" : null;
}

function withText(nodes: MemoryNode[]): MemoryNode[] {
  return nodes.filter((node) => node.text !== "");
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
