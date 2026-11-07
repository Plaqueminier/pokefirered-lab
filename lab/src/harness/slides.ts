import { DIRECTION_STEP, DIRECTION_STEPS, type Direction, KIND, SPIN, STOP } from "../cells";
import type { AtlasMap, AtlasSlide } from "./atlas";
import { type Cell, cellKey, findRoute, inside, kindAt, type MapCells, type MapSource, type Place, walkable, walkGroups, wallBetween } from "./path";

const SPIN_DIRECTIONS = new Map(Object.entries(SPIN).map(([direction, sign]) => [sign, direction as Direction]));

export function spinDirection(view: MapCells, c: Cell): Direction | null {
  return inside(view, c) ? (SPIN_DIRECTIONS.get(kindAt(view, c)) ?? null) : null;
}

// The rule of TryUpdatePlayerSpinDirection and DoForcedMovement in field_player_avatar.c.
export function slideEnd(view: MapCells, from: Cell, known: (c: Cell) => boolean, blocked: (c: Cell) => boolean): Cell | null {
  let direction = spinDirection(view, from);
  if (!direction) return null;
  const states = new Set<string>();
  for (let cell = from; ; ) {
    if (cellKey(cell) !== cellKey(from) && kindAt(view, cell) === STOP) return cell;
    direction = spinDirection(view, cell) ?? direction;
    const state = `${cellKey(cell)} ${direction}`;
    if (states.has(state)) return null;
    states.add(state);
    const [dx, dy] = DIRECTION_STEP[direction];
    const next = { x: cell.x + dx, y: cell.y + dy };
    if (!inside(view, next)) return cell;
    if (!known(next)) return null;
    if (wallBetween(view, cell, direction) || blocked(next) || !(walkable(view, next) || spinDirection(view, next))) return cell;
    cell = next;
  }
}

export type Slide = { from: Cell; direction: Direction; to: Cell | null; onSpin: boolean; taken: boolean };

export function hasSpinTiles(kinds: string): boolean {
  return [...SPIN_DIRECTIONS.keys()].some((sign) => kinds.includes(sign));
}

export function numberParts(view: MapCells, open: (c: Cell) => boolean, old: readonly number[]): number[] {
  const { cells, groups } = walkGroups(view, open);
  const numbers: number[] = Array(view.mapWidth * view.mapHeight).fill(0);
  let next = old.reduce((top, n) => Math.max(top, n), 0) + 1;
  for (const part of Map.groupBy(cells, (c) => groups.get(cellKey(c))).values()) {
    const kept = part.map((c) => old[c.y * view.mapWidth + c.x] ?? 0).filter((n) => n > 0);
    const number = kept.length > 0 ? Math.min(...kept) : next++;
    for (const c of part) numbers[c.y * view.mapWidth + c.x] = number;
  }
  return numbers;
}

export function partAt({ parts, width, height }: Pick<AtlasMap, "parts" | "width" | "height">, { x, y }: Cell): number {
  return x >= 0 && y >= 0 && x < width && y < height ? (parts[y * width + x] ?? 0) : 0;
}

/** For a cell out of the Parts, as a spin tile or a sign, the Part of its first open neighbour: north, south, west, east. */
export function partNear(map: Pick<AtlasMap, "parts" | "width" | "height">, cell: Cell): number | null {
  const number = [cell, ...DIRECTION_STEPS.map(([, [dx, dy]]) => ({ x: cell.x + dx, y: cell.y + dy }))].map((c) => partAt(map, c)).find((n) => n > 0);
  return number ?? null;
}

export function slidesLeaving(view: MapCells, cells: Cell[], seen: (c: Cell) => boolean, taken: AtlasSlide[], blocked: (c: Cell) => boolean): Slide[] {
  const own = new Set(cells.map(cellKey));
  const ends = new Map(taken.map((s) => [cellKey(s.from), s.to]));
  const slides = new Map<string, Slide>();
  for (const cell of cells) {
    for (const [side, [dx, dy]] of DIRECTION_STEPS) {
      const from = { x: cell.x + dx, y: cell.y + dy };
      const direction = spinDirection(view, from);
      if (!direction || slides.has(cellKey(from)) || !seen(from) || wallBetween(view, cell, side)) continue;
      const to = slideEnd(view, from, seen, blocked) ?? ends.get(cellKey(from)) ?? null;
      slides.set(cellKey(from), { from, direction, to, onSpin: to !== null && spinDirection(view, to) !== null, taken: ends.has(cellKey(from)) });
    }
  }
  return [...slides.values()].filter(({ to }) => !to || !own.has(cellKey(to))).toSorted((a, b) => a.from.y - b.from.y || a.from.x - b.from.x);
}

export function withOpenTile(maps: MapSource, tile: Place): MapSource {
  return (name) => {
    const map = maps(name);
    if (!map || name !== tile.map) return map;
    const kinds = [...map.kinds];
    kinds[(tile.y - map.y0) * map.width + (tile.x - map.x0)] = KIND.open;
    return { ...map, kinds: kinds.join("") };
  };
}

export function routeOntoSpin(here: Place, tile: Place, opened: MapSource): { from: Place; direction: Direction } | null {
  const last = findRoute(here, tile, opened)?.at(-1)?.moves.at(-1);
  if (!last) return null;
  const [dx, dy] = DIRECTION_STEP[last.direction];
  return { from: { map: tile.map, x: tile.x - dx, y: tile.y - dy }, direction: last.direction };
}
