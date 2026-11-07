import { appendFile, mkdir, readdir } from "node:fs/promises";
import { join } from "node:path";
import { errorText } from "../harness/harness";
import { type ModelEvent, type Prompt, RUNS_DIR, readRecord } from "../harness/record";
import { readDecision } from "./decision";
import { modelClient, modelSettings, PlanLimitError } from "./providers";

const LAB_DIR = join(import.meta.dir, "..", "..", "evals", "learn-move");
const MOMENTS_FILE = join(LAB_DIR, "moments.json");
const REPORT_FILE = join(LAB_DIR, "moments.md");
const RESULTS_FILE = join(LAB_DIR, "results.jsonl");
const SITUATION = "a move to forget";
const DEFAULT_COST_LIMIT = 1;
const DEFAULT_REPEATS = 3;
const DEFAULT_CONCURRENCY = 4;
// battle_moves.h: these moves have power 1. They do damage, but no fixed power says how much.
const VARYING_POWER = new Set(["GUILLOTINE", "HORN DRILL", "SONICBOOM", "LOW KICK", "COUNTER", "SEISMIC TOSS", "DRAGON RAGE", "FISSURE", "NIGHT SHADE", "BIDE", "PSYWAVE", "SUPER FANG", "FLAIL", "REVERSAL", "RETURN", "PRESENT", "FRUSTRATION", "MAGNITUDE", "HIDDEN POWER", "MIRROR COAT", "ENDEAVOR", "SHEER COLD"]);
const HINT_START = "This is an important choice.";
const TWO_DAMAGE = "Keep at least 2 damage moves when you can: with only one, a foe can resist it and its PP can run out.";
const GUIDE = "This is an important choice, because a forgotten move is lost. A move with no damage helps only while the foe is alive: a Pokémon needs damage moves to win. Keep damage moves of two types when you can, so that one foe cannot resist all of them, and compare them with your next big battle.";

type Move = { name: string; type: string; power: number | "none" | "varies"; maxPp: number };

export type Moment = {
  id: string;
  run: string;
  version: string;
  model: string;
  mon: string;
  species: string;
  level: number;
  types: string[];
  newMove: Move;
  known: Move[];
  action: string;
  reason: string;
  mission: string;
  prompt: Prompt;
};

const isDamage = (move: Move) => move.power !== "none";

function moveOf(name: string, type: string, power: string, maxPp: string): Move {
  const known = power === "---" ? (VARYING_POWER.has(name) ? "varies" : "none") : Number(power);
  return { name, type, power: known, maxPp: Number(maxPp) };
}

// Bot version 29 writes "max PP 15" and the species after the nickname; the older records write "PP 3/15" and the nickname alone.
const KNOWN_LINE = /^- \d\. (.+?): ([^,]+), power (\S+), accuracy \S+, (?:max )?PP (?:\d+\/)?(\d+)\./;
const LEARN_LINE = /^(.+?)(?: \([^)]+\))? wants to learn (.+?) \(([^,]+), power (\S+), accuracy \S+, (?:max )?PP (?:\d+\/)?(\d+)\)/;

/** Reads the learn-move part of a recorded prompt. It returns null for a prompt of another shape. */
export function readBlock(user: string): Pick<Moment, "mon" | "species" | "level" | "types" | "newMove" | "known" | "mission"> | null {
  const lines = user.split("\n");
  const learn = lines.map((line) => line.match(LEARN_LINE)).find((match) => match !== null);
  if (!learn) return null;
  const [, mon, name, type, power, maxPp] = learn;
  const known = lines.flatMap((line) => {
    const match = line.match(KNOWN_LINE);
    return match ? [moveOf(match[1], match[2], match[3], match[4])] : [];
  });
  // A Run of bot version 10 or below writes "- " in place of the number of the party slot.
  const mons = lines.flatMap((line, at) => {
    const match = line.match(/^(?:\d\.|-) (.+?)(?: \(([^)]+)\))?: level (\d+),.*?Type ([^.]+)\./);
    return match?.[1] === mon ? [{ match, at }] : [];
  });
  // Two Pokémon can have the same nickname: only the moves tell them apart.
  const knowsTheMoves = ({ at }: { at: number }) => {
    const end = lines.slice(at + 1).findIndex((line) => !line.startsWith("  - "));
    const moves = lines.slice(at + 1, at + 1 + end).map((line) => line.slice(4).split(":")[0]);
    return moves.join() === known.map((move) => move.name).join();
  };
  const about = (mons.find(knowsTheMoves) ?? mons[0])?.match;
  if (known.length === 0 || !about) return null;
  return {
    mon,
    species: about[2] ?? about[1],
    level: Number(about[3]),
    types: about[4].split(", "),
    newMove: moveOf(name, type, power, maxPp),
    known,
    mission: lines.find((line) => line.startsWith("Mission:"))?.replace("Mission: ", "") ?? "",
  };
}

export async function extractMoments(): Promise<Moment[]> {
  const names = (await readdir(RUNS_DIR)).filter((name) => name.endsWith(".json")).sort();
  const moments: Moment[] = [];
  for (const name of names) {
    const record = readRecord(await Bun.file(join(RUNS_DIR, name)).json());
    const asked = (record?.events ?? []).filter((event): event is ModelEvent => event.type === "model" && event.situation === SITUATION && event.decision !== null);
    asked.forEach((event, index) => {
      const block = readBlock(event.prompt.user);
      const run = name.replace(/\.json$/, "");
      if (!block || !event.decision) throw new Error(`the learn-move prompt ${index + 1} of ${run} is not read`);
      moments.push({ ...block, id: `${run.slice(0, 5)}-${index + 1}`, run, version: run.split("-")[2], model: event.model, action: event.decision.action, reason: event.decision.reason, prompt: event.prompt });
    });
  }
  return moments;
}

export type Outcome = { forgets: string | null; damage: Move[]; oneDamage: boolean; noStab: boolean; statusOverDamage: boolean };

/** What an answer leaves. It returns null for an answer that is neither forget nor keep. */
export function outcomeOf({ known, newMove, types }: Pick<Moment, "known" | "newMove" | "types">, action: string): Outcome | null {
  const words = action.trim().match(/^(forget|keep)\b\s*(.*)$/i);
  if (!words) return null;
  const isKeep = words[1].toLowerCase() === "keep";
  const place = Number(words[2]);
  const forgotten = isKeep ? null : (known[place - 1] ?? known.find((move) => move.name.toLowerCase() === words[2].toLowerCase()));
  if (!isKeep && !forgotten) return null;
  const after = isKeep ? known : [...known.filter((move) => move !== forgotten), newMove];
  const damage = after.filter(isDamage);
  const stab = (moves: Move[]) => moves.filter(isDamage).some((move) => types.includes(move.type));
  return {
    forgets: forgotten?.name ?? null,
    damage,
    oneDamage: damage.length === 1,
    noStab: stab(known) && !stab(after),
    statusOverDamage: forgotten !== undefined && forgotten !== null && isDamage(forgotten) && !isDamage(newMove) && known.some((move) => !isDamage(move)),
  };
}

function damageList(moves: Move[], types: string[]): string {
  return moves.map((move) => `${move.name} (${move.type}${types.includes(move.type) ? ", STAB" : ""}, max PP ${move.maxPp})`).join(", ");
}

function withTwoDamage(lines: string[]): string[] {
  const shown = [...lines];
  shown.splice(lines.findLastIndex((line) => KNOWN_LINE.test(line)) + 1, 0, TWO_DAMAGE);
  return shown;
}

function withAfter(lines: string[], moment: Moment): string[] {
  const left = (action: string) => {
    const damage = outcomeOf(moment, action)?.damage ?? [];
    return `${moment.mon} then has ${damage.length} damage ${damage.length === 1 ? "move" : "moves"}${damage.length === 0 ? "" : `: ${damageList(damage, moment.types)}`}.`;
  };
  let place = 0;
  const shown = lines.map((line) => {
    if (!KNOWN_LINE.test(line)) return line;
    place += 1;
    return `${line} If you forget it: ${left(`forget ${place}`)}`;
  });
  const last = shown.findLastIndex((line) => KNOWN_LINE.test(line));
  shown.splice(last + 1, 0, `If you keep your moves: ${left("keep")}`);
  return shown;
}

function withTypes(lines: string[], moment: Moment): string[] {
  let place = 0;
  return lines.map((line) => {
    if (!KNOWN_LINE.test(line)) return line;
    place += 1;
    const forgotten = moment.known[place - 1];
    const left = outcomeOf(moment, `forget ${place}`)?.damage ?? [];
    return isDamage(forgotten) && !left.some((move) => move.type === forgotten.type) ? `${line} You lose your only ${forgotten.type} damage move.` : line;
  });
}

function withRefusal(lines: string[]): string[] {
  return lines.map((line) => line.replace(/^(It already knows .*), it must forget one of them:$/, "$1, it must forget one of them, or you can refuse it with keep when it is not better than the move that it replaces:"));
}

function withMaxPp(lines: string[]): string[] {
  const shown = lines.map((line) => (KNOWN_LINE.test(line) || LEARN_LINE.test(line) ? line.replace(/PP \d+\/(\d+)/, "max PP $1") : line));
  const last = shown.findLastIndex((line) => KNOWN_LINE.test(line.replace(/max PP (\d+)/, "PP 0/$1")));
  shown.splice(last + 1, 0, "A Pokémon Center gives back all the PP, so this list shows only the maximum PP of each move.");
  return shown;
}

function withZero(user: string): string {
  return user.replace(/([A-Z][A-Z' -]*?)(: | \()([^,\n]+), power ---/g, (_, name: string, separator: string, type: string) => `${name}${separator}${type}, power ${VARYING_POWER.has(name) ? "varies" : "0"}`);
}

function withHint(lines: string[], hint: string | null): string[] {
  return lines.flatMap((line) => (line.startsWith(HINT_START) ? (hint ? [hint] : []) : [line]));
}

const EDITS = ["two", "types", "refuse", "after", "maxpp", "nohint", "guide", "zero"] as const;

/** A variant is "base", or edit names with + between them, for example zero+maxpp. The edits are in the order of EDITS, so a name order changes nothing. */
export function variantPrompt(moment: Moment, variant: string): Prompt {
  if (variant === "base") return moment.prompt;
  const asked = variant.split("+");
  const unknown = asked.find((edit) => !(EDITS as readonly string[]).includes(edit));
  if (unknown) throw new Error(`the edit "${unknown}" does not exist: ${EDITS.join(", ")}`);
  let lines = moment.prompt.user.split("\n");
  if (asked.includes("two")) lines = withTwoDamage(lines);
  if (asked.includes("types")) lines = withTypes(lines, moment);
  if (asked.includes("refuse")) lines = withRefusal(lines);
  if (asked.includes("after")) lines = withAfter(lines, moment);
  if (asked.includes("maxpp")) lines = withMaxPp(lines);
  if (asked.includes("nohint")) lines = withHint(lines, null);
  if (asked.includes("guide")) lines = withHint(lines, GUIDE);
  const user = lines.join("\n");
  return { ...moment.prompt, user: asked.includes("zero") ? withZero(user) : user };
}

function moveCell(move: Move): string {
  const power = move.power === "none" ? "---" : move.power;
  return `${move.name} (${move.type} ${power}, ${move.maxPp})`;
}

function flagsOf(outcome: Outcome | null): string {
  if (!outcome) return "unread";
  const flags = [outcome.oneDamage && "one damage move", outcome.noStab && "no STAB", outcome.statusOverDamage && "status over damage"].filter(Boolean);
  return flags.join(", ") || "-";
}

function cell(text: string): string {
  return text.replaceAll("|", "/").replaceAll("\n", " ");
}

function momentsReport(moments: Moment[]): string {
  const rows = moments.map((m) => `| ${m.id} | v${m.version} | ${m.model} | ${m.species} L${m.level} | ${moveCell(m.newMove)} | ${m.known.map(moveCell).join("<br>")} | ${cell(m.action)} | ${flagsOf(outcomeOf(m, m.action))} | ${cell(m.reason)} | ${cell(m.mission)} |`);
  return ["# Learn-move moments of the Runs", "", "Each move shows its type, its power and its maximum PP.", "", "| Moment | Bot | Model | Pokémon | New move | Moves | Answer | Flags | Reason | Mission |", "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |", ...rows, ""].join("\n");
}

type Result = { key: string; id: string; variant: string; model: string; repeat: number; action: string | null; reason: string | null; error: string | null; cost: number };

async function readResults(): Promise<Result[]> {
  const file = Bun.file(RESULTS_FILE);
  if (!(await file.exists())) return [];
  return (await file.text()).split("\n").filter(Boolean).map((line) => JSON.parse(line) as Result);
}

function keyOf(id: string, variant: string, model: string, repeat: number, prompt: Prompt): string {
  return `${id}|${variant}|${model}|${repeat}|${Bun.hash(JSON.stringify(prompt)).toString(36)}`;
}

function clientOf(model: string) {
  const [, provider, id, reasoning] = model.match(/^([^:]+):([^@]+)(?:@(.+))?$/) ?? [];
  if (!provider) throw new Error(`write a model as <provider>:<id>[@<reasoning>], not "${model}"`);
  return modelClient(modelSettings({ provider, id, reasoning }));
}

type RunOptions = { models: string[]; variants: string[]; repeats: number; only: RegExp | null; costLimit: number; concurrency: number };

async function play(moments: Moment[], { models, variants, repeats, only, costLimit, concurrency }: RunOptions): Promise<void> {
  const chosen = moments.filter((m) => !only || only.test(`${m.id} ${m.species} ${m.newMove.name}`));
  const results = await readResults();
  const done = new Set(results.filter((r) => r.error === null).map((r) => r.key));
  const jobs = chosen.flatMap((moment) => variants.flatMap((variant) => models.flatMap((model) => Array.from({ length: repeats }, (_, repeat) => {
    const prompt = variantPrompt(moment, variant);
    return { moment, variant, model, repeat, prompt, key: keyOf(moment.id, variant, model, repeat, prompt) };
  })))).filter((job) => !done.has(job.key));
  const clients = new Map(models.map((model) => [model, clientOf(model)]));
  console.log(`${chosen.length} moments, ${jobs.length} calls to make`);
  let spent = 0;
  let stopped: string | null = null;
  let next = 0;
  const worker = async () => {
    while (next < jobs.length && stopped === null) {
      const job = jobs[next++];
      const result: Result = { key: job.key, id: job.moment.id, variant: job.variant, model: job.model, repeat: job.repeat, action: null, reason: null, error: null, cost: 0 };
      try {
        const reply = await (clients.get(job.model) ?? clientOf(job.model))(job.prompt);
        result.cost = reply.usage.cost;
        const decision = readDecision(reply.content);
        result.action = decision.action;
        result.reason = decision.reason;
      } catch (error) {
        result.error = errorText(error);
        if (error instanceof PlanLimitError) stopped = result.error;
      }
      spent += result.cost;
      if (spent >= costLimit) stopped = `the cost limit of $${costLimit}`;
      await appendFile(RESULTS_FILE, `${JSON.stringify(result)}\n`);
      console.log(`${next}/${jobs.length} ${job.moment.id} ${job.variant} ${job.model}: ${result.action ?? `ERROR ${result.error}`}`);
    }
  };
  await Promise.all(Array.from({ length: concurrency }, worker));
  console.log(`spent $${spent.toFixed(4)}${stopped ? `, stopped: ${stopped}` : ""}`);
}

function percent(part: number, whole: number): string {
  return whole === 0 ? "-" : `${Math.round((part * 100) / whole)}%`;
}

export function report(moments: Moment[], results: Result[], variants: string[]): string {
  const byId = new Map(moments.map((m) => [m.id, m]));
  const read = results.filter((r) => r.action !== null && variants.includes(r.variant) && byId.has(r.id)).map((r) => {
    const moment = byId.get(r.id) as Moment;
    return { ...r, moment, outcome: outcomeOf(moment, r.action as string) };
  });
  const groups = Map.groupBy(read, (r) => `${r.model} | ${r.variant}`);
  const summary = [...groups].sort(([a], [b]) => a.localeCompare(b)).map(([name, rows]) => {
    const share = (test: (outcome: Outcome) => boolean) => percent(rows.filter((r) => r.outcome && test(r.outcome)).length, rows.length);
    return `${name} | n=${rows.length} | keep ${share((o) => o.forgets === null)} | one damage ${share((o) => o.oneDamage)} | no STAB ${share((o) => o.noStab)} | status over damage ${share((o) => o.statusOverDamage)} | unread ${percent(rows.filter((r) => !r.outcome).length, rows.length)}`;
  });
  const detail = [...Map.groupBy(read, (r) => r.id)].flatMap(([id, rows]) => {
    const moment = byId.get(id) as Moment;
    const head = `${id} ${moment.species} +${moment.newMove.name} [${moment.known.map((move) => move.name).join(", ")}] (in the Run: ${moment.action})`;
    return [head, ...[...Map.groupBy(rows, (r) => `${r.model} | ${r.variant}`)].sort(([a], [b]) => a.localeCompare(b)).map(([name, group]) => {
      const counts = Map.groupBy(group, (r) => r.outcome?.forgets ?? (r.outcome ? "keep" : `unread: ${r.action}`));
      return `  ${name}: ${[...counts].map(([answer, same]) => `${answer}×${same.length}`).join(", ")}`;
    })];
  });
  return [...summary, "", ...detail].join("\n");
}

function option(args: string[], name: string): string | undefined {
  const at = args.indexOf(`--${name}`);
  return at < 0 ? undefined : args[at + 1];
}

async function main(args: string[]): Promise<void> {
  await mkdir(LAB_DIR, { recursive: true });
  const [command] = args;
  if (command === "extract") {
    const moments = await extractMoments();
    await Bun.write(MOMENTS_FILE, JSON.stringify(moments));
    await Bun.write(REPORT_FILE, momentsReport(moments));
    console.log(`${moments.length} moments: ${REPORT_FILE}`);
    return;
  }
  const moments = (await Bun.file(MOMENTS_FILE).json()) as Moment[];
  const variants = (option(args, "variants") ?? "base").split(",");
  for (const variant of variants) variantPrompt(moments[0], variant);
  if (command === "show") {
    const moment = moments.find((m) => m.id === args[1]);
    if (!moment) throw new Error(`no moment ${args[1]}`);
    console.log(variantPrompt(moment, variants[0]).user);
    return;
  }
  if (command === "run") {
    const models = option(args, "models")?.split(",");
    if (!models) throw new Error("--models <provider>:<id>[@<reasoning>],... is necessary");
    const only = option(args, "only");
    await play(moments, { models, variants, repeats: Number(option(args, "repeats") ?? DEFAULT_REPEATS), only: only ? new RegExp(only) : null, costLimit: Number(option(args, "cost-limit") ?? DEFAULT_COST_LIMIT), concurrency: Number(option(args, "concurrency") ?? DEFAULT_CONCURRENCY) });
  } else if (command !== "report") {
    throw new Error("the commands are extract, show <moment>, run and report");
  }
  console.log(report(moments, await readResults(), variants));
}

if (import.meta.main) await main(process.argv.slice(2));
