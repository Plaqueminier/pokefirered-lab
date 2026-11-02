import { FolderOpen, Pause, Play, RotateCcw, X } from "lucide-preact";
import { type ComponentChildren, render } from "preact";
import { useEffect, useRef } from "preact/hooks";
import { type ClientMessage, GRID_SIZES, GRID_SPEEDS, type GridSize, type GridSpeed, type ServerMessage } from "../src/protocol";
import { Button, Card, LABEL, Pill, Slider, Tabs, type Tone, Tooltip } from "./components";
import { Popover, Select } from "./components-layers";
import { type ScreenFeed, Store, useStore } from "./cursor";
import { type CellState, type GridCell, gridCells } from "./grid-cells";
import { SPEND_WORDS, spendText } from "../src/protocol";
import { botRunKey, replayKey } from "./runs";
import { clock } from "./stats-format";

type Status = Extract<ServerMessage, { type: "status" }>;

type GridData = { status: Status | null; records: readonly string[]; size: GridSize; visible: boolean };

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

const STATE_LOOKS: Record<CellState["kind"], { tone: Tone; label: string }> = {
  plays: { tone: "ok", label: "plays" },
  waits: { tone: "warn", label: "waits for the model" },
  battle: { tone: "info", label: "in battle" },
  ended: { tone: "bad", label: "ended" },
};

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
  return <canvas ref={canvas} width={240} height={160} class="block aspect-[3/2] w-full bg-bg [image-rendering:pixelated]" />;
}

function Fact({ label, value, shrink }: { label: string; value: string; shrink?: boolean }) {
  return (
    <span class={shrink ? "min-w-0 truncate" : "shrink-0"}>
      <span class="text-faint">{label}</span> <span class="font-mono tabular-nums">{value}</span>
    </span>
  );
}

function FilledCell({ cell, index, records, screens, actions }: { cell: GridCell; index: number; records: readonly string[]; screens: ScreenFeed; actions: GridActions }) {
  const { state } = cell;
  const look = STATE_LOOKS[state.kind];
  const dim = state.kind === "waits" || state.kind === "ended";
  const replayRecord = cell.kind === "live" && state.kind === "ended" ? cell.record : null;
  return (
    <Card interactive size="sm">
      <div class="relative flex flex-col gap-2.5">
        <button
          type="button"
          title={`Show ${cell.name} in the Lab tab`}
          class="flex min-w-0 flex-col gap-1.5 rounded-sm text-left focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-accent/35"
          onClick={() => actions.focus(cell)}
        >
          <div class="relative overflow-hidden rounded-sm border border-line">
            <CellScreen runId={cell.runId} screens={screens} />
            {dim && (
              <div class="absolute inset-0 flex items-center justify-center bg-bg/60">
                <span class="rounded-full bg-bg">
                  <Pill tone={look.tone}>{stateLabel(state)}</Pill>
                </span>
              </div>
            )}
          </div>
          <span class="truncate font-mono text-xs" title={cell.name}>
            {cell.name.replace(/\.json$/, "")}
          </span>
          <span class="flex min-w-0 items-center gap-1.5">
            <Pill tone={cell.kind === "live" ? "accent" : undefined}>{cell.kind}</Pill>
            <Pill tone={look.tone}>{look.label}</Pill>
            <span class="min-w-0 truncate text-xs text-muted" title={cell.names ? `${cell.names.player}, rival ${cell.names.rival}` : undefined}>
              {cell.names && `${cell.names.player} / ${cell.names.rival} · `}
              {cell.bot} · {cell.model ?? "no model"}
            </span>
          </span>
          <span class="flex gap-3 text-xs">
            <Fact label="time" value={clock(cell.frame)} />
            <Fact label="Milestone" value={cell.milestone ?? "–"} shrink />
            <Fact label={SPEND_WORDS[cell.spent?.unit ?? "dollars"].name.toLowerCase()} value={cell.spent ? spendText(cell.spent) : "–"} />
          </span>
        </button>
        <span class="absolute top-1.5 right-1.5 flex gap-1 rounded-ctl bg-bg/70">
          <Popover icon={<FolderOpen size={14} />} label="Record" title="Put a Run record in this cell">
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
        </span>
        {replayRecord && (
          <span>
            <Button size="sm" title="Replay the Run record in this cell, with the other replays of the Grid" onClick={() => actions.send({ type: "grid-add", name: replayRecord, cell: index })}>
              <RotateCcw size={12} />
              Replay
            </Button>
          </span>
        )}
      </div>
    </Card>
  );
}

export function GridCellView({ cell, index, records, screens, actions }: { cell: GridCell | null; index: number; records: readonly string[]; screens: ScreenFeed; actions: GridActions }) {
  if (cell) return <FilledCell cell={cell} index={index} records={records} screens={screens} actions={actions} />;
  return (
    <Card size="sm">
      <div class="flex aspect-[3/2] flex-col items-center justify-center gap-3 rounded-sm border border-dashed border-line">
        <span class="text-sm text-muted">empty</span>
        <span class="w-64 max-w-full">
          <RecordSelect index={index} records={records} send={actions.send} />
        </span>
      </div>
    </Card>
  );
}

function GridBar({ data, actions }: { data: GridData; actions: GridActions }) {
  const { send } = actions;
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
  const columns = COLUMNS[value.size];
  const rows = value.size / columns;
  const maxWidth = `max(20rem, calc((100dvh - 8rem - ${rows * 6}rem) * ${(1.5 * columns) / rows}))`;
  return (
    <>
      <GridBar data={value} actions={actions} />
      <div class="mx-auto grid w-full gap-3 p-4" style={{ maxWidth, gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}>
        {cells.map((cell, index) => (
          <GridCellView key={cell ? `${cell.kind} ${cell.runId}` : `empty ${index}`} cell={cell} index={index} records={value.records} screens={screens} actions={actions} />
        ))}
      </div>
    </>
  );
}

type GridOptions = {
  send: (message: ClientMessage) => void;
  screens: ScreenFeed;
  openLab: () => void;
  fromGrid: Store<string | null>;
};

export class GridTab {
  readonly #data = new Store<GridData>({ status: null, records: [], size: 4, visible: false });
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

  onRecords(records: readonly string[]): void {
    this.#patch({ records });
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
