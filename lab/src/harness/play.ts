import { join } from "node:path";
import { type Bot, Harness } from "./harness";

const name = process.argv[2];
if (!name) {
  console.error("Usage: bun run bot <name>");
  process.exit(1);
}
const bot: Bot = (await import(join(import.meta.dir, "..", "..", "bots", `${name}.ts`))).default;
if (typeof bot?.play !== "function") {
  console.error(`bots/${name}.ts must export by default a Bot: { name, version, play(harness) }`);
  process.exit(1);
}

const harness = await Harness.open({
  onAction: ({ action, result }) => {
    const { name, ...args } = action;
    const call = `${name}(${Object.values(args).join(", ")})`;
    const reason = "reason" in result ? `  ${result.reason}` : "";
    console.log(`${call.padEnd(24)} ${result.status.padEnd(10)} ${String(result.frames).padStart(6)} frames${reason}`);
    if ("text" in result) for (const message of result.text) console.log(`  "${message}"`);
  },
});
console.log(`Bot ${bot.name} ${bot.version}: first Decision point at frame ${harness.frame}`);
await bot.play(harness);

const { map, player } = harness.observe();
console.log(`End: ${map.name} (${player.x}, ${player.y}) facing ${player.facing}, frame ${harness.frame}, screen ${harness.screenHash()}, raw inputs ${harness.rawInputs}`);
