import { type Bot, must } from "../src/harness/harness";

export default {
  name: "starter",
  version: "2",
  async play(harness) {
    must(await harness.goTo(12, 3, "PalletTown"));
    await harness.goTo(12, 1);
    while (harness.observe().waitingFor.kind !== "walk") must(await harness.readText());
    must(await harness.goTo(9, 5));
    must(await harness.interact(9, 4));
    must(await harness.readText());
    must(await harness.choose("YES"));
    must(await harness.readText());
    must(await harness.choose("NO"));
    must(await harness.readText());
  },
} satisfies Bot;
