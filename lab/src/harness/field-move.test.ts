import { describe, expect, setDefaultTimeout, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { modelBot } from "../../bots/model";
import { atlasExtract } from "../model/extract";
import type { ModelClient } from "../model/openrouter";
import { FLAG_SYS_B_DASH } from "../game";
import { decryptBox } from "../party";
import { ROM_FILE, Run, SAVES_DIR, START_SAVE } from "../run";
import { cellAt, mapNamed } from "./atlas";
import { type ActionEntry, type Bot, Harness, must } from "./harness";

setDefaultTimeout(60_000);

const PARTY_SAVE = join(SAVES_DIR, "test-party.sav");
const FLAG_BADGE01_GET = 0x820;
const FLAG_BADGE02_GET = 0x821;
const FLAG_BADGE06_GET = 0x825;
const MOVE_CUT = 15;
const MOVE_FLASH = 148;
const MOVE_ROCK_SMASH = 249;
const SPECIES_PIKACHU = 25;
const ITEM_HM05 = 343;
const ITEM_TM_CASE = 364;
const TM_CASE_POCKET = 3;
const KEY_ITEMS_POCKET = 1;
const MAP_WIDTH = 48;
const PALLET_DOOR = { x: 6, y: 7 };
const THIRD_MOVE_OFFSET = 4;

type WarpTo = { map: string; x: number; y: number };

function warpPatch(run: Run, first: WarpTo, wild: boolean): { onFrame: () => void; warpTo: (next: WarpTo) => void } {
  let target: WarpTo | null = first;
  const warp = run.game.mem.global("sWarpDestination");
  return {
    warpTo: (next) => {
      target = next;
    },
    onFrame: () => {
      if (!wild) run.core.patch16(run.game.mem.global("sWildEncountersDisabled").addr, 1);
      if (!target) return;
      if (run.game.map().name === target.map) {
        target = null;
        return;
      }
      const group = run.game.allMapNames.findIndex((names) => target !== null && names.includes(target.map));
      run.core.patch16(warp.addr, group | (run.game.allMapNames[group].indexOf(target.map) << 8));
      run.core.patch16(warp.field("warpId").addr, 0xff);
      run.core.patch16(warp.field("x").addr, target.x);
      run.core.patch16(warp.field("y").addr, target.y);
    },
  };
}

function firstAnswer(users: string[], first: (user: string) => string): ModelClient {
  return async ({ user }) => {
    users.push(user);
    const action = users.length === 1 ? first(user) : "I do not know";
    return { content: JSON.stringify({ reason: "r", action, mission: "m", objective: "o", note: "" }), usage: { promptTokens: 1, cachedTokens: 0, completionTokens: 1, reasoningTokens: 0, cost: 0 } };
  };
}

async function openAt(map: string, x: number, y: number, wild = true): Promise<{ harness: Harness; run: Run; warpTo: (next: WarpTo) => void }> {
  const run = await Run.open({ startSave: PARTY_SAVE });
  const { onFrame, warpTo } = warpPatch(run, { map, x, y }, wild);
  const harness = await Harness.open({ onFrame }, run);
  await harness.goTo(PALLET_DOOR.x, PALLET_DOOR.y);
  expect(harness.observe()).toMatchObject({ map: { name: map }, player: { x, y } });
  return { harness, run, warpTo };
}

function setFlag(run: Run, flag: number): void {
  const flags = run.game.mem.global("gSaveBlock1Ptr").deref().field("flags");
  const at = flags.addr + (flag >> 3);
  const even = at & ~1;
  const [low, high] = run.core.read(even, 2);
  run.core.patch16(even, (low | (high << 8)) | (1 << ((flag & 7) + (at === even ? 0 : 8))));
}

function patchSecure(run: Run, slot: number, part: "growth" | "attacks", offset: number, value: number): void {
  const box = run.game.mem.global("gPlayerParty").at(slot).field("box");
  const personality = box.field("personality").int();
  const otId = box.field("otId").int();
  const decrypted = decryptBox(box);
  const at = decrypted[part] + offset;
  const before = decrypted.substructs.getUint16(at, true);
  run.core.patch16(box.field("secure").addr + at, value ^ ((personality ^ otId) & 0xffff));
  run.core.patch16(box.field("checksum").addr, (box.field("checksum").int() + value - before) & 0xffff);
}

function setThirdMove(run: Run, slot: number, move: number): void {
  patchSecure(run, slot, "attacks", THIRD_MOVE_OFFSET, move);
}

function cellOf(harness: Harness, map: string, x: number, y: number): string {
  return cellAt(mapNamed(harness.observe().atlas, map), { x, y });
}

const obstacleEvents = (harness: Harness) => harness.events.filter((e) => e.type === "obstacle");

const flashEvents = (harness: Harness) => harness.events.filter((e) => e.type === "flash");

const seenAt = (harness: Harness, map: string, x: number, y: number) => harness.sight()[map][y * MAP_WIDTH + x] === "1";

const seenCount = (harness: Harness, map: string) => [...harness.sight()[map]].filter((seen) => seen === "1").length;

function learnFlash(run: Run, slot = 0): void {
  setFlag(run, FLAG_BADGE01_GET);
  setThirdMove(run, slot, MOVE_FLASH);
}

describe.skipIf(!existsSync(ROM_FILE) || !existsSync(PARTY_SAVE))("FLASH, on the Dark maps", () => {
  test("the arrival on a Dark map lights it in the middle of a walk: there is no action, the 15 x 10 cells are seen at once, and the record has the event", async () => {
    const { harness, run } = await openAt("Route10", 8, 20, false);
    learnFlash(run);
    expect(await harness.goTo(8, 19)).toMatchObject({ status: "done" });
    expect(harness.observe()).toMatchObject({ map: { name: "RockTunnel_1F" }, player: { x: 17, y: 2 } });
    expect(run.game.flashActive()).toBe(true);
    expect(seenAt(harness, "RockTunnel_1F", 24, 6)).toBe(true);
    expect(seenAt(harness, "RockTunnel_1F", 25, 6)).toBe(false);
    expect(mapNamed(harness.observe().atlas, "RockTunnel_1F").dark).toBeUndefined();
    expect(flashEvents(harness)).toEqual([{ type: "flash", frame: expect.any(Number), map: "RockTunnel_1F", species: "SQUIRTLE" }]);
    expect(harness.actions.map(({ action }) => action.name)).toEqual(["goTo", "goTo"]);
    harness.close();
  });

  test("a walk goes on after the use of FLASH", async () => {
    const { harness, run } = await openAt("Route10", 8, 20, false);
    learnFlash(run);
    expect(await harness.goTo(17, 4, "RockTunnel_1F")).toMatchObject({ status: "done" });
    expect(harness.observe()).toMatchObject({ map: { name: "RockTunnel_1F" }, player: { x: 17, y: 4 } });
    expect(flashEvents(harness)).toHaveLength(1);
    harness.close();
  });

  test("a teach of FLASH in the dark lights the map before the next walk prompt", async () => {
    const { harness, run } = await openAt("RockTunnel_1F", 17, 3, false);
    setFlag(run, FLAG_BADGE01_GET);
    patchSecure(run, 0, "growth", 0, SPECIES_PIKACHU);
    const { mem } = run.game;
    const key = mem.global("gSaveBlock2Ptr").deref().field("encryptionKey").int() & 0xffff;
    const put = (pocket: number, item: number) => {
      const slot = mem.global("gBagPockets").at(pocket).field("itemSlots").at(0);
      run.core.patch16(slot.field("itemId").addr, item);
      run.core.patch16(slot.field("quantity").addr, 1 ^ key);
    };
    put(TM_CASE_POCKET, ITEM_HM05);
    put(KEY_ITEMS_POCKET, ITEM_TM_CASE);
    expect(mapNamed(harness.observe().atlas, "RockTunnel_1F").dark).toEqual({ missingBadge: null });
    must(await harness.teach("HM05", 0));
    expect(run.game.flashActive()).toBe(true);
    expect(mapNamed(harness.observe().atlas, "RockTunnel_1F").dark).toBeUndefined();
    expect(seenCount(harness, "RockTunnel_1F")).toBeGreaterThan(9);
    expect(flashEvents(harness)).toHaveLength(1);
    harness.close();
  });

  test("the first Pokémon that knows FLASH uses it, also when it fainted", async () => {
    const { harness, run } = await openAt("RockTunnel_1F", 17, 3, false);
    learnFlash(run, 1);
    run.core.patch16(run.game.mem.global("gPlayerParty").at(1).field("hp").addr, 0);
    must(await harness.goTo(17, 4));
    expect(run.game.flashActive()).toBe(true);
    expect(flashEvents(harness)).toEqual([expect.objectContaining({ species: harness.observe().party[1].species })]);
    harness.close();
  });

  test("with no badge, FLASH is not used and the map stays dark for the model", async () => {
    const { harness, run } = await openAt("RockTunnel_1F", 17, 3, false);
    setThirdMove(run, 0, MOVE_FLASH);
    must(await harness.goTo(17, 4));
    expect(run.game.flashActive()).toBe(false);
    expect(mapNamed(harness.observe().atlas, "RockTunnel_1F").dark).toEqual({ missingBadge: 1 });
    harness.close();
  });

  test("FLASH stays active on the second floor, and the map is dark again after an exit to Route 10", async () => {
    const { harness, run, warpTo } = await openAt("RockTunnel_1F", 19, 13, false);
    learnFlash(run);
    must(await harness.goTo(19, 14));
    expect(flashEvents(harness)).toHaveLength(1);
    must(await harness.goTo(20, 13));
    expect(harness.observe()).toMatchObject({ map: { name: "RockTunnel_B1F" } });
    expect(run.game.flashActive()).toBe(true);
    expect(seenCount(harness, "RockTunnel_B1F")).toBeGreaterThan(9);
    expect(flashEvents(harness)).toHaveLength(1);
    setThirdMove(run, 0, 0);
    warpTo({ map: "Route10", x: 8, y: 20 });
    const { player } = harness.observe() as { player: { x: number; y: number } };
    expect(player).toEqual(expect.objectContaining({ x: 27, y: 12 }));
    must(await harness.goTo(27, 13));
    await harness.goTo(27, 12);
    expect(harness.observe()).toMatchObject({ map: { name: "Route10" } });
    expect(run.game.flashActive()).toBe(false);
    expect(mapNamed(harness.observe().atlas, "RockTunnel_1F").dark).toEqual({ missingBadge: null });
    learnFlash(run);
    must(await harness.goTo(8, 19));
    expect(flashEvents(harness)).toHaveLength(2);
    harness.close();
  });
});

describe.skipIf(!existsSync(ROM_FILE) || !existsSync(PARTY_SAVE))("a walk on a map that is dark for the model", () => {
  const stepThrough = async (harness: Harness, cells: [number, number][]) => {
    for (const [x, y] of cells) must(await harness.goTo(x, y));
  };

  test("goTo refuses an unseen cell, and a route uses only seen cells", async () => {
    const { harness } = await openAt("RockTunnel_1F", 17, 4, false);
    expect(await harness.goTo(30, 5)).toMatchObject({ status: "impossible", reason: expect.stringContaining("you did not see (30, 5)") });
    const east = Array.from({ length: 8 }, (_, i): [number, number] => [18 + i, 4]);
    const south = Array.from({ length: 4 }, (_, i): [number, number] => [25, 5 + i]);
    const west = Array.from({ length: 5 }, (_, i): [number, number] => [24 - i, 8]);
    await stepThrough(harness, [...east, ...south, ...west]);
    expect(seenAt(harness, "RockTunnel_1F", 20, 6)).toBe(false);
    const { frames } = await harness.goTo(20, 5);
    expect(harness.observe()).toMatchObject({ player: { x: 20, y: 5 } });
    expect(frames).toBeGreaterThanOrEqual(11 * 16);
    harness.close();
  });

  test("a route from another map also refuses an unseen cell of a dark map", async () => {
    const { harness } = await openAt("Route10", 8, 20, false);
    expect(await harness.goTo(17, 4, "RockTunnel_1F")).toMatchObject({ status: "impossible" });
    expect(harness.observe()).toMatchObject({ map: { name: "Route10" }, player: { x: 8, y: 20 } });
    harness.close();
  });

  test("walkOn stops at a wall", async () => {
    const { harness } = await openAt("RockTunnel_1F", 17, 3, false);
    expect(await harness.walkOn(18, 3, "east")).toMatchObject({ status: "done" });
    expect(harness.observe()).toMatchObject({ player: { x: 20, y: 3 } });
    expect(harness.actions.at(-1)?.action).toEqual({ name: "walkOn", x: 18, y: 3, direction: "east" });
    harness.close();
  });

  test("walkOn goes along a long wall when the asked side has unseen cells: Run 00047 paid one Model call for each 2 cells on this row", async () => {
    const { harness } = await openAt("RockTunnel_1F", 30, 14, false);
    await stepThrough(harness, Array.from({ length: 14 }, (_, i): [number, number] => [31 + i, 14]));
    const decisions = harness.actions.length;
    expect(await harness.walkOn(41, 15, "south")).toMatchObject({ status: "done" });
    expect(harness.actions.length).toBe(decisions + 1);
    expect(harness.observe()).toMatchObject({ player: { x: 28, y: 15 } });
    expect(cellOf(harness, "RockTunnel_1F", 27, 15)).toBe("#");
    harness.close();
  });

  test("walkOn stops before an exit", async () => {
    const { harness } = await openAt("RockTunnel_1F", 17, 13, false);
    expect(await harness.walkOn(18, 13, "east")).toMatchObject({ status: "done" });
    expect(harness.observe()).toMatchObject({ map: { name: "RockTunnel_1F" }, player: { x: 19, y: 13 } });
    harness.close();
  });

  test("walkOn stops at a new person", async () => {
    const { harness } = await openAt("RockTunnel_1F", 15, 22, false);
    expect(await harness.walkOn(16, 22, "east")).toMatchObject({ status: "done" });
    expect(harness.observe()).toMatchObject({ player: { x: 21, y: 22 } });
    expect(mapNamed(harness.observe().atlas, "RockTunnel_1F").people).toMatchObject([{ x: 22, y: 22, graphics: "ITEM_BALL" }]);
    harness.close();
  });

  test("walkOn stops at a trainer who sees the player, before the player sees the trainer", async () => {
    const { harness } = await openAt("RockTunnel_1F", 10, 17, false);
    expect(await harness.walkOn(11, 17, "east")).toMatchObject({ status: "interrupted", reason: "trainer" });
    expect(harness.observe()).toMatchObject({ player: { x: 16, y: 17 } });
    harness.close();
  });

  test("a walk goes through a Fixed obstacle that the party can remove", async () => {
    const { harness, run } = await openAt("RockTunnel_B1F", 2, 21, false);
    setFlag(run, FLAG_BADGE06_GET);
    setThirdMove(run, 0, MOVE_ROCK_SMASH);
    await harness.walkOn(2, 22, "south");
    expect(obstacleEvents(harness)).toEqual([expect.objectContaining({ move: "ROCK SMASH", x: 2, y: 23 })]);
    harness.close();
  });

  test("go to an unseen cells target plays one walkOn for one Model call", async () => {
    const { harness } = await openAt("RockTunnel_1F", 17, 3, false);
    const users: string[] = [];
    const letter = (user: string) => user.match(/^([A-Z]). unseen cells east of/m)?.[1];
    const client = firstAnswer(users, (user) => "go " + letter(user));
    await expect(harness.play(modelBot({ costLimit: 1 }, () => client))).rejects.toThrow("3 answers in a row that the Bot cannot read");
    expect(users[0]).toContain("This map is dark: you see about 3 x 3 cells. The HM move FLASH lights it, and no Pokémon of your party knows it.");
    expect(users[0]).not.toContain("(25, ");
    const played = harness.actions.slice(1).map(({ action }: ActionEntry) => action.name);
    expect(played).toEqual(["walkOn"]);
    expect(harness.observe()).toMatchObject({ player: { x: 20, y: 3 } });
    harness.close();
  });

  test("a new cell seen resets the Stuck counter on a dark map, and not on another map", async () => {
    const stuckAfter = async (map: string, x: number, y: number, to: number) => {
      const { harness } = await openAt(map, x, y, false);
      const counts: number[] = [];
      const bot: Bot = {
        name: "walker",
        version: "1",
        play: async (h) => {
          must(await h.goTo(to, y));
          counts.push(h.noProgress.stuck);
          must(await h.goTo(x, y));
          counts.push(h.noProgress.stuck);
        },
      };
      await harness.play(bot);
      harness.close();
      return counts;
    };
    expect(await stuckAfter("RockTunnel_1F", 17, 4, 18)).toEqual([0, 1]);
    expect(await stuckAfter("Route10", 8, 20, 9)).toEqual([1, 2]);
  });

  test("the replay of a parent Run record gives the Atlas of the 3 x 3 rule", async () => {
    const target = { map: "RockTunnel_1F", x: 17, y: 4 };
    const { harness } = await openAt(target.map, target.x, target.y, false);
    await harness.play({ name: "walker", version: "1", play: async (h) => void (await h.goTo(18, 4)) });
    const parent = { name: "parent", record: harness.record() };
    const sight = harness.sight().RockTunnel_1F;
    harness.close();
    const run = await Run.open({ startSave: PARTY_SAVE });
    const child = await Harness.open({ onFrame: warpPatch(run, target, false).onFrame, parent }, run);
    expect(child.sight().RockTunnel_1F).toBe(sight);
    expect([...sight].filter((seen) => seen === "1")).toHaveLength(12);
    child.close();
  });
});

describe.skipIf(!existsSync(ROM_FILE) || !existsSync(PARTY_SAVE))("a Fixed obstacle, on real maps", () => {
  test("goTo crosses a real cut tree and arrives: the event is in the record, and the result has no text", async () => {
    const { harness, run } = await openAt("VermilionCity", 19, 22);
    setFlag(run, FLAG_BADGE02_GET);
    setThirdMove(run, 1, MOVE_CUT);
    expect(cellOf(harness, "VermilionCity", 19, 24)).toBe(".");
    const seen = harness.observe();
    if (seen.mode !== "overworld") throw new Error("the player is not on the overworld");
    expect(atlasExtract(seen).lines.join("\n")).not.toContain("CUT");
    const result = await harness.goTo(19, 25);
    expect(result).toEqual({ status: "done", frames: expect.any(Number) });
    expect(harness.observe()).toMatchObject({ player: { x: 19, y: 25 } });
    expect(obstacleEvents(harness)).toEqual([{ type: "obstacle", frame: expect.any(Number), move: "CUT", map: "VermilionCity", x: 19, y: 24, species: "SQUIRTLE" }]);
    harness.close();
  });

  test("with no badge, and with no Pokémon that knows the move, the tree stays a wall and the reason is given", async () => {
    const { harness, run } = await openAt("VermilionCity", 19, 22);
    const reasonWith = async () => {
      const result = await harness.goTo(19, 25);
      return "reason" in result ? result.reason : null;
    };
    expect(cellOf(harness, "VermilionCity", 19, 24)).toBe("#");
    expect(await reasonWith()).toContain("Only a Pokémon that knows CUT can remove it");
    setThirdMove(run, 0, MOVE_CUT);
    expect(cellOf(harness, "VermilionCity", 19, 24)).toBe("#");
    expect(await reasonWith()).toContain("badge 2");
    setFlag(run, FLAG_BADGE02_GET);
    expect(cellOf(harness, "VermilionCity", 19, 24)).toBe(".");
    setThirdMove(run, 0, 0);
    expect(cellOf(harness, "VermilionCity", 19, 24)).toBe("#");
    expect(await reasonWith()).toContain("Only a Pokémon that knows CUT can remove it");
    expect(harness.observe()).toMatchObject({ player: { x: 19, y: 22 } });
    harness.close();
  });

  test("after an exit from the map, the tree is back in the game and in the Atlas", async () => {
    const { harness, run } = await openAt("VermilionCity", 19, 22);
    setFlag(run, FLAG_BADGE02_GET);
    setThirdMove(run, 0, MOVE_CUT);
    must(await harness.goTo(19, 23));
    const pressed = await harness.press("A");
    expect(pressed).toEqual({ status: "done", frames: expect.any(Number) });
    expect(obstacleEvents(harness)).toHaveLength(1);
    setThirdMove(run, 0, 0);
    expect(cellOf(harness, "VermilionCity", 19, 24)).toBe(".");
    setThirdMove(run, 0, MOVE_CUT);
    must(await harness.goTo(14, 25));
    expect(harness.observe()).toMatchObject({ map: { name: "VermilionCity_Gym" } });
    setThirdMove(run, 0, 0);
    expect(cellOf(harness, "VermilionCity", 19, 24)).toBe("#");
    expect(mapNamed(harness.observe().atlas, "VermilionCity").obstacles).toEqual([expect.objectContaining({ x: 19, y: 24, name: "CUT TREE" })]);
    setThirdMove(run, 0, MOVE_CUT);
    must(await harness.goTo(19, 25, "VermilionCity"));
    expect(run.game.mapView("VermilionCity")?.actors.obstacles).toEqual([expect.objectContaining({ x: 19, y: 24, name: "CUT TREE" })]);
    harness.close();
  });

  test("ROCK SMASH removes the rock, and a battle interrupts the walk with battle", async () => {
    const { harness, run } = await openAt("RockTunnel_B1F", 2, 21);
    setFlag(run, FLAG_BADGE06_GET);
    setThirdMove(run, 0, MOVE_ROCK_SMASH);
    must(await harness.goTo(2, 22));
    expect(await harness.goTo(2, 23)).toMatchObject({ status: "interrupted", reason: "battle" });
    await harness.readText();
    expect(harness.observe().mode).toBe("battle");
    expect(obstacleEvents(harness)).toEqual([expect.objectContaining({ move: "ROCK SMASH", map: "RockTunnel_B1F", x: 2, y: 23, species: "SQUIRTLE" })]);
    harness.close();
  });
});

const FLAG_GOT_BICYCLE = 0x271;
const VARS_START = 0x4000;
const PLAYER_AVATAR_FLAG_SURFING = 1 << 3;
const TRAINER_FLAGS_START = 0x500;
const TRAINER_FLAGS_END = 0x800;
const VAR_MAP_SCENE_ROUTE16 = 0x405e;
const ITEM_BICYCLE = 360;

function giveBicycle(run: Run): void {
  const { mem } = run.game;
  const key = mem.global("gSaveBlock2Ptr").deref().field("encryptionKey").int() & 0xffff;
  const slot = mem.global("gBagPockets").at(KEY_ITEMS_POCKET).field("itemSlots").at(0);
  run.core.patch16(slot.field("itemId").addr, ITEM_BICYCLE);
  run.core.patch16(slot.field("quantity").addr, 1 ^ key);
  setFlag(run, FLAG_GOT_BICYCLE);
}

async function framesOfWalk(prepare: (run: Run, harness: Harness) => Promise<void> | void): Promise<number> {
  const { harness, run } = await openAt("Route1", 3, 30, false);
  await prepare(run, harness);
  const walk = await harness.goTo(20, 30);
  must(walk);
  harness.close();
  return walk.frames;
}

describe.skipIf(!existsSync(ROM_FILE) || !existsSync(PARTY_SAVE))("the speed of a walk", () => {
  test("a walk of 17 cells takes 16 frames for each cell, 8 with the Running Shoes and 6 on the BICYCLE", async () => {
    const walk = await framesOfWalk(() => {});
    const run = await framesOfWalk((game) => setFlag(game, FLAG_SYS_B_DASH));
    const ride = await framesOfWalk(async (game, harness) => {
      setFlag(game, FLAG_SYS_B_DASH);
      giveBicycle(game);
      must(await harness.use("BICYCLE"));
    });
    expect(walk).toBeGreaterThanOrEqual(17 * 16);
    expect(run).toBeLessThan(walk * 0.6);
    expect(ride).toBeLessThan(run * 0.8);
  });

  test("a trigger stops a run at its first frame, and B does not press through the text", async () => {
    const run = await Run.open({ startSave: START_SAVE });
    const harness = await Harness.open({}, run);
    setFlag(run, FLAG_SYS_B_DASH);
    must(await harness.goTo(12, 3, "PalletTown"));
    expect(await harness.goTo(12, 1)).toMatchObject({ status: "interrupted", reason: "trigger" });
    expect(await harness.readText()).toMatchObject({ status: "done", text: ["OAK: Hey! Wait! Don't go out!", expect.stringContaining("OAK: It's unsafe!")] });
    harness.close();
  });
});

function overworld(harness: Harness) {
  const seen = harness.observe();
  if (seen.mode !== "overworld") throw new Error(`the game waits for a ${seen.waitingFor.kind}`);
  return seen;
}

describe.skipIf(!existsSync(ROM_FILE) || !existsSync(PARTY_SAVE))("the BICYCLE", () => {
  test("use BICYCLE registers it one time, then a use takes 2 frames, and the Bag and a walk prompt offer it", async () => {
    const { harness, run } = await openAt("Route1", 3, 30, false);
    giveBicycle(run);
    expect(harness.availableActions()).toContainEqual({ name: "use", item: "BICYCLE" });
    const first = await harness.use("BICYCLE");
    expect(first).toMatchObject({ status: "done", text: [] });
    expect(first.frames).toBeGreaterThan(30);
    expect(overworld(harness)).toMatchObject({ riding: true, rideChosen: true });
    expect(await harness.use("BICYCLE")).toEqual({ status: "done", text: [], frames: 2 });
    expect(overworld(harness)).toMatchObject({ riding: false, rideChosen: false });
    expect(await harness.use("BICYCLE")).toEqual({ status: "done", text: [], frames: 2 });
    expect(overworld(harness)).toMatchObject({ riding: true, rideChosen: true });
    expect(await harness.use("BICYCLE", 0)).toMatchObject({ status: "impossible", reason: "BICYCLE does not work on a Pokémon" });
    harness.close();
  });

  test("the game takes the rider off at a door, and a walk outside gets on again with no new use", async () => {
    const { harness, run } = await openAt("Route1", 3, 30, false);
    giveBicycle(run);
    must(await harness.use("BICYCLE"));
    must(await harness.goTo(6, 8, "PalletTown"));
    expect(overworld(harness)).toMatchObject({ riding: true });
    must(await harness.goTo(6, 7));
    expect(overworld(harness)).toMatchObject({ map: { name: "PalletTown_PlayersHouse_1F" }, riding: false, rideChosen: true });
    must(await harness.goTo(12, 8, "PalletTown"));
    expect(overworld(harness)).toMatchObject({ map: { name: "PalletTown" }, riding: true, rideChosen: true });
    expect(harness.actions.filter(({ action }) => action.name === "use")).toHaveLength(1);
    harness.close();
  });

  test("a use in a building keeps the choice for the next outdoor map, and the party menu works on the BICYCLE", async () => {
    const { harness, run } = await openAt("Route1", 3, 30, false);
    giveBicycle(run);
    must(await harness.goTo(6, 8, "PalletTown"));
    must(await harness.goTo(6, 7));
    expect(await harness.use("BICYCLE")).toEqual({ status: "done", text: [], frames: 0 });
    expect(overworld(harness)).toMatchObject({ riding: false, rideChosen: true });
    must(await harness.goTo(12, 8, "PalletTown"));
    expect(overworld(harness)).toMatchObject({ riding: true });
    must(await harness.swap(0, 1));
    expect(overworld(harness)).toMatchObject({ riding: true });
    harness.close();
  });

  test("on water a use keeps the choice and presses no Select, because the game refuses the BICYCLE there", async () => {
    const { harness, run } = await openAt("Route1", 3, 30, false);
    giveBicycle(run);
    const flags = run.game.mem.global("gPlayerAvatar").field("flags");
    run.core.patch16(flags.addr, flags.int() | PLAYER_AVATAR_FLAG_SURFING);
    expect(run.game.canChangeBicycle()).toBe(false);
    expect(await harness.use("BICYCLE")).toEqual({ status: "done", text: [], frames: 0 });
    expect(overworld(harness)).toMatchObject({ riding: false, rideChosen: true });
    harness.close();
  });

  test("a use with no BICYCLE in the Bag does not change the choice", async () => {
    const { harness, run } = await openAt("Route1", 3, 30, false);
    expect(await harness.use("BICYCLE")).toMatchObject({ status: "impossible" });
    expect(overworld(harness)).toMatchObject({ rideChosen: false });
    expect(run.game.registeredItem()).toBe(0);
    harness.close();
  });

  test("a Continued Run keeps the choice of its parent", async () => {
    const onFrame = (run: Run, { map, patch }: { map: () => void; patch: () => void }) => {
      map();
      if (run.game.map().name === "Route1") patch();
    };
    const opened = async () => {
      const run = await Run.open({ startSave: PARTY_SAVE });
      const { onFrame: warp } = warpPatch(run, { map: "Route1", x: 3, y: 30 }, false);
      return { run, frame: () => onFrame(run, { map: warp, patch: () => giveBicycle(run) }) };
    };
    const first = await opened();
    const parent = await Harness.open({ onFrame: first.frame }, first.run);
    await parent.play({ name: "test", version: "1", play: async (harness) => {
      await harness.goTo(PALLET_DOOR.x, PALLET_DOOR.y);
      must(await harness.use("BICYCLE"));
      must(await harness.goTo(4, 30));
    } });
    const record = parent.record();
    parent.close();
    const second = await opened();
    const continued = await Harness.open({ onFrame: second.frame, parent: { name: "parent", record } }, second.run);
    expect(overworld(continued)).toMatchObject({ riding: true, rideChosen: true });
    continued.close();
  });
});

describe.skipIf(!existsSync(ROM_FILE) || !existsSync(PARTY_SAVE))("a trigger with a text", () => {
  test("the model bot makes a Model call after the text of a trigger, on the cell of the trigger: the walk does not continue", async () => {
    const { harness, run } = await openAt("PokemonTower_5F", 8, 9, false);
    for (let flag = TRAINER_FLAGS_START; flag < TRAINER_FLAGS_END; flag++) setFlag(run, flag);
    const before = harness.actions.length;
    const users: string[] = [];
    const client = firstAnswer(users, () => "goTo 13 9");
    await expect(harness.play(modelBot({ costLimit: 1 }, () => client))).rejects.toThrow("3 answers in a row that the Bot cannot read");
    const played = harness.actions.slice(before);
    expect(played.map(({ action, result }: ActionEntry) => [action.name, result.status])).toEqual([["goTo", "interrupted"], ["readText", "done"]]);
    expect(played[1].result).toMatchObject({ text: [expect.stringContaining("purified")] });
    expect(harness.observe()).toMatchObject({ player: { x: 10, y: 9 } });
    expect(users).toHaveLength(4);
    expect(users[1]).toContain("goTo(13, 9) ×1: interrupted (trigger)");
    harness.close();
  });
});

describe.skipIf(!existsSync(ROM_FILE) || !existsSync(PARTY_SAVE))("the Cycling Road", () => {
  async function openOnRoad(x: number, y: number): Promise<{ harness: Harness; run: Run; leave: () => void }> {
    const run = await Run.open({ startSave: PARTY_SAVE });
    const { onFrame } = warpPatch(run, { map: "Route16", x, y }, false);
    let onRoad = true;
    const vars = () => run.game.mem.global("gSaveBlock1Ptr").deref().field("vars");
    const harness = await Harness.open({ onFrame: () => {
      onFrame();
      if (onRoad) run.core.patch16(vars().at(VAR_MAP_SCENE_ROUTE16 - VARS_START).addr, 1);
    } }, run);
    await harness.goTo(PALLET_DOOR.x, PALLET_DOOR.y);
    giveBicycle(run);
    return { harness, run, leave: () => { onRoad = false; } };
  }

  test("a walk stops on the cell of a slope that it asked for, in the 4 directions, and the way south is the fastest", async () => {
    const { harness } = await openOnRoad(8, 19);
    must(await harness.goTo(8, 2, "Route17"));
    expect(overworld(harness)).toMatchObject({ map: { name: "Route17" }, player: { x: 8, y: 2 }, riding: true });
    const south = await harness.goTo(8, 8);
    must(south);
    expect(overworld(harness)).toMatchObject({ player: { x: 8, y: 8 }, waitingFor: { kind: "walk" } });
    const north = await harness.goTo(8, 2);
    must(north);
    expect(overworld(harness)).toMatchObject({ player: { x: 8, y: 2 } });
    must(await harness.goTo(12, 2));
    must(await harness.goTo(4, 2));
    expect(overworld(harness)).toMatchObject({ player: { x: 4, y: 2 } });
    expect(south.frames).toBeLessThan(north.frames / 2);
    harness.close();
  });

  test("a rider who stops on a slope faces south: an interaction reads the sign to the south, and a direction is a step", async () => {
    const { harness, run } = await openOnRoad(8, 19);
    for (let flag = TRAINER_FLAGS_START; flag < TRAINER_FLAGS_END; flag++) setFlag(run, flag);
    must(await harness.goTo(8, 4, "Route17"));
    expect(await harness.interact(8, 5)).toMatchObject({ status: "impossible", reason: "nothing at (8, 5) starts a script" });
    expect(overworld(harness)).toMatchObject({ player: { x: 8, y: 4, facing: "south" } });
    expect(await harness.interact(9, 4)).toMatchObject({ status: "impossible", reason: "the player walked to Route17 (9, 4) when it turned east" });
    expect(await harness.goTo(12, 52)).toMatchObject({ status: "interrupted", reason: "script" });
    expect(await harness.readText()).toMatchObject({ text: ["It's a notice. Watch out for discarded items."] });
    must(await harness.goTo(12, 52));
    must(await harness.interact(12, 53));
    expect(harness.waitingFor().kind).toBe("text");
    harness.close();
  });

  test("a trainer stops a ride, and the text and the battle go on as usual; the road refuses a change of the BICYCLE", async () => {
    const { harness, run } = await openOnRoad(8, 19);
    must(await harness.goTo(8, 30, "Route17"));
    expect(run.game.canChangeBicycle()).toBe(false);
    expect(await harness.use("BICYCLE")).toEqual({ status: "done", text: [], frames: 0 });
    expect(overworld(harness)).toMatchObject({ riding: true, rideChosen: true });
    // The trainer of this row turns left and right, so the player is in its sight only some of the time.
    let walk = await harness.goTo(12, 38);
    for (let tries = 0; walk.status === "done" && tries < 40; tries++) walk = await harness.goTo(tries % 2 === 0 ? 8 : 12, 38);
    expect(walk).toMatchObject({ status: "interrupted", reason: "trainer" });
    const talk = await harness.readText();
    expect(talk.text.length).toBeGreaterThan(0);
    expect(harness.waitingFor().kind).not.toBe("walk");
    harness.close();
  });

  test("a walk gets off in the gate when the Bot did not choose to ride, and the trigger of the gate stops the walk", async () => {
    const { harness, run, leave } = await openOnRoad(19, 13);
    expect(overworld(harness)).toMatchObject({ riding: true, rideChosen: false });
    leave();
    must(await harness.goTo(4, 12, "Route16_NorthEntrance_1F"));
    expect(run.game.canChangeBicycle()).toBe(true);
    expect(overworld(harness)).toMatchObject({ map: { name: "Route16_NorthEntrance_1F" }, riding: false });
    expect(await harness.goTo(11, 12)).toMatchObject({ status: "interrupted", reason: "trigger" });
    harness.close();
  });

  test("the model bot continues a walk that the trigger of the gate stopped with no text: the walk costs one Model call", async () => {
    const { harness, leave } = await openOnRoad(19, 13);
    leave();
    must(await harness.goTo(4, 12, "Route16_NorthEntrance_1F"));
    const before = harness.actions.length;
    const users: string[] = [];
    const client = firstAnswer(users, () => "goTo 11 12");
    await expect(harness.play(modelBot({ costLimit: 1 }, () => client))).rejects.toThrow("3 answers in a row that the Bot cannot read");
    const played = harness.actions.slice(before).map(({ action, result }: ActionEntry) => [action.name, result.status]);
    expect(played).toEqual([["goTo", "interrupted"], ["readText", "done"], ["goTo", "done"]]);
    expect(users).toHaveLength(4);
    expect(users[1]).toMatch(/^Map Route16\b/m);
    expect(users[1]).not.toContain("trigger");
    harness.close();
  });
});
