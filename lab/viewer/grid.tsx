import { Bot, FolderOpen, Pause, Play, RotateCcw, Trash2, X } from "lucide-preact";
import { type ComponentChildren, render } from "preact";
import { useEffect, useRef } from "preact/hooks";
import { type BotInfo, type ClientMessage, GRID_SIZES, GRID_SPEEDS, type GridSize, type GridSpeed, type ProviderStatus, type RecordFacts, type ServerMessage } from "../src/protocol";
import { Button, Card, LABEL, Pill, Slider, Tabs, type Tone, Tooltip } from "./components";
import { Popover, Select } from "./components-layers";
import { type ScreenFeed, Store, useStore } from "./cursor";
import { type CellState, cellTitle, type GridCell, gridCells, STATE_LOOKS } from "./grid-cells";
import { spendText } from "../src/protocol";
import { BotsPanel, botRunKey, replayKey } from "./runs";
import { clock } from "./stats-format";

type Status = Extract<ServerMessage, { type: "status" }>;

type GridData = { status: Status | null; records: readonly string[]; facts: Readonly<Record<string, RecordFacts>>; bots: readonly BotInfo[]; providers: readonly ProviderStatus[]; size: GridSize; visible: boolean };

/** The form "Bots", open on a Run record to continue it in the same Run. */
export type BotsForm = (continued?: string) => ComponentChildren;

export type GridActions = {
  setSize: (size: GridSize) => void;
  focus: (cell: GridCell) => void;
  send: (message: ClientMessage) => void;
};

const COLUMNS: Record<GridSize, number> = { 2: 2, 4: 2, 9: 3 };

const SIZE_TABS = GRID_SIZES.map((size) => ({ id: String(size), label: `${size} cells` }));

const SPEED_TABS = GRID_SPEEDS.map((speed) => ({ id: String(speed), label: `×${speed}` }));

const SIZE_OF_TAB = new Map(GRID_SIZES.map((size) => [String(size), size]));

const SPEED_OF_TAB = new Map(GRID_SPEEDS.map((speed) => [String(speed), speed]));

export function ScreenState({ tone, label }: { tone: Tone; label: string }) {
  return (
    <div class="pointer-events-none absolute inset-0 flex items-center justify-center bg-bg/60">
      <span class="flex max-w-[calc(100%-0.5rem)] rounded-full bg-bg">
        <Pill tone={tone}>{label}</Pill>
      </span>
    </div>
  );
}

function stateLabel(state: CellState): string {
  return state.kind === "ended" ? `ended: ${state.result}` : STATE_LOOKS[state.kind].label;
}

function cellsOf({ status, size }: GridData): (GridCell | null)[] {
  if (!status) return Array.from({ length: size }, () => null);
  return gridCells(size, status.runs, status.grid.replays, status.grid.cursor.frame);
}

function IconAction({ tip, disabled, pressed, onClick, children }: { tip: string; disabled?: boolean; pressed?: boolean; onClick: () => void; children: ComponentChildren }) {
  return (
    <Tooltip text={tip}>
      <Button size="icon" variant="ghost" aria-label={tip} disabled={disabled} pressed={pressed} onClick={onClick}>
        {children}
      </Button>
    </Tooltip>
  );
}

function RecordSelect({ index, records, send }: { index: number; records: readonly string[]; send: GridActions["send"] }) {
  return (
    <Select
      options={records.map((name) => ({ value: name, label: name }))}
      value=""
      placeholder="Replay a Run record"
      title="Put a Run record in this cell"
      searchable={{ placeholder: "Find a Run record", empty: (query) => `No Run record with "${query}"` }}
      onChange={(name) => send({ type: "grid-add", name, cell: index })}
    />
  );
}

function CellScreen({ runId, screens }: { runId: number; screens: ScreenFeed }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const context = canvas.current?.getContext("2d");
    if (!context) return;
    const image = context.createImageData(240, 160);
    return screens.subscribe(runId, (screen) => {
      image.data.set(screen);
      context.putImageData(image, 0, 0);
    });
  }, [runId, screens]);
  return <canvas ref={canvas} width={240} height={160} class="block size-full bg-bg object-contain [image-rendering:pixelated]" />;
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <span class="flex min-w-0 justify-between gap-2">
      <span class="shrink-0 text-muted">{label}</span>
      <span class="min-w-0 truncate font-mono tabular-nums" title={value}>
        {value}
      </span>
    </span>
  );
}

function CellFacts({ cell }: { cell: GridCell }) {
  const { state } = cell;
  const look = STATE_LOOKS[state.kind];
  return (
    <>
      <span class="truncate font-mono" title={cell.record ?? cell.name}>
        {cellTitle(cell)}
      </span>
      <span class="flex min-w-0 items-center gap-1" title={stateLabel(state)}>
        <span class="flex shrink-0">
          <Pill tone={cell.kind === "live" ? "accent" : undefined}>{cell.kind}</Pill>
        </span>
        <span class="flex min-w-0">
          <Pill tone={look.tone}>{look.label}</Pill>
        </span>
      </span>
      {cell.names && (
        <span class="truncate" title={`${cell.names.player}, rival ${cell.names.rival}`}>
          {cell.names.player} / {cell.names.rival}
        </span>
      )}
      <span class="truncate text-muted" title={`${cell.bot} · ${cell.model ?? "no model"}`}>
        {cell.model ?? `${cell.bot}, no model`}
      </span>
      <Fact label="time" value={clock(cell.frame)} />
      <Fact label="Milestone" value={cell.milestone ?? "–"} />
      <Fact label="spent" value={cell.spent ? spendText(cell.spent) : "–"} />
    </>
  );
}

function CellActions({ cell, index, records, botsForm, actions }: { cell: GridCell; index: number; records: readonly string[]; botsForm: BotsForm; actions: GridActions }) {
  const ended = cell.state.kind === "ended";
  const removeRun = cell.kind === "live" && ended;
  const { record } = cell;
  return (
    <>
      <span class={`absolute top-1 right-1 flex gap-1 rounded-ctl bg-bg/70 transition-opacity duration-200 group-focus-within:opacity-100 group-hover:opacity-100 has-[:popover-open]:opacity-100 ${removeRun ? "" : "opacity-0"}`}>
        <Popover icon={<FolderOpen size={14} />} label={<span class="sr-only">Record</span>} title="Put a Run record in this cell">
          <span class="flex w-72 flex-col gap-2">
            <span class={LABEL}>Replay in this cell</span>
            <RecordSelect index={index} records={records} send={actions.send} />
          </span>
        </Popover>
        {cell.kind === "replay" && (
          <IconAction tip="Take the Run record out of the Grid" onClick={() => actions.send({ type: "grid-remove", cell: index })}>
            <X size={14} />
          </IconAction>
        )}
        {removeRun && (
          <IconAction tip="Take the ended Run out of the Grid and of the Run select. Its Run record stays." onClick={() => actions.send({ type: "remove-run", runId: cell.runId })}>
            <X size={14} />
          </IconAction>
        )}
      </span>
      {ended && record && (
        <span class="absolute inset-x-1 bottom-1 flex justify-center gap-1">
          <span class="rounded-ctl bg-bg/70">
            <IconAction tip="Replay the Run record in this cell, with the other replays of the Grid" onClick={() => actions.send({ type: "grid-add", name: record, cell: index })}>
              <RotateCcw size={14} />
            </IconAction>
          </span>
          <span class="min-w-0">
            <Popover icon={<Play size={14} />} label={<span class="@max-[24rem]:sr-only">Continue</span>} title="Play on from the end of this Run record">
              {botsForm(record)}
            </Popover>
          </span>
        </span>
      )}
    </>
  );
}

function FilledCell({ cell, index, records, screens, botsForm, actions }: { cell: GridCell; index: number; records: readonly string[]; screens: ScreenFeed; botsForm: BotsForm; actions: GridActions }) {
  const { state } = cell;
  const look = STATE_LOOKS[state.kind];
  const showRun = () => actions.focus(cell);
  return (
    <Card interactive size="sm" fill>
      <div class="group @container-size min-h-0 flex-1">
        <div class="flex h-full flex-col items-center justify-center gap-2 cell-row:flex-row cell-row:gap-3">
          <div class="relative aspect-[3/2] w-[min(100cqw,(100cqh-8.75rem)*1.5)] shrink-0 overflow-hidden rounded-sm border border-line cell-row:w-[min(100cqw-9.75rem,150cqh)]">
            <button type="button" title={`Show ${cell.name} in the Lab tab`} class="block size-full focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-inset focus-visible:ring-accent/35" onClick={showRun}>
              <CellScreen runId={cell.runId} screens={screens} />
            </button>
            {look.dim && <ScreenState tone={look.tone} label={stateLabel(state)} />}
            <CellActions cell={cell} index={index} records={records} botsForm={botsForm} actions={actions} />
          </div>
          <button type="button" tabIndex={-1} class="flex w-full min-w-0 shrink-0 flex-col gap-0.5 overflow-hidden text-left text-xs leading-4 cell-row:flex-1 cell-row:shrink" onClick={showRun}>
            <CellFacts cell={cell} />
          </button>
        </div>
      </div>
    </Card>
  );
}

export function GridCellView({ cell, index, records, screens, botsForm, actions }: { cell: GridCell | null; index: number; records: readonly string[]; screens: ScreenFeed; botsForm: BotsForm; actions: GridActions }) {
  if (cell) return <FilledCell cell={cell} index={index} records={records} screens={screens} botsForm={botsForm} actions={actions} />;
  return (
    <Card size="sm" fill>
      <div class="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 rounded-sm border border-dashed border-line p-2">
        <span class="text-sm text-muted">empty</span>
        <span class="w-64 max-w-full">
          <RecordSelect index={index} records={records} send={actions.send} />
        </span>
      </div>
    </Card>
  );
}

function GridBar({ data, botsForm, actions }: { data: GridData; botsForm: BotsForm; actions: GridActions }) {
  const { send } = actions;
  const ended = data.status?.runs.filter((run) => !run.playing) ?? [];
  const grid = data.status?.grid ?? null;
  const cursor = grid?.cursor ?? null;
  const off = !grid || grid.replays.length === 0;
  const changeSpeed = (id: string) => {
    const speed: GridSpeed | undefined = SPEED_OF_TAB.get(id);
    if (speed !== undefined) send({ type: "grid-cursor", speed });
  };
  return (
    <div class="flex flex-wrap items-center gap-x-5 gap-y-2 border-b border-line px-4 py-2">
      <Tabs kind="segmented" items={SIZE_TABS} value={String(data.size)} onChange={(id) => actions.setSize(SIZE_OF_TAB.get(id) ?? data.size)} />
      <Popover icon={<Bot size={14} />} label="Bots" title="Start or stop a Bot">
        {botsForm()}
      </Popover>
      {ended.length > 0 && (
        <Button title="Take all the ended Runs out of the Grid and of the Run select. Their Run records stay." onClick={() => ended.forEach((run) => send({ type: "remove-run", runId: run.id }))}>
          <Trash2 size={14} />
          Remove {ended.length} ended
        </Button>
      )}
      <span class="flex items-center gap-2">
        <span class={LABEL}>Replays</span>
        <IconAction tip={cursor?.paused ? "Play" : "Pause"} pressed={cursor?.paused} disabled={off} onClick={() => send({ type: "grid-cursor", paused: !cursor?.paused })}>
          {cursor?.paused ? <Play size={16} /> : <Pause size={16} />}
        </IconAction>
        <Tabs kind="segmented" items={SPEED_TABS} value={String(cursor?.speed ?? 1)} disabled={off} onChange={changeSpeed} />
      </span>
      <span class="min-w-48 flex-1">
        <Slider label="Grid cursor" value={cursor?.frame ?? 0} max={Math.max(1, cursor?.end ?? 0)} format={clock} disabled={off} onSeek={(frame) => send({ type: "grid-cursor", frame })} />
      </span>
      <span class="font-mono text-xs text-muted tabular-nums">
        {clock(cursor?.frame ?? 0)} / {clock(cursor?.end ?? 0)}
      </span>
      {data.status && <span class="text-xs text-muted">{data.status.places.free} of {data.status.places.limit} places free</span>}
    </div>
  );
}

function GridView({ data, screens, actions }: { data: Store<GridData>; screens: ScreenFeed; actions: GridActions }) {
  const value = useStore(data);
  const cells = cellsOf(value);
  const { status } = value;
  const botsForm: BotsForm = (continued) => (
    <BotsPanel
      shown={status?.shown ?? null}
      runs={status?.runs ?? []}
      bots={value.bots}
      providers={value.providers}
      records={value.records}
      recordFacts={value.facts}
      places={status?.places ?? { free: 0, limit: 0 }}
      initial={continued === undefined ? undefined : { from: continued, sameRun: true }}
      send={actions.send}
    />
  );
  // Fewer columns in a narrow window: under this width, a cell cannot show its screen and its facts.
  const columns = `repeat(auto-fit, minmax(max(15rem, calc(${100 / COLUMNS[value.size]}% - 0.75rem)), 1fr))`;
  return (
    <div class="flex flex-col min-[900px]:h-full">
      <GridBar data={value} botsForm={botsForm} actions={actions} />
      <div class="grid min-h-0 flex-1 gap-3 p-4 min-[900px]:overflow-y-auto" style={{ gridTemplateColumns: columns, gridAutoRows: "minmax(10.25rem, 1fr)" }}>
        {cells.map((cell, index) => (
          <GridCellView key={cell ? `${cell.kind} ${cell.runId}` : `empty ${index}`} cell={cell} index={index} records={value.records} screens={screens} botsForm={botsForm} actions={actions} />
        ))}
      </div>
    </div>
  );
}

type GridOptions = {
  send: (message: ClientMessage) => void;
  screens: ScreenFeed;
  openLab: () => void;
  fromGrid: Store<string | null>;
};

export class GridTab {
  readonly #data = new Store<GridData>({ status: null, records: [], facts: {}, bots: [], providers: [], size: 4, visible: false });
  #followed: string | null = null;

  constructor(
    root: HTMLElement,
    private readonly options: GridOptions,
  ) {
    const actions: GridActions = { send: options.send, setSize: (size) => this.#setSize(size), focus: (cell) => this.#focus(cell) };
    render(<GridView data={this.#data} screens={options.screens} actions={actions} />, root);
  }

  onStatus(status: Status): void {
    this.#patch({ status });
  }

  onRecords(records: readonly string[], facts: Readonly<Record<string, RecordFacts>>): void {
    this.#patch({ records, facts });
  }

  onBots(bots: readonly BotInfo[], providers: readonly ProviderStatus[]): void {
    this.#patch({ bots, providers });
  }

  onTab(visible: boolean): void {
    this.#patch({ visible });
  }

  onOpen(): void {
    this.#followed = null;
    this.#follow();
  }

  #patch(next: Partial<GridData>): void {
    this.#data.set({ ...this.#data.value, ...next });
    this.#follow();
  }

  #follow(): void {
    const value = this.#data.value;
    const runIds = value.visible ? cellsOf(value).flatMap((cell) => (cell ? [cell.runId] : [])) : [];
    const key = `${value.size}: ${runIds.join(" ")}`;
    if (key === this.#followed) return;
    this.#followed = key;
    this.options.send({ type: "follow", runIds, size: value.size });
  }

  #setSize(size: GridSize): void {
    for (const replay of this.#data.value.status?.grid.replays ?? []) if (replay.cell >= size) this.options.send({ type: "grid-remove", cell: replay.cell });
    this.#patch({ size });
  }

  #focus(cell: GridCell): void {
    const { send, fromGrid, openLab } = this.options;
    if (cell.kind === "live") {
      send({ type: "show", runId: cell.runId });
      fromGrid.set(botRunKey(cell.runId));
    } else {
      send({ type: "replay", name: cell.name });
      send({ type: "seek", frame: this.#data.value.status?.grid.cursor.frame ?? 0 });
      fromGrid.set(replayKey(cell.name));
    }
    openLab();
  }
}
