import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import oak from "../../bots/oak";
import stairs from "../../bots/stairs";
import { ROM_FILE, START_SAVE } from "../run";
import { type Bot, Harness } from "./harness";

const ready = existsSync(ROM_FILE) && existsSync(START_SAVE);

async function play(bot: Bot) {
  const harness = await Harness.open();
  await bot.play(harness);
  return { actions: harness.actions, frame: harness.frame, observation: harness.observe(), screen: harness.screenHash() };
}

describe.skipIf(!ready)("Harness on the Starting save", () => {
  test("the stairs Bot reaches the stairs, with the same frames and results on each start", async () => {
    const first = await play(stairs);
    const second = await play(stairs);
    expect(first.actions.map((e) => [e.action, e.result.status])).toEqual([[{ name: "goTo", x: 10, y: 2 }, "done"]]);
    expect(first.observation.map.name).toBe("PalletTown_PlayersHouse_2F");
    expect(first.observation.player).toMatchObject({ x: 10, y: 2 });
    expect(first.observation.waitingFor).toBe("walk");
    expect(second).toEqual(first);
  });

  test("the oak Bot leaves the house, and Oak's trigger stops it, with the same frames on each start", async () => {
    const first = await play(oak);
    const second = await play(oak);
    expect(first.actions.map((e) => [e.action, e.result.status, "reason" in e.result ? e.result.reason : null])).toEqual([
      [{ name: "goTo", x: 12, y: 3, map: "PalletTown" }, "done", null],
      [{ name: "goTo", x: 12, y: 1 }, "interrupted", "trigger"],
    ]);
    expect(first.observation.map.name).toBe("PalletTown");
    expect(first.observation.player).toMatchObject({ x: 12, y: 1 });
    expect(second).toEqual(first);
  });

  test("goTo to the cell of Mom waits, plans again, and returns blocked", async () => {
    const harness = await Harness.open();
    const result = await harness.goTo(8, 4, "PalletTown_PlayersHouse_1F");
    expect(result).toMatchObject({ status: "blocked", frames: 60 });
    expect(harness.observe().map.name).toBe("PalletTown_PlayersHouse_2F");
  });

  test("goTo to a blocked cell returns impossible and runs no frames", async () => {
    const harness = await Harness.open();
    const frame = harness.frame;
    const result = await harness.goTo(8, 2);
    expect(result).toMatchObject({ status: "impossible", frames: 0 });
    expect(harness.frame).toBe(frame);
  });
});
