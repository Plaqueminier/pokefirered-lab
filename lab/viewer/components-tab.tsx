import { Copy, Pause, Play, RotateCcw, Search, Square } from "lucide-preact";
import { type ComponentChildren, render } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import { Bar, Button, Card, Checkbox, Field, Input, Num, Pill, Select, Switch, Tabs, Tooltip, hpTone } from "./components";

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
  return [...names];
}

const LABEL = "text-xs font-semibold tracking-[0.08em] text-muted uppercase";

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
  return (
    <div class="flex flex-wrap items-center gap-6">
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
        <Section title="Button" rule="Press: a small scale. Focus: a ring. One primary button for each area.">
          <ButtonDemo />
        </Section>
        <Section title="Field" rule="Focus: the border and a soft ring. An error has a red border and a short text under it.">
          <FieldDemo />
        </Section>
        <Section title="Tabs" rule="The indicator slides to the selected tab.">
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
        <Section title="Card" rule="The base of each panel. A card that opens something takes the accent on hover: its border and its background.">
          <CardDemo />
        </Section>
        <Section title="Tooltip" rule="A short text on hover or on keyboard focus, for an icon or a number.">
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
        </Section>
      </div>
    </div>
  );
}

export function mountComponentsTab(root: HTMLElement): void {
  render(<ComponentsSheet />, root);
}
