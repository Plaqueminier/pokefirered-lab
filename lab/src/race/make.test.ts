import { expect, test } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { RunRecord } from "../harness/record";
import { decodeTrack } from "./file";
import { makeRace, writeRace } from "./make";

const header = { rom: "rom", seed: 1, startSave: null, knowledge: "player" } as const;
const modelBot = { name: "model", version: "12", model: { id: "a/b", costLimit: 1, reasoning: "off", thinking: "medium", temperature: null, starter: "free", stopAtWhiteout: true } } as const;

function record(fields: Partial<RunRecord>): RunRecord {
  return {
    format: 2,
    header: { ...header, bot: modelBot },
    buttons: [[0, 100]],
    events: [],
    track: [10, 4, 1, 6, 6, 1],
    result: { endReason: "user stop", frames: 90, milestones: [], rawInputs: 0 },
    ...fields,
  };
}

async function runsDir(files: Record<string, RunRecord>): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "runs-"));
  await Promise.all(Object.entries(files).map(([name, content]) => Bun.write(join(dir, name), JSON.stringify(content))));
  return dir;
}

const OLDEST = "00001-model-1-2026-10-24T15-42-40.160Z.json";
const SCRIPTED = "00002-starter-4-2026-10-24T16-00-00.000Z.json";
const MIDDLE = "00003-model-2-2026-10-25T08-36-38.631Z.json";
const NO_ID = "model-12-2026-11-01T07-41-47.303Z.json";

test("a Race holds the Runs of the model bots with their number by date, their track, battles, trainers, Milestones and Run result", async () => {
  const track = [10, 4, 1, 6, 6, 1, 26, 4, 1, 6, 7, 0, 100, 3, 0, 12, 5, 3];
  const dir = await runsDir({
    [NO_ID]: record({
      track,
      events: [
        { frame: 20, type: "battle", state: "start", trainer: true },
        { frame: 30, type: "battle", state: "end" },
        { frame: 31, type: "trainer", trainer: "RIVAL BOB", id: 327 },
        { frame: 40, type: "battle", state: "start", trainer: false },
        { frame: 50, type: "battle", state: "end" },
        { frame: 60, type: "milestone", milestone: "has-pokemon" },
        { frame: 70, type: "battle", state: "start", trainer: true },
      ],
      result: { endReason: "whiteout", frames: 90, milestones: ["has-pokemon"], rawInputs: 0 },
    }),
    [SCRIPTED]: record({ header: { ...header, bot: { name: "starter", version: "4" } } }),
    [MIDDLE]: record({ format: 0, events: [{ frame: 20, type: "battle", state: "start" }, { frame: 30, type: "battle", state: "end" }], buttons: [[0, 50], [1, 25]] }),
    [OLDEST]: record({}),
  });

  const race = await makeRace(dir);
  expect(race.version).toBe(1);
  expect(race.runs.map((run) => [run.number, run.record])).toEqual([[1, OLDEST], [2, MIDDLE], [3, NO_ID]]);

  const last = race.runs[2];
  expect(last).toMatchObject({ bot: "model 12", model: "a/b" });
  expect(last.battles).toEqual([[20, 30, true], [40, 50, false], [70, 100, true]]);
  expect(last.trainers).toEqual([[31, "RIVAL BOB"]]);
  expect(last.milestones).toEqual([[60, "has-pokemon"]]);
  expect(last.end).toEqual({ frame: 100, result: "whiteout" });
  expect(last.track).not.toEqual(track);
  expect(Array.from(decodeTrack(last.track))).toEqual(track);

  expect(race.runs[1].battles).toEqual([[20, 30, null]]);
  expect(race.runs[1].end).toEqual({ frame: 75, result: "user stop" });

  const named = await makeRace(dir, [MIDDLE, "model-12"]);
  expect(named.runs.map((run) => run.number)).toEqual([2, 3]);
  await expect(makeRace(dir, ["nobody"])).rejects.toThrow('no Run record has the name "nobody"');
  await expect(makeRace(dir, [SCRIPTED])).rejects.toThrow(`${SCRIPTED} is not a Run of a model bot`);
});

test("a Race refuses a record with no track and names the migration", async () => {
  const dir = await runsDir({ [OLDEST]: record({ track: undefined }) });
  await expect(makeRace(dir)).rejects.toThrow(`${OLDEST} has no track: run "bun run migrate" first`);
});

test("a Run with an empty track stays out of the Race, and the next Run keeps its number", async () => {
  const dir = await runsDir({ [OLDEST]: record({ track: [] }), [MIDDLE]: record({}) });
  expect((await makeRace(dir)).runs.map((run) => [run.number, run.record])).toEqual([[2, MIDDLE]]);
});

test("a Run that another Run of the Race continues stays out, also through a Run that is not chosen", async () => {
  const continuing = (parent: string) => record({ header: { ...header, bot: modelBot, parent } });
  const dir = await runsDir({ [OLDEST]: record({}), [MIDDLE]: continuing(OLDEST), [NO_ID]: continuing(MIDDLE) });
  expect((await makeRace(dir)).runs.map((run) => [run.number, run.record])).toEqual([[3, NO_ID]]);
  expect((await makeRace(dir, [OLDEST, NO_ID])).runs.map((run) => run.record)).toEqual([NO_ID]);
  expect((await makeRace(dir, [OLDEST])).runs.map((run) => run.record)).toEqual([OLDEST]);
});

test("two Runs that continue the same Run both stay, without their parent", async () => {
  const continuing = record({ header: { ...header, bot: modelBot, parent: OLDEST } });
  const dir = await runsDir({ [OLDEST]: record({}), [MIDDLE]: continuing, [NO_ID]: continuing });
  expect((await makeRace(dir)).runs.map((run) => run.number)).toEqual([2, 3]);
});

test("a Race file is JSON in gzip", async () => {
  const dir = await runsDir({ [OLDEST]: record({}) });
  const race = await makeRace(dir);
  const out = await mkdtemp(join(tmpdir(), "races-"));
  const path = await writeRace("day3", race, out);
  expect(path).toBe(join(out, "day3.json.gz"));
  expect(JSON.parse(new TextDecoder().decode(Bun.gunzipSync(await Bun.file(path).bytes())))).toEqual(race);
  await expect(writeRace("../day3", race, out)).rejects.toThrow('the name of a Race has only letters, digits, "-" and "_": ../day3');
});
