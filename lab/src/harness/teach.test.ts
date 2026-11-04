import { describe, expect, setDefaultTimeout, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { modelBot } from "../../bots/model";
import type { ModelClient } from "../model/openrouter";
import { ROM_FILE, Run, SAVES_DIR } from "../run";
import { Harness, must } from "./harness";

setDefaultTimeout(60_000);

const PARTY_SAVE = join(SAVES_DIR, "test-party.sav");
const LEARN_MOVE_SAVE = join(SAVES_DIR, "test-learn-move.sav");
const ITEM_TM13 = 301;
const ITEM_TM14 = 302;
const ITEM_TM39 = 327;
const ITEM_HM06 = 344;
const ITEM_TM_CASE = 364;
const TM_CASE_POCKET = 3;
const KEY_ITEMS_POCKET = 1;

async function withTms(startSave: string, ...items: number[]): Promise<Harness> {
  const run = await Run.open({ startSave });
  const harness = await Harness.open({}, run);
  const { mem } = run.game;
  const key = mem.global("gSaveBlock2Ptr").deref().field("encryptionKey").int() & 0xffff;
  const put = (pocket: number, row: number, item: number) => {
    const slot = mem.global("gBagPockets").at(pocket).field("itemSlots").at(row);
    run.core.patch16(slot.field("itemId").addr, item);
    run.core.patch16(slot.field("quantity").addr, 1 ^ key);
  };
  for (const [row, item] of items.entries()) put(TM_CASE_POCKET, row, item);
  put(KEY_ITEMS_POCKET, 0, ITEM_TM_CASE);
  return harness;
}

const moveNames = (harness: Harness, slot = 0) => harness.observe().party[slot].moves.map((move) => move.name);
const tmCase = (harness: Harness) => harness.observe().bag.find((pocket) => pocket.pocket === "TM CASE")?.items.map((item) => item.name) ?? [];

describe.skipIf(!existsSync(ROM_FILE) || !existsSync(PARTY_SAVE))("teach, on the test Starting save with 2 Pokémon of 2 moves", () => {
  test("a TM gives its move and leaves the Bag; the player is back at the walk", async () => {
    const harness = await withTms(PARTY_SAVE, ITEM_TM13);
    expect(harness.availableActions()).toContainEqual({ name: "teach", item: "TM13" });
    expect(await harness.teach("TM13", 0)).toMatchObject({ status: "done", text: ["SQUIRTLE learned ICE BEAM!"] });
    expect(moveNames(harness)).toEqual(["TACKLE", "TAIL WHIP", "ICE BEAM"]);
    expect(tmCase(harness)).toEqual([]);
    expect(harness.waitingFor().kind).toBe("walk");
    expect(harness.observe().mode).toBe("overworld");
  });

  test("an HM stays in the Bag, the cursors reach the second Pokémon, and a Pokémon that knows the move refuses it", async () => {
    const harness = await withTms(PARTY_SAVE, ITEM_TM13, ITEM_HM06);
    must(await harness.teach("HM06", 1));
    expect(moveNames(harness, 1)).toEqual(["TACKLE", "TAIL WHIP", "ROCK SMASH"]);
    expect(moveNames(harness, 0)).toEqual(["TACKLE", "TAIL WHIP"]);
    expect(tmCase(harness)).toEqual(["HM06", "TM13"]);
    expect(await harness.teach("HM06", 1)).toMatchObject({ status: "impossible", reason: "SHELL already knows ROCK SMASH", frames: 0 });
  });

  test("the TM Case puts the HMs first when it opens: teach finds the item on its new row", async () => {
    const harness = await withTms(PARTY_SAVE, ITEM_TM39, ITEM_TM13, ITEM_HM06);
    must(await harness.teach("TM13", 0));
    expect(moveNames(harness)).toEqual(["TACKLE", "TAIL WHIP", "ICE BEAM"]);
    expect(tmCase(harness)).toEqual(["HM06", "TM39"]);
  });

  test("teach is impossible, with its reason and no frame, for a Pokémon that cannot learn the move, a TM not in the Bag and a Pokémon not in the party", async () => {
    const harness = await withTms(PARTY_SAVE, ITEM_TM39);
    expect(harness.observe()).toMatchObject({ teachables: [{ item: "TM39", move: { name: "ROCK TOMB" }, able: [], knowing: [] }] });
    expect(await harness.teach("TM39", 0)).toMatchObject({ status: "impossible", reason: "SQUIRTLE cannot learn ROCK TOMB", frames: 0 });
    expect(await harness.teach("HM06", 0)).toMatchObject({ status: "impossible", reason: "there is no HM06 in the TM Case", frames: 0 });
    expect(await harness.teach("TM39", 5)).toMatchObject({ status: "impossible", frames: 0 });
    expect(tmCase(harness)).toEqual(["TM39"]);
  });

  test("an HM move stays impossible to forget at the question of a TM", async () => {
    const harness = await withTms(PARTY_SAVE, ITEM_HM06, ITEM_TM13, ITEM_TM14);
    must(await harness.teach("HM06", 0));
    must(await harness.teach("TM13", 0));
    must(await harness.teach("TM14", 0));
    expect(harness.waitingFor()).toMatchObject({ kind: "learnMove", move: { name: "BLIZZARD" } });
    expect(await harness.forget("ROCK SMASH")).toMatchObject({ status: "impossible", reason: "ROCK SMASH is an HM move, and HM moves cannot be forgotten now", frames: 0 });
    must(await harness.keep());
    expect(tmCase(harness)).toEqual(["HM06", "TM14"]);
  });

  test("the two floors of Rock Tunnel are the Dark maps, and Mt. Moon is not", async () => {
    const run = await Run.open({ startSave: PARTY_SAVE });
    const dark = (map: string) => run.game.mapView(map)?.grid.cave;
    expect(["RockTunnel_1F", "RockTunnel_B1F", "MtMoon_1F", "PalletTown"].map(dark)).toEqual([true, true, false, false]);
  });
});

describe.skipIf(!existsSync(ROM_FILE) || !existsSync(LEARN_MOVE_SAVE))("teach, on the test Starting save with a Pokémon of 4 moves", () => {
  test("the game waits for learnMove: keep leaves the moves and the TM", async () => {
    const harness = await withTms(LEARN_MOVE_SAVE, ITEM_TM13);
    must(await harness.teach("TM13", 0));
    expect(harness.waitingFor()).toMatchObject({ kind: "learnMove", slot: 0, move: { name: "ICE BEAM", type: "ICE" } });
    expect(harness.observe().mode).toBe("menu");
    expect(harness.availableActions()).toContainEqual({ name: "forget", move: "TACKLE" });
    expect(await harness.keep()).toMatchObject({ status: "done", text: ["SQUIRTLE did not learn the move ICE BEAM."] });
    expect(moveNames(harness)).toEqual(["TACKLE", "TAIL WHIP", "WITHDRAW", "WATER GUN"]);
    expect(tmCase(harness)).toEqual(["TM13"]);
    expect(harness.waitingFor().kind).toBe("walk");
  });

  test("forget puts the move in the place of the forgotten move, and the TM leaves the Bag", async () => {
    const harness = await withTms(LEARN_MOVE_SAVE, ITEM_TM13);
    must(await harness.teach("TM13", 0));
    expect(await harness.forget("TAIL WHIP")).toMatchObject({ status: "done", text: ["SQUIRTLE learned ICE BEAM!"] });
    expect(moveNames(harness)).toEqual(["TACKLE", "ICE BEAM", "WITHDRAW", "WATER GUN"]);
    expect(tmCase(harness)).toEqual([]);
    expect(harness.waitingFor().kind).toBe("walk");
  });

  test("an HM on 4 moves also asks: forget gives the move, keep keeps the 4 moves, and the HM stays in the Bag each time", async () => {
    const forgot = await withTms(LEARN_MOVE_SAVE, ITEM_HM06);
    must(await forgot.teach("HM06", 0));
    expect(forgot.waitingFor()).toMatchObject({ kind: "learnMove", move: { name: "ROCK SMASH" } });
    expect(await forgot.forget("TACKLE")).toMatchObject({ status: "done", text: ["SQUIRTLE learned ROCK SMASH!"] });
    expect(moveNames(forgot)).toEqual(["ROCK SMASH", "TAIL WHIP", "WITHDRAW", "WATER GUN"]);
    expect(tmCase(forgot)).toEqual(["HM06"]);
    expect(forgot.waitingFor().kind).toBe("walk");

    const kept = await withTms(LEARN_MOVE_SAVE, ITEM_HM06);
    must(await kept.teach("HM06", 0));
    must(await kept.keep());
    expect(moveNames(kept)).toEqual(["TACKLE", "TAIL WHIP", "WITHDRAW", "WATER GUN"]);
    expect(tmCase(kept)).toEqual(["HM06"]);
    expect(kept.waitingFor().kind).toBe("walk");
  });

  test("the model bot teaches at a walk, then answers the question of the game with a move to forget", async () => {
    const harness = await withTms(LEARN_MOVE_SAVE, ITEM_TM13);
    const users: string[] = [];
    const answer = (user: string) => (user.includes("The game waits for a move to forget.") ? "forget WITHDRAW" : user.includes("- teach <TM or HM> on <Pokémon>") ? "teach TM13 on 1" : "I do not know");
    const client: ModelClient = async ({ user }) => {
      users.push(user);
      return { content: JSON.stringify({ reason: "r", action: answer(user), mission: "m", objective: "o", note: "" }), usage: { promptTokens: 1, cachedTokens: 0, completionTokens: 1, reasoningTokens: 0, cost: 0 } };
    };
    await expect(harness.play(modelBot({ costLimit: 1 }, () => client))).rejects.toThrow("3 answers in a row that the Bot cannot read");
    expect(harness.actions.filter(({ action }) => action.name === "teach" || action.name === "forget").map(({ action, result }) => [action, result.status])).toEqual([
      [{ name: "teach", item: "TM13", on: 0 }, "done"],
      [{ name: "forget", move: "WITHDRAW" }, "done"],
    ]);
    expect(users[1]).toContain("SQUIRTLE wants to learn ICE BEAM");
    expect(moveNames(harness)).toEqual(["TACKLE", "TAIL WHIP", "ICE BEAM", "WATER GUN"]);
  });
});
