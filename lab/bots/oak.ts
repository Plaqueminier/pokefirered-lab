import type { Bot } from "../src/harness/harness";

export default {
  name: "oak",
  version: "1",
  async play(harness) {
    await harness.goTo(12, 3, "PalletTown");
    await harness.goTo(12, 1);
  },
} satisfies Bot;
