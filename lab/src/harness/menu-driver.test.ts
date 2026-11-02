import { describe, expect, test } from "bun:test";
import type { Game } from "../game";
import { Keys } from "../protocol";
import { MenuDriver } from "./menu-driver";

const MOVE = { name: "VINE WHIP", pp: 5 };

function battle({ skipped = [] as number[], encoredSlot = null as number | null } = {}) {
  let frame = 0;
  let kind = "battleAction";
  const cursors: Record<string, number> = { battleAction: 0, battleMove: 0 };
  let read = { held: 0, pressed: 0 };
  let after: { frames: number; kind: string } | null = null;
  const played: string[] = [];
  const onPressed = (keys: number) => {
    if (kind === "busy") return;
    if (keys & Keys.Right) cursors[kind] += 1;
    if (keys & Keys.Left) cursors[kind] -= 1;
    if (keys & Keys.Down) cursors[kind] += 2;
    if (keys & Keys.Up) cursors[kind] -= 2;
    if (!(keys & Keys.A)) return;
    played.push(`${kind} ${cursors[kind]}`);
    const opensMenu = kind === "battleAction" && cursors[kind] === 0 && encoredSlot === null;
    after = { frames: 3, kind: opensMenu ? "battleMove" : "battleAction" };
    kind = "busy";
  };
  const game = {
    requireBattle: () => ({ player: { moves: [MOVE, MOVE, MOVE, MOVE], encoredSlot } }),
    waitingFor: () => ({ kind }),
    battleCursor: (menu: string) => cursors[menu],
    keysRead: () => read,
    messages: () => ({ onScreen: [], printing: [], boxClosed: false }),
    whitingOut: () => false,
    wordScreen: () => null,
  };
  const input = {
    advance(keys: number): boolean {
      frame++;
      if (!skipped.includes(frame)) {
        read = { held: keys, pressed: keys & ~read.held };
        if (read.pressed) onPressed(read.pressed);
      }
      if (after && --after.frames === 0) {
        kind = after.kind;
        after = null;
      }
      return false;
    },
  };
  return { driver: new MenuDriver(game as unknown as Game, input), played };
}

describe("the battle menus", () => {
  test("a press on a frame where the game skips the keys is not lost: the move menu opens and the move plays", () => {
    const { driver, played } = battle({ skipped: [1] });
    expect(driver.fight(2)).toMatchObject({ status: "done" });
    expect(played).toEqual(["battleAction 0", "battleMove 2"]);
  });

  test("a cursor press on a frame where the game skips the keys is not lost", () => {
    const { driver, played } = battle({ skipped: [1] });
    expect(driver.run()).toMatchObject({ status: "done" });
    expect(played).toEqual(["battleAction 3"]);
  });

  test("under an ENCORE, FIGHT plays the move at once: the action is done, and it opens no move menu", () => {
    const { driver, played } = battle({ encoredSlot: 3 });
    expect(driver.fight(3)).toMatchObject({ status: "done" });
    expect(played).toEqual(["battleAction 0"]);
  });

  test("under an ENCORE, another move is impossible, with the move that FIGHT plays", () => {
    const { driver, played } = battle({ encoredSlot: 3 });
    expect(driver.fight(1)).toMatchObject({ status: "impossible", reason: "the ENCORE allows only fight 3" });
    expect(played).toEqual([]);
  });

  test("a press of a Raw input on a frame where the game skips the keys is not lost", () => {
    const { driver, played } = battle({ skipped: [1] });
    expect(driver.input(Keys.A)).toMatchObject({ status: "done" });
    expect(played).toEqual(["battleAction 0"]);
  });
});
