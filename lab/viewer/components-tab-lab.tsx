import { useState } from "preact/hooks";
import { withoutFormat } from "../src/harness/game-events";
import type { RunEvent } from "../src/harness/record";
import type { PartyMon, PartyMove } from "../src/party";
import type { BotInfo, ClientMessage, ProviderStatus, RecordFacts, ReplayStatus, RunSummary, ShownRun } from "../src/protocol";
import { Badges, Button, Tabs } from "./components";
import { PopoverBody } from "./components-layers";
import { LeaderboardRow, ModelName, MonIcon } from "./components-race";
import { ScreenFeed, type Span } from "./cursor";
import { type GridActions, GridCellView } from "./grid";
import type { GridCell } from "./grid-cells";
import { PokemonCard, PokemonSummary } from "./pokemon";
import { GhostState } from "./race-cards";
import { RecordCard } from "./record-card";
import { BotsPanel, RunSelect } from "./runs";
import { ScreenControls, type ScreenRun, type ScreenSettings } from "./screen-controls";
import { availableKinds, Timeline } from "./timeline";
import { type TimelineKind, timelineEvents } from "./timeline-events";

export const RECORD = "00017-model-10-2026-10-27T09-38-59.686Z.json";

function move(name: string, type: string, power: number | null, accuracy: number | null, pp: number, maxPp: number, description: string): PartyMove {
  return { name, type, effect: 0, power, accuracy, pp, maxPp, description };
}

const TACKLE = move("TACKLE", "NORMAL", 35, 95, 35, 35, "A physical attack in which the user charges, full body, into the foe.");
const STRING_SHOT = move("STRING SHOT", "BUG", null, 95, 40, 40, "The foe is bound with strings shot from the mouth to reduce its SPEED.");

type MonData = Omit<PartyMon, "nickname" | "heldItem" | "isEgg" | "status"> & Partial<Pick<PartyMon, "nickname" | "heldItem" | "status">>;

function mon(data: MonData): PartyMon {
  return { nickname: data.species, heldItem: null, isEgg: false, status: "none", ...data };
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
    from: null,
    continued: null,
    model: { id: "deepseek/deepseek-v4-flash", provider: "openrouter", limit: { unit: "dollars", amount: 1 }, reasoning: "off", thinking: "medium", starter: "free", spent: { unit: "dollars", amount: 0.37 }, ownSpent: { unit: "dollars", amount: 0.37 } },
    frame: 52_000,
    milestone: "has-pokemon",
    battle: false,
    calling: { kind: "model", since: 0 },
    record: null,
    names: { player: "Mira", rival: "Crumb" },
  },
  {
    id: 4,
    bot: "model",
    playing: false,
    stopAsked: false,
    endReason: "cost limit",
    error: null,
    from: { record: RECORD, kind: "continued" },
    continued: null,
    model: null,
    frame: 81_000,
    milestone: "first-rival-battle",
    battle: false,
    calling: null,
    record: RECORD,
    names: null,
  },
];

const DEMO_SHOWN: { label: string; shown: ShownRun }[] = [
  { label: "the Run of the Viewer", shown: { kind: "viewer", replay: null } },
  { label: "a Run of a Bot that plays", shown: { kind: "bot", run: DEMO_RUNS[0] } },
  { label: "a replay", shown: { kind: "viewer", replay: { name: RECORD, frames: 1200, ended: false, endReason: "cost limit", model: null, continued: null, gameEvents: null, reached: 600, seeking: null } } },
];

export function RunSelectDemo() {
  return (
    <div class="grid max-w-[720px] gap-4 sm:grid-cols-3">
      {DEMO_SHOWN.map(({ label, shown }) => (
        <div key={label}>
          <p class="mb-1.5 text-xs text-faint">{label}</p>
          <RunSelect shown={shown} runs={DEMO_RUNS} records={[RECORD, "00016-model-9-2026-10-27T08-40-44.237Z.json"]} send={() => {}} />
        </div>
      ))}
    </div>
  );
}

const DEMO_PROVIDERS: ProviderStatus[] = [
  { provider: "openrouter", problem: null },
  { provider: "claude-code", problem: null },
  { provider: "codex", problem: "the command codex is not found: run bun install in lab/" },
];

const DEMO_BOTS: BotInfo[] = [
  { name: "model", kind: "model", version: "25", goal: null, costLimit: 0.5 },
  { name: "starter", kind: "scripted", version: "4", goal: null, costLimit: null },
];

type BotsState = { label: string; shown: ShownRun; bots: BotInfo[]; places: { free: number; limit: number }; runs?: RunSummary[]; initial?: { from: string; sameRun: boolean } };

const BOTS_STATES = {
  plays: { label: "A Run of a Bot plays", shown: { kind: "bot", run: DEMO_RUNS[0] }, bots: DEMO_BOTS, places: { free: 6, limit: 9 } },
  full: { label: "No free place", shown: { kind: "bot", run: DEMO_RUNS[0] }, bots: DEMO_BOTS, places: { free: 0, limit: 9 } },
  none: { label: "No Bot in bots/", shown: { kind: "viewer", replay: null }, bots: [], places: { free: 9, limit: 9 } },
  same: { label: "Keep the same Run", shown: { kind: "viewer", replay: null }, bots: DEMO_BOTS, places: { free: 6, limit: 9 }, initial: { from: RECORD, sameRun: true } },
  busy: { label: "A Run plays from the record", shown: { kind: "bot", run: DEMO_RUNS[0] }, bots: DEMO_BOTS, places: { free: 6, limit: 9 }, runs: [{ ...DEMO_RUNS[0], from: { record: RECORD, kind: "continued" } }], initial: { from: RECORD, sameRun: false } },
} satisfies Record<string, BotsState>;

const CONTINUED_RECORD = "00016-model-9-2026-10-27T08-40-44.237Z.json";

const DEMO_RECORD_FACTS: Record<string, RecordFacts> = {
  [RECORD]: {
    bot: "model",
    version: "10",
    model: { id: "gpt-6.1-terra", provider: "codex", reasoning: "off", thinking: "medium", starter: "free", limit: { unit: "tokens", amount: 30_000_000 }, stopAtWhiteout: true },
    continued: false,
  },
  [CONTINUED_RECORD]: {
    bot: "model",
    version: "9",
    model: { id: "deepseek/deepseek-v4-flash", provider: "openrouter", reasoning: "off", thinking: "medium", starter: "free", limit: { unit: "dollars", amount: 1 }, stopAtWhiteout: true },
    continued: true,
  },
};

export function BotsDemo() {
  const [state, setState] = useState<keyof typeof BOTS_STATES>("plays");
  const { shown, bots, places, runs, initial }: BotsState = BOTS_STATES[state];
  return (
    <div class="flex flex-col items-start gap-3">
      <Tabs kind="segmented" items={Object.entries(BOTS_STATES).map(([id, { label }]) => ({ id: id as keyof typeof BOTS_STATES, label }))} value={state} onChange={setState} />
      <PopoverBody>
        <BotsPanel key={state} shown={shown} runs={runs ?? []} bots={bots} providers={DEMO_PROVIDERS} records={[RECORD, CONTINUED_RECORD]} recordFacts={DEMO_RECORD_FACTS} places={places} initial={initial} send={() => {}} />
      </PopoverBody>
    </div>
  );
}

export function ScreenControlsDemo() {
  const [run, setRun] = useState<ScreenRun>({ speed: 1, paused: false, hasQuickState: false, botRun: false, jumping: false });
  const [settings, setSettings] = useState<ScreenSettings>({ overlay: false, sound: true, soundStarted: true, volume: 0.8 });
  const actions = {
    setOverlay: (overlay: boolean) => setSettings((now) => ({ ...now, overlay })),
    setSound: (sound: boolean) => setSettings((now) => ({ ...now, sound })),
    setVolume: (volume: number) => setSettings((now) => ({ ...now, volume })),
  };
  const send = (message: ClientMessage) => {
    if (message.type === "speed") setRun((now) => ({ ...now, speed: message.speed }));
    if (message.type === "pause") setRun((now) => ({ ...now, paused: message.paused }));
    if (message.type === "quick-save") setRun((now) => ({ ...now, hasQuickState: true }));
  };
  return (
    <div class="flex max-w-[680px] flex-col gap-4">
      <div>
        <p class="mb-1.5 text-xs text-faint">The Viewer Run: a hover on the overlay or on "?" shows the legend or the keys. Save state enables Load state.</p>
        <ScreenControls run={run} settings={settings} actions={actions} send={send} />
      </div>
      <div>
        <p class="mb-1.5 text-xs text-faint">A Run of a Bot: the controls of the Viewer Run are off; the overlay, the sound and the keys stay.</p>
        <ScreenControls run={{ ...run, botRun: true }} settings={settings} actions={actions} send={() => {}} />
      </div>
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

const MINUTE = 3584;

const AREAS = {
  PalletTown: { area: "Pallet Town", place: null },
  Route1: { area: "Route 1", place: null },
  ViridianCity: { area: "Viridian City", place: null },
  ViridianCity_PokemonCenter_1F: { area: "Viridian City", place: "Pokémon Center" },
  ViridianForest: { area: "Viridian Forest", place: null },
  PewterCity_Gym: { area: "Pewter City", place: "Gym" },
};

const at = (minute: number) => Math.round(minute * MINUTE);

// `trainer`: the trainer of a battle that the player wins. `null`: a trainer battle that the player loses, with no flag of its trainer.
function battle(minute: number, minutes: number, trainer?: string | null): RunEvent[] {
  const to = at(minute + minutes);
  const named: RunEvent[] = typeof trainer === "string" ? [{ frame: to + 5, type: "trainer", trainer, id: 1 }] : [];
  return [{ frame: at(minute), type: "battle", state: "start", trainer: trainer !== undefined }, { frame: to, type: "battle", state: "end" }, ...named];
}

function byFrame(events: RunEvent[]): RunEvent[] {
  return events.toSorted((a, b) => a.frame - b.frame);
}

const DEMO_EVENTS = byFrame([
  { frame: at(0.1), type: "map", map: "PalletTown" },
  { frame: at(1), type: "milestone", milestone: "has-pokemon" },
  ...battle(1.5, 1.2, "RIVAL BOB"),
  { frame: at(2.8), type: "level", species: "BULBASAUR", from: 5, level: 6, moves: [], evolution: null },
  { frame: at(3), type: "milestone", milestone: "first-rival-battle" },
  { frame: at(4), type: "map", map: "Route1" },
  ...battle(4.5, 0.5),
  ...battle(5.5, 0.4),
  { frame: at(6), type: "level", species: "BULBASAUR", from: 6, level: 8, moves: ["VINE WHIP"], evolution: null },
  { frame: at(7), type: "map", map: "ViridianCity" },
  { frame: at(7.5), type: "item", how: "received", item: "OAK'S PARCEL", count: 1 },
  { frame: at(9), type: "milestone", milestone: "pokedex" },
  { frame: at(10), type: "map", map: "ViridianCity_PokemonCenter_1F" },
  { frame: at(10.4), type: "heal", source: "center", item: null, party: [] },
  { frame: at(11), type: "purchase", item: "POTION", count: 3, money: 900 },
  { frame: at(13), type: "map", map: "ViridianForest" },
  ...battle(13.5, 0.6),
  { frame: at(14), type: "catch", species: "CATERPIE" },
  ...battle(15, 1, "BUG CATCHER RICK"),
  ...battle(17, 0.8),
  ...battle(17.9, 0.4, null),
  { frame: at(17.95), type: "faint", species: "CATERPIE", side: "player" },
  { frame: at(18), type: "heal", source: "item", item: "POTION", party: [] },
  { frame: at(19), type: "level", species: "CATERPIE", from: 7, level: 7, moves: [], evolution: "METAPOD" },
  { frame: at(24), type: "map", map: "PewterCity_Gym" },
  ...battle(25, 1.5, "LEADER BROCK"),
  { frame: at(26.6), type: "milestone", milestone: "badge-1" },
]);

const OLD_EVENTS = withoutFormat(DEMO_EVENTS);

const TIMELINE_STATES = {
  live: { label: "A live Run", events: DEMO_EVENTS, end: at(30), now: at(30), reached: undefined, ended: undefined, available: availableKinds(true) },
  jump: { label: "A replay during a jump", events: DEMO_EVENTS, end: at(40), now: at(22), reached: at(12), ended: undefined, available: availableKinds(true) },
  old: { label: "An old record with no Game events", events: OLD_EVENTS, end: at(40), now: at(40), reached: at(40), ended: "cost limit", available: availableKinds(false) },
};

export function TimelineDemo() {
  const [state, setState] = useState<keyof typeof TIMELINE_STATES>("live");
  const [kinds, setKinds] = useState<ReadonlySet<TimelineKind>>(new Set(["milestone", "faint", "catch", "evolution", "trainer", "heal", "place", "obstacle"]));
  const [cursor, setCursor] = useState<number | null>(null);
  const [selection, setSelection] = useState<Span | null>(null);
  const { events, end, now, reached, ended, available } = TIMELINE_STATES[state];
  const shown = timelineEvents(events, AREAS);
  return (
    <div class="flex flex-col items-start gap-3">
      <Tabs
        kind="segmented"
        items={Object.entries(TIMELINE_STATES).map(([id, { label }]) => ({ id: id as keyof typeof TIMELINE_STATES, label }))}
        value={state}
        onChange={(next) => {
          setState(next);
          setCursor(null);
          setSelection(null);
        }}
      />
      <div class="w-full pt-12">
        <Timeline
          events={shown}
          end={end}
          at={cursor ?? now}
          cursor={cursor !== null}
          reached={reached}
          selection={selection}
          ended={ended}
          available={available}
          kinds={kinds}
          onKinds={setKinds}
          onPick={setCursor}
          onRange={setSelection}
          onNow={() => {
            setCursor(null);
            setSelection(null);
          }}
        />
      </div>
    </div>
  );
}

const DEMO_REPLAY: ReplayStatus = {
  name: RECORD,
  frames: 457065,
  ended: false,
  endReason: "cost limit",
  model: { id: "deepseek/deepseek-v4-flash", provider: "openrouter", limit: { unit: "dollars", amount: 10 }, reasoning: "off", thinking: "medium", starter: "free", calls: 312, spent: { unit: "dollars", amount: 4.21 }, totalCalls: 717, totalSpent: { unit: "dollars", amount: 10.02 } },
  continued: null,
  gameEvents: 393,
  reached: 200000,
  seeking: null,
};

const RECORD_STATES = {
  plays: { label: "A replay that plays", replay: DEMO_REPLAY },
  tokens: {
    label: "A Run on a Plan provider",
    replay: {
      ...DEMO_REPLAY,
      model: DEMO_REPLAY.model && { ...DEMO_REPLAY.model, id: "claude-haiku-5-5", provider: "claude-code" as const, limit: { unit: "tokens" as const, amount: 1_000_000 }, spent: { unit: "tokens" as const, amount: 412_000 }, totalSpent: { unit: "tokens" as const, amount: 980_000 } },
    },
  },
  ended: { label: "A replay that ended", replay: { ...DEMO_REPLAY, ended: true, reached: 457065, model: DEMO_REPLAY.model && { ...DEMO_REPLAY.model, calls: 717, spent: { unit: "dollars" as const, amount: 10.02 } } } },
  jumps: { label: "A replay that jumps", replay: { ...DEMO_REPLAY, seeking: { from: 200000, to: 80000 } } },
  old: { label: "A record with no Game events", replay: { ...DEMO_REPLAY, gameEvents: null } },
};

const DEMO_CELL: GridCell = { kind: "live", names: null, runId: 3, name: "Run 3", bot: "model", model: "deepseek/deepseek-v4-flash", frame: 52_000, milestone: "has-pokemon", spent: { unit: "dollars", amount: 0.37 }, state: { kind: "plays" }, record: null };

const CELL_STATES: Record<string, { label: string; cell: GridCell | null }> = {
  plays: { label: "Live, plays", cell: DEMO_CELL },
  named: { label: "With the names of its character", cell: { ...DEMO_CELL, names: { player: "Mira", rival: "Crumb" } } },
  waits: { label: "Waits for the model", cell: { ...DEMO_CELL, state: { kind: "waits" } } },
  memory: { label: "Writes its memory", cell: { ...DEMO_CELL, state: { kind: "memory" } } },
  battle: { label: "In battle", cell: { ...DEMO_CELL, state: { kind: "battle" } } },
  ended: { label: "Live, ended", cell: { ...DEMO_CELL, state: { kind: "ended", result: "cost limit" }, record: RECORD } },
  replay: { label: "Replay", cell: { ...DEMO_CELL, kind: "replay", runId: 7, name: RECORD, record: RECORD } },
  tokens: { label: "On a Plan provider", cell: { ...DEMO_CELL, model: "haiku", spent: { unit: "tokens", amount: 412_000 } } },
  replayEnded: { label: "Replay, ended", cell: { ...DEMO_CELL, kind: "replay", runId: 7, name: RECORD, record: RECORD, state: { kind: "ended", result: "goal" } } },
  empty: { label: "Empty", cell: null },
};

const DEMO_GRID_ACTIONS: GridActions = { send: () => {}, setSize: () => {}, focus: () => {} };

export function GridCellDemo() {
  const [state, setState] = useState("plays");
  const [screens] = useState(() => new ScreenFeed());
  return (
    <div class="flex flex-col items-start gap-3">
      <Tabs kind="segmented" items={Object.entries(CELL_STATES).map(([id, { label }]) => ({ id, label }))} value={state} onChange={setState} />
      <div class="w-[340px] max-w-full">
        <GridCellView cell={CELL_STATES[state].cell} index={0} records={[RECORD]} screens={screens} actions={DEMO_GRID_ACTIONS} />
      </div>
    </div>
  );
}

export function RecordCardDemo() {
  const [state, setState] = useState<keyof typeof RECORD_STATES>("plays");
  return (
    <div class="flex flex-col items-start gap-3">
      <Tabs kind="segmented" items={Object.entries(RECORD_STATES).map(([id, { label }]) => ({ id: id as keyof typeof RECORD_STATES, label }))} value={state} onChange={setState} />
      <PopoverBody>
        <RecordCard replay={RECORD_STATES[state].replay} />
      </PopoverBody>
    </div>
  );
}

const DEMO_ICON = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 8 8"><rect x="2" y="2" width="4" height="4" fill="#6aa"/></svg>')}`;

export function MonIconDemo() {
  return (
    <div class="flex items-center gap-4 text-xs text-faint">
      <MonIcon src={DEMO_ICON} species="SQUIRTLE" /> with no level
      <MonIcon src={DEMO_ICON} species="SQUIRTLE" level={5} /> with a level
      <MonIcon src={DEMO_ICON} species="MEWTWO" level={100} /> 3 digits
      <MonIcon src={null} species="?" level={7} /> no icon
    </div>
  );
}

export function ModelNameDemo() {
  return (
    <div class="flex flex-col gap-2">
      <ModelName id="deepseek/deepseek-v4.1-flash" />
      <ModelName id="deepseek/deepseek-v4.1-flash" short />
      <ModelName id="haiku" />
      <ModelName id="gpt-6.1-terra" />
      <ModelName id="grok-4.7" />
      <ModelName id="mistralai/mistral-large" />
      <div class="w-24">
        <ModelName id="deepseek/deepseek-v4.1-flash" short />
      </div>
    </div>
  );
}

export function LeaderboardRowDemo() {
  const [selected, setSelected] = useState(0);
  const team = (size: number) => Array.from({ length: size }, (_, i) => <MonIcon key={i} src={DEMO_ICON} species="SQUIRTLE" level={5 + i * 19} />);
  const badges = (got: number) => <Badges got={Array.from({ length: 8 }, (_, i) => i < got)} />;
  const inBattle = { frame: 0, kind: "battle", trainer: null, player: null, foe: null } as const;
  const rows = [
    { rank: 1, id: "00017", ghost: { result: null, battle: null }, model: "deepseek/deepseek-v4.1-flash", cost: "1.24 $", size: 6, got: 8, faded: false },
    { rank: 2, id: "00003", ghost: { result: null, battle: inBattle }, model: "gpt-6.1-terra", cost: "12.08 $", size: 3, got: 2, faded: false },
    { rank: 3, id: "00041", ghost: { result: null, battle: null }, model: "mistralai/mistral-large", cost: "0.00 $", size: 0, got: 0, faded: false },
    { rank: 4, id: "00052", ghost: { result: null, battle: null }, model: "haiku", cost: "412.0k tok", size: 2, got: 0, faded: false },
    { rank: 142, id: "01000", ghost: { result: "whiteout", battle: null }, model: "deepseek/deepseek-v4-flash", cost: "0.31 $", size: 3, got: 1, faded: true },
  ] as const;
  return (
    <div class="flex w-[380px] max-w-full flex-col">
      {rows.map(({ rank, id, ghost, model, cost, size, got, faded }, i) => (
        <LeaderboardRow key={id} rank={rank} face={<span class="block h-9 w-6 rounded-sm bg-raised" />} id={id} team={team(size)} badges={badges(got)} cost={cost} state={<GhostState ghost={ghost} />} model={model} faded={faded} selected={selected === i} onClick={() => setSelected(i)} />
      ))}
    </div>
  );
}
