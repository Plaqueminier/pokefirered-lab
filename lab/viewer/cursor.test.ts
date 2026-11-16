import { describe, expect, test } from "bun:test";
import type { ShownEvent } from "../src/protocol";
import { EventChunks } from "./cursor";

function events(from: number, count: number): ShownEvent[] {
  return Array.from({ length: count }, (_, i) => ({ type: "map", frame: from + i, map: "PalletTown" }) as unknown as ShownEvent);
}

function frames(got: ReturnType<EventChunks["receive"]>): number[] | string {
  return got.kind === "done" ? got.list.events.map((e) => e.frame) : got.kind;
}

const BOT = { bot: 2 };

describe("the chunks of a list of events", () => {
  test("the list comes when its last chunk is here, and it is quiet when one of its chunks was quiet", () => {
    const chunks = new EventChunks();
    expect(chunks.receive({ type: "events", prompts: BOT, events: events(0, 3), total: 5, quiet: true })).toEqual({ kind: "loading", loading: { received: 3, total: 5 }, prompts: BOT });
    const done = chunks.receive({ type: "events-added", from: 3, events: events(3, 2), total: 5, quiet: false });
    expect(done).toMatchObject({ kind: "done", list: { prompts: BOT }, quiet: true });
    expect(frames(done)).toEqual([0, 1, 2, 3, 4]);
  });

  test("a jump back ends the list, and the new events continue it", () => {
    const chunks = new EventChunks();
    chunks.receive({ type: "events", prompts: BOT, events: events(0, 4), total: 4 });
    expect(frames(chunks.receive({ type: "events-added", from: 2, events: [], total: 2, quiet: true }))).toEqual([0, 1]);
    const added = chunks.receive({ type: "events-added", from: 2, events: events(10, 1), total: 3, quiet: false });
    expect(added).toMatchObject({ kind: "done", quiet: false });
    expect(frames(added)).toEqual([0, 1, 10]);
  });
});
