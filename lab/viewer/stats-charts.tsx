import type { ComponentChildren, TargetedPointerEvent } from "preact";
import { useRef, useState } from "preact/hooks";
import { REFLECTION_EVERY } from "../src/model/decision";
import { LABEL, Tip, Tooltip, useWidth } from "./components";
import type { SharedCursor, Span } from "./cursor";
import { dollars, tokens } from "./runs";
import { callSpan, costAt, costScale, type GraphWindow, hull, promptAt, type Scope, type Selected, type StatsView, stuckAt } from "./stats-data";
import { clock, spanText, stuckLevel } from "./stats-format";

export type Picks = Pick<SharedCursor, "pickCall" | "pickFrame" | "selectRange" | "clear">;

// `spans` is empty for the whole Run.
export type Graph = {
  view: StatsView;
  part: Selected;
  shown: GraphWindow;
  at: number;
  spans: readonly Span[];
  costLimit: number | null;
  short: string;
  picks: Picks;
};

const INSET = 8;
const DRAG = 4;
const PLOT_HEIGHT = 60;
const AREA_HEIGHT = 26;
const PAD = 3;
const REFLECTION = "stroke-[#b07ae8]";
const AREA_COLORS = ["#5b8def", "#e8643c", "#3fb47a", "#b07ae8", "#e0a85a", "#e05797", "#4fc1c9", "#c9c24f"];

type Axis = { x: (frame: number) => number; frame: (px: number) => number };

function axisOf(width: number, { from, to }: Span): Axis {
  const right = Math.max(INSET + 1, width - INSET);
  const span = Math.max(1, to - from);
  return {
    x: (frame) => INSET + ((frame - from) / span) * (right - INSET),
    frame: (px) => from + Math.round((Math.min(Math.max(px - INSET, 0), right - INSET) / (right - INSET)) * span),
  };
}

// Steps of the same width, not of their duration: in a 10 h Run, the first chapters are too thin to read or click.
export function ChapterSteps({ chapters, at, scope, onScope }: { chapters: StatsView["chapters"]; at: number; scope: Scope; onScope: (scope: Scope) => void }) {
  return (
    <div class="grid grid-cols-[repeat(auto-fill,minmax(100px,1fr))] gap-1">
      {chapters.map((chapter, i) => {
        const on = scope.kind === "chapter" && scope.index === i;
        const done = Math.min(1, Math.max(0, (at - chapter.from) / Math.max(1, chapter.to - chapter.from)));
        return (
          <Tooltip key={chapter.from} text={`${chapter.name} · ${spanText(chapter)}`} wide>
            <button
              type="button"
              aria-pressed={on}
              onClick={() => onScope({ kind: "chapter", index: i })}
              class={`relative flex h-7.5 w-full min-w-0 items-center gap-1.5 overflow-hidden rounded-ctl border px-2 text-left transition-colors focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-accent/35 ${on ? "border-accent bg-raised" : "border-line hover:bg-raised"}`}
            >
              <span class={`min-w-0 truncate text-xs font-semibold ${done > 0 || on ? "text-fg" : "text-faint"}`}>{chapter.name}</span>
              <span class="ml-auto shrink-0 text-[10px] text-faint tabular-nums">{clock(chapter.to - chapter.from)}</span>
              <span class="absolute inset-x-0 bottom-0 h-0.5 bg-track">
                <span class="block h-full bg-accent/70" style={{ width: `${done * 100}%` }} />
              </span>
            </button>
          </Tooltip>
        );
      })}
    </div>
  );
}

function fits(text: string, width: number): boolean {
  return width > text.length * 6.4 + 10;
}

export function AreaRow({ view, extent, at, scope, onScope }: { view: StatsView; extent: Span; at: number; scope: Scope; onScope: (scope: Scope) => void }) {
  const [ref, width] = useWidth();
  const [hover, setHover] = useState<number | null>(null);
  const { x, frame } = axisOf(width, extent);
  const hovered = hover === null ? -1 : view.areas.findIndex((stay) => frame(hover) >= stay.from && frame(hover) <= stay.to);
  const hoveredArea = view.areas[hovered]?.area ?? null;
  const isOn = (index: number) => (scope.kind === "stay" && scope.index === index) || (scope.kind === "area" && scope.area === view.areas[index].area);
  const anyOn = scope.kind === "stay" || scope.kind === "area";
  const visits = hoveredArea === null ? 0 : view.areas.filter((stay) => stay.area === hoveredArea).length;
  // The first click of a double-click selects the visit and moves the axis: the double-click takes the Area of that visit.
  const clicked = useRef<string | null>(null);
  return (
    // A pointer control on the axis of the charts; the keyboard selects with the chapter steps.
    // biome-ignore lint/a11y/useKeyWithClickEvents: see above.
    // biome-ignore lint/a11y/noStaticElementInteractions: see above.
    <div
      ref={ref}
      class="relative cursor-pointer select-none"
      onPointerMove={(event) => setHover(event.clientX - event.currentTarget.getBoundingClientRect().left)}
      onPointerLeave={() => setHover(null)}
      // The clicks of a double-click do not select the visit first.
      onClick={(event) => {
        if (event.detail !== 1 || hovered < 0) return;
        clicked.current = view.areas[hovered].area;
        onScope({ kind: "stay", index: hovered });
      }}
      onDblClick={() => clicked.current !== null && onScope({ kind: "area", area: clicked.current })}
    >
      <svg width={width} height={AREA_HEIGHT} class="block overflow-hidden" aria-hidden="true">
        {view.areas.map((stay, i) => {
          const left = Math.max(x(stay.from), 0);
          const right = Math.min(x(stay.to), width);
          const on = isOn(i);
          return (
            <g key={stay.from}>
              <rect
                x={x(stay.from)}
                y={0}
                width={Math.max(1, x(stay.to) - x(stay.from))}
                height={AREA_HEIGHT}
                style={{ fill: AREA_COLORS[stay.order % AREA_COLORS.length], opacity: on || stay.area === hoveredArea ? 1 : anyOn ? 0.25 : 0.7 }}
                class={on ? "stroke-fg" : "stroke-bg"}
                stroke-width={on ? 1.5 : 1}
              />
              {fits(stay.area, right - left) && (
                <text x={left + 4} y={AREA_HEIGHT / 2 + 4} class="fill-[#101214] text-[11px] font-semibold">
                  {stay.area}
                </text>
              )}
            </g>
          );
        })}
        <line x1={x(at)} x2={x(at)} y1={0} y2={AREA_HEIGHT} class="stroke-accent" stroke-width={1.5} />
      </svg>
      {hover !== null && hovered >= 0 && (
        <Tip x={hover} width={width}>
          {hoveredArea} · {clock(view.areas[hovered].from)} → {clock(view.areas[hovered].to)}
          {visits > 1 && " · double-click: all visits"}
        </Tip>
      )}
    </div>
  );
}

type Pointer = TargetedPointerEvent<HTMLDivElement>;

function usePointer(axis: Axis, { view, picks, shown }: Graph) {
  const [hover, setHover] = useState<number | null>(null);
  const [drag, setDrag] = useState<Span | null>(null);
  const start = useRef<number | null>(null);
  const local = (event: Pointer) => event.clientX - event.currentTarget.getBoundingClientRect().left;
  return {
    hover,
    drag,
    handlers: {
      onPointerDown: (event: Pointer) => {
        if (event.button !== 0) return;
        event.currentTarget.setPointerCapture(event.pointerId);
        start.current = local(event);
      },
      onPointerMove: (event: Pointer) => {
        const px = local(event);
        setHover(px);
        const from = start.current;
        if (from === null || (!drag && Math.abs(px - from) <= DRAG)) return;
        const [a, b] = [axis.frame(from), axis.frame(px)].sort((p, q) => p - q);
        setDrag({ from: a, to: b });
      },
      onPointerUp: () => {
        const from = start.current;
        start.current = null;
        if (from === null) return;
        if (drag) {
          setDrag(null);
          return picks.selectRange(drag);
        }
        const frame = axis.frame(from);
        // A call before the window would move the window of "−2 h" under the pointer.
        const call = view.calls.findLast((c) => c.frame <= frame && (shown.kind !== "last" || c.frame >= shown.extent.from));
        if (call) picks.pickCall(call.index, call.frame);
        else picks.pickFrame(frame);
      },
      onPointerLeave: () => setHover(null),
    },
  };
}

function Marks({ graph, axis, width, drag }: { graph: Graph; axis: Axis; width: number; drag: Span | null }) {
  const { view, spans, at } = graph;
  const { extent } = graph.shown;
  const margins = graph.shown.kind === "zoom";
  const { x } = axis;
  const { from, to } = spans.length > 0 ? hull(spans) : extent;
  return (
    <>
      {extent.to > view.now && <rect x={x(view.now)} y={0} width={Math.max(0, width - x(view.now))} height={PLOT_HEIGHT} class="fill-white/[0.03]" />}
      {view.chapters.slice(0, -1).map((c) => (
        <line key={c.to} x1={x(c.to)} x2={x(c.to)} y1={0} y2={PLOT_HEIGHT} class="stroke-fg/25" stroke-dasharray="3 3" />
      ))}
      {view.parentEnd && <line x1={x(view.parentEnd.frame)} x2={x(view.parentEnd.frame)} y1={0} y2={PLOT_HEIGHT} class={REFLECTION} stroke-dasharray="6 3" />}
      {spans.map((s) => (
        <rect key={s.from} x={x(s.from)} y={0} width={Math.max(2, x(s.to) - x(s.from))} height={PLOT_HEIGHT} class="fill-accent/12" />
      ))}
      {drag && <rect x={x(drag.from)} y={0} width={x(drag.to) - x(drag.from)} height={PLOT_HEIGHT} class="fill-accent/15 stroke-accent/60" />}
      <line x1={x(at)} x2={x(at)} y1={0} y2={PLOT_HEIGHT} class="stroke-accent" stroke-width={1.5} />
      {margins && from > extent.from && <rect x={0} y={0} width={Math.max(0, x(from))} height={PLOT_HEIGHT} class="fill-bg/60" />}
      {margins && to < extent.to && <rect x={x(to)} y={0} width={Math.max(0, width - x(to))} height={PLOT_HEIGHT} class="fill-bg/60" />}
    </>
  );
}

export type ChartKind = "cost" | "stuck" | "prompt";

type Plot = { graph: Graph; axis: Axis; width: number };

const y = (value: number, lo: number, hi: number) => PLOT_HEIGHT - PAD - ((value - lo) / Math.max(hi - lo, 1e-9)) * (PLOT_HEIGHT - 2 * PAD);

// The y scale follows the window, so a zoom keeps the shape of the curves.
function CostPlot({ graph: { view, shown: { extent }, costLimit }, axis: { x }, width }: Plot) {
  const whole = extent.from === 0 && extent.to >= view.now;
  const base = view.parentEnd?.cost ?? 0;
  const scale = costScale(view.cost - base, costLimit, base);
  const lo = whole ? 0 : costAt(view, extent.from);
  const hi = whole ? Math.max(scale.max, 0.0001) * 1.1 : Math.max(costAt(view, extent.to), lo + 0.0001);
  let path = `M ${x(0)} ${y(0, lo, hi)}`;
  for (const step of view.costSteps) path += ` H ${x(step.frame)} V ${y(step.cost, lo, hi)}`;
  path += ` H ${x(view.now)}`;
  const limit = costLimit !== null && scale.limitLine && whole ? y(base + costLimit, lo, hi) : null;
  return (
    <>
      <path d={`${path} V ${PLOT_HEIGHT} H ${x(0)} Z`} class="fill-warn/12" />
      <path d={path} class="fill-none stroke-warn" stroke-width={1.5} />
      {limit !== null && <line x1={0} x2={width} y1={limit} y2={limit} class="stroke-bad" stroke-dasharray="5 4" />}
    </>
  );
}

const STUCK_FILLS = { low: "fill-ok", mid: "fill-warn", high: "fill-bad" };

function StuckPlot({ graph: { view, shown: { extent } }, axis: { x }, width }: Plot) {
  const bars = view.calls.flatMap((c, i) => {
    const { to } = callSpan(view, i);
    return c.stuck === null || to < extent.from || c.frame > extent.to ? [] : [{ call: c, stuck: c.stuck, to }];
  });
  const hi = Math.max(REFLECTION_EVERY, ...bars.map((b) => b.stuck)) * 1.1;
  return (
    <>
      {bars.map(({ call, stuck, to }) =>
        stuck === 0 ? null : (
          <rect key={call.index} x={x(call.frame)} y={y(stuck, 0, hi)} width={Math.max(1, x(to) - x(call.frame))} height={PLOT_HEIGHT - y(stuck, 0, hi)} class={`${STUCK_FILLS[stuckLevel(stuck)]} opacity-80`} />
        ),
      )}
      <line x1={0} x2={width} y1={y(REFLECTION_EVERY, 0, hi)} y2={y(REFLECTION_EVERY, 0, hi)} class={REFLECTION} stroke-dasharray="4 3" />
      {bars
        .filter(({ call }) => call.reflection)
        .map(({ call }) => (
          <line key={call.index} x1={x(call.frame)} x2={x(call.frame)} y1={0} y2={6} class={REFLECTION} stroke-width={2} />
        ))}
    </>
  );
}

function PromptPlot({ graph: { view, shown: { extent } }, axis: { x } }: Plot) {
  const known = view.calls.flatMap(({ frame, prompt }) => (prompt === null ? [] : [{ frame, prompt }]));
  const seen = known.filter((c) => c.frame >= extent.from && c.frame <= extent.to);
  const hi = Math.max(1, ...(seen.length > 0 ? seen : known).map((c) => c.prompt)) * 1.1;
  return <path d={known.map((c, i) => `${i === 0 ? "M" : "L"} ${x(c.frame)} ${y(c.prompt, 0, hi)}`).join(" ")} class="fill-none stroke-info" stroke-width={1.5} />;
}

const kilo = (count: number) => `${(count / 1000).toFixed(1)}k`;

type ChartLook = {
  name: string;
  /** The value at the cursor, the value of the selection, and a note at the right. */
  header: (graph: Graph) => { now: string; part: string; note: string | null };
  hover: (view: StatsView, frame: number) => string;
  Plot: (plot: Plot) => ComponentChildren;
};

function costNote({ view, costLimit }: Graph): string | null {
  const own = view.cost - (view.parentEnd?.cost ?? 0);
  const limit = costLimit === null ? null : `limit ${dollars(costLimit)} · ${Math.round((100 * own) / costLimit)} % used`;
  const continued = view.parentEnd ? `continued at ${clock(view.parentEnd.frame)}` : null;
  return [limit, continued].filter(Boolean).join(" · ") || null;
}

const CHARTS: Record<ChartKind, ChartLook> = {
  cost: {
    name: "Cost",
    header: (graph) => ({ now: dollars(costAt(graph.view, graph.at)), part: `${dollars(graph.part.cost)} in ${graph.short}`, note: costNote(graph) }),
    hover: (view, frame) => `${clock(frame)} · ${dollars(costAt(view, frame))}`,
    Plot: CostPlot,
  },
  stuck: {
    name: "Stuck counter",
    header: ({ view, at, part, short }) => ({
      now: String(stuckAt(view, at) ?? "–"),
      part: part.stuckMax === null ? "–" : `max ${part.stuckMax} in ${short}`,
      note: `reflection at ${REFLECTION_EVERY}`,
    }),
    hover: (view, frame) => `${clock(frame)} · Stuck ${stuckAt(view, frame) ?? "–"}`,
    Plot: StuckPlot,
  },
  prompt: {
    name: "Prompt tokens",
    header: ({ view, at, part, short }) => {
      const now = promptAt(view, at);
      return { now: now === null ? "–" : tokens(now), part: part.prompt ? `${tokens(part.prompt.min)} to ${tokens(part.prompt.max)} in ${short}` : "–", note: null };
    },
    hover: (view, frame) => {
      const prompt = promptAt(view, frame);
      return `${clock(frame)} · ${prompt === null ? "–" : kilo(prompt)} tokens`;
    },
    Plot: PromptPlot,
  },
};

export function Chart({ kind, graph }: { kind: ChartKind; graph: Graph }) {
  const [ref, width] = useWidth();
  const axis = axisOf(width, graph.shown.extent);
  const { hover, drag, handlers } = usePointer(axis, graph);
  const look = CHARTS[kind];
  const head = look.header(graph);
  return (
    <div class="flex min-w-0 flex-col gap-1">
      <div class="flex min-w-0 items-baseline gap-2">
        <span class={`${LABEL} shrink-0`}>{look.name}</span>
        <span class="shrink-0 text-xl font-semibold tabular-nums">{head.now}</span>
        <span class="min-w-0 truncate text-xs text-muted tabular-nums">{head.part}</span>
        {head.note && <span class="ml-auto shrink-0 text-xs text-faint tabular-nums">{head.note}</span>}
      </div>
      <div ref={ref} class="relative cursor-crosshair touch-none select-none rounded-sm bg-white/[0.02]" {...handlers}>
        <svg width={width} height={PLOT_HEIGHT} class="block overflow-hidden" aria-hidden="true">
          <look.Plot graph={graph} axis={axis} width={width} />
          <Marks graph={graph} axis={axis} width={width} drag={drag} />
          {hover !== null && <line x1={hover} x2={hover} y1={0} y2={PLOT_HEIGHT} class="stroke-fg/40" />}
        </svg>
        {hover !== null && (
          <Tip x={hover} width={width}>
            {look.hover(graph.view, axis.frame(hover))}
          </Tip>
        )}
      </div>
    </div>
  );
}

const TICKS = 6;

export function TimeAxis({ extent }: { extent: Span }) {
  const [ref, width] = useWidth();
  const { x } = axisOf(width, extent);
  const ticks: ComponentChildren[] = [];
  for (let i = 0; i <= TICKS; i++) {
    const frame = extent.from + ((extent.to - extent.from) * i) / TICKS;
    const align = i === 0 ? "" : i === TICKS ? "-translate-x-full" : "-translate-x-1/2";
    ticks.push(
      <span key={i} class={`absolute top-0 ${align}`} style={{ left: `${x(frame)}px` }}>
        {clock(frame)}
      </span>,
    );
  }
  return (
    <div ref={ref} class="relative h-4 text-[10px] text-faint tabular-nums">
      {ticks}
    </div>
  );
}
