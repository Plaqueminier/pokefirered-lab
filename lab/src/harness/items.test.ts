import { describe, expect, setDefaultTimeout, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { BERRY_POUCH_POCKET, ITEMS_POCKET, TM_CASE_POCKET } from "../bag";
import { decryptBox } from "../party";
import { ROM_FILE, Run, SAVES_DIR } from "../run";
import { Harness, must } from "./harness";

setDefaultTimeout(120_000);

const PARTY_SAVE = join(SAVES_DIR, "test-party.sav");
const LEARN_MOVE_SAVE = join(SAVES_DIR, "test-learn-move.sav");
const BAG_SAVE = join(SAVES_DIR, "test-bag.sav");
const KEY_ITEMS_POCKET = 1;
const ITEMS_CAPACITY = 42;
const ITEM_POTION = 13;
const ITEM_ETHER = 34;
const ITEM_ELIXIR = 36;
const ITEM_RARE_CANDY = 68;
const ITEM_PP_UP = 69;
const ITEM_SUN_STONE = 93;
const ITEM_MOON_STONE = 94;
const ITEM_ORANGE_MAIL = 121;
const ITEM_LEPPA_BERRY = 138;
const ITEM_ORAN_BERRY = 139;
const ITEM_EVERSTONE = 195;
const ITEM_LEFTOVERS = 200;
const ITEM_TM13 = 301;
const ITEM_TM_CASE = 364;
const ITEM_BERRY_POUCH = 365;
const SPECIES_NIDORINA = 30;
const SPECIES_GLOOM = 44;

type Slot = [pocket: number, row: number, item: number, quantity?: number];

type MonPatch = { species?: number; held?: number; level?: number; hp?: number; pp?: number[]; moves?: number[]; egg?: true };

const SUBSTRUCTS_SIZE = 48;

function putInBag(run: Run, slots: Slot[]): void {
  const { mem } = run.game;
  const key = mem.global("gSaveBlock2Ptr").deref().field("encryptionKey").int() & 0xffff;
  for (const [pocket, row, item, quantity = 1] of slots) {
    const slot = mem.global("gBagPockets").at(pocket).field("itemSlots").at(row);
    run.core.patch16(slot.field("itemId").addr, item);
    run.core.patch16(slot.field("quantity").addr, quantity ^ key);
  }
}

function patchMon(run: Run, slot: number, { species, held, level, hp, pp, moves, egg }: MonPatch): void {
  const mon = run.game.mem.global("gPlayerParty").at(slot);
  const box = mon.field("box");
  const { substructs, growth, attacks, misc } = decryptBox(box);
  if (egg) substructs.setUint32(misc + 4, (substructs.getUint32(misc + 4, true) | (1 << 30)) >>> 0, true);
  if (species !== undefined) substructs.setUint16(growth, species, true);
  if (held !== undefined) substructs.setUint16(growth + 2, held, true);
  // CalculateMonStats reads the level from the experience.
  if (level !== undefined) substructs.setUint32(growth + 4, run.game.mem.global("gExperienceTables").at(run.game.mem.global("gSpeciesInfo").at(substructs.getUint16(growth, true)).field("growthRate").int()).at(level).int(), true);
  for (const [i, move] of (moves ?? []).entries()) substructs.setUint16(attacks + i * 2, move, true);
  for (const [i, value] of (pp ?? []).entries()) substructs.setUint8(attacks + 8 + i, value);
  let sum = 0;
  for (let at = 0; at < SUBSTRUCTS_SIZE; at += 2) sum += substructs.getUint16(at, true);
  const key = (box.field("personality").int() ^ box.field("otId").int()) >>> 0;
  const secure = box.field("secure").addr;
  for (let at = 0; at < SUBSTRUCTS_SIZE; at += 4) {
    const word = (substructs.getUint32(at, true) ^ key) >>> 0;
    run.core.patch16(secure + at, word & 0xffff);
    run.core.patch16(secure + at + 2, word >>> 16);
  }
  run.core.patch16(box.field("checksum").addr, sum & 0xffff);
  if (level !== undefined) {
    const at = mon.field("level").addr;
    const even = at & ~1;
    const [low, high] = run.core.read(even, 2);
    run.core.patch16(even, at === even ? (high << 8) | level : (level << 8) | low);
  }
  if (hp !== undefined) run.core.patch16(mon.field("hp").addr, hp);
}

async function atWalk({ save = PARTY_SAVE, bag = [], mons = [] }: { save?: string; bag?: Slot[]; mons?: MonPatch[] }): Promise<{ harness: Harness; run: Run }> {
  const run = await Run.open({ startSave: save });
  const harness = await Harness.open({}, run);
  putInBag(run, bag);
  for (const [slot, patch] of mons.entries()) patchMon(run, slot, patch);
  return { harness, run };
}

const quantity = (harness: Harness, item: string) => harness.observe().bag.flatMap((pocket) => pocket.items).find((i) => i.name === item)?.quantity ?? 0;
const mon = (harness: Harness, slot = 0) => harness.observe().party[slot];
const stones = (harness: Harness) => {
  const seen = harness.observe();
  return seen.mode === "overworld" ? seen.stones : [];
};
const pps = (harness: Harness, slot = 0) => mon(harness, slot).moves.map((move) => move.pp);

describe.skipIf(!existsSync(ROM_FILE) || !existsSync(PARTY_SAVE))("PP items", () => {
  test("ETHER on a move gives its PP back, and the Bag loses one", async () => {
    const { harness } = await atWalk({ bag: [[ITEMS_POCKET, 0, ITEM_ETHER, 2]], mons: [{ pp: [1, 2] }] });
    expect(harness.availableActions()).toContainEqual({ name: "use", item: "ETHER" });
    const result = await harness.use("ETHER", 0, "TAIL WHIP");
    expect(result.status).toBe("done");
    expect(result.text).toEqual(["PP was restored."]);
    expect(pps(harness)).toEqual([1, 12]);
    expect(quantity(harness, "ETHER")).toBe(1);
    expect(harness.waitingFor().kind).toBe("walk");
  });

  test("ETHER with no move or an unknown move is impossible and gives the moves, with no frame", async () => {
    const { harness } = await atWalk({ bag: [[ITEMS_POCKET, 0, ITEM_ETHER]], mons: [{ pp: [1, 2] }] });
    const reason = "ETHER works on one move: give a move of SQUIRTLE: TACKLE, TAIL WHIP";
    expect(await harness.use("ETHER", 0)).toMatchObject({ status: "impossible", reason, frames: 0 });
    expect(await harness.use("ETHER", 0, "SURF")).toMatchObject({ status: "impossible", reason, frames: 0 });
    expect(await harness.use("ETHER")).toMatchObject({ status: "impossible", frames: 0 });
    expect(quantity(harness, "ETHER")).toBe(1);
  });

  test("the game refuses ETHER on a move with all its PP: impossible with its text, and the Bag keeps it", async () => {
    const { harness } = await atWalk({ bag: [[ITEMS_POCKET, 0, ITEM_ETHER]] });
    expect(await harness.use("ETHER", 0, "TACKLE")).toMatchObject({ status: "impossible", reason: "the game refuses the ETHER: It won't have any effect." });
    expect(quantity(harness, "ETHER")).toBe(1);
    expect(harness.waitingFor().kind).toBe("walk");
  });

  test("ELIXIR works on all the moves, and it refuses a move", async () => {
    const { harness } = await atWalk({ bag: [[ITEMS_POCKET, 0, ITEM_ELIXIR]], mons: [{ pp: [1, 2] }] });
    expect(await harness.use("ELIXIR", 0, "TACKLE")).toMatchObject({ status: "impossible", reason: "ELIXIR does not work on one move", frames: 0 });
    must(await harness.use("ELIXIR", 0));
    expect(pps(harness)).toEqual([11, 12]);
    expect(quantity(harness, "ELIXIR")).toBe(0);
  });

  test("PP UP raises the maximum PP of the move", async () => {
    const { harness } = await atWalk({ bag: [[ITEMS_POCKET, 0, ITEM_PP_UP]] });
    const before = mon(harness).moves[1].maxPp;
    must(await harness.use("PP UP", 0, "TAIL WHIP"));
    expect(mon(harness).moves[1].maxPp).toBeGreaterThan(before);
    expect(mon(harness).moves[0].maxPp).toBe(mon(harness).moves[0].pp);
    expect(quantity(harness, "PP UP")).toBe(0);
  });
});

describe.skipIf(!existsSync(ROM_FILE) || !existsSync(PARTY_SAVE))("RARE CANDY", () => {
  test("one level for one item, through the box of the stats, back at the walk", async () => {
    const { harness } = await atWalk({ bag: [[ITEMS_POCKET, 0, ITEM_RARE_CANDY, 2]] });
    const { level } = mon(harness);
    expect((await harness.use("RARE CANDY", 0)).status).toBe("done");
    expect(mon(harness).level).toBe(level + 1);
    expect(quantity(harness, "RARE CANDY")).toBe(1);
    expect(harness.waitingFor().kind).toBe("walk");
  });

  test("the level of a new move with a free place: the Pokémon learns it", async () => {
    const { harness } = await atWalk({ bag: [[ITEMS_POCKET, 0, ITEM_RARE_CANDY]], mons: [{ level: 6 }] });
    must(await harness.use("RARE CANDY", 0));
    expect(mon(harness).moves.map((move) => move.name)).toContain("BUBBLE");
    expect(harness.waitingFor().kind).toBe("walk");
  });

  test("the evolution at the new level goes to its end, and B does not stop it", async () => {
    const run = await Run.open({ startSave: PARTY_SAVE });
    let pressed = false;
    const harness = await Harness.open(
      {
        onFrame: (h) => {
          if (pressed || !run.game.evolutionCanStop()) return;
          pressed = true;
          void h.press("B");
        },
      },
      run,
    );
    putInBag(run, [[ITEMS_POCKET, 0, ITEM_RARE_CANDY]]);
    patchMon(run, 0, { level: 15 });
    const result = await harness.use("RARE CANDY", 0);
    expect(pressed).toBe(true);
    expect(result.status).toBe("done");
    expect(result.text).toContain("SQUIRTLE evolved into WARTORTLE!");
    expect(mon(harness)).toMatchObject({ species: "WARTORTLE", level: 16 });
    expect(harness.waitingFor().kind).toBe("walk");
  });

  test("the game refuses at level 100: impossible with its text", async () => {
    const { harness } = await atWalk({ bag: [[ITEMS_POCKET, 0, ITEM_RARE_CANDY]], mons: [{ level: 100 }] });
    expect(await harness.use("RARE CANDY", 0)).toMatchObject({ status: "impossible", reason: "the game refuses the RARE CANDY: It won't have any effect." });
    expect(quantity(harness, "RARE CANDY")).toBe(1);
  });
});

describe.skipIf(!existsSync(ROM_FILE) || !existsSync(LEARN_MOVE_SAVE))("RARE CANDY and the question to learn a move", () => {
  const atLearnMove = async () => {
    const { harness } = await atWalk({ save: LEARN_MOVE_SAVE, bag: [[ITEMS_POCKET, 0, ITEM_RARE_CANDY]], mons: [{ level: 17, held: ITEM_EVERSTONE }] });
    must(await harness.use("RARE CANDY", 0));
    expect(harness.waitingFor()).toMatchObject({ kind: "learnMove", slot: 0, move: { name: "BITE" } });
    expect(harness.observe().mode).toBe("menu");
    return harness;
  };

  test("forget gives the move and goes back to the walk from the Bag", async () => {
    const harness = await atLearnMove();
    expect(await harness.forget("TAIL WHIP")).toMatchObject({ status: "done", text: ["SQUIRTLE learned BITE!"] });
    expect(mon(harness).moves.map((move) => move.name)).toEqual(["TACKLE", "BITE", "WITHDRAW", "WATER GUN"]);
    expect(harness.waitingFor().kind).toBe("walk");
  });

  test("keep leaves the moves and goes back to the walk from the Bag", async () => {
    const harness = await atLearnMove();
    expect(await harness.keep()).toMatchObject({ status: "done", text: ["SQUIRTLE did not learn the move BITE."] });
    expect(mon(harness).moves.map((move) => move.name)).toEqual(["TACKLE", "TAIL WHIP", "WITHDRAW", "WATER GUN"]);
    expect(quantity(harness, "RARE CANDY")).toBe(0);
    expect(harness.waitingFor().kind).toBe("walk");
  });
});

describe.skipIf(!existsSync(ROM_FILE) || !existsSync(PARTY_SAVE))("evolution stones", () => {
  test("the Bag names the Pokémon that a stone evolves, and the stone evolves it", async () => {
    const { harness } = await atWalk({ bag: [[ITEMS_POCKET, 0, ITEM_MOON_STONE]], mons: [{}, { species: SPECIES_NIDORINA, level: 20 }] });
    expect(stones(harness)).toEqual([{ item: "MOON STONE", evolutions: [{ slot: 1, species: "NIDOQUEEN" }] }]);
    const result = await harness.use("MOON STONE", 1);
    expect(result.status).toBe("done");
    expect(result.text).toContain("SHELL evolved into NIDOQUEEN!");
    expect(mon(harness, 1).species).toBe("NIDOQUEEN");
    expect(quantity(harness, "MOON STONE")).toBe(0);
    expect(harness.waitingFor().kind).toBe("walk");
  });

  test("a stone that evolves no Pokémon of the party is not in the list, and the game refuses it", async () => {
    const { harness } = await atWalk({ bag: [[ITEMS_POCKET, 0, ITEM_MOON_STONE]] });
    expect(stones(harness)).toEqual([{ item: "MOON STONE", evolutions: [] }]);
    expect(harness.availableActions()).not.toContainEqual({ name: "use", item: "MOON STONE" });
    expect(await harness.use("MOON STONE", 0)).toMatchObject({ status: "impossible", reason: "the game refuses the MOON STONE: It won't have any effect." });
    expect(quantity(harness, "MOON STONE")).toBe(1);
  });

  test("a Pokémon that holds an EVERSTONE is not in the list", async () => {
    const { harness } = await atWalk({ bag: [[ITEMS_POCKET, 0, ITEM_MOON_STONE]], mons: [{ species: SPECIES_NIDORINA, held: ITEM_EVERSTONE }] });
    expect(stones(harness)).toEqual([{ item: "MOON STONE", evolutions: [] }]);
  });

  test("with no National Pokédex, an evolution past number 151 is not in the list, and the game refuses it", async () => {
    const { harness } = await atWalk({ bag: [[ITEMS_POCKET, 0, ITEM_SUN_STONE]], mons: [{ species: SPECIES_GLOOM }] });
    expect(stones(harness)).toEqual([{ item: "SUN STONE", evolutions: [] }]);
    expect(await harness.use("SUN STONE", 0)).toMatchObject({ status: "impossible", reason: "the game refuses the SUN STONE" });
    expect(quantity(harness, "SUN STONE")).toBe(1);
    expect(mon(harness).species).toBe("GLOOM");
    expect(harness.waitingFor().kind).toBe("walk");
  });

  test("the question to learn a move in the scene of an evolution: keep goes back to the walk", async () => {
    const { harness } = await atWalk({ save: LEARN_MOVE_SAVE, bag: [[ITEMS_POCKET, 0, ITEM_MOON_STONE]], mons: [{ species: SPECIES_NIDORINA, level: 22 }] });
    must(await harness.use("MOON STONE", 0));
    expect(harness.waitingFor()).toMatchObject({ kind: "learnMove", slot: 0, move: { name: "BODY SLAM" } });
    must(await harness.keep());
    expect(mon(harness).species).toBe("NIDOQUEEN");
    expect(harness.waitingFor().kind).toBe("walk");
  });

  test("the question to learn a move in the scene of an evolution: forget gives the move", async () => {
    const { harness } = await atWalk({ save: LEARN_MOVE_SAVE, bag: [[ITEMS_POCKET, 0, ITEM_MOON_STONE]], mons: [{ species: SPECIES_NIDORINA, level: 22 }] });
    must(await harness.use("MOON STONE", 0));
    must(await harness.forget("TACKLE"));
    expect(mon(harness).moves[0].name).toBe("BODY SLAM");
    expect(harness.waitingFor().kind).toBe("walk");
  });
});

describe.skipIf(!existsSync(ROM_FILE) || !existsSync(PARTY_SAVE))("Berries", () => {
  const POUCH: Slot = [KEY_ITEMS_POCKET, 0, ITEM_BERRY_POUCH];

  test("use goes through the BERRY POUCH on a walk, and finds the Berry on its sorted row", async () => {
    const { harness } = await atWalk({ bag: [POUCH, [BERRY_POUCH_POCKET, 0, ITEM_ORAN_BERRY, 2], [BERRY_POUCH_POCKET, 1, ITEM_LEPPA_BERRY]], mons: [{ hp: 1, pp: [1, 2] }] });
    expect(harness.availableActions()).toEqual(expect.arrayContaining([{ name: "use", item: "ORAN BERRY" }, { name: "use", item: "LEPPA BERRY" }]));
    must(await harness.use("ORAN BERRY", 0));
    expect(mon(harness).hp).toBeGreaterThan(1);
    expect(quantity(harness, "ORAN BERRY")).toBe(1);
    expect(harness.waitingFor().kind).toBe("walk");
    must(await harness.use("LEPPA BERRY", 0, "TACKLE"));
    expect(pps(harness)[0]).toBeGreaterThan(1);
    expect(quantity(harness, "LEPPA BERRY")).toBe(0);
    expect(harness.waitingFor().kind).toBe("walk");
  });

  test("the game refuses a Berry with no effect: impossible with its text", async () => {
    const { harness } = await atWalk({ bag: [POUCH, [BERRY_POUCH_POCKET, 0, ITEM_ORAN_BERRY]] });
    expect(await harness.use("ORAN BERRY", 0)).toMatchObject({ status: "impossible", reason: "the game refuses the ORAN BERRY: It won't have any effect." });
    expect(quantity(harness, "ORAN BERRY")).toBe(1);
    expect(harness.waitingFor().kind).toBe("walk");
  });

  const toWildBattle = async (harness: Harness) => {
    const observation = harness.observe();
    if (observation.mode !== "overworld") throw new Error("the test Starting save is not on the overworld");
    const { x, y } = observation.player;
    for (let step = 0; harness.waitingFor().kind === "walk"; step++) {
      if (step === 100) throw new Error("no wild battle in 100 steps");
      await harness.goTo(x, step % 2 === 0 ? y - 1 : y);
    }
    await toBattleAction(harness);
  };

  const toBattleAction = async (harness: Harness) => {
    for (let reads = 0; harness.waitingFor().kind !== "battleAction"; reads++) {
      if (reads === 50) throw new Error(`no battle action: the game waits for ${harness.waitingFor().kind}`);
      await harness.readText();
    }
  };

  test("in a battle, use goes through the BERRY POUCH, and a move item names the move", async () => {
    const { harness } = await atWalk({ save: BAG_SAVE, bag: [POUCH, [BERRY_POUCH_POCKET, 0, ITEM_ORAN_BERRY], [BERRY_POUCH_POCKET, 1, ITEM_LEPPA_BERRY], [ITEMS_POCKET, 1, ITEM_ETHER]], mons: [{ pp: [1, 2] }] });
    await toWildBattle(harness);
    expect(harness.availableActions()).toEqual(expect.arrayContaining([{ name: "use", item: "ORAN BERRY" }, { name: "use", item: "LEPPA BERRY" }, { name: "use", item: "ETHER" }]));
    const [first, second] = mon(harness).moves.map((move) => move.name);
    expect(await harness.use("ETHER", 0)).toMatchObject({ status: "impossible", frames: 0 });
    must(await harness.use("ETHER", 0, first));
    expect(quantity(harness, "ETHER")).toBe(0);
    await toBattleAction(harness);
    must(await harness.use("LEPPA BERRY", 0, second));
    expect(quantity(harness, "LEPPA BERRY")).toBe(0);
    await toBattleAction(harness);
    expect(pps(harness).slice(0, 2).every((pp) => pp > 2)).toBe(true);
  });

  test("in a battle, the game refuses a Berry with no effect: impossible with its text, and back at the battle action", async () => {
    const { harness } = await atWalk({ save: BAG_SAVE, bag: [POUCH, [BERRY_POUCH_POCKET, 0, ITEM_ORAN_BERRY]] });
    await toWildBattle(harness);
    expect(await harness.use("ORAN BERRY", 0)).toMatchObject({ status: "impossible", reason: "the game refuses the ORAN BERRY: It won't have any effect." });
    expect(quantity(harness, "ORAN BERRY")).toBe(1);
    expect(harness.waitingFor().kind).toBe("battleAction");
  });

  test("give works through the BERRY POUCH", async () => {
    const { harness } = await atWalk({ bag: [POUCH, [BERRY_POUCH_POCKET, 0, ITEM_ORAN_BERRY]] });
    must(await harness.give("ORAN BERRY", 1));
    expect(mon(harness, 1).heldItem?.name).toBe("ORAN BERRY");
    expect(quantity(harness, "ORAN BERRY")).toBe(0);
    expect(harness.waitingFor().kind).toBe("walk");
  });
});

describe.skipIf(!existsSync(ROM_FILE) || !existsSync(PARTY_SAVE))("give and take", () => {
  test("give puts the item on the Pokémon, the Bag loses one, and the prompt facts have its description", async () => {
    const { harness } = await atWalk({ bag: [[ITEMS_POCKET, 0, ITEM_LEFTOVERS, 2], [ITEMS_POCKET, 1, ITEM_POTION]] });
    expect(harness.availableActions()).toContainEqual({ name: "give", item: "LEFTOVERS" });
    expect(harness.availableActions()).not.toContainEqual({ name: "give", item: "POTION" });
    expect(await harness.give("LEFTOVERS", 1)).toMatchObject({ status: "done", text: ["SHELL holds LEFTOVERS."] });
    expect(mon(harness, 1).heldItem?.name).toBe("LEFTOVERS");
    expect(mon(harness, 1).heldItem?.description).toContain("HP");
    expect(quantity(harness, "LEFTOVERS")).toBe(1);
    expect(harness.waitingFor().kind).toBe("walk");
  });

  test("give on a Pokémon that holds an item answers yes to the swap, and the result says so", async () => {
    const { harness } = await atWalk({ bag: [[ITEMS_POCKET, 0, ITEM_LEFTOVERS]], mons: [{ held: ITEM_EVERSTONE }] });
    expect(await harness.give("LEFTOVERS", 0)).toMatchObject({ status: "done", text: ["SQUIRTLE holds LEFTOVERS.", "EVERSTONE went back to the Bag."] });
    expect(mon(harness).heldItem?.name).toBe("LEFTOVERS");
    expect(quantity(harness, "EVERSTONE")).toBe(1);
    expect(quantity(harness, "LEFTOVERS")).toBe(0);
    expect(harness.waitingFor().kind).toBe("walk");
  });

  test("give is impossible for an item with no held effect, an item that the Pokémon holds and a Pokémon not in the party", async () => {
    const { harness } = await atWalk({ bag: [[ITEMS_POCKET, 0, ITEM_POTION], [ITEMS_POCKET, 1, ITEM_LEFTOVERS]], mons: [{ held: ITEM_LEFTOVERS }] });
    expect(await harness.give("POTION", 0)).toMatchObject({ status: "impossible", reason: "POTION has no effect when a Pokémon holds it", frames: 0 });
    expect(await harness.give("LEFTOVERS", 0)).toMatchObject({ status: "impossible", reason: "SQUIRTLE already holds LEFTOVERS", frames: 0 });
    expect(await harness.give("LEFTOVERS", 5)).toMatchObject({ status: "impossible", frames: 0 });
    expect(await harness.give("ORAN BERRY", 0)).toMatchObject({ status: "impossible", reason: "there is no ORAN BERRY in the Bag", frames: 0 });
  });

  test("take puts the item in the Bag, with no event of a received item", async () => {
    const { harness } = await atWalk({ mons: [{}, { held: ITEM_LEFTOVERS }] });
    expect(harness.availableActions()).toContainEqual({ name: "take", on: 1 });
    expect(await harness.take(1)).toMatchObject({ status: "done", text: ["LEFTOVERS of SHELL went to the Bag."] });
    expect(mon(harness, 1).heldItem).toBeNull();
    expect(quantity(harness, "LEFTOVERS")).toBe(1);
    expect(harness.events.filter((event) => event.type === "item")).toEqual([]);
    expect(harness.waitingFor().kind).toBe("walk");
  });

  test("take is impossible for a Pokémon with no item", async () => {
    const { harness } = await atWalk({});
    expect(await harness.take(0)).toMatchObject({ status: "impossible", reason: "SQUIRTLE holds no item", frames: 0 });
  });

  test("Mail: give and take on the holder give the reason, and take is not offered", async () => {
    const { harness } = await atWalk({ bag: [[ITEMS_POCKET, 0, ITEM_LEFTOVERS], [ITEMS_POCKET, 1, ITEM_ORANGE_MAIL]], mons: [{ held: ITEM_ORANGE_MAIL }] });
    const reason = "SQUIRTLE holds ORANGE MAIL, and the program does not take Mail";
    expect(await harness.give("LEFTOVERS", 0)).toMatchObject({ status: "impossible", reason, frames: 0 });
    expect(await harness.take(0)).toMatchObject({ status: "impossible", reason, frames: 0 });
    expect(harness.availableActions()).not.toContainEqual({ name: "take", on: 0 });
    expect(harness.availableActions()).not.toContainEqual({ name: "give", item: "ORANGE MAIL" });
    expect(await harness.give("ORANGE MAIL", 1)).toMatchObject({ status: "impossible", reason: "ORANGE MAIL has no effect when a Pokémon holds it", frames: 0 });
  });

  const fullBag = (): Slot[] => Array.from({ length: ITEMS_CAPACITY }, (_, row): Slot => [ITEMS_POCKET, row, ITEM_POTION + row]);

  test("give with a swap and a full Bag is impossible, and each item stays where it was", async () => {
    const { harness } = await atWalk({ bag: [...fullBag(), [KEY_ITEMS_POCKET, 0, ITEM_BERRY_POUCH], [BERRY_POUCH_POCKET, 0, ITEM_ORAN_BERRY]], mons: [{ held: ITEM_EVERSTONE }] });
    expect(await harness.give("ORAN BERRY", 0)).toMatchObject({ status: "impossible", reason: "the Bag has no room for EVERSTONE" });
    expect(mon(harness).heldItem?.name).toBe("EVERSTONE");
    expect(quantity(harness, "ORAN BERRY")).toBe(1);
    expect(harness.waitingFor().kind).toBe("walk");
  });

  test("take with a full Bag is impossible, and the Pokémon keeps the item", async () => {
    const { harness } = await atWalk({ bag: fullBag(), mons: [{ held: ITEM_LEFTOVERS }] });
    expect(await harness.take(0)).toMatchObject({ status: "impossible", reason: "the Bag has no room for LEFTOVERS" });
    expect(mon(harness).heldItem?.name).toBe("LEFTOVERS");
    expect(harness.waitingFor().kind).toBe("walk");
  });
});

describe.skipIf(!existsSync(ROM_FILE) || !existsSync(PARTY_SAVE))("an Egg", () => {
  const atEgg = () =>
    atWalk({
      bag: [[ITEMS_POCKET, 0, ITEM_POTION], [ITEMS_POCKET, 1, ITEM_ETHER], [ITEMS_POCKET, 2, ITEM_LEFTOVERS], [ITEMS_POCKET, 3, ITEM_MOON_STONE], [KEY_ITEMS_POCKET, 0, ITEM_TM_CASE], [TM_CASE_POCKET, 0, ITEM_TM13]],
      mons: [{}, { species: SPECIES_NIDORINA, held: ITEM_EVERSTONE, egg: true }],
    });

  test("use, give and take give the reason with no frame, and the game stays at the walk", async () => {
    const { harness } = await atEgg();
    const reason = "SHELL is an Egg, and the game allows no item on an Egg";
    expect(await harness.use("POTION", 1)).toMatchObject({ status: "impossible", reason, frames: 0 });
    expect(await harness.use("ETHER", 1, "TACKLE")).toMatchObject({ status: "impossible", reason, frames: 0 });
    expect(await harness.use("MOON STONE", 1)).toMatchObject({ status: "impossible", reason, frames: 0 });
    expect(await harness.give("LEFTOVERS", 1)).toMatchObject({ status: "impossible", reason, frames: 0 });
    expect(await harness.take(1)).toMatchObject({ status: "impossible", reason, frames: 0 });
    expect(harness.availableActions()).not.toContainEqual({ name: "take", on: 1 });
    expect(harness.waitingFor().kind).toBe("walk");
  });

  test("a stone and a TM do not list an Egg", async () => {
    const { harness, run } = await atEgg();
    patchMon(run, 1, { held: 0 });
    expect(stones(harness)).toEqual([{ item: "MOON STONE", evolutions: [] }]);
    expect(harness.observe()).toMatchObject({ teachables: [{ item: "TM13", able: [0], knowing: [] }] });
  });
});
