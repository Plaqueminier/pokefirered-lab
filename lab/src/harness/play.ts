import { relative } from "node:path";
import { parseArgs } from "node:util";
import { safely } from "../game";
import { actionText, errorText, Harness, KNOWLEDGE_LEVELS, type KnowledgeLevel, loadBot } from "./harness";
import { modelTotals, REASONING, writeRecord } from "./record";

const USAGE = `Usage: bun run bot <name> [player|full]
       bun run bot model [<OpenRouter model id>] [player|full] [--cost-limit <dollars>] [--reasoning ${REASONING.join("|")}] [--temperature <0 to 2>]`;

const { values, positionals } = parseArgs({
  args: process.argv.slice(2),
  allowPositionals: true,
  options: { "cost-limit": { type: "string" }, reasoning: { type: "string" }, temperature: { type: "string" } },
});
const [name, ...rest] = positionals;
const isLevel = (arg: string): arg is KnowledgeLevel => (KNOWLEDGE_LEVELS as readonly string[]).includes(arg);
const knowledge = rest.find(isLevel) ?? "player";
const ids = rest.filter((arg) => !isLevel(arg));
if (!name || ids.length > 1) {
  console.error(USAGE);
  process.exit(1);
}
const number = (value: string | undefined) => (value === undefined ? undefined : Number(value));
const model = { id: ids[0], costLimit: number(values["cost-limit"]), reasoning: values.reasoning, temperature: number(values.temperature) };
const bot = await loadBot(name, model).catch((error: unknown) => {
  console.error(errorText(error));
  process.exit(1);
});

const harness = await Harness.open({
  knowledge,
  onAction: ({ action, result }) => {
    const call = actionText(action);
    const reason = "reason" in result ? `  ${result.reason}` : "";
    console.log(`${call.padEnd(24)} ${result.status.padEnd(10)} ${String(result.frames).padStart(6)} frames${reason}`);
    if ("text" in result) for (const message of result.text) console.log(`  "${message}"`);
  },
  onModelCall: ({ decision, error, usage, latencyMs }) => {
    const answer = decision ? `${decision.action}: ${decision.reason} (Objective: ${decision.objective})` : `no action: ${error}`;
    console.log(`model ${(latencyMs / 1000).toFixed(1)} s, ${usage.cost} $  ${answer}`);
  },
});
const settings = bot.model ? `, model ${bot.model.id} (cost limit ${bot.model.costLimit} $, reasoning ${bot.model.reasoning}, temperature ${bot.model.temperature ?? "of the model"})` : "";
console.log(`Bot ${bot.name} ${bot.version}${settings}, Knowledge level ${knowledge}: first Decision point at frame ${harness.frame}`);
const error = await harness.play(bot).then(
  () => null,
  (e: unknown) => e,
);
const record = harness.record();
console.log(`Run record: ${relative(process.cwd(), await writeRecord(record))}`);
if (error) console.error(`The Bot stops with an error: ${errorText(error)}`);

const { result } = record;
console.log(`Run end: ${result.endReason}, ${result.frames} frames, raw inputs ${result.rawInputs}`);
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
