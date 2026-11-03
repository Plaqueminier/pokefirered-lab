import { describe, expect, setDefaultTimeout, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ROM_FILE, Run, START_SAVE } from "../run";
import { NAME_KEYS } from "../save-file";
import starter from "./scripted-bot";
import { type Bot, Harness } from "./harness";
import { originDifferences, RecordPlayer, replay } from "./record";

const ready = existsSync(ROM_FILE) && existsSync(START_SAVE);
setDefaultTimeout(60_000);

describe.skipIf(!ready)("the names of a Run", () => {
  const NAMES = { player: "Mira", rival: "Crumb" };
  const namedStarter: Bot = {
    ...starter,
    async play(harness) {
      harness.nameTrainers(NAMES);
      await starter.play(harness);
    },
  };

  test("at the first Decision point, the Harness boots again with the names: same frame, same screen, and the game uses the names", async () => {
    const harness = await Harness.open();
    const { frame } = harness;
    const screen = harness.screenHash();
    expect(harness.fixedNames()).toBeNull();
    expect(harness.trainerNames()).toEqual({ player: "PLOK", rival: "BOB" });
    harness.nameTrainers(NAMES);
    expect(harness.frame).toBe(frame);
    expect(harness.screenHash()).toBe(screen);
    expect(harness.trainerNames()).toEqual(NAMES);
    harness.close();
  });

  test("the Run record keeps the names and the hash of the Starting save, and it replays to the same end, only with the names", async () => {
    const plain = await Harness.open();
    await plain.play(starter);
    const plainRecord = plain.record();
    plain.close();
    const harness = await Harness.open();
    await harness.play(namedStarter);
    const record = harness.record();
    expect(record.header.names).toEqual(NAMES);
    expect(record.header.startSave).toBe(plainRecord.header.startSave);
    expect(harness.actions.flatMap((e) => ("text" in e.result ? e.result.text : []))).toContain("RIVAL Crumb would like to battle!");
    const replayed = await replay(record);
    expect(replayed.frame).toBe(harness.frame);
    expect(replayed.screen).toBe(harness.screenHash());
    harness.close();

    const named = await Run.open({ names: NAMES });
    const other = await Run.open({ names: { ...NAMES, rival: "Other" } });
    const unnamed = await Run.open();
    expect(originDifferences(named, record)).toEqual([]);
    expect(originDifferences(other, record)).toEqual(["names"]);
    expect(originDifferences(unnamed, record)).toEqual(["names"]);
    expect(originDifferences(named, plainRecord)).toEqual(["names"]);
    expect(originDifferences(unnamed, plainRecord)).toEqual([]);
    const { names: _, ...oldHeader } = plainRecord.header;
    expect(originDifferences(unnamed, { ...plainRecord, header: oldHeader })).toEqual([]);
    for (const run of [named, other, unnamed]) run.core.close();
  });

  test("a Run that has played cannot change its names, and a continued Run has the names of its parent", async () => {
    const harness = await Harness.open();
    await harness.play(namedStarter);
    expect(harness.fixedNames()).toEqual(NAMES);
    expect(() => harness.nameTrainers({ player: "A", rival: "B" })).toThrow("the names of a Run change only before its first action");
    const record = harness.record();
    const continued = await Harness.open({ parent: { name: "parent.json", record } });
    expect(continued.frame).toBe(harness.frame);
    expect(continued.screenHash()).toBe(harness.screenHash());
    expect(continued.fixedNames()).toEqual(NAMES);
    harness.close();
    continued.close();
  });

  test("a reset with no names gives the save of the file again", async () => {
    const run = await Run.open({ names: NAMES });
    await run.reset();
    expect(run.origin.names).toBeNull();
    for (let i = 0; i < 100; i++) run.runFrame(0);
    expect(run.game.rivalName()).toBe("BOB");
    run.core.close();
  });

  test("a bad name changes nothing: the game keeps its frame and its names, and no path can write a cut name", async () => {
    const harness = await Harness.open();
    const { frame } = harness;
    const screen = harness.screenHash();
    for (const bad of ["Too long name", "", " Al", "é"]) expect(() => harness.nameTrainers({ player: bad, rival: "B" })).toThrow(`the name "${bad}"`);
    expect(harness.frame).toBe(frame);
    expect(harness.screenHash()).toBe(screen);
    expect(harness.trainerNames()).toEqual({ player: "PLOK", rival: "BOB" });
    harness.close();
  });

  test("the second boot uses the bytes of the first one: the file can change or go away while a Model call waits", async () => {
    const path = join(mkdtempSync(join(tmpdir(), "names-")), "start.sav");
    await Bun.write(path, Bun.file(START_SAVE));
    const harness = await Harness.open({ startSave: path });
    const { frame } = harness;
    const screen = harness.screenHash();
    rmSync(path);
    harness.nameTrainers(NAMES);
    expect(harness.frame).toBe(frame);
    expect(harness.screenHash()).toBe(screen);
    expect(harness.trainerNames()).toEqual(NAMES);
    harness.close();
  });

  test("a Run that cannot boot with its names gives an error", async () => {
    await expect(Run.open({ names: { player: "Too long name", rival: "B" } })).rejects.toThrow('the name "Too long name"');
  });

  test("a Run that stopped before its first action can still get names when it continues", async () => {
    const parent = await Harness.open();
    await parent.play({ name: "idle", version: "1", play: async () => {} });
    const record = parent.record();
    const screen = parent.screenHash();
    parent.close();
    const harness = await Harness.open({ parent: { name: "parent.json", record } });
    expect(harness.fixedNames()).toBeNull();
    harness.nameTrainers(NAMES);
    expect(harness.frame).toBe(new RecordPlayer(record).frames);
    expect(harness.screenHash()).toBe(screen);
    expect(harness.trainerNames()).toEqual(NAMES);
    harness.close();
  });

  test("each character of the rule of the names is a key of the keyboard of the game, and it comes back from the save", async () => {
    const run = await Run.open();
    for (let i = 0; i < NAME_KEYS.length; i += 7) {
      const name = [...NAME_KEYS].slice(i, i + 7).join("").trim();
      await run.reset({ player: name, rival: name });
      for (let frame = 0; frame < 100; frame++) run.runFrame(0);
      expect(run.game.playerName()).toBe(name);
      expect(run.game.rivalName()).toBe(name);
    }
    run.core.close();
  });
});
