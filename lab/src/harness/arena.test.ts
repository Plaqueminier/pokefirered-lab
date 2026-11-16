import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { ARENA_END_SCREEN, ARENA_END_SCREEN_SHOWN, controllerOf } from "../battle";
import type { Ref } from "../memory";
import type { PartyMon } from "../party";
import { decoder } from "../prompts";
import { Keys } from "../protocol";
import { ARENA_ROM_NAME, Run, romFile, SAVES_DIR } from "../run";
import { Harness } from "./harness";

setDefaultTimeout(120_000);

const TEST_BAG = join(SAVES_DIR, "test-bag.sav");
const LEARN_MOVE_SAVE = join(SAVES_DIR, "test-learn-move.sav");

const SPEED_1X = 0;
const SPEED_INSTANT = 4;
const ALL_SPEEDS = Array.from({ length: SPEED_INSTANT + 1 }, (_, speed) => speed);
const STRATEGY_RANDOM = 4;
const B_OUTCOME_WON = 1;
const B_OUTCOME_RAN = 4;
const MAX_BATTLE_FRAMES = 60_000;
const MENU_FADE_FRAMES = 90;
const HOLD_FRAMES = 10;
const B_HOLD_TEST_FRAMES = 60;
const BIG = 900;
const B_ACTION_USE_MOVE = 0;
const PLAYER_BATTLER = 0;
const CHARMAP = join(SAVES_DIR, "..", "..", "charmap.txt");
// include/constants/moves.h and include/constants/songs.h.
const MOVE_FIRE_BLAST = 126;
const SE_M_FLAME_WHEEL = 137;

type AutoSettings = {
  strategy?: number;
  speed?: number;
  autoStaysOn?: boolean;
  noStopLowHp?: boolean;
  noStopNeverSeen?: boolean;
  noStopMoveToLearn?: boolean;
  runIfCaught?: boolean;
};

const NO_STOPS: AutoSettings = { autoStaysOn: true, noStopLowHp: true, noStopNeverSeen: true, noStopMoveToLearn: true, speed: SPEED_INSTANT };

type ArenaRun = { harness: Harness; run: Run };

type BattleEnd = { outcome: number; turns: number; rng: number; party: number[] };

function turnOnAuto(run: Run, settings: AutoSettings): void {
  const { mem } = run.game;
  const saveBlock2 = mem.global("gSaveBlock2Ptr").deref();
  saveBlock2.field("optionsBattleScreenArena").write(run.core, 1);
  const fields = saveBlock2.field("arenaSettings");
  for (const [name, value] of Object.entries(settings)) fields.field(name).write(run.core, Number(value));
}

function setPokedex(run: Run, { seen, caught }: { seen: boolean; caught: boolean }): void {
  const { mem } = run.game;
  const dex = mem.global("gSaveBlock2Ptr").deref().field("pokedex");
  const saveBlock1 = mem.global("gSaveBlock1Ptr").deref();
  const fill = (ref: Ref, value: number) => {
    for (let at = 0; at < ref.size; at++) run.core.patch8(ref.addr + at, value);
  };
  fill(dex.field("seen"), seen ? 0xff : 0);
  fill(saveBlock1.field("seen1"), seen ? 0xff : 0);
  fill(saveBlock1.field("seen2"), seen ? 0xff : 0);
  fill(dex.field("owned"), caught ? 0xff : 0);
}

function addSecondPokemon(run: Run): void {
  const { mem } = run.game;
  const party = mem.global("gPlayerParty");
  const first = party.at(0).bytes();
  for (let at = 0; at < first.length; at += 2) run.core.patch16(party.at(1).addr + at, first[at] | (first[at + 1] << 8));
  run.core.patch8(mem.global("gPlayerPartyCount").addr, 2);
}

const openHarnesses = new Set<Harness>();

async function openArena(startSave = TEST_BAG): Promise<ArenaRun> {
  const run = await Run.open({ startSave, romName: ARENA_ROM_NAME });
  const harness = await Harness.open({}, run);
  openHarnesses.add(harness);
  return { harness, run };
}

function closeArena({ harness }: ArenaRun): void {
  harness.close();
  openHarnesses.delete(harness);
}

afterEach(() => {
  for (const harness of openHarnesses) harness.close();
  openHarnesses.clear();
});

const inBattle = (run: Run) => run.game.mem.global("gMain").field("inBattle").int() === 1;
const autoOn = (run: Run) => run.game.mem.global("gArenaBattle").field("autoOn").int() === 1;
const arenaSettings = (run: Run) => run.game.mem.global("gSaveBlock2Ptr").deref().field("arenaSettings");
const autoStaysOn = (run: Run) => arenaSettings(run).field("autoStaysOn").int() === 1;
const battleOutcome = (run: Run) => run.game.mem.global("gBattleOutcome").int();
const battleMon = (run: Run, battler: number) => run.game.mem.global("gBattleMons").at(battler);
const arenaAuto = (run: Run) => run.game.mem.global("sArenaAuto");

// The checks of CheckMoveLimitations in the engine that can happen in a wild battle of the test save.
function usableSlots(run: Run): number[] {
  const { mem } = run.game;
  const mon = battleMon(run, PLAYER_BATTLER);
  const disable = mem.global("gDisableStructs").at(PLAYER_BATTLER);
  const taunted = disable.field("tauntTimer").int() > 0;
  const encored = disable.field("encoredMove").int();
  return [0, 1, 2, 3].filter((slot) => {
    const move = mon.field("moves").at(slot).int();
    if (move === 0 || mon.field("pp").at(slot).int() === 0 || move === disable.field("disabledMove").int()) return false;
    if (taunted && mem.global("gBattleMoves").at(move).field("power").int() === 0) return false;
    return encored === 0 || encored === move;
  });
}

function playUntil(run: Run, done: () => boolean): number {
  for (let frame = 0; frame < MAX_BATTLE_FRAMES; frame++) {
    if (done()) return frame;
    run.runFrame(0);
  }
  throw new Error(`no end in ${MAX_BATTLE_FRAMES} frames`);
}

async function playAnswering({ harness, run }: ArenaRun, done: () => boolean): Promise<void> {
  for (let frame = 0; !done(); frame++) {
    if (frame === MAX_BATTLE_FRAMES) throw new Error(`no end in ${MAX_BATTLE_FRAMES} frames`);
    if (harness.waitingFor().kind === "text") await harness.readText();
    else run.runFrame(0);
  }
}

async function walkToBattle({ harness, run }: ArenaRun): Promise<void> {
  const observation = harness.observe();
  if (observation.mode !== "overworld") throw new Error("the test Starting save is not on the overworld");
  const { x, y } = observation.player;
  for (let step = 0; (await harness.goTo(x, step % 2 === 0 ? y - 1 : y)).status !== "interrupted"; step++) {
    if (step === 100) throw new Error("no wild battle in 100 steps");
  }
  playUntil(run, () => inBattle(run));
}

// At high speed, the game can miss a press of one frame, so hold the key as a person does.
function pressFor(run: Run, keys: number, frames: number): void {
  for (let i = 0; i < HOLD_FRAMES; i++) run.runFrame(keys);
  for (let i = 0; i < frames; i++) run.runFrame(0);
}

type Growth = { exp: number[]; level: number[]; stats: number[][] };

type EndScreen = { cards: Growth[]; money: number };

const STATS = ["maxHp", "attack", "defense", "speed", "spAttack", "spDefense"] as const;

const statsOf = (mon: PartyMon) => STATS.map((stat) => (stat === "maxHp" ? mon.maxHp : mon.stats[stat]));

function endScreen({ harness, run }: ArenaRun): EndScreen | null {
  const { mem } = run.game;
  const screen = mem.global(ARENA_END_SCREEN);
  if (screen.pointer() === 0 || screen.deref().field("state").int() !== ARENA_END_SCREEN_SHOWN) return null;
  const end = screen.deref();
  const party = harness.observe().party;
  const cards = Array.from({ length: end.field("count").int() }, (_, i) => {
    const card = end.field("cards").at(i);
    const mon = card.field("record").deref();
    const start = mon.field("statsStart");
    return {
      exp: [mon.field("expStart").int(), card.field("expEnd").int()],
      level: [mon.field("levelStart").int(), card.field("levelEnd").int()],
      stats: [STATS.map((_, stat) => start.at(stat).int()), statsOf(party[card.field("partyIndex").int()])],
    };
  });
  return { cards, money: end.field("money").int() };
}

function battleEnd(run: Run): BattleEnd {
  const { mem } = run.game;
  return {
    outcome: battleOutcome(run),
    turns: mem.global("gBattleResults").field("battleTurnCounter").int(),
    rng: mem.global("gRngValue").int(),
    party: Array.from(mem.global("gPlayerParty").bytes()),
  };
}

async function autoBattle(settings: AutoSettings): Promise<{ frames: number; end: BattleEnd }> {
  const arena = await openArena();
  turnOnAuto(arena.run, settings);
  await walkToBattle(arena);
  const frames = playUntil(arena.run, () => !inBattle(arena.run));
  const end = battleEnd(arena.run);
  closeArena(arena);
  return { frames, end };
}

describe.skipIf(!existsSync(romFile(ARENA_ROM_NAME)) || !existsSync(TEST_BAG))("the Arena build in Auto mode", () => {
  test("a wild battle in Auto mode ends with no input of the player, and the game is back on the overworld", async () => {
    const arena = await openArena();
    turnOnAuto(arena.run, NO_STOPS);
    await walkToBattle(arena);
    playUntil(arena.run, () => !inBattle(arena.run));
    expect(battleOutcome(arena.run)).toBe(B_OUTCOME_WON);
    playUntil(arena.run, () => arena.harness.waitingFor().kind === "walk");
  });

  test("each move that Auto mode chooses has PP and is not blocked", async () => {
    const arena = await openArena();
    const { run } = arena;
    turnOnAuto(run, { ...NO_STOPS, speed: SPEED_1X, strategy: STRATEGY_RANDOM });
    await walkToBattle(arena);
    const plan = arenaAuto(run).field("plan");
    const turn = run.game.mem.global("gBattleResults").field("battleTurnCounter");
    const choices = new Map<number, { slot: number; usable: number[] }>();
    playUntil(run, () => {
      if (controllerOf(run.game.mem, PLAYER_BATTLER) === "EmitPlan" && plan.field("action").int() === B_ACTION_USE_MOVE) {
        choices.set(turn.int(), { slot: plan.field("moveIndex").int(), usable: usableSlots(run) });
      }
      return !inBattle(run);
    });
    expect(choices.size).toBeGreaterThan(0);
    for (const { slot, usable } of choices.values()) expect(usable).toContain(slot);
  });

  test("the first sound of each move script is a song, a cry or no sound, and FIRE BLAST plays the first sound of its createsoundtask", async () => {
    const arena = await openArena();
    const check = arena.run.game.mem.global("sSoundCheck");
    turnOnAuto(arena.run, NO_STOPS);
    check.field("probeMove").write(arena.run.core, MOVE_FIRE_BLAST);
    await walkToBattle(arena);
    expect({ badMove: check.field("badMove").int(), probeSound: check.field("probeSound").int() }).toEqual({ badMove: 0, probeSound: SE_M_FLAME_WHEEL });
  });

  test("Auto mode starts again by itself at the next battle; after the player holds B, it stays off at the next battles", async () => {
    const arena = await openArena();
    const { run, harness } = arena;
    turnOnAuto(run, NO_STOPS);
    const first = run.game.mem.global("gPlayerParty").at(0);
    for (let battle = 0; battle < 2; battle++) {
      run.core.patch16(first.field("hp").addr, first.field("maxHP").int());
      await walkToBattle(arena);
      playUntil(run, () => !inBattle(run));
      expect(battleOutcome(run)).toBe(B_OUTCOME_WON);
      playUntil(run, () => harness.waitingFor().kind === "walk");
    }
    arenaSettings(run).field("speed").write(run.core, SPEED_1X);
    await walkToBattle(arena);
    playUntil(run, () => autoOn(run));
    for (let frame = 0; frame < B_HOLD_TEST_FRAMES; frame++) run.runFrame(Keys.B);
    await playAnswering(arena, () => !inBattle(run) || harness.waitingFor().kind === "battleAction");
    expect({ autoOn: autoOn(run), autoStaysOn: autoStaysOn(run) }).toEqual({ autoOn: false, autoStaysOn: false });
  });

  test("after an Arena battle, the Arena is off on the overworld and the RNG of the game moves at each frame again", async () => {
    const arena = await openArena();
    turnOnAuto(arena.run, NO_STOPS);
    await walkToBattle(arena);
    playUntil(arena.run, () => !inBattle(arena.run));
    playUntil(arena.run, () => arena.harness.waitingFor().kind === "walk");
    const { mem } = arena.run.game;
    expect(mem.global("gArenaBattle").field("active").int()).toBe(0);
    const rng = mem.global("gRngValue").int();
    arena.run.runFrame(0);
    expect(mem.global("gRngValue").int()).not.toBe(rng);
  });

  test("the speed changes only the time of a battle: at each speed, the party, the turns and the RNG are the same at the end", async () => {
    const slow = await autoBattle({ ...NO_STOPS, speed: SPEED_1X });
    expect(slow.end.outcome).toBe(B_OUTCOME_WON);
    for (const speed of ALL_SPEEDS.slice(1)) {
      const fast = await autoBattle({ ...NO_STOPS, speed });
      expect({ speed, end: fast.end }).toEqual({ speed, end: slow.end });
      expect(fast.frames).toBeLessThan(slow.frames);
    }
  });

  test("the same strategy from the same seed plays the same battle, also with the Random strategy", async () => {
    const first = await autoBattle({ ...NO_STOPS, strategy: STRATEGY_RANDOM });
    const second = await autoBattle({ ...NO_STOPS, strategy: STRATEGY_RANDOM });
    expect(second.end).toEqual(first.end);
  });

  test("each hit of Auto mode on the foe falls in the damage estimate of its move, or in twice the estimate for a critical hit", async () => {
    const arena = await openArena();
    turnOnAuto(arena.run, NO_STOPS);
    await walkToBattle(arena);
    const { mem } = arena.run.game;
    const foeHp = () => battleMon(arena.run, 1).field("hp").int();
    const hits: { damage: number; min: number; max: number; crit: boolean }[] = [];
    let before = foeHp();
    playUntil(arena.run, () => {
      const now = foeHp();
      if (now < before && now > 0) {
        const auto = arenaAuto(arena.run);
        const estimate = auto.field("estimates").at(auto.field("plan").field("moveIndex").int());
        hits.push({ damage: before - now, min: estimate.field("min").int(), max: estimate.field("max").int(), crit: mem.global("gCritMultiplier").int() === 2 });
      }
      before = now;
      return !inBattle(arena.run);
    });
    expect(hits.length).toBeGreaterThan(0);
    for (const hit of hits) {
      const factor = hit.crit ? 2 : 1;
      expect(hit.damage).toBeGreaterThanOrEqual(hit.min * factor - (hit.crit ? 1 : 0));
      expect(hit.damage).toBeLessThanOrEqual(hit.max * factor);
      // The damage roll of the engine is 85% to 100%.
      expect(hit.max - hit.min).toBeLessThanOrEqual(Math.ceil(hit.max * 0.15));
    }
  });

  test("Auto mode stops once when the HP bar of the Pokémon turns red; the AUTO button then START AUTO starts it again, and the same Pokémon does not stop it again", async () => {
    const arena = await openArena();
    const { run, harness } = arena;
    turnOnAuto(run, { ...NO_STOPS, noStopLowHp: false });
    run.core.patch16(run.game.mem.global("gPlayerParty").at(0).field("hp").addr, 2);
    await walkToBattle(arena);
    playUntil(run, () => harness.waitingFor().kind === "battleAction");
    expect(autoOn(run)).toBe(false);
    const overlay = run.game.mem.global("gArenaScreen").field("overlay");
    const decode = decoder(await Bun.file(CHARMAP).text());
    expect({ notice: decode(overlay.field("notice").bytes()), shown: overlay.field("noticeFrames").int() > 0 }).toEqual({ notice: "AUTO OFF: LOW HP!", shown: true });
    playUntil(run, () => run.game.mem.global("gPaletteFade").field("active").int() === 0);
    pressFor(run, Keys.Up, HOLD_FRAMES);
    pressFor(run, Keys.A, MENU_FADE_FRAMES);
    pressFor(run, Keys.A, MENU_FADE_FRAMES);
    expect(autoOn(run)).toBe(true);
    playUntil(run, () => !inBattle(run) || harness.waitingFor().kind === "battleAction");
    expect(inBattle(run)).toBe(false);
  });

  test("in a wild battle, Auto mode sends the next Pokémon when the first one faints, and does not run", async () => {
    const arena = await openArena();
    const { run } = arena;
    turnOnAuto(run, NO_STOPS);
    addSecondPokemon(run);
    run.core.patch16(run.game.mem.global("gPlayerParty").at(0).field("hp").addr, 1);
    await walkToBattle(arena);
    for (const stat of ["speed", "defense", "spDefense"]) run.core.patch16(battleMon(run, 1).field(stat).addr, BIG);
    const partyIndexOut = () => run.game.mem.global("gBattlerPartyIndexes").at(0).int();
    playUntil(run, () => !inBattle(run) || partyIndexOut() === 1);
    expect(inBattle(run)).toBe(true);
    for (const stat of ["defense", "spDefense"]) run.core.patch16(battleMon(run, 1).field(stat).addr, 1);
    playUntil(run, () => !inBattle(run));
    expect(battleOutcome(run)).toBe(B_OUTCOME_WON);
  });

  test("Auto mode stops at the start of a battle against a species never seen, and plays on against a species already seen", async () => {
    for (const seen of [false, true]) {
      const arena = await openArena();
      turnOnAuto(arena.run, { ...NO_STOPS, noStopNeverSeen: false });
      setPokedex(arena.run, { seen, caught: false });
      await walkToBattle(arena);
      await playAnswering(arena, () => !inBattle(arena.run) || arena.harness.waitingFor().kind === "battleAction");
      expect({ seen, stopped: inBattle(arena.run) }).toEqual({ seen, stopped: !seen });
      if (!seen) expect({ autoOn: autoOn(arena.run), autoStaysOn: autoStaysOn(arena.run) }).toEqual({ autoOn: false, autoStaysOn: true });
    }
  });

  test("with the run rule, Auto mode runs from a wild battle against a species already caught", async () => {
    const arena = await openArena();
    turnOnAuto(arena.run, { ...NO_STOPS, runIfCaught: true });
    setPokedex(arena.run, { seen: true, caught: true });
    await walkToBattle(arena);
    playUntil(arena.run, () => !inBattle(arena.run));
    expect(battleOutcome(arena.run)).toBe(B_OUTCOME_RAN);
  });
});

describe.skipIf(!existsSync(romFile(ARENA_ROM_NAME)) || !existsSync(LEARN_MOVE_SAVE))("the Arena build in Auto mode, before a level-up with 4 moves", () => {
  const FOUR_MOVES = ["TACKLE", "TAIL WHIP", "WITHDRAW", "WATER GUN"];
  const movesOf = (harness: Harness) => harness.observe().party[0].moves.map((move) => move.name);

  test("the end screen shows the EXP, the level and the stats of the Pokémon before and after the battle, and the prize money, as the game has them", async () => {
    const arena = await openArena(LEARN_MOVE_SAVE);
    const { harness, run } = arena;
    turnOnAuto(run, NO_STOPS);
    const before = { party: harness.observe().party, money: run.game.money() };
    await walkToBattle(arena);
    playUntil(run, () => endScreen(arena) !== null || !inBattle(run));
    const shown = endScreen(arena);
    playUntil(run, () => !inBattle(run));
    playUntil(run, () => harness.waitingFor().kind === "walk");
    const after = { party: harness.observe().party, money: run.game.money() };
    expect(after.party[0].level).toBeGreaterThan(before.party[0].level);
    expect(shown).toEqual({
      cards: before.party.map((mon, i) => ({ exp: [mon.exp, after.party[i].exp], level: [mon.level, after.party[i].level], stats: [statsOf(mon), statsOf(after.party[i])] })),
      money: after.money - before.money,
    });
  });

  test("with no stop for a move to learn, Auto mode answers NO and SQUIRTLE keeps its 4 moves", async () => {
    const arena = await openArena(LEARN_MOVE_SAVE);
    turnOnAuto(arena.run, NO_STOPS);
    await walkToBattle(arena);
    playUntil(arena.run, () => !inBattle(arena.run));
    playUntil(arena.run, () => arena.harness.waitingFor().kind === "walk");
    expect(arena.harness.observe().party[0].level).toBe(7);
    expect(movesOf(arena.harness)).toEqual(FOUR_MOVES);
  });

  test("with the stop for a move to learn, the game waits for the player, and Auto mode plays on after the answer", async () => {
    const arena = await openArena(LEARN_MOVE_SAVE);
    turnOnAuto(arena.run, { ...NO_STOPS, noStopMoveToLearn: false });
    await walkToBattle(arena);
    playUntil(arena.run, () => arena.harness.waitingFor().kind === "learnMove");
    expect(autoOn(arena.run)).toBe(true);
    await arena.harness.forget("TAIL WHIP");
    playUntil(arena.run, () => !inBattle(arena.run) || arena.harness.waitingFor().kind === "battleAction");
    expect(inBattle(arena.run)).toBe(false);
    playUntil(arena.run, () => arena.harness.waitingFor().kind === "walk");
    expect(movesOf(arena.harness)).toEqual(["TACKLE", "BUBBLE", "WITHDRAW", "WATER GUN"]);
  });
});
