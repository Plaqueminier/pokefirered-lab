import { describe, expect, setDefaultTimeout, test } from "bun:test";
import { existsSync } from "node:fs";
import { type Bot, Harness, must } from "../harness/harness";
import type { RunRecord } from "../harness/record";
import starter from "../harness/scripted-bot";
import { ROM_FILE, START_SAVE } from "../run";
import { fitness } from "./fitness";

const ready = existsSync(ROM_FILE) && existsSync(START_SAVE);
setDefaultTimeout(60_000);

let scriptedPath: Promise<RunRecord> | null = null;

function playScriptedPath(): Promise<RunRecord> {
  scriptedPath ??= Harness.open().then(async (harness) => {
    await harness.play(starter);
    return harness.record();
  });
  return scriptedPath;
}

async function recordOf(bot: Bot, harness: Promise<Harness>): Promise<RunRecord> {
  const opened = await harness;
  await opened.play(bot);
  return opened.record();
}

// After the scripted path the player has a Pokémon, so Oak no longer stops the walk to Route 1.
async function walkToRoute1(times: number): Promise<RunRecord> {
  const record = await playScriptedPath();
  const walker: Bot = {
    name: "walker",
    version: "1",
    async play(h) {
      while (h.observe().waitingFor.kind !== "walk") must(await h.readText());
      for (let i = 0; i < times; i++) {
        must(await h.goTo(12, 39, "Route1"));
        must(await h.goTo(12, 1, "PalletTown"));
      }
    },
  };
  return recordOf(walker, Harness.open({ parent: { name: "scripted.json", record } }));
}

// Track points: frame, map group, map number, x, y, facing. The Fitness names the map of a point with the `map` events.
function walkFromViridianCity(parcel: boolean): RunRecord {
  const maps = ["ViridianCity", ...(parcel ? ["ViridianCity_Mart", "ViridianCity"] : []), "Route1", "PalletTown"];
  const cells = [[36, 20], ...(parcel ? [[4, 7], [36, 20]] : []), [12, 0], [16, 14], [16, 19]];
  const frameOf = (i: number) => 100 * (Math.min(i, maps.length - 1) + 1) + (i >= maps.length ? 50 : 0);
  return {
    events: maps.map((map, i) => ({ type: "map", frame: frameOf(i), map })),
    track: cells.flatMap(([x, y], i) => [frameOf(i), 3, 0, x, y, 0]),
    result: { milestones: [], frames: 1000 },
  } as unknown as RunRecord;
}

test("with OAK'S PARCEL, the walk from the Viridian City shop to the cell below the lab door gets 81 of the 90 cells toward Oak, and the step back does not lose them; with no parcel, the same walk gets nothing", () => {
  const withParcel = fitness(walkFromViridianCity(true));
  expect(withParcel.terms.parcel.count).toBe(1);
  expect(withParcel.terms.towardOak.count).toBe(81);
  const noParcel = fitness(walkFromViridianCity(false));
  expect(noParcel.terms.parcel.count).toBe(0);
  expect(noParcel.terms.towardOak.count).toBe(0);
});

describe.skipIf(!ready)("the Fitness on Run records", () => {
  test("the record of the scripted path has a higher note than a Run that stays in the bedroom", async () => {
    const stayer: Bot = {
      name: "stayer",
      version: "1",
      async play(h) {
        for (let i = 0; ; i++) must(await h.goTo(6, i % 2 ? 6 : 7));
      },
    };
    const bedroom = await recordOf(stayer, Harness.open({ noProgressLimit: 10 }));
    const scripted = fitness(await playScriptedPath());
    expect(scripted.note).toBeGreaterThan(fitness(bedroom).note);
    // PROF. OAK stops the scripted path at the north of Pallet Town.
    expect(scripted.terms.triggers.count).toBeGreaterThan(0);
  });

  test("a Run that walks between Pallet Town and Route 1 again and again has a low note: no higher than a Run that walks there once", async () => {
    const once = fitness(await walkToRoute1(1));
    const again = fitness(await walkToRoute1(20));
    expect(again.note).toBeLessThanOrEqual(once.note);
  });
});
