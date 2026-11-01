import { describe, expect, setDefaultTimeout, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdtemp, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import starter from "./scripted-bot";
import { TRACK_POINT } from "../protocol";
import { ROM_FILE, SAVES_DIR, START_SAVE } from "../run";
import { type Bot, Harness, must, type RunResult } from "./harness";
import { withoutFormat } from "./game-events";
import { migrate } from "./migrate";
import { isGameEvent, isRunRecord, type ModelAnswer, type ModelEvent, RECORD_FORMAT, RecordPlayer, replay, type RunRecord, writeRecord } from "./record";

const ready = existsSync(ROM_FILE) && existsSync(START_SAVE);
setDefaultTimeout(60_000);

let starterRun: Promise<{ harness: Harness; result: RunResult }> | null = null;

function playStarter() {
  starterRun ??= Harness.open().then(async (harness) => ({ harness, result: await harness.play(starter) }));
  return starterRun;
}

const result: RunResult = { endReason: "goal", frames: 6, milestones: [], rawInputs: 0 };
const header = { rom: "rom", seed: 1, startSave: null, knowledge: "player", bot: { name: "test", version: "1" } } as const;
const ANSWER: ModelAnswer = {
  model: "a/b",
  situation: "a walk on PalletTown (6, 1)",
  prompt: { system: "rules", user: "now" },
  answer: '{"reason":"I go north.","action":"goTo 6 0","mission":"","objective":"","note":""}',
  decision: { reason: "I go north.", action: "goTo 6 0", mission: "", objective: "", note: "" },
  error: null,
  usage: { promptTokens: 100, completionTokens: 20, reasoningTokens: 0, cost: 0.0001 },
};

describe("RecordPlayer", () => {
  test("it gives the keys of each frame from frame 0, then it ends", () => {
    const record: RunRecord = { header, buttons: [[0, 2], [1, 3], [64, 1]], events: [], result };
    const player = new RecordPlayer(record);
    expect(player.frames).toBe(6);
    const keys: number[] = [];
    while (!player.ended) keys.push(player.next());
    expect(keys).toEqual([0, 0, 1, 1, 1, 64]);
    expect(player.frame).toBe(6);
    expect(() => player.next()).toThrow("the Run record has no more frames");
  });

  test("it gives the events up to the current frame: an action from the frame where the Bot asked for it", () => {
    const goTo = { type: "action", frame: 2, action: { name: "goTo", x: 1, y: 2 }, result: { status: "done", frames: 3 } } as const;
    const map = { type: "map", frame: 2, map: "PalletTown" } as const;
    const model: ModelEvent = { type: "model", frame: 5, latencyMs: 300, ...ANSWER };
    const milestone = { type: "milestone", frame: 6, milestone: "has-pokemon" } as const;
    const record: RunRecord = { header, buttons: [[0, 6]], events: [goTo, map, model, milestone], result };
    const player = new RecordPlayer(record);
    const playedAt: [number, number][] = [[player.frame, player.played().length]];
    while (!player.ended) {
      player.next();
      playedAt.push([player.frame, player.played().length]);
    }
    expect(playedAt).toEqual([[0, 0], [1, 0], [2, 2], [3, 2], [4, 2], [5, 3], [6, 4]]);
    expect(player.played()).toEqual([goTo, map, model, milestone]);
    expect(player.result).toEqual(result);
  });
});

test("a Run record file starts with the next Run id on 5 digits: two records written at the same time get two ids", async () => {
  const dir = await mkdtemp(join(tmpdir(), "runs-"));
  await Bun.write(join(dir, "00007-model-3-2026-10-26T07-41-35.302Z.json"), "{}");
  const record: RunRecord = { header, buttons: [[0, 6]], events: [], result };
  await Promise.all([writeRecord(record, dir), writeRecord(record, dir)]);
  const names = (await readdir(dir)).sort();
  expect(names.map((name) => name.slice(0, 13))).toEqual(["00007-model-3", "00008-test-1-", "00009-test-1-"]);
});

describe("isRunRecord", () => {
  const record = { header, buttons: [[0, 6]], events: [{ type: "map", frame: 2, map: "PalletTown" }], result };

  test("it accepts a Run record", () => {
    expect(isRunRecord(record)).toBe(true);
    expect(isRunRecord(JSON.parse(JSON.stringify(record)))).toBe(true);
  });

  test("it refuses a file with no header or result, bad button holds, or events that are not in frame order", () => {
    expect(isRunRecord(null)).toBe(false);
    expect(isRunRecord({ ...record, header: null })).toBe(false);
    expect(isRunRecord({ ...record, result: null })).toBe(false);
    expect(isRunRecord({ ...record, buttons: [[0, 0]] })).toBe(false);
    expect(isRunRecord({ ...record, events: [null] })).toBe(false);
    expect(isRunRecord({ ...record, events: [{ type: "map" }] })).toBe(false);
    expect(isRunRecord({ ...record, events: [{ type: "dance", frame: 1 }] })).toBe(false);
    expect(isRunRecord({ ...record, events: [{ type: "action", frame: 1 }] })).toBe(false);
    expect(isRunRecord({ ...record, events: [{ type: "map", frame: 3, map: "A" }, { type: "map", frame: 2, map: "B" }] })).toBe(false);
  });
});

describe.skipIf(!ready)("Run record on the Starting save", () => {
  test("the Run record of the scripted bot has its header, its buttons at each frame and its events; the replay of the buttons alone gives the same Game events, the same frames and the same screen", async () => {
    const { harness, result } = await playStarter();
    const record = harness.record();

    expect(record.header).toMatchObject({ seed: 0x4c41, knowledge: "player", bot: { name: "starter", version: "4" } });
    expect(record.header.rom).toMatch(/^[0-9a-f]{64}$/);
    expect(record.header.startSave).toMatch(/^[0-9a-f]{64}$/);
    expect(record.result).toEqual(result);

    expect(new RecordPlayer(record).frames).toBe(harness.frame);
    record.buttons.forEach(([keys], i) => expect(keys).not.toBe(record.buttons[i - 1]?.[0]));

    const actions = record.events.flatMap((e) => (e.type === "action" ? [e.action.name] : []));
    expect(actions).toHaveLength(25);
    expect(actions.slice(0, 3)).toEqual(["goTo", "goTo", "readText"]);
    const gameEvents = record.events.filter((e) => e.type !== "action").map(({ frame, ...event }) => event);
    expect(record.format).toBe(RECORD_FORMAT);
    expect(gameEvents).toEqual([
      { type: "map", map: "PalletTown_PlayersHouse_2F" },
      { type: "map", map: "PalletTown_PlayersHouse_1F" },
      { type: "map", map: "PalletTown" },
      { type: "map", map: "PalletTown_ProfessorOaksLab" },
      { type: "milestone", milestone: "has-pokemon" },
      { type: "battle", state: "start", trainer: true },
      { type: "faint", species: "BULBASAUR", side: "enemy" },
      { type: "money", before: 3000, after: 3080, cause: "battle" },
      { type: "battle", state: "end" },
      { type: "trainer", trainer: "RIVAL BOB", id: 327 },
      { type: "level", species: "SQUIRTLE", from: 5, level: 6, moves: [], evolution: null },
      { type: "heal", source: "other", item: null, party: [{ species: "SQUIRTLE", before: 7, after: 22, maxHp: 22 }] },
      { type: "milestone", milestone: "first-rival-battle" },
    ]);
    const frames = record.events.map((e) => e.frame);
    expect(frames).toEqual(frames.toSorted((a, b) => a - b));

    const replayed = await replay(record);
    expect(replayed.events).toEqual(record.events.filter(isGameEvent));
    expect(replayed.events.length).toBeGreaterThan(0);
    expect(replayed.frame).toBe(harness.frame);
    expect(replayed.screen).toBe(harness.screenHash());
    await expect(replay({ ...record, header: { ...record.header, seed: 1 } })).rejects.toThrow("the Run record does not replay here: different seed");
  });

  test("the Run record has the track of the player: a point at each change of cell, map or facing; the migration of a record below format 3 writes the same track and State track, and the Game events of format 1", async () => {
    const { harness } = await playStarter();
    const record = harness.record();
    const { track = [] } = record;
    expect(track.length % TRACK_POINT).toBe(0);
    const points = Array.from({ length: track.length / TRACK_POINT }, (_, i) => track.slice(i * TRACK_POINT, (i + 1) * TRACK_POINT));
    expect(points.length).toBeGreaterThan(50);
    const maps = points.map(([, group, num]) => `${group}.${num}`).filter((map, i, all) => map !== all[i - 1]);
    expect(maps).toHaveLength(record.events.filter((e) => e.type === "map").length);
    points.forEach(([frame, , , , , facing], i) => {
      expect(frame).toBeGreaterThan(points[i - 1]?.[0] ?? -1);
      expect([0, 1, 2, 3]).toContain(facing);
      if (i > 0) expect(points[i].slice(1)).not.toEqual(points[i - 1].slice(1));
    });

    const dir = await mkdtemp(join(tmpdir(), "runs-"));
    const old: RunRecord = { header: record.header, buttons: record.buttons, events: withoutFormat(record.events), result: record.result };
    await Bun.write(join(dir, "00001-starter-4-old.json"), JSON.stringify(old));
    await Bun.write(join(dir, "00002-starter-4-wrong.json"), JSON.stringify({ ...old, events: old.events.filter((e) => e.type !== "battle") }));
    await Bun.write(join(dir, "00003-starter-4-new.json"), JSON.stringify(record));
    const { state: _, ...format2 } = record;
    await Bun.write(join(dir, "00004-starter-4-format2.json"), JSON.stringify({ ...format2, format: 2 }));
    const report = await migrate(dir);
    expect(report).toEqual([
      { name: "00001-starter-4-old.json", error: null },
      { name: "00002-starter-4-wrong.json", error: "the replay does not give the maps and the battles of the record" },
      { name: "00004-starter-4-format2.json", error: null },
    ]);
    expect(await Bun.file(join(dir, "00004-starter-4-format2.json")).json()).toEqual(record);
    const migrated = await Bun.file(join(dir, "00001-starter-4-old.json")).json();
    expect(migrated).toEqual(record);
    const continued = await Harness.open({ parent: { name: "00001-starter-4-old.json", record: migrated } });
    await continued.play({ name: "idle", version: "1", play: async () => {} });
    expect(continued.record().state).toEqual(record.state);
    continued.close();
    expect((await Bun.file(join(dir, "00002-starter-4-wrong.json")).json()).track).toBeUndefined();
    expect(await readdir(dir)).toHaveLength(4);
  });

  test("the Run record has the State track: the team and its health at each change, and the battle from its start; a replay gives the same list", async () => {
    const { harness } = await playStarter();
    const record = harness.record();
    const state = record.state ?? [];
    expect(state.length).toBeGreaterThan(5);
    state.forEach(({ frame }, i) => expect(frame).toBeGreaterThanOrEqual(state[i - 1]?.frame ?? 0));

    const teams = state.flatMap((entry) => (entry.kind === "team" ? [entry] : []));
    expect(teams[0].team).toHaveLength(1);
    expect(teams[0].team[0]).toMatchObject({ species: "SQUIRTLE", nickname: "SQUIRTLE", level: 5 });
    expect(teams[0].team[0].moves).toEqual(["TACKLE", "TAIL WHIP"]);
    expect(teams.at(-1)?.team[0].level).toBe(6);

    const health = state.flatMap((entry) => (entry.kind === "health" ? [entry] : []));
    expect(health[0].health[0].status).toBe("none");
    expect(health.some((entry) => entry.health[0].hp === 0)).toBe(false);
    expect(new Set(health.map((entry) => entry.health[0].hp)).size).toBeGreaterThan(2);

    const battles = state.flatMap((entry) => (entry.kind === "battle" ? [entry] : []));
    const start = record.events.find((event) => event.type === "battle" && event.state === "start")?.frame;
    expect(battles[0].frame).toBe(start as number);
    expect(battles[0].trainer).toContain("RIVAL");
    expect(battles[0].player).toBeNull();
    const fight = battles.filter((entry) => entry.player !== null);
    expect(fight[0].player).toMatchObject({ species: "SQUIRTLE", level: 5, status: "none" });
    expect(fight[0].foe).toMatchObject({ species: "BULBASAUR", level: 5 });
    expect(fight.at(-1)?.foe?.hp).toBe(0);

    expect((await replay(record)).state).toEqual(state);
  });

  test("a Bot that walks in a loop ends with no progress after N Decision points with no progress: a new cell is not progress", async () => {
    const harness = await Harness.open({ noProgressLimit: 10 });
    const cell = (i: number) => ({ x: 6, y: i % 2 ? 6 : 7 });
    const loop: Bot = {
      name: "loop",
      version: "1",
      async play(h) {
        for (let i = 0; ; i++) must(await h.goTo(cell(i).x, cell(i).y));
      },
    };
    expect(await harness.play(loop)).toMatchObject({ endReason: "no progress", milestones: [], rawInputs: 0 });
    expect(harness.actions.map((e) => [e.action, e.result.status])).toEqual(Array.from({ length: 10 }, (_, i) => [{ name: "goTo", ...cell(i) }, "done"]));
  });

  test("the stuck counter: a new map and a new text of a person make it 0 again; a new cell and a text heard before do not", async () => {
    const harness = await Harness.open();
    const stuck: number[] = [];
    const explorer: Bot = {
      name: "explorer",
      version: "1",
      async play(h) {
        const walk = async (x: number, y: number, map?: string) => {
          must(await h.goTo(x, y, map));
          stuck.push(h.noProgress.stuck);
        };
        const talkToMom = async () => {
          must(await h.interact(8, 4));
          while (h.observe().waitingFor.kind !== "walk") await h.readText();
          stuck.push(h.noProgress.stuck);
        };
        await walk(6, 6);
        await walk(6, 7);
        await walk(8, 5, "PalletTown_PlayersHouse_1F");
        await walk(8, 6);
        await walk(8, 5);
        await talkToMom();
        await talkToMom();
      },
    };
    await harness.play(explorer);
    expect(stuck).toEqual([1, 2, 0, 1, 2, 0, 1]);
  });

  test("a continued Run replays the buttons of its parent: the same Atlas with the texts of the people, and a Run result for the whole Run", async () => {
    const talker: Bot = {
      name: "talker",
      version: "1",
      async play(h) {
        must(await h.goTo(8, 5, "PalletTown_PlayersHouse_1F"));
        must(await h.interact(8, 4));
        while (h.observe().waitingFor.kind !== "walk") await h.readText();
      },
    };
    const parent = await Harness.open();
    await parent.play(talker);
    const record = parent.record();
    const harness = await Harness.open({ parent: { name: "talker.json", record } });
    const atlas = harness.observe().atlas;
    expect(atlas).toEqual(parent.observe().atlas);
    expect(atlas.maps.flatMap((m) => m.people.flatMap((p) => p.texts)).length).toBeGreaterThan(0);
    const parentFrame = parent.frame;
    parent.close();
    const presser: Bot = { name: "presser", version: "1", play: async (h) => void (await h.press("B")) };
    expect(await harness.play(presser)).toEqual({ endReason: "bot stopped", frames: record.result.frames + harness.frame - parentFrame, milestones: [], rawInputs: 1 });
    expect(harness.record().header.parent).toBe("talker.json");
  });

  test("the frame budget ends the Run at its last frame, also in a Macro-action, and the Run record has the buttons to that frame", async () => {
    const harness = await Harness.open({ frameBudget: 2000 });
    const start = harness.frame;
    expect(await harness.play(starter)).toEqual({ endReason: "frame budget", frames: 2000, milestones: [], rawInputs: 0 });
    expect(harness.frame).toBe(start + 2000);
    expect(harness.actions.reduce((frames, e) => frames + e.result.frames, 0)).toBeLessThan(2000);
    const record = harness.record();
    expect(new RecordPlayer(record).frames).toBe(start + 2000);
    expect(record.result.endReason).toBe("frame budget");
  });

  test("each Raw input of the play counts in the Run result and is an event of the Run record, as a Model call", async () => {
    const harness = await Harness.open();
    await harness.press("B");
    const presser: Bot = {
      name: "presser",
      version: "1",
      async play(h) {
        await h.modelCall(async () => ({ answer: ANSWER, action: null }));
        for (let i = 0; i < 3; i++) await h.press("B");
      },
    };
    expect(await harness.play(presser)).toMatchObject({ endReason: "bot stopped", rawInputs: 3 });
    const events = harness.record().events.filter((e) => e.type === "action" || e.type === "model");
    expect(events.map(({ frame, ...e }) => ("action" in e ? e.action : e))).toEqual([
      { name: "press", button: "B" },
      { type: "model", latencyMs: expect.any(Number), ...ANSWER },
      { name: "press", button: "B" },
      { name: "press", button: "B" },
      { name: "press", button: "B" },
    ]);
    await expect(harness.play(presser)).rejects.toThrow("a Harness plays one Run");
  });

  test("a stop request ends the Run with user stop after the Model call or the Raw input that plays, and the Run record keeps them", async () => {
    let stop = false;
    const harness = await Harness.open({ stopAsked: () => stop });
    const stopped: Bot = {
      name: "stopped",
      version: "1",
      async play(h) {
        await h.press("B");
        await h.modelCall(async () => {
          stop = true;
          return { answer: ANSWER, action: null };
        });
        await h.press("B");
      },
    };
    expect(await harness.play(stopped)).toMatchObject({ endReason: "user stop", rawInputs: 1 });
    expect(harness.record().events.filter((e) => e.type === "action" || e.type === "model").map((e) => e.type)).toEqual(["action", "model"]);

    const pressed = await Harness.open({ stopAsked: () => true });
    expect(await pressed.play(stopped)).toMatchObject({ endReason: "user stop", rawInputs: 1 });
  });

  test("when the Bot throws an error, play throws it again and the Run record keeps the Run, with the end reason bot stopped", async () => {
    const harness = await Harness.open();
    const failing: Bot = {
      name: "failing",
      version: "1",
      async play(h) {
        must(await h.goTo(8, 2));
      },
    };
    await expect(harness.play(failing)).rejects.toThrow("impossible");
    const { result, events } = harness.record();
    expect(result).toEqual({ endReason: "bot stopped", frames: 0, milestones: [], rawInputs: 0 });
    expect(events.at(-1)).toMatchObject({ type: "action", action: { name: "goTo", x: 8, y: 2 }, result: { status: "impossible" } });
  });
});

const HIDDEN_ITEM_SAVE = join(SAVES_DIR, "test-hidden-item.sav");

describe.skipIf(!existsSync(ROM_FILE) || !existsSync(HIDDEN_ITEM_SAVE))("Run record on the test Starting save next to a hidden item", () => {
  test("the stuck counter: a hidden item that the player finds makes it 0 again", async () => {
    const harness = await Harness.open({ startSave: HIDDEN_ITEM_SAVE });
    const stuck: number[] = [];
    const finder: Bot = {
      name: "finder",
      version: "1",
      async play(h) {
        must(await h.goTo(4, 23));
        stuck.push(h.noProgress.stuck);
        must(await h.goTo(3, 23));
        stuck.push(h.noProgress.stuck);
        must(await h.interact(3, 22));
        while (h.observe().waitingFor.kind !== "walk") await h.readText();
        stuck.push(h.noProgress.stuck);
      },
    };
    await harness.play(finder);
    expect(stuck).toEqual([1, 2, 0]);
  });
});
