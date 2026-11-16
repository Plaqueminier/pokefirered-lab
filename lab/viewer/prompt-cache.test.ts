import { afterEach, describe, expect, test } from "bun:test";
import type { Prompt } from "../src/harness/record";
import { PromptCache } from "./prompt-cache";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

function prompt(n: number): Prompt {
  return { system: "rules", user: `call ${n}` };
}

type Server = { count: number; fail?: boolean; asked: string[]; onAsk?: () => void };

function server(count: number, fail = false): Server {
  const state: Server = { count, fail, asked: [] };
  globalThis.fetch = (async (url: string) => {
    state.asked.push(url);
    if (state.fail) return new Response("This Run is not open now", { status: 404 });
    const params = new URL(url, "http://viewer").searchParams;
    const from = Number(params.get("from"));
    const to = Math.min(Number(params.get("to")), state.count);
    const answer = Response.json(Array.from({ length: Math.max(0, to - from) }, (_, i) => prompt(from + i)));
    state.onAsk?.();
    return answer;
  }) as typeof fetch;
  return state;
}

const settled = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("the prompts of the shown Run", () => {
  test("a Run that plays: the Viewer asks only for the prompts that it does not have", async () => {
    const run = server(3);
    const cache = new PromptCache();
    cache.show({ bot: 1 });
    cache.want(2);
    expect(cache.state(2)).toEqual({ kind: "loading" });
    await settled();
    expect(cache.state(2)).toEqual({ kind: "ready", prompt: prompt(2) });
    run.count = 5;
    cache.want(1);
    cache.want(4);
    await settled();
    expect(cache.state(4)).toEqual({ kind: "ready", prompt: prompt(4) });
    expect(run.asked).toEqual(["/prompts?bot=1&from=0&to=32", "/prompts?bot=1&from=3&to=32"]);
  });

  test("a call that comes while the answer is on its way: the Viewer asks again for its prompt", async () => {
    const run = server(3);
    const cache = new PromptCache();
    cache.show({ bot: 1 });
    run.onAsk = () => {
      run.onAsk = undefined;
      run.count = 4;
      cache.want(3);
    };
    cache.want(2);
    await settled();
    await settled();
    expect(cache.state(3)).toEqual({ kind: "ready", prompt: prompt(3) });
    expect(run.asked).toEqual(["/prompts?bot=1&from=0&to=32", "/prompts?bot=1&from=3&to=32"]);
  });

  test("a prompt that did not load loads at the next ask; the same Run keeps the prompts, and another Run drops them", async () => {
    const run = server(1, true);
    const cache = new PromptCache();
    expect(cache.show({ record: "00061 a b" })).toBe(true);
    cache.want(0);
    await settled();
    expect(cache.state(0)).toMatchObject({ kind: "error" });
    run.fail = false;
    cache.want(0);
    await settled();
    expect(cache.state(0)).toEqual({ kind: "ready", prompt: prompt(0) });
    expect(cache.show({ record: "00061 a b" })).toBe(false);
    expect(cache.state(0)).toEqual({ kind: "ready", prompt: prompt(0) });
    expect(cache.show(null)).toBe(true);
    expect(cache.state(0)).toEqual({ kind: "error", error: "this Run has no Model calls" });
    expect(run.asked[0]).toBe("/prompts?record=00061%20a%20b&from=0&to=32");
  });
});
