import type { Bot } from "../src/harness/harness";

export default {
  name: "stairs",
  version: "1",
  async play(harness) {
    const stairs = harness.observe().grid.warps.find((w) => w.to === "PalletTown_PlayersHouse_1F");
    if (!stairs) throw new Error("no stairs on this map");
    await harness.goTo(stairs.x, stairs.y);
  },
} satisfies Bot;
