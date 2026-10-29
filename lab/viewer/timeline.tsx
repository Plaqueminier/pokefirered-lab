// The Timeline at the bottom of the Lab tab: the Game events of the shown Run as icons on one track. A click moves the cursor, or jumps the replay.
import { ChevronsUp, CircleDot, Gift, Heart, MapPin, PawPrint, ShoppingBag, Skull, Sparkles, Swords, Trophy } from "lucide-preact";
import type { ComponentChildren, ComponentType } from "preact";
import { useLayoutEffect, useRef, useState } from "preact/hooks";
import type { Areas, Milestone } from "../src/game";
import type { RunEvent } from "../src/harness/record";
import { Button, FilterChip, LABEL, Pill, TIP, type Tone, Tooltip, toggled, toneText } from "./components";
import type { Span } from "./cursor";
import { clock } from "./stats-lanes";

export type TimelineKind = "milestone" | "faint" | "catch" | "evolution" | "trainer" | "heal" | "place" | "level" | "wild" | "purchase" | "item";

export type TimelineEvent = { frame: number; kind: TimelineKind; text: string };

type KindLook = { id: TimelineKind; label: string; icon: ComponentType<{ size?: number }>; tone?: Tone; on: boolean };

// In the order of importance: a group shows the icon of its most important event.
const KINDS: KindLook[] = [
  { id: "milestone", label: "Milestones", icon: Trophy, tone: "warn", on: true },
  { id: "faint", label: "Fainted Pokémon", icon: Skull, tone: "bad", on: true },
  { id: "catch", label: "New Pokémon", icon: CircleDot, tone: "info", on: true },
  { id: "evolution", label: "Evolutions", icon: Sparkles, tone: "accent", on: true },
  { id: "trainer", label: "Trainer battles", icon: Swords, tone: "accent", on: true },
  { id: "heal", label: "Heals", icon: Heart, tone: "ok", on: true },
  { id: "place", label: "New places", icon: MapPin, on: true },
  { id: "level", label: "Levels", icon: ChevronsUp, on: false },
  { id: "wild", label: "Wild battles", icon: PawPrint, on: false },
  { id: "purchase", label: "Purchases", icon: ShoppingBag, on: false },
  { id: "item", label: "Items got", icon: Gift, on: false },
];

const RANK = new Map(KINDS.map((kind, i) => [kind.id, i]));

const LOOKS = new Map(KINDS.map((kind) => [kind.id, kind]));

const KINDS_KEY = "lab.timeline";

// localStorage throws when the browser blocks the storage (for example in a private window).
export function storedKinds(): ReadonlySet<TimelineKind> {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(KINDS_KEY) ?? "null");
    if (Array.isArray(saved)) return new Set(saved.filter((kind): kind is TimelineKind => LOOKS.has(kind)));
  } catch {}
  return new Set(KINDS.filter((kind) => kind.on).map((kind) => kind.id));
}

export function storeKinds(kinds: ReadonlySet<TimelineKind>): void {
  try {
    localStorage.setItem(KINDS_KEY, JSON.stringify([...kinds]));
  } catch {}
}

/** The kinds that a Run record from before the Game events of RECORD_FORMAT has. */
const OLD_KINDS = new Set<TimelineKind>(["milestone", "place"]);

const MILESTONE_NAMES: Record<Milestone, string> = {
  "has-pokemon": "First Pokémon",
  "first-rival-battle": "Rival",
  pokedex: "Pokédex",
  "badge-1": "Brock",
  "badge-2": "Misty",
  "badge-3": "Lt. Surge",
  "badge-4": "Erika",
  "badge-5": "Koga",
  "badge-6": "Sabrina",
  "badge-7": "Blaine",
  "badge-8": "Giovanni",
};

// "RIVAL BOB" → "Rival Bob". The items keep the case of the game.
function titleCase(name: string): string {
  return name.toLowerCase().replace(/(^|[\s.-])(\p{L})/gu, (_, before: string, letter: string) => before + letter.toUpperCase());
}

type Battle = { from: number; to: number | null; area: string; trainer: string | null };

/** The events of the Timeline, in the order of their frames. The level-ups of one Pokémon and the wild battles of one stay in an Area make one event, at the first one. */
export function timelineEvents(events: readonly RunEvent[], areas: Areas): TimelineEvent[] {
  const shown: TimelineEvent[] = [];
  const battles: Battle[] = [];
  const visited = new Set<string>();
  let area = "";
  let stay = 0;
  // By species, for the current stay: the event and the first level.
  const levels = new Map<string, { event: TimelineEvent; from: number }>();
  for (const event of events) {
    switch (event.type) {
      case "map": {
        const next = areas[event.map]?.area ?? event.map;
        if (next !== area) {
          area = next;
          stay++;
          levels.clear();
        }
        if (!visited.has(area)) {
          visited.add(area);
          shown.push({ frame: event.frame, kind: "place", text: area });
        }
        break;
      }
      case "milestone":
        shown.push({ frame: event.frame, kind: "milestone", text: MILESTONE_NAMES[event.milestone] ?? event.milestone });
        break;
      case "battle": {
        const last = battles.at(-1);
        if (event.state === "start") battles.push({ from: event.frame, to: null, area: `${stay}:${area}`, trainer: null });
        else if (last && last.to === null) last.to = event.frame;
        break;
      }
      // The flag of a trainer changes at the end of its battle, or just after it.
      case "trainer": {
        const last = battles.at(-1);
        if (last && !last.trainer) last.trainer = event.trainer;
        else shown.push({ frame: event.frame, kind: "trainer", text: `Trainer battle: ${titleCase(event.trainer)}` });
        break;
      }
      case "faint":
        if (event.side === "player") shown.push({ frame: event.frame, kind: "faint", text: `${titleCase(event.species)} fainted` });
        break;
      case "catch":
        shown.push({ frame: event.frame, kind: "catch", text: `New Pokémon: ${titleCase(event.species)}` });
        break;
      case "level": {
        if (event.evolution) shown.push({ frame: event.frame, kind: "evolution", text: `${titleCase(event.species)} evolved into ${titleCase(event.evolution)}` });
        const group = levels.get(event.species) ?? { event: { frame: event.frame, kind: "level", text: "" }, from: event.from };
        if (!levels.has(event.species)) shown.push(group.event);
        group.event.text = `${titleCase(event.species)} Lv ${group.from} → ${event.level}`;
        levels.delete(event.species);
        levels.set(event.evolution ?? event.species, group);
        break;
      }
      case "heal": {
        const text = event.source === "center" ? "Healed at the Pokémon Center" : event.item ? `Healed with ${event.item}` : "Healed";
        shown.push({ frame: event.frame, kind: "heal", text });
        break;
      }
      case "purchase":
        shown.push({ frame: event.frame, kind: "purchase", text: `Bought ${event.count} × ${event.item}` });
        break;
      case "item":
        shown.push({ frame: event.frame, kind: "item", text: `Got ${event.count > 1 ? `${event.count} × ` : ""}${event.item}` });
        break;
    }
  }
  const wild = new Map<string, { event: TimelineEvent; count: number }>();
  for (const battle of battles) {
    const time = battle.to === null ? "" : ` (${clock(battle.to - battle.from)})`;
    if (battle.trainer) {
      shown.push({ frame: battle.from, kind: "trainer", text: `Trainer battle: ${titleCase(battle.trainer)}${time}` });
      continue;
    }
    const group = wild.get(battle.area) ?? { event: { frame: battle.from, kind: "wild", text: "" }, count: 0 };
    if (group.count === 0) shown.push(group.event);
    group.count++;
    wild.set(battle.area, group);
    const name = battle.area.slice(battle.area.indexOf(":") + 1);
    group.event.text = `${group.count} wild battle${group.count > 1 ? "s" : ""} in ${name}`;
  }
  return shown.sort((a, b) => a.frame - b.frame);
}

// ---- The view

type Group = { x: number; events: TimelineEvent[]; top: TimelineEvent };

const GROUP_GAP = 18;
const NEAR = 9;
const DRAG = 4;
const MAX_LINES = 8;
const INSET = 8;

// Icons closer than GROUP_GAP px make one group.
function groupsOf(events: readonly TimelineEvent[], x: (frame: number) => number): Group[] {
  const groups: Group[] = [];
  for (const event of events) {
    const at = x(event.frame);
    const last = groups.at(-1);
    if (last && at - last.x < GROUP_GAP) {
      last.events.push(event);
      if ((RANK.get(event.kind) ?? 0) < (RANK.get(last.top.kind) ?? 0)) last.top = event;
    } else groups.push({ x: at, events: [event], top: event });
  }
  return groups;
}

function nearGroup(groups: readonly Group[], x: number): Group | null {
  let best: Group | null = null;
  for (const group of groups) if (Math.abs(group.x - x) <= NEAR && (!best || Math.abs(group.x - x) < Math.abs(best.x - x))) best = group;
  return best;
}

function KindIcon({ kind, size }: { kind: TimelineKind; size: number }) {
  const look = LOOKS.get(kind);
  if (!look) return null;
  const Icon = look.icon;
  return (
    <span class={`flex ${toneText(look.tone) || "text-muted"}`}>
      <Icon size={size} />
    </span>
  );
}

function EventLines({ events }: { events: readonly TimelineEvent[] }) {
  return (
    <span class="flex flex-col gap-0.5">
      {events.slice(0, MAX_LINES).map((event, i) => (
        <span key={i} class="flex items-center gap-1.5">
          <KindIcon kind={event.kind} size={12} />
          <span class="text-faint tabular-nums">{clock(event.frame)}</span>
          <span>{event.text}</span>
        </span>
      ))}
      {events.length > MAX_LINES && <span class="text-faint">and {events.length - MAX_LINES} more</span>}
    </span>
  );
}

// The tip follows the pointer, as the tip of the Slider. Near an end of the track, it stays inside it.
function Tip({ x, width, children }: { x: number; width: number; children: ComponentChildren }) {
  const align = x < 160 ? "-translate-x-4" : x > width - 160 ? "-translate-x-[calc(100%-16px)]" : "-translate-x-1/2";
  return (
    <span class={`pointer-events-none absolute bottom-full z-10 mb-1.5 whitespace-nowrap ${align} ${TIP}`} style={{ left: `${x}px` }}>
      {children}
    </span>
  );
}

function useWidth() {
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

export type TimelineProps = {
  events: readonly TimelineEvent[];
  /** The last frame: the frame of a live Run, or the frames of a Run record. */
  end: number;
  /** The frame of the thumb: the cursor, or the frame of the replay or of the Run. */
  at: number;
  cursor: boolean;
  /** In a replay: the frames that the replay played. */
  reached?: number;
  selection: Span | null;
  /** In a replay that ended: the end reason of the Run record. */
  ended?: string;
  /** False for a Run record from before the Game events: only the Milestones and the new places. */
  gameEvents: boolean;
  kinds: ReadonlySet<TimelineKind>;
  onKinds: (kinds: ReadonlySet<TimelineKind>) => void;
  onPick: (frame: number) => void;
  onRange: (range: Span) => void;
  onNow: () => void;
};

function Header({ events, at, end, cursor, ended, gameEvents, kinds, onKinds, onNow }: TimelineProps) {
  const counts = new Map<TimelineKind, number>();
  for (const event of events) counts.set(event.kind, (counts.get(event.kind) ?? 0) + 1);
  return (
    <div class="mb-1 flex h-7 items-center gap-1">
      <span class={`${LABEL} mr-2`}>Timeline</span>
      {KINDS.map(({ id, label, icon: Icon, tone }) => {
        const off = !gameEvents && !OLD_KINDS.has(id);
        return (
          <FilterChip
            key={id}
            icon={<Icon size={14} />}
            tone={tone}
            label={off ? "No Game events in this record" : `${label} (${counts.get(id) ?? 0})`}
            hideLabel
            disabled={off}
            on={!off && kinds.has(id)}
            onToggle={() => onKinds(toggled(kinds, id))}
          />
        );
      })}
      <span class="ml-auto flex shrink-0 items-center gap-3 pl-3">
        {ended && <Pill tone="warn">ended: {ended}</Pill>}
        <span class="whitespace-nowrap text-sm tabular-nums">
          {cursor ? "Cursor" : "Now"} {clock(at)}
          <span class="text-muted"> / {clock(end)}</span>
        </span>
      </span>
      <Tooltip text="Back to now (Esc)">
        <Button size="sm" variant="ghost" disabled={!cursor} onClick={onNow}>
          Now
        </Button>
      </Tooltip>
    </div>
  );
}

function Track({ events, end, at, reached, selection, gameEvents, kinds, onPick, onRange }: TimelineProps) {
  const [ref, width] = useWidth();
  const [hover, setHover] = useState<number | null>(null);
  const [drag, setDrag] = useState<Span | null>(null);
  const start = useRef<{ x: number; frame: number } | null>(null);
  const right = Math.max(INSET + 1, width - INSET);
  const span = Math.max(1, end);
  const x = (frame: number) => INSET + (Math.min(Math.max(frame, 0), span) / span) * (right - INSET);
  const frameAt = (px: number) => Math.round((Math.min(Math.max(px - INSET, 0), right - INSET) / (right - INSET)) * span);
  const groups = groupsOf(
    events.filter((event) => kinds.has(event.kind) && (gameEvents || OLD_KINDS.has(event.kind))),
    x,
  );
  const hovered = hover === null ? null : nearGroup(groups, hover);
  const local = (event: PointerEvent) => event.clientX - (event.currentTarget as HTMLElement).getBoundingClientRect().left;
  const band = drag ?? selection;
  return (
    <div
      ref={ref}
      class="relative h-10 cursor-pointer touch-none select-none"
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        event.currentTarget.setPointerCapture(event.pointerId);
        const px = local(event);
        start.current = { x: px, frame: nearGroup(groups, px)?.top.frame ?? frameAt(px) };
      }}
      onPointerMove={(event) => {
        const px = local(event);
        setHover(px);
        const from = start.current;
        if (from && (drag || Math.abs(px - from.x) > DRAG)) {
          const frame = frameAt(px);
          setDrag({ from: Math.min(from.frame, frame), to: Math.max(from.frame, frame) });
        }
      }}
      onPointerUp={() => {
        const from = start.current;
        start.current = null;
        if (!from) return;
        if (drag) onRange(drag);
        else onPick(from.frame);
        setDrag(null);
      }}
      onPointerLeave={() => setHover(null)}
    >
      <svg width={width} height={40} class="absolute inset-0 overflow-visible" aria-hidden="true">
        <rect x={INSET} y={30} width={right - INSET} height={4} rx={2} class="fill-track" />
        {reached !== undefined && <rect x={INSET} y={30} width={x(reached) - INSET} height={4} rx={2} class="fill-line-strong" />}
        <rect x={INSET} y={30} width={x(at) - INSET} height={4} rx={2} class="fill-accent/70" />
        {band && <rect x={x(band.from)} y={25} width={Math.max(2, x(band.to) - x(band.from))} height={14} rx={3} class="fill-accent/15 stroke-accent/60" />}
        {groups.map((group) => (
          <line key={group.top.frame} x1={group.x} x2={group.x} y1={20} y2={30} class="stroke-line-strong" />
        ))}
        <circle cx={x(at)} cy={32} r={6} class="fill-accent stroke-bg" stroke-width={2} />
      </svg>
      {groups.map((group) => (
        <span
          key={group.top.frame}
          class={`absolute top-0 flex -translate-x-1/2 items-center rounded-sm px-0.5 ${hovered === group ? "bg-raised" : ""}`}
          style={{ left: `${group.x}px` }}
        >
          <KindIcon kind={group.top.kind} size={14} />
          {group.events.length > 1 && <span class="ml-px text-[10px] font-semibold text-faint tabular-nums">{group.events.length}</span>}
        </span>
      ))}
      {hover !== null && (
        <Tip x={hovered ? hovered.x : hover} width={width}>
          {hovered ? <EventLines events={hovered.events} /> : clock(frameAt(hover))}
        </Tip>
      )}
    </div>
  );
}

export function Timeline(props: TimelineProps) {
  return (
    <div class="rounded-card border border-line bg-surface px-3 py-2">
      <Header {...props} />
      <Track {...props} />
    </div>
  );
}
