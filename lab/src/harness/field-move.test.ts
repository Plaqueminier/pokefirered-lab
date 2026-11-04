import { describe, expect, setDefaultTimeout, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { atlasExtract } from "../model/extract";
import { decryptMon } from "../party";
import { ROM_FILE, Run, SAVES_DIR } from "../run";
import { cellAt, mapNamed } from "./atlas";
import { Harness, must } from "./harness";

setDefaultTimeout(60_000);

const PARTY_SAVE = join(SAVES_DIR, "test-party.sav");
const FLAG_BADGE02_GET = 0x821;
const FLAG_BADGE06_GET = 0x825;
const MOVE_CUT = 15;
const MOVE_ROCK_SMASH = 249;
const PALLET_DOOR = { x: 6, y: 7 };
const THIRD_MOVE_OFFSET = 4;

async function openAt(map: string, x: number, y: number): Promise<{ harness: Harness; run: Run }> {
  const run = await Run.open({ startSave: PARTY_SAVE });
  const group = run.game.allMapNames.findIndex((names) => names.includes(map));
  const num = run.game.allMapNames[group].indexOf(map);
  const warp = run.game.mem.global("sWarpDestination");
  let warping = true;
  const harness = await Harness.open(
    {
      onFrame: () => {
        if (!warping) return;
        run.core.patch16(warp.addr, group | (num << 8));
        run.core.patch16(warp.field("warpId").addr, 0xff);
        run.core.patch16(warp.field("x").addr, x);
        run.core.patch16(warp.field("y").addr, y);
      },
    },
    run,
  );
  await harness.goTo(PALLET_DOOR.x, PALLET_DOOR.y);
  warping = false;
  expect(harness.observe()).toMatchObject({ map: { name: map }, player: { x, y } });
  return { harness, run };
}

function setFlag(run: Run, flag: number): void {
  const flags = run.game.mem.global("gSaveBlock1Ptr").deref().field("flags");
  const at = flags.addr + (flag >> 3);
  const even = at & ~1;
  const [low, high] = run.core.read(even, 2);
  run.core.patch16(even, (low | (high << 8)) | (1 << ((flag & 7) + (at === even ? 0 : 8))));
}

function setThirdMove(run: Run, slot: number, move: number): void {
  const box = run.game.mem.global("gPlayerParty").at(slot).field("box");
  const personality = box.field("personality").int();
  const otId = box.field("otId").int();
  const { substructs, attacks } = decryptMon(personality, otId, box.field("secure").bytes());
  const before = substructs.getUint16(attacks + THIRD_MOVE_OFFSET, true);
  run.core.patch16(box.field("secure").addr + attacks + THIRD_MOVE_OFFSET, move ^ ((personality ^ otId) & 0xffff));
  run.core.patch16(box.field("checksum").addr, (box.field("checksum").int() + move - before) & 0xffff);
}

function cellOf(harness: Harness, map: string, x: number, y: number): string {
  return cellAt(mapNamed(harness.observe().atlas, map), { x, y });
}

const obstacleEvents = (harness: Harness) => harness.events.filter((e) => e.type === "obstacle");

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
    expect(await harness.goTo(2, 23)).toMatchObject({ status: "interrupted", reason: "battle" });
    await harness.readText();
    expect(harness.observe().mode).toBe("battle");
    expect(obstacleEvents(harness)).toEqual([expect.objectContaining({ move: "ROCK SMASH", map: "RockTunnel_B1F", x: 2, y: 23, species: "SQUIRTLE" })]);
    harness.close();
  });
});
