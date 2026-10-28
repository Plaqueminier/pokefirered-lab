// The Lab tab: the layout C1 of issue #57. A top bar, a left column with the live state, a rail of icons that chooses
// one tool panel at full height. The old panels keep their DOM: the layout moves their nodes into its zones.
import { Bot, ChartColumn, Clock, Coins, Info, ListTree, MapPin, Map as MapIcon, MessageSquare, Rewind, Trophy } from "lucide-preact";
import { type ComponentChildren, type ComponentType, createContext, render } from "preact";
import { useContext, useEffect, useState } from "preact/hooks";
import type { GameState } from "../src/game";
import type { Continuation, ModelEvent, RunEvent } from "../src/harness/record";
import type { ServerMessage, ShownRun } from "../src/protocol";
import { Badges, Button, HoverCard, Pill, Popover, Toast, Toaster, type Tone, Tooltip } from "./components";
import { callAt, type SharedCursor, Store } from "./cursor";
import { callsStarted, modelCalls } from "./model-panel";
import { PokemonCard } from "./pokemon";
import { runKey, runLabel } from "./runs";
import { clock, stuckLevel } from "./stats-lanes";

type Status = Extract<ServerMessage, { type: "status" }>;

/** What the server sent last. `statusLine`: the status line, which the Viewer makes with the state of its sound. */
type LabData = { status: Status | null; state: GameState | null; events: readonly RunEvent[]; statusLine: string };

/** The nodes of the old panels. The layout moves each one into its zone and never takes it out of the page. */
export type LabParts = Record<"screen" | "controls" | "help" | "runs" | "replay" | "map" | "model" | "stats" | "memory", HTMLElement>;

type Lab = { data: Store<LabData>; shared: SharedCursor; parts: LabParts };

const LabContext = createContext<Lab>(null!);

function useStore<T>(store: Store<T>): T {
  const [, setChanges] = useState(0);
  useEffect(() => store.subscribe(() => setChanges((n) => n + 1)), [store]);
  return store.value;
}

/** An old panel: its node goes into this zone. */
function Legacy({ part }: { part: keyof LabParts }) {
  const { parts } = useContext(LabContext);
  return <div class="legacy contents" ref={(element) => element?.append(parts[part])} />;
}

// ---- The registry of the zones and of the panels of the rail

/**
 * The size of a zone at each breakpoint: under 900 px (`narrow`, the zones stack and the page scrolls), from 900 px
 * (`medium`) and from 1280 px (`wide`). For a column, its width in the row; for a panel of the rail, the height of the
 * focus panel.
 */
type Sizes = { narrow: string; medium: string; wide: string };

type Entry = { id: string; title: string; icon?: ComponentType<{ size?: number }>; size: Sizes; render: () => ComponentChildren };

const AUTO: Sizes = { narrow: "auto", medium: "auto", wide: "auto" };

const ZONES = {
  top: { id: "top", title: "Top bar", size: AUTO, render: () => <TopBar /> },
  live: { id: "live", title: "Live column", size: { narrow: "auto", medium: "40%", wide: "46%" }, render: () => <LiveColumn /> },
} satisfies Record<string, Entry>;

const PANEL: Sizes = { narrow: "75vh", medium: "100%", wide: "100%" };

/** The panels of the rail, in their order. A new panel is one entry here. */
const RAIL: Entry[] = [
  { id: "map", title: "Whole map", icon: MapIcon, size: PANEL, render: () => <Legacy part="map" /> },
  { id: "model", title: "Model", icon: Bot, size: PANEL, render: () => <Legacy part="model" /> },
  { id: "stats", title: "Stats", icon: ChartColumn, size: PANEL, render: () => <Legacy part="stats" /> },
  { id: "memory", title: "Memory tree", icon: ListTree, size: PANEL, render: () => <Legacy part="memory" /> },
  { id: "replay", title: "Replay", icon: Rewind, size: PANEL, render: () => <Legacy part="replay" /> },
];

function sizeVars({ narrow, medium, wide }: Sizes): Record<string, string> {
  return { "--narrow": narrow, "--medium": medium, "--wide": wide };
}

function LabLayout() {
  const [shown, setShown] = useState(RAIL[0].id);
  const panel = RAIL.find((entry) => entry.id === shown) ?? RAIL[0];
  return (
    <>
      {ZONES.top.render()}
      <div class="flex flex-col min-[900px]:min-h-0 min-[900px]:flex-1 min-[900px]:flex-row">
        <div style={sizeVars(ZONES.live.size)} class="@container shrink-0 min-[900px]:w-(--medium) min-[900px]:overflow-y-auto min-[1280px]:w-(--wide)">
          {ZONES.live.render()}
        </div>
        <nav aria-label="Panels" class="flex shrink-0 gap-1 border-y border-line p-2 min-[900px]:flex-col min-[900px]:border-x min-[900px]:border-y-0">
          {RAIL.map(({ id, title, icon: Icon }) => (
            <Tooltip key={id} text={title}>
              <Button size="icon" variant="ghost" pressed={id === shown} aria-label={title} onClick={() => setShown(id)}>
                {Icon && <Icon size={16} />}
              </Button>
            </Tooltip>
          ))}
        </nav>
        <div style={sizeVars(panel.size)} class="h-(--narrow) min-w-0 overflow-auto p-4 min-[900px]:h-(--medium) min-[900px]:flex-1 min-[1280px]:h-(--wide)">
          {/* All the panels stay in the page: the old code finds their nodes by id at any time. */}
          {RAIL.map((entry) => (
            <div key={entry.id} hidden={entry.id !== shown} class="h-full">
              {entry.render()}
            </div>
          ))}
        </div>
      </div>
    </>
  );
}

// ---- The top bar: always one line

/** The model settings of the shown Run, for the cost and its limit. */
function modelOf(shown: ShownRun): { costLimit: number; continued: Continuation | null } | null {
  if (shown.kind === "bot") return shown.run.model && { costLimit: shown.run.model.costLimit, continued: shown.run.continued };
  return shown.replay?.model ? { costLimit: shown.replay.model.costLimit, continued: shown.replay.continued } : null;
}

/** The cost of the events up to a frame. For a Continued Run, `from` skips the events of its parent: its cost limit does not count them. */
function costTo(events: readonly RunEvent[], frame: number, from = 0): number {
  let cost = 0;
  for (let i = from; i < events.length && events[i].frame <= frame; i++) {
    const event = events[i];
    if ("usage" in event) cost += event.usage.cost;
  }
  return cost;
}

const STUCK_TONES: Record<ReturnType<typeof stuckLevel>, Tone> = { low: "ok", mid: "warn", high: "bad" };

const MODES = { overworld: "map", battle: "battle", other: "menu" };

function runName(shown: ShownRun): string {
  if (shown.kind === "bot") return runLabel(shown.run);
  return shown.replay ? `Replay of ${shown.replay.name}` : "Viewer Run (keyboard)";
}

/** One number of the top bar. Numbers are tabular, and `width` keeps the place of the largest value. */
function Stat({ tip, icon, hide = "", children }: { tip: string; icon?: ComponentChildren; hide?: string; children: ComponentChildren }) {
  return (
    <span class={`shrink-0 ${hide}`}>
      <Tooltip text={tip}>
        <span class="flex items-center gap-1.5 text-sm whitespace-nowrap">
          {icon && <span class="text-faint">{icon}</span>}
          {children}
        </span>
      </Tooltip>
    </span>
  );
}

function TopBar() {
  const { data, shared } = useContext(LabContext);
  const { status, state, events } = useStore(data);
  const { cursor } = useStore(shared);
  const shown = status?.shown ?? null;
  const model = shown && modelOf(shown);
  const calls = modelCalls(events).calls;
  const index = callAt(calls, cursor);
  const call = index === null ? null : calls[index];
  const frame = cursor?.frame ?? status?.frame ?? 0;
  const cost = costTo(events, cursor ? cursor.frame : Number.POSITIVE_INFINITY, model?.continued?.events ?? 0);
  const name = shown ? runName(shown) : "connecting…";
  return (
    <header class="@container flex h-12 shrink-0 items-center gap-5 border-b border-line px-4">
      <span class="flex max-w-[420px] min-w-[120px] shrink">
        <Popover label={name} title={name}>
          <Legacy part="runs" />
        </Popover>
      </span>
      <span class="ml-auto flex shrink-0 items-center gap-5">
        {(model || calls.length > 0) && (
          <>
            <Stat tip={model ? "Cost of the Model calls at the cursor / cost limit" : "Cost of the Model calls at the cursor"} icon={<Coins size={14} />}>
              <span class="inline-block min-w-[7ch] text-right">{cost.toFixed(2)} $</span>
              {model && <span class="text-muted">/ {model.costLimit.toFixed(2)} $</span>}
            </Stat>
            <Stat tip="Stuck counter at the cursor" hide="@max-[440px]:hidden">
              {call?.stuck === undefined ? (
                <Pill>Stuck –</Pill>
              ) : (
                <Pill tone={STUCK_TONES[stuckLevel(call.stuck)]}>
                  Stuck <span class="inline-block min-w-[2ch] text-right">{call.stuck}</span>
                </Pill>
              )}
            </Stat>
            <Stat tip="The Model call at the cursor / all the Model calls" icon={<MessageSquare size={14} />} hide="@max-[560px]:hidden">
              <span class="inline-block min-w-[4ch] text-right">{index === null ? "–" : index + 1}</span>
              <span class="inline-block min-w-[6ch] text-muted">/ {calls.length}</span>
            </Stat>
          </>
        )}
        {/* The hide order when the bar is narrow: the time, the map, the money, the badges. The widths come from the largest values. */}
        <span class="shrink-0 @max-[700px]:hidden">
          <Badges got={state?.badges ?? null} />
        </span>
        <Stat tip="Money (live)" icon={<span class="text-sm">₽</span>} hide="@max-[800px]:hidden">
          <span class="inline-block min-w-[7ch] text-right">{state ? state.money.toLocaleString("en-US") : "–"}</span>
        </Stat>
        <Stat
          tip={state ? `group ${state.map.group}, map ${state.map.num} · callback2 ${state.context.callback2} · callback1 ${state.context.callback1}` : "no state yet"}
          icon={<MapPin size={14} />}
          hide="@max-[1140px]:hidden"
        >
          <span class="max-w-[200px] truncate">{state?.player ? state.map.name : "–"}</span>
          <span class="inline-block min-w-[7ch] text-muted">{state?.player ? `${state.player.x}, ${state.player.y}` : ""}</span>
          {state && <Pill>{MODES[state.context.mode]}</Pill>}
        </Stat>
        <Stat tip={`${cursor ? "Cursor" : "Now"}: frame ${frame.toLocaleString("en-US")}`} icon={<Clock size={14} />} hide="@max-[1240px]:hidden">
          <span class="inline-block min-w-[7ch] text-right">{clock(frame)}</span>
        </Stat>
      </span>
    </header>
  );
}

// ---- The left column: the live state

function turnOf(call: ModelEvent): { text: string; tone: Tone } | null {
  if (call.reflection) return { text: "Reflection turn", tone: "warn" };
  return call.review ? { text: "Review turn", tone: "accent" } : null;
}

/** The answer of a Model call, in the hover card of the decision line. */
function CallCard({ call, index, count }: { call: ModelEvent; index: number; count: number }) {
  const turn = turnOf(call);
  const { decision } = call;
  return (
    <div class="flex w-[420px] max-w-full flex-col gap-2 text-sm">
      <div class="flex items-center gap-2">
        <span class="text-xs font-semibold tracking-[0.08em] text-muted uppercase">
          Model call {index + 1} of {count} · {clock(call.frame)}
        </span>
        <span class="ml-auto flex gap-1.5">
          {call.stuck !== undefined && <Pill tone={STUCK_TONES[stuckLevel(call.stuck)]}>Stuck {call.stuck}</Pill>}
          {turn && <Pill tone={turn.tone}>{turn.text}</Pill>}
        </span>
      </div>
      {decision ? (
        <>
          <p class="font-mono text-accent">→ {decision.action}</p>
          <p class="leading-relaxed">{decision.reason}</p>
          <dl class="grid grid-cols-[max-content_1fr] gap-x-3 gap-y-1">
            {(
              [
                ["Mission", decision.mission],
                ["Objective", decision.objective],
                ["Note", decision.note],
              ] as const
            ).map(([term, text]) => (
              <div key={term} class="contents">
                <dt class="text-muted">{term}</dt>
                <dd>{text || "–"}</dd>
              </div>
            ))}
          </dl>
        </>
      ) : (
        <p class="text-bad">Unreadable answer: {call.error}</p>
      )}
      <p class="text-xs text-faint">frame {call.frame.toLocaleString("en-US")}</p>
    </div>
  );
}

/** The Model call at the cursor on one line. A hover shows its answer. */
function DecisionLine() {
  const { data, shared } = useContext(LabContext);
  const { status, events } = useStore(data);
  const { cursor } = useStore(shared);
  const calls = modelCalls(events).calls;
  const index = callAt(calls, cursor);
  const call = index === null ? null : calls[index];
  const thinking = !cursor && status !== null && callsStarted(status.shown) > calls.length;
  const turn = call && turnOf(call);
  const line = (
    <div class="flex h-11 items-center gap-2.5 rounded-card border border-line bg-surface px-3 text-sm">
      <Pill tone={cursor ? "accent" : "ok"}>{cursor ? `At cursor ${clock(cursor.frame)}` : "Now"}</Pill>
      {call ? (
        <>
          <span class={`max-w-[45%] shrink-0 truncate font-mono ${call.decision ? "text-accent" : "text-bad"}`}>{call.decision?.action ?? "unreadable"}</span>
          <span class="min-w-0 flex-1 truncate text-muted">{call.decision?.reason ?? call.error}</span>
          {turn && <Pill tone={turn.tone}>{turn.text}</Pill>}
        </>
      ) : (
        <span class="flex-1 text-muted">{cursor ? "no Model call at the cursor" : "no Model call yet"}</span>
      )}
      {thinking && <Pill tone="info">the model thinks…</Pill>}
    </div>
  );
  return (
    <div class="flex items-center gap-2">
      <div class="min-w-0 flex-1">{call && index !== null ? <HoverCard card={<CallCard call={call} index={index} count={calls.length} />}>{line}</HoverCard> : line}</div>
      {cursor && (
        <Tooltip text="Back to now (Esc)">
          <Button size="sm" variant="ghost" onClick={() => shared.clear()}>
            Now
          </Button>
        </Tooltip>
      )}
    </div>
  );
}

function Party() {
  const { state } = useStore(useContext(LabContext).data);
  if (!state || state.party.length === 0) return <p class="text-sm text-muted">{state ? "no Pokémon" : "–"}</p>;
  return (
    // 3 × 2 cards; 2 columns when the column is narrow.
    <div class="grid grid-cols-2 gap-2 @min-[460px]:grid-cols-3">
      {state.party.map((mon, i) => (
        <PokemonCard key={i} mon={mon} />
      ))}
    </div>
  );
}

function LiveColumn() {
  const { statusLine } = useStore(useContext(LabContext).data);
  return (
    <div class="flex flex-col gap-3 p-4">
      <Legacy part="screen" />
      <DecisionLine />
      <Party />
      <Legacy part="controls" />
      <p class="font-mono text-xs text-muted">{statusLine}</p>
      <Legacy part="help" />
    </div>
  );
}

// ---- Toasts

type ToastItem = { id: number; tone: Tone; icon: ComponentChildren; title: string; text: string };

const TOAST_MS = 6000;
const MAX_TOASTS = 4;

function Toasts({ toasts, close }: { toasts: Store<ToastItem[]>; close: (id: number) => void }) {
  const items = useStore(toasts);
  return (
    <Toaster>
      {items.map((item) => (
        <Toast key={item.id} tone={item.tone} icon={item.icon} title={item.title} onClose={() => close(item.id)}>
          {item.text}
        </Toast>
      ))}
    </Toaster>
  );
}

/** Events that continue the events before: the same Run, with new events at the end. */
function continues(before: readonly RunEvent[], after: readonly RunEvent[]): boolean {
  const last = before.at(-1);
  const same = after[before.length - 1];
  return last !== undefined && after.length > before.length && same.frame === last.frame && same.type === last.type && after[0].frame === before[0].frame;
}

export class LabTab {
  readonly #data = new Store<LabData>({ status: null, state: null, events: [], statusLine: "connecting…" });
  readonly #toasts = new Store<ToastItem[]>([]);
  #toastId = 0;
  #run = "";

  constructor(root: HTMLElement, toastRoot: HTMLElement, parts: LabParts, shared: SharedCursor) {
    render(
      <LabContext.Provider value={{ data: this.#data, shared, parts }}>
        <LabLayout />
      </LabContext.Provider>,
      root,
    );
    render(<Toasts toasts={this.#toasts} close={(id) => this.#close(id)} />, toastRoot);
  }

  #patch(next: Partial<LabData>): void {
    this.#data.set({ ...this.#data.value, ...next });
  }

  onStatus(status: Status, statusLine: string): void {
    const run = runKey(status.shown);
    // The state of the old Run is not the state of this one: the badges must not shine for it.
    this.#patch({ status, statusLine, ...(run === this.#run ? {} : { state: null }) });
    this.#run = run;
  }

  onState(state: GameState): void {
    this.#patch({ state });
  }

  /** A toast at each new Milestone. All the events of another Run, or of a replay that starts again, show no toast. */
  onEvents(events: readonly RunEvent[]): void {
    const before = this.#data.value.events;
    if (continues(before, events)) {
      for (const event of events.slice(before.length)) {
        if (event.type === "milestone") this.toast({ tone: "accent", icon: <Trophy size={16} />, title: "Milestone", text: `${event.milestone} at ${clock(event.frame)}` });
      }
    }
    this.#patch({ events });
  }

  onStatusLine(statusLine: string): void {
    this.#patch({ statusLine });
  }

  notice(text: string): void {
    this.toast({ tone: "info", icon: <Info size={16} />, title: "Notice", text });
  }

  toast(item: Omit<ToastItem, "id">): void {
    const id = ++this.#toastId;
    this.#toasts.set([...this.#toasts.value, { ...item, id }].slice(-MAX_TOASTS));
    setTimeout(() => this.#close(id), TOAST_MS);
  }

  #close(id: number): void {
    this.#toasts.set(this.#toasts.value.filter((item) => item.id !== id));
  }
}
