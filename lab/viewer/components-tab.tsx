import { Ban, BookOpen, Bot, Brain, ChartColumn, CircleCheck, ClipboardCheck, Clock, Coins, Copy, Eye, Flame, Info, LayoutGrid, ListTree, Map as MapIcon, MessageSquare, OctagonAlert, Pause, Play, Rewind, RotateCcw, Search, Shapes, Square, Trophy } from "lucide-preact";
import { type ComponentChildren, render } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import {
  Badges,
  Bar,
  Button,
  Card,
  Checkbox,
  Collapsible,
  ExpBar,
  FilterChip,
  Field,
  HoverCard,
  Input,
  LABEL,
  ListRow,
  Metric,
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
  toggled,
  type Tone,
  Tooltip,
  TYPES,
  TypeChip,
  hpTone,
  typeToken,
} from "./components";
import { PromptText } from "./prompt-text";
import { BotsDemo, PokemonCardDemo, PokemonSummaryDemo, RECORD, RunSelectDemo } from "./components-tab-lab";

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
  const [reasoning, setReasoning] = useState("low");
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
      </div>
    </div>
  );
}

const RUN_OPTIONS = [
  { value: "viewer", label: "Viewer Run (keyboard)", group: "Viewer Run" },
  { value: "run:3", label: "Run 3 · model · plays", group: "Runs of the Bots" },
  { value: "run:4", label: `Run 4 · model (continues ${RECORD}) · end: cost limit`, group: "Runs of the Bots" },
  { value: `replay:${RECORD}`, label: RECORD, group: "Replay a Run record" },
  { value: "replay:starter-3-2026-10-24T08-13-38.892Z.json", label: "starter-3-2026-10-24T08-13-38.892Z.json", group: "Replay a Run record" },
];

const RECORD_OPTIONS = RUN_OPTIONS.filter((option) => option.value.startsWith("replay:")).map(({ value, label }) => ({ value, label }));

const TYPE_OPTIONS = TYPES.map((type) => ({ value: type, label: type }));

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
    </div>
  );
}

function TabsDemo() {
  const [block, setBlock] = useState<"situation" | "battle" | "rules">("battle");
  const [speed, setSpeed] = useState<"1" | "4" | "max">("4");
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
            { id: "replay", label: "Replay", icon: <Rewind size={16} /> },
          ]}
        />
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

function CardDemo() {
  const [money, setMoney] = useState(3434);
  return (
    <div class="flex flex-col gap-4">
      <p class="text-xs text-faint">Card: it shows data. Put the pointer on it: its border takes the accent.</p>
      <div class="grid gap-4 sm:grid-cols-2">
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
      </div>
      <p class="text-xs text-faint">Interactive card: it opens something. On hover, its background also takes the accent, and the pointer is a hand.</p>
      <div class="grid gap-4 sm:grid-cols-2">
        <Card interactive>
          <p class={`${LABEL} mb-2`}>Review turn, 1:49:42</p>
          <p class="text-sm leading-relaxed">“Bug Catcher Greg is defeated; I'm on Route 3 heading east.”</p>
        </Card>
        <Card interactive size="sm">
          <p class={`${LABEL} mb-1`}>Small, 0:12:05</p>
          <p class="text-sm text-muted">A small interactive card, as the Pokémon card.</p>
        </Card>
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

function PopoverDemo() {
  const body = <p class="w-[260px] text-sm text-muted">The content of the Popover: here, a short text. In the top bar, the form "Bots".</p>;
  return (
    <div class="flex flex-col gap-4">
      <div class="flex flex-wrap items-center gap-3">
        <Popover icon={<Bot size={14} />} label="Bots" title="Start or stop a Bot">
          {body}
        </Popover>
        <span class="flex w-[220px]">
          <Popover label="A long label that does not fit in its button">{body}</Popover>
        </span>
        <Popover label="Disabled" disabled>
          {body}
        </Popover>
      </div>
      <div>
        <p class="mb-1.5 text-xs text-faint">open</p>
        <PopoverBody>{body}</PopoverBody>
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
    </div>
  );
}

function TooltipDemo() {
  return (
    <div class="flex flex-wrap items-center gap-6">
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
        <div class="flex w-[260px] cursor-default justify-between rounded-sm px-2 py-1 text-sm hover:bg-raised">
          <span class="font-semibold">SLEEP POWDER</span>
          <span class="text-muted">1/15</span>
        </div>
      </Tooltip>
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
    </div>
  );
}

const DEMO_PROMPT = `Your last decisions, oldest first:
- goTo(6, 4): done. "Oh, okay then!"
- interact 8 4: impossible: nothing at (8, 4) starts a script
- Objective: Leave ViridianCity_PokemonCenter_2F by the stairs, then go to #1-2 with zoom <a-b>.
- Review turn: check the way to the next Milestone, the facts against the Mission, the guesses from the signs and the people, and the team (levels, HP, status, PP).
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

function CollapsibleDemo() {
  const [open, setOpen] = useState<Record<string, boolean>>({ Situation: true });
  const block = (title: string, icon: ComponentChildren, text: string) => (
    <Collapsible title={title} icon={icon} detail={`${text.split("\n").length} lines`} open={!!open[title]} onToggle={() => setOpen({ ...open, [title]: !open[title] })}>
      <PromptText text={text} highlight />
    </Collapsible>
  );
  return (
    <div class="flex max-w-[560px] flex-col gap-1">
      {block("Situation", <Eye size={13} />, "The game waits for a walk on Route1 (12, 30).\nThe player faces north.")}
      {block("Rules", <BookOpen size={13} />, "You play Pokémon FireRed.\nAnswer with JSON only.\n- action: one action of the list.")}
      <Collapsible title="No icon, no detail" open={!!open.plain} onToggle={() => setOpen({ ...open, plain: !open.plain })}>
        <p class="px-2 text-sm text-muted">Any content.</p>
      </Collapsible>
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
    rule: "All the dropdowns of the Viewer. A click or Enter opens the list. Arrows, Home, End and a letter move in it, Enter or a click chooses, Esc closes. Options can have groups.",
    demo: () => <SelectDemo />,
  },
  {
    category: "controls",
    title: "Tabs",
    rule: "The indicator slides to the selected tab. Line tabs for the navigation, segmented tabs for a choice of values, a rail of icons for the panels of the Lab tab.",
    demo: () => <TabsDemo />,
  },
  {
    category: "controls",
    title: "FilterChip",
    rule: "A filter that a click turns on or off: a colored icon, an optional label and a count. On, it has the accent border of a pressed Button. With the label hidden, a Tooltip gives it.",
    demo: () => <FilterChipDemo />,
  },
  { category: "data", title: "Pill", rule: "A short state or count. The text has the color of the state, or the accent.", demo: () => <PillDemo /> },
  { category: "data", title: "Bar and number", rule: "The fill moves, and a light trail follows it when the value falls. HP uses the colors of the game. A number counts to its new value.", demo: () => <BarDemo /> },
  {
    category: "data",
    title: "Bars of the game",
    rule: "The PP of a move in the color of its type. The EXP from the start of the level to the next level. A stat compared with the largest stat of the Pokémon.",
    demo: () => <GameBarDemo />,
  },
  { category: "data", title: "Metric", rule: "A short value of the top bar with an icon and a tooltip. Its number has a fixed width, so it never moves its neighbors.", demo: () => <MetricDemo /> },
  {
    category: "data",
    title: "ListRow",
    rule: "A row of a list that a click selects: cells with a fixed width at the left, a main text in mono, optional icons at the right. Selected: the accent border all around. An error text is red.",
    demo: () => <ListRowDemo />,
  },
  {
    category: "data",
    title: "PromptText",
    rule: "A text of a prompt in mono on a small Card. With highlight, its parts take the colors of the theme, line by line, as in a code editor.",
    demo: () => <PromptTextDemo />,
  },
  { category: "data", title: "Badges", rule: "The 8 badges of the player as dots. A new badge shines.", demo: () => <BadgesDemo /> },
  {
    category: "surfaces",
    title: "Card",
    rule: "The base of each panel. On hover, its border takes the accent. An interactive card (it opens something) also takes the accent on its background. Size sm for a compact view.",
    demo: () => <CardDemo />,
  },
  {
    category: "surfaces",
    title: "Tooltip",
    rule: "A short text on hover or keyboard focus, in the top layer: a panel that scrolls does not cut it. A wide tooltip can have more than one line.",
    demo: () => <TooltipDemo />,
  },
  {
    category: "surfaces",
    title: "Collapsible",
    rule: "A title line that opens and closes its body: a chevron that turns, an optional icon and an optional detail at the right. The panel keeps its state.",
    demo: () => <CollapsibleDemo />,
  },
  { category: "surfaces", title: "HoverCard", rule: "A card that opens after a short hover, or at the keyboard focus, next to its trigger.", demo: () => <HoverCardDemo /> },
  { category: "surfaces", title: "Popover", rule: "A panel that a click on its button opens under it. A click outside or Esc closes it.", demo: () => <PopoverDemo /> },
  { category: "surfaces", title: "Toast", rule: "A message at the bottom right, with a border in the color of its tone. It closes after 6 s or with its button; 4 at most.", demo: () => <ToastDemo /> },
  {
    category: "lab",
    title: "Run select",
    rule: "The Select of the top bar: the Run of the Viewer, the Runs of the Bots and the Run records to replay.",
    demo: () => <RunSelectDemo />,
  },
  {
    category: "lab",
    title: "Bots",
    rule: "The form of the button “Bots”: it starts a Bot, from the Starting save or as the continuation of a Run record, and it stops the shown Run.",
    demo: () => <BotsDemo />,
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
