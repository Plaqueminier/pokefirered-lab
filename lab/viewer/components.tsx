import { ChevronDown, X } from "lucide-preact";
import type { ButtonHTMLAttributes, ComponentChildren, InputHTMLAttributes, SelectHTMLAttributes } from "preact";
import { useEffect, useId, useLayoutEffect, useRef, useState } from "preact/hooks";

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";

const BUTTON_VARIANTS: Record<ButtonVariant, string> = {
  primary: "bg-accent text-accent-fg border-transparent hover:bg-accent-hover",
  secondary: "bg-raised text-fg border-line hover:border-line-strong hover:bg-raised-hover",
  ghost: "bg-transparent text-muted border-transparent hover:bg-raised hover:text-fg",
  danger: "bg-transparent text-bad border-bad/35 hover:bg-bad/10",
};

const PRESSED = "bg-raised text-accent border-accent";

const BUTTON_SIZES = { md: "h-8 px-3 rounded-ctl text-sm", sm: "h-6.5 px-2.5 rounded-ctl text-xs", icon: "size-8 justify-center rounded-ctl" };

type ButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "size" | "class"> & {
  variant?: ButtonVariant;
  size?: keyof typeof BUTTON_SIZES;
  pressed?: boolean;
  loading?: boolean;
};

export function Button({ variant = "secondary", size = "md", pressed, loading, disabled, children, ...rest }: ButtonProps) {
  return (
    <button
      {...rest}
      aria-pressed={pressed}
      disabled={disabled || loading}
      class={`inline-flex items-center gap-1.5 border font-semibold whitespace-nowrap transition-[background-color,border-color,color,scale,box-shadow] duration-150 ease-out active:scale-97 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-accent/35 disabled:pointer-events-none disabled:opacity-40 ${pressed ? PRESSED : BUTTON_VARIANTS[variant]} ${BUTTON_SIZES[size]}`}
    >
      {loading && <Spinner />}
      {children}
    </button>
  );
}

function Spinner() {
  return <span class="inline-block size-3.5 animate-spin rounded-full border-2 border-current border-r-transparent" />;
}

const FIELD =
  "h-8 w-full rounded-ctl border bg-field px-2.5 text-sm font-medium text-fg outline-none transition-[border-color,box-shadow] duration-150 placeholder:text-faint hover:border-line-strong";

function fieldState(invalid: boolean | undefined): string {
  return invalid ? "border-bad focus:ring-3 focus:ring-bad/20" : "border-line focus:border-accent focus:ring-3 focus:ring-accent/20";
}

type InputProps = InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean; icon?: ComponentChildren; unit?: string };

export function Input({ invalid, icon, unit, ...rest }: InputProps) {
  return (
    <span class="relative block">
      {icon && <span class="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-faint">{icon}</span>}
      <input {...rest} aria-invalid={invalid} class={`${FIELD} ${fieldState(invalid)} ${icon ? "pl-8" : ""} ${unit ? "pr-7" : ""}`} />
      {unit && <span class="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-sm text-faint">{unit}</span>}
    </span>
  );
}

export function Select({ children, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <span class="relative block">
      <select {...rest} class={`${FIELD} ${fieldState(false)} appearance-none pr-7`}>
        {children}
      </select>
      <span class="pointer-events-none absolute top-1/2 right-3 size-1.5 -translate-y-3/4 rotate-45 border-r-[1.5px] border-b-[1.5px] border-muted" />
    </span>
  );
}

export function Field({ label, hint, error, children }: { label: string; hint?: string; error?: string; children: ComponentChildren }) {
  return (
    // biome-ignore lint/a11y/noLabelWithoutControl: the control comes in the children.
    <label class="block">
      <span class="mb-1.5 block text-xs font-semibold text-muted">{label}</span>
      {children}
      {(error ?? hint) && <span class={`mt-1.5 block text-xs ${error ? "text-bad" : "text-faint"}`}>{error ?? hint}</span>}
    </label>
  );
}

export function Switch({ on, onChange, children }: { on: boolean; onChange: (on: boolean) => void; children: ComponentChildren }) {
  return (
    <label class="inline-flex cursor-pointer items-center gap-2 text-sm select-none">
      <input type="checkbox" role="switch" aria-checked={on} class="peer sr-only" checked={on} onChange={(e) => onChange(e.currentTarget.checked)} />
      <span class="relative h-5 w-9 rounded-full border border-line bg-track transition-colors duration-200 peer-checked:border-transparent peer-checked:bg-accent peer-focus-visible:ring-3 peer-focus-visible:ring-accent/35 peer-checked:*:translate-x-4">
        <span class="absolute top-0.5 left-0.5 size-3.5 rounded-full bg-white shadow transition-transform duration-300 ease-spring" />
      </span>
      {children}
    </label>
  );
}

export function Checkbox({ on, onChange, children }: { on: boolean; onChange: (on: boolean) => void; children: ComponentChildren }) {
  return (
    <label class="inline-flex cursor-pointer items-center gap-2 text-sm select-none">
      <input type="checkbox" class="peer sr-only" checked={on} onChange={(e) => onChange(e.currentTarget.checked)} />
      <span class="grid size-4 place-items-center rounded-sm border border-line-strong transition-colors peer-checked:border-accent peer-checked:bg-accent peer-focus-visible:ring-3 peer-focus-visible:ring-accent/35 peer-checked:[&_path]:[stroke-dashoffset:0]">
        <svg viewBox="0 0 12 12" width="10" height="10" fill="none" stroke="var(--color-accent-fg)" stroke-width="2" aria-hidden="true">
          <path d="M2.5 6.2 5 8.5l4.5-5" stroke-dasharray="12" stroke-dashoffset="12" class="transition-[stroke-dashoffset] duration-200 ease-out" />
        </svg>
      </span>
      {children}
    </label>
  );
}

type TabItem<T extends string> = { id: T; label: string; icon?: ComponentChildren };

type TabKind = "line" | "segmented" | "rail";

const TAB_LISTS: Record<TabKind, string> = {
  line: "inline-flex gap-1",
  segmented: "inline-flex rounded-ctl border border-line bg-field p-0.75",
  rail: "flex gap-1 min-[900px]:flex-col",
};

const TAB_INDICATORS: Record<TabKind, string> = {
  line: "-bottom-px h-0.5 rounded-full bg-accent",
  segmented: "inset-y-0.75 rounded-sm border border-line bg-raised",
  rail: "rounded-ctl border border-accent bg-raised",
};

const TAB_BUTTONS: Record<TabKind, string> = {
  line: "h-9 px-3",
  segmented: "h-6.5 px-3",
  rail: "size-8 justify-center rounded-ctl",
};

type Box = { left: number; top: number; width: number; height: number };

// A rail is vertical from 900 px wide, and horizontal under it: its tabs show only their icon, with the label in a tooltip.
export function Tabs<T extends string>({ items, value, onChange, kind = "line" }: { items: TabItem<T>[]; value: T; onChange: (id: T) => void; kind?: TabKind }) {
  const ref = useRef<HTMLDivElement>(null);
  const [indicator, setIndicator] = useState<Box | null>(null);
  const index = items.findIndex((item) => item.id === value);
  useLayoutEffect(() => {
    const root = ref.current;
    if (!root) return;
    let live = true;
    // From the boxes on the screen: in a rail, the tooltip of each tab is the offset parent of the tab.
    const place = () => {
      const tab = root.querySelectorAll<HTMLElement>('[role="tab"]')[index];
      if (!live || !tab) return;
      const from = root.getBoundingClientRect();
      const box = tab.getBoundingClientRect();
      setIndicator({ left: box.left - from.left - root.clientLeft, top: box.top - from.top - root.clientTop, width: box.width, height: box.height });
    };
    place();
    void document.fonts.ready.then(place);
    const observer = new ResizeObserver(place);
    observer.observe(root);
    return () => {
      live = false;
      observer.disconnect();
    };
  }, [index]);
  const rail = kind === "rail";
  return (
    <div ref={ref} role="tablist" class={`relative ${TAB_LISTS[kind]}`}>
      {indicator && (
        <span
          class={`absolute transition-[left,top,width,height] duration-300 ease-out ${TAB_INDICATORS[kind]}`}
          style={rail ? { left: `${indicator.left}px`, top: `${indicator.top}px`, width: `${indicator.width}px`, height: `${indicator.height}px` } : { left: `${indicator.left}px`, width: `${indicator.width}px` }}
        />
      )}
      {items.map((item) => {
        const selected = item.id === value;
        const tab = (
          <button
            key={item.id}
            role="tab"
            aria-selected={selected}
            aria-label={rail ? item.label : undefined}
            onClick={() => onChange(item.id)}
            class={`relative z-1 inline-flex items-center gap-1.5 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-accent/35 ${TAB_BUTTONS[kind]} ${selected ? (rail ? "text-accent" : "text-fg") : "text-muted hover:text-fg"}`}
          >
            {item.icon}
            {!rail && item.label}
          </button>
        );
        return rail ? (
          <Tooltip key={item.id} text={item.label}>
            {tab}
          </Tooltip>
        ) : (
          tab
        );
      })}
    </div>
  );
}

export type Tone = "ok" | "warn" | "bad" | "info" | "accent";

const TONES: Record<Tone, { text: string; fill: string }> = {
  ok: { text: "text-ok", fill: "bg-ok" },
  warn: { text: "text-warn", fill: "bg-warn" },
  bad: { text: "text-bad", fill: "bg-bad" },
  info: { text: "text-info", fill: "bg-info" },
  accent: { text: "text-accent", fill: "bg-accent" },
};

export function Pill({ tone, children }: { tone?: Tone; children: ComponentChildren }) {
  return (
    <span class={`inline-flex h-5 items-center gap-1.5 rounded-full bg-raised px-2 text-xs font-semibold ${tone ? TONES[tone].text : "text-muted"}`}>
      {children}
    </span>
  );
}

// The HP bar colors of the game.
export function hpTone(ratio: number): Tone {
  return ratio > 0.5 ? "ok" : ratio > 0.2 ? "warn" : "bad";
}

export const TYPES = ["NORMAL", "FIGHT", "FLYING", "POISON", "GROUND", "ROCK", "BUG", "GHOST", "STEEL", "???", "FIRE", "WATER", "GRASS", "ELECTR", "PSYCHC", "ICE", "DRAGON", "DARK"];

const DARK_TYPES = new Set(["FIGHT", "POISON", "GHOST", "DRAGON", "DARK"]);

export function typeToken(type: string): string {
  return `type-${TYPES.includes(type) && type !== "???" ? type.toLowerCase() : "mystery"}`;
}

export function TypeChip({ type }: { type: string }) {
  return (
    <span
      class={`inline-flex h-5 items-center rounded-sm px-1.5 text-xs font-bold tracking-wide whitespace-nowrap ${DARK_TYPES.has(type) ? "text-white" : "text-bg"}`}
      style={{ background: `var(--color-${typeToken(type)})` }}
    >
      {type}
    </span>
  );
}

export function Bar({ value, max, tone = "accent", type }: { value: number; max: number; tone?: Tone; type?: string }) {
  const width = `${max > 0 ? Math.max(0, Math.min(1, value / max)) * 100 : 0}%`;
  return (
    <div class="relative h-1.5 overflow-hidden rounded-full bg-track">
      <span class="absolute inset-y-0 left-0 rounded-full bg-trail transition-[width] delay-300 duration-500 ease-out" style={{ width }} />
      <span
        class={`absolute inset-y-0 left-0 rounded-full transition-[width,background-color] duration-300 ease-out ${type ? "" : TONES[tone].fill}`}
        style={{ width, background: type ? `var(--color-${typeToken(type)})` : undefined }}
      />
    </div>
  );
}

export function ExpBar({ level, exp, levelExp, expToNextLevel }: { level: number; exp: number; levelExp: number; expToNextLevel: number }) {
  const last = expToNextLevel === 0;
  return (
    <div>
      <div class="mb-1 flex justify-between text-xs">
        <span class="font-semibold text-muted">EXP</span>
        <span class="text-muted">{last ? "Max level" : `${expToNextLevel.toLocaleString("en-US")} to Lv. ${level + 1}`}</span>
      </div>
      <Bar value={last ? 0 : exp - levelExp} max={last ? 0 : exp - levelExp + expToNextLevel} tone="info" />
    </div>
  );
}

export function StatBar({ label, value, max }: { label: string; value: number; max: number }) {
  return (
    <div class="grid grid-cols-[52px_1fr_32px] items-center gap-2 text-xs">
      <span class="text-muted">{label}</span>
      <Bar value={value} max={max} />
      <span class="text-right font-semibold">{value}</span>
    </div>
  );
}

function motionOff(element: Element | null): boolean {
  return !!element?.closest('[data-motion="reduce"]') || matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function Num({ value, format = (n) => Math.round(n).toLocaleString("en-US") }: { value: number; format?: (n: number) => string }) {
  const [shown, setShown] = useState(value);
  const [changes, setChanges] = useState(0);
  const onScreen = useRef(value);
  const ref = useRef<HTMLSpanElement>(null);
  const show = (n: number) => {
    onScreen.current = n;
    setShown(n);
  };
  useEffect(() => {
    const start = onScreen.current;
    if (start === value) return;
    setChanges((n) => n + 1);
    if (motionOff(ref.current)) return void show(value);
    const t0 = performance.now();
    let frame = 0;
    const step = (t: number) => {
      const k = Math.min(1, (t - t0) / 500);
      show(start + (value - start) * (1 - (1 - k) ** 3));
      if (k < 1) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [value]);
  return (
    <span ref={ref} key={changes} class={changes ? "animate-changed" : ""}>
      {format(shown)}
    </span>
  );
}

export function Card({ interactive, size = "md", children }: { interactive?: boolean; size?: "md" | "sm"; children: ComponentChildren }) {
  const hover = interactive ? "cursor-pointer hover:border-accent/45 hover:bg-accent/7" : "";
  return (
    <div class={`rounded-card border border-line bg-surface backdrop-blur-md transition-[border-color,background-color] duration-200 ${size === "sm" ? "p-3" : "p-4.5"} ${hover}`}>{children}</div>
  );
}

export function Tooltip({ text, wide, children }: { text: string; wide?: boolean; children: ComponentChildren }) {
  return (
    <span class={`group relative ${wide ? "flex" : "inline-flex"}`}>
      {children}
      <span
        role="tooltip"
        class={`pointer-events-none absolute bottom-[calc(100%+8px)] left-1/2 z-10 hidden -translate-x-1/2 rounded-sm border border-line-strong bg-bg px-2 py-1 text-xs font-medium text-fg group-focus-within:block group-focus-within:animate-rise group-hover:block group-hover:animate-rise ${wide ? "w-max max-w-[300px] leading-snug" : "whitespace-nowrap"}`}
      >
        {text}
      </span>
    </span>
  );
}

// A value with a fixed width (in characters) does not move the parts next to it when its digits change.
export function Metric({
  tip,
  icon,
  value,
  chars,
  detail,
  detailChars,
  children,
}: {
  tip: string;
  icon?: ComponentChildren;
  value?: ComponentChildren;
  chars?: number;
  detail?: ComponentChildren;
  detailChars?: number;
  children?: ComponentChildren;
}) {
  return (
    <Tooltip text={tip}>
      <span class="flex items-center gap-1.5 text-sm whitespace-nowrap tabular-nums">
        {icon && <span class="flex text-faint">{icon}</span>}
        {value !== undefined && (
          <span class={`max-w-[200px] truncate ${chars ? "text-right" : ""}`} style={chars ? { minWidth: `${chars}ch` } : undefined}>
            {value}
          </span>
        )}
        {detail !== undefined && (
          <span class="text-muted" style={detailChars ? { minWidth: `${detailChars}ch` } : undefined}>
            {detail}
          </span>
        )}
        {children}
      </span>
    </Tooltip>
  );
}

export const LABEL = "text-xs font-semibold tracking-[0.08em] text-muted uppercase";

// The body of a floating layer: the card of a HoverCard and the content of a Popover.
export function PopoverBody({ children }: { children: ComponentChildren }) {
  return <div class="max-h-[calc(100dvh-96px)] w-max max-w-[calc(100vw-16px)] animate-pop overflow-auto rounded-card border border-line-strong bg-bg p-4 text-fg shadow-xl">{children}</div>;
}

function useAnchorId(): string {
  return useId().replace(/[^\w-]/g, "");
}

// The layer sits in the top layer, so CSS anchors it to its trigger.
function anchoredStyle(anchor: string, margin: string, area: string, fallbacks: string): string {
  return `position-anchor: ${anchor}; inset: auto; ${margin}; position-area: ${area}; position-try-fallbacks: ${fallbacks}`;
}

const LAYER = "m-0 overflow-visible border-0 bg-transparent p-0";

const OPEN_DELAY = 300;
const CLOSE_DELAY = 150;

export function HoverCard({ card, children }: { card: ComponentChildren; children: ComponentChildren }) {
  const anchor = `--hover-card-${useAnchorId()}`;
  const popover = useRef<HTMLDivElement>(null);
  const timer = useRef(0);
  const [open, setOpen] = useState(false);
  const later = (next: boolean, delay: number) => {
    clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setOpen(next), delay);
  };
  useEffect(() => () => clearTimeout(timer.current), []);
  useLayoutEffect(() => {
    const element = popover.current;
    if (!element || open === element.matches(":popover-open")) return;
    if (open) element.showPopover();
    else element.hidePopover();
  }, [open]);
  return (
    // biome-ignore lint/a11y/useSemanticElements: the trigger holds a card with blocks, and a button holds only a phrase.
    <div
      role="button"
      tabIndex={0}
      aria-expanded={open}
      class="rounded-card outline-none focus-visible:ring-3 focus-visible:ring-accent/35"
      style={`anchor-name: ${anchor}`}
      onMouseEnter={() => later(true, OPEN_DELAY)}
      onMouseLeave={() => later(false, CLOSE_DELAY)}
      onFocus={() => later(true, 0)}
      onBlur={() => later(false, 0)}
    >
      {children}
      <div
        ref={popover}
        popover="manual"
        class={LAYER}
        style={anchoredStyle(anchor, "margin-left: 8px", "right span-bottom", "flip-inline, flip-block, flip-block flip-inline")}
      >
        {open && <PopoverBody>{card}</PopoverBody>}
      </div>
    </div>
  );
}

export function Popover({ label, title, disabled, children }: { label: ComponentChildren; title?: string; disabled?: boolean; children: ComponentChildren }) {
  const id = `popover-${useAnchorId()}`;
  const [open, setOpen] = useState(false);
  return (
    <span class="flex min-w-0 *:min-w-0" style={`anchor-name: --${id}`}>
      <Button popovertarget={id} pressed={open} disabled={disabled} title={title}>
        <span class="min-w-0 truncate">{label}</span>
        <ChevronDown size={14} class={`shrink-0 transition-transform duration-200 ${open ? "rotate-180" : ""}`} />
      </Button>
      <div
        id={id}
        popover="auto"
        onToggle={(event) => setOpen(event.newState === "open")}
        class={LAYER}
        style={anchoredStyle(`--${id}`, "margin-top: 6px", "bottom span-right", "flip-inline, flip-block")}
      >
        <PopoverBody>{children}</PopoverBody>
      </div>
    </span>
  );
}

export function Toast({ tone = "info", icon, title, onClose, children }: { tone?: Tone; icon?: ComponentChildren; title: string; onClose?: () => void; children?: ComponentChildren }) {
  return (
    <div
      role="status"
      class="pointer-events-auto flex w-[340px] max-w-[calc(100vw-32px)] animate-toast items-start gap-3 rounded-card border bg-bg py-3 pr-3 pl-4 shadow-xl"
      style={{ borderColor: `color-mix(in oklab, var(--color-${tone}) 55%, transparent)` }}
    >
      {icon && <span class={`mt-0.5 shrink-0 ${TONES[tone].text}`}>{icon}</span>}
      <div class="min-w-0 flex-1">
        <p class="text-sm font-semibold">{title}</p>
        {children && <p class="mt-0.5 text-sm leading-snug text-muted">{children}</p>}
      </div>
      {onClose && (
        <button type="button" aria-label="Close" onClick={onClose} class="shrink-0 rounded-sm p-0.5 text-faint transition-colors hover:text-fg">
          <X size={14} />
        </button>
      )}
    </div>
  );
}

export function Toaster({ children }: { children: ComponentChildren }) {
  return <div class="pointer-events-none fixed right-4 bottom-4 z-50 flex flex-col items-end gap-2">{children}</div>;
}

export function Badges({ got }: { got: readonly boolean[] | null }) {
  const before = useRef(got);
  const [shining, setShining] = useState<number[]>([]);
  useEffect(() => {
    const old = before.current;
    before.current = got;
    if (!old || !got) return;
    const fresh = got.flatMap((on, i) => (on && !old[i] ? [i] : []));
    if (fresh.length > 0) setShining((now) => [...now, ...fresh]);
  }, [got]);
  const count = got?.filter(Boolean).length ?? 0;
  return (
    <Tooltip text={`${count} badge${count === 1 ? "" : "s"} of 8`}>
      <span class="flex items-center gap-1.5">
        {Array.from({ length: 8 }, (_, i) => (
          <span
            key={i}
            onAnimationEnd={() => setShining((now) => now.filter((index) => index !== i))}
            class={`size-2.5 rounded-full border transition-colors duration-300 ${got?.[i] ? "border-accent bg-accent" : "border-line-strong"} ${shining.includes(i) ? "animate-shine" : ""}`}
          />
        ))}
      </span>
    </Tooltip>
  );
}
