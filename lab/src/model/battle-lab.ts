import { mkdir, readdir } from "node:fs/promises";
import { join } from "node:path";
import { Harness, type ReplayedState, type ReplayStop } from "../harness/harness";
import { botAtFrame, currentSettings, type ModelEvent, type ModelSettings, RUNS_DIR, type RunEvent, readRunRecord } from "../harness/record";
import { askedOf } from "./decision";
import { type Answer, askAll, hashOf, type LabCall, LABS_DIR, type LabOptions, readResults, runOptions } from "./lab";
import { BOT_VERSION, openingPrompt, type PromptInput } from "./opening";
import { showsAtlas, turnKind } from "./prompt";

const LAB_DIR = join(LABS_DIR, "battle");
const MOMENTS_FILE = join(LAB_DIR, "moments.json");
const RESULTS_FILE = join(LAB_DIR, "results.jsonl");
const REPORT_FILE = join(LAB_DIR, "report.md");

type Kind = "toxic" | "levitate" | "two-turn" | "clear";

type MomentDef = { run: string; frame: number; kind: Kind; good: string[]; bad: string[] };

const KOGA_FIGHT = ["fight 2", "fight 0"];
const twoTurn = (frame: number, good: string[]): MomentDef => ({ run: "00073", frame, kind: "two-turn", good, bad: ["fight 1"] });
const clear = (run: string, frame: number, move: number): MomentDef => ({ run, frame, kind: "clear", good: [`fight ${move}`], bad: [] });

// Moments of the A/B of spec #100. two-turn: the model chose a 2-turn move with "1 hit to KO" although a 1-turn move of accuracy 95 or more had it too.
// clear: a trainer battle, the Pokémon over half of its HP, and a single move with "1 hit to KO", 1 turn and accuracy 95 or more.
const MOMENTS: readonly MomentDef[] = [
  { run: "00073", frame: 1632831, kind: "toxic", good: ["use ANTIDOTE", ...KOGA_FIGHT], bad: ["fight 1", "fight 3"] },
  { run: "00073", frame: 1634993, kind: "toxic", good: ["use ANTIDOTE"], bad: ["use SUPER POTION", "use POTION", "fight 1", "fight 3"] },
  { run: "00073", frame: 1636213, kind: "toxic", good: ["use ANTIDOTE"], bad: ["fight 1", "fight 3"] },
  { run: "00073", frame: 1627742, kind: "levitate", good: KOGA_FIGHT, bad: ["fight 1"] },
  { run: "00073", frame: 1629358, kind: "levitate", good: KOGA_FIGHT, bad: ["fight 1"] },
  ...[873954, 1460828, 1470540, 1479905].map((frame) => twoTurn(frame, ["fight 0", "fight 2"])),
  ...[915599, 938523, 967091, 1037205, 1340160].map((frame) => twoTurn(frame, ["fight 2"])),
  clear("00073", 126364, 0),
  clear("00073", 275606, 1),
  clear("00073", 504062, 2),
  clear("00073", 770867, 2),
  clear("00073", 1505072, 0),
  clear("00075", 137970, 3),
  clear("00075", 210840, 3),
  clear("00075", 438767, 1),
  clear("00076", 101612, 2),
  clear("00076", 191812, 1),
  clear("00076", 435762, 3),
  clear("00077", 226686, 3),
  clear("00077", 569766, 0),
  clear("00078", 192077, 2),
  clear("00078", 447762, 2),
  clear("00078", 637688, 2),
  clear("00078", 768841, 0),
  clear("00079", 291450, 2),
  clear("00079", 412462, 1),
  clear("00079", 662570, 3),
];

export type BattleMoment = MomentDef & { id: string; record: string; runBot: string; inRun: string; settings: ModelSettings; input: Omit<PromptInput, "events" | "frame" | "whiteouts"> & Partial<Pick<PromptInput, "frame" | "whiteouts">> & { events: number } };

type MomentsFile = { events: Record<string, RunEvent[]>; moments: BattleMoment[] };

type Result = Answer & { id: string; kind: Kind; bot: string; repeat: number };

function momentPrompt(moment: Pick<BattleMoment, "settings" | "input">, events: readonly RunEvent[]): ReturnType<typeof openingPrompt> {
  // A moments file from before the Whiteout limit has no frame and no whiteouts.
  const input = { ...moment.input, frame: moment.input.frame ?? 0, whiteouts: moment.input.whiteouts ?? 0, events: events.slice(0, moment.input.events) };
  const { observation, noProgress } = input;
  const turn = turnKind(observation.waitingFor.kind, input.events, noProgress, observation.party.length);
  const asked = askedOf(observation, showsAtlas(turn));
  if (!asked) throw new Error(`the Bot does not know the Decision point ${observation.waitingFor.kind}`);
  return openingPrompt(currentSettings(moment.settings), input, asked, turn);
}

function withoutTexts(event: RunEvent): RunEvent {
  if (event.type !== "model" && event.type !== "summary") return event;
  const { reasoning: _, ...kept } = event;
  return { ...kept, prompt: { system: "", user: "" }, answer: "" };
}

async function extractRun(name: string, defs: readonly MomentDef[]): Promise<{ events: RunEvent[]; moments: BattleMoment[] }> {
  const record = await readRunRecord(name);
  if (!record) throw new Error(`${name} is not a Run record`);
  const wanted = defs.map((def) => {
    const at = record.events.findIndex((e) => e.type === "model" && e.frame === def.frame);
    if (at < 0) throw new Error(`${name} has no Model call at the frame ${def.frame}`);
    const last = record.events.findLastIndex((e, i) => i < at && e.type === "model" && !e.prompt.turns);
    return { def, at, last };
  });
  const stops = new Map<number, ReplayStop>();
  for (const { at, last } of wanted) for (const index of last < 0 ? [at] : [last, at]) stops.set(index, { frame: record.events[index].frame, events: index });
  const states = new Map<number, ReplayedState>();
  console.log(`${name}: replay to ${Math.max(...stops.keys())} events`);
  await Harness.replayStops({ name, record }, [...stops.values()].sort((a, b) => a.events - b.events), (stop, state) => states.set(stop.events, state));
  const longest = states.get(Math.max(...stops.keys()))?.events ?? [];
  const events = longest.map(withoutTexts);
  const moments = wanted.map(({ def, at, last }): BattleMoment => {
    const state = states.get(at);
    if (!state) throw new Error(`the replay of ${name} did not reach the frame ${def.frame}`);
    if (!Bun.deepEquals(state.events, longest.slice(0, state.events.length))) throw new Error(`the events of ${name} at the frame ${def.frame} are not the start of its later events`);
    const call = record.events[at] as ModelEvent;
    const bot = botAtFrame(record.header, def.frame);
    if (!bot.model) throw new Error(`${name} is not a Run of a model bot`);
    const { events: _, ...read } = state;
    const moment = { ...def, id: `${def.run}@${def.frame}`, record: name, runBot: bot.version, inRun: call.decision?.action ?? "", settings: bot.model, input: { ...read, before: last < 0 ? null : (states.get(last)?.observation ?? null), events: state.events.length } };
    const live = momentPrompt(moment, state.events).prompt;
    if (!Bun.deepEquals(momentPrompt(JSON.parse(JSON.stringify(moment)), events).prompt, live)) throw new Error(`the snapshot of ${moment.id} does not give the prompt of the replay`);
    if (call.stuck !== undefined && call.stuck !== read.noProgress.stuck) console.log(`  ${moment.id}: ${read.noProgress.stuck} Decision points with no progress, ${call.stuck} in the Run`);
    return moment;
  });
  return { events, moments };
}

async function extract(): Promise<MomentsFile> {
  const names = (await readdir(RUNS_DIR)).filter((name) => name.endsWith(".json"));
  const file: MomentsFile = { events: {}, moments: [] };
  for (const [run, defs] of Map.groupBy(MOMENTS, (def) => def.run)) {
    const name = names.find((n) => n.startsWith(`${run}-`));
    if (!name) throw new Error(`no Run record ${run} in ${RUNS_DIR}`);
    const { events, moments } = await extractRun(name, defs);
    file.events[name] = events;
    file.moments.push(...moments);
  }
  return file;
}

function scoreOf(moment: MomentDef, action: string): "good" | "bad" | "other" {
  const said = action.trim().toLowerCase();
  const starts = (prefixes: string[]) => prefixes.some((prefix) => said.startsWith(prefix.toLowerCase()));
  return starts(moment.good) ? "good" : starts(moment.bad) ? "bad" : "other";
}

function promptOf(file: MomentsFile, moment: BattleMoment) {
  return momentPrompt(moment, file.events[moment.record]);
}

async function play(file: MomentsFile, { models, repeats, only, ...limits }: LabOptions): Promise<void> {
  const chosen = file.moments.filter((m) => !only || only.test(`${m.id} ${m.kind}`));
  console.log(`${chosen.length} moments, bot version ${BOT_VERSION}`);
  const calls = chosen.flatMap((moment) => {
    const { prompt, format } = promptOf(file, moment);
    return models.flatMap((model) => Array.from({ length: repeats }, (_, repeat): LabCall<Omit<Result, keyof Answer>> => ({
      key: `${moment.id}|${model}|${repeat}|v${BOT_VERSION}|${hashOf(prompt)}`,
      model,
      prompt,
      options: { format },
      label: `${moment.id} ${moment.kind} ${model}`,
      fields: { id: moment.id, kind: moment.kind, bot: BOT_VERSION, repeat },
    })));
  });
  await askAll(RESULTS_FILE, calls, limits);
}

function report(moments: readonly BattleMoment[], results: readonly Result[]): string {
  const byId = new Map(moments.map((m) => [m.id, m]));
  // The last answer of a bot version wins: its prompt can change while the version is in work.
  const last = new Map(results.filter((r) => r.action !== null && byId.has(r.id)).map((r) => [`${r.id}|${r.model}|${r.bot}|${r.repeat}`, r]));
  const read = [...last.values()].flatMap((r) => {
    const moment = byId.get(r.id);
    return moment && r.action !== null ? [{ ...r, action: r.action, score: scoreOf(moment, r.action) }] : [];
  });
  const name = (r: Result) => `v${r.bot} | ${r.model}`;
  const groups = [...Map.groupBy(read, (r) => `${r.kind} | ${name(r)}`)].sort(([a], [b]) => a.localeCompare(b));
  const count = (rows: typeof read, score: string) => rows.filter((r) => r.score === score).length;
  const summary = groups.map(([group, rows]) => `| ${group} | ${rows.length} | ${count(rows, "good")} | ${count(rows, "bad")} | ${count(rows, "other")} | ${Math.round(rows.reduce((sum, r) => sum + r.promptTokens, 0) / rows.length)} |`);
  const detail = moments.flatMap((m) => {
    const rows = read.filter((r) => r.id === m.id);
    if (rows.length === 0) return [];
    const head = `- ${m.id} ${m.kind} (in the Run, bot ${m.runBot}: ${m.inRun}; good: ${m.good.join(", ")}; bad: ${m.bad.join(", ") || "none"})`;
    return [head, ...[...Map.groupBy(rows, name)].sort(([a], [b]) => a.localeCompare(b)).map(([group, same]) => `  - ${group}: ${same.map((r) => `${r.action.slice(0, 40)} [${r.score}]`).join("; ")}`)];
  });
  return ["# Battle moments", "", "| Kind | Bot | Model | Answers | Good | Bad | Other | Mean prompt tokens |", "| --- | --- | --- | --- | --- | --- | --- | --- |", ...summary, "", "## Answers at each moment", "", ...detail, ""].join("\n");
}

async function main(args: string[]): Promise<void> {
  await mkdir(LAB_DIR, { recursive: true });
  const [command] = args;
  if (command === "extract") {
    const file = await extract();
    await Bun.write(MOMENTS_FILE, JSON.stringify(file));
    console.log(`${file.moments.length} moments: ${MOMENTS_FILE}`);
    return;
  }
  const file = (await Bun.file(MOMENTS_FILE).json()) as MomentsFile;
  if (command === "show") {
    const moment = file.moments.find((m) => m.id === args[1]);
    if (!moment) throw new Error(`no moment ${args[1]}`);
    const { prompt } = promptOf(file, moment);
    console.log(`${prompt.system}\n\n---\n\n${prompt.user}`);
    return;
  }
  if (command === "run") await play(file, runOptions(args));
  else if (command !== "report") throw new Error("the commands are extract, show <moment>, run and report");
  const text = report(file.moments, await readResults<Result>(RESULTS_FILE));
  await Bun.write(REPORT_FILE, text);
  console.log(text);
}

if (import.meta.main) await main(process.argv.slice(2));
