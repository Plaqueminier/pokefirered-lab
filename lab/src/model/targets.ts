import { DIRECTION_STEP, DIRECTION_STEPS, type Direction } from "../game";
import type { Observation } from "../harness/harness";
import { type Cell, free } from "../harness/path";
import type { RunEvent } from "../harness/record";

export type Overworld = Extract<Observation, { mode: "overworld" }>;

export type Target = { label: string } & (
  | { kind: "exit" | "person"; cell: Cell }
  | { kind: "sign"; cell: Cell; facing: Direction | "any" }
  | { kind: "edge"; side: Direction }
);

const EXIT_NAMES: [RegExp, string][] = [
  [/CAVE_DOOR/, "cave entrance"],
  [/DOOR/, "door"],
  [/STAIR|LADDER|ESCALATOR/, "stairs"],
  [/ARROW_WARP/, "exit mat"],
];
const OPPOSITE: Record<Direction, Direction> = { north: "south", south: "north", west: "east", east: "west" };
const EDGE_TRIES = 3;

export function visitedMaps(events: readonly RunEvent[]): Set<string> {
  return new Set(events.flatMap((e) => (e.type === "map" ? [e.map] : [])));
}

// A player knows where an exit goes only when it has been on that map.
export function targetsOf({ grid, people }: Overworld, visited: ReadonlySet<string>): Target[] {
  const to = (map: string) => (visited.has(map) ? `to ${map}` : "to a map that you have not visited");
  const exits = grid.warps.flatMap((w): Target[] => {
    if (w.how === "none") return [];
    const name = EXIT_NAMES.find(([pattern]) => pattern.test(w.behavior))?.[1] ?? "warp";
    return [{ kind: "exit", label: `${name} at (${w.x}, ${w.y}), ${to(w.to)}`, cell: { x: w.x, y: w.y } }];
  });
  const edges = grid.connections.flatMap((c): Target[] =>
    c.direction in DIRECTION_STEP ? [{ kind: "edge", label: `${c.direction} edge of the map, ${to(c.map)}`, side: c.direction as Direction }] : [],
  );
  const persons = people.map((p): Target => ({ kind: "person", label: `${p.graphics.replaceAll("_", " ")} at (${p.x}, ${p.y})`, cell: { x: p.x, y: p.y } }));
  const signs = grid.signs.flatMap((s): Target[] => (s.kind === "sign" ? [{ kind: "sign", label: `sign at (${s.x}, ${s.y})`, cell: { x: s.x, y: s.y }, facing: s.playerFacing }] : []));
  return [...exits, ...edges, ...persons, ...signs];
}

/** The cells where `goTo` goes for the target, the best first. */
export function approaches(target: Target, { grid, player, people }: Overworld): Cell[] {
  const isFree = (c: Cell) => free({ ...grid, people }, c);
  const nearest = (cells: Cell[]) => cells.filter(isFree).toSorted((a, b) => distance(a, player) - distance(b, player));
  switch (target.kind) {
    case "exit":
      return [target.cell];
    case "edge": {
      const [dx, dy] = DIRECTION_STEP[target.side];
      const along = dx === 0 ? grid.mapWidth : grid.mapHeight;
      const inside = Array.from({ length: along }, (_, i): Cell => {
        if (dx === 0) return { x: i, y: dy < 0 ? 0 : grid.mapHeight - 1 };
        return { x: dx < 0 ? 0 : grid.mapWidth - 1, y: i };
      });
      const cells = nearest(inside).slice(0, EDGE_TRIES);
      const tries = cells.length > 0 ? cells : [dx === 0 ? { x: player.x, y: inside[0].y } : { x: inside[0].x, y: player.y }];
      return tries.map((c) => ({ x: c.x + dx, y: c.y + dy }));
    }
    case "person":
    case "sign": {
      const facing = target.kind === "sign" ? target.facing : "any";
      const sides = DIRECTION_STEPS.filter(([direction]) => facing === "any" || direction === OPPOSITE[facing]);
      const cells = nearest(sides.map(([, [dx, dy]]) => ({ x: target.cell.x + dx, y: target.cell.y + dy })));
      return cells.length > 0 ? cells : [target.cell];
    }
  }
}

export function nextTo(a: Cell, b: Cell): boolean {
  return distance(a, b) === 1;
}

function distance(a: Cell, b: Cell): number {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}
