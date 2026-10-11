import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import stairs from "../../bots/stairs";
import { ROM_FILE, START_SAVE } from "../run";
import { Harness } from "./harness";

const ready = existsSync(ROM_FILE) && existsSync(START_SAVE);

async function playStairs() {
  const harness = await Harness.open();
  await stairs.play(harness);
  return { actions: harness.actions, frame: harness.frame, observation: harness.observe(), screen: harness.screenHash() };
}

describe.skipIf(!ready)("Harness on the Starting save", () => {
  test("the stairs Bot reaches the stairs, with the same frames and results on each start", async () => {
    const first = await playStairs();
    const second = await playStairs();
    expect(first.actions.map((e) => [e.action, e.result.status])).toEqual([[{ name: "goTo", x: 10, y: 2 }, "done"]]);
    expect(first.observation.map.name).toBe("PalletTown_PlayersHouse_2F");
    expect(first.observation.player).toMatchObject({ x: 10, y: 2 });
    expect(first.observation.waitingFor).toBe("walk");
    expect(second).toEqual(first);
  });

  test("goTo to a blocked cell returns impossible and runs no frames", async () => {
    const harness = await Harness.open();
    const frame = harness.frame;
    const result = await harness.goTo(8, 2);
    expect(result).toMatchObject({ status: "impossible", frames: 0 });
    expect(harness.frame).toBe(frame);
  });
});
