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
    battleTargetCursor: () => null,
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

  test("a fight on a foe is impossible with one foe to choose: the game plays nothing", () => {
    const { driver, played } = battle();
    expect(driver.fight(0, 2)).toMatchObject({ status: "impossible", reason: "there is only one foe to choose: write the fight with no foe" });
    expect(played).toEqual([]);
  });

  test("a press of a Raw input on a frame where the game skips the keys is not lost", () => {
    const { driver, played } = battle({ skipped: [1] });
    expect(driver.input(Keys.A)).toMatchObject({ status: "done" });
    expect(played).toEqual(["battleAction 0"]);
  });
});

type FakeMon = { nickname: string; hp: number; isEgg?: boolean };
type FakeBoxMon = { box: number; position: number; nickname: string };
type Screen = "menu" | "main" | "monMenu" | "monRefusal" | "boxChoice" | "closeQuestion" | "busy" | "left";

const BOX_COLUMNS = 6;
const BOX_SIZE = 30;
const ALL_BOXES = 14;
const TITLE = -1;

function pokemonPc({ party, boxes = [], currentBox = 0, refusesStore = false }: { party: FakeMon[]; boxes?: FakeBoxMon[]; currentBox?: number; refusesStore?: boolean }) {
  let screen: Screen = "menu";
  let option = 0;
  let mode: "withdraw" | "deposit" = "withdraw";
  let cursor = 0;
  let box = currentBox;
  let chosenBox = 0;
  let read = { held: 0, pressed: 0 };
  let after: { frames: number; screen: Screen } | null = null;
  const log: string[] = [];
  const busyUntil = (next: Screen) => {
    after = { frames: 2, screen: next };
    screen = "busy";
  };
  const screens: Record<Screen, { key?: (key: number) => void; kind?: string; shown?: () => object }> = {
    busy: {},
    left: { kind: "choice" },
    menu: {
      kind: "pokemonPc",
      key(key) {
        if (key & Keys.B) return busyUntil("left");
        if (key & Keys.Down) option++;
        if (key & Keys.Up) option--;
        if (!(key & Keys.A)) return;
        mode = option === 0 ? "withdraw" : "deposit";
        cursor = 0;
        chosenBox = 0;
        busyUntil("main");
      },
    },
    main: {
      shown: () => ({ screen: "main", area: cursor === TITLE ? "title" : mode === "deposit" ? "party" : "box", position: cursor, box }),
      key(key) {
        if (key & Keys.B) return busyUntil("closeQuestion");
        if (key & Keys.A) return busyUntil("monMenu");
        if (mode === "deposit") {
          if (key & Keys.Down) cursor++;
          if (key & Keys.Up) cursor--;
          return;
        }
        if (cursor === TITLE) {
          if (key & Keys.Right) box++;
          if (key & Keys.Left) box--;
          if (key & Keys.Down) cursor = 2;
          return;
        }
        if (key & Keys.Up) cursor = cursor < BOX_COLUMNS ? TITLE : cursor - BOX_COLUMNS;
        if (key & Keys.Down) cursor += BOX_COLUMNS;
        if (key & Keys.Right) cursor++;
        if (key & Keys.Left) cursor--;
      },
    },
    monMenu: {
      shown: () => ({ screen: "monMenu" }),
      key(key) {
        if (!(key & Keys.A)) return;
        if (mode === "deposit") return busyUntil(refusesStore ? "monRefusal" : "boxChoice");
        const taken = boxes.findIndex((mon) => mon.box === box && mon.position === cursor);
        party.push({ nickname: boxes.splice(taken, 1)[0].nickname, hp: 10 });
        log.push(`withdraw box ${box} place ${cursor}`);
        busyUntil("main");
      },
    },
    monRefusal: {
      shown: () => ({ screen: "monRefusal" }),
      key(key) {
        if (key & Keys.B) busyUntil("main");
      },
    },
    boxChoice: {
      shown: () => ({ screen: "boxChoice", box: chosenBox }),
      key(key) {
        if (key & Keys.Right) chosenBox++;
        if (key & Keys.Left) chosenBox--;
        if (!(key & Keys.A)) return;
        const position = boxes.filter((mon) => mon.box === chosenBox).length;
        boxes.push({ box: chosenBox, position, nickname: party.splice(cursor, 1)[0].nickname });
        log.push(`deposit slot ${cursor} in box ${chosenBox}`);
        cursor = 0;
        busyUntil("main");
      },
    },
    closeQuestion: {
      shown: () => ({ screen: "closeQuestion" }),
      key(key) {
        if (key & Keys.B) busyUntil("menu");
      },
    },
  };
  const game = {
    party: () => party,
    boxMons: () => boxes,
    currentBox: () => box,
    waitingFor: () => ({ kind: screens[screen].kind ?? "busy" }),
    pokemonPcCursor: () => (screen === "menu" ? option : null),
    storageScreen: () => screens[screen].shown?.() ?? null,
    keysRead: () => read,
    messages: () => ({ onScreen: [], printing: [], boxClosed: false }),
    whitingOut: () => false,
    wordScreen: () => null,
  };
  const input = {
    advance(key: number): boolean {
      read = { held: key, pressed: key & ~read.held };
      if (read.pressed) screens[screen].key?.(read.pressed);
      if (after && --after.frames === 0) {
        screen = after.screen;
        after = null;
      }
      return false;
    },
  };
  return { driver: new MenuDriver(game as unknown as Game, input), party, boxes, log, atMenu: () => screen === "menu", currentBox: () => box, waiting: () => game.waitingFor().kind };
}

const mons = (count: number): FakeMon[] => Array.from({ length: count }, (_, i) => ({ nickname: `MON${i}`, hp: 10 }));

const fullBox = (box: number): FakeBoxMon[] => Array.from({ length: BOX_SIZE }, (_, position) => ({ box, position, nickname: "FULL" }));

describe("the Pokémon PC", () => {
  test("a deposit moves the Pokémon of the slot to the current box, and comes back to the menu", () => {
    const pc = pokemonPc({ party: mons(3) });
    expect(pc.driver.depositPokemon(2)).toEqual({ status: "done" });
    expect(pc.log).toEqual(["deposit slot 2 in box 0"]);
    expect(pc.party.map((mon) => mon.nickname)).toEqual(["MON0", "MON1"]);
    expect(pc.atMenu()).toBe(true);
  });

  test("a deposit goes to the next box with a free place when the current box is full", () => {
    const pc = pokemonPc({ party: mons(2), boxes: fullBox(1), currentBox: 1 });
    expect(pc.driver.depositPokemon(0)).toEqual({ status: "done" });
    expect(pc.log).toEqual(["deposit slot 0 in box 2"]);
  });

  test("a withdraw in the current box moves the cursor to its place, and the Pokémon goes to the party", () => {
    const pc = pokemonPc({ party: mons(1), boxes: [{ box: 0, position: 14, nickname: "BOXED" }] });
    expect(pc.driver.withdrawPokemon(0, 14)).toEqual({ status: "done" });
    expect(pc.log).toEqual(["withdraw box 0 place 14"]);
    expect(pc.party.map((mon) => mon.nickname)).toEqual(["MON0", "BOXED"]);
    expect(pc.atMenu()).toBe(true);
  });

  test("a withdraw in another box scrolls to this box first", () => {
    const pc = pokemonPc({ party: mons(1), boxes: [{ box: 3, position: 1, nickname: "BOXED" }] });
    expect(pc.driver.withdrawPokemon(3, 1)).toEqual({ status: "done" });
    expect(pc.log).toEqual(["withdraw box 3 place 1"]);
    expect(pc.currentBox()).toBe(3);
  });

  const refused = (pc: ReturnType<typeof pokemonPc>, reason: string, act: () => unknown) => {
    expect(act()).toEqual({ status: "impossible", reason });
    expect(pc.log).toEqual([]);
    expect(pc.atMenu()).toBe(true);
  };

  test("a withdraw with 6 Pokémon in the party is refused, before the boxes open", () => {
    const pc = pokemonPc({ party: mons(6), boxes: [{ box: 0, position: 0, nickname: "BOXED" }] });
    refused(pc, "your party has 6 Pokémon: deposit one first", () => pc.driver.withdrawPokemon(0, 0));
  });

  test("a withdraw of an empty place is refused", () => {
    const pc = pokemonPc({ party: mons(1) });
    refused(pc, "there is no Pokémon at this place of the boxes", () => pc.driver.withdrawPokemon(0, 0));
  });

  test("a deposit with 1 Pokémon in the party is refused", () => {
    const pc = pokemonPc({ party: mons(1) });
    refused(pc, "your party has only 1 Pokémon: a Pokémon must stay with you", () => pc.driver.depositPokemon(0));
  });

  test("a deposit of the last Pokémon that can fight is refused: a fainted Pokémon and an Egg do not fight", () => {
    const fainted = pokemonPc({ party: [{ nickname: "LAST", hp: 10 }, { nickname: "FAINTED", hp: 0 }] });
    refused(fainted, "LAST is the last Pokémon of your party that can fight", () => fainted.driver.depositPokemon(0));
    const egg = pokemonPc({ party: [{ nickname: "EGG", hp: 10, isEgg: true }, { nickname: "LAST", hp: 10 }] });
    refused(egg, "LAST is the last Pokémon of your party that can fight", () => egg.driver.depositPokemon(1));
  });

  test("a deposit of a slot with no Pokémon is refused", () => {
    const pc = pokemonPc({ party: mons(2) });
    refused(pc, "the party has no Pokémon 4", () => pc.driver.depositPokemon(4));
  });

  test("a deposit when all the boxes are full is refused", () => {
    const pc = pokemonPc({ party: mons(2), boxes: Array.from({ length: ALL_BOXES }, (_, box) => fullBox(box)).flat() });
    refused(pc, "all the boxes are full", () => pc.driver.depositPokemon(0));
  });

  test("when the game refuses a deposit on its screen, the action is impossible and the boxes close", () => {
    const pc = pokemonPc({ party: mons(2), refusesStore: true });
    refused(pc, "the game refuses this deposit", () => pc.driver.depositPokemon(0));
  });

  test("leave goes back to the menu of the PC", () => {
    const pc = pokemonPc({ party: mons(2) });
    expect(pc.driver.leave()).toEqual({ status: "done", text: [] });
    expect(pc.waiting()).toBe("choice");
  });
});
