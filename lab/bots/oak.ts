import type { Bot } from "../src/harness/harness";

export default {
  name: "oak",
  version: "2",
  async play(harness) {
    await harness.goTo(12, 3, "PalletTown");
    await harness.goTo(12, 1);
    while (harness.observe().waitingFor.kind !== "walk") {
      const result = await harness.readText();
      if (result.status !== "done") throw new Error(`readText: ${result.status}`);
    }
  },
} satisfies Bot;
