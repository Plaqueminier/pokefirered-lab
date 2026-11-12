import { describe, expect, setDefaultTimeout, test } from "bun:test";
import { existsSync } from "node:fs";
import { geneticBot } from "../../bots/genetic";
import { Harness } from "../harness/harness";
import { ROM_FILE, START_SAVE } from "../run";

const ready = existsSync(ROM_FILE) && existsSync(START_SAVE);
setDefaultTimeout(60_000);

describe.skipIf(!ready)("the Genetic bot", () => {
  test("a hand-written Genome walks from the bedroom to Pallet Town", async () => {
    const harness = await Harness.open({ frameBudget: 3_000 });
    await harness.play(geneticBot({ walk: { notUsed: 1, isExit: 1, previousMap: -1, isPerson: -1, isSign: -1, unknownNeighbours: 1, distance: -0.2 } }));
    const maps = harness.events.flatMap((e) => (e.type === "map" ? [e.map] : []));
    expect(maps.slice(0, 3)).toEqual(["PalletTown_PlayersHouse_2F", "PalletTown_PlayersHouse_1F", "PalletTown"]);
  });
});
