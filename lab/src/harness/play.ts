import { relative } from "node:path";
import { Harness, KNOWLEDGE_LEVELS, loadBot } from "./harness";
import { writeRecord } from "./record";

const [name, level = "player"] = process.argv.slice(2);
const knowledge = KNOWLEDGE_LEVELS.find((l) => l === level);
if (!name || !knowledge) {
  console.error("Usage: bun run bot <name> [player|full]");
  process.exit(1);
}
const bot = await loadBot(name).catch((error: unknown) => {
  console.error(String(error));
  process.exit(1);
});

const harness = await Harness.open({
  knowledge,
  onAction: ({ action, result }) => {
    const { name, ...args } = action;
    const call = `${name}(${Object.values(args).join(", ")})`;
    const reason = "reason" in result ? `  ${result.reason}` : "";
    console.log(`${call.padEnd(24)} ${result.status.padEnd(10)} ${String(result.frames).padStart(6)} frames${reason}`);
    if ("text" in result) for (const message of result.text) console.log(`  "${message}"`);
  },
});
console.log(`Bot ${bot.name} ${bot.version}, Knowledge level ${knowledge}: first Decision point at frame ${harness.frame}`);
const result = await harness.play(bot).finally(async () => {
  console.log(`Run record: ${relative(process.cwd(), await writeRecord(harness.record()))}`);
});

const observation = harness.observe();
const { party, milestones } = observation;
const where = observation.mode === "overworld" ? `${observation.map.name} (${observation.player.x}, ${observation.player.y}) facing ${observation.player.facing}` : "in a battle";
console.log(`End: ${where}, frame ${harness.frame}, screen ${harness.screenHash()}, raw inputs ${result.rawInputs}`);
console.log(`Run end: ${result.endReason}, ${result.frames} frames`);
console.log(`Milestones: ${milestones.join(", ") || "none"}`);
for (const mon of party) {
  const moves = mon.moves.map((m) => `${m.name} ${m.pp}/${m.maxPp}`).join(", ");
  console.log(`Party: ${mon.nickname} (${mon.species}) level ${mon.level}, ${mon.hp}/${mon.maxHp} HP, status ${mon.status}, moves ${moves}`);
}
