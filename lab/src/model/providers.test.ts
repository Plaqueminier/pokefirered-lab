import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { coachSettings } from "./coach";
import { modelClient, modelSettings, providerProblem } from "./providers";

const PROMPT = { system: "rules", user: "now" };

// A fake `grok`: it writes its environment and its arguments to a log, and it answers as the real one does.
const FAKE_GROK = `#!/bin/sh
if [ "$1" = "models" ]; then
  echo asked >> "$FAKE_GROK_LOG.models"
  echo "You are not authenticated."
  exit 0
fi
if [ -n "$FAKE_GROK_FAILS" ]; then
  echo '{"type":"error","message":"'"$FAKE_GROK_FAILS"'"}'
  exit 1
fi
{ printf 'HOME=%s GROK_HOME=%s XAI=%s MEMORY=%s PROMPT=%s ARGS=' "$HOME" "$GROK_HOME" "$XAI_API_KEY" "$GROK_MEMORY" "$(cat prompt.txt)"; printf '%s ' "$@"; printf '\\nAGENT:\\n'; cat player.txt; } > "$FAKE_GROK_LOG"
echo '{"text":"{ \\"action\\": \\"go\\" }","structuredOutput":{"action":"go"},"usage":{"input_tokens":10,"cache_read_input_tokens":20,"cache_creation_input_tokens":3,"output_tokens":7,"reasoning_tokens":5}}'
`;

describe("modelSettings of grok", () => {
  test("it has a token limit and the default model, and it plays off as low", () => {
    expect(modelSettings({ provider: "grok", reasoning: "off", thinking: "off" }, {})).toMatchObject({ id: "grok-4.7", provider: "grok", tokenLimit: 1_000_000, reasoning: "low", thinking: "low" });
  });

  test("it refuses a cost limit and a temperature", () => {
    expect(() => modelSettings({ provider: "grok", costLimit: 1 }, {})).toThrow("the provider grok has a token limit, not a cost limit");
    expect(() => modelSettings({ provider: "grok", temperature: 1 }, {})).toThrow("the provider grok has no temperature");
  });
});

describe("modelSettings of claude-code", () => {
  test("it keeps a full model id, so that a later release of the claude command does not change the model of a Run", () => {
    const idOf = (id?: string) => modelSettings({ provider: "claude-code", id }, {}).id;
    expect(idOf()).toBe("claude-haiku-5-5");
    expect(idOf("haiku")).toBe("claude-haiku-5-5");
    expect(idOf("sonnet")).toBe("claude-sonnet-5-5");
    expect(idOf("opus")).toBe("claude-opus-5-5");
    expect(idOf("fable")).toBe("claude-fable-5-1");
    expect(idOf("claude-sonnet-6-0")).toBe("claude-sonnet-6-0");
  });

  test("another provider keeps the id that it gets", () => {
    expect(modelSettings({ id: "sonnet" }, {}).id).toBe("sonnet");
  });
});

describe("modelSettings of a Coach", () => {
  test("the Coach has its own model on the provider of the player, with a full claude-code id, and the thinking level when it has no reasoning", () => {
    expect(modelSettings({ provider: "claude-code", id: "haiku", thinking: "low", coach: { id: "opus" } }, {})).toMatchObject({ id: "claude-haiku-5-5", provider: "claude-code", coach: { id: "claude-opus-5-5", reasoning: "low" } });
    expect(modelSettings({ provider: "claude-code", coach: { id: "opus", reasoning: "high" } }, {}).coach).toEqual({ id: "claude-opus-5-5", reasoning: "high" });
  });

  test("a Coach with the model of the player, or an empty id, is no Coach", () => {
    expect(modelSettings({ provider: "claude-code", id: "haiku", coach: { id: "claude-haiku-5-5" } }, {})).not.toHaveProperty("coach");
    expect(modelSettings({ coach: { id: " " } }, {})).not.toHaveProperty("coach");
  });

  test("a reasoning of the Coach with no Coach is an error", () => {
    expect(() => modelSettings({ coach: { id: "", reasoning: "high" } }, {})).toThrow("the reasoning of the coach needs a coach");
  });

  test("the reasoning of the Coach is a level, and a provider with no off plays it as low", () => {
    expect(() => modelSettings({ coach: { id: "big", reasoning: "huge" } }, {})).toThrow("the reasoning of the coach must be");
    expect(modelSettings({ provider: "grok", coach: { id: "grok-big", reasoning: "off" } }, {}).coach).toEqual({ id: "grok-big", reasoning: "low" });
  });

  test("the client of the Coach thinks at its level, and plays at the reasoning level of the Run after an empty answer", () => {
    const settings = modelSettings({ provider: "claude-code", reasoning: "low", thinking: "medium", coach: { id: "opus", reasoning: "high" } }, {});
    expect(coachSettings(settings, { id: "claude-opus-5-5", reasoning: "high" })).toMatchObject({ id: "claude-opus-5-5", reasoning: "low", thinking: "high" });
  });
});

describe("the client of grok", () => {
  let bin = "";
  const savedPath = process.env.PATH;
  const savedKey = process.env.XAI_API_KEY;
  const ask = () => modelClient(modelSettings({ provider: "grok", id: "grok-x", reasoning: "medium" }, {}))(PROMPT);

  beforeAll(async () => {
    bin = await mkdtemp(join(tmpdir(), "lab-fake-grok-"));
    await writeFile(join(bin, "grok"), FAKE_GROK);
    await chmod(join(bin, "grok"), 0o755);
    process.env.PATH = `${bin}:${savedPath}`;
    process.env.XAI_API_KEY = "xai-secret";
    process.env.FAKE_GROK_LOG = join(bin, "log");
  });

  afterAll(async () => {
    process.env.PATH = savedPath;
    if (savedKey === undefined) delete process.env.XAI_API_KEY;
    else process.env.XAI_API_KEY = savedKey;
    delete process.env.FAKE_GROK_LOG;
    await rm(bin, { recursive: true, force: true });
  });

  test("the call has an empty HOME, the home of the lab, no API key and no tools, and the prompt comes from its file", async () => {
    expect((await ask()).content).toBe('{"action":"go"}');
    const log = await Bun.file(join(bin, "log")).text();
    expect(log).toMatch(/^HOME=\S*lab-model-call-\S+ GROK_HOME=\S*\.grok-lab XAI= MEMORY=0 PROMPT=now ARGS=/);
    expect(log).toContain("-m grok-x --effort medium");
    expect(log).toContain("--max-turns 1 --permission-mode dontAsk --disallowed-tools run_terminal_command,");
  });

  test("the system prompt goes in the agent file, because Grok ignores --system-prompt-override", async () => {
    await ask();
    const log = await Bun.file(join(bin, "log")).text();
    expect(log).toContain("--agent player.txt");
    expect(log).not.toContain("--system-prompt-override");
    expect(log).toEndWith("agents_md: false\n---\n\nrules");
  });

  test("the prompt tokens count the cached tokens, and the cost is 0", async () => {
    expect((await ask()).usage).toEqual({ promptTokens: 33, cachedTokens: 20, completionTokens: 7, reasoningTokens: 5, cost: 0 });
  });

  test("the status check asks two times before it tells that Grok is not logged in, because the first answer after the end of a token is false", async () => {
    expect(await providerProblem("grok")).toContain("Grok is not logged in for the lab: run GROK_HOME=");
    expect(await Bun.file(join(bin, "log.models")).text()).toBe("asked\nasked\n");
  });

  test("it throws the message of Grok", async () => {
    process.env.FAKE_GROK_FAILS = "unknown model id";
    try {
      await expect(ask()).rejects.toThrow("unknown model id");
    } finally {
      delete process.env.FAKE_GROK_FAILS;
    }
  });
});
