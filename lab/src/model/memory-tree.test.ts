import { describe, expect, test } from "bun:test";
import type { RunEvent } from "../harness/record";
import { dueMerges, keptNote, memoryLines, memoryTree, readSummary, reviewMemory, summaryPrompt, zoomLines } from "./memory-tree";

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

describe("the filter of the notes", () => {
  test.each([
    ["Coda at 12/23 HP after the battles.", [], ""],
    ["Vine Whip PP is 0.", [], ""],
    ["Vine Whip PP is low (1/10). Lesson: run from wild battles.", [], "Lesson: run from wild battles."],
    ["Struggle costs 1/4 of the damage.", [], "Struggle costs 1/4 of the damage."],
    ["Mt. Moon has stairs at (3,3).", [], "Mt. Moon has stairs at (3,3)."],
    ["Cave C at (4,9) leads to the gate.", ["cave c at (4, 9) leads to the gate"], ""],
    ["My sister is on 1F, not 2F. Go downstairs to talk to her.", ["My sister is in the living room on 1F, not on 2F. Go downstairs to talk to her."], ""],
    ["The Gym is not locked.", ["The Gym is locked."], "The Gym is not locked."],
    ["The Gym isn't locked.", ["The Gym is locked."], "The Gym isn't locked."],
    ["Cave C at (4,10) leads to the gate.", ["Cave C at (4,9) leads to the gate."], "Cave C at (4,10) leads to the gate."],
    ["The Gym is in the north.", ["Guess: the Gym is in the north."], "The Gym is in the north."],
    ["The Gym is locked. The exit is likely north.", [], "The Gym is locked. Guess: The exit is likely north."],
    ["Guess: the exit may be north.", [], "Guess: the exit may be north."],
    ["The Gym is locked. A person said: you may need a bike.", [], "The Gym is locked. A person said: you may need a bike."],
    ["PROF. OAK may help.", [], "Guess: PROF. OAK may help."],
    ["Empty string", [], ""],
  ] as [string, string[], string][])("%s", (written, earlier, kept) => {
    expect(keptNote(written, earlier)).toBe(kept);
  });
});

describe("the removal of sentences at a Review turn", () => {
  const removal = (from: number, to: number, ...sentences: string[]): RunEvent => ({ ...(call("") as RunEvent & { type: "model" }), removed: sentences.map((sentence) => ({ from, to, sentence })) });

  test("the top nodes show numbered sentences, in one count for all the nodes", () => {
    const events = [call("note 1"), call("note 2"), summary(1, 2, "Mt. Moon is east. The Gym is locked."), call("note 3")];
    expect(reviewMemory(memoryTree(events))).toEqual({
      lines: ["#1-2: [1] Mt. Moon is east. [2] The Gym is locked.", "#3: [3] note 3"],
      sentences: [
        { from: 1, to: 2, sentence: "Mt. Moon is east." },
        { from: 1, to: 2, sentence: "The Gym is locked." },
        { from: 3, to: 3, sentence: "note 3" },
      ],
    });
  });

  test("a removed sentence leaves its node and the next merge; a node with no sentence left has no line and no number", () => {
    const events = [call("note 1"), call("note 2"), summary(1, 2, "Use Tackle. The Gym is locked."), call("note 3"), call("note 4"), summary(3, 4, "Mom heals."), removal(1, 2, "Use Tackle.")];
    const tree = memoryTree(events);
    expect(memoryLines(tree)).toEqual(["#1-2: The Gym is locked.", "#3-4: Mom heals."]);
    expect(summaryPrompt(tree, { from: 1, to: 4 }).user).not.toContain("Use Tackle.");

    const empty = memoryTree([...events, removal(1, 2, "The Gym is locked.")]);
    expect(memoryLines(empty)).toEqual(["#3-4: Mom heals."]);
    expect(reviewMemory(empty).lines).toEqual(["#3-4: [1] Mom heals."]);
    expect(summaryPrompt(empty, { from: 1, to: 4 }).user).not.toContain("#1-2");

    const noSummary = memoryTree([call("note 1"), call("note 2"), summary(1, 2, null), removal(1, 1, "note 1"), removal(2, 2, "note 2")]);
    expect(dueMerges(noSummary)).toEqual([]);
  });
});
