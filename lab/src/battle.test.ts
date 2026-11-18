import { describe, expect, setDefaultTimeout, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { battleMenu, safariMenu } from "./battle";
import { Harness } from "./harness/harness";
import { ROM_FILE, Run, SAVES_DIR } from "./run";

setDefaultTimeout(60_000);

const BAG_SAVE = join(SAVES_DIR, "test-bag.sav");
const BATTLE_TYPE_SAFARI = 1 << 7;
const BATTLE_TYPE_GHOST_UNVEILED = 1 << 13;
const BATTLE_TYPE_GHOST = 1 << 15;
const FLAG_SYS_SAFARI_MODE = 0x800;
const SAFARI_OPTIONS = ["BALL", "BAIT", "ROCK", "RUN"];

async function wildBattle(): Promise<{ run: Run; harness: Harness }> {
  const run = await Run.open({ startSave: BAG_SAVE });
  const harness = await Harness.open({}, run);
  const observation = harness.observe();
  if (observation.mode !== "overworld") throw new Error("the test save is not on the overworld");
  const { x, y } = observation.player;
  for (let step = 0; harness.waitingFor().kind === "walk"; step++) {
    if (step === 100) throw new Error("no wild battle in 100 steps");
    await harness.goTo(x, step % 2 === 0 ? y - 1 : y);
  }
  while (harness.waitingFor().kind !== "battleAction") await harness.readText();
  return { run, harness };
}

function addBattleFlags(run: Run, flags: number): void {
  const ref = run.game.mem.global("gBattleTypeFlags");
  ref.write(run.core, ref.int() | flags);
}

function writeSafari(run: Run, values: { balls: number; escape: number; rock: number; bait: number }): void {
  const { mem } = run.game;
  mem.global("gNumSafariBalls").write(run.core, values.balls);
  const battle = mem.global("gBattleStruct").deref();
  battle.field("safariEscapeFactor").write(run.core, values.escape);
  battle.field("safariRockThrowCounter").write(run.core, values.rock);
  battle.field("safariBaitThrowCounter").write(run.core, values.bait);
}

describe.skipIf(!existsSync(ROM_FILE) || !existsSync(BAG_SAVE))("the reads of a Safari battle", () => {
  test("a battle without the Safari flag has no safari part and no Safari menu", async () => {
    const { run } = await wildBattle();
    const { mem } = run.game;
    expect(run.game.battle()).not.toHaveProperty("safari");
    expect(safariMenu(mem, battleMenu(mem))).toBeNull();
    expect(run.game.waitingFor()).toEqual({ kind: "battleAction" });
  });

  test("with the Safari flag, the action menu is a choice of BALL, BAIT, ROCK and RUN in 2 columns, at the cursor of the game", async () => {
    const { run } = await wildBattle();
    const { mem } = run.game;
    addBattleFlags(run, BATTLE_TYPE_SAFARI);
    mem.global("gActionSelectionCursor").at(0).write(run.core, 2);
    expect(safariMenu(mem, "battleAction")).toEqual({ options: SAFARI_OPTIONS, cursor: 2, columns: 2 });
    expect(safariMenu(mem, "battleMove")).toBeNull();
    expect(safariMenu(mem, null)).toBeNull();
    expect(run.game.waitingFor()).toEqual({ kind: "choice", options: SAFARI_OPTIONS, cursor: 2, columns: 2 });
  });

  test("the safari part gives the balls and the flee chance of Cmd_if_random_safari_flee", async () => {
    const { run, harness } = await wildBattle();
    addBattleFlags(run, BATTLE_TYPE_SAFARI);
    const safari = (values: { balls: number; escape: number; rock: number; bait: number }) => {
      writeSafari(run, values);
      return run.game.battle()?.safari;
    };
    expect(safari({ balls: 12, escape: 3, rock: 0, bait: 0 })).toEqual({ balls: 12, fleePercent: 15 });
    expect(safari({ balls: 11, escape: 3, rock: 1, bait: 0 })).toEqual({ balls: 11, fleePercent: 30 });
    expect(safari({ balls: 11, escape: 15, rock: 2, bait: 0 })).toEqual({ balls: 11, fleePercent: 100 });
    expect(safari({ balls: 10, escape: 8, rock: 0, bait: 1 })).toEqual({ balls: 10, fleePercent: 10 });
    expect(safari({ balls: 10, escape: 3, rock: 0, bait: 1 })).toEqual({ balls: 10, fleePercent: 5 });
    expect(safari({ balls: 9, escape: 3, rock: 1, bait: 1 })).toEqual({ balls: 9, fleePercent: 30 });
    const observation = harness.observe();
    if (observation.mode !== "battle") throw new Error("the game is not in a battle");
    expect(observation.battle.safari).toEqual({ balls: 9, fleePercent: 30 });
  });
});

describe.skipIf(!existsSync(ROM_FILE) || !existsSync(BAG_SAVE))("the reads of a GHOST battle", () => {
  test("the GHOST flag without the Silph Scope flag gives ghost, and the two flags give no ghost", async () => {
    const { run } = await wildBattle();
    expect(run.game.battle()).not.toHaveProperty("ghost");
    addBattleFlags(run, BATTLE_TYPE_GHOST);
    expect(run.game.battle()).toMatchObject({ ghost: true });
    addBattleFlags(run, BATTLE_TYPE_GHOST_UNVEILED);
    expect(run.game.battle()).not.toHaveProperty("ghost");
  });

  test("observe() hides the species, the types, the moves and the fight facts of an unidentified GHOST", async () => {
    const { run, harness } = await wildBattle();
    addBattleFlags(run, BATTLE_TYPE_GHOST);
    const battle = run.game.battle();
    if (!battle) throw new Error("the game is not in a battle");
    const observation = harness.observe();
    if (observation.mode !== "battle") throw new Error("the game is not in a battle");
    const { level, status, states, statStages } = battle.enemy;
    expect(observation.battle).toMatchObject({ ghost: true, enemy: { species: "GHOST", types: [], level, status, states, statStages, movesSeen: [] } });
    expect(observation.battle.enemy).not.toHaveProperty("exact");
    expect(observation.battle.fights).toEqual(battle.player.moves.map(() => null));
  });
});

describe.skipIf(!existsSync(ROM_FILE) || !existsSync(BAG_SAVE))("the Safari Zone on the overworld", () => {
  test("safariZone() is null without FLAG_SYS_SAFARI_MODE, and gives the steps and the balls with it", async () => {
    const run = await Run.open({ startSave: BAG_SAVE });
    const harness = await Harness.open({}, run);
    const { mem } = run.game;
    expect(run.game.safariZone()).toBeNull();
    expect(harness.observe()).not.toHaveProperty("safari");
    mem.global("gSafariZoneStepCounter").write(run.core, 456);
    mem.global("gNumSafariBalls").write(run.core, 23);
    expect(run.game.safariZone()).toBeNull();
    const flags = mem.global("gSaveBlock1Ptr").deref().field("flags").at(FLAG_SYS_SAFARI_MODE >> 3);
    flags.write(run.core, flags.int() | (1 << (FLAG_SYS_SAFARI_MODE & 7)));
    expect(run.game.safariZone()).toEqual({ steps: 456, balls: 23 });
    expect(harness.observe()).toMatchObject({ mode: "overworld", safari: { steps: 456, balls: 23 } });
  });
});
