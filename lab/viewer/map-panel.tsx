import { ArrowLeft, ChevronDown, Crosshair, DoorOpen, Info, MapPin, Waypoints } from "lucide-preact";
import type { ComponentChildren } from "preact";
import { useLayoutEffect, useMemo, useRef, useState } from "preact/hooks";
import type { MapActors, MapGrid } from "../src/game";
import { blurClickedButton, Button, Card, KeyList, type KeyRow, LABEL, Legend, ListRow, Pill, Tooltip, toggled } from "./components";
import { HoverCard, PointerCard, Select } from "./components-layers";
import { useStore } from "./cursor";
import { exitList, type StopRow, stopList } from "./map-lists";
import { type CellTip, MAP_SWATCHES } from "./mapdraw";
import type { MapState, WholeMap } from "./whole-map";

export function MapPanel({ map }: { map: WholeMap }) {
  const state = useStore(map.state);
  const canvas = useRef<HTMLCanvasElement>(null);
  useLayoutEffect(() => (canvas.current ? map.attach(canvas.current) : undefined), [map]);
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions lint/a11y/useKeyWithClickEvents: the panel only takes the focus from a clicked button, so Enter goes to the game.
    <div class="@container flex h-full flex-col gap-3" onClick={blurClickedButton}>
      <MapHeader map={map} state={state} />
      <div class="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)] grid-rows-[minmax(240px,1fr)_220px] gap-3 @min-[560px]:grid-cols-[minmax(0,1fr)_17rem] @min-[560px]:grid-rows-1">
        {/* A canvas height from its content gives a ResizeObserver loop. */}
        <div class="flex min-h-0 flex-col">
          <canvas ref={canvas} class="block h-0 min-h-0 w-full flex-1 cursor-grab touch-none rounded-card border border-line bg-bg active:cursor-grabbing" />
        </div>
        <div class="grid min-h-0 grid-cols-2 gap-3 @min-[560px]:flex @min-[560px]:flex-col">
          <Exits map={map} grid={state.grid} />
          <Stops key={state.grid?.key} map={map} grid={state.grid} actors={state.actors} />
        </div>
      </div>
    </div>
  );
}

function MapHeader({ map, state: { grid, preview, follow, names } }: { map: WholeMap; state: MapState }) {
  const options = useMemo(() => [...new Set(names.flat())].sort((a, b) => a.localeCompare(b)).map((name) => ({ value: name, label: name })), [names]);
  return (
    <div class="flex min-h-8 flex-wrap items-center gap-2">
      <span class="flex min-w-0 flex-[1_1_10rem] items-center gap-2">
        <MapPin size={16} class={`shrink-0 ${preview ? "text-info" : "text-accent"}`} />
        <span class="min-w-0 truncate text-base font-semibold">{grid?.name ?? "Whole map"}</span>
        <span class="min-w-0 shrink-1000 truncate text-xs text-muted tabular-nums">
          {grid ? `${preview ? "Preview" : "Map of the player"} · ${grid.mapWidth} × ${grid.mapHeight}` : "No map (menu, battle or transition)"}
        </span>
      </span>
      <span class="ml-auto flex flex-wrap items-center gap-2">
        <span class="w-[240px]">
          <Select
            options={options}
            value=""
            placeholder="Go to a map…"
            searchable={{ placeholder: `Search ${options.length} maps…`, empty: (query) => `No map with “${query}”.` }}
            onChange={(name) => map.search(name)}
          />
        </span>
        {preview && (
          <Button size="sm" variant="ghost" onClick={() => map.back()}>
            <ArrowLeft size={14} />
            Back
          </Button>
        )}
        <Tooltip text={preview ? "Show the map of the player again" : "Keep the player in the middle of the view (double-click on the map: the same)"}>
          <Button size="sm" pressed={follow && !preview} onClick={() => map.toggleFollow()}>
            <Crosshair size={14} />
            {preview ? "Back to the player" : "Follow the player"}
          </Button>
        </Tooltip>
        <HoverCard control card={<MapHelp />}>
          <Button size="icon" variant="ghost" aria-label="Help of the map">
            <Info size={16} />
          </Button>
        </HoverCard>
      </span>
    </div>
  );
}

const MOUSE: KeyRow[] = [
  [["Wheel"], "zoom"],
  [["Drag"], "move"],
  [["Click"], "on a warp or past an edge: see the other map; the player does not move"],
  [["Double-click"], "back to the player"],
];

function MapHelp() {
  return (
    <div class="flex w-[440px] flex-col gap-4">
      <KeyList title="Mouse" rows={MOUSE} />
      <Legend title="Colors" columns={2} items={MAP_SWATCHES} note="Point at a cell to see its data." />
    </div>
  );
}

function ListCard({ title, count, children }: { title: string; count: number; children: ComponentChildren }) {
  return (
    <div class="flex min-h-0 flex-col @min-[560px]:max-h-fit @min-[560px]:flex-[1_1_0]">
      <Card size="sm" fill>
        <span class={`${LABEL} shrink-0 pb-2`}>
          {title} · {count}
        </span>
        <div class="-mr-2 min-h-0 overflow-y-auto pr-1">{children}</div>
      </Card>
    </div>
  );
}

const CELL_CHARS = 8;

function Exits({ map, grid }: { map: WholeMap; grid: MapGrid | null }) {
  const { count, rows } = useMemo(() => (grid ? exitList(grid) : { count: 0, rows: [] }), [grid]);
  return (
    <ListCard title="Exits" count={count}>
      {rows.length === 0 && <p class="px-2 text-xs text-faint">{grid ? "No exit." : "–"}</p>}
      {rows.map((row) => (
        <Tooltip key={row.key} wide text={row.tip}>
          <ListRow
            cells={[{ text: row.cell, chars: CELL_CHARS }]}
            text={`→ ${row.to}`}
            icons={row.edge ? <Waypoints size={13} class="text-faint" /> : <DoorOpen size={13} class="text-faint" />}
            onClick={() => map.viewMap(row.group, row.num)}
          />
        </Tooltip>
      ))}
    </ListCard>
  );
}

function Stops({ map, grid, actors }: { map: WholeMap; grid: MapGrid | null; actors: MapActors | null }) {
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());
  const { count, items } = useMemo(() => (grid ? stopList(grid, actors) : { count: 0, items: [] }), [grid, actors]);
  const row = (stop: StopRow) => (
    <Tooltip key={stop.key} wide text={stop.tip}>
      <ListRow cells={[{ text: `${stop.x}, ${stop.y}`, chars: CELL_CHARS }]} text={stop.text} icons={<Pill tone={stop.tone}>{stop.state}</Pill>} onClick={() => map.centerOn(stop.x, stop.y)} />
    </Tooltip>
  );
  return (
    <ListCard title="What can stop you" count={count}>
      {items.length === 0 && <p class="px-2 text-xs text-faint">{grid ? "Nothing: no trigger and no trainer." : "–"}</p>}
      {items.map((item) => {
        if (item.type === "row") return row(item);
        const shown = open.has(item.key);
        return (
          <div key={item.key} class="flex flex-col">
            <ListRow
              selected={shown}
              cells={[{ text: String(item.rows.length), chars: CELL_CHARS }]}
              text={item.text}
              icons={<ChevronDown size={13} class={`text-faint transition-transform duration-200 ${shown ? "rotate-180" : ""}`} />}
              onClick={() => setOpen(toggled(open, item.key))}
            />
            {shown && <div class="ml-3 flex flex-col border-l border-line pl-1">{item.rows.map(row)}</div>}
          </div>
        );
      })}
    </ListCard>
  );
}

function CellCard({ tip: { facts, link } }: { tip: CellTip }) {
  return (
    <>
      <div class="flex items-center gap-2">
        <span class="text-sm font-semibold tabular-nums">{facts.title}</span>
        {facts.kind && <Pill>{facts.kind}</Pill>}
      </div>
      {facts.facts.length > 0 && (
        <ul class="m-0 flex list-none flex-col gap-1 p-0">
          {facts.facts.map((fact, i) => (
            <li key={`${i}-${fact}`}>{fact}</li>
          ))}
        </ul>
      )}
      {link && (
        <span class="flex items-center gap-1.5 font-semibold text-accent">
          <DoorOpen size={13} />
          Click: see {link}
        </span>
      )}
      {facts.tech && <span class="font-mono text-[10px] text-faint">{facts.tech}</span>}
    </>
  );
}

export function CellPointerCard({ tip }: { tip: CellTip | null }) {
  return <PointerCard at={tip?.at ?? null}>{tip && <CellCard tip={tip} />}</PointerCard>;
}
