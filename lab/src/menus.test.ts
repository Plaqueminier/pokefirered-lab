import { describe, expect, setDefaultTimeout, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { Harness } from "./harness/harness";
import { REPO_DIR } from "./map-data";
import type { Ref } from "./memory";
import { scriptListMenu } from "./menus";
import { decoder } from "./prompts";
import { ROM_FILE, Run, SAVES_DIR } from "./run";

setDefaultTimeout(60_000);

const BAG_SAVE = join(SAVES_DIR, "test-bag.sav");
const LIST_TASK = 14;
const LABELS = ["gOtherText_Give", "gOtherText_Toss", "gOtherText_Exit"];
const LIST_ITEM_SIZE = 8;

async function overworld(): Promise<Run> {
  const run = await Run.open({ startSave: BAG_SAVE });
  await Harness.open({}, run);
  return run;
}

function freeTasks(run: Run, count: number): number[] {
  const tasks = run.game.mem.global("gTasks");
  const free = Array.from({ length: tasks.length }, (_, i) => i).filter((i) => !tasks.at(i).field("isActive").int());
  if (free.length < count) throw new Error(`the game has fewer than ${count} free tasks`);
  return free.slice(0, count);
}

function functionAddress(run: Run, name: string): number {
  const found = run.game.mem.symbols.functions.find(([, fn]) => fn === name);
  if (!found) throw new Error(`no function ${name} in the symbols`);
  return found[0];
}

/** Writes the list menu of a script (Task_CreateScriptListMenu in src/field_specials.c) with the labels, the scroll and the row. */
function writeScriptListMenu(run: Run, labels: string[], cursorPos: number, itemsAbove: number, isActive = 1): void {
  const { mem } = run.game;
  const write = (ref: Ref, value: number) => ref.write(run.core, value);
  const tasks = mem.global("gTasks");
  const [input, list, items] = freeTasks(run, 3).map((i) => ({ id: i, task: tasks.at(i) }));
  const itemsAddress = items.task.field("data").addr;
  labels.forEach((label, i) => run.core.patch32(itemsAddress + i * LIST_ITEM_SIZE, mem.global(label).addr));
  const template = mem.global("sFieldSpecialsListMenuTemplate");
  write(template.field("items"), itemsAddress);
  write(template.field("totalItems"), labels.length);
  const listData = list.task.field("data").addr + template.size;
  run.core.patch16(listData, cursorPos);
  run.core.patch16(listData + 2, itemsAbove);
  write(input.task.field("data").at(LIST_TASK), list.id);
  write(input.task.field("func"), functionAddress(run, "Task_ListMenuHandleInput") | 1);
  write(input.task.field("isActive"), isActive);
}

describe.skipIf(!existsSync(ROM_FILE) || !existsSync(BAG_SAVE))("the list menu of a script", () => {
  test("with no active list task, the read gives null and the overworld waits for a walk", async () => {
    const run = await overworld();
    const decode = decoder(await Bun.file(join(REPO_DIR, "charmap.txt")).text());
    expect(scriptListMenu(run.game.mem, decode)).toBeNull();
    writeScriptListMenu(run, LABELS, 0, 1, 0);
    expect(scriptListMenu(run.game.mem, decode)).toBeNull();
    expect(run.game.waitingFor()).toEqual({ kind: "walk" });
  });

  test("the read gives the labels of the items, and the cursor is the scroll plus the row", async () => {
    const run = await overworld();
    const decode = decoder(await Bun.file(join(REPO_DIR, "charmap.txt")).text());
    writeScriptListMenu(run, LABELS, 1, 1);
    expect(scriptListMenu(run.game.mem, decode)).toEqual({ options: ["GIVE", "TOSS", "EXIT"], cursor: 2 });
  });

  test("waitingFor() gives the list menu as a choice of one column", async () => {
    const run = await overworld();
    writeScriptListMenu(run, LABELS.slice(0, 2), 0, 1);
    expect(run.game.waitingFor()).toEqual({ kind: "choice", options: ["GIVE", "TOSS"], cursor: 1, columns: 1 });
  });
});
