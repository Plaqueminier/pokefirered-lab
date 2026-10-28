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

export function Tabs<T extends string>({ items, value, onChange, kind = "line" }: { items: TabItem<T>[]; value: T; onChange: (id: T) => void; kind?: "line" | "segmented" }) {
  const ref = useRef<HTMLDivElement>(null);
  const [indicator, setIndicator] = useState<{ left: number; width: number } | null>(null);
  const index = items.findIndex((item) => item.id === value);
  useLayoutEffect(() => {
    const root = ref.current;
    if (!root) return;
    let live = true;
    const place = () => {
      const tab = root.querySelectorAll<HTMLElement>('[role="tab"]')[index];
      if (live && tab) setIndicator({ left: tab.offsetLeft, width: tab.offsetWidth });
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
  const segmented = kind === "segmented";
  return (
    <div ref={ref} role="tablist" class={`relative inline-flex ${segmented ? "rounded-ctl border border-line bg-field p-0.75" : "gap-1"}`}>
      {indicator && (
        <span
          class={`absolute transition-[left,width] duration-300 ease-out ${segmented ? "inset-y-0.75 rounded-sm border border-line bg-raised" : "-bottom-px h-0.5 rounded-full bg-accent"}`}
          style={{ left: `${indicator.left}px`, width: `${indicator.width}px` }}
        />
      )}
      {items.map((item) => (
        <button
          key={item.id}
          role="tab"
          aria-selected={item.id === value}
          onClick={() => onChange(item.id)}
          class={`relative z-1 inline-flex items-center gap-1.5 text-sm font-semibold transition-colors ${segmented ? "h-6.5 px-3" : "h-9 px-3"} ${item.id === value ? "text-fg" : "text-muted hover:text-fg"}`}
        >
          {item.icon}
          {item.label}
        </button>
      ))}
    </div>
  );
}

export type Tone = "ok" | "warn" | "bad" | "info" | "accent";

// A dot marks a state; the accent is not a state.
const TONES: Record<Tone, { text: string; fill: string; dot: boolean }> = {
  ok: { text: "text-ok", fill: "bg-ok", dot: true },
  warn: { text: "text-warn", fill: "bg-warn", dot: true },
  bad: { text: "text-bad", fill: "bg-bad", dot: true },
  info: { text: "text-info", fill: "bg-info", dot: true },
  accent: { text: "text-accent", fill: "bg-accent", dot: false },
};

export function Pill({ tone, children }: { tone?: Tone; children: ComponentChildren }) {
  return (
    <span class={`inline-flex h-5 items-center gap-1.5 rounded-full bg-raised px-2 text-xs font-semibold ${tone ? TONES[tone].text : "text-muted"}`}>
      {tone && TONES[tone].dot && <span class="size-1.5 rounded-full bg-current" />}
      {children}
    </span>
  );
}

// The HP bar colors of the game.
export function hpTone(ratio: number): Tone {
  return ratio > 0.5 ? "ok" : ratio > 0.2 ? "warn" : "bad";
}

/** The 18 types of the game, with the names of the ROM. */
export const TYPES = ["NORMAL", "FIGHT", "FLYING", "POISON", "GROUND", "ROCK", "BUG", "GHOST", "STEEL", "???", "FIRE", "WATER", "GRASS", "ELECTR", "PSYCHC", "ICE", "DRAGON", "DARK"];

// White text on these type colors, dark text on the others: the contrast is higher.
const DARK_TYPES = new Set(["FIGHT", "POISON", "GHOST", "DRAGON", "DARK"]);

/** The token of a type color: "type-" and the ROM name in lower case, "type-mystery" for ??? and for a type that the list does not have. */
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

/** A bar takes a tone, or the color of a type (the PP of a move). */
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

/** The EXP bar of the game: it starts at the EXP of the level and ends at the EXP of the next level. It is empty at level 100. */
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

/** One stat: its name, a bar to `max` and its number. */
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

/** `wide`: the tooltip is on a full row, and its text can have more than one line. */
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

/** The surface of a hover card. */
export function HoverCardBody({ children }: { children: ComponentChildren }) {
  return <div class="w-max max-w-[calc(100vw-16px)] animate-pop rounded-card border border-line-strong bg-bg p-4 text-fg shadow-xl">{children}</div>;
}

const OPEN_DELAY = 300;
const CLOSE_DELAY = 150;

/**
 * A card that opens after a short hover of its trigger, or at the keyboard focus. It is a native popover, placed next to the
 * trigger with CSS anchor positioning: right of it, else left, above or below when there is no space. The pointer can go
 * from the trigger into the card: the card stays open.
 */
export function HoverCard({ card, children }: { card: ComponentChildren; children: ComponentChildren }) {
  const anchor = `--hover-card-${useId().replace(/[^\w-]/g, "")}`;
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
        class="m-0 overflow-visible border-0 bg-transparent p-0"
        style={`position-anchor: ${anchor}; inset: auto; margin-left: 8px; position-area: right span-bottom; position-try-fallbacks: flip-inline, flip-block, flip-block flip-inline`}
      >
        {open && <HoverCardBody>{card}</HoverCardBody>}
      </div>
    </div>
  );
}
