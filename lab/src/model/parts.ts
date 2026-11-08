import { DIRECTION_STEP, DIRECTION_STEPS, type Direction, LEDGE, WALL } from "../cells";
import { type Atlas, type AtlasMap, type AtlasWarp, atlasCells, fitsScreen, seenIn } from "../harness/atlas";
import { allCells, type Cell, cellKey, inside, kindAt, type MapCells, walkable, walkGroups, wallBetween } from "../harness/path";
import { partNear, type Slide, slidesLeaving } from "../harness/slides";

export type Part = {
  map: AtlasMap;
  from: Cell;
  cells: Cell[];
  keys: Set<string>;
  exits: AtlasWarp[];
  slides: Slide[];
  touches(cell: Cell): boolean;
  view: MapCells;
};

export type Lead = { map: AtlasMap; away: number; cell: Cell } & ({ kind: "unseen"; direction: Direction } | { kind: "exit"; warp: AtlasWarp } | { kind: "slide"; direction: Direction; from: Cell });

export type Beyond = "unseen" | "exit" | "nothing";

export type LeftPlace = { map: AtlasMap; away: number; ownPart: boolean; unseen: number; notTaken: number };

type PartAway = { part: Part; away: number };

type Step = (warp: AtlasWarp) => Part | null;

type Blocked = (cell: Cell) => boolean;

const NO_ONE: Blocked = () => false;

const MAX_LEADS = 4;

function isStepExit(map: AtlasMap, { x, y }: Cell): boolean {
  return map.stepExits.some((c) => c.x === x && c.y === y);
}

function partOf(map: AtlasMap, view: MapCells, from: Cell, blocked: Blocked): Part {
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
  const slides = slidesLeaving(view, cells, seen, map.slides, blocked);
  return { map, from, cells, keys, exits: map.warps.filter(touches), slides, touches, view };
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

export function unseenGroups(map: AtlasMap, outsideOf: Part[] = []): number {
  return touchingGroups(unseenFronts(map).map(({ cell }) => cell).filter((cell) => !outsideOf.some(({ keys }) => keys.has(cellKey(cell))))).length;
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
  for (const { from, direction } of unknownSlides(part)) leads.push({ kind: "slide", map: part.map, away, cell: from, direction, from: part.from });
  return leads;
}

export function unknownSlides(part: Part): Slide[] {
  return part.slides.filter((s) => !s.to);
}

export function explorableCells(map: AtlasMap): Set<string> {
  return new Set(unseenFronts(map).map(({ far }) => cellKey(far)));
}

function noSeenWayOf(group: PartAway[]): LeftPlace[] {
  const { map } = group[0].part;
  const unseen = fitsScreen(map) ? 0 : unseenGroups(map, group.map(({ part }) => part));
  return unseen > 0 ? [{ map, away: Number.POSITIVE_INFINITY, ownPart: false, unseen, notTaken: 0 }] : [];
}

export class Parts {
  readonly own: Part;
  readonly hasSlides: boolean;
  readonly #parts = new Map<string, Part>();
  readonly #blocked: Blocked;
  #reachable: PartAway[] | null = null;

  constructor(
    private readonly atlas: Atlas,
    here: AtlasMap,
    grid: MapCells,
    player: Cell,
    people: Cell[],
  ) {
    const stand = new Set(people.map(cellKey));
    this.#blocked = (c) => stand.has(cellKey(c));
    this.own = partOf(here, grid, player, this.#blocked);
    this.hasSlides = here.parts.length > 0;
  }

  numberOf(cell: Cell): number | null {
    return partNear(this.own.map, cell);
  }

  partName(cell: Cell): string | null {
    const number = this.numberOf(cell);
    return number === null ? null : `Part ${number}`;
  }

  visited(part: Part): boolean {
    const { entry, slides } = part.map;
    const stood = [entry, ...slides.map((s) => s.to)].some((c) => c !== null && part.keys.has(cellKey(c)));
    return stood || part.exits.some((w) => w.to !== null) || part.slides.some((s) => s.taken);
  }

  slideParts(): Part[] {
    const noExit: Step = () => null;
    return [this.own, ...this.partsFrom(this.partsAfter(this.own, noExit), noExit).map(({ part }) => part)];
  }

  private partsAfterSlides(part: Part): Part[] {
    return part.slides.flatMap(({ to, onSpin }) => (to && !onSpin ? [this.partAt(part.map, part.view, to)] : []));
  }

  private partsAfter(part: Part, step: Step): Part[] {
    return [...part.exits.flatMap((warp) => step(warp) ?? []), ...this.partsAfterSlides(part)];
  }

  private partAt(map: AtlasMap, view: MapCells, cell: Cell): Part {
    const key = `${map.name} ${cellKey(cell)}`;
    const part = this.#parts.get(key) ?? partOf(map, view, cell, map.name === this.own.map.name ? this.#blocked : NO_ONE);
    this.#parts.set(key, part);
    return part;
  }

  // A route goes through an Elevator only to the floor chosen now, from inside it: the Parts never do.
  private readonly partAtArrival: Step = ({ to, arrival, elevator }) => {
    const map = this.atlas.maps.find((m) => m.name === to);
    if (!map || !arrival || elevator) return null;
    return this.partAt(map, atlasCells(map), arrival);
  };

  /** Null for an exit not taken, and for an exit to an outdoor map other than the map of the player: the Known world tells these maps. */
  readonly partPast: Step = (warp) => {
    const part = this.partAtArrival(warp);
    return part && (!part.map.outside || part.map.name === this.own.map.name) ? part : null;
  };

  private partsBeyond(step: Step): PartAway[] {
    return this.partsFrom(this.partsAfter(this.own, step), step);
  }

  private reachable(): PartAway[] {
    this.#reachable ??= this.partsBeyond(this.partAtArrival);
    return this.#reachable;
  }

  beyond(warp: AtlasWarp): Beyond | null {
    const next = this.partPast(warp);
    if (!next) return null;
    const leads = this.partsFrom([next], this.partPast).flatMap(({ part, away }) => leadsOf(part, away));
    if (leads.some((lead) => lead.kind !== "exit")) return "unseen";
    return leads.length > 0 ? "exit" : "nothing";
  }

  leads(): Lead[] {
    return this.partsBeyond(this.partPast).flatMap(({ part, away }) => leadsOf(part, away)).slice(0, MAX_LEADS);
  }

  left(): LeftPlace[] {
    const own = { part: this.own, away: 0 };
    const onOwnMap = ({ part }: PartAway) => part.map.name === this.own.map.name;
    const others = [...this.partsBeyond(this.partPast).filter((found) => !onOwnMap(found)), ...this.reachable().filter(onOwnMap)];
    const byMap = (found: PartAway[]) => [...Map.groupBy(found, ({ part }) => part.map.name).values()];
    return [...[[own], ...byMap(others)].map((group) => this.placeOf(group)), ...byMap([own, ...others]).flatMap(noSeenWayOf)];
  }

  private placeOf(group: PartAway[]): LeftPlace {
    const [{ part, away }] = group;
    const sum = (count: (part: Part) => number) => group.reduce((total, member) => total + count(member.part), 0);
    return {
      map: part.map,
      away,
      ownPart: part === this.own,
      unseen: (fitsScreen(part.map) ? 0 : sum((member) => unseenPlaces(member).length)) + sum((member) => unknownSlides(member).length),
      notTaken: sum((member) => member.exits.filter((warp) => !warp.to).length),
    };
  }

  exitsTo(cells: Cell[]): number {
    return this.reachable().find(({ part }) => part.map.name === this.own.map.name && cells.some(part.touches))?.away ?? Number.POSITIVE_INFINITY;
  }

  private partsFrom(first: Part[], step: Step): PartAway[] {
    const found: PartAway[] = [];
    const known = ({ map, from }: Part) => [this.own, ...found.map(({ part }) => part)].some((part) => part.map.name === map.name && part.touches(from));
    for (let level = first, away = 1; level.length > 0; away++) {
      const next: Part[] = [];
      for (const part of level) {
        if (known(part)) continue;
        found.push({ part, away });
        next.push(...this.partsAfter(part, step));
      }
      level = next;
    }
    return found;
  }
}
