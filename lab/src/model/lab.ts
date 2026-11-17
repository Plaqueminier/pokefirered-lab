import { appendFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { errorText } from "../harness/harness";
import type { Prompt } from "../harness/record";
import { readDecision } from "./decision";
import type { AskOptions } from "./openrouter";
import { modelClient, modelSettings, PlanLimitError } from "./providers";

export const LABS_DIR = join(import.meta.dir, "..", "..", "evals");
const DEFAULT_COST_LIMIT = 1;
const DEFAULT_REPEATS = 3;
const DEFAULT_CONCURRENCY = 4;

export type Answer = { key: string; model: string; action: string | null; reason: string | null; error: string | null; cost: number; promptTokens: number };

export type LabCall<F> = { key: string; model: string; prompt: Prompt; options?: AskOptions; label: string; fields: F };

export type AskLimits = { costLimit: number; concurrency: number };

export async function readResults<R extends Answer>(file: string): Promise<R[]> {
  const read = Bun.file(file);
  if (!(await read.exists())) return [];
  return (await read.text()).split("\n").filter(Boolean).map((line) => JSON.parse(line) as R);
}

export function hashOf(prompt: Prompt): string {
  return Bun.hash(JSON.stringify(prompt)).toString(36);
}

function clientOf(model: string) {
  const [, provider, id, reasoning] = model.match(/^([^:]+):([^@]+)(?:@(.+))?$/) ?? [];
  if (!provider) throw new Error(`write a model as <provider>:<id>[@<reasoning>], not "${model}"`);
  return modelClient(modelSettings({ provider, id, reasoning }));
}

export async function askAll<F extends object>(file: string, calls: LabCall<F>[], { costLimit, concurrency }: AskLimits): Promise<void> {
  await mkdir(dirname(file), { recursive: true });
  const done = new Set((await readResults(file)).filter((r) => r.error === null).map((r) => r.key));
  const jobs = calls.filter((call) => !done.has(call.key));
  const clients = new Map([...new Set(jobs.map((job) => job.model))].map((model) => [model, clientOf(model)]));
  console.log(`${jobs.length} calls to make`);
  let spent = 0;
  let stopped: string | null = null;
  let next = 0;
  const worker = async () => {
    while (next < jobs.length && stopped === null) {
      const job = jobs[next++];
      const result: Answer & F = { ...job.fields, key: job.key, model: job.model, action: null, reason: null, error: null, cost: 0, promptTokens: 0 };
      try {
        const reply = await (clients.get(job.model) ?? clientOf(job.model))(job.prompt, job.options);
        result.cost = reply.usage.cost;
        result.promptTokens = reply.usage.promptTokens;
        const decision = readDecision(reply.content, job.options?.format?.schema.required);
        result.action = decision.action;
        result.reason = decision.reason;
      } catch (error) {
        result.error = errorText(error);
        if (error instanceof PlanLimitError) stopped = result.error;
      }
      spent += result.cost;
      if (spent >= costLimit) stopped = `the cost limit of $${costLimit}`;
      await appendFile(file, `${JSON.stringify(result)}\n`);
      console.log(`${next}/${jobs.length} ${job.label}: ${result.action ?? `ERROR ${result.error}`}`);
    }
  };
  await Promise.all(Array.from({ length: concurrency }, worker));
  console.log(`spent $${spent.toFixed(4)}${stopped ? `, stopped: ${stopped}` : ""}`);
}

export function option(args: string[], name: string): string | undefined {
  const at = args.indexOf(`--${name}`);
  return at < 0 ? undefined : args[at + 1];
}

export type LabOptions = { models: string[]; repeats: number; only: RegExp | null } & AskLimits;

export function runOptions(args: string[]): LabOptions {
  const models = option(args, "models")?.split(",");
  if (!models) throw new Error("--models <provider>:<id>[@<reasoning>],... is necessary");
  const only = option(args, "only");
  return {
    models,
    repeats: Number(option(args, "repeats") ?? DEFAULT_REPEATS),
    only: only ? new RegExp(only) : null,
    costLimit: Number(option(args, "cost-limit") ?? DEFAULT_COST_LIMIT),
    concurrency: Number(option(args, "concurrency") ?? DEFAULT_CONCURRENCY),
  };
}
