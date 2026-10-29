import { useState } from "preact/hooks";
import type { PartyMon, PartyMove } from "../src/party";
import type { RunSummary, ShownRun } from "../src/protocol";
import { Button, PopoverBody, Tabs } from "./components";
import { PokemonCard, PokemonSummary } from "./pokemon";
import { BotsPanel, RunSelect } from "./runs";

export const RECORD = "model-10-2026-10-27T09-38-59.686Z.json";

function move(name: string, type: string, power: number | null, accuracy: number | null, pp: number, maxPp: number, description: string): PartyMove {
  return { name, type, effect: 0, power, accuracy, pp, maxPp, description };
}

const TACKLE = move("TACKLE", "NORMAL", 35, 95, 35, 35, "A physical attack in which the user charges, full body, into the foe.");
const STRING_SHOT = move("STRING SHOT", "BUG", null, 95, 40, 40, "The foe is bound with strings shot from the mouth to reduce its SPEED.");

type MonData = Omit<PartyMon, "nickname" | "heldItem" | "status"> & Partial<Pick<PartyMon, "nickname" | "heldItem" | "status">>;

function mon(data: MonData): PartyMon {
  return { nickname: data.species, heldItem: null, status: "none", ...data };
}

const IVYSAUR = mon({
  species: "IVYSAUR",
  types: ["GRASS", "POISON"],
  ability: { name: "OVERGROW", description: "Ups GRASS moves in a pinch." },
  nature: "JOLLY",
  level: 18,
  exp: 3929,
  levelExp: 3798,
  expToNextLevel: 646,
  hp: 53,
  maxHp: 53,
  stats: { attack: 32, defense: 29, speed: 33, spAttack: 33, spDefense: 38 },
  moves: [
    move("POISONPOWDER", "POISON", null, 75, 33, 35, "A cloud of toxic dust is scattered. It may poison the foe."),
    move("SLEEP POWDER", "GRASS", null, 75, 1, 15, "A sleep-inducing dust is scattered in high volume around a foe."),
    move("LEECH SEED", "GRASS", null, 90, 6, 10, "A seed is planted on the foe to steal some HP for the user on every turn."),
    move("VINE WHIP", "GRASS", 35, 100, 0, 10, "The foe is struck with slender, whip-like vines."),
  ],
});

const PARTY: { state: string; mon: PartyMon }[] = [
  { state: "full HP, 4 moves, a move with 0 PP", mon: IVYSAUR },
  {
    state: "a nickname, sleep, 3 moves",
    mon: mon({
      nickname: "SHELLY",
      species: "SQUIRTLE",
      types: ["WATER"],
      ability: { name: "TORRENT", description: "Ups WATER moves in a pinch." },
      heldItem: "ORAN BERRY",
      nature: "MODEST",
      status: "sleep",
      level: 7,
      exp: 260,
      levelExp: 236,
      expToNextLevel: 54,
      hp: 18,
      maxHp: 24,
      stats: { attack: 11, defense: 14, speed: 10, spAttack: 11, spDefense: 13 },
      moves: [
        { ...TACKLE, pp: 30 },
        move("TAIL WHIP", "NORMAL", null, 100, 28, 30, "The user wags its tail cutely, making the foe lower its DEFENSE stat."),
        move("BUBBLE", "WATER", 20, 100, 25, 30, "A spray of countless bubbles is jetted at the foe. It may lower the foe's SPEED stat."),
      ],
    }),
  },
  {
    state: "half HP, freeze, 3 moves",
    mon: mon({
      species: "PIKACHU",
      types: ["ELECTR"],
      ability: { name: "STATIC", description: "Paralyzes on contact." },
      nature: "HASTY",
      status: "freeze",
      level: 9,
      exp: 850,
      levelExp: 729,
      expToNextLevel: 150,
      hp: 12,
      maxHp: 25,
      stats: { attack: 14, defense: 10, speed: 20, spAttack: 13, spDefense: 13 },
      moves: [
        move("THUNDERSHOCK", "ELECTR", 40, 100, 21, 30, "An electric shock attack that may also leave the foe paralyzed."),
        move("GROWL", "NORMAL", null, 100, 40, 40, "The user growls in a cute way, making the foe lower its ATTACK stat."),
        move("THUNDER WAVE", "ELECTR", null, 100, 18, 20, "A weak jolt of electricity that paralyzes the foe."),
      ],
    }),
  },
  {
    state: "low HP, poison, 2 moves",
    mon: mon({
      species: "WEEDLE",
      types: ["BUG", "POISON"],
      ability: { name: "SHIELD DUST", description: "Prevents added effects." },
      nature: "MILD",
      status: "poison",
      level: 6,
      exp: 257,
      levelExp: 216,
      expToNextLevel: 86,
      hp: 4,
      maxHp: 22,
      stats: { attack: 10, defense: 9, speed: 11, spAttack: 9, spDefense: 7 },
      moves: [move("POISON STING", "POISON", 15, 100, 31, 35, "The foe is stabbed with a toxic barb, etc. It may poison the foe."), STRING_SHOT],
    }),
  },
  {
    state: "burn, 1 move",
    mon: mon({
      species: "MAGIKARP",
      types: ["WATER"],
      ability: { name: "SWIFT SWIM", description: "Raises SPEED in rain." },
      nature: "NAIVE",
      status: "burn",
      level: 5,
      exp: 190,
      levelExp: 156,
      expToNextLevel: 80,
      hp: 15,
      maxHp: 19,
      stats: { attack: 6, defense: 11, speed: 14, spAttack: 6, spDefense: 7 },
      moves: [move("SPLASH", "NORMAL", null, null, 40, 40, "The user just flops and splashes around without having any effect.")],
    }),
  },
  {
    state: "fainted (FNT at 0 HP), 2 moves",
    mon: mon({
      species: "CATERPIE",
      types: ["BUG"],
      ability: { name: "SHIELD DUST", description: "Prevents added effects." },
      nature: "BASHFUL",
      level: 4,
      exp: 79,
      levelExp: 64,
      expToNextLevel: 46,
      hp: 0,
      maxHp: 18,
      stats: { attack: 8, defense: 8, speed: 8, spAttack: 7, spDefense: 6 },
      moves: [{ ...TACKLE, pp: 32 }, STRING_SHOT],
    }),
  },
  {
    state: "level 100, paralysis, 4 moves",
    mon: mon({
      species: "CHARIZARD",
      types: ["FIRE", "FLYING"],
      ability: { name: "BLAZE", description: "Ups FIRE moves in a pinch." },
      heldItem: "CHARCOAL",
      nature: "TIMID",
      status: "paralysis",
      level: 100,
      exp: 1059860,
      levelExp: 1059860,
      expToNextLevel: 0,
      hp: 180,
      maxHp: 297,
      stats: { attack: 204, defense: 192, speed: 236, spAttack: 254, spDefense: 206 },
      moves: [
        move("FLAMETHROWER", "FIRE", 95, 100, 12, 15, "A powerful fire attack that may inflict a burn on the foe."),
        move("FLY", "FLYING", 70, 95, 15, 15, "A 2-turn move that hits on the 2nd turn. Use it to fly to any known town."),
        move("EARTHQUAKE", "GROUND", 100, 100, 4, 10, "An earthquake that strikes all POKéMON in battle excluding the user."),
        move("DRAGON CLAW", "DRAGON", 80, 100, 15, 15, "Sharp, huge claws hook and slash the foe quickly and with great power."),
      ],
    }),
  },
];

const DEMO_RUNS: RunSummary[] = [
  {
    id: 3,
    bot: "model",
    playing: true,
    stopAsked: false,
    endReason: null,
    error: null,
    parent: null,
    continued: null,
    model: { id: "deepseek/deepseek-v4-flash", costLimit: 1, reasoning: "low", starter: "free", cost: 0.37, callsStarted: 120 },
  },
  { id: 4, bot: "model", playing: false, stopAsked: false, endReason: "cost limit", error: null, parent: RECORD, continued: null, model: null },
];

const DEMO_SHOWN: { label: string; shown: ShownRun }[] = [
  { label: "the Run of the Viewer", shown: { kind: "viewer", replay: null } },
  { label: "a Run of a Bot that plays", shown: { kind: "bot", run: DEMO_RUNS[0] } },
  { label: "a replay", shown: { kind: "viewer", replay: { name: RECORD, frames: 1200, ended: false, endReason: "cost limit", model: null, continued: null } } },
];

export function RunSelectDemo() {
  return (
    <div class="grid max-w-[720px] gap-4 sm:grid-cols-3">
      {DEMO_SHOWN.map(({ label, shown }) => (
        <div key={label}>
          <p class="mb-1.5 text-xs text-faint">{label}</p>
          <RunSelect shown={shown} runs={DEMO_RUNS} records={[RECORD, "starter-3-2026-10-24T08-13-38.892Z.json"]} send={() => {}} />
        </div>
      ))}
    </div>
  );
}

const BOTS_STATES = {
  plays: { label: "A Run of a Bot plays", shown: { kind: "bot", run: DEMO_RUNS[0] } as ShownRun, bots: ["model", "starter"] },
  none: { label: "No Bot in bots/", shown: { kind: "viewer", replay: null } as ShownRun, bots: [] },
};

export function BotsDemo() {
  const [state, setState] = useState<keyof typeof BOTS_STATES>("plays");
  const { shown, bots } = BOTS_STATES[state];
  return (
    <div class="flex flex-col items-start gap-3">
      <Tabs kind="segmented" items={Object.entries(BOTS_STATES).map(([id, { label }]) => ({ id: id as keyof typeof BOTS_STATES, label }))} value={state} onChange={setState} />
      <PopoverBody>
        <BotsPanel shown={shown} bots={bots} records={[RECORD]} send={() => {}} />
      </PopoverBody>
    </div>
  );
}

export function PokemonCardDemo() {
  const [hp, setHp] = useState(IVYSAUR.hp);
  return (
    <div class="flex flex-col gap-4">
      <div class="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {PARTY.map(({ state, mon }, i) => (
          <div key={state}>
            <p class="mb-1.5 text-xs text-faint">{state}</p>
            <PokemonCard mon={i === 0 ? { ...mon, hp } : mon} />
          </div>
        ))}
      </div>
      <div class="flex gap-2">
        <Button size="sm" onClick={() => setHp((v) => Math.max(0, v - 12))}>
          Damage IVYSAUR
        </Button>
        <Button size="sm" onClick={() => setHp(IVYSAUR.maxHp)}>
          Heal
        </Button>
      </div>
    </div>
  );
}

const SUMMARY_STATES = [PARTY[0], PARTY[1], PARTY[5], PARTY[6]];

export function PokemonSummaryDemo() {
  const [state, setState] = useState(SUMMARY_STATES[0].state);
  const shown = SUMMARY_STATES.find((item) => item.state === state) ?? SUMMARY_STATES[0];
  return (
    <div class="flex flex-col items-start gap-3">
      <Tabs kind="segmented" items={SUMMARY_STATES.map((item) => ({ id: item.state, label: item.mon.nickname }))} value={state} onChange={setState} />
      <p class="text-xs text-faint">{shown.state}</p>
      <PopoverBody>
        <PokemonSummary mon={shown.mon} />
      </PopoverBody>
    </div>
  );
}
