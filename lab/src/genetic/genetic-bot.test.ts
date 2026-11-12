import { describe, expect, setDefaultTimeout, test } from "bun:test";
import { existsSync } from "node:fs";
import { geneticBot } from "../../bots/genetic";
import { Harness } from "../harness/harness";
import { ROM_FILE, START_SAVE } from "../run";

const ready = existsSync(ROM_FILE) && existsSync(START_SAVE);
setDefaultTimeout(120_000);

describe.skipIf(!ready)("the Genetic bot", () => {
  test("a hand-written Genome plays from the bedroom to the first rival battle", async () => {
    const harness = await Harness.open({ frameBudget: 40_000 });
    const bot = geneticBot({
      walk: { notUsed: 1, isExit: 1, previousMap: -1, isSign: -1, unknownNeighbours: 1, distance: -0.2 },
      choice: { isYes: 1 },
      battle: { noDamage: 0.5, usedNoDamage: -1, power: 1 },
    });
    const result = await harness.play({ ...bot, goal: "first-rival-battle" });
    expect(result).toMatchObject({ endReason: "goal", milestones: ["has-pokemon", "first-rival-battle"], rawInputs: 0 });
  });
});
