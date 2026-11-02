import type { ModelSettings, Prompt, Usage } from "../harness/record";
import type { ReasoningLevel } from "../protocol";
import { DECISION_SCHEMA } from "./decision";

const API_URL = "https://openrouter.ai/api/v1/chat/completions";
// OpenRouter counts the reasoning tokens in max_tokens, also for a model that always reasons: the JSON comes after them.
const MAX_TOKENS = 32000;
// The longest Model call of the Runs took 303 s for 25 142 tokens: at that speed, MAX_TOKENS takes about 6.5 minutes, and this limit leaves a margin.
const CALL_TIMEOUT_MS = 10 * 60_000;

export type ModelReply = { content: string; usage: Usage; reasoning?: string };

type AnswerFormat = { name: "decision" | "character" | "review" | "summary"; schema: object };

export const DECISION_FORMAT: AnswerFormat = { name: "decision", schema: DECISION_SCHEMA };

export const NO_OPENROUTER_KEY = "OPENROUTER_API_KEY is not set: put it in lab/.env";

export type AskOptions = { format?: AnswerFormat; reasoning?: ReasoningLevel; signal?: AbortSignal };

export type ModelClient = (prompt: Prompt, options?: AskOptions) => Promise<ModelReply>;

type ChatReply = {
  choices?: { message?: { content?: string | null; reasoning?: string | null } }[];
  usage?: { prompt_tokens?: number; prompt_tokens_details?: { cached_tokens?: number }; completion_tokens?: number; completion_tokens_details?: { reasoning_tokens?: number }; cost?: number };
  error?: { message?: string };
};

export function openRouter(settings: ModelSettings, apiKey = process.env.OPENROUTER_API_KEY, fetcher: typeof fetch = fetch, timeoutMs = CALL_TIMEOUT_MS): ModelClient {
  if (!apiKey) throw new Error(NO_OPENROUTER_KEY);
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
