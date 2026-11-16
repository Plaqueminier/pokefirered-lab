import { Bot, FolderOpen, GraduationCap, Pause, Play, RotateCcw, Trash2, X } from "lucide-preact";
import { type ComponentChildren, type JSX, render } from "preact";
import { useEffect, useRef } from "preact/hooks";
import { type BotInfo, type ClientMessage, GRID_SIZES, GRID_SPEEDS, type GridSize, type GridSpeed, modelLabel, type ProviderStatus, type RecordFacts, type ServerMessage } from "../src/protocol";
import { shortModelId } from "../src/race/file";
import { Button, Card, LABEL, Pill, Slider, Tabs, type Tone, Tooltip } from "./components";
import { Popover, Select } from "./components-layers";
import { ModelName } from "./components-race";
import { type ScreenFeed, Store, useStore } from "./cursor";
import { type CellState, cellTitle, type GridCell, gridCells, STATE_LOOKS } from "./grid-cells";
import { PartySheet, StarterName, WhiteoutPill } from "./grid-party";
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

function StatePills({ cell }: { cell: GridCell }) {
  const look = STATE_LOOKS[cell.state.kind];
  return (
    <span class="flex min-w-0 items-center gap-1" title={stateLabel(cell.state)}>
      <span class="flex shrink-0">
        <Pill tone={cell.kind === "live" ? "accent" : undefined}>{cell.kind}</Pill>
      </span>
      <span class="flex min-w-0">
        <Pill tone={look.tone}>{look.label}</Pill>
      </span>
    </span>
  );
}

function CellFacts({ cell }: { cell: GridCell }) {
  const model = cell.model && modelLabel(cell.model);
  return (
    <>
      <span class="truncate font-mono" title={cell.record ?? cell.name}>
        {cellTitle(cell)}
      </span>
      <StatePills cell={cell} />
      {cell.names && (
        <span class="truncate" title={`${cell.names.player}, rival ${cell.names.rival}`}>
          {cell.names.player} / {cell.names.rival}
        </span>
      )}
      <span class="truncate text-muted" title={`${cell.bot} · ${model ?? "no model"}`}>
        {model ?? `${cell.bot}, no model`}
      </span>
      <RunFacts cell={cell} />
    </>
  );
}

function RunFacts({ cell }: { cell: GridCell }) {
  return (
    <>
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

type CellProps = { cell: GridCell; index: number; records: readonly string[]; screens: ScreenFeed; botsForm: BotsForm; actions: GridActions };

function ScreenBox({ cell, index, records, screens, botsForm, actions, width }: CellProps & { width: string }) {
  const look = STATE_LOOKS[cell.state.kind];
  return (
    <div class={`relative aspect-[3/2] shrink-0 overflow-hidden rounded-sm border border-line ${width}`}>
      <button type="button" title={`Show ${cell.name} in the Lab tab`} class="block size-full focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-inset focus-visible:ring-accent/35" onClick={() => actions.focus(cell)}>
        <CellScreen runId={cell.runId} screens={screens} />
      </button>
      {look.dim && <ScreenState tone={look.tone} label={stateLabel(cell.state)} />}
      <CellActions cell={cell} index={index} records={records} botsForm={botsForm} actions={actions} />
    </div>
  );
}

function FilledCell(props: CellProps) {
  const { cell, actions } = props;
  return (
    <Card interactive size="sm" fill>
      <div class="group @container-size min-h-0 flex-1">
        <div class="flex h-full flex-col items-center justify-center gap-2 cell-row:flex-row cell-row:gap-3">
          <ScreenBox {...props} width="w-[min(100cqw,(100cqh-8.75rem)*1.5)] cell-row:w-[min(100cqw-9.75rem,150cqh)]" />
          <button type="button" tabIndex={-1} class="flex w-full min-w-0 shrink-0 flex-col gap-0.5 overflow-hidden text-left text-xs leading-4 cell-row:flex-1 cell-row:shrink" onClick={() => actions.focus(cell)}>
            <CellFacts cell={cell} />
          </button>
        </div>
      </div>
    </Card>
  );
}

function RunTitle({ cell }: { cell: GridCell }) {
  const { recordRun, names } = cell;
  const title = [recordRun?.file ?? `${cell.name}: the Run gets its Run id when it writes its Run record`, names && `${names.player}, rival ${names.rival}`].filter(Boolean).join("\n");
  return (
    <span class="flex min-w-0 items-baseline gap-1.5" title={title}>
      {recordRun?.evolution && <span class="shrink-0 text-muted">{recordRun.evolution}</span>}
      <span class="shrink-0 font-mono text-sm font-bold text-accent tabular-nums">#{recordRun?.id ?? "…"}</span>
      {names && <span class="truncate font-semibold">{names.player}</span>}
      {cell.kind === "live" && <span class="shrink-0 text-muted">place {cell.runId}</span>}
    </span>
  );
}

function ModelLines({ cell }: { cell: GridCell }) {
  const { model, bot } = cell;
  const coach = model?.coach?.id;
  return (
    <span class="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-2 self-start">
      <span class="text-muted">player</span>
      {model ? (
        <span class="flex min-w-0" title={model.id}>
          <ModelName id={model.id} short />
        </span>
      ) : (
        <span class="text-muted">{bot}, no model</span>
      )}
      <span class="text-muted">coach</span>
      <span class={`inline-flex min-w-0 items-center gap-1.5 break-all ${coach ? "text-accent" : "text-muted"}`}>
        <GraduationCap size={12} class="shrink-0" />
        {coach ? shortModelId(coach) : "none"}
      </span>
    </span>
  );
}

function PartyCell(props: CellProps) {
  const { cell, actions } = props;
  const ends = cell.whiteoutEnds;
  return (
    <Card interactive size="sm" fill>
      <div class="group @container-size flex min-h-0 flex-1 flex-col gap-2">
        <button type="button" tabIndex={-1} class={`flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 rounded-sm px-2 py-1 text-left text-xs ${ends ? "bg-bad/15" : "bg-raised"}`} onClick={() => actions.focus(cell)}>
          <RunTitle cell={cell} />
          <StatePills cell={cell} />
          {cell.party && <StarterName party={cell.party} />}
          <span class="ml-auto shrink-0">
            <WhiteoutPill ends={ends} />
          </span>
        </button>
        <div class="flex min-h-0 flex-1 flex-col gap-2 cell-row:flex-row cell-row:gap-3">
          <div class="flex min-w-0 flex-col items-center gap-2 cell-row:flex-1 cell-row:items-start">
            {/* The rem values keep the place of the band, the facts and (in a narrow cell) the party. @min-[36rem]: comes after cell-row: in the CSS, so a wide cell repeats its width with both. */}
            <ScreenBox {...props} width="w-[min(100cqw,(100cqh-17rem)*1.5)] @min-[36rem]:w-[min(100cqw,(100cqh-14rem)*1.5)] cell-row:w-[min(100cqw-15rem,(100cqh-8rem)*1.5)] @min-[36rem]:cell-row:w-[min(100cqw-15rem,(100cqh-8rem)*1.5)]" />
            <button type="button" tabIndex={-1} class="flex w-full min-w-0 flex-wrap items-start justify-between gap-x-4 gap-y-1 text-left text-xs leading-4" onClick={() => actions.focus(cell)}>
              <ModelLines cell={cell} />
              <span class="flex min-w-36 flex-col gap-0.5">
                <RunFacts cell={cell} />
              </span>
            </button>
          </div>
          <PartySheet party={cell.party} kind={cell.kind} />
        </div>
      </div>
    </Card>
  );
}

type Layout = { columns: number; rows: string; Cell: (props: CellProps) => JSX.Element };

const PARTY_LAYOUT: Layout = { columns: 2, rows: "auto-rows-[minmax(28rem,auto)] min-[900px]:auto-rows-[minmax(22rem,1fr)]", Cell: PartyCell };

const LAYOUTS: Record<GridSize, Layout> = { 2: PARTY_LAYOUT, 4: PARTY_LAYOUT, 9: { columns: 3, rows: "auto-rows-[minmax(10.25rem,1fr)]", Cell: FilledCell } };

export function GridCellView({ cell, size, ...props }: Omit<CellProps, "cell"> & { cell: GridCell | null; size: GridSize }) {
  const { index, records, actions } = props;
  const { Cell } = LAYOUTS[size];
  if (cell) return <Cell cell={cell} {...props} />;
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
  const layout = LAYOUTS[value.size];
  // Fewer columns in a narrow window: under this width, a cell cannot show its screen and its facts.
  const columns = `repeat(auto-fit, minmax(max(15rem, calc(${100 / layout.columns}% - 0.75rem)), 1fr))`;
  return (
    <div class="flex flex-col min-[900px]:h-full">
      <GridBar data={value} botsForm={botsForm} actions={actions} />
      <div class={`grid min-h-0 flex-1 gap-3 p-4 min-[900px]:overflow-y-auto ${layout.rows}`} style={{ gridTemplateColumns: columns }}>
        {cells.map((cell, index) => (
          <GridCellView key={cell ? `${cell.kind} ${cell.runId}` : `empty ${index}`} cell={cell} size={value.size} index={index} records={value.records} screens={screens} botsForm={botsForm} actions={actions} />
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
