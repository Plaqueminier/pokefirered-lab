import { describe, expect, setDefaultTimeout, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { ROM_FILE, Run, SAVES_DIR } from "../run";
import { type BattleState, Harness, must } from "./harness";

setDefaultTimeout(60_000);

const PARTY_SAVE = join(SAVES_DIR, "test-party.sav");
const POKEMON_SIZE = 100;
const STATUS1_BURN = 1 << 4;
const ITEMS_POCKET = 0;
const ITEM_POTION = 13;
const BIG = 900;
const SAME_SLOT = 1;
const THIRD_SLOT = 2;
const LEFT_BATTLER = 0;
const RIGHT_BATTLER = 2;
const FOE_1_BATTLER = 1;
const FOE_2_BATTLER = 3;

/** At the first battle action against LEA & JED on Route 16, a double battle, with a third Pokémon in the party. */
async function doubleBattle(): Promise<{ harness: Harness; run: Run }> {
  const run = await Run.open({ startSave: PARTY_SAVE });
  const { mem } = run.game;
  let warping = true;
  const warp = mem.global("sWarpDestination");
  const onFrame = () => {
    run.core.patch16(mem.global("sWildEncountersDisabled").addr, 1);
    if (run.game.map().name === "Route16") warping = false;
    if (!warping) return;
    const group = run.game.allMapNames.findIndex((names) => names.includes("Route16"));
    run.core.patch16(warp.addr, group | (run.game.allMapNames[group].indexOf("Route16") << 8));
    run.core.patch16(warp.field("warpId").addr, 0xff);
    run.core.patch16(warp.field("x").addr, 30);
    run.core.patch16(warp.field("y").addr, 6);
  };
  const harness = await Harness.open({ onFrame }, run);
  await harness.goTo(6, 7);
  const party = mem.global("gPlayerParty");
  const copied = party.at(SAME_SLOT).bytes();
  for (let at = 0; at < POKEMON_SIZE; at += 2) run.core.patch16(party.at(THIRD_SLOT).addr + at, copied[at] | (copied[at + 1] << 8));
  const count = mem.global("gPlayerPartyCount").addr;
  const even = count & ~1;
  const [low, high] = run.core.read(even, 2);
  run.core.patch16(even, count === even ? (high << 8) | 3 : (3 << 8) | low);
  await harness.interact(30, 5);
  while (harness.waitingFor().kind !== "battleAction") await harness.readText();
  return { harness, run };
}

function battleOf(harness: Harness): BattleState {
  const seen = harness.observe();
  if (seen.mode !== "battle") throw new Error(`no battle: ${seen.mode}`);
  return seen.battle;
}

function setBattlerHp(run: Run, battler: number, hp: number): void {
  run.core.patch16(run.game.mem.global("gBattleMons").at(battler).field("hp").addr, hp);
}

/** It moves first, and the level 5 Pokémon survives the foes of level 29. */
function makeFast(run: Run, battler: number): void {
  const mon = run.game.mem.global("gBattleMons").at(battler);
  for (const stat of ["speed", "defense", "spDefense"]) run.core.patch16(mon.field(stat).addr, BIG);
}

const hpOf = (run: Run, battler: number) => run.game.mem.global("gBattleMons").at(battler).field("hp").int();

describe.skipIf(!existsSync(ROM_FILE) || !existsSync(PARTY_SAVE))("a double battle", () => {
  test("the prompt facts name both foes, the Pokémon that chooses and the other one", async () => {
    const { harness } = await doubleBattle();
    const battle = battleOf(harness);
    expect(battle.player.nickname).toBe("SQUIRTLE");
    expect(battle.enemy.species).toBe("RAPIDASH");
    expect(battle.double?.ally?.nickname).toBe("SHELL");
    expect(battle.double?.otherFoe?.enemy.species).toBe("NINETALES");
    expect(battle.double?.otherFoe?.fights).toHaveLength(battle.fights.length);
    // TACKLE hits one foe, and TAIL WHIP hits both.
    expect(battle.double?.reach).toEqual(["one", "both"]);
    harness.close();
  });

  test("fight on the second foe: the choice for the first Pokémon asks for the second one, then the turn plays", async () => {
    const { harness, run } = await doubleBattle();
    makeFast(run, LEFT_BATTLER);
    makeFast(run, RIGHT_BATTLER);
    const foe1 = hpOf(run, FOE_1_BATTLER);
    const foe2 = hpOf(run, FOE_2_BATTLER);

    const first = await harness.fight(0, 2);
    expect(first).toMatchObject({ status: "done", text: [] });
    expect(harness.waitingFor()).toEqual({ kind: "battleAction" });
    const second = battleOf(harness);
    expect(second.player.nickname).toBe("SHELL");
    expect(second.double?.ally?.nickname).toBe("SQUIRTLE");
    expect(hpOf(run, FOE_2_BATTLER)).toBe(foe2);

    const turn = await harness.fight(0, 2);
    expect(turn.text).toEqual(expect.arrayContaining(["SQUIRTLE used TACKLE!", "SHELL used TACKLE!"]));
    while (harness.waitingFor().kind !== "battleAction") must(await harness.readText());
    expect(hpOf(run, FOE_1_BATTLER)).toBe(foe1);
    expect(hpOf(run, FOE_2_BATTLER)).toBeLessThan(foe2);
    expect(battleOf(harness).player.nickname).toBe("SQUIRTLE");
    expect(battleOf(harness).lastTurn?.moves.map((move) => move.user)).toEqual(expect.arrayContaining(["SQUIRTLE", "SHELL"]));
    harness.close();
  });

  test("a fight with no foe hits the first foe", async () => {
    const { harness, run } = await doubleBattle();
    makeFast(run, LEFT_BATTLER);
    makeFast(run, RIGHT_BATTLER);
    const foe1 = hpOf(run, FOE_1_BATTLER);
    const foe2 = hpOf(run, FOE_2_BATTLER);
    must(await harness.fight(0));
    must(await harness.fight(0));
    expect(hpOf(run, FOE_1_BATTLER)).toBeLessThan(foe1);
    expect(hpOf(run, FOE_2_BATTLER)).toBe(foe2);
    harness.close();
  });

  test("with one foe left, a fight hits it, and a choice of a foe is impossible", async () => {
    const { harness, run } = await doubleBattle();
    makeFast(run, LEFT_BATTLER);
    makeFast(run, RIGHT_BATTLER);
    setBattlerHp(run, FOE_1_BATTLER, 1);
    must(await harness.fight(0));
    must(await harness.fight(0));
    while (harness.waitingFor().kind !== "battleAction") must(await harness.readText());
    expect(hpOf(run, FOE_1_BATTLER)).toBe(0);
    const battle = battleOf(harness);
    expect(battle.enemy.species).toBe("NINETALES");
    expect(battle.double?.otherFoe).toBeNull();
    const before = hpOf(run, FOE_2_BATTLER);
    expect(await harness.fight(0, 2)).toMatchObject({ status: "impossible", reason: "there is only one foe to choose: write the fight with no foe", frames: 0 });
    must(await harness.fight(0));
    must(await harness.fight(0));
    while (harness.waitingFor().kind !== "battleAction") must(await harness.readText());
    expect(hpOf(run, FOE_2_BATTLER)).toBeLessThan(before);
    harness.close();
  });

  test("a switch takes out the Pokémon that chooses, and the party has neither Pokémon of the battle to send", async () => {
    const { harness, run } = await doubleBattle();
    makeFast(run, LEFT_BATTLER);
    makeFast(run, RIGHT_BATTLER);
    must(await harness.fight(0));
    expect(harness.availableActions().filter((action) => action.name === "switch")).toEqual([{ name: "switch", slot: THIRD_SLOT }]);
    const switched = await harness.switch(THIRD_SLOT);
    expect(switched.status).toBe("done");
    expect(switched.text.join(" ")).toContain("SHELL");
    while (harness.waitingFor().kind !== "battleAction") must(await harness.readText());
    expect(battleOf(harness).double?.ally?.partyIndex).toBe(THIRD_SLOT);
    harness.close();
  });

  test("an item for each Pokémon: the choice goes on to the second Pokémon", async () => {
    const { harness, run } = await doubleBattle();
    makeFast(run, LEFT_BATTLER);
    makeFast(run, RIGHT_BATTLER);
    const { mem } = run.game;
    const key = mem.global("gSaveBlock2Ptr").deref().field("encryptionKey").int() & 0xffff;
    const slot = mem.global("gBagPockets").at(ITEMS_POCKET).field("itemSlots").at(0);
    run.core.patch16(slot.field("itemId").addr, ITEM_POTION);
    run.core.patch16(slot.field("quantity").addr, 2 ^ key);
    run.core.patch16(mem.global("gPlayerParty").at(0).field("hp").addr, 1);
    must(await harness.use("POTION", 0));
    expect(harness.waitingFor()).toEqual({ kind: "battleAction" });
    expect(battleOf(harness).player.nickname).toBe("SHELL");
    harness.close();
  });

  test("a faint of the second Pokémon asks to send the third one, and the battle goes on", async () => {
    const { harness, run } = await doubleBattle();
    makeFast(run, LEFT_BATTLER);
    setBattlerHp(run, RIGHT_BATTLER, 1);
    run.core.patch16(run.game.mem.global("gBattleMons").at(RIGHT_BATTLER).field("status1").addr, STATUS1_BURN);
    must(await harness.fight(0));
    must(await harness.fight(0));
    while (!["battleAction", "partyPick"].includes(harness.waitingFor().kind)) must(await harness.readText());
    expect(harness.waitingFor()).toEqual({ kind: "partyPick" });
    expect(harness.availableActions()).toEqual([{ name: "send", slot: THIRD_SLOT }]);
    must(await harness.send(THIRD_SLOT));
    while (harness.waitingFor().kind !== "battleAction") must(await harness.readText());
    expect(battleOf(harness).double?.ally?.partyIndex).toBe(THIRD_SLOT);
    harness.close();
  });
});
