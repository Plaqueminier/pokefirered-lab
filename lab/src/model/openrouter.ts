import type { ModelOptions, ModelSettings, Prompt, Usage } from "../harness/record";
import { DEFAULT_MODEL, DEFAULT_REASONING, DEFAULT_STARTER, DEFAULT_THINKING, REASONING, type ReasoningLevel, STARTERS } from "../protocol";
import { DECISION_SCHEMA } from "./decision";

const API_URL = "https://openrouter.ai/api/v1/chat/completions";
const DEFAULT_COST_LIMIT = 0.5;
const MAX_TEMPERATURE = 2;
// OpenRouter counts the reasoning tokens in max_tokens, also for a model that always reasons: the JSON comes after them.
const MAX_TOKENS = 32000;
// The longest Model call of the Runs took 303 s for 25 142 tokens: at that speed, MAX_TOKENS takes about 6.5 minutes, and this limit leaves a margin.
const CALL_TIMEOUT_MS = 10 * 60_000;

export type ModelReply = { content: string; usage: Usage; reasoning?: string };

type AnswerFormat = { name: "decision" | "character" | "review" | "summary"; schema: object };

const DECISION_FORMAT: AnswerFormat = { name: "decision", schema: DECISION_SCHEMA };

export type AskOptions = { format?: AnswerFormat; reasoning?: ReasoningLevel; signal?: AbortSignal };

export type ModelClient = (prompt: Prompt, options?: AskOptions) => Promise<ModelReply>;

function levelOf(name: string, given: string | undefined, fallback: ReasoningLevel): ReasoningLevel {
  const level = REASONING.find((known) => known === (given ?? fallback));
  if (!level) throw new Error(`the ${name} must be ${REASONING.join(", ")}, not "${given}"`);
  return level;
}

export function modelSettings(given: ModelOptions, env: Record<string, string | undefined> = process.env): ModelSettings {
  const costLimit = given.costLimit ?? (env.LAB_COST_LIMIT === undefined ? DEFAULT_COST_LIMIT : Number(env.LAB_COST_LIMIT));
  if (!Number.isFinite(costLimit) || costLimit <= 0) {
    throw new Error(`the cost limit must be a number of dollars above 0, not "${given.costLimit ?? env.LAB_COST_LIMIT}"`);
  }
  const reasoning = levelOf("reasoning", given.reasoning, DEFAULT_REASONING);
  const thinking = levelOf("thinking", given.thinking, DEFAULT_THINKING);
  const temperature = given.temperature ?? null;
  if (temperature !== null && !(temperature >= 0 && temperature <= MAX_TEMPERATURE)) throw new Error(`the temperature must be from 0 to ${MAX_TEMPERATURE}`);
  const starter = STARTERS.find((name) => name === (given.starter ?? DEFAULT_STARTER));
  if (!starter) throw new Error(`the starter must be ${STARTERS.join(", ")}, not "${given.starter}"`);
  return { id: given.id || DEFAULT_MODEL, costLimit, reasoning, thinking, temperature, starter, stopAtWhiteout: given.stopAtWhiteout ?? true };
}

type ChatReply = {
  choices?: { message?: { content?: string | null; reasoning?: string | null } }[];
  usage?: { prompt_tokens?: number; prompt_tokens_details?: { cached_tokens?: number }; completion_tokens?: number; completion_tokens_details?: { reasoning_tokens?: number }; cost?: number };
  error?: { message?: string };
};

export function openRouter(settings: ModelSettings, apiKey = process.env.OPENROUTER_API_KEY, fetcher: typeof fetch = fetch, timeoutMs = CALL_TIMEOUT_MS): ModelClient {
  if (!apiKey) throw new Error("OPENROUTER_API_KEY is not set: put it in lab/.env");
  const temperature = settings.temperature === null ? {} : { temperature: settings.temperature };
  return async ({ system, user, turns = [] }, { format = DECISION_FORMAT, reasoning = settings.reasoning, signal } = {}) => {
    const ended = AbortSignal.any([AbortSignal.timeout(timeoutMs), ...(signal ? [signal] : [])]);
    const response = await fetcher(API_URL, {
      signal: ended,
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
        reasoning: { effort: reasoning === "off" ? "none" : reasoning },
        ...temperature,
      }),
    });
    const reply: ChatReply = await response.json().catch(() => ({}));
    // The signal can also end the call after the headers, while this reads the body: the catch above then hides its reason.
    ended.throwIfAborted();
    if (!response.ok) throw new Error(`OpenRouter answered ${response.status}: ${reply.error?.message ?? response.statusText}`);
    const usage = reply.usage;
    const message = reply.choices?.[0]?.message;
    if (typeof usage?.cost !== "number") throw new Error("OpenRouter gave no cost");
    return {
      // A billed answer with no text, for example when the reasoning took all the tokens: the Bot cannot read it, but it counts its cost.
      content: message?.content ?? "",
      ...(message?.reasoning ? { reasoning: message.reasoning } : {}),
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
