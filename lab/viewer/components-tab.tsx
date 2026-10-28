import { BookOpen, CircleCheck, Copy, Info, LayoutGrid, OctagonAlert, Pause, Play, RotateCcw, Search, Shapes, Square, Trophy } from "lucide-preact";
import { type ComponentChildren, render } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import type { PartyMon, PartyMove } from "../src/party";
import {
  Badges,
  Bar,
  Button,
  Card,
  Checkbox,
  ExpBar,
  Field,
  HoverCard,
  Input,
  LABEL,
  Num,
  Pill,
  Popover,
  PopoverBody,
  Select,
  StatBar,
  Switch,
  Tabs,
  Toast,
  Toaster,
  type Tone,
  Tooltip,
  TYPES,
  TypeChip,
  hpTone,
  typeToken,
} from "./components";
import { PokemonCard, PokemonSummary } from "./pokemon";

/** The color tokens of the theme, read from the style sheets, so that the tab shows each new token. */
function colorTokens(): string[] {
  const names = new Set<string>();
  const walk = (rules: CSSRuleList) => {
    for (const rule of rules) {
      if (rule instanceof CSSStyleRule && rule.selectorText.includes(":root")) {
        for (const name of rule.style) if (name.startsWith("--color-")) names.add(name.slice("--color-".length));
      } else if ("cssRules" in rule) walk((rule as CSSGroupingRule).cssRules);
    }
  };
  for (const sheet of document.styleSheets) walk(sheet.cssRules);
  return [...names].filter((name) => !name.startsWith("type-"));
}

function Section({ title, rule, children }: { title: string; rule: string; children: ComponentChildren }) {
  return (
    <section class="grid gap-3 border-t border-line py-7 first:border-t-0 md:grid-cols-[200px_1fr]">
      <div>
        <h2 class="text-lg font-semibold">{title}</h2>
        <p class="mt-1 text-sm leading-relaxed text-muted">{rule}</p>
      </div>
      <div class="min-w-0">{children}</div>
    </section>
  );
}

function Swatch({ token }: { token: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [value, setValue] = useState("");
  useEffect(() => setValue(getComputedStyle(ref.current!).getPropertyValue(`--color-${token}`).trim()), [token]);
  return (
    <div ref={ref} class="flex items-center gap-2.5">
      <span class="size-8 shrink-0 rounded-sm border border-line" style={{ background: `var(--color-${token})` }} />
      <span class="min-w-0">
        <span class="block text-sm font-semibold">{token}</span>
        <span class="block truncate font-mono text-xs text-faint">{value}</span>
      </span>
    </div>
  );
}

function TypeDemo() {
  return (
    <div class="flex flex-col gap-3">
      <p class="text-3xl font-semibold tracking-tight">Route 3</p>
      <p class="text-2xl font-semibold tracking-tight">Lass Sally, a trainer battle</p>
      <p class="text-xl font-semibold">Mission and Objective</p>
      <p class="max-w-[62ch] leading-relaxed">
        The model bot plays one Run from the Starting save. It gets control only at a Decision point, and it answers with one action and a short reason.
      </p>
      <p class="text-sm text-muted">Secondary text: frame 457,065, 2:07:32</p>
      <p class={LABEL}>Label</p>
      <p class="font-mono text-xs text-muted">- fight 3: VINE WHIP (GRASS, power 35, PP 0/10). No PP: you cannot use it.</p>
    </div>
  );
}

function ButtonDemo() {
  const [loading, setLoading] = useState(false);
  const [follow, setFollow] = useState(true);
  const load = () => {
    setLoading(true);
    setTimeout(() => setLoading(false), 1200);
  };
  return (
    <div class="flex flex-col gap-4">
      <div class="flex flex-wrap items-center gap-2">
        <Button variant="primary">
          <Play size={14} />
          Start the Bot
        </Button>
        <Button>
          <Pause size={14} />
          Pause
        </Button>
        <Button variant="ghost">
          <RotateCcw size={14} />
          Restart
        </Button>
        <Button variant="danger">
          <Square size={13} />
          Stop the Run
        </Button>
        <Tooltip text="Copy the prompt">
          <Button size="icon" aria-label="Copy the prompt">
            <Copy size={15} />
          </Button>
        </Tooltip>
      </div>
      <div class="flex flex-wrap items-center gap-2">
        <Button variant="primary" loading={loading} onClick={load}>
          {loading ? "Starting…" : "Click to load"}
        </Button>
        <Button disabled>Disabled</Button>
        <Button pressed={follow} onClick={() => setFollow(!follow)}>
          Follow the player
        </Button>
        <Button size="sm">Small</Button>
        <Button size="sm" variant="ghost">
          Small ghost
        </Button>
      </div>
    </div>
  );
}

function FieldDemo() {
  const [whiteout, setWhiteout] = useState(true);
  const [sound, setSound] = useState(false);
  return (
    <div class="grid max-w-[640px] gap-4 sm:grid-cols-2">
      <Field label="Model">
        <Input value="deepseek/deepseek-v4-flash" />
      </Field>
      <Field label="Cost limit" hint="Empty: LAB_COST_LIMIT or 0.50 $.">
        <Input type="number" step="0.05" value="0.50" unit="$" />
      </Field>
      <Field label="Reasoning">
        <Select>
          <option>low</option>
          <option>off</option>
          <option>medium</option>
          <option>high</option>
        </Select>
      </Field>
      <Field label="Go to a map">
        <Input placeholder="Viridian City" icon={<Search size={14} />} />
      </Field>
      <Field label="Starter" error="Not a starter of FireRed.">
        <Input value="MEWTWO" invalid />
      </Field>
      <div class="flex flex-col justify-end gap-3 pb-1">
        <Switch on={whiteout} onChange={setWhiteout}>
          Stop at a whiteout
        </Switch>
        <Checkbox on={sound} onChange={setSound}>
          Sound
        </Checkbox>
      </div>
    </div>
  );
}

function TabsDemo() {
  const [block, setBlock] = useState<"situation" | "battle" | "rules">("battle");
  const [speed, setSpeed] = useState<"1" | "4" | "max">("4");
  const [tab, setTab] = useState<"lab" | "doc" | "components">("components");
  return (
    <div class="flex flex-wrap items-center gap-6">
      <Tabs
        value={tab}
        onChange={setTab}
        items={[
          { id: "lab", label: "Lab", icon: <LayoutGrid size={15} /> },
          { id: "doc", label: "Doc", icon: <BookOpen size={15} /> },
          { id: "components", label: "Components", icon: <Shapes size={15} /> },
        ]}
      />
      <Tabs
        value={block}
        onChange={setBlock}
        items={[
          { id: "situation", label: "Situation" },
          { id: "battle", label: "Battle" },
          { id: "rules", label: "Rules" },
        ]}
      />
      <Tabs
        kind="segmented"
        value={speed}
        onChange={setSpeed}
        items={[
          { id: "1", label: "×1" },
          { id: "4", label: "×4" },
          { id: "max", label: "Max" },
        ]}
      />
    </div>
  );
}

function BarDemo() {
  const [hp, setHp] = useState(40);
  const [cost, setCost] = useState(0.445);
  return (
    <div class="flex max-w-[520px] flex-col gap-4">
      <div>
        <div class="mb-1.5 flex justify-between text-sm">
          <span class="font-semibold">
            IVYSAUR <span class="font-medium text-muted">Lv 18</span>
          </span>
          <span class="text-muted">
            <Num value={hp} />
            /53
          </span>
        </div>
        <Bar value={hp} max={53} tone={hpTone(hp / 53)} />
      </div>
      <div>
        <div class="mb-1.5 flex justify-between text-sm">
          <span class="font-semibold">Cost</span>
          <span class="text-muted">
            $<Num value={cost} format={(n) => n.toFixed(3)} /> of $0.50
          </span>
        </div>
        <Bar value={cost} max={0.5} />
      </div>
      <div class="flex gap-2">
        <Button size="sm" onClick={() => setHp((v) => Math.max(0, v - 12))}>
          Damage
        </Button>
        <Button size="sm" onClick={() => setHp(53)}>
          Heal
        </Button>
        <Button size="sm" onClick={() => setCost((c) => Math.min(0.5, c + 0.02))}>
          Model call
        </Button>
      </div>
    </div>
  );
}

function CardDemo() {
  const [money, setMoney] = useState(3434);
  return (
    <div class="grid gap-4 sm:grid-cols-3">
      <Card>
        <p class={`${LABEL} mb-2`}>Money</p>
        <p class="text-2xl font-semibold">
          ₽<Num value={money} />
        </p>
        <div class="mt-3 flex gap-2">
          <Button size="sm" onClick={() => setMoney((m) => m + 450)}>
            +450
          </Button>
          <Button size="sm" onClick={() => setMoney((m) => m - 600)}>
            −600
          </Button>
        </div>
      </Card>
      <Card>
        <div class="mb-2 flex items-center">
          <p class={`${LABEL} flex-1`}>Run</p>
          <Pill>user stop</Pill>
        </div>
        <p class="text-sm leading-relaxed">
          model-10, deepseek-v4-flash
          <br />
          <span class="text-muted">456,974 frames, 717 calls</span>
        </p>
      </Card>
      <Card interactive>
        <p class={`${LABEL} mb-2`}>Review turn, 1:49:42</p>
        <p class="text-sm leading-relaxed">“Bug Catcher Greg is defeated; I'm on Route 3 heading east.”</p>
      </Card>
    </div>
  );
}

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

function TypeChipDemo() {
  return (
    <div class="flex flex-col gap-4">
      <div class="flex flex-wrap gap-1.5">
        {TYPES.map((type) => (
          <TypeChip key={type} type={type} />
        ))}
      </div>
      <div class="flex flex-wrap items-center gap-4 text-sm">
        <span class="flex items-center gap-1">
          IVYSAUR <TypeChip type="GRASS" />
          <TypeChip type="POISON" />
        </span>
        <span class="flex items-center gap-1">
          A type that the list does not have <TypeChip type="#19" />
        </span>
      </div>
    </div>
  );
}

function GameBarDemo() {
  const [pp, setPp] = useState(10);
  return (
    <div class="flex max-w-[520px] flex-col gap-5">
      <div>
        <p class={`${LABEL} mb-2`}>PP, in the color of the type</p>
        <div class="grid grid-cols-4 gap-2">
          <Bar value={33} max={35} type="POISON" />
          <Bar value={1} max={15} type="GRASS" />
          <Bar value={pp} max={10} type="ELECTR" />
          <Bar value={0} max={10} type="GRASS" />
        </div>
        <div class="mt-3 flex gap-2">
          <Button size="sm" onClick={() => setPp((v) => Math.max(0, v - 1))}>
            Use THUNDERSHOCK
          </Button>
          <Button size="sm" onClick={() => setPp(10)}>
            Restore the PP
          </Button>
        </div>
      </div>
      <div class="flex flex-col gap-3">
        <p class={LABEL}>EXP: from the start of the level to the next level</p>
        <ExpBar level={18} exp={3929} levelExp={3798} expToNextLevel={646} />
        <ExpBar level={6} exp={340} levelExp={216} expToNextLevel={3} />
        <ExpBar level={100} exp={1059860} levelExp={1059860} expToNextLevel={0} />
      </div>
      <div class="flex max-w-[260px] flex-col gap-1">
        <p class={`${LABEL} mb-1`}>Stats</p>
        {(
          [
            ["Attack", 32],
            ["Defense", 29],
            ["Sp. Atk", 33],
            ["Sp. Def", 38],
            ["Speed", 33],
          ] as const
        ).map(([label, value]) => (
          <StatBar key={label} label={label} value={value} max={38} />
        ))}
      </div>
    </div>
  );
}

function HoverCardDemo() {
  return (
    <div class="flex flex-wrap items-start gap-6">
      <HoverCard
        card={
          <div class="flex max-w-[320px] flex-col gap-1.5 text-sm">
            <p class={LABEL}>Review turn, 1:49:42</p>
            <p>
              <span class="text-muted">Mission </span>Earn the Boulder Badge from Brock.
            </p>
            <p>
              <span class="text-muted">Objective </span>Go east on Route 3 to Mt. Moon.
            </p>
          </div>
        }
      >
        <Card interactive>
          <p class="text-sm">Hover me, or focus me with Tab</p>
        </Card>
      </HoverCard>
      <PopoverBody>
        <p class="text-sm">The card when it is open.</p>
      </PopoverBody>
    </div>
  );
}

function RunForm() {
  return (
    <div class="flex w-[300px] flex-col gap-3">
      <Field label="Run">
        <Select>
          <option>Run 3 · model · plays</option>
          <option>Viewer Run (keyboard)</option>
        </Select>
      </Field>
      <Button variant="primary">
        <Play size={14} />
        Start the Bot
      </Button>
    </div>
  );
}

function PopoverDemo() {
  return (
    <div class="flex flex-col gap-4">
      <div class="flex flex-wrap items-center gap-3">
        <Popover label="Run 3 · model · plays">
          <RunForm />
        </Popover>
        <span class="flex w-[220px]">
          <Popover label="Replay of model-10-2026-10-27T09-38-59.686Z.json">
            <RunForm />
          </Popover>
        </span>
        <Popover label="No Run" disabled>
          <RunForm />
        </Popover>
      </div>
      <div>
        <p class="mb-1.5 text-xs text-faint">open</p>
        <PopoverBody>
          <RunForm />
        </PopoverBody>
      </div>
    </div>
  );
}

type DemoToast = { id: number; tone: Tone; icon: ComponentChildren; title: string; text: string };

const TOASTS: Omit<DemoToast, "id">[] = [
  { tone: "accent", icon: <Trophy size={16} />, title: "Milestone", text: "badge-1 at 1:49:42" },
  { tone: "info", icon: <Info size={16} />, title: "Notice", text: "Savestate loaded." },
  { tone: "ok", icon: <CircleCheck size={16} />, title: "Run 3", text: "end: user stop. The Run record is written." },
  { tone: "bad", icon: <OctagonAlert size={16} />, title: "Run 4", text: "the Run record is not written (disk full)." },
];

function ToastDemo() {
  const [shown, setShown] = useState<DemoToast[]>([]);
  const next = useRef(0);
  const close = (id: number) => setShown((now) => now.filter((toast) => toast.id !== id));
  const show = (toast: Omit<DemoToast, "id">) => {
    const id = ++next.current;
    setShown((now) => [...now, { ...toast, id }].slice(-4));
    setTimeout(() => close(id), 6000);
  };
  return (
    <div class="flex flex-col gap-4">
      <div class="flex flex-wrap gap-2">
        {TOASTS.map((toast) => (
          <Button key={toast.tone} size="sm" onClick={() => show(toast)}>
            {toast.title}
          </Button>
        ))}
      </div>
      <div class="flex flex-col gap-2">
        {TOASTS.map((toast) => (
          <Toast key={toast.tone} tone={toast.tone} icon={toast.icon} title={toast.title} onClose={() => {}}>
            {toast.text}
          </Toast>
        ))}
        <Toast title="A title only" />
      </div>
      <Toaster>
        {shown.map((toast) => (
          <Toast key={toast.id} tone={toast.tone} icon={toast.icon} title={toast.title} onClose={() => close(toast.id)}>
            {toast.text}
          </Toast>
        ))}
      </Toaster>
    </div>
  );
}

const NO_BADGE = Array.from({ length: 8 }, () => false);

function BadgesDemo() {
  const [got, setGot] = useState(NO_BADGE.map((_, i) => i < 2));
  const count = got.filter(Boolean).length;
  return (
    <div class="flex flex-col gap-4">
      <div class="grid grid-cols-2 gap-4 text-sm sm:grid-cols-4">
        {(
          [
            ["no state yet", null],
            ["no badge", NO_BADGE],
            ["3 badges", NO_BADGE.map((_, i) => i < 3)],
            ["all the badges", NO_BADGE.map(() => true)],
          ] as const
        ).map(([state, badges]) => (
          <div key={state}>
            <p class="mb-1.5 text-xs text-faint">{state}</p>
            <Badges got={badges} />
          </div>
        ))}
      </div>
      <div class="flex items-center gap-3">
        <Badges got={got} />
        <Button size="sm" disabled={count === 8} onClick={() => setGot(got.map((on, i) => on || i === count))}>
          Get the next badge
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setGot(NO_BADGE)}>
          Reset
        </Button>
      </div>
    </div>
  );
}

function PokemonCardDemo() {
  const [hp, setHp] = useState(IVYSAUR.hp);
  return (
    <div class="flex flex-col gap-4">
      <div class="grid grid-cols-2 gap-3 sm:grid-cols-3">
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

function PokemonSummaryDemo() {
  return (
    <div class="flex flex-col gap-5">
      {[PARTY[0], PARTY[1], PARTY[5], PARTY[6]].map(({ state, mon }) => (
        <div key={state}>
          <p class="mb-1.5 text-xs text-faint">{state}</p>
          <PopoverBody>
            <PokemonSummary mon={mon} />
          </PopoverBody>
        </div>
      ))}
    </div>
  );
}

function ComponentsSheet() {
  const [reduced, setReduced] = useState(false);
  return (
    <div data-motion={reduced ? "reduce" : undefined} class="ds min-h-screen">
      <div class="mx-auto max-w-[1080px] px-6 pb-24">
        <header class="flex h-16 items-center gap-6">
          <h1 class="text-lg font-bold">Components</h1>
          <span class="flex-1 text-sm text-muted">The design system of the Viewer. A new part uses these components; a new component needs the agreement of the user, then it goes on this page.</span>
          <Checkbox on={reduced} onChange={setReduced}>
            <span class="text-muted">Reduced motion</span>
          </Checkbox>
        </header>
        <Section title="Type" rule="Raleway for text, JetBrains Mono for prompts, frames and code. Numbers are tabular.">
          <TypeDemo />
        </Section>
        <Section title="Color" rule="All the color tokens. One accent. Green, amber and red only for a state: ok, warning, problem.">
          <div class="grid grid-cols-2 gap-4 sm:grid-cols-4">
            {colorTokens().map((token) => (
              <Swatch key={token} token={token} />
            ))}
          </div>
        </Section>
        <Section title="Type colors" rule="One token for each type of the game, with its usual color. The token of ??? is type-mystery.">
          <div class="grid grid-cols-2 gap-4 sm:grid-cols-4">
            {TYPES.map((type) => (
              <Swatch key={type} token={typeToken(type)} />
            ))}
          </div>
        </Section>
        <Section title="Button" rule="Press: a small scale. Focus: a ring. One primary button for each area.">
          <ButtonDemo />
        </Section>
        <Section title="Field" rule="Focus: the border and a soft ring. An error has a red border and a short text under it.">
          <FieldDemo />
        </Section>
        <Section title="Tabs" rule="The indicator slides to the selected tab. An icon only in the tabs of the navigation bar.">
          <TabsDemo />
        </Section>
        <Section title="Pill" rule="A short state or count. A dot for a state with a color.">
          <div class="flex flex-wrap gap-2">
            <Pill>walk</Pill>
            <Pill tone="ok">done</Pill>
            <Pill tone="info">interrupted</Pill>
            <Pill tone="warn">blocked</Pill>
            <Pill tone="bad">impossible</Pill>
            <Pill tone="accent">Review turn</Pill>
            <Pill>717 calls</Pill>
          </div>
        </Section>
        <Section title="Bar and number" rule="The fill moves, and a light trail follows it when the value falls. HP uses the colors of the game. A number counts to its new value.">
          <BarDemo />
        </Section>
        <Section title="Bars of the game" rule="A bar takes the color of a type for the PP of a move. The EXP bar starts at the EXP of the level and is empty at level 100. A stat bar compares the stats of one Pokémon: the largest stat fills its bar.">
          <GameBarDemo />
        </Section>
        <Section title="TypeChip" rule="The name of a type on its color. White text on a dark type color, dark text on the others.">
          <TypeChipDemo />
        </Section>
        <Section title="Card" rule="The base of each panel. A card that opens something takes the accent on hover: its border and its background. A small card (size sm) is for a compact view: see the Pokémon card.">
          <CardDemo />
        </Section>
        <Section title="Tooltip" rule="A short text on hover or on keyboard focus, for an icon or a number. A wide tooltip is on a full row, and its text can have more than one line.">
          <div class="flex max-w-[520px] flex-col gap-4">
            <div class="flex items-center gap-3 text-sm">
              <Tooltip text="frame 393,168">
                <span class="cursor-default underline decoration-faint decoration-dotted underline-offset-4">1:49:42</span>
              </Tooltip>
              <Tooltip text="Copy the prompt">
                <Button size="icon" aria-label="Copy the prompt">
                  <Copy size={15} />
                </Button>
              </Tooltip>
            </div>
            <Tooltip wide text="A sleep-inducing dust is scattered in high volume around a foe.">
              <div class="flex flex-1 cursor-default justify-between rounded-sm px-2 py-1 text-sm hover:bg-raised">
                <span class="font-semibold">SLEEP POWDER</span>
                <span class="text-muted">1/15</span>
              </div>
            </Tooltip>
          </div>
        </Section>
        <Section title="HoverCard" rule="A card that opens after a short hover, or at the keyboard focus, next to its trigger. The pointer can go into the card.">
          <HoverCardDemo />
        </Section>
        <Section
          title="Popover"
          rule="A panel that a click on its button opens, under the button. A click outside or Esc closes it. The button takes the accent while it is open. A long label ends with “…”."
        >
          <PopoverDemo />
        </Section>
        <Section
          title="Toast"
          rule="A short message at the bottom right: a notice of the server, a Milestone. Its border has the color of its tone. It closes after 6 s, or with its button. 4 toasts at most."
        >
          <ToastDemo />
        </Section>
        <Section title="Badges" rule="The 8 badges of the player as dots. A badge that the player gets shines. Reduced motion stops the shine.">
          <BadgesDemo />
        </Section>
        <Section
          title="Pokémon card"
          rule="A Pokémon of the party: the nickname, the species when it is different, the level, the status (FNT at 0 HP), the HP in the colors of the game, and the PP of each move in the color of its type. A hover opens its summary."
        >
          <PokemonCardDemo />
        </Section>
        <Section
          title="Pokémon hover card"
          rule="The summary on one card: the types, the HP, the ability, the nature, the held item, the stats, the EXP and the moves. A hover on a move shows its description."
        >
          <PokemonSummaryDemo />
        </Section>
      </div>
    </div>
  );
}

export function mountComponentsTab(root: HTMLElement): void {
  render(<ComponentsSheet />, root);
}
