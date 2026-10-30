import { ChevronDown, ChevronRight } from "lucide-preact";
import type { ButtonHTMLAttributes, ComponentChildren, ComponentType, InputHTMLAttributes } from "preact";
import { useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";

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

export const FIELD =
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
export function Tabs<T extends string>({
  items,
  value,
  onChange,
  kind = "line",
  disabled,
}: {
  items: TabItem<T>[];
  value: T;
  onChange: (id: T) => void;
  kind?: TabKind;
  disabled?: boolean;
}) {
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
    <div ref={ref} role="tablist" aria-disabled={disabled} class={`relative ${TAB_LISTS[kind]} ${disabled ? "pointer-events-none opacity-40" : ""}`}>
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
            disabled={disabled}
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

export function toneText(tone?: Tone): string {
  return tone ? TONES[tone].text : "text-muted";
}

export function Pill({ tone, children }: { tone?: Tone; children: ComponentChildren }) {
  return (
    <span class={`inline-flex h-5 max-w-full items-center rounded-full bg-raised px-2 text-xs font-semibold ${toneText(tone)}`}>
      <span class="truncate">{children}</span>
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

function fraction(value: number, max: number): number {
  return max > 0 ? Math.max(0, Math.min(1, value / max)) : 0;
}

export function Bar({ value, max, tone = "accent", type }: { value: number; max: number; tone?: Tone; type?: string }) {
  const width = `${fraction(value, max) * 100}%`;
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

// The value that the user sent, until the value from the server is the same or the time is over: the control does not flicker back to the old value.
export function usePending<T>(server: T, same: (a: T, b: T) => boolean, ms: number): [T, (sent: T) => void] {
  const [pending, setPending] = useState<{ value: T } | null>(null);
  const sameRef = useRef(same);
  sameRef.current = same;
  useEffect(() => {
    if (!pending) return;
    if (sameRef.current(server, pending.value)) return void setPending(null);
    const timer = setTimeout(() => setPending(null), ms);
    return () => clearTimeout(timer);
  }, [server, pending, ms]);
  return [pending ? pending.value : server, (value) => setPending({ value })];
}

export function Slider({
  value,
  max,
  reached = max,
  step = 1,
  label,
  format = String,
  disabled,
  live,
  onSeek,
}: {
  value: number;
  max: number;
  reached?: number;
  step?: number;
  label: string;
  format?: (value: number) => string;
  disabled?: boolean;
  live?: boolean;
  onSeek: (value: number) => void;
}) {
  const [drag, setDrag] = useState<number | null>(null);
  const [pending, setPending] = usePending(value, (a, b) => Math.abs(a - b) <= step, 2000);
  const [hover, setHover] = useState<number | null>(null);
  const shown = drag ?? pending;
  // A native range stops at the last multiple of step: the track goes one step further, so the end is reachable.
  const inputMax = Math.ceil(max / step) * step;
  // The center of the 14 px thumb goes from 7 px to the width minus 7 px.
  const part = (n: number) => `calc(7px + (100% - 14px) * ${fraction(n, inputMax)})`;
  const tip = drag ?? hover;
  return (
    <div class="relative flex items-center">
      <input
        type="range"
        class="slider"
        aria-label={label}
        min={0}
        max={inputMax}
        step={step}
        value={shown}
        disabled={disabled}
        style={{ "--value": part(shown), "--reached": reached >= max ? "100%" : part(Math.max(shown, reached)) }}
        onInput={(event) => {
          const next = Number(event.currentTarget.value);
          setDrag(next);
          if (live) onSeek(Math.min(next, max));
        }}
        onChange={(event) => {
          setDrag(null);
          if (live) return;
          const next = Math.min(Number(event.currentTarget.value), max);
          setPending(next);
          onSeek(next);
        }}
        onPointerMove={(event) => {
          const box = event.currentTarget.getBoundingClientRect();
          setHover(Math.min(Math.round((fraction(event.clientX - box.left, box.width) * inputMax) / step) * step, max));
        }}
        onPointerLeave={() => setHover(null)}
        // The game ignores keys while an input has the focus: after a drag, the arrows must go to the game again.
        onPointerUp={(event) => event.currentTarget.blur()}
      />
      {tip !== null && !disabled && (
        <span
          class={`pointer-events-none absolute bottom-full mb-1.5 -translate-x-1/2 whitespace-nowrap tabular-nums ${TIP}`}
          style={{ left: part(tip) }}
        >
          {format(tip)}
        </span>
      )}
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

export function Card({ interactive, size = "md", onClick, children }: { interactive?: boolean; size?: "md" | "sm"; onClick?: () => void; children: ComponentChildren }) {
  const hover = interactive || onClick ? "cursor-pointer hover:bg-accent/7" : "";
  const look = `rounded-card border border-line bg-surface backdrop-blur-md transition-[border-color,background-color] duration-200 hover:border-accent/45 ${size === "sm" ? "p-3" : "p-4.5"} ${hover}`;
  if (!onClick) return <div class={look}>{children}</div>;
  return (
    <button type="button" onClick={onClick} class={`${look} block w-full text-left focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-accent/35`}>
      {children}
    </button>
  );
}

const COVER_DELAY_MS = 250;

export function Cover({
  busy,
  icon,
  title,
  value,
  max,
  detail,
  children,
}: {
  busy: boolean;
  icon?: ComponentChildren;
  title: string;
  value: number;
  max: number;
  detail?: string;
  children: ComponentChildren;
}) {
  const [late, setLate] = useState(false);
  useEffect(() => {
    setLate(false);
    if (!busy) return;
    const timer = setTimeout(() => setLate(true), COVER_DELAY_MS);
    return () => clearTimeout(timer);
  }, [busy]);
  const part = fraction(value, max);
  return (
    <div class="relative" aria-busy={busy}>
      {children}
      {busy && late && (
        <div role="status" class="absolute inset-0 grid animate-fade place-items-center bg-bg/70 backdrop-blur-[2px]">
          <Card>
            <div class="flex w-[260px] max-w-full flex-col gap-2.5">
              <div class="flex items-center gap-2 text-sm">
                {icon && <span class="flex text-accent">{icon}</span>}
                <span class="min-w-0 truncate font-semibold">{title}</span>
                <span class="ml-auto text-muted tabular-nums">{Math.round(part * 100)} %</span>
              </div>
              <Bar value={value} max={max} />
              {detail && <span class="text-xs text-muted tabular-nums">{detail}</span>}
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}

const TIP = "animate-pop rounded-sm border border-line-strong bg-bg px-2 py-1 text-xs font-medium text-fg";

// A tip that follows the pointer over a track or a chart, at `x` in a box of `width`.
export function Tip({ x, width, children }: { x: number; width: number; children: ComponentChildren }) {
  const align = x < 160 ? "-translate-x-4" : x > width - 160 ? "-translate-x-[calc(100%-16px)]" : "-translate-x-1/2";
  return (
    <span class={`pointer-events-none absolute bottom-full z-10 mb-1.5 whitespace-nowrap ${align} ${TIP}`} style={{ left: `${x}px` }}>
      {children}
    </span>
  );
}

/** The width of an element, again at each resize. */
export function useWidth() {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const observer = new ResizeObserver(() => setWidth(element.clientWidth));
    observer.observe(element);
    setWidth(element.clientWidth);
    return () => observer.disconnect();
  }, []);
  return [ref, width] as const;
}

// In the top layer: the overflow of a panel cuts an absolute tip.
export function Tooltip({ text, wide, children }: { text: string; wide?: boolean; children: ComponentChildren }) {
  const anchor = `--tooltip-${useAnchorId()}`;
  const wrapper = useRef<HTMLSpanElement>(null);
  const tip = useRef<HTMLSpanElement>(null);
  const show = () => tip.current?.showPopover();
  const hide = () => {
    if (tip.current?.matches(":popover-open")) tip.current.hidePopover();
  };
  // A click hides the tip; when the click changes the text, the pointer is still there to read it.
  useEffect(() => {
    if (text && wrapper.current?.matches(":hover") && !tip.current?.matches(":popover-open")) tip.current?.showPopover();
  }, [text]);
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: the wrapper only shows the tip of its child.
    <span
      ref={wrapper}
      class={`relative max-w-full ${wide ? "flex" : "inline-flex"}`}
      style={`anchor-name: ${anchor}`}
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocusIn={show}
      onFocusOut={hide}
      onPointerDown={hide}
    >
      {children}
      <span
        ref={tip}
        role="tooltip"
        popover="manual"
        style={anchoredStyle(anchor, "margin-bottom: 8px", "top", "flip-block")}
        class={`pointer-events-none m-0 ${TIP} ${wide ? "w-max max-w-[300px] leading-snug" : "whitespace-nowrap"}`}
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
      <span class="flex min-w-0 items-center gap-1.5 text-sm whitespace-nowrap tabular-nums">
        {icon && <span class="flex text-faint">{icon}</span>}
        {value !== undefined && (
          <span class="max-w-[200px] truncate" style={chars ? { minWidth: `${chars}ch` } : undefined}>
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

type StatTileProps = {
  label: string;
  value: ComponentChildren;
  size: "lg" | "md" | "sm";
  icon?: ComponentType<{ size?: number }>;
  tone?: Tone;
  detail?: ComponentChildren;
  total?: ComponentChildren;
};

export function StatTile({ label, value, size, icon: Icon, tone, detail, total }: StatTileProps) {
  const toned = tone ? toneText(tone) : "";
  const valueColor = tone && !Icon ? toned : "text-fg";
  const after = (
    <>
      {total !== undefined && <span class="ml-1.5 text-sm font-normal text-faint">/ {total}</span>}
      {detail !== undefined && size !== "lg" && <span class="ml-1.5 text-xs font-normal">{detail}</span>}
    </>
  );
  if (size === "sm") {
    return (
      <div class="flex min-w-0 flex-col gap-0.5">
        <span class="flex min-w-0 items-center gap-1.5 text-xs text-muted">
          {Icon && (
            <span class={`flex shrink-0 ${toned}`}>
              <Icon size={13} />
            </span>
          )}
          <span class="truncate">{label}</span>
        </span>
        <span class={`truncate text-lg font-semibold tabular-nums ${valueColor}`}>
          {value}
          {after}
        </span>
      </div>
    );
  }
  if (size === "md") {
    return (
      <Card size="sm">
        <div class="flex min-w-0 items-center gap-3">
          {Icon && (
            <span class={`flex shrink-0 ${toned || "text-muted"}`}>
              <Icon size={22} />
            </span>
          )}
          <span class="flex min-w-0 flex-col">
            <span class={`truncate text-2xl leading-tight font-semibold tabular-nums ${valueColor}`}>
              {value}
              {after}
            </span>
            <span class="truncate text-xs text-muted">{label}</span>
          </span>
        </div>
      </Card>
    );
  }
  return (
    <Card size="sm">
      <div class="flex min-w-0 flex-col gap-1">
        <span class={`${LABEL} flex min-w-0 items-center gap-1.5`}>
          {Icon && (
            <span class={`flex shrink-0 ${toned}`}>
              <Icon size={13} />
            </span>
          )}
          <span class="truncate">{label}</span>
        </span>
        <span class={`truncate text-3xl leading-none font-semibold tabular-nums ${valueColor}`}>
          {value}
          {after}
        </span>
        <span class="h-4 truncate text-xs text-muted tabular-nums">{detail}</span>
      </div>
    </Card>
  );
}


let anchors = 0;

// Not useId: each render root of the page counts its useId values from the same start, so two roots give the same ids.
export function useAnchorId(): string {
  const [id] = useState(() => `a${++anchors}`);
  return id;
}

// The layer sits in the top layer, so CSS anchors it to its trigger.
export function anchoredStyle(anchor: string, margin: string, area: string, fallbacks: string): string {
  return `position-anchor: ${anchor}; inset: auto; ${margin}; position-area: ${area}; position-try-fallbacks: ${fallbacks}`;
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

export function toggled<T>(set: ReadonlySet<T>, item: T): Set<T> {
  const next = new Set(set);
  if (!next.delete(item)) next.add(item);
  return next;
}

export function FilterChip({
  icon,
  tone,
  label,
  hideLabel,
  count,
  disabled,
  on,
  onToggle,
}: {
  icon: ComponentChildren;
  tone?: Tone;
  label: string;
  hideLabel?: boolean;
  count?: number;
  disabled?: boolean;
  on: boolean;
  onToggle: () => void;
}) {
  const chip = (
    <Button size="sm" pressed={on} disabled={disabled} aria-label={hideLabel ? label : undefined} onClick={onToggle}>
      <span class={`flex ${toneText(tone)}`}>{icon}</span>
      {!hideLabel && label}
      {count !== undefined && <span class="font-medium text-faint tabular-nums">{count}</span>}
    </Button>
  );
  return hideLabel ? <Tooltip text={label}>{chip}</Tooltip> : chip;
}

export function Breadcrumb({ steps, onPick }: { steps: string[]; onPick: (index: number) => void }) {
  return (
    <nav aria-label="Breadcrumb" class="flex flex-wrap items-center gap-1">
      {steps.map((label, i) => {
        const current = i === steps.length - 1;
        return (
          <span key={i} class="flex items-center gap-1">
            {i > 0 && <ChevronRight size={14} class="text-faint" />}
            <Button size="sm" variant="ghost" pressed={current} aria-current={current ? "step" : undefined} onClick={() => onPick(i)}>
              {label}
            </Button>
          </span>
        );
      })}
    </nav>
  );
}

// Controlled: the panel keeps the state of each block by its id.
export function Collapsible({
  title,
  icon,
  detail,
  open,
  onToggle,
  children,
}: {
  title: string;
  icon?: ComponentChildren;
  detail?: ComponentChildren;
  open: boolean;
  onToggle: () => void;
  children: ComponentChildren;
}) {
  return (
    <div class="flex flex-col gap-1">
      <button
        type="button"
        aria-expanded={open}
        onClick={onToggle}
        class={`${LABEL} flex h-7 w-full items-center gap-2 rounded-ctl px-2 text-left transition-colors hover:bg-raised hover:text-fg focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-accent/35`}
      >
        <ChevronDown size={14} class={`shrink-0 transition-transform duration-200 ${open ? "" : "-rotate-90"}`} />
        {icon && <span class="flex shrink-0">{icon}</span>}
        <span class="max-w-[70%] shrink-0 truncate">{title}</span>
        {detail !== undefined && <span class="ml-auto min-w-0 truncate font-normal tracking-normal text-faint normal-case">{detail}</span>}
      </button>
      {open && children}
    </div>
  );
}

export function ListRow({
  cells = [],
  text,
  error,
  icons,
  selected,
  onClick,
}: {
  cells?: { text: string; chars: number }[];
  text: ComponentChildren;
  error?: boolean;
  icons?: ComponentChildren;
  selected?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onClick}
      class={`flex h-7 w-full min-w-0 shrink-0 items-center gap-2 rounded-ctl border px-2 text-left text-xs transition-colors focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-accent/35 ${selected ? "border-accent bg-raised" : "border-transparent hover:bg-raised"}`}
    >
      {cells.map((cell, i) => (
        <span key={i} class="shrink-0 text-faint tabular-nums" style={{ minWidth: `${cell.chars}ch` }}>
          {cell.text}
        </span>
      ))}
      <span class={`min-w-0 truncate font-mono ${error ? "text-bad" : "text-fg"}`}>{text}</span>
      {icons && <span class="ml-auto flex shrink-0 items-center gap-1">{icons}</span>}
    </button>
  );
}
