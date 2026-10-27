import { describe, expect, test } from "bun:test";
import type { RunEvent } from "../harness/record";
import { dueMerges, memoryLines, memoryTree, readSummary, summaryPrompt, zoomLines } from "./memory-tree";

function call(note: string): RunEvent {
  return {
    type: "model",
    frame: 0,
    latencyMs: 1,
    model: "a/b",
    situation: "a walk",
    prompt: { system: "", user: "" },
    answer: "",
    usage: { promptTokens: 0, completionTokens: 0, reasoningTokens: 0, cost: 0 },
    decision: { reason: "", action: "go 1", mission: "", objective: "", note },
    error: null,
  };
}

function summary(from: number, to: number, text: string | null): RunEvent {
  const answer = text === null ? { summary: null, error: "the request failed" } : { summary: text, error: null };
  return { type: "summary", frame: 0, latencyMs: 1, model: "a/b", from, to, prompt: { system: "", user: "" }, answer: text, usage: { promptTokens: 0, completionTokens: 0, reasoningTokens: 0, cost: 0 }, ...answer };
}

function notes(count: number): { events: RunEvent[]; merges: string[] } {
  const events: RunEvent[] = [];
  const merges: string[] = [];
  for (let i = 1; i <= count; i++) {
    events.push(call(`note ${i}`));
    for (let due = dueMerges(memoryTree(events)); due.length > 0; due = dueMerges(memoryTree(events))) {
      const { from, to } = due[0];
      merges.push(`${from}-${to}`);
      events.push(summary(from, to, `summary ${from}-${to}`));
    }
  }
  return { events, merges };
}

describe("the Memory tree", () => {
  test("a merge is due when two neighbour nodes have the same size, as in a binary counter; an empty note adds nothing", () => {
    expect(dueMerges(memoryTree([call("note 1"), call("")]))).toEqual([]);
    expect(dueMerges(memoryTree([call("note 1"), call(""), call("note 2")]))).toEqual([{ from: 1, to: 2 }]);
    expect(notes(13).merges).toEqual(["1-2", "3-4", "1-4", "5-6", "7-8", "5-8", "1-8", "9-10", "11-12", "9-12"]);
  });

  test("after 13 notes, the prompt shows 3 top nodes: #1-8, #9-12 and #13", () => {
    expect(memoryLines(memoryTree(notes(13).events))).toEqual(["#1-8: summary 1-8", "#9-12: summary 9-12", "#13: note 13"]);
    expect(memoryLines(memoryTree([]))).toEqual([]);
  });

  test("a merge with no summary (the Summary call failed) stays due, and the prompt shows its two halves in its place", () => {
    const events = [call("note 1"), call("note 2"), summary(1, 2, null)];
    expect(dueMerges(memoryTree(events))).toEqual([{ from: 1, to: 2 }]);
    expect(memoryLines(memoryTree(events))).toEqual(["#1: note 1", "#2: note 2"]);
  });

  test("zoom shows the two halves of a node, down to the notes; a note or a range that is not a node has no halves", () => {
    const tree = memoryTree(notes(13).events);
    expect(zoomLines(tree, { from: 1, to: 8 })).toEqual(["#1-4: summary 1-4", "#5-8: summary 5-8"]);
    expect(zoomLines(tree, { from: 11, to: 12 })).toEqual(["#11: note 11", "#12: note 12"]);
    expect(zoomLines(tree, { from: 13, to: 13 })).toBeNull();
    expect(zoomLines(tree, { from: 3, to: 9 })).toBeNull();
    expect(zoomLines(tree, { from: 13, to: 14 })).toBeNull();
  });

  test("the summary prompt of a node of 4 notes gives 600 characters and asks for the newest facts first", () => {
    expect(summaryPrompt(memoryTree(notes(4).events), { from: 1, to: 4 }).user).toStartWith("Write the summary of these two parts of the memory, newest facts first, in short sentences, in one line of 600 characters at most.");
  });

  test("a too long summary is cut at the end of its last full sentence that fits", () => {
    const fits = `Got the Pokédex from Oak. ${"Viridian City is north of Pallet Town. ".repeat(9)}`.trim();
    expect(readSummary(JSON.stringify({ summary: `${fits} The old man in Viridian City blocks the north road.` }), { from: 1, to: 2 })).toBe(fits);
  });
});
