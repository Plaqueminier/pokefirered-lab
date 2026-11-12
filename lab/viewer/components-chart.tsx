import type { ComponentChildren } from "preact";
import { useState } from "preact/hooks";
import { LABEL, useWidth } from "./components";

export type GenerationPoint = { generation: number; best: number; mean: number; newBest: boolean };

const HEIGHT = 220;
const LEFT = 40;
const RIGHT = 10;
const TOP = 8;
const BOTTOM = 18;
const MAX_TICKS = 8;

type Scale = { x: (i: number) => number; y: (value: number) => number; index: (px: number) => number; lo: number; hi: number };

function scaleOf(points: readonly GenerationPoint[], width: number): Scale {
  const values = points.flatMap((p) => [p.best, p.mean]);
  const lo = Math.min(0, ...values);
  const top = Math.max(...values);
  const hi = top > lo ? top + (top - lo) * 0.08 : lo + 1;
  const span = Math.max(1, width - LEFT - RIGHT);
  const step = points.length > 1 ? span / (points.length - 1) : 0;
  const x = (i: number) => (points.length > 1 ? LEFT + i * step : LEFT + span / 2);
  return {
    x,
    y: (value) => TOP + (1 - (value - lo) / (hi - lo)) * (HEIGHT - TOP - BOTTOM),
    index: (px) => (points.length > 1 ? Math.min(points.length - 1, Math.max(0, Math.round((px - LEFT) / step))) : 0),
    lo,
    hi,
  };
}

function line(points: readonly GenerationPoint[], { x, y }: Scale, value: (p: GenerationPoint) => number): string {
  return points.map((p, i) => `${i === 0 ? "M" : "L"} ${x(i)} ${y(value(p))}`).join(" ");
}

function Axes({ points, scale, width, format }: { points: readonly GenerationPoint[]; scale: Scale; width: number; format: (value: number) => string }) {
  const every = Math.ceil(points.length / MAX_TICKS);
  const rows = [scale.lo, (scale.lo + scale.hi) / 2, scale.hi];
  return (
    <>
      {rows.map((value) => (
        <g key={value}>
          <line x1={LEFT} x2={width - RIGHT} y1={scale.y(value)} y2={scale.y(value)} class="stroke-line" />
          <text x={LEFT - 6} y={scale.y(value) + 3} text-anchor="end" class="fill-faint text-[10px] tabular-nums">
            {format(value)}
          </text>
        </g>
      ))}
      {scale.lo < 0 && <line x1={LEFT} x2={width - RIGHT} y1={scale.y(0)} y2={scale.y(0)} class="stroke-line-strong" />}
      {points.map((p, i) =>
        i % every === 0 || i === points.length - 1 ? (
          <text key={p.generation} x={scale.x(i)} y={HEIGHT - 4} text-anchor="middle" class="fill-faint text-[10px] tabular-nums">
            {p.generation}
          </text>
        ) : null,
      )}
    </>
  );
}

function Values({ point, format }: { point: GenerationPoint; format: (value: number) => string }) {
  return (
    <>
      Generation {point.generation} · best <span class="text-accent">{format(point.best)}</span> · mean <span class="text-info">{format(point.mean)}</span>
    </>
  );
}

export function GenerationChart({
  points,
  label,
  format = (value) => value.toFixed(1),
  pickText,
  onPick,
}: {
  points: readonly GenerationPoint[];
  label: string;
  format?: (value: number) => string;
  pickText?: string;
  onPick?: (generation: number) => void;
}) {
  const [ref, width] = useWidth();
  const [hover, setHover] = useState<number | null>(null);
  const scale = scaleOf(points, width);
  const hovered = hover === null || points.length === 0 ? null : scale.index(hover);
  const last = points.at(-1);
  let body: ComponentChildren;
  if (points.length === 0) body = <div class="grid place-items-center text-sm text-muted" style={{ height: `${HEIGHT}px` }}>No Generation yet.</div>;
  else
    body = (
      <svg width={width} height={HEIGHT} class="block overflow-visible" aria-hidden="true">
        <Axes points={points} scale={scale} width={width} format={format} />
        <path d={`${line(points, scale, (p) => p.best)} V ${scale.y(scale.lo)} H ${scale.x(0)} Z`} class="fill-accent/8" />
        <path d={line(points, scale, (p) => p.mean)} class="fill-none stroke-info" stroke-width={1.5} stroke-linejoin="round" />
        <path d={line(points, scale, (p) => p.best)} class="fill-none stroke-accent" stroke-width={2} stroke-linejoin="round" />
        {points.length === 1 && <circle cx={scale.x(0)} cy={scale.y(points[0].mean)} r={3} class="fill-info" />}
        {points.map((p, i) => (p.newBest || points.length === 1 ? <circle key={p.generation} cx={scale.x(i)} cy={scale.y(p.best)} r={4} class="fill-accent stroke-bg" stroke-width={2} /> : null))}
        {hovered !== null && (
          <g>
            <line x1={scale.x(hovered)} x2={scale.x(hovered)} y1={TOP} y2={HEIGHT - BOTTOM} class="stroke-fg/30" />
            <circle cx={scale.x(hovered)} cy={scale.y(points[hovered].mean)} r={3} class="fill-info stroke-bg" stroke-width={1.5} />
            <circle cx={scale.x(hovered)} cy={scale.y(points[hovered].best)} r={3.5} class="fill-accent stroke-bg" stroke-width={1.5} />
          </g>
        )}
      </svg>
    );
  return (
    <div class="flex min-w-0 flex-col gap-2">
      <div class="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-1">
        <span class={LABEL}>{label}</span>
        {last && (
          <span class="text-sm text-muted tabular-nums">
            <Values point={hovered === null ? last : points[hovered]} format={format} />
            {hovered !== null && points[hovered].newBest && " · a new best"}
            {hovered !== null && pickText && <span class="text-faint"> · click: {pickText}</span>}
          </span>
        )}
        {last && (
          <span class="ml-auto flex items-center gap-1.5 text-xs text-faint">
            <span class="size-2 rounded-full bg-accent" /> a new best
          </span>
        )}
      </div>
      {/* A pointer control only: the keyboard opens the same Races with the controls of the page. */}
      {/* biome-ignore lint/a11y/noStaticElementInteractions: see above. */}
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: see above. */}
      <div
        ref={ref}
        class={`relative select-none ${onPick && points.length > 0 ? "cursor-pointer" : ""}`}
        onPointerMove={(event) => setHover(event.clientX - event.currentTarget.getBoundingClientRect().left)}
        onPointerLeave={() => setHover(null)}
        onClick={() => hovered !== null && onPick?.(points[hovered].generation)}
      >
        {body}
      </div>
    </div>
  );
}
