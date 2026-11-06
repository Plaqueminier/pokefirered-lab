import { describe, expect, setDefaultTimeout, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { modelBot } from "../../bots/model";
import { atlasExtract } from "../model/extract";
import type { ModelClient } from "../model/openrouter";
import { decryptBox } from "../party";
import { ROM_FILE, Run, SAVES_DIR } from "../run";
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
    const client: ModelClient = async ({ user }) => {
      users.push(user);
      const action = users.length === 1 ? "go " + letter(user) : "I do not know";
      return { content: JSON.stringify({ reason: "r", action, mission: "m", objective: "o", note: "" }), usage: { promptTokens: 1, cachedTokens: 0, completionTokens: 1, reasoningTokens: 0, cost: 0 } };
    };
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
