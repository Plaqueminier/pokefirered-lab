import { ArrowLeft, Backpack, Bot, ChartColumn, Clock, Coins, Info, ListTree, MapPin, Map as MapIcon, MessageSquare, Rewind, Trophy } from "lucide-preact";
import { type ComponentChildren, type ComponentType, createContext, render } from "preact";
import { useContext, useLayoutEffect, useMemo, useRef, useState } from "preact/hooks";
import type { Areas, GameState } from "../src/game";
import type { Continuation, GameEvent, RunEvent } from "../src/harness/record";
import type { InventoryAt } from "../src/inventory";
import { type BotInfo, type ClientMessage, type ProviderStatus, replayOf, type ServerMessage, type ShownRun, SPEND_WORDS, type Spend, type SpendUnit, spentIn } from "../src/protocol";
import { Badges, Button, Card, Cover, Metric, Pill, Tabs, type Tone, Tooltip, usePending } from "./components";
import { HoverCard, Popover, Toast, Toaster } from "./components-layers";
import { callAt, type Readable, type SharedCursor, Store, useStore } from "./cursor";
import { InventoryPanel } from "./inventory-panel";
import { CellPointerCard, MapPanel } from "./map-panel";
import { memoryPanelView } from "./memory-panel";
import { MemoryTreePanel } from "./memory-tree-panel";
import { callsStarted, modelCalls, type UnusualCall, unusualCalls } from "./model-calls";
import { CallSummary, FLAG_LOOKS, ModelPanel, SpendUnitContext } from "./model-panel";
import { PokemonCard } from "./pokemon";
import { BotsPanel, RunSelect, runKey, spendShort } from "./runs";
import { RecordCard } from "./record-card";
import { ScreenControls, type ScreenSettings, type ScreenSettingsActions } from "./screen-controls";
import { clock, stuckTone } from "./stats-format";
import { StatsPanel } from "./stats-panel";
import { availableKinds, Timeline, useStoredKinds } from "./timeline";
import { timelineEvents } from "./timeline-events";
import type { CellTip } from "./mapdraw";
import type { WholeMap } from "./whole-map";

type Status = Extract<ServerMessage, { type: "status" }>;

// The flags of the Model calls, calculated once for each list of events: the panels share them.
type LabData = {
  settings: ScreenSettings;
  status: Status | null;
  state: GameState | null;
  events: readonly RunEvent[];
  rows: readonly UnusualCall[];
  statusLine: string;
  bots: readonly BotInfo[];
  providers: readonly ProviderStatus[];
  records: readonly string[];
  areas: Areas;
  record: { name: string; events: readonly GameEvent[] } | null;
  inventory: readonly InventoryAt[];
};

// What viewer.ts gives to the Lab tab.
type LabOptions = {
  shared: SharedCursor;
  send: (message: ClientMessage) => void;
  map: WholeMap;
  cellTip: Store<CellTip | null>;
  fromGrid: Readable<string | null>;
  backToGrid: () => void;
  settings: ScreenSettings;
  settingsActions: ScreenSettingsActions;
};

type Lab = Omit<LabOptions, "settings"> & { data: Store<LabData> };

const LabContext = createContext<Lab | null>(null);

function useLab(): Lab {
  const lab = useContext(LabContext);
  if (!lab) throw new Error("The Lab tab needs its context.");
  return lab;
}

// A panel with its own DOM in the page: it moves into its place once, and stays in the document.
function Legacy({ id }: { id: string }) {
  const host = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const node = document.getElementById(id);
    if (node) host.current?.append(node);
  }, [id]);
  return <div ref={host} class="legacy contents" />;
}

// The size of a zone or of a panel at each breakpoint: the width of the live column, the height of the top bar and of the panels.
type Sizes = { narrow: string; medium: string; wide: string };

type Entry = { id: string; title: string; icon?: ComponentType<{ size?: number }>; size: Sizes; render: () => ComponentChildren };

const ZONES = {
  top: { id: "top", title: "Top bar", size: { narrow: "3rem", medium: "3rem", wide: "3rem" }, render: () => <TopBar /> },
  live: { id: "live", title: "Live column", size: { narrow: "auto", medium: "40%", wide: "46%" }, render: () => <LiveColumn /> },
} satisfies Record<string, Entry>;

const PANEL: Sizes = { narrow: "75vh", medium: "100%", wide: "100%" };

const RAIL: Entry[] = [
  { id: "map", title: "Whole map", icon: MapIcon, size: PANEL, render: () => <MapPanelHost /> },
  { id: "model", title: "Model", icon: Bot, size: PANEL, render: () => <ModelPanelHost /> },
  { id: "stats", title: "Stats", icon: ChartColumn, size: PANEL, render: () => <StatsPanelHost /> },
  { id: "memory", title: "Memory tree", icon: ListTree, size: PANEL, render: () => <MemoryPanelHost /> },
  { id: "bag", title: "Bag and PC", icon: Backpack, size: PANEL, render: () => <InventoryPanelHost /> },
];

function sizeVars({ narrow, medium, wide }: Sizes): Record<string, string> {
  return { "--narrow": narrow, "--medium": medium, "--wide": wide };
}

function LabLayout() {
  const [shown, setShown] = useState(RAIL[0].id);
  const panel = RAIL.find((entry) => entry.id === shown) ?? RAIL[0];
  return (
    <>
      <GridBackBar />
      {ZONES.top.render()}
      <div class="flex flex-col min-[900px]:min-h-0 min-[900px]:flex-1 min-[900px]:flex-row">
        <section
          aria-label={ZONES.live.title}
          style={sizeVars(ZONES.live.size)}
          class="@container w-(--narrow) shrink-0 min-[900px]:w-(--medium) min-[900px]:overflow-y-auto min-[1280px]:w-(--wide)"
        >
          {ZONES.live.render()}
        </section>
        <nav aria-label="Panels" class="shrink-0 border-y border-line p-2 min-[900px]:border-x min-[900px]:border-y-0">
          <Tabs kind="rail" value={shown} onChange={setShown} items={RAIL.map(({ id, title, icon: Icon }) => ({ id, label: title, icon: Icon && <Icon size={16} /> }))} />
        </nav>
        <div style={sizeVars(panel.size)} class="h-(--narrow) min-w-0 overflow-auto p-4 min-[900px]:h-(--medium) min-[900px]:flex-1 min-[1280px]:h-(--wide)">
          {RAIL.map((entry) => (
            <div key={entry.id} hidden={entry.id !== shown} class="h-full">
              {entry.render()}
            </div>
          ))}
        </div>
      </div>
      <section aria-label="Timeline" class="shrink-0 border-t border-line px-4 py-2">
        <TimelineHost />
      </section>
      <CellPointerCard tip={useStore(useLab().cellTip)} />
    </>
  );
}

function GridBackBar() {
  const { fromGrid, backToGrid, data } = useLab();
  const key = useStore(fromGrid);
  const { status } = useStore(data);
  if (key === null || !status || runKey(status.shown) !== key) return null;
  return (
    <div class="flex h-9 shrink-0 items-center border-b border-line px-2">
      <Button variant="ghost" size="sm" onClick={backToGrid}>
        <ArrowLeft size={14} />
        Grid
      </Button>
    </div>
  );
}

// The events with the Game events: in a replay, those of the whole record. A Run that plays has all the Game events; a replay has them only when its record has the format 1.
function useGameEvents() {
  const { status, events, record } = useStore(useLab().data);
  const replay = replayOf(status?.shown ?? null);
  const source = replay && record?.name === replay.name ? record.events : events;
  const hasGameEvents = !replay || replay.gameEvents !== null;
  const available = useMemo(() => availableKinds(hasGameEvents), [hasGameEvents]);
  return { replay, source, gameEvents: hasGameEvents ? source : null, available };
}

// A click on an event: in a Run that plays, the cursor moves to it; a replay jumps to it, and the cursor returns to now.
function jumpTo({ shared, send }: Lab, replay: boolean, frame: number): void {
  if (!replay) return shared.pickFrame(frame);
  send({ type: "seek", frame });
  shared.clear();
}

// The frame that plays (during a jump, its target), and a jump to a frame.
function usePlaying() {
  const lab = useLab();
  const { status } = useStore(lab.data);
  const replay = replayOf(status?.shown ?? null);
  return { playing: replay?.seeking?.to ?? status?.frame ?? 0, jump: (frame: number) => jumpTo(lab, !!replay, frame) };
}

function TimelineHost() {
  const lab = useLab();
  const { shared } = lab;
  const { status, areas } = useStore(lab.data);
  const { cursor, range } = useStore(shared);
  const [kinds, setKinds] = useStoredKinds();
  const { replay, source, available } = useGameEvents();
  const live = status?.frame ?? 0;
  const shown = useMemo(() => timelineEvents(source, areas), [source, areas]);
  const { playing, jump } = usePlaying();
  const [replayAt, setReplayAt] = usePending(playing, (a, b) => Math.abs(a - b) < 120, 2000);
  return (
    <Timeline
      events={shown}
      end={replay ? replay.frames : Math.max(1, live)}
      at={cursor?.frame ?? (replay ? replayAt : live)}
      cursor={cursor !== null}
      reached={replay ? Math.max(replay.reached, live) : undefined}
      selection={range}
      ended={replay?.ended ? replay.endReason : undefined}
      available={available}
      kinds={kinds}
      onKinds={setKinds}
      onPick={(frame) => {
        if (replay) setReplayAt(frame);
        jump(frame);
      }}
      onRange={(span) => shared.selectRange(span)}
      onNow={() => shared.clear()}
    />
  );
}

function MapPanelHost() {
  return <MapPanel map={useLab().map} />;
}

function StatsPanelHost() {
  const lab = useLab();
  const { status, events, areas, rows } = useStore(lab.data);
  const moment = useStore(lab.shared);
  const [kinds] = useStoredKinds();
  const { gameEvents, available } = useGameEvents();
  const { playing, jump } = usePlaying();
  const shown = status?.shown ?? null;
  const model = shown && modelOf(shown);
  const shownKinds = useMemo(() => new Set([...kinds].filter((kind) => available.has(kind))), [kinds, available]);
  return (
    <StatsPanel
      events={events}
      gameEvents={gameEvents}
      areas={areas}
      rows={rows}
      playing={playing}
      moment={moment}
      limit={model?.limit ?? null}
      continued={model?.continued ?? null}
      kinds={shownKinds}
      picks={lab.shared}
      jump={jump}
    />
  );
}

function RecordButton() {
  const { status } = useStore(useLab().data);
  const replay = replayOf(status?.shown ?? null);
  const button = (
    <Button size="icon" variant="ghost" aria-label="Run record" disabled={!replay}>
      <Info size={16} />
    </Button>
  );
  if (!replay) return <Tooltip text="No replay: choose a Run record in the Run select">{button}</Tooltip>;
  return (
    <HoverCard control card={<RecordCard replay={replay} />}>
      {button}
    </HoverCard>
  );
}

function modelOf(shown: ShownRun): { limit: Spend; continued: Continuation | null } | null {
  if (shown.kind === "bot") return shown.run.model && { limit: shown.run.model.limit, continued: shown.run.continued };
  return shown.replay?.model ? { limit: shown.replay.model.limit, continued: shown.replay.continued } : null;
}

function spentTo(unit: SpendUnit, events: readonly RunEvent[], frame: number, from = 0): number {
  let spent = 0;
  for (let i = from; i < events.length && events[i].frame <= frame; i++) {
    const event = events[i];
    if ("usage" in event) spent += spentIn(unit, event.usage);
  }
  return spent;
}

const MODES = { overworld: "map", battle: "battle", other: "menu" };

function useCursorCall() {
  const { data, shared } = useLab();
  const lab = useStore(data);
  const { cursor } = useStore(shared);
  const calls = useMemo(() => lab.rows.map((row) => row.call), [lab.rows]);
  const waiting = useMemo(() => modelCalls(lab.events).calling, [lab.events]);
  const index = callAt(calls, cursor);
  const calling = !cursor && lab.status !== null && waiting(callsStarted(lab.status.shown));
  const row = index === null ? null : (lab.rows[index] ?? null);
  return { ...lab, cursor, calls, index, calling, row, call: row?.call ?? null };
}

function TopBar() {
  const { send } = useLab();
  const { status, state, events, cursor, calls, index, call, bots, providers, records } = useCursorCall();
  const shown = status?.shown ?? null;
  const model = shown && modelOf(shown);
  const jump = replayOf(shown)?.seeking;
  const frame = cursor?.frame ?? jump?.to ?? status?.frame ?? 0;
  const from = model?.continued?.events ?? 0;
  const unit = model?.limit.unit ?? "dollars";
  const spent = useMemo(() => spentTo(unit, events, cursor ? cursor.frame : Number.POSITIVE_INFINITY, from), [unit, events, cursor, from]);
  return (
    <header
      style={sizeVars(ZONES.top.size)}
      class="@container flex h-(--narrow) shrink-0 items-center gap-5 border-b border-line px-4 min-[900px]:h-(--medium) min-[1280px]:h-(--wide)"
    >
      <span class="flex shrink-0 items-center gap-2">
        <span class="flex w-[300px] shrink-0 items-center gap-1">
          <span class="min-w-0 flex-1">
            <RunSelect shown={shown} runs={status?.runs ?? []} records={records} send={send} />
          </span>
          <RecordButton />
        </span>
        <span class="shrink-0">
          <Popover icon={<Bot size={14} />} label="Bots" title="Start or stop a Bot">
            <BotsPanel shown={shown} bots={bots} providers={providers} records={records} places={status?.places ?? { free: 0, limit: 0 }} send={send} />
          </Popover>
        </span>
      </span>
      <span class="ml-auto flex shrink-0 items-center gap-5">
        {(model || calls.length > 0) && (
          <>
            <span class="shrink-0 @max-[600px]:hidden">
              <Metric
                tip={`${SPEND_WORDS[unit].name} of the Model calls at the cursor${model ? ` / ${SPEND_WORDS[unit].limit.toLowerCase()}` : ""}`}
                icon={<Coins size={14} />}
                value={spendShort({ unit, amount: spent })}
                chars={unit === "tokens" ? 10 : 7}
                detail={model ? `/ ${spendShort(model.limit)}` : undefined}
              />
            </span>
            <span class="shrink-0 @max-[680px]:hidden">
              <Metric tip="Stuck counter at the cursor">
                {call?.stuck === undefined ? (
                  <Pill>Stuck –</Pill>
                ) : (
                  <Pill tone={stuckTone(call.stuck)}>
                    Stuck <span class="inline-block min-w-[2ch] text-right">{call.stuck}</span>
                  </Pill>
                )}
              </Metric>
            </span>
            <span class="shrink-0 @max-[790px]:hidden">
              <Metric
                tip="The Model call at the cursor / all the Model calls"
                icon={<MessageSquare size={14} />}
                value={index === null ? "–" : index + 1}
                chars={4}
                detail={`/ ${calls.length}`}
                detailChars={6}
              />
            </span>
          </>
        )}
        <span class="shrink-0 @max-[915px]:hidden">
          <Badges got={state?.badges ?? null} />
        </span>
        <span class="shrink-0 @max-[990px]:hidden">
          <Metric tip="Money (live)" icon={<span class="text-sm">₽</span>} value={state ? state.money.toLocaleString("en-US") : "–"} chars={7} />
        </span>
        <span class="flex w-[290px] shrink-0 @max-[1300px]:hidden">
          <Metric
            tip={state ? `group ${state.map.group}, map ${state.map.num} · callback2 ${state.context.callback2} · callback1 ${state.context.callback1}` : "no state yet"}
            icon={<MapPin size={14} />}
            value={state?.player ? state.map.name : "–"}
            detail={state?.player ? `${state.player.x}, ${state.player.y}` : ""}
            detailChars={7}
          >
            {state && <Pill>{MODES[state.context.mode]}</Pill>}
          </Metric>
        </span>
        <span class="shrink-0 @max-[1380px]:hidden">
          <Metric tip={`${cursor ? "Cursor" : "Now"}: frame ${frame.toLocaleString("en-US")}`} icon={<Clock size={14} />} value={clock(frame)} chars={7} />
        </span>
      </span>
    </header>
  );
}

function DecisionLine() {
  const { shared } = useLab();
  const { rows, cursor, row, call, calling } = useCursorCall();
  const turns = row?.flags.filter(({ flag }) => flag === "reflection" || flag === "review") ?? [];
  const line = (
    <Card size="sm">
      <div class="flex h-5 items-center gap-2.5 text-sm">
      <Pill tone={cursor ? "accent" : "ok"}>{cursor ? `At cursor ${clock(cursor.frame)}` : "Now"}</Pill>
      {call ? (
        <>
          <span class={`max-w-[45%] shrink-0 truncate font-mono ${call.decision ? "text-accent" : "text-bad"}`}>{call.decision?.action ?? "unreadable"}</span>
          <span class="min-w-0 flex-1 truncate text-muted">{call.decision?.reason ?? call.error}</span>
          {turns.map(({ flag }) => (
            <Pill key={flag} tone={FLAG_LOOKS[flag].tone}>
              {FLAG_LOOKS[flag].label} turn
            </Pill>
          ))}
        </>
      ) : (
        <span class="flex-1 text-muted">{cursor ? "no Model call at the cursor" : "no Model call yet"}</span>
      )}
      {calling && <Pill tone="info">Model call…</Pill>}
      </div>
    </Card>
  );
  const card = row && (
    <div class="w-[420px] max-w-full text-sm">
      <CallSummary row={row} count={rows.length} />
    </div>
  );
  return (
    <div class="flex items-center gap-2">
      <div class="min-w-0 flex-1">{card ? <HoverCard card={card}>{line}</HoverCard> : line}</div>
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

function SpendUnitScope({ children }: { children: ComponentChildren }) {
  const { status } = useStore(useLab().data);
  return <SpendUnitContext.Provider value={(status?.shown && modelOf(status.shown)?.limit.unit) ?? "dollars"}>{children}</SpendUnitContext.Provider>;
}

function ModelPanelHost() {
  const { shared } = useLab();
  const { rows, cursor, index, calling } = useCursorCall();
  return <ModelPanel rows={rows} index={index} following={!cursor} calling={calling} pick={(call, frame) => shared.pickCall(call, frame)} now={() => shared.clear()} />;
}

function MemoryPanelHost() {
  const { data, shared } = useLab();
  const { events } = useStore(data);
  const { cursor, range } = useStore(shared);
  const view = useMemo(() => memoryPanelView(events, cursor, range), [events, cursor, range]);
  return <MemoryTreePanel view={view} following={!cursor} pickCall={(call, frame) => shared.pickCall(call, frame)} now={() => shared.clear()} />;
}

function InventoryPanelHost() {
  const { data, shared } = useLab();
  const { inventory } = useStore(data);
  const { cursor } = useStore(shared);
  const { playing, jump } = usePlaying();
  return <InventoryPanel history={inventory} cursor={cursor?.frame ?? null} playing={playing} now={() => shared.clear()} pick={jump} />;
}

function Party() {
  const { state } = useStore(useLab().data);
  if (!state || state.party.length === 0) return <p class="text-sm text-muted">{state ? "no Pokémon" : "–"}</p>;
  return (
    <div class="grid grid-cols-2 gap-2 @min-[460px]:grid-cols-3">
      {state.party.map((mon, i) => (
        <PokemonCard key={i} mon={mon} />
      ))}
    </div>
  );
}

function Screen() {
  const { status } = useStore(useLab().data);
  const jump = replayOf(status?.shown ?? null)?.seeking;
  const done = jump && status ? Math.max(0, status.frame - jump.from) : 0;
  const total = jump ? Math.max(1, jump.to - jump.from) : 1;
  return (
    <Cover
      busy={!!jump}
      icon={<Rewind size={16} />}
      title={jump ? `Jump to ${clock(jump.to)}` : ""}
      value={done}
      max={total}
      detail={jump ? `${Math.max(0, total - done).toLocaleString("en-US")} frames to play from ${clock(jump.from)}` : undefined}
    >
      <Legacy id="screen" />
    </Cover>
  );
}

function ScreenControlsHost() {
  const { data, send, settingsActions } = useLab();
  const { status, settings } = useStore(data);
  const run = status && { speed: status.speed, paused: status.paused, hasQuickState: status.hasQuickState, botRun: status.shown.kind === "bot", jumping: !!replayOf(status.shown)?.seeking };
  return <ScreenControls run={run} settings={settings} actions={settingsActions} send={send} />;
}

function LiveColumn() {
  const { statusLine } = useStore(useLab().data);
  return (
    <div class="flex flex-col gap-3 p-4">
      <Screen />
      <ScreenControlsHost />
      <DecisionLine />
      <Party />
      <p class="font-mono text-xs text-muted">{statusLine}</p>
    </div>
  );
}

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

export class LabTab {
  readonly #data: Store<LabData>;
  readonly #toasts = new Store<ToastItem[]>([]);
  #toastId = 0;

  constructor(root: HTMLElement, toastRoot: HTMLElement, { settings, ...lab }: LabOptions) {
    this.#data = new Store<LabData>({ settings, status: null, state: null, events: [], rows: [], statusLine: "connecting…", bots: [], providers: [], records: [], areas: {}, record: null, inventory: [] });
    render(
      <LabContext.Provider value={{ ...lab, data: this.#data }}>
        <SpendUnitScope>
          <LabLayout />
        </SpendUnitScope>
      </LabContext.Provider>,
      root,
    );
    render(<Toasts toasts={this.#toasts} close={(id) => this.#close(id)} />, toastRoot);
  }

  onSettings(settings: ScreenSettings): void {
    this.#patch({ settings });
  }

  onAreas(areas: Areas): void {
    this.#patch({ areas });
  }

  onReplayEvents(name: string, events: readonly GameEvent[]): void {
    this.#patch({ record: { name, events } });
  }

  onBots(bots: readonly BotInfo[], providers: readonly ProviderStatus[]): void {
    this.#patch({ bots, providers });
  }

  onRecords(records: readonly string[]): void {
    this.#patch({ records });
  }

  #patch(next: Partial<LabData>): void {
    this.#data.set({ ...this.#data.value, ...next });
  }

  onStatus(status: Status, statusLine: string, runChanged: boolean): void {
    this.#patch({ status, statusLine, ...(runChanged ? { state: null } : {}) });
  }

  onState(state: GameState): void {
    this.#patch({ state });
  }

  onInventory(from: number, entries: readonly InventoryAt[]): void {
    this.#patch({ inventory: [...this.#data.value.inventory.slice(0, from), ...entries] });
  }

  // The added events are null when the events restarted, or after a jump: no toast for the old events.
  onEvents(events: readonly RunEvent[], added: readonly RunEvent[] | null): void {
    for (const event of added ?? []) {
      if (event.type === "milestone") this.#toast({ tone: "accent", icon: <Trophy size={16} />, title: "Milestone", text: `${event.milestone} at ${clock(event.frame)}` });
    }
    this.#patch({ events, rows: unusualCalls(events) });
  }

  onStatusLine(statusLine: string): void {
    this.#patch({ statusLine });
  }

  notice(text: string): void {
    this.#toast({ tone: "info", icon: <Info size={16} />, title: "Notice", text });
  }

  #toast(item: Omit<ToastItem, "id">): void {
    const id = ++this.#toastId;
    this.#toasts.set([...this.#toasts.value, { ...item, id }].slice(-MAX_TOASTS));
    setTimeout(() => this.#close(id), TOAST_MS);
  }

  #close(id: number): void {
    this.#toasts.set(this.#toasts.value.filter((item) => item.id !== id));
  }
}
