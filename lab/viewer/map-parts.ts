import type { ConnectionSide, MapGrid } from "../src/game";
import { type Cell, cellKey, walkable, walkGroups } from "../src/harness/path";

/** For each cell of the map, row by row, the number of its Map part from 1, the largest first, and 0 for none. Only a Map part with an exit counts. Null with fewer than 2 of them. */
export function mapParts(grid: MapGrid, blocked: readonly Cell[]): Uint8Array | null {
  const closed = new Set(blocked.map(cellKey));
  const stepExits = new Set(grid.warps.filter((w) => w.how === "step").map(cellKey));
  const { cells, groups } = walkGroups(grid, (c) => walkable(grid, c) && !closed.has(cellKey(c)) && !stepExits.has(cellKey(c)));
  const members = new Map<number | undefined, Cell[]>();
  for (const cell of cells) {
    const group = groups.get(cellKey(cell));
    const part = members.get(group);
    if (part) part.push(cell);
    else members.set(group, [cell]);
  }
  const parts = [...members.values()].filter((part) => part.some((cell) => hasExit(grid, cell))).toSorted((a, b) => b.length - a.length);
  if (parts.length < 2) return null;
  const numbers = new Uint8Array(grid.mapWidth * grid.mapHeight);
  parts.forEach((part, i) => {
    for (const { x, y } of part) numbers[y * grid.mapWidth + x] = i + 1;
  });
  return numbers;
}

function hasExit(grid: MapGrid, { x, y }: Cell): boolean {
  const atEdge: Partial<Record<ConnectionSide, boolean>> = { north: y === 0, south: y === grid.mapHeight - 1, west: x === 0, east: x === grid.mapWidth - 1 };
  return grid.warps.some((w) => Math.abs(w.x - x) + Math.abs(w.y - y) <= 1) || grid.connections.some((c) => atEdge[c.direction]);
}
