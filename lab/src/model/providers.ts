import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { errorText } from "../harness/harness";
import type { ModelOptions, ModelSettings, Prompt, Usage } from "../harness/record";
import { DEFAULT_MODELS, DEFAULT_PROVIDER, DEFAULT_REASONING, DEFAULT_STARTER, DEFAULT_THINKING, DEFAULT_TOKEN_LIMIT, isPlanProvider, MODEL_PROVIDERS, type ModelProvider, type ProviderStatus, REASONING, type ReasoningLevel, STARTERS } from "../protocol";
import { type AskOptions, DECISION_FORMAT, type ModelClient, type ModelReply, NO_OPENROUTER_KEY, openRouter } from "./openrouter";

const DEFAULT_COST_LIMIT = 0.5;
const MAX_TEMPERATURE = 2;
const CALL_TIMEOUT_MS = 5 * 60_000;
const STATUS_TIMEOUT_MS = 15_000;
const EXIT_DRAIN_MS = 1000;
const KILL_GRACE_MS = 2000;
// Each tool bills an API key when it finds one, so the subscription pays only with no key in its environment.
const API_KEYS = ["ANTHROPIC_API_KEY", "OPENAI_API_KEY", "CODEX_API_KEY", "OPENROUTER_API_KEY"];
const CODEX = join(import.meta.dir, "../../node_modules/.bin/codex");
// The docs of the tools give no format for a quota error, so only its text can tell it.
const QUOTA_ERROR = /(usage|session|weekly|hourly|5-hour|plan)[ _-]?limit|hit your .*limit|quota/i;
const SYSTEM_FILE = "sys.txt";
const SCHEMA_FILE = "schema.json";
const CODEX_QUIET = [
  ...["web_search=\"disabled\"", "skills.include_instructions=false", "include_permissions_instructions=false", "include_environment_context=false", "include_apps_instructions=false"].flatMap((option) => ["-c", option]),
  ...["multi_agent", "shell_tool", "apps", "plugins", "sleep_tool", "tool_suggest", "goals", "image_generation", "view_image", "hooks"].flatMap((feature) => ["--disable", feature]),
];
const CODEX_NOT_TOOLS = ["agent_message", "reasoning", "error"];

function levelOf(name: string, given: string | undefined, fallback: ReasoningLevel): ReasoningLevel {
  const level = REASONING.find((known) => known === (given ?? fallback));
  if (!level) throw new Error(`the ${name} must be ${REASONING.join(", ")}, not "${given}"`);
  return level;
}

export function modelSettings(given: ModelOptions, env: Record<string, string | undefined> = process.env): ModelSettings {
  const provider = MODEL_PROVIDERS.find((known) => known === (given.provider ?? DEFAULT_PROVIDER));
  if (!provider) throw new Error(`the provider must be ${MODEL_PROVIDERS.join(", ")}, not "${given.provider}"`);
  const levelFor = (level: ReasoningLevel) => (provider === "claude-code" && level === "off" ? "low" : level);
  const reasoning = levelFor(levelOf("reasoning", given.reasoning, DEFAULT_REASONING));
  const thinking = levelFor(levelOf("thinking", given.thinking, DEFAULT_THINKING));
  const temperature = given.temperature ?? null;
  if (temperature !== null && !(temperature >= 0 && temperature <= MAX_TEMPERATURE)) throw new Error(`the temperature must be from 0 to ${MAX_TEMPERATURE}`);
  if (temperature !== null && isPlanProvider(provider)) throw new Error(`the provider ${provider} has no temperature`);
  const starter = STARTERS.find((name) => name === (given.starter ?? DEFAULT_STARTER));
  if (!starter) throw new Error(`the starter must be ${STARTERS.join(", ")}, not "${given.starter}"`);
  const choice = { id: given.id || DEFAULT_MODELS[provider], reasoning, thinking, temperature, starter, stopAtWhiteout: given.stopAtWhiteout ?? true };
  if (isPlanProvider(provider)) {
    if (given.costLimit !== undefined) throw new Error(`the provider ${provider} has a token limit, not a cost limit`);
    const tokenLimit = given.tokenLimit ?? DEFAULT_TOKEN_LIMIT;
    if (!Number.isFinite(tokenLimit) || tokenLimit <= 0) throw new Error("the token limit must be a number above 0, in millions of tokens");
    return { ...choice, provider, tokenLimit };
  }
  if (given.tokenLimit !== undefined) throw new Error("the provider openrouter has a cost limit, not a token limit");
  const costLimit = given.costLimit ?? (env.LAB_COST_LIMIT === undefined ? DEFAULT_COST_LIMIT : Number(env.LAB_COST_LIMIT));
  if (!Number.isFinite(costLimit) || costLimit <= 0) {
    throw new Error(`the cost limit must be a number of dollars above 0, not "${given.costLimit ?? env.LAB_COST_LIMIT}"`);
  }
  return { ...choice, provider, costLimit };
}

export class PlanLimitError extends Error {}

function failure(text: string): Error {
  return QUOTA_ERROR.test(text) ? new PlanLimitError(text) : new Error(text);
}

function toolEnv(): Record<string, string | undefined> {
  return Object.fromEntries(Object.entries(process.env).filter(([name]) => !API_KEYS.includes(name)));
}

type ToolRun = { exitCode: number; stdout: string; stderr: string };

async function runTool(command: string[], { stdin = "", cwd, signal, onLine }: { stdin?: string; cwd: string; signal: AbortSignal; onLine?: (line: string) => void }): Promise<ToolRun> {
  signal.throwIfAborted();
  const tool = Bun.spawn(command, { cwd, env: toolEnv(), stdin: new TextEncoder().encode(stdin), stdout: "pipe", stderr: "pipe" });
  const read = async (): Promise<ToolRun> => {
    const stderr = new Response(tool.stderr).text();
    let stdout = "";
    const drained = (async () => {
      let line = "";
      for await (const chunk of tool.stdout.pipeThrough(new TextDecoderStream())) {
        stdout += chunk;
        const lines = (line + chunk).split("\n");
        line = lines.pop() ?? "";
        for (const whole of lines) onLine?.(whole);
      }
      if (line) onLine?.(line);
    })();
    // A child can keep the pipes open after the tool ends: its answer is already here, so the call does not wait for the child.
    const afterExit = tool.exited.then(() => Bun.sleep(EXIT_DRAIN_MS));
    await Promise.race([drained, afterExit]);
    return { exitCode: await tool.exited, stdout, stderr: await Promise.race([stderr, afterExit.then(() => "")]) };
  };
  let onAbort = () => {};
  const aborted = new Promise<never>((_, reject) => {
    onAbort = () => reject(signal.reason);
    signal.addEventListener("abort", onAbort, { once: true });
  });
  try {
    return await Promise.race([aborted, read()]);
  } finally {
    signal.removeEventListener("abort", onAbort);
    if (tool.exitCode === null) {
      tool.kill();
      setTimeout(() => tool.kill("SIGKILL"), KILL_GRACE_MS).unref();
    }
  }
}

async function inEmptyDirectory<T>(use: (directory: string) => Promise<T>): Promise<T> {
  const directory = await mkdtemp(join(tmpdir(), "lab-model-call-"));
  try {
    return await use(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

function callSignal(signal: AbortSignal | undefined): AbortSignal {
  return AbortSignal.any([AbortSignal.timeout(CALL_TIMEOUT_MS), ...(signal ? [signal] : [])]);
}

function oneMessage({ user, turns = [] }: Prompt): string {
  return [user, ...turns.flatMap((turn) => [`Your earlier answer:\n${turn.assistant}`, `The answer of the program:\n${turn.user}`])].join("\n\n");
}

type ClaudeResult = {
  is_error?: boolean;
  result?: string;
  structured_output?: unknown;
  usage?: { input_tokens?: number; cache_creation_input_tokens?: number; cache_read_input_tokens?: number; output_tokens?: number };
};

function claudeReply({ exitCode, stdout, stderr }: ToolRun): ModelReply {
  let result: ClaudeResult;
  try {
    result = JSON.parse(stdout);
  } catch {
    throw failure(stderr.trim() || stdout.trim() || `Claude Code ended with the code ${exitCode}`);
  }
  if (exitCode !== 0 || result.is_error) throw failure(result.result || stderr.trim() || `Claude Code ended with the code ${exitCode}`);
  const { input_tokens = 0, cache_creation_input_tokens = 0, cache_read_input_tokens = 0, output_tokens = 0 } = result.usage ?? {};
  return {
    content: result.structured_output === undefined ? (result.result ?? "") : JSON.stringify(result.structured_output),
    usage: { promptTokens: input_tokens + cache_creation_input_tokens + cache_read_input_tokens, cachedTokens: cache_read_input_tokens, completionTokens: output_tokens, reasoningTokens: 0, cost: 0 },
  };
}

function claudeCode(settings: ModelSettings): ModelClient {
  return ({ system, ...prompt }, { format = DECISION_FORMAT, reasoning = settings.reasoning, signal }: AskOptions = {}) =>
    inEmptyDirectory(async (cwd) => {
      const command = ["claude", "-p", "--model", settings.id, "--effort", reasoning, "--tools", "", "--strict-mcp-config", "--setting-sources", "", "--no-session-persistence", "--output-format", "json", "--system-prompt", system, "--json-schema", JSON.stringify(format.schema)];
      return claudeReply(await runTool(command, { stdin: oneMessage({ system, ...prompt }), cwd, signal: callSignal(signal) }));
    });
}

type CodexItem = { type?: string; text?: string; command?: string; tool?: string };

type CodexEvent = {
  type?: string;
  item?: CodexItem;
  usage?: { input_tokens?: number; cached_input_tokens?: number; output_tokens?: number; reasoning_output_tokens?: number };
  error?: { message?: string };
  message?: string;
};

function codexEvent(line: string): CodexEvent {
  try {
    return JSON.parse(line);
  } catch {
    return {};
  }
}

function codexUsage({ input_tokens = 0, cached_input_tokens = 0, output_tokens = 0, reasoning_output_tokens = 0 }: NonNullable<CodexEvent["usage"]>): Usage {
  return { promptTokens: input_tokens, cachedTokens: cached_input_tokens, completionTokens: output_tokens, reasoningTokens: reasoning_output_tokens, cost: 0 };
}

function refuseTool({ item }: CodexEvent): void {
  if (!item?.type || CODEX_NOT_TOOLS.includes(item.type)) return;
  throw new Error(`Codex used the tool ${item.tool ?? item.command ?? item.type}`);
}

function codex(settings: ModelSettings): ModelClient {
  return (prompt, { format = DECISION_FORMAT, reasoning = settings.reasoning, signal }: AskOptions = {}) =>
    inEmptyDirectory(async (cwd) => {
      await writeFile(join(cwd, SYSTEM_FILE), prompt.system);
      await writeFile(join(cwd, SCHEMA_FILE), JSON.stringify(format.schema));
      const effort = reasoning === "off" ? "none" : reasoning;
      const command = [CODEX, "exec", "--ignore-user-config", "--ephemeral", "--skip-git-repo-check", "--json", "-s", "read-only", "--output-schema", SCHEMA_FILE, "-m", settings.id, "-c", `model_reasoning_effort="${effort}"`, "-c", `model_instructions_file="${SYSTEM_FILE}"`, ...CODEX_QUIET, "-"];
      let content = "";
      let usage: Usage | null = null;
      let failed = "";
      const onLine = (line: string) => {
        const event = codexEvent(line);
        refuseTool(event);
        if (event.type === "item.completed" && event.item?.type === "agent_message") content = event.item.text ?? "";
        if (event.type === "turn.completed" && event.usage) usage = codexUsage(event.usage);
        // Codex also sends an `error` event when it reconnects, and the turn can still end well.
        if (event.type === "turn.failed") failed = event.error?.message ?? failed;
        if (event.type === "error") failed = event.message ?? failed;
      };
      const { exitCode, stderr } = await runTool(command, { stdin: oneMessage(prompt), cwd, signal: callSignal(signal), onLine });
      if (!usage) throw failure(failed || stderr.trim() || `Codex ended with the code ${exitCode}`);
      return { content, usage };
    });
}

export function modelClient(settings: ModelSettings): ModelClient {
  if (settings.provider === "claude-code") return claudeCode(settings);
  if (settings.provider === "codex") return codex(settings);
  return openRouter(settings);
}

async function claudeProblem(cwd: string, signal: AbortSignal): Promise<string | null> {
  if (!Bun.which("claude")) return "the command claude is not found: install Claude Code";
  const { stdout } = await runTool(["claude", "auth", "status"], { cwd, signal });
  const { authMethod } = JSON.parse(stdout) as { authMethod?: string };
  return authMethod === "claude.ai" ? null : "Claude Code is not logged in with a subscription: run claude auth login";
}

async function codexProblem(cwd: string, signal: AbortSignal): Promise<string | null> {
  if (!(await Bun.file(CODEX).exists())) return "the command codex is not found: run bun install in lab/";
  const { stdout, stderr } = await runTool([CODEX, "login", "status"], { cwd, signal });
  return /chatgpt/i.test(stdout + stderr) ? null : `Codex is not logged in with a subscription: run ${CODEX} login`;
}

export async function providerProblem(provider: ModelProvider): Promise<string | null> {
  if (provider === "openrouter") return process.env.OPENROUTER_API_KEY ? null : NO_OPENROUTER_KEY;
  const check = provider === "claude-code" ? claudeProblem : codexProblem;
  try {
    return await inEmptyDirectory((cwd) => check(cwd, AbortSignal.timeout(STATUS_TIMEOUT_MS)));
  } catch (error) {
    return `the check of ${provider} failed: ${errorText(error)}`;
  }
}

export function providerStatuses(): Promise<ProviderStatus[]> {
  return Promise.all(MODEL_PROVIDERS.map(async (provider) => ({ provider, problem: await providerProblem(provider) })));
}
