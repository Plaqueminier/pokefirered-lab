import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { modelClient, modelSettings } from "./providers";

const PROMPT = { system: "rules", user: "now" };

// A fake `grok`: it writes its environment and its arguments to a log, and it answers as the real one does.
const FAKE_GROK = `#!/bin/sh
if [ -n "$FAKE_GROK_FAILS" ]; then
  echo '{"type":"error","message":"'"$FAKE_GROK_FAILS"'"}'
  exit 1
fi
{ printf 'HOME=%s GROK_HOME=%s XAI=%s MEMORY=%s PROMPT=%s ARGS=' "$HOME" "$GROK_HOME" "$XAI_API_KEY" "$GROK_MEMORY" "$(cat prompt.txt)"; printf '%s ' "$@"; } > "$FAKE_GROK_LOG"
echo '{"text":"{ \\"action\\": \\"go\\" }","structuredOutput":{"action":"go"},"usage":{"input_tokens":10,"cache_read_input_tokens":20,"cache_creation_input_tokens":3,"output_tokens":7,"reasoning_tokens":5}}'
`;

describe("modelSettings of grok", () => {
  test("it has a token limit and the default model, and it plays off as low", () => {
    expect(modelSettings({ provider: "grok", reasoning: "off", thinking: "off" }, {})).toMatchObject({ id: "grok-4.7-build-fast", provider: "grok", tokenLimit: 1_000_000, reasoning: "low", thinking: "low" });
  });

  test("it refuses a cost limit and a temperature", () => {
    expect(() => modelSettings({ provider: "grok", costLimit: 1 }, {})).toThrow("the provider grok has a token limit, not a cost limit");
    expect(() => modelSettings({ provider: "grok", temperature: 1 }, {})).toThrow("the provider grok has no temperature");
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
    expect(log).toContain("--system-prompt-override rules");
  });

  test("the prompt tokens count the cached tokens, and the cost is 0", async () => {
    expect((await ask()).usage).toEqual({ promptTokens: 33, cachedTokens: 20, completionTokens: 7, reasoningTokens: 5, cost: 0 });
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
