import { Ban, BookOpen, Bot, Brain, ChartColumn, ClipboardCheck, Clock, Coins, Copy, Eye, Flame, Heart, LayoutGrid, ListTree, Map as MapIcon, MessageSquare, Pause, Play, RotateCcw, Search, Shapes, Skull, Square, Swords } from "lucide-preact";
import { type ComponentChildren, render } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import { Badges, Bar, Breadcrumb, Button, Checkbox, Code, ExpBar, FilterChip, Field, Input, KeyList, LABEL, Legend, ListRow, Metric, Num, NumberBadge, Pill, SignedBar, Slider, StatBar, StatTile, Switch, TermList, Tabs, toggled, Tooltip, TYPES, TypeChip, hpTone, typeToken } from "./components";
import { GenerationChart, type GenerationPoint } from "./components-chart";
import { Select } from "./components-layers";
import { PromptText } from "./prompt-text";
import { SPEED_TABS } from "./screen-controls";
import { clock } from "./stats-format";
import { BotsDemo, GridCellDemo, LeaderboardRowDemo, ModelNameDemo, MonIconDemo, PokemonCardDemo, PokemonSummaryDemo, RECORD, RecordCardDemo, RunSelectDemo, ScreenControlsDemo, TimelineDemo } from "./components-tab-lab";
import { CardDemo, CollapsibleDemo, CoverDemo, HoverCardDemo, InfoCardDemo, PointerCardDemo, PopoverDemo, ToastDemo, TooltipDemo } from "./components-tab-surfaces";
import { OVERLAY_SWATCHES } from "./mapdraw";

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
    <section class="border-t border-line py-5 first:border-t-0 first:pt-2">
      <div class="mb-3">
        <h2 class="text-base font-semibold">{title}</h2>
        <p class="mt-0.5 max-w-[100ch] text-xs leading-relaxed text-muted">{rule}</p>
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
      <span class="size-6 shrink-0 rounded-sm border border-line" style={{ background: `var(--color-${token})` }} />
      <span class="min-w-0">
        <span class="block text-xs font-semibold">{token}</span>
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

const REASONING_OPTIONS = ["off", "low", "medium", "high"].map((level) => ({ value: level, label: `reasoning ${level}` }));

function FieldDemo() {
  const [reasoning, setReasoning] = useState("off");
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
        <Select options={REASONING_OPTIONS} value={reasoning} onChange={setReasoning} />
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
        <Checkbox on={false} disabledReason="Disabled, with its reason." onChange={() => {}}>
          Off
        </Checkbox>
        <Checkbox on disabledReason="Disabled, with its reason." onChange={() => {}}>
          On
        </Checkbox>
      </div>
    </div>
  );
}

const PROVIDER_OPTIONS = [
  { value: "openrouter", label: "openrouter" },
  { value: "claude-code", label: "claude-code" },
  { value: "codex", label: "codex", disabledReason: "Codex is not logged in with a subscription" },
];

const RUN_OPTIONS = [
  { value: "viewer", label: "Viewer Run (keyboard)", group: "Viewer Run" },
  { value: "run:3", label: "Run 3 · model · plays", group: "Runs of the Bots" },
  { value: "run:4", label: `Run 4 · model (continues ${RECORD}) · end: cost limit`, group: "Runs of the Bots" },
  { value: `replay:${RECORD}`, label: RECORD, group: "Replay a Run record" },
  { value: "replay:00016-model-9-2026-10-27T08-40-44.237Z.json", label: "00016-model-9-2026-10-27T08-40-44.237Z.json", group: "Replay a Run record" },
];

const RECORD_OPTIONS = RUN_OPTIONS.filter((option) => option.value.startsWith("replay:")).map(({ value, label }) => ({ value, label }));

const TYPE_OPTIONS = TYPES.map((type) => ({ value: type, label: type }));

const MAP_OPTIONS = ["CeruleanCity", "PalletTown", "Route1", "Route8", "Route23", "SaffronCity", "SaffronCity_Gym", "ViridianCity", "ViridianCity_Mart", "ViridianCity_PokemonCenter_1F", "ViridianForest"].map(
  (name) => ({ value: name, label: name }),
);

function SelectDemo() {
  const [run, setRun] = useState("run:3");
  const [type, setType] = useState("GRASS");
  const [record, setRecord] = useState("");
  return (
    <div class="grid max-w-[640px] gap-4 sm:grid-cols-2">
      <Field label="Run" hint="Groups: the name of each group is above its options. A long text ends with “…”.">
        <Select options={RUN_OPTIONS} value={run} onChange={setRun} />
      </Field>
      <Field label="Type" hint="A long list scrolls.">
        <Select options={TYPE_OPTIONS} value={type} onChange={setType} />
      </Field>
      <Field label="Run record" hint="No value yet.">
        <Select options={RECORD_OPTIONS} value={record} onChange={setRecord} placeholder="Choose a Run record" />
      </Field>
      <Field label="Starter" hint="Disabled.">
        <Select options={[{ value: "free", label: "starter free" }]} value="free" onChange={() => {}} disabled />
      </Field>
      <Field label="Provider" hint="An option can be disabled, with its reason: codex.">
        <Select options={PROVIDER_OPTIONS} value="openrouter" onChange={() => {}} />
      </Field>
      <Field label="Map" hint="searchable: type “viridian city” (a part of a name; no case, “_” and spaces do not count), or “xyz” for no match. The value stays empty.">
        <Select
          options={MAP_OPTIONS}
          value=""
          placeholder="Go to a map…"
          searchable={{ placeholder: `Search ${MAP_OPTIONS.length} maps…`, empty: (query) => `No map with “${query}”.` }}
          onChange={() => {}}
        />
      </Field>
    </div>
  );
}

function TabsDemo() {
  const [block, setBlock] = useState<"situation" | "battle" | "rules">("battle");
  const [speed, setSpeed] = useState("4");
  const [tab, setTab] = useState<"lab" | "doc" | "components">("components");
  const [panel, setPanel] = useState<"map" | "model" | "stats" | "memory" | "replay">("model");
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
      <Tabs kind="segmented" value={speed} onChange={setSpeed} items={SPEED_TABS} />
      <div class="flex flex-col gap-1.5">
        <span class="text-xs text-muted">Disabled</span>
        <Tabs kind="segmented" value="4" onChange={() => {}} items={SPEED_TABS} disabled />
      </div>
      <div class="rounded-card border border-line p-2">
        <Tabs
          kind="rail"
          value={panel}
          onChange={setPanel}
          items={[
            { id: "map", label: "Whole map", icon: <MapIcon size={16} /> },
            { id: "model", label: "Model", icon: <Bot size={16} /> },
            { id: "stats", label: "Stats", icon: <ChartColumn size={16} /> },
            { id: "memory", label: "Memory tree", icon: <ListTree size={16} /> },
          ]}
        />
      </div>
    </div>
  );
}

function SliderDemo() {
  const [volume, setVolume] = useState(80);
  const [value, setValue] = useState(1800);
  const [reached, setReached] = useState(5400);
  const seek = (frame: number) => {
    setValue(frame);
    setReached((r) => Math.max(r, frame));
  };
  return (
    <div class="flex max-w-[520px] flex-col gap-5">
      <div class="flex flex-col gap-1.5">
        <span class="text-xs text-muted">Default: hover for the time, drag or use the arrow keys. The light part is the reached part: a jump into it is fast.</span>
        <Slider label="Demo frame" value={value} max={14400} reached={reached} step={60} format={clock} onSeek={seek} />
        <span class="text-sm tabular-nums">
          {clock(value)} <span class="text-muted">/ {clock(14400)}</span>
        </span>
      </div>
      <div class="flex flex-col gap-1.5">
        <span class="text-xs text-muted">Live: the Slider sends the value on each move of a drag, as for a volume</span>
        <div class="flex items-center gap-3">
          <span class="w-20">
            <Slider live label="Demo volume" value={volume} max={100} format={(n) => `${n} %`} onSeek={setVolume} />
          </span>
          <span class="text-sm text-muted tabular-nums">{volume} %</span>
        </div>
      </div>
      <div class="flex flex-col gap-1.5">
        <span class="text-xs text-muted">All reached</span>
        <Slider label="Demo all reached" value={3600} max={14400} step={60} format={clock} onSeek={() => {}} />
      </div>
      <div class="flex flex-col gap-1.5">
        <span class="text-xs text-muted">Disabled</span>
        <Slider label="Demo disabled" value={7200} max={14400} reached={9000} disabled onSeek={() => {}} />
      </div>
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

function SignedBarDemo() {
  const [weights, setWeights] = useState([1, 0.62, 0.05, 0, -0.4, -1, 1.6]);
  const names = ["1 (the end)", "0.62", "0.05", "0", "−0.40", "−1 (the end)", "1.6 (stops at 1)"];
  return (
    <div class="flex max-w-[520px] flex-col gap-3">
      {weights.map((weight, i) => (
        <div key={names[i]} class="grid grid-cols-[16ch_1fr_6ch] items-center gap-3 text-xs">
          <span class="text-muted">{names[i]}</span>
          <SignedBar value={weight} />
          <span class="text-right tabular-nums">{weight.toFixed(2)}</span>
        </div>
      ))}
      <div class="grid grid-cols-[16ch_1fr_6ch] items-center gap-3 text-xs">
        <span class="text-muted">tone info, max 50</span>
        <SignedBar value={-20} max={50} tone="info" />
        <span class="text-right tabular-nums">−20</span>
      </div>
      <div class="flex gap-2">
        <Button size="sm" onClick={() => setWeights((all) => all.map((w) => Math.max(-1, Math.min(1, -w * 0.8))))}>
          Mutate
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setWeights([1, 0.62, 0.05, 0, -0.4, -1, 1.6])}>
          Reset
        </Button>
      </div>
    </div>
  );
}

const GENERATIONS: GenerationPoint[] = [
  [64.79, 16.59, true],
  [66.59, 25.86, true],
  [66.37, 33.93, false],
  [70.81, 39.88, true],
  [94.77, 50.71, true],
  [94.77, 49.65, false],
].map(([best, mean, newBest], i) => ({ generation: i + 1, best: best as number, mean: mean as number, newBest: newBest as boolean }));

function GenerationChartDemo() {
  const [points, setPoints] = useState(GENERATIONS);
  const [picked, setPicked] = useState<number | null>(null);
  const add = () =>
    setPoints((all) => {
      const last = all[all.length - 1];
      const best = last.best + (all.length % 3 === 0 ? 6 : 0);
      return [...all, { generation: last.generation + 1, best, mean: Math.min(best, last.mean + 3), newBest: best > last.best }];
    });
  return (
    <div class="flex flex-col gap-5">
      <div class="flex flex-col gap-2">
        <GenerationChart points={points} label="Fitness by Generation" pickText="its Race" onPick={setPicked} />
        <div class="flex items-center gap-2">
          <Button size="sm" onClick={add}>
            Add a Generation
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setPoints(GENERATIONS)}>
            Reset
          </Button>
          <span class="text-xs text-muted">{picked === null ? "A click picks a Generation." : `Picked: Generation ${picked}.`}</span>
        </div>
      </div>
      <div class="grid grid-cols-1 gap-5 sm:grid-cols-3">
        <div>
          <p class="mb-1.5 text-xs text-faint">one Generation: a dot for each line</p>
          <GenerationChart points={GENERATIONS.slice(0, 1)} label="Fitness" />
        </div>
        <div>
          <p class="mb-1.5 text-xs text-faint">negative values: a line at 0</p>
          <GenerationChart points={GENERATIONS.map((p) => ({ ...p, mean: p.mean - 40 }))} label="Fitness" />
        </div>
        <div>
          <p class="mb-1.5 text-xs text-faint">no Generation</p>
          <GenerationChart points={[]} label="Fitness" />
        </div>
      </div>
    </div>
  );
}

function MetricDemo() {
  const [calls, setCalls] = useState(9);
  return (
    <div class="flex flex-col gap-4">
      <div class="grid grid-cols-2 gap-4 sm:grid-cols-4">
        {(
          [
            ["with an icon", <Metric key="icon" tip="Time of the cursor" icon={<Clock size={14} />} value="1:49:42" chars={7} />],
            ["no icon", <Metric key="plain" tip="Money (live)" value="3,434" chars={7} />],
            ["a muted part", <Metric key="muted" tip="Cost / cost limit" icon={<Coins size={14} />} value="0.37 $" chars={7} detail="/ 1.00 $" />],
            [
              "a Pill inside",
              <Metric key="pill" tip="Stuck counter at the cursor">
                <Pill tone="warn">Stuck 4</Pill>
              </Metric>,
            ],
          ] as const
        ).map(([state, metric]) => (
          <div key={state}>
            <p class="mb-1.5 text-xs text-faint">{state}</p>
            {metric}
          </div>
        ))}
      </div>
      <div class="flex items-center gap-3">
        <Metric tip="The Model call at the cursor / all the Model calls" icon={<MessageSquare size={14} />} value={calls} chars={4} detail={`/ ${calls * 4}`} detailChars={6} />
        <Button size="sm" onClick={() => setCalls((n) => n * 3 + 1)}>
          More calls
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setCalls(9)}>
          Reset
        </Button>
      </div>
    </div>
  );
}

function StatTileDemo() {
  return (
    <div class="flex flex-col gap-4">
      <p class="text-xs text-faint">lg: a value at the cursor, with a detail line (always there, so the tiles of a row have the same height). A tone with no icon colors the value; with an icon, it colors the icon.</p>
      <div class="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <StatTile size="lg" label="Cost" value="0.24 $" detail="limit 1.00 $" />
        <StatTile size="lg" label="Stuck counter" value={29} tone="bad" />
        <StatTile size="lg" label="Heals" value={3} total={33} icon={Heart} tone="ok" />
        <StatTile size="lg" label="Prompt tokens" value="4,866 and a long value that does not fit" />
      </div>
      <p class="text-xs text-faint">md: a count with its icon in its tone, and the total of the whole Run, or a detail.</p>
      <div class="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <StatTile size="md" label="Heals" value={3} total={33} icon={Heart} tone="ok" />
        <StatTile size="md" label="Money spent" value="1,900 ₽" icon={Coins} tone="warn" detail="2 purchases" />
        <StatTile size="md" label="Tone, no icon" value={10} tone="accent" />
        <StatTile size="md" label="A long value" value="1,234,567,890 ₽ and more" icon={Swords} />
      </div>
      <p class="text-xs text-faint">sm: no card, for a row of facts in a card; the total and the detail follow the value.</p>
      <div class="grid w-[520px] max-w-full grid-cols-5 gap-3">
        <StatTile size="sm" label="Time" value="12:04" icon={Clock} />
        <StatTile size="sm" label="Faints" value={2} total={5} icon={Skull} tone="bad" />
        <StatTile size="sm" label="₽ now" value="3,434" icon={Coins} tone="warn" detail={<span class="text-ok">+180</span>} />
        <StatTile size="sm" label="No icon" value="–" />
        <StatTile size="sm" label="Long" value="1,234,567,890 ₽" />
      </div>
    </div>
  );
}

function TypeChipDemo() {
  return (
    <div class="flex flex-col gap-4">
      <div class="grid grid-cols-3 gap-x-4 gap-y-2 sm:grid-cols-6">
        {TYPES.map((type) => (
          <span key={type} class="flex flex-col items-start gap-0.5">
            <TypeChip type={type} />
            <span class="font-mono text-[11px] text-faint">{typeToken(type)}</span>
          </span>
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

function PillDemo() {
  return (
    <div class="flex flex-wrap gap-2">
      <Pill>walk</Pill>
      <Pill tone="ok">done</Pill>
      <Pill tone="info">interrupted</Pill>
      <Pill tone="warn">blocked</Pill>
      <Pill tone="bad">impossible</Pill>
      <Pill tone="accent">Review turn</Pill>
      <Pill>717 calls</Pill>
      <span class="flex w-40">
        <Pill tone="warn">ended: the text is too long for the box</Pill>
      </span>
    </div>
  );
}

function ColorDemo() {
  return (
    <div class="grid grid-cols-2 gap-3 sm:grid-cols-6">
      {colorTokens().map((token) => (
        <Swatch key={token} token={token} />
      ))}
    </div>
  );
}

const DEMO_PATH = ["What the model sees", "#1-128", "#65-128", "#97-128"];

function BreadcrumbDemo() {
  const [at, setAt] = useState(2);
  return (
    <div class="flex flex-col gap-3">
      <Breadcrumb steps={DEMO_PATH.slice(0, at + 1)} onPick={setAt} />
      <p class="text-xs text-faint">The root only:</p>
      <Breadcrumb steps={DEMO_PATH.slice(0, 1)} onPick={() => {}} />
      <div>
        <Button size="sm" disabled={at === DEMO_PATH.length - 1} onClick={() => setAt(at + 1)}>
          One step down
        </Button>
      </div>
    </div>
  );
}

function FilterChipDemo() {
  const [on, setOn] = useState<Set<string>>(new Set(["review"]));
  const toggle = (id: string) => setOn(toggled(on, id));
  return (
    <div class="flex flex-col gap-3">
      <div class="flex flex-wrap items-center gap-1.5">
        <FilterChip icon={<ClipboardCheck size={13} />} tone="accent" label="Review" count={26} on={on.has("review")} onToggle={() => toggle("review")} />
        <FilterChip icon={<Ban size={13} />} tone="bad" label="Impossible" count={44} on={on.has("impossible")} onToggle={() => toggle("impossible")} />
        <FilterChip icon={<Brain size={13} />} tone="warn" label="Reflection" count={0} on={on.has("reflection")} onToggle={() => toggle("reflection")} />
      </div>
      <p class="text-xs text-faint">With the label hidden: the Tooltip gives it.</p>
      <div class="flex flex-wrap items-center gap-1.5">
        <FilterChip icon={<ClipboardCheck size={13} />} tone="accent" label="Review" hideLabel count={26} on={on.has("review")} onToggle={() => toggle("review")} />
        <FilterChip icon={<Flame size={13} />} tone="warn" label="Expensive" hideLabel count={74} on={on.has("expensive")} onToggle={() => toggle("expensive")} />
        <FilterChip icon={<Eye size={13} />} label="No tone, no count" hideLabel on={on.has("plain")} onToggle={() => toggle("plain")} />
        <FilterChip icon={<Brain size={13} />} tone="warn" label="Disabled: the Tooltip tells why" hideLabel disabled on={false} onToggle={() => {}} />
      </div>
    </div>
  );
}

const DEMO_ROWS = [
  { index: 19, time: "4:21", text: "goTo 6 12" },
  { index: 20, time: "4:37", text: "fight 1", icons: [<ClipboardCheck key="review" size={13} class="text-accent" />] },
  { index: 21, time: "4:52", text: "unreadable", error: true, icons: [<Ban key="bad" size={13} class="text-bad" />, <Flame key="flame" size={13} class="text-warn" />] },
  { index: 22, time: "5:03", text: "interact 8 4 and a long action that does not fit in the row of the list" },
];

const DEMO_LOOKS = [
  { label: "mark", mark: true, faded: false },
  { label: "faded", mark: false, faded: true },
  { label: "mark and faded", mark: true, faded: true },
];

const DEMO_SWATCHES = OVERLAY_SWATCHES.filter(({ label }) => ["water", "trainer", "inactive trigger", "ledge"].includes(label));

function LegendDemo() {
  return (
    <div class="flex flex-wrap items-start gap-10">
      <div class="w-[200px]">
        <Legend title="One column" items={DEMO_SWATCHES} />
      </div>
      <div class="w-[340px]">
        <Legend title="Two columns, a note" columns={2} items={DEMO_SWATCHES} note="Point at a cell to see its data." />
      </div>
    </div>
  );
}

function KeyListDemo() {
  return (
    <div class="flex flex-wrap items-start gap-10">
      <div class="w-[240px]">
        <KeyList title="One key" rows={[[["Esc"], "back to now"]]} />
      </div>
      <div class="w-[240px]">
        <KeyList
          title="More keys on a row"
          rows={[
            [["←", "↑", "→", "↓"], "move"],
            [["W", "Z"], "B"],
            [["Double-click"], "back to the player"],
          ]}
        />
      </div>
    </div>
  );
}

function ListRowDemo() {
  const [selected, setSelected] = useState(20);
  return (
    <div class="flex w-[360px] max-w-full flex-col gap-px">
      {DEMO_ROWS.map((row) => (
        <ListRow
          key={row.index}
          cells={[
            { text: String(row.index + 1), chars: 4 },
            { text: row.time, chars: 7 },
          ]}
          text={row.text}
          error={row.error}
          icons={row.icons}
          selected={row.index === selected}
          onClick={() => setSelected(row.index)}
        />
      ))}
      <p class="mt-3 mb-1 text-xs text-faint">Mark: a dot before the icons (a pocket with a change). Faded: a row after the cursor. Not selected, then selected.</p>
      {[false, true].map((chosen) =>
        DEMO_LOOKS.map(({ label, mark, faded }) => (
          <ListRow key={`${label}${chosen}`} text={label} mark={mark} faded={faded} icons={<span class="text-faint tabular-nums">3</span>} selected={chosen} onClick={() => {}} />
        )),
      )}
    </div>
  );
}

const DEMO_PROMPT = `Your last decisions, oldest first:
- goTo(6, 4): done. "Oh, okay then!"
- interact 8 4: impossible: nothing at (8, 4) starts a script
- Objective: Leave ViridianCity_PokemonCenter_2F by the stairs, then go to #1-2 with zoom <a-b>.
- Review turn: check the way to the next Milestone, the facts against the Mission, the guesses from the things checked and the people, and the team (levels, HP, status, PP).
{"reason": "The stairs are south.", "action": "go S"}`;

function PromptTextDemo() {
  return (
    <div class="flex flex-col gap-3">
      <p class="text-xs text-faint">Colored (highlight): texts of the game, calls and actions, results, numbers, places, labels. A long line wraps under its own text.</p>
      <PromptText text={DEMO_PROMPT} highlight />
      <p class="text-xs text-faint">Plain.</p>
      <PromptText text={DEMO_PROMPT} />
    </div>
  );
}

function CodeDemo() {
  return (
    <div class="flex max-w-[560px] flex-col gap-3 text-sm text-muted">
      <p>
        <Code>press(button)</Code> one press when no Macro-action fits.
      </p>
      <div class="flex flex-wrap gap-1">
        {["go", "goTo", "swap", "use", "teach", "give", "take", "viewAtlas", "zoom", "press"].map((name) => (
          <Code key={name}>{name}</Code>
        ))}
      </div>
      <span class="flex w-44">
        <Code>withdraw &lt;item&gt; [quantity] in a narrow box</Code>
      </span>
    </div>
  );
}

function TermListDemo() {
  const rows = [
    ["Harness", "runs the emulator to the next Decision point; it decides nothing"],
    ["Decision point", "the game waits for an input: walk, text, choice, battle…"],
    ["Model call", <>the model bot asks its AI model for one action, for example <Code>goTo 20 45</Code></>],
  ] as const;
  return (
    <div class="grid max-w-[880px] gap-6 sm:grid-cols-2">
      <TermList rows={rows} />
      <TermList numbered rows={rows} />
    </div>
  );
}

function NumberBadgeDemo() {
  return (
    <div class="flex flex-col gap-3">
      <div class="flex gap-2">
        {[1, 2, 3, 12].map((n) => (
          <NumberBadge key={n} n={n} />
        ))}
      </div>
      <div class="flex items-start gap-2.5 text-sm">
        <NumberBadge n={4} />
        <span class="pt-0.5">
          <b class="font-semibold">Rail</b> <span class="text-muted">Whole map, Model, Stats, Memory tree, Bag and PC</span>
        </span>
      </div>
    </div>
  );
}

type Category = "base" | "controls" | "data" | "surfaces" | "lab";

const CATEGORIES: { id: Category; label: string }[] = [
  { id: "base", label: "Base" },
  { id: "controls", label: "Controls" },
  { id: "data", label: "Data" },
  { id: "surfaces", label: "Surfaces" },
  { id: "lab", label: "Lab" },
];

type Entry = { category: Category; title: string; rule: string; demo: () => ComponentChildren };

const ENTRIES: Entry[] = [
  { category: "base", title: "Type", rule: "Raleway for text, JetBrains Mono for prompts, frames and code. Numbers are tabular.", demo: () => <TypeDemo /> },
  { category: "base", title: "Color", rule: "All the color tokens. One accent. Green, amber and red only for a state: ok, warning, problem.", demo: () => <ColorDemo /> },
  {
    category: "base",
    title: "Type colors and TypeChip",
    rule: "One color token for each type of the game; the token of ??? is type-mystery. TypeChip: the name of a type on its color, with white text on a dark color.",
    demo: () => <TypeChipDemo />,
  },
  { category: "controls", title: "Button", rule: "Press: a small scale. Focus: a ring. One primary button for each area.", demo: () => <ButtonDemo /> },
  { category: "controls", title: "Field", rule: "Focus: the border and a soft ring. An error has a red border and a short text under it.", demo: () => <FieldDemo /> },
  {
    category: "controls",
    title: "Select",
    rule: "All the dropdowns of the Viewer. A click or Enter opens the list. Arrows, Home, End and a letter move in it, Enter or a click chooses, Esc closes. Options can have groups. An option can be disabled, with its reason beside its label: a person cannot choose it. With searchable, a field at the top of the list takes the focus at each opening and filters the options on a part of their label, with no case, and “_” and spaces do not count; the arrows move, Enter chooses, Esc or a click outside closes.",
    demo: () => <SelectDemo />,
  },
  {
    category: "controls",
    title: "Tabs",
    rule: "The indicator slides to the selected tab. Line tabs for the navigation, segmented tabs for a choice of values, a rail of icons for the panels of the Lab tab. Disabled: all the tabs, faint, with no pointer.",
    demo: () => <TabsDemo />,
  },
  {
    category: "controls",
    title: "Breadcrumb",
    rule: "The path from the root to the current step, with a chevron between two steps. Each step is a ghost Button; the current step is pressed. A click goes back to a step.",
    demo: () => <BreadcrumbDemo />,
  },
  {
    category: "controls",
    title: "FilterChip",
    rule: "A filter that a click turns on or off: a colored icon, an optional label and a count. On, it has the accent border of a pressed Button. With the label hidden, a Tooltip gives it. Disabled, it is faint, and its Tooltip tells why.",
    demo: () => <FilterChipDemo />,
  },
  {
    category: "data",
    title: "Pill",
    rule: "A short state or count. The text has the color of the state, or the accent. A Pill keeps one line: a text too long for the box ends with an ellipsis. Put a long text, as a reason, next to the Pill.",
    demo: () => <PillDemo />,
  },
  {
    category: "controls",
    title: "Slider",
    rule: "A native range input, so the game does not take its keys. The accent part is the value, the light part is the reached part. Hover or drag shows the value above the track. The Slider sends the value on release, or on each arrow key; with live, also on each move of a drag. After a drag with the pointer, the focus leaves the Slider, so the arrows go to the game.",
    demo: () => <SliderDemo />,
  },
  { category: "data", title: "Bar and number", rule: "The fill moves, and a light trail follows it when the value falls. HP uses the colors of the game. A number counts to its new value.", demo: () => <BarDemo /> },
  {
    category: "data",
    title: "SignedBar",
    rule: "A value from −1 to 1, as the weight of a Genome, or from −max to max. A centre line marks 0. The fill goes from the line to the right for a positive value and to the left for a negative value, so the sign shows with no color: the tone stays the same. A value out of the range stops at the end. The fill moves.",
    demo: () => <SignedBarDemo />,
  },
  {
    category: "data",
    title: "GenerationChart",
    rule: "A value by Generation of an Evolution: the best value as an accent line on a light accent area, the mean as an info line, and an accent dot at each new best. The header gives the values of the last Generation. A hover moves a line and two points to the nearest Generation, and the header then gives its values. With onPick, a click gives that Generation, and the header tells what the click does. The scale starts at 0, or lower for a negative value. One Generation gives a dot for each line; no Generation gives a short text.",
    demo: () => <GenerationChartDemo />,
  },
  {
    category: "data",
    title: "Bars of the game",
    rule: "The PP of a move in the color of its type. The EXP from the start of the level to the next level. A stat compared with the largest stat of the Pokémon.",
    demo: () => <GameBarDemo />,
  },
  { category: "data", title: "Metric", rule: "A short value of the top bar with an icon and a tooltip. Its number has a fixed width, so it never moves its neighbors.", demo: () => <MetricDemo /> },
  {
    category: "data",
    title: "StatTile",
    rule: "One large value of the stats with its label, in 3 sizes. lg: a value at the cursor in a Card, with a detail line. md: a count in a Card, with its icon and the total of the whole Run. sm: no Card, for a row of facts. The tone colors the icon, or the value when there is no icon. A long value ends with an ellipsis.",
    demo: () => <StatTileDemo />,
  },
  {
    category: "data",
    title: "ListRow",
    rule: "A row of a list that a click selects: cells with a fixed width at the left, a main text in mono, optional icons at the right. Selected: the accent border all around. An error text is red. A mark is an accent dot before the icons; a faded row is at 45 % opacity.",
    demo: () => <ListRowDemo />,
  },
  {
    category: "data",
    title: "LeaderboardRow",
    rule: "A Run in the Leaderboard of a Race: rank, sprite, Run id, model, state and cost or tokens, then the team and the badges, on a fixed height so that a long list shows only the rows on the screen. The state has a fixed column, as wide as its longest text (“unknown screen”), and the cost also has a fixed column, so a change of state moves no text. A click selects. Selected: the accent border all around. A Run that ended is at 45 % opacity.",
    demo: () => <LeaderboardRowDemo />,
  },
  {
    category: "data",
    title: "ModelName",
    rule: "The model of a Run in small muted text, with a round dot of 8 px and a black border: blue for DeepSeek, orange for Claude, light grey for GPT, black for Grok. A model of another family has no dot, because grey means GPT. A Run of the Genetic bot has no model: the text is “Genetic bot” and its version, with a purple dot. Short: the id with no prefix. A text that is too long is cut, and the dot stays. No id and no Genetic bot: nothing.",
    demo: () => <ModelNameDemo />,
  },
  { category: "data", title: "MonIcon", rule: "The icon of a Pokémon in 24 px, sharp, with its level in a corner when it has one. A Pokémon with no icon keeps its place.", demo: () => <MonIconDemo /> },
  {
    category: "data",
    title: "PromptText",
    rule: "A text of a prompt in mono on a small Card. With highlight, its parts take the colors of the theme, line by line, as in a code editor.",
    demo: () => <PromptTextDemo />,
  },
  {
    category: "data",
    title: "Legend",
    rule: "The colors of a drawing: a title, a 10 px swatch with the CSS of each mark and its label, on 1 or 2 columns, and an optional note. A glyph can replace the swatch.",
    demo: () => <LegendDemo />,
  },
  { category: "data", title: "KeyList", rule: "The keys or the mouse actions of a part, and what each one does: one or more keys on a row.", demo: () => <KeyListDemo /> },
  { category: "data", title: "Badges", rule: "The 8 badges of the player as dots. A new badge shines.", demo: () => <BadgesDemo /> },
  { category: "data", title: "Code", rule: "A token of code in a line of text: mono, in the accent, on a raised background. A long token breaks inside the box.", demo: () => <CodeDemo /> },
  {
    category: "data",
    title: "TermList",
    rule: "Short facts: a term in the text color, then its text in the muted color; a long text continues under the term. Numbered: a faint number before each term, for steps in order.",
    demo: () => <TermListDemo />,
  },
  { category: "data", title: "NumberBadge", rule: "A round accent badge with a number: a spot on a screenshot, and the same number in its list.", demo: () => <NumberBadgeDemo /> },
  {
    category: "surfaces",
    title: "Card",
    rule: "The base of each panel. On hover, its border takes the accent. An interactive card (it opens something) also takes the accent on its background. With onClick, the card is a button. Size sm for a compact view. With fill, the card takes the height that its flex column gives, and a long list scrolls inside it. With glass, it is a dark glass over a picture, such as the map of a Race.",
    demo: () => <CardDemo />,
  },
  {
    category: "surfaces",
    title: "InfoCard",
    rule: "A small Card for one subject: a title with an optional icon, bullets in the muted color, and Code chips at the bottom. A tone (ok, warn, bad) colors the title and its icon. In a grid, the cards of a row have the same height, and the chips stay at the bottom.",
    demo: () => <InfoCardDemo />,
  },
  {
    category: "surfaces",
    title: "Tooltip",
    rule: "A short text on hover or keyboard focus, in the top layer: a panel that scrolls does not cut it. A wide tooltip can have more than one line. When a click changes its text, the tooltip shows again under the pointer. Tip has the same look and follows the pointer over a track or a chart; near an end, it stays inside the box.",
    demo: () => <TooltipDemo />,
  },
  {
    category: "surfaces",
    title: "Collapsible",
    rule: "A title line that opens and closes its body: a chevron that turns, an optional icon and an optional detail at the right. A long detail ends with an ellipsis before the title does. The panel keeps its state.",
    demo: () => <CollapsibleDemo />,
  },
  {
    category: "surfaces",
    title: "Cover",
    rule: "Covers one zone while it waits, never the whole page, and not a popup: a Card with the progress over a blur. It comes after 250 ms, with a fade, so a short wait shows nothing. The zone gets aria-busy, the text is a status.",
    demo: () => <CoverDemo />,
  },
  {
    category: "surfaces",
    title: "HoverCard",
    rule: "A card that opens after a short hover, or at the keyboard focus, next to its trigger. With control, its child (a Button) is the trigger: the wrapper adds no role and no tab stop.",
    demo: () => <HoverCardDemo />,
  },
  {
    category: "surfaces",
    title: "PointerCard",
    rule: "A card at the pointer for the data of a point of a canvas (a cell of the map). It is in the top layer, 16 px at the right of and under the pointer; near the right or the bottom edge of the window, it goes to the left or above. The pointer goes through it. With glass, it is the glass Card, over a picture such as the map of a Race.",
    demo: () => <PointerCardDemo />,
  },
  { category: "surfaces", title: "Popover", rule: "A panel that a click on its button opens under it. A click outside or Esc closes it.", demo: () => <PopoverDemo /> },
  { category: "surfaces", title: "Toast", rule: "A message at the bottom right, with a border in the color of its tone. It closes after 6 s or with its button; 4 at most.", demo: () => <ToastDemo /> },
  {
    category: "lab",
    title: "Run select",
    rule: "The Select of the top bar: the Run of the Viewer, the Runs of the Bots and the Run records to replay. The Run records of an Evolution have a group for each Evolution, after the other Run records.",
    demo: () => <RunSelectDemo />,
  },
  {
    category: "lab",
    title: "Bots",
    rule: "The form of the button “Bots”: it starts N Runs of a Bot within the free places, from the Starting save or as the continuation of a Run record, with its Model provider and the maximum total cost or tokens, and it stops the shown Run. “Keep the same Run” shows the settings of the record as locked fields, with only the limit to change; it is disabled, with its reason, when a Run plays from the record or another record continues it. A provider that is not ready is disabled, with its reason.",
    demo: () => <BotsDemo />,
  },
  {
    category: "lab",
    title: "Screen controls",
    rule: "The bar under the screen: pause and the speeds, the overlay (its legend on a hover), the sound and its volume, the savestate, the Starting save (a second click writes it) and the keys on a hover.",
    demo: () => <ScreenControlsDemo />,
  },
  {
    category: "lab",
    title: "Timeline",
    rule: "The zone at the bottom of the Lab tab: the Game events of the shown Run as icons on one track, with linear time. The chips choose the kinds. Icons closer than 18 px make one group with the most important icon and a count. A hover shows the events of a group, or the time at the pointer. A click moves the cursor, or jumps a replay; a drag selects a range; Now or Esc goes back to now.",
    demo: () => <TimelineDemo />,
  },
  {
    category: "lab",
    title: "Run record",
    rule: "The card of the HoverCard of the button next to the Run select: the state of the replay, the name of the Run record and its facts. Out of a replay, the button is disabled.",
    demo: () => <RecordCardDemo />,
  },
  {
    category: "lab",
    title: "Grid cell",
    rule: "A cell of the Grid tab: the screen of a Run, its name, the Pills live or replay and its state, the names of its character, its Bot and model, its game time, last Milestone and cost or tokens. The screen takes all the place that the cell gives, and the facts go at its side when the cell is wide. A dim layer shows a wait for the model, a Summary call of the memory or the end. The buttons of a Run that plays show on a hover. A Run record can go in any cell; an ended Run can replay its record or continue it, and an ended live Run can leave the Grid; an empty cell offers the Run records.",
    demo: () => <GridCellDemo />,
  },
  {
    category: "lab",
    title: "Pokémon card",
    rule: "A Pokémon of the party: the name, the level, the status, the HP in the colors of the game, and the PP of each move in the color of its type. A hover opens its summary.",
    demo: () => <PokemonCardDemo />,
  },
  {
    category: "lab",
    title: "Pokémon hover card",
    rule: "The summary on one card: types, HP, ability, nature, held item, stats, EXP and moves. A hover on a move shows its description.",
    demo: () => <PokemonSummaryDemo />,
  },
];

function ComponentsSheet() {
  const [reduced, setReduced] = useState(false);
  const [category, setCategory] = useState<Category>("base");
  return (
    <div data-motion={reduced ? "reduce" : undefined} class="ds min-h-screen">
      <div class="mx-auto max-w-[1080px] px-6 pb-16">
        <header class="flex flex-wrap items-center gap-x-6 gap-y-2 py-3">
          <Tabs items={CATEGORIES} value={category} onChange={setCategory} />
          <span class="min-w-[240px] flex-1 text-xs text-muted">A new part uses these components; a new component needs the agreement of the user, then it goes here.</span>
          <Checkbox on={reduced} onChange={setReduced}>
            <span class="text-muted">Reduced motion</span>
          </Checkbox>
        </header>
        {ENTRIES.filter((entry) => entry.category === category).map((entry) => (
          <Section key={entry.title} title={entry.title} rule={entry.rule}>
            {entry.demo()}
          </Section>
        ))}
      </div>
    </div>
  );
}

export function mountComponentsTab(root: HTMLElement): void {
  render(<ComponentsSheet />, root);
}
