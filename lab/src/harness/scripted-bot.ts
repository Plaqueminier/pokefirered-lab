import { type Bot, must } from "./harness";

const TACKLE = 0;
const TAIL_WHIP = 1;

/** The scripted bot: a tool to test the Harness. It plays the same Run each time, to its goal `first-rival-battle`. It does not grow with the story. */
export default {
  name: "starter",
  version: "3",
  goal: "first-rival-battle",
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
    await harness.goTo(6, 11);
    await harness.readText();
    let fights = 0;
    for (;;) {
      const { milestones, waitingFor } = harness.observe();
      if (milestones.includes("first-rival-battle")) return;
      if (waitingFor.kind !== "battleAction") {
        must(await harness.readText());
        continue;
      }
      // With TACKLE only, SQUIRTLE loses this battle; TAIL WHIP first wins it.
      must(await harness.fight(fights++ === 0 ? TAIL_WHIP : TACKLE));
    }
  },
} satisfies Bot;
