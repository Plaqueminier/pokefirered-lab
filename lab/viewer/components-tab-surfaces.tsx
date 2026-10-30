import { BookOpen, Bot, CircleCheck, CircleHelp, Copy, Eye, Info, OctagonAlert, Rewind, Trophy } from "lucide-preact";
import type { ComponentChildren } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import { Button, Card, Collapsible, Cover, LABEL, Num, Pill, Tabs, Tip, type Tone, Tooltip, useWidth } from "./components";
import { HoverCard, Popover, PopoverBody, Toast, Toaster } from "./components-layers";
import { PromptText } from "./prompt-text";
import { clock } from "./stats-format";

const COVER_FRAMES = 36000;

const COVER_STATES = [
  { id: "progress", label: "With a progress" },
  { id: "plain", label: "No detail" },
  { id: "toggle", label: "Show and hide" },
] as const;

export function CoverDemo() {
  const [state, setState] = useState<(typeof COVER_STATES)[number]["id"]>("progress");
  const [done, setDone] = useState(0);
  const [busy, setBusy] = useState(true);
  useEffect(() => {
    const timer = setInterval(() => setDone((n) => (n + 600) % COVER_FRAMES), 150);
    return () => clearInterval(timer);
  }, []);
  const zone = <div class="grid h-[160px] place-items-center rounded-card border border-line bg-raised text-sm text-faint">The zone that waits</div>;
  return (
    <div class="flex max-w-[520px] flex-col gap-3">
      <Tabs kind="segmented" items={[...COVER_STATES]} value={state} onChange={setState} />
      {state === "progress" && (
        <Cover
          busy
          icon={<Rewind size={16} />}
          title={`Jump to ${clock(COVER_FRAMES)}`}
          value={done}
          max={COVER_FRAMES}
          detail={`${(COVER_FRAMES - done).toLocaleString("en-US")} frames to play from 0:00`}
        >
          {zone}
        </Cover>
      )}
      {state === "plain" && (
        <Cover busy title="Loading the record" value={2} max={5}>
          {zone}
        </Cover>
      )}
      {state === "toggle" && (
        <>
          <div class="flex items-center gap-3">
            <Button onClick={() => setBusy(!busy)}>{busy ? "End the wait" : "Start a wait"}</Button>
            <span class="text-xs text-muted">The cover comes 250 ms after the start of a wait, with a fade.</span>
          </div>
          <Cover busy={busy} icon={<Rewind size={16} />} title="Jump to 10:00" value={done} max={COVER_FRAMES}>
            {zone}
          </Cover>
        </>
      )}
    </div>
  );
}

export function CardDemo() {
  const [money, setMoney] = useState(3434);
  const [clicks, setClicks] = useState(0);
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
      <p class="text-xs text-faint">Clickable card: with onClick, the card is a button. Tab focuses it (a ring), Enter or a click presses it.</p>
      <div class="grid gap-4 sm:grid-cols-2">
        <Card size="sm" onClick={() => setClicks((n) => n + 1)}>
          <p class={`${LABEL} mb-1`}>Node #1-128 · 128 notes</p>
          <p class="text-sm text-muted">Pressed {clicks} times.</p>
        </Card>
      </div>
    </div>
  );
}

export function HoverCardDemo() {
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
      <div class="flex flex-col gap-1.5">
        <span class="text-xs text-muted">On a control: the Button is the trigger, with no second tab stop</span>
        <HoverCard control card={<p class="w-[220px] text-sm">The keys of the game, or the legend of the overlay.</p>}>
          <Button size="icon" variant="ghost" aria-label="Keys">
            <CircleHelp size={16} />
          </Button>
        </HoverCard>
      </div>
      <PopoverBody>
        <p class="text-sm">The card when it is open.</p>
      </PopoverBody>
    </div>
  );
}

export function PopoverDemo() {
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

export function ToastDemo() {
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

export function TooltipDemo() {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(timer);
  }, [copied]);
  return (
    <div class="flex flex-wrap items-center gap-6">
      <div class="flex items-center gap-3 text-sm">
        <Tooltip text="frame 393,168">
          <span class="cursor-default underline decoration-faint decoration-dotted underline-offset-4">1:49:42</span>
        </Tooltip>
        <Tooltip text={copied ? "Copied" : "Copy the prompt (a click changes this text)"}>
          <Button size="icon" aria-label="Copy the prompt" onClick={() => setCopied(true)}>
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
      <PointerTipDemo />
    </div>
  );
}

const DEMO_FRAMES = 4 * 60 * 60 * 60;

// Tip: the tip of a track or a chart (the Timeline, the Stats panel), at the pointer; near an end, it stays inside the box.
function PointerTipDemo() {
  const [ref, width] = useWidth();
  const [x, setX] = useState<number | null>(null);
  return (
    <div
      ref={ref}
      class="relative mt-6 h-8 w-[320px] max-w-full cursor-crosshair rounded-sm bg-track"
      onPointerMove={(event) => setX(event.clientX - event.currentTarget.getBoundingClientRect().left)}
      onPointerLeave={() => setX(null)}
    >
      <span class="absolute inset-0 grid place-items-center text-xs text-faint">Tip: move the pointer here</span>
      {x !== null && (
        <Tip x={x} width={width}>
          {clock((x / Math.max(1, width)) * DEMO_FRAMES)}
        </Tip>
      )}
    </div>
  );
}

export function CollapsibleDemo() {
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
      <Collapsible title="A long detail" detail="425 calls · 631 played actions · 10 unreadable · 86 Summary calls · 91 notes · 8 Reflection turns" open={!!open.long} onToggle={() => setOpen({ ...open, long: !open.long })}>
        <p class="px-2 text-sm text-muted">The detail ends with an ellipsis before the title does.</p>
      </Collapsible>
    </div>
  );
}
