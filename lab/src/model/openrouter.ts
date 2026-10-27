import type { ModelOptions, ModelSettings, NodeRange, Prompt, Usage } from "../harness/record";
import { DEFAULT_MODEL, DEFAULT_REASONING, DEFAULT_STARTER, REASONING, STARTERS } from "../protocol";
import { DECISION_SCHEMA } from "./decision";
import { summarySchema } from "./memory-tree";

const API_URL = "https://openrouter.ai/api/v1/chat/completions";
const DEFAULT_COST_LIMIT = 0.5;
const MAX_TEMPERATURE = 2;
// OpenRouter counts the reasoning tokens in max_tokens, also for a model that always reasons: the JSON comes after them.
const MAX_TOKENS = 4000;

export type ModelReply = { content: string; usage: Usage };

export type AnswerFormat = { name: "decision" | "summary"; schema: object };

export const DECISION_FORMAT: AnswerFormat = { name: "decision", schema: DECISION_SCHEMA };

export function summaryFormat(node: NodeRange): AnswerFormat {
  return { name: "summary", schema: summarySchema(node) };
}

export type ModelClient = (prompt: Prompt, format?: AnswerFormat) => Promise<ModelReply>;

export function modelSettings(given: ModelOptions, env: Record<string, string | undefined> = process.env): ModelSettings {
  const costLimit = given.costLimit ?? (env.LAB_COST_LIMIT === undefined ? DEFAULT_COST_LIMIT : Number(env.LAB_COST_LIMIT));
  if (!Number.isFinite(costLimit) || costLimit <= 0) {
    throw new Error(`the cost limit must be a number of dollars above 0, not "${given.costLimit ?? env.LAB_COST_LIMIT}"`);
  }
  const reasoning = REASONING.find((level) => level === (given.reasoning ?? DEFAULT_REASONING));
  if (!reasoning) throw new Error(`the reasoning must be ${REASONING.join(", ")}, not "${given.reasoning}"`);
  const temperature = given.temperature ?? null;
  if (temperature !== null && !(temperature >= 0 && temperature <= MAX_TEMPERATURE)) throw new Error(`the temperature must be from 0 to ${MAX_TEMPERATURE}`);
  const starter = STARTERS.find((name) => name === (given.starter ?? DEFAULT_STARTER));
  if (!starter) throw new Error(`the starter must be ${STARTERS.join(", ")}, not "${given.starter}"`);
  return { id: given.id || DEFAULT_MODEL, costLimit, reasoning, temperature, starter };
}

type ChatReply = {
  choices?: { message?: { content?: string | null } }[];
  usage?: { prompt_tokens?: number; prompt_tokens_details?: { cached_tokens?: number }; completion_tokens?: number; completion_tokens_details?: { reasoning_tokens?: number }; cost?: number };
  error?: { message?: string };
};

export function openRouter(settings: ModelSettings, apiKey = process.env.OPENROUTER_API_KEY, fetcher: typeof fetch = fetch): ModelClient {
  if (!apiKey) throw new Error("OPENROUTER_API_KEY is not set: put it in lab/.env");
  const reasoning = { effort: settings.reasoning === "off" ? "none" : settings.reasoning };
  const temperature = settings.temperature === null ? {} : { temperature: settings.temperature };
  return async ({ system, user, turns = [] }, format = DECISION_FORMAT) => {
    const response = await fetcher(API_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: settings.id,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
          ...turns.flatMap((turn) => [
            { role: "assistant", content: turn.assistant },
            { role: "user", content: turn.user },
          ]),
        ],
        response_format: { type: "json_schema", json_schema: { name: format.name, strict: true, schema: format.schema } },
        provider: { require_parameters: true },
        max_tokens: MAX_TOKENS,
        reasoning,
        ...temperature,
      }),
    });
    const reply: ChatReply = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(`OpenRouter answered ${response.status}: ${reply.error?.message ?? response.statusText}`);
    const usage = reply.usage;
    if (typeof usage?.cost !== "number") throw new Error("OpenRouter gave no cost");
    return {
      // A billed answer with no text, for example when the reasoning took all the tokens: the Bot cannot read it, but it counts its cost.
      content: reply.choices?.[0]?.message?.content ?? "",
      usage: {
        promptTokens: usage.prompt_tokens ?? 0,
        cachedTokens: usage.prompt_tokens_details?.cached_tokens ?? 0,
        completionTokens: usage.completion_tokens ?? 0,
        reasoningTokens: usage.completion_tokens_details?.reasoning_tokens ?? 0,
        cost: usage.cost,
      },
    };
  };
}
