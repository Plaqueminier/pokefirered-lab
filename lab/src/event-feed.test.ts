import { describe, expect, test } from "bun:test";
import type { ModelEvent, RunEvent } from "./harness/record";
import { EVENTS_CHUNK, EventFeed, shownEvent } from "./event-feed";

const BOT = { bot: 1 };

const usage = { promptTokens: 1, completionTokens: 1, reasoningTokens: 0, cost: 0 };

function call(frame: number, more: Partial<ModelEvent> = {}): ModelEvent {
  return { type: "model", frame, latencyMs: 1, model: "a/b", situation: "a walk", prompt: { system: "rules", user: "The game waits for a walk." }, answer: "{}", usage, decision: { reason: "r", action: "go A", mission: "m", objective: "o", note: "" }, error: null, ...more } as ModelEvent;
}

function events(count: number): RunEvent[] {
  return Array.from({ length: count }, (_, frame) => ({ type: "map", frame, map: "PalletTown" }) as unknown as RunEvent);
}

describe("the events that the Viewer gets", () => {
  test("a Model call comes with no prompt, with the first line of each more turn and the request of a Review turn", () => {
    const turns = [{ assistant: "{}", user: "Full Atlas of the maps:\nPalletTown" }];
    const withTurn = shownEvent(call(1, { prompt: { system: "rules", user: "u", turns } }));
    expect(withTurn).not.toHaveProperty("prompt");
    expect(withTurn).toMatchObject({ turnLines: ["Full Atlas of the maps:"], reviewRequest: null });
    const review = call(5, { review: true, prompt: { system: "rules", user: "Milestones: none\n\nReview turn: check your plan.\n- Is the mission right?\n\nActions" } });
    expect(shownEvent(review)).toMatchObject({ turnLines: [], reviewRequest: "Review turn: check your plan.\n- Is the mission right?" });
  });

  test("a long list goes in chunks, and each chunk tells how many events the Run has", () => {
    const feed = new EventFeed();
    const all = events(2 * EVENTS_CHUNK + 10);
    const first = feed.restart(all, BOT);
    expect(first).toMatchObject({ type: "events", prompts: BOT, total: all.length });
    expect(first.events).toHaveLength(EVENTS_CHUNK);
    expect(feed.next(all, BOT)).toMatchObject({ type: "events-added", from: EVENTS_CHUNK, total: all.length, quiet: false });
    expect(feed.next(all, BOT)?.events).toHaveLength(10);
    expect(feed.next(all, BOT)).toBeNull();
  });

  test("a jump back ends the list of the clients at the frame, and a jump forward sends the new events with no toast", () => {
    const feed = new EventFeed();
    const all = events(30);
    feed.restart(all.slice(0, 20), BOT);
    expect(feed.next(all.slice(0, 5), BOT)).toEqual({ type: "events-added", from: 5, events: [], total: 5, quiet: true });
    feed.quietUntil(all.slice(0, 25));
    expect(feed.next(all.slice(0, 25), BOT)).toMatchObject({ from: 5, total: 25, quiet: true });
    expect(feed.next(all, BOT)).toMatchObject({ from: 25, total: 30, quiet: false });
  });

  test("another list with the same length starts again for the clients", () => {
    const feed = new EventFeed();
    feed.restart(events(3), BOT);
    expect(feed.next(events(3), BOT)).toMatchObject({ type: "events", total: 3, quiet: true });
  });
});
