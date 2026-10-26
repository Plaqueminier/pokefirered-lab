import { DIRECTION_STEP, DIRECTION_STEPS, type Direction, type MapGrid } from "../game";
import { type AtlasEdge, type AtlasMap, type AtlasWarp, seenIn } from "../harness/atlas";
import type { Observation } from "../harness/harness";
import { type Cell, cellKey, edgeCells, free, inside, walkable } from "../harness/path";

export type Overworld = Extract<Observation, { mode: "overworld" }>;

export type Target = { label: string } & (
  | { kind: "exit" | "person" | "frontier"; cell: Cell }
  | { kind: "sign"; cell: Cell; facing: Direction | "any" }
  | { kind: "edge"; side: Direction }
  | { kind: "map"; map: string; cell: Cell }
);

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

export function warpLabel(w: AtlasWarp): string {
  return `${exitName(w.behavior)} at (${w.x}, ${w.y}), ${destination(w.to)}`;
}

export function edgeLabel(e: AtlasEdge): string {
  return `${e.side} edge, ${destination(e.to)}`;
}

export function localTargets(overworld: Overworld, here: AtlasMap): Target[] {
  const { people } = overworld;
  const seen = seenIn(here);
  const exits = here.warps.map((w): Target => ({ kind: "exit", label: warpLabel(w), cell: { x: w.x, y: w.y } }));
  const edges = here.edges.map((e): Target => ({ kind: "edge", label: edgeLabel(e), side: e.side }));
  const persons = people.filter(seen).map((p): Target => {
    const name = p.rival ? `${p.rival} (your rival)` : p.graphics.replaceAll("_", " ");
    return { kind: "person", label: `${name} at (${p.x}, ${p.y})`, cell: { x: p.x, y: p.y } };
  });
  const signs = here.signs.map((s): Target => ({ kind: "sign", label: `sign at (${s.x}, ${s.y})${s.text ? `: "${s.text}"` : ""}`, cell: { x: s.x, y: s.y }, facing: s.facing }));
  return [...exits, ...edges, ...frontier(overworld, seen), ...persons, ...signs];
}

function frontier({ grid, player }: Overworld, seen: (cell: Cell) => boolean): Target[] {
  const found = new Map<Direction, Cell>();
  const visited = new Set([cellKey(player)]);
  const queue: Cell[] = [{ x: player.x, y: player.y }];
  for (let cell = queue.shift(); cell; cell = queue.shift()) {
    for (const [direction, [dx, dy]] of DIRECTION_STEPS) {
      const next = { x: cell.x + dx, y: cell.y + dy };
      if (inside(grid, next) && !seen(next) && !found.has(direction)) found.set(direction, cell);
      const key = cellKey(next);
      if (visited.has(key) || !seen(next) || !walkable(grid, next)) continue;
      visited.add(key);
      queue.push(next);
    }
  }
  return DIRECTION_STEPS.flatMap(([direction]): Target[] => {
    const cell = found.get(direction);
    return cell ? [{ kind: "frontier", label: `unseen cells ${direction} of (${cell.x}, ${cell.y})`, cell }] : [];
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
      const cells = nearest(sides.map(([, [dx, dy]]) => (target.kind === "person" && isCounter(grid, { x: x + dx, y: y + dy }) ? { x: x + 2 * dx, y: y + 2 * dy } : { x: x + dx, y: y + dy })));
      return cells.length > 0 ? cells : [target.cell];
    }
  }
}

/** The cell to interact with from `from`: the target next to it, or the counter between them (the game lets the player talk across a counter). */
export function interactCell(target: { kind: Target["kind"]; cell: Cell }, grid: MapGrid, from: Cell): Cell | null {
  if (nextTo(from, target.cell)) return target.cell;
  const middle = { x: (from.x + target.cell.x) / 2, y: (from.y + target.cell.y) / 2 };
  const across = target.kind === "person" && distance(from, target.cell) === 2 && (from.x === target.cell.x || from.y === target.cell.y);
  return across && isCounter(grid, middle) ? middle : null;
}

function isCounter(grid: MapGrid, c: Cell): boolean {
  return inside(grid, c) && grid.behaviorNames[grid.behaviors[(c.y - grid.y0) * grid.width + (c.x - grid.x0)]] === "MB_COUNTER";
}

export function nextTo(a: Cell, b: Cell): boolean {
  return distance(a, b) === 1;
}

function distance(a: Cell, b: Cell): number {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}
