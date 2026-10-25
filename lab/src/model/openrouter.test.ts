import { describe, expect, test } from "bun:test";
import { DECISION_SCHEMA } from "./decision";
import { DEFAULT_MODEL } from "../protocol";
import { modelSettings, openRouter } from "./openrouter";

const KEY = "sk-or-test-key";
const PROMPT = { system: "rules", user: "now" };
const REPLY = {
  choices: [{ message: { content: '{"reason":"r","action":"go 1","mission":"m","objective":"o","notes":""}' } }],
  usage: { prompt_tokens: 1200, completion_tokens: 40, completion_tokens_details: { reasoning_tokens: 0 }, cost: 0.00021 },
};

function fakeFetch(status: number, body: unknown) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetcher = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return new Response(JSON.stringify(body), { status });
  }) as unknown as typeof fetch;
  return { calls, fetcher };
}

describe("modelSettings", () => {
  test("by default: the default model, the cost limit of LAB_COST_LIMIT or 0.50 $, a low reasoning and the temperature of the model", () => {
    expect(modelSettings({}, {})).toEqual({ id: DEFAULT_MODEL, costLimit: 0.5, reasoning: "low", temperature: null });
    expect(modelSettings({}, { LAB_COST_LIMIT: "0.2" }).costLimit).toBe(0.2);
    expect(modelSettings({ id: "a/b", costLimit: 1, reasoning: "off", temperature: 0.3 }, { LAB_COST_LIMIT: "0.2" })).toEqual({ id: "a/b", costLimit: 1, reasoning: "off", temperature: 0.3 });
  });

  test("it refuses a cost limit, a reasoning or a temperature that is not valid", () => {
    expect(() => modelSettings({}, { LAB_COST_LIMIT: "free" })).toThrow('the cost limit must be a number of dollars above 0, not "free"');
    expect(() => modelSettings({ costLimit: 0 }, {})).toThrow("the cost limit must be a number of dollars above 0");
    expect(() => modelSettings({ reasoning: "max" }, {})).toThrow('the reasoning must be off, low, medium, high, not "max"');
    expect(() => modelSettings({ temperature: 3 }, {})).toThrow("the temperature must be from 0 to 2");
  });
});

describe("openRouter", () => {
  test("it asks for the strict JSON schema of the answer, only from the providers that apply it, with a low reasoning and no temperature by default", async () => {
    const { calls, fetcher } = fakeFetch(200, REPLY);
    await openRouter(modelSettings({ id: "a/b" }, {}), KEY, fetcher)(PROMPT);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("https://openrouter.ai/api/v1/chat/completions");
    expect(calls[0].init.method).toBe("POST");
    expect(calls[0].init.headers).toMatchObject({ Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" });
    const body = JSON.parse(String(calls[0].init.body));
    expect(body).toEqual({
      model: "a/b",
      messages: [
        { role: "system", content: "rules" },
        { role: "user", content: "now" },
      ],
      response_format: { type: "json_schema", json_schema: { name: "decision", strict: true, schema: DECISION_SCHEMA } },
      provider: { require_parameters: true },
      max_tokens: 4000,
      reasoning: { effort: "low" },
    });
  });

  test("it sends the reasoning effort and the temperature when the Run gives them", async () => {
    const { calls, fetcher } = fakeFetch(200, REPLY);
    await openRouter(modelSettings({ reasoning: "high", temperature: 0 }, {}), KEY, fetcher)(PROMPT);
    expect(JSON.parse(String(calls[0].init.body))).toMatchObject({ reasoning: { effort: "high" }, temperature: 0, max_tokens: 4000 });
    await openRouter(modelSettings({ reasoning: "off" }, {}), KEY, fetcher)(PROMPT);
    expect(JSON.parse(String(calls[1].init.body))).toMatchObject({ reasoning: { effort: "none" } });
  });

  test("it gives the text of the answer, the tokens and the cost", async () => {
    const { fetcher } = fakeFetch(200, REPLY);
    expect(await openRouter(modelSettings({}, {}), KEY, fetcher)(PROMPT)).toEqual({
      content: REPLY.choices[0].message.content,
      usage: { promptTokens: 1200, completionTokens: 40, reasoningTokens: 0, cost: 0.00021 },
    });
  });

  test("it throws an error with the message of OpenRouter, and never with the API key", async () => {
    const { fetcher } = fakeFetch(401, { error: { code: 401, message: "No auth credentials found" } });
    const error = await openRouter(modelSettings({}, {}), KEY, fetcher)(PROMPT).catch((e: unknown) => e);
    expect(String(error)).toBe("Error: OpenRouter answered 401: No auth credentials found");
    const noCost = fakeFetch(200, { ...REPLY, usage: { prompt_tokens: 1 } });
    await expect(openRouter(modelSettings({}, {}), KEY, noCost.fetcher)(PROMPT)).rejects.toThrow("OpenRouter gave no cost");
  });

  test("an answer with no text keeps its cost: the Bot cannot read it, but it counts it", async () => {
    const { fetcher } = fakeFetch(200, { choices: [{ message: { content: null } }], usage: REPLY.usage });
    expect(await openRouter(modelSettings({}, {}), KEY, fetcher)(PROMPT)).toMatchObject({ content: "", usage: { cost: REPLY.usage.cost } });
  });

  test("with no API key, it throws an error before any request", () => {
    const { calls, fetcher } = fakeFetch(200, REPLY);
    expect(() => openRouter(modelSettings({}, {}), "", fetcher)).toThrow("OPENROUTER_API_KEY is not set: put it in lab/.env");
    expect(calls).toHaveLength(0);
  });
});
