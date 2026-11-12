import { basename, relative } from "node:path";
import { parseArgs } from "node:util";
import { safely } from "../game";
import { evolutionGenome, type PlayerRun } from "../genetic/evolution";
import { type Genome, readGenome } from "../genetic/genome";
import { providerProblem } from "../model/providers";
import { actionText, DEFAULT_PROVIDER, MODEL_PROVIDERS, modelLabel, REASONING, SPEND_WORDS, spendText, spentIn, STARTERS, tokensFromMillions } from "../protocol";
import { errorText, Harness, KNOWLEDGE_LEVELS, type KnowledgeLevel, loadBot, type ParentRecord } from "./harness";
import { limitOf, modelTotals, providerOf, readRecord, writeRecord } from "./record";

const USAGE = `Usage: bun run bot <name in bots/> [player|full] [--seed <0 to 0xffff>]
       bun run bot genetic --genome <Genome file>|<Evolution>:<Genome id> [player|full] [--seed <0 to 0xffff>]
       bun run bot model [<model id>] [player|full] [--provider ${MODEL_PROVIDERS.join("|")}] [--cost-limit <dollars>] [--token-limit <millions of tokens>] [--reasoning ${REASONING.join("|")}] [--thinking ${REASONING.join("|")}] [--coach <model id>] [--temperature <0 to 2>] [--starter ${STARTERS.join("|")}] [--no-stop-at-whiteout] [--continue <Run record>]`;

const { values, positionals } = parseArgs({
  args: process.argv.slice(2),
  allowPositionals: true,
  options: { provider: { type: "string" }, "cost-limit": { type: "string" }, "token-limit": { type: "string" }, reasoning: { type: "string" }, thinking: { type: "string" }, coach: { type: "string" }, temperature: { type: "string" }, starter: { type: "string" }, "no-stop-at-whiteout": { type: "boolean" }, continue: { type: "string" }, genome: { type: "string" }, seed: { type: "string" } },
});
const [name, ...rest] = positionals;
const isLevel = (arg: string): arg is KnowledgeLevel => (KNOWLEDGE_LEVELS as readonly string[]).includes(arg);
const ids = rest.filter((arg) => !isLevel(arg));
if (!name || ids.length > 1) {
  console.error(USAGE);
  process.exit(1);
}
const number = (value: string | undefined) => (value === undefined ? undefined : Number(value));
const model = { id: ids[0], provider: values.provider, costLimit: number(values["cost-limit"]), tokenLimit: values["token-limit"] === undefined ? undefined : tokensFromMillions(Number(values["token-limit"])), reasoning: values.reasoning, thinking: values.thinking, coach: values.coach === undefined ? undefined : { id: values.coach }, temperature: number(values.temperature), starter: values.starter, stopAtWhiteout: values["no-stop-at-whiteout"] ? false : undefined };
const seed = values.seed === undefined ? undefined : Number(values.seed);
if (seed !== undefined && !(Number.isInteger(seed) && seed >= 0 && seed <= 0xffff)) {
  console.error(`The seed ${values.seed} is not a whole number from 0 to 0xffff.`);
  process.exit(1);
}
const genome = values.genome === undefined ? undefined : await genomeFile(values.genome);
const loaded = await loadBot(name, model, genome?.genome).catch((error: unknown) => {
  console.error(errorText(error));
  process.exit(1);
});
if (loaded.genome && !genome) {
  console.error(`The Bot ${name} plays with a Genome: bun run bot ${name} --genome <Genome file>|<Evolution>:<Genome id>`);
  process.exit(1);
}
// A Genome of an Evolution plays as in the Evolution: with its goal, its frame limit, its Stuck limit and, with no --seed, its training seed.
const evolutionRun = genome?.run;
const bot = evolutionRun ? { ...loaded, goal: evolutionRun.goal, frameBudget: evolutionRun.frameBudget, noProgressLimit: evolutionRun.noProgressLimit } : loaded;

// `<Evolution>:<Genome id>`: a Genome of an Evolution of runs/evolutions/. Any other value is the path of a Genome file.
async function genomeFile(path: string): Promise<{ genome: Genome; run?: PlayerRun }> {
  const ofEvolution = /^([\w-]+):(\d+)$/.exec(path);
  try {
    return ofEvolution ? await evolutionGenome(ofEvolution[1], Number(ofEvolution[2])) : { genome: readGenome(await Bun.file(path).json()) };
  } catch (error) {
    console.error(`${path} is not a Genome: ${errorText(error)}`);
    process.exit(1);
  }
}
const provider = bot.model ? providerOf(bot.model) : DEFAULT_PROVIDER;
const problem = bot.model ? await providerProblem(provider) : null;
if (problem) {
  console.error(problem);
  process.exit(1);
}

// A continued Run takes the Knowledge level of its parent when the command gives none.
let parent: ParentRecord | undefined;
if (values.continue !== undefined) {
  const record = readRecord(await Bun.file(values.continue).json().catch(() => null));
  if (!record) {
    console.error(`${values.continue} is not a Run record`);
    process.exit(1);
  }
  parent = { name: basename(values.continue), record };
}

const knowledge = rest.find(isLevel) ?? parent?.record.header.knowledge ?? "player";
const harness = await Harness.open({
  knowledge,
  seed: seed ?? evolutionRun?.seed,
  parent,
  onAction: ({ action, result }) => {
    const call = actionText(action);
    const reason = "reason" in result ? `  ${result.reason}` : "";
    console.log(`${call.padEnd(24)} ${result.status.padEnd(10)} ${String(result.frames).padStart(6)} frames${reason}`);
    if ("text" in result) for (const message of result.text) console.log(`  "${message}"`);
  },
  onModelCall: ({ decision, error, usage, latencyMs }) => {
    const answer = decision ? `${decision.action}: ${decision.reason} (Mission: ${decision.mission}; Objective: ${decision.objective})` : `no action: ${error}`;
    const unit = bot.model ? limitOf(bot.model).unit : "dollars";
    console.log(`model ${(latencyMs / 1000).toFixed(1)} s, ${unit === "tokens" ? spendText({ unit, amount: spentIn(unit, usage) }) : `${usage.cost} $`}  ${answer}`);
  },
});
const limit = bot.model && limitOf(bot.model);
const settings = bot.model ? `, model ${modelLabel(bot.model)} on ${provider} (${limit && `${SPEND_WORDS[limit.unit].limit.toLowerCase()} ${spendText(limit)}`}, reasoning ${bot.model.reasoning}, thinking ${bot.model.thinking}, temperature ${bot.model.temperature ?? "of the model"}, starter ${bot.model.starter}, stop at a whiteout ${bot.model.stopAtWhiteout ? "on" : "off"})` : "";
const from = parent ? `, continues ${parent.name}` : "";
console.log(`Bot ${bot.name} ${bot.version}${settings}${from}, Knowledge level ${knowledge}: first Decision point at frame ${harness.frame}`);
const error = await harness.play(bot).then(
  () => null,
  (e: unknown) => e,
);
const record = harness.record();
console.log(`Run record: ${relative(process.cwd(), await writeRecord(record))}`);
if (error) console.error(`The Bot stops with an error: ${errorText(error)}`);

const { result } = record;
console.log(`Run end: ${result.endReason}, ${result.frames} frames, seed ${record.header.seed}, raw inputs ${result.rawInputs}${result.lastText === undefined ? "" : `, last text "${result.lastText}"`}${result.planLimit === undefined ? "" : `, ${result.planLimit}`}`);
console.log(`Milestones: ${result.milestones.join(", ") || "none"}`);
if (bot.model) {
  const totals = modelTotals(record.events);
  console.log(`Model calls: ${totals.calls}, tokens: ${totals.promptTokens} in, ${totals.completionTokens} out (${totals.reasoningTokens} of reasoning), cost: ${totals.cost} $`);
}
// A Run can end in a fade, where observe() cannot read the game.
const observation = safely(() => harness.observe());
const where =
  observation?.mode === "overworld" ? `${observation.map.name} (${observation.player.x}, ${observation.player.y}) facing ${observation.player.facing}`
  : observation?.mode === "battle" ? "in a battle"
  : "in a transition";
console.log(`End: ${where}, frame ${harness.frame}, screen ${harness.screenHash()}`);
for (const mon of observation?.party ?? []) {
  const moves = mon.moves.map((m) => `${m.name} ${m.pp}/${m.maxPp}`).join(", ");
  console.log(`Party: ${mon.nickname} (${mon.species}) level ${mon.level}, ${mon.hp}/${mon.maxHp} HP, status ${mon.status}, moves ${moves}`);
}
process.exit(error ? 1 : 0);
