import { DIRECTION_STEP, DIRECTION_STEPS, type Direction, type MapGrid } from "../game";
import { type AtlasEdge, type AtlasMap, type AtlasPerson, type AtlasSign, type AtlasWarp, blockedText, seenIn } from "../harness/atlas";
import type { Observation } from "../harness/harness";
import { type Cell, cellKey, edgeCells, free, inside, walkable } from "../harness/path";

export type Overworld = Extract<Observation, { mode: "overworld" }>;

export type Target = { label: string } & (
  | { kind: "exit"; name: string; cell: Cell; to: string | null }
  | { kind: "frontier"; cell: Cell }
  | { kind: "person"; cell: Cell; localId: number }
  | { kind: "sign"; cell: Cell; facing: Direction | "any" }
  | { kind: "edge"; name: string; side: Direction; to: string | null }
  | { kind: "map"; map: string; cell: Cell }
);

export type Exit = Target & { kind: "exit" | "edge" };

type LocalTarget = Exclude<Target, { kind: "map" }>;

type TargetGroup = { title: string; kinds: Target["kind"][]; empty?: string };

export const EXITS_GROUP: TargetGroup = { title: "Exits of this map:", kinds: ["exit", "edge"], empty: "none seen yet." };

export const TARGET_GROUPS: TargetGroup[] = [
  EXITS_GROUP,
  { title: "Unseen cells:", kinds: ["frontier"] },
  { title: "People and signs:", kinds: ["person", "sign"] },
  { title: "Far maps:", kinds: ["map"] },
];

const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

const EXIT_NAMES: [RegExp, string][] = [
  [/CAVE_DOOR/, "cave entrance"],
  [/DOOR/, "door"],
  [/STAIR|LADDER|ESCALATOR/, "stairs"],
  [/ARROW_WARP/, "exit mat"],
];
const OPPOSITE: Record<Direction, Direction> = { north: "south", south: "north", west: "east", east: "west" };
const EDGE_TRIES = 3;

function exitName(behavior: string): string {
  return EXIT_NAMES.find(([pattern]) => pattern.test(behavior))?.[1] ?? "warp";
}

function destination(to: string | null): string {
  return to ? `to ${to}` : "not taken";
}

function taken(to: string | null): string {
  return to ? `${destination(to)}, taken` : destination(to);
}

function edgeName(side: Direction): string {
  return `${side} edge`;
}

function exitPlace(w: AtlasWarp): string {
  return `${exitName(w.behavior)} at (${w.x}, ${w.y})`;
}

export function warpLabel(w: AtlasWarp): string {
  return `${exitPlace(w)}, ${destination(w.to)}`;
}

export function edgeLabel(e: AtlasEdge, map: string): string {
  return e.blocked ? `${edgeName(e.side)}: ${blockedText(map, e.side, e.blocked)}` : `${edgeName(e.side)}, ${destination(e.to)}`;
}

export function targetLetter(index: number): string {
  return index < LETTERS.length ? LETTERS[index] : targetLetter(Math.floor(index / LETTERS.length) - 1) + LETTERS[index % LETTERS.length];
}

export function targetIndex(text: string): number {
  const letters = text.toUpperCase();
  return /^[A-Z]+$/.test(letters) ? [...letters].reduce((n, c) => n * LETTERS.length + LETTERS.indexOf(c) + 1, 0) - 1 : -1;
}

export function isExit(target: Target): target is Exit {
  return target.kind === "exit" || target.kind === "edge";
}

export function targetLines(targets: Target[], keep: (target: Target) => boolean): string[] {
  return targets.flatMap((t, i) => (keep(t) ? [`${targetLetter(i)}. ${t.label}`] : []));
}

export function personName({ graphics, rival }: AtlasPerson): string {
  return rival ? `${rival} (your rival)` : graphics.replaceAll("_", " ");
}

export function localTargets(overworld: Overworld, here: AtlasMap): Target[] {
  const { grid, player, people } = overworld;
  const seen = seenIn(here);
  const cells = reachable(overworld, seen);
  const reached = new Set(cells.map(cellKey));
  // The player talks across a counter only from its own side: a person on that side next to a counter is not behind it.
  const behindCounter = (p: Cell) => DIRECTION_STEPS.some(([, step]) => {
    const from = talkFrom(grid, p, step);
    return from.across && reached.has(cellKey(from.cell));
  });
  const present = new Set(people.map((p) => p.localId));
  const targets = [
    ...here.warps.map((w) => exitTarget(w, player)),
    ...here.edges.filter((e) => !e.blocked).map((e) => edgeTarget(e, here, player)),
    ...frontier(cells, grid, seen, player),
    ...here.people.filter((p) => present.has(p.localId) && seen(p)).map((p) => personTarget(p, player, behindCounter(p))),
    ...here.signs.map((s) => signTarget(s, player)),
  ];
  const group = (t: LocalTarget) => TARGET_GROUPS.findIndex((g) => g.kinds.includes(t.kind));
  const steps = (t: LocalTarget) => (t.kind === "edge" ? edgeSteps(here, player, t.side) : distance(player, t.cell));
  return targets.toSorted((a, b) => group(a) - group(b) || steps(a) - steps(b));
}

function exitTarget(w: AtlasWarp, player: Overworld["player"]): LocalTarget {
  return { kind: "exit", name: exitName(w.behavior), label: `${exitPlace(w)}, ${whereFrom(player, w)}: ${taken(w.to)}`, cell: { x: w.x, y: w.y }, to: w.to };
}

function edgeTarget(e: AtlasEdge, here: AtlasMap, player: Overworld["player"]): LocalTarget {
  const name = edgeName(e.side);
  return { kind: "edge", name, label: `${name}, ${edgeSteps(here, player, e.side)} ${e.side}: ${taken(e.to)}`, side: e.side, to: e.to };
}

function personTarget(p: AtlasPerson, player: Overworld["player"], behindCounter: boolean): LocalTarget {
  const counter = behindCounter ? ", behind a counter: go talks across it" : "";
  const talked = p.texts.length > 0 ? `: talked, "${p.texts.at(-1)}"` : "";
  return { kind: "person", label: `${personName(p)} at (${p.x}, ${p.y}), ${whereFrom(player, p)}${counter}${talked}`, cell: { x: p.x, y: p.y }, localId: p.localId };
}

function signTarget(s: AtlasSign, player: Overworld["player"]): LocalTarget {
  const read = s.text ? `: read, "${s.text}"` : "";
  return { kind: "sign", label: `sign at (${s.x}, ${s.y}), ${whereFrom(player, s)}${read}`, cell: { x: s.x, y: s.y }, facing: s.facing };
}

function whereFrom(player: Overworld["player"], cell: Cell): string {
  const dx = cell.x - player.x;
  const dy = cell.y - player.y;
  if (dx === 0 && dy === 0) return "you stand on it";
  const [side] = DIRECTION_STEPS.find(([, [sx, sy]]) => sx === dx && sy === dy) ?? [];
  if (side) return `adjacent ${side}${side === player.facing ? ", you face it" : ""}`;
  return [dy < 0 ? `${-dy} north` : dy > 0 ? `${dy} south` : "", dx > 0 ? `${dx} east` : dx < 0 ? `${-dx} west` : ""].filter(Boolean).join(", ");
}

function edgeSteps(map: AtlasMap, { x, y }: Cell, side: Direction): number {
  return { north: y + 1, south: map.height - y, west: x + 1, east: map.width - x }[side];
}

function reachable({ grid, player }: Overworld, seen: (cell: Cell) => boolean): Cell[] {
  const visited = new Set([cellKey(player)]);
  const cells: Cell[] = [{ x: player.x, y: player.y }];
  for (let i = 0; i < cells.length; i++) {
    for (const [, [dx, dy]] of DIRECTION_STEPS) {
      const next = { x: cells[i].x + dx, y: cells[i].y + dy };
      const key = cellKey(next);
      if (visited.has(key) || !seen(next) || !walkable(grid, next)) continue;
      visited.add(key);
      cells.push(next);
    }
  }
  return cells;
}

function frontier(reached: Cell[], grid: MapGrid, seen: (cell: Cell) => boolean, player: Overworld["player"]): LocalTarget[] {
  const found = new Map<Direction, Cell>();
  for (const cell of reached) {
    for (const [direction, [dx, dy]] of DIRECTION_STEPS) {
      const next = { x: cell.x + dx, y: cell.y + dy };
      if (inside(grid, next) && !seen(next) && !found.has(direction)) found.set(direction, cell);
    }
  }
  return DIRECTION_STEPS.flatMap(([direction]): LocalTarget[] => {
    const cell = found.get(direction);
    return cell ? [{ kind: "frontier", label: `unseen cells ${direction} of (${cell.x}, ${cell.y}), ${whereFrom(player, cell)}`, cell }] : [];
  });
}

export function approaches(target: Exclude<Target, { kind: "map" }>, { grid, player, people }: Overworld): Cell[] {
  const isFree = (c: Cell) => free({ ...grid, people }, c);
  const nearest = (cells: Cell[]) => cells.filter(isFree).toSorted((a, b) => distance(a, player) - distance(b, player));
  switch (target.kind) {
    case "exit":
    case "frontier":
      return [target.cell];
    case "edge": {
      const [dx, dy] = DIRECTION_STEP[target.side];
      const edge = edgeCells(grid, target.side);
      const cells = nearest(edge).slice(0, EDGE_TRIES);
      const tries = cells.length > 0 ? cells : [dx === 0 ? { x: player.x, y: edge[0].y } : { x: edge[0].x, y: player.y }];
      return tries.map((c) => ({ x: c.x + dx, y: c.y + dy }));
    }
    case "person":
    case "sign": {
      const facing = target.kind === "sign" ? target.facing : "any";
      const sides = DIRECTION_STEPS.filter(([direction]) => facing === "any" || direction === OPPOSITE[facing]);
      const { x, y } = target.cell;
      const cells = nearest(sides.map(([, step]) => (target.kind === "person" ? talkFrom(grid, target.cell, step).cell : { x: x + step[0], y: y + step[1] })));
      return cells.length > 0 ? cells : [target.cell];
    }
  }
}

/** The cell to interact with from `from`: the target next to it, or the counter between them (the game lets the player talk across a counter). */
export function interactCell(target: { kind: Target["kind"]; cell: Cell }, grid: MapGrid, from: Cell): Cell | null {
  if (nextTo(from, target.cell)) return target.cell;
  if (target.kind !== "person") return null;
  const { x, y } = target.cell;
  const [, step] = DIRECTION_STEPS.find(([, step]) => {
    const side = talkFrom(grid, target.cell, step);
    return side.across && side.cell.x === from.x && side.cell.y === from.y;
  }) ?? [];
  return step ? { x: x + step[0], y: y + step[1] } : null;
}

function talkFrom(grid: MapGrid, { x, y }: Cell, [dx, dy]: [number, number]): { cell: Cell; across: boolean } {
  const across = isCounter(grid, { x: x + dx, y: y + dy });
  return { cell: across ? { x: x + 2 * dx, y: y + 2 * dy } : { x: x + dx, y: y + dy }, across };
}

function isCounter(grid: MapGrid, c: Cell): boolean {
  return inside(grid, c) && grid.behaviorNames[grid.behaviors[(c.y - grid.y0) * grid.width + (c.x - grid.x0)]] === "MB_COUNTER";
}

function nextTo(a: Cell, b: Cell): boolean {
  return distance(a, b) === 1;
}

function distance(a: Cell, b: Cell): number {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}
