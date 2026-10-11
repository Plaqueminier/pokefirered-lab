import { DIRECTION_STEP, type Direction, KIND, type MapGrid } from "../game";

export type Cell = { x: number; y: number };
export type PathGrid = Pick<MapGrid, "kinds" | "x0" | "y0" | "width" | "height">;

const STEPS = Object.entries(DIRECTION_STEP) as [Direction, [number, number]][];
const WALKABLE = new Set<string>([KIND.open, KIND.grass]);

export function findPath(grid: PathGrid, from: Cell, to: Cell): Direction[] | null {
  const index = (c: Cell) => (c.y - grid.y0) * grid.width + (c.x - grid.x0);
  const walkable = (c: Cell) => {
    const gx = c.x - grid.x0;
    const gy = c.y - grid.y0;
    return gx >= 0 && gy >= 0 && gx < grid.width && gy < grid.height && WALKABLE.has(grid.kinds[index(c)]);
  };
  if (!walkable(to)) return null;

  const distance = (c: Cell) => Math.abs(c.x - to.x) + Math.abs(c.y - to.y);
  const cost = new Map<number, number>([[index(from), 0]]);
  const cameFrom = new Map<number, { cell: Cell; step: Direction }>();
  const open = [{ cell: from, score: distance(from) }];

  while (open.length > 0) {
    // The first of the lowest scores, so the path is the same on each run.
    let best = 0;
    for (let i = 1; i < open.length; i++) if (open[i].score < open[best].score) best = i;
    const { cell } = open.splice(best, 1)[0];
    if (cell.x === to.x && cell.y === to.y) return stepsTo(cell, cameFrom, index);
    const here = cost.get(index(cell))!;
    for (const [step, [dx, dy]] of STEPS) {
      const next = { x: cell.x + dx, y: cell.y + dy };
      if (!walkable(next)) continue;
      const i = index(next);
      if (cost.has(i) && cost.get(i)! <= here + 1) continue;
      cost.set(i, here + 1);
      cameFrom.set(i, { cell, step });
      open.push({ cell: next, score: here + 1 + distance(next) });
    }
  }
  return null;
}

function stepsTo(end: Cell, cameFrom: Map<number, { cell: Cell; step: Direction }>, index: (c: Cell) => number): Direction[] {
  const steps: Direction[] = [];
  for (let link = cameFrom.get(index(end)); link; link = cameFrom.get(index(link.cell))) steps.push(link.step);
  return steps.reverse();
}
