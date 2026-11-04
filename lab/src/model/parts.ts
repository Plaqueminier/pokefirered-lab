import { DIRECTION_STEP, DIRECTION_STEPS, type Direction, LEDGE, WALL } from "../cells";
import { type Atlas, type AtlasMap, type AtlasWarp, fitsScreen, seenIn } from "../harness/atlas";
import { allCells, type Cell, cellKey, inside, kindAt, type MapCells, walkable, walkGroups, wallBetween } from "../harness/path";

export type Part = {
  map: AtlasMap;
  from: Cell;
  cells: Cell[];
  keys: Set<string>;
  exits: AtlasWarp[];
  touches(cell: Cell): boolean;
  view: MapCells;
};

export type Lead = { map: AtlasMap; away: number; cell: Cell } & ({ kind: "unseen"; direction: Direction } | { kind: "exit"; warp: AtlasWarp });

export type Beyond = "unseen" | "exit" | "nothing";

type PartAway = { part: Part; away: number };

type Step = (warp: AtlasWarp) => Part | null;

const MAX_LEADS = 4;

function isStepExit(map: AtlasMap, { x, y }: Cell): boolean {
  return map.stepExits.some((c) => c.x === x && c.y === y);
}

function partOf(map: AtlasMap, view: MapCells, from: Cell): Part {
  const seen = seenIn(map);
  const cells = [{ x: from.x, y: from.y }];
  const keys = new Set([cellKey(from)]);
  const add = (cell: Cell) => {
    if (keys.has(cellKey(cell))) return;
    keys.add(cellKey(cell));
    cells.push(cell);
  };
  for (const [i, cell] of cells.entries()) {
    if (i > 0 && isStepExit(map, cell)) continue;
    for (const [direction, [dx, dy]] of DIRECTION_STEPS) {
      const next = { x: cell.x + dx, y: cell.y + dy };
      if (!seen(next) || wallBetween(view, cell, direction)) continue;
      const landing = { x: next.x + dx, y: next.y + dy };
      if (kindAt(view, next) === LEDGE[direction] && seen(landing) && walkable(view, landing)) add(landing);
      else if (walkable(view, next)) add(next);
    }
  }
  const touches = (c: Cell) => keys.has(cellKey(c)) || (!walkable(view, c) && Object.values(DIRECTION_STEP).some(([dx, dy]) => keys.has(cellKey({ x: c.x + dx, y: c.y + dy }))));
  return { map, from, cells, keys, exits: map.warps.filter(touches), touches, view };
}

function unseenPast(map: AtlasMap, view: MapCells, c: Cell, direction: Direction): Cell | null {
  const seen = seenIn(map);
  const [dx, dy] = DIRECTION_STEP[direction];
  const next = { x: c.x + dx, y: c.y + dy };
  const far = seen(next) && kindAt(view, next) === LEDGE[direction] ? { x: next.x + dx, y: next.y + dy } : next;
  return !isStepExit(map, c) && inside(view, far) && !seen(far) && kindAt(view, c) !== WALL[direction] ? far : null;
}

function unseenFronts(map: AtlasMap): { cell: Cell; far: Cell }[] {
  const view = atlasCells(map);
  const seen = seenIn(map);
  const cells = allCells(view).filter((c) => seen(c) && walkable(view, c));
  return cells.flatMap((cell) => DIRECTION_STEPS.flatMap(([direction]) => {
    const far = unseenPast(map, view, cell, direction);
    return far ? [{ cell, far }] : [];
  }));
}

function unseenSides({ map, cells, view }: Pick<Part, "map" | "cells" | "view">): { direction: Direction; cell: Cell }[] {
  return DIRECTION_STEPS.flatMap(([direction]) => {
    const cell = cells.find((c) => unseenPast(map, view, c, direction));
    return cell ? [{ direction, cell }] : [];
  });
}

function touchingGroups<C extends Cell>(cells: C[]): C[][] {
  const left = new Map(cells.map((cell) => [cellKey(cell), cell]));
  const groups: C[][] = [];
  for (const start of left.values()) {
    left.delete(cellKey(start));
    const group = [start];
    for (const { x, y } of group) {
      for (const dy of [-1, 0, 1]) {
        for (const dx of [-1, 0, 1]) {
          const next = left.get(cellKey({ x: x + dx, y: y + dy }));
          if (!next) continue;
          left.delete(cellKey(next));
          group.push(next);
        }
      }
    }
    groups.push(group);
  }
  return groups;
}

export function unseenGroups(map: AtlasMap): number {
  return touchingGroups(unseenFronts(map).map(({ cell }) => cell)).length;
}

export function unseenPlaces({ map, cells, view, from }: Part): { direction: Direction; cell: Cell }[] {
  const fronts = cells.flatMap((cell) => {
    const side = DIRECTION_STEPS.find(([direction]) => unseenPast(map, view, cell, direction));
    return side ? [{ ...cell, direction: side[0] }] : [];
  });
  const away = ({ x, y }: Cell) => Math.abs(x - from.x) + Math.abs(y - from.y);
  const nearestFirst = (group: Cell[]) => group.toSorted((a, b) => away(a) - away(b));
  return touchingGroups(fronts).flatMap((group) => {
    // Run 00047: a walk with 3 x 3 sight makes long groups, and their first cell can be far behind the player.
    const shown = map.dark ? unseenSides({ map, view, cells: nearestFirst(group) }) : [{ direction: group[0].direction, cell: group[0] }];
    return shown.map(({ direction, cell: { x, y } }) => ({ direction, cell: { x, y } }));
  });
}

export function closedCells(map: AtlasMap, view: MapCells, people: Cell[]): Set<string> {
  const seen = seenIn(map);
  const closed = new Set(people.map(cellKey));
  const open = (c: Cell) => seen(c) && walkable(view, c) && !closed.has(cellKey(c)) && !isStepExit(map, c);
  const { groups, stepsOf } = walkGroups(view, open);
  const closes = (person: Cell) => {
    if (!seen(person) || !walkable(view, person)) return false;
    const sides = new Set(stepsOf(person).map((c) => groups.get(cellKey(c))));
    if (sides.size !== 1) return sides.size > 1;
    const touchesSides = (c: Cell) => DIRECTION_STEPS.some(([, [dx, dy]]) => sides.has(groups.get(cellKey({ x: c.x + dx, y: c.y + dy }))));
    return DIRECTION_STEPS.some(([direction]) => {
      const far = unseenPast(map, view, person, direction);
      return far !== null && !touchesSides(far);
    });
  };
  return new Set(people.filter(closes).map(cellKey));
}

function leadsOf(part: Part, away: number): Lead[] {
  const unseen = fitsScreen(part.map) ? [] : unseenSides(part);
  const leads: Lead[] = unseen.map(({ direction, cell }) => ({ kind: "unseen", map: part.map, away, cell, direction }));
  for (const warp of part.exits) {
    if (warp.to) continue;
    const cell = part.cells.find((c) => Math.abs(c.x - warp.x) + Math.abs(c.y - warp.y) === 1 && !isStepExit(part.map, c));
    if (cell) leads.push({ kind: "exit", map: part.map, away, cell, warp });
  }
  return leads;
}

export function explorableCells(map: AtlasMap): Set<string> {
  return new Set(unseenFronts(map).map(({ far }) => cellKey(far)));
}

export function atlasCells(map: AtlasMap): MapCells {
  return { kinds: map.cells, x0: 0, y0: 0, width: map.width, mapWidth: map.width, mapHeight: map.height };
}

function partsAfter(part: Part, step: Step): Part[] {
  return part.exits.flatMap((warp) => step(warp) ?? []);
}

export class Parts {
  readonly own: Part;
  readonly #parts = new Map<string, Part>();
  #reachable: PartAway[] | null = null;

  constructor(
    private readonly atlas: Atlas,
    here: AtlasMap,
    grid: MapCells,
    player: Cell,
  ) {
    this.own = partOf(here, grid, player);
  }

  private readonly partAtArrival: Step = ({ to, arrival }) => {
    const map = this.atlas.maps.find((m) => m.name === to);
    if (!map || !arrival) return null;
    const key = `${map.name} ${cellKey(arrival)}`;
    const part = this.#parts.get(key) ?? partOf(map, atlasCells(map), arrival);
    this.#parts.set(key, part);
    return part;
  };

  /** Null for an exit not taken, and for an exit to an outdoor map other than the map of the player: the Known world tells these maps. */
  readonly partPast: Step = (warp) => {
    const part = this.partAtArrival(warp);
    return part && (!part.map.outside || part.map.name === this.own.map.name) ? part : null;
  };

  beyond(warp: AtlasWarp): Beyond | null {
    const next = this.partPast(warp);
    if (!next) return null;
    const leads = this.partsFrom([next], this.partPast).flatMap(({ part, away }) => leadsOf(part, away));
    if (leads.some((lead) => lead.kind === "unseen")) return "unseen";
    return leads.length > 0 ? "exit" : "nothing";
  }

  leads(): Lead[] {
    return this.partsFrom(partsAfter(this.own, this.partPast), this.partPast).flatMap(({ part, away }) => leadsOf(part, away)).slice(0, MAX_LEADS);
  }

  exitsTo(cells: Cell[]): number {
    this.#reachable ??= this.partsFrom(partsAfter(this.own, this.partAtArrival), this.partAtArrival);
    return this.#reachable.find(({ part }) => part.map.name === this.own.map.name && cells.some(part.touches))?.away ?? Number.POSITIVE_INFINITY;
  }

  private partsFrom(first: Part[], step: Step): PartAway[] {
    const found: PartAway[] = [];
    const known = ({ map, from }: Part) => [this.own, ...found.map(({ part }) => part)].some((part) => part.map.name === map.name && part.touches(from));
    for (let level = first, away = 1; level.length > 0; away++) {
      const next: Part[] = [];
      for (const part of level) {
        if (known(part)) continue;
        found.push({ part, away });
        next.push(...partsAfter(part, step));
      }
      level = next;
    }
    return found;
  }
}
