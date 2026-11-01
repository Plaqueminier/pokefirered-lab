import { expect, test } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { RunRecord } from "../harness/record";
import type { StateEntry } from "../protocol";
import { decodeTrack } from "./file";
import { makeRace, writeRace } from "./make";

const header = { rom: "rom", seed: 1, startSave: null, knowledge: "player" } as const;
const modelBot = { name: "model", version: "12", model: { id: "a/b", costLimit: 1, reasoning: "off", thinking: "medium", temperature: null, starter: "free", stopAtWhiteout: true } } as const;

function record(fields: Partial<RunRecord>): RunRecord {
  return {
    format: 3,
    header: { ...header, bot: modelBot },
    buttons: [[0, 100]],
    events: [],
    track: [10, 4, 1, 6, 6, 1],
    state: [],
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
const LAST = "00004-model-12-2026-11-01T07-41-47.303Z.json";
const NO_ID = "model-12-2026-11-02T07-41-47.303Z.json";

test("a Race holds the Runs of the model bots with the Run id of their file, their track, State track, battles, trainers, Milestones and Run result; a record of another Bot changes no number", async () => {
  const track = [10, 4, 1, 6, 6, 1, 26, 4, 1, 6, 7, 0, 100, 3, 0, 12, 5, 3];
  const state: StateEntry[] = [{ frame: 15, kind: "team", team: [{ species: "SQUIRTLE", nickname: "BOB", level: 5, maxHp: 20, moves: ["TACKLE"] }] }, { frame: 15, kind: "health", health: [{ hp: 20, status: "none" }] }];
  const dir = await runsDir({
    [LAST]: record({
      track,
      state,
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
    [MIDDLE]: record({ events: [{ frame: 20, type: "battle", state: "start" }, { frame: 30, type: "battle", state: "end" }], buttons: [[0, 50], [1, 25]] }),
    [OLDEST]: record({}),
  });

  const race = await makeRace(dir);
  expect(race.version).toBe(2);
  expect(race.runs.map((run) => [run.number, run.record])).toEqual([[1, OLDEST], [3, MIDDLE], [4, LAST]]);

  const last = race.runs[2];
  expect(last).toMatchObject({ bot: "model 12", model: "a/b" });
  expect(last.battles).toEqual([[20, 30], [40, 50], [70, 100]]);
  expect(last.trainers).toEqual([[31, "RIVAL BOB"]]);
  expect(last.milestones).toEqual([[60, "has-pokemon"]]);
  expect(last.end).toEqual({ frame: 100, result: "whiteout" });
  expect(last.state).toEqual(state);
  expect(last.track).not.toEqual(track);
  expect(Array.from(decodeTrack(last.track))).toEqual(track);

  expect(race.runs[1].battles).toEqual([[20, 30]]);
  expect(race.runs[1].end).toEqual({ frame: 75, result: "user stop" });

  const named = await makeRace(dir, [MIDDLE, "00004"]);
  expect(named.runs.map((run) => run.number)).toEqual([3, 4]);
  await expect(makeRace(dir, ["nobody"])).rejects.toThrow('no Run record has the name "nobody"');
  await expect(makeRace(dir, [SCRIPTED])).rejects.toThrow(`${SCRIPTED} is not a Run of a model bot`);
});

test("a Race refuses a record below format 3 and names the migration", async () => {
  const dir = await runsDir({ [OLDEST]: record({ format: 2, state: undefined }) });
  await expect(makeRace(dir)).rejects.toThrow(`${OLDEST} is below format 3: run "bun run migrate" first`);
  const empty = await runsDir({ [OLDEST]: record({ format: 2, state: undefined, track: [] }) });
  await expect(makeRace(empty)).rejects.toThrow(`${OLDEST} is below format 3: run "bun run migrate" first`);
});

test("a record with no Run id at the start of its name stays out of the Race", async () => {
  const dir = await runsDir({ [OLDEST]: record({}), [NO_ID]: record({}) });
  expect((await makeRace(dir)).runs.map((run) => run.record)).toEqual([OLDEST]);
  expect((await makeRace(dir, [NO_ID])).runs).toEqual([]);
});

test("a Race adds up the cost and the Model calls of a Run, with a point only at a change of a cent or more and at the end", async () => {
  const call = (frame: number, cost: number): RunRecord["events"][number] => ({ type: "model", frame, latencyMs: 1, model: "a/b", situation: "", prompt: { system: "", user: "" }, answer: null, decision: null, error: "x", usage: { promptTokens: 1, completionTokens: 1, reasoningTokens: 0, cost } });
  const summary: RunRecord["events"][number] = { type: "summary", frame: 45, latencyMs: 1, model: "a/b", prompt: { system: "", user: "" }, answer: null, summary: null, error: "x", from: 0, to: 1, usage: { promptTokens: 1, completionTokens: 1, reasoningTokens: 0, cost: 0.02 } };
  const dir = await runsDir({ [OLDEST]: record({ events: [call(10, 0.004), call(20, 0.004), call(30, 0.004), summary, call(50, 0.001)] }), [MIDDLE]: record({}) });
  const [first, second] = (await makeRace(dir)).runs;
  expect(first.cost).toEqual([[30, 0.012, 3], [45, 0.032, 3], [50, 0.033, 4]]);
  expect(second.cost).toEqual([]);
});

test("a Race has the faints of the player side and the money at each change, from the money before the first change", async () => {
  const dir = await runsDir({
    [OLDEST]: record({
      events: [
        { frame: 20, type: "faint", species: "RATTATA", side: "enemy" },
        { frame: 30, type: "faint", species: "SQUIRTLE", side: "player" },
        { frame: 40, type: "money", before: 3000, after: 3080, cause: "battle" },
        { frame: 50, type: "money", before: 3080, after: 2880, cause: "purchase" },
      ],
    }),
  });
  const [run] = (await makeRace(dir)).runs;
  expect(run.faints).toEqual([30]);
  expect(run.money).toEqual([[0, 3000], [40, 3080], [50, 2880]]);
});

test("a Run with an empty track stays out of the Race, and the next Run keeps its number", async () => {
  const dir = await runsDir({ [OLDEST]: record({ track: [] }), [MIDDLE]: record({}) });
  expect((await makeRace(dir)).runs.map((run) => [run.number, run.record])).toEqual([[3, MIDDLE]]);
});

test("a Run that another Run of the Race continues stays out, also through a Run that is not chosen", async () => {
  const continuing = (parent: string) => record({ header: { ...header, bot: modelBot, parent } });
  const dir = await runsDir({ [OLDEST]: record({}), [MIDDLE]: continuing(OLDEST), [LAST]: continuing(MIDDLE) });
  expect((await makeRace(dir)).runs.map((run) => [run.number, run.record])).toEqual([[4, LAST]]);
  expect((await makeRace(dir, [OLDEST, LAST])).runs.map((run) => run.record)).toEqual([LAST]);
  expect((await makeRace(dir, [OLDEST])).runs.map((run) => run.record)).toEqual([OLDEST]);
});

test("two Runs that continue the same Run both stay, without their parent", async () => {
  const continuing = record({ header: { ...header, bot: modelBot, parent: OLDEST } });
  const dir = await runsDir({ [OLDEST]: record({}), [MIDDLE]: continuing, [LAST]: continuing });
  expect((await makeRace(dir)).runs.map((run) => run.number)).toEqual([3, 4]);
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
