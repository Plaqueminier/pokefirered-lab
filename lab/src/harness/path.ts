import { DIRECTION_STEP, DIRECTION_STEPS, type Direction, ELEVATION_SHIFT, KIND, LEDGE, OPPOSITE, SHORE_ELEVATION, STOP, SWITCH, WALL } from "../cells";
import type { FlyDestination } from "../fly-destinations";
import type { MapGrid, Obstacle, WarpExit } from "../game";

export type Cell = { x: number; y: number };
export type Place = Cell & { map: string };

export type RoutePerson = Cell & { graphics: string; stays: boolean };

export type RouteMap = Pick<MapGrid, "name" | "kinds" | "x0" | "y0" | "width" | "height" | "mapWidth" | "mapHeight" | "blocks"> & {
  warps: WarpExit[];
  connections: Pick<MapGrid["connections"][number], "direction" | "offset" | "map">[];
  people: RoutePerson[];
  obstacles: Obstacle[];
  removable: Cell[];
  flyDestinations: readonly FlyDestination[];
};

type Move = { direction: Direction; kind: "walk" | "jump" | "push" | "remove" | "surf" };

export type WalkLeg = { map: string; moves: Move[] };

export type Leg = WalkLeg | { map: string; fly: FlyDestination };

export type MapSource = (name: string) => RouteMap | null;

/**
 * With `blocks`, a step follows the elevation rule. A grid of the game always has them. `atlasCells` gives them only on a
 * map that keeps its elevations, with the elevation bits only, so on other maps a part of the Atlas reads no elevation.
 */
export type MapCells = Pick<RouteMap, "kinds" | "x0" | "y0" | "width" | "mapWidth" | "mapHeight"> & { blocks?: readonly number[] };

const WALKABLE = new Set<string>([KIND.open, KIND.grass, KIND.surf, STOP, SWITCH, ...Object.values(WALL)]);
const WATER_KINDS = new Set<string>([KIND.water, KIND.surf]);
const WARP_COST = 4;
// Measured frames.
const STEP_FRAMES = 16;
const CUT_FRAMES = 545;
const SURF_FRAMES = 452;
const FLY_FRAMES = 700;
const MOVE_COST: Record<Move["kind"], number> = { walk: 1, jump: 2, push: 1, remove: Math.round(CUT_FRAMES / STEP_FRAMES), surf: Math.round(SURF_FRAMES / STEP_FRAMES) };
const FLY_COST = Math.round(FLY_FRAMES / STEP_FRAMES);
export const MAX_ROUTE_MAPS = 32;

type Step = { move: Move } | { fly: FlyDestination };
type Edge = Step & { to: Place; cost: number; leaves: boolean };
type Link = Step & { from: string; leaves: boolean; to: Place };

/** With `exit`, the destination is the arrival of an exit: it can be a cell where the player cannot stand (the arrival of a door is a blocked cell), and the player reaches it when it arrives on its map. */
export type Destination = Place & { exit?: boolean };

export function findRoute(from: Place, to: Destination, mapOf: MapSource): Leg[] | null {
  const links = search(from, to, mapOf);
  return links && legsOf(links, from.map);
}

export function obstacleOnRoute(from: Place, to: Destination, mapOf: MapSource): (Obstacle & { map: string }) | null {
  const open: MapSource = (name) => {
    const map = mapOf(name);
    if (!map) return null;
    const kinds = [...map.kinds];
    for (const { x, y } of map.obstacles) kinds[(y - map.y0) * map.width + (x - map.x0)] = KIND.open;
    return { ...map, kinds: kinds.join(""), people: [] };
  };
  for (const { to: place } of search(from, to, open) ?? []) {
    const obstacle = mapOf(place.map)?.obstacles.find((o) => o.x === place.x && o.y === place.y);
    if (obstacle) return { ...obstacle, map: place.map };
  }
  return null;
}

export type NoRoute = { kind: "closed" } | { kind: "walker" } | { kind: "staying"; person: RoutePerson & { map: string } };

export function whyNoRoute(from: Place, to: Destination, mapOf: MapSource): NoRoute {
  const only = (keep: (person: RoutePerson) => boolean): MapSource => (name) => {
    const map = mapOf(name);
    return map && { ...map, people: map.people.filter(keep) };
  };
  const stays = (person: RoutePerson) => person.stays;
  const open = search(from, to, only(() => false));
  if (!open) return { kind: "closed" };
  if (search(from, to, only(stays))) return { kind: "walker" };
  const onRoute = open.flatMap(({ to: place }) => {
    const person = mapOf(place.map)?.people.find((p) => stays(p) && p.x === place.x && p.y === place.y);
    return person ? [{ person, map: place.map }] : [];
  });
  // A person before the last one that the player can reach is one that a walk goes around, and a person after it stands past it.
  const reachable = onRoute.findLast(({ person, map }) => search(from, { map, x: person.x, y: person.y }, only((p) => stays(p) && p !== person)));
  return reachable ? { kind: "staying", person: { ...reachable.person, map: reachable.map } } : { kind: "walker" };
}

function search(from: Place, to: Destination, mapOf: MapSource): Link[] | null {
  const maps = new Map<string, RouteMap | null>();
  let walkMaps = 0;
  const load: MapLoad = (name, byFlight = false) => {
    if (!maps.has(name) && (byFlight || walkMaps < MAX_ROUTE_MAPS)) {
      maps.set(name, mapOf(name));
      if (!byFlight) walkMaps++;
    }
    return maps.get(name) ?? null;
  };
  const flownFrom = new Set<string>();
  const target = load(to.map);
  if (!load(from.map) || !target || !(to.exit || free(target, to) || removableAt(target, to))) return null;

  const id = (p: Place) => `${p.map}:${p.x},${p.y}`;
  const estimate = (p: Place) => (p.map === to.map ? Math.abs(p.x - to.x) + Math.abs(p.y - to.y) : 0);
  const cost = new Map<string, number>([[id(from), 0]]);
  const cameFrom = new Map<string, Link>();
  const open = new Queue<Place>();
  open.push(from, estimate(from));

  for (let place = open.pop(); place; place = open.pop()) {
    const here = id(place);
    if (here === id(to)) return linksTo(here, cameFrom);
    const spent = cost.get(here)!;
    // A flight costs the same from each cell of a map, so only the first cell of the map that the search reaches can fly.
    const flies = !flownFrom.has(place.map);
    flownFrom.add(place.map);
    for (const { cost: edgeCost, ...edge } of edges(place, load, flies)) {
      const next = id(edge.to);
      const total = spent + edgeCost;
      if (cost.has(next) && cost.get(next)! <= total) continue;
      cost.set(next, total);
      cameFrom.set(next, { from: here, ...edge });
      open.push(edge.to, total + estimate(edge.to));
    }
  }
  return null;
}

type MapLoad = (name: string, byFlight?: boolean) => RouteMap | null;

function* edges(place: Place, load: MapLoad, flies: boolean): Generator<Edge> {
  const map = load(place.map)!;
  for (const destination of flies ? map.flyDestinations : []) {
    if (load(destination.map, true)) yield { to: { map: destination.map, x: destination.x, y: destination.y }, fly: destination, cost: FLY_COST, leaves: true };
  }
  const onWater = isSurf(map, place);
  for (const [direction, [dx, dy]] of DIRECTION_STEPS) {
    const walk: Move = { direction, kind: "walk" };
    const press = map.warps.find((w) => w.how === "press" && w.from.x === place.x && w.from.y === place.y && w.direction === direction);
    if (press) {
      const arrival = arrivalOf(press, load);
      if (arrival) yield { to: arrival, move: { direction, kind: "push" }, cost: MOVE_COST.push + WARP_COST, leaves: true };
      continue;
    }
    const next = { map: place.map, x: place.x + dx, y: place.y + dy };
    if (!inside(map, next)) {
      const across = acrossConnection(map, next, direction, load);
      const kind = across && stepKind(map, place, load(across.map)!, across);
      if (across && kind) yield { to: across, move: { direction, kind }, cost: MOVE_COST[kind], leaves: true };
      continue;
    }
    if (wallBetween(map, place, direction)) continue;
    if (kindAt(map, next) === LEDGE[direction]) {
      const landing = { map: place.map, x: next.x + dx, y: next.y + dy };
      if (!onWater && inside(map, landing) && free(map, landing) && !isSurf(map, landing)) yield { to: landing, move: { direction, kind: "jump" }, cost: MOVE_COST.jump, leaves: false };
      continue;
    }
    if (removableAt(map, next)) {
      if (!onWater) yield { to: next, move: { direction, kind: "remove" }, cost: MOVE_COST.remove, leaves: false };
      continue;
    }
    if (!free(map, next)) continue;
    const kind = stepKind(map, place, map, next);
    if (kind !== "walk") {
      if (kind) yield { to: next, move: { direction, kind }, cost: MOVE_COST[kind], leaves: false };
      continue;
    }
    const step = map.warps.find((w) => w.how === "step" && w.x === next.x && w.y === next.y);
    if (step) {
      const arrival = arrivalOf(step, load);
      if (arrival) yield { to: arrival, move: walk, cost: MOVE_COST.walk + WARP_COST, leaves: true };
      continue;
    }
    yield { to: next, move: walk, cost: MOVE_COST.walk, leaves: false };
  }
}

// The exit task of a door moves the player off its cell (SetUpWarpExitTask), so a walk cannot end on it.
export function destinationOf(cell: Place, canExit: boolean, load: MapSource): Destination {
  const map = load(cell.map);
  const warp = map && warpAt(map, cell);
  if (!canExit) return warp && "from" in warp && warp.from ? { map: cell.map, ...warp.from } : cell;
  const arrival = map && exitArrival(map, cell, load);
  return arrival && arrival.map !== cell.map ? { ...arrival, exit: true } : cell;
}

export function reached(destination: Destination, here: Place): boolean {
  const steps = Math.abs(here.x - destination.x) + Math.abs(here.y - destination.y);
  return here.map === destination.map && steps <= (destination.exit ? 1 : 0);
}

function isSurf(map: MapCells, cell: Cell): boolean {
  return kindAt(map, cell) === KIND.surf;
}

function isWater(map: MapCells, cell: Cell): boolean {
  return WATER_KINDS.has(kindAt(map, cell));
}

export function startsSurf(map: RouteMap, from: Cell, to: Cell): boolean {
  return inside(map, to) && free(map, to) && stepKind(map, from, map, to) === "surf";
}

// IsElevationMismatchAt for a step, ObjectEventDoesElevationMatch for a talk. No layout of FireRed has a cell at 15,
// the elevation where an object keeps its old elevation.
export function elevationsJoin(a: number, b: number): boolean {
  return a === 0 || b === 0 || a === b;
}

export function elevationAt(map: Omit<MapCells, "kinds">, cell: Cell): number {
  return inside(map, cell) && map.blocks ? map.blocks[cellIndex(map, cell)] >> ELEVATION_SHIFT : 0;
}

export function neighbours(cell: Cell): (Cell & { direction: Direction })[] {
  return DIRECTION_STEPS.map(([direction, [dx, dy]]) => ({ direction, x: cell.x + dx, y: cell.y + dy }));
}

/**
 * How the game takes a step between two cells, by their elevations and their water (IsElevationMismatchAt,
 * IsPlayerFacingSurfableFishableWater, CanStopSurfing). SURF starts and stops only between land at SHORE_ELEVATION
 * and water at an elevation that does not join it. A step from water to water is free.
 */
function elevationStep(from: number, fromWater: boolean, to: number, toWater: boolean): "walk" | "surf" | null {
  if (fromWater && toWater) return "walk";
  if (fromWater === toWater) return elevationsJoin(from, to) ? "walk" : null;
  if ((fromWater ? to : from) !== SHORE_ELEVATION || elevationsJoin(from, to)) return null;
  return fromWater ? "walk" : "surf";
}

/** A cell of land for the elevations of a map. A warp cell does not count: the escalator of a Pokémon Center is at another elevation. */
export function elevationLand(map: MapCells, warps: readonly Cell[]): (cell: Cell) => boolean {
  const keys = new Set(warps.map(cellKey));
  return (c) => walkable(map, c) && !isWater(map, c) && !keys.has(cellKey(c));
}

/** A step between two cells of land that the elevation rule refuses. */
export function hasElevationEdges(map: MapCells & Pick<RouteMap, "warps">): boolean {
  const land = elevationLand(map, map.warps);
  const refused = (c: Cell, n: Cell & { direction: Direction }) => land(n) && !wallBetween(map, c, n.direction) && !elevationsJoin(elevationAt(map, c), elevationAt(map, n));
  return allCells(map).some((c) => land(c) && neighbours(c).some((n) => (n.direction === "east" || n.direction === "south") && refused(c, n)));
}

/** The cells through which a walk reaches `cell`: the cell when it is open, else also the cells next to it, as for a door or a sign. */
export function joinCells(map: MapCells, cell: Cell): Cell[] {
  return walkable(map, cell) ? [cell] : [cell, ...neighbours(cell)];
}

function stepKind(map: RouteMap, from: Cell, next: RouteMap, to: Cell): "walk" | "surf" | null {
  return elevationStep(elevationAt(map, from), isWater(map, from), elevationAt(next, to), isWater(next, to));
}

function removableAt(map: RouteMap, { x, y }: Cell): boolean {
  return map.removable.some((c) => c.x === x && c.y === y);
}

function warpAt(map: Pick<RouteMap, "warps">, { x, y }: Cell): WarpExit | undefined {
  return map.warps.find((w) => w.how !== "none" && w.x === x && w.y === y);
}

function exitArrival(map: RouteMap, cell: Cell, load: MapSource): Place | null {
  const warp = warpAt(map, cell);
  if (warp) return arrivalOf(warp, load);
  const side = pastEdge(map, cell);
  return side && acrossConnection(map, { map: map.name, ...cell }, side, load);
}

/** The edge that a cell just past it crosses, for example (x, -1) the north edge. */
export function pastEdge(map: Pick<MapCells, "mapWidth" | "mapHeight">, cell: Cell): Direction | null {
  return (
    cell.y === -1 ? "north"
    : cell.y === map.mapHeight ? "south"
    : cell.x === -1 ? "west"
    : cell.x === map.mapWidth ? "east"
    : null
  );
}

function arrivalOf(warp: WarpExit, load: MapSource): Place | null {
  const arrival = load(warp.to)?.warps[warp.warpId];
  return arrival ? { map: warp.to, x: arrival.x, y: arrival.y } : null;
}

function acrossConnection(map: RouteMap, outside: Place, direction: Direction, load: MapSource): Place | null {
  const connection = map.connections.find((c) => c.direction === direction);
  const next = connection && load(connection.map);
  if (!connection || !next) return null;
  const arrival = { map: next.name, ...arrivalCell(next, connection.offset, direction, outside) };
  return inside(next, arrival) && free(next, arrival) ? arrival : null;
}

// The arrival cell follows SetPositionFromConnection in fieldmap.c.
function arrivalCell(next: Pick<MapCells, "mapWidth" | "mapHeight">, offset: number, direction: Direction, outside: Cell): Cell {
  return (
    direction === "north" ? { x: outside.x - offset, y: next.mapHeight - 1 }
    : direction === "south" ? { x: outside.x - offset, y: 0 }
    : direction === "west" ? { x: next.mapWidth - 1, y: outside.y - offset }
    : { x: 0, y: outside.y - offset }
  );
}

export type EdgeBlock = "water";

export type BlockOf = (map: string, side: Direction) => EdgeBlock | null;

export function edgeBlock(map: MapCells & Pick<RouteMap, "connections">, side: Direction, load: (name: string) => MapCells | null): EdgeBlock | null {
  const connection = map.connections.find((c) => c.direction === side);
  const next = connection && load(connection.map);
  if (!connection || !next) return null;
  const [dx, dy] = DIRECTION_STEP[side];
  const crossings = edgeCells(map, side).map((from) => ({ from, to: arrivalCell(next, connection.offset, side, { x: from.x + dx, y: from.y + dy }) }));
  const water = (cells: MapCells, c: Cell) => inside(cells, c) && kindAt(cells, c) === KIND.water;
  if (crossings.some(({ from, to }) => walkable(map, from) && walkable(next, to))) return null;
  return crossings.some(({ from, to }) => water(map, from) || water(next, to)) ? "water" : null;
}

export function inside(map: Pick<MapCells, "mapWidth" | "mapHeight">, c: Cell): boolean {
  return c.x >= 0 && c.y >= 0 && c.x < map.mapWidth && c.y < map.mapHeight;
}

export function cellKey({ x, y }: Cell): string {
  return `${x},${y}`;
}

export function edgeCells(map: Pick<MapCells, "mapWidth" | "mapHeight">, side: Direction): Cell[] {
  const vertical = side === "north" || side === "south";
  return Array.from({ length: vertical ? map.mapWidth : map.mapHeight }, (_, i) => {
    if (vertical) return { x: i, y: side === "north" ? 0 : map.mapHeight - 1 };
    return { x: side === "west" ? 0 : map.mapWidth - 1, y: i };
  });
}

export function onlySeen(map: RouteMap, seen: (cell: Cell) => boolean): RouteMap {
  const cellOf = (i: number) => ({ x: map.x0 + (i % map.width), y: map.y0 + Math.floor(i / map.width) });
  return {
    ...map,
    kinds: Array.from(map.kinds, (kind, i) => (inside(map, cellOf(i)) && !seen(cellOf(i)) ? KIND.blocked : kind)).join(""),
    // Each warp keeps its index: `arrivalOf` reads the list by the id of the warp.
    warps: map.warps.map((warp) => (seen(warp) ? warp : { x: warp.x, y: warp.y, to: warp.to, warpId: warp.warpId, how: "none" })),
    obstacles: map.obstacles.filter(seen),
    removable: map.removable.filter(seen),
  };
}

export function nextStraightStep(map: MapCells & Pick<RouteMap, "warps"> & { people: Cell[] }, from: Cell, direction: Direction): Cell | null {
  const [dx, dy] = DIRECTION_STEP[direction];
  const next = { x: from.x + dx, y: from.y + dy };
  return inside(map, next) && !wallBetween(map, from, direction) && free(map, next) && !warpAt(map, next) ? next : null;
}

/** The side of `direction` that a walk from `from` to `to` goes to. Null for a walk straight in `direction`. */
export function headingAlong(from: Cell, to: Cell, direction: Direction): Direction | null {
  if (direction === "north" || direction === "south") return to.x === from.x ? null : to.x < from.x ? "west" : "east";
  return to.y === from.y ? null : to.y < from.y ? "north" : "south";
}

/** One step along a wall on `side`, while `side` has unseen cells on the next cell or the cell after it: 3 x 3 sight sees one cell ahead. */
export function nextStepAlong(map: MapCells & Pick<RouteMap, "warps"> & { people: Cell[] }, from: Cell, side: Direction, heading: Direction, seen: (cell: Cell) => boolean): Cell | null {
  const next = nextStraightStep(map, from, heading);
  if (!next) return null;
  const [dx, dy] = DIRECTION_STEP[heading];
  const [sideX, sideY] = DIRECTION_STEP[side];
  const unseenAt = ({ x, y }: Cell) => inside(map, { x: x + sideX, y: y + sideY }) && !seen({ x: x + sideX, y: y + sideY });
  return unseenAt(next) || unseenAt({ x: next.x + dx, y: next.y + dy }) ? next : null;
}

function cellIndex(map: Pick<MapCells, "x0" | "y0" | "width">, c: Cell): number {
  return (c.y - map.y0) * map.width + (c.x - map.x0);
}

export function kindAt(map: MapCells, c: Cell): string {
  return map.kinds[cellIndex(map, c)];
}

export function walkable(map: MapCells, c: Cell): boolean {
  return inside(map, c) && WALKABLE.has(kindAt(map, c));
}

export function wallBetween(map: MapCells, from: Cell, direction: Direction): boolean {
  const [dx, dy] = DIRECTION_STEP[direction];
  return kindAt(map, from) === WALL[direction] || kindAt(map, { x: from.x + dx, y: from.y + dy }) === WALL[OPPOSITE[direction]];
}

/**
 * Where a step in `direction` goes: null across a thin wall, past a ledge when the next cell is a ledge in this direction
 * (the jump does not read the elevation), and null when the elevation rule refuses it, on a map with its blocks.
 */
export function stepFrom(map: MapCells, cell: Cell, direction: Direction): Cell | null {
  if (wallBetween(map, cell, direction)) return null;
  const [dx, dy] = DIRECTION_STEP[direction];
  const next = { x: cell.x + dx, y: cell.y + dy };
  if (kindAt(map, next) === LEDGE[direction]) return { x: next.x + dx, y: next.y + dy };
  const refused = map.blocks && inside(map, next) && !elevationStep(elevationAt(map, cell), isWater(map, cell), elevationAt(map, next), isWater(map, next));
  return refused ? null : next;
}

export function allCells({ mapWidth, mapHeight }: Pick<MapCells, "mapWidth" | "mapHeight">): Cell[] {
  return Array.from({ length: mapWidth * mapHeight }, (_, i) => ({ x: i % mapWidth, y: Math.floor(i / mapWidth) }));
}

/** The groups of the `open` cells of a map that steps connect, in both directions: the number of the group of each cell by `cellKey`, and the first cell of a group gives its number. */
export function walkGroups(map: MapCells, open: (cell: Cell) => boolean): { cells: Cell[]; groups: Map<string, number>; stepsOf: (cell: Cell) => Cell[] } {
  const cells = allCells(map).filter(open);
  const stepsOf = (cell: Cell) => DIRECTION_STEPS.flatMap(([direction]) => stepFrom(map, cell, direction) ?? []).filter(open);
  const links = new Map<string, Cell[]>(cells.map((cell) => [cellKey(cell), []]));
  for (const cell of cells) {
    for (const next of stepsOf(cell)) {
      links.get(cellKey(cell))?.push(next);
      links.get(cellKey(next))?.push(cell);
    }
  }
  const groups = new Map<string, number>();
  for (const [group, start] of cells.entries()) {
    if (groups.has(cellKey(start))) continue;
    groups.set(cellKey(start), group);
    const stack = [start];
    for (let cell = stack.pop(); cell; cell = stack.pop()) {
      for (const next of links.get(cellKey(cell)) ?? []) {
        if (groups.has(cellKey(next))) continue;
        groups.set(cellKey(next), group);
        stack.push(next);
      }
    }
  }
  return { cells, groups, stepsOf };
}

export function free(map: MapCells & { people: Cell[] }, c: Cell): boolean {
  return walkable(map, c) && !map.people.some((p) => p.x === c.x && p.y === c.y);
}

function linksTo(end: string, cameFrom: Map<string, Link>): Link[] {
  const links: Link[] = [];
  for (let link = cameFrom.get(end); link; link = cameFrom.get(link.from)) links.push(link);
  return links.reverse();
}

function legsOf(links: Link[], start: string): Leg[] {
  const legs: Leg[] = [];
  let walk: WalkLeg = { map: start, moves: [] };
  for (const link of links) {
    if ("fly" in link) {
      if (walk.moves.length > 0) legs.push(walk);
      legs.push({ map: walk.map, fly: link.fly });
    } else {
      walk.moves.push(link.move);
      if (!link.leaves) continue;
      legs.push(walk);
    }
    walk = { map: link.to.map, moves: [] };
  }
  return [...legs, walk];
}

// The queue gives the items with equal scores in push order, so a Run gets the same route on each start (ADR 0002).
class Queue<T> {
  private readonly heap: { item: T; score: number; order: number }[] = [];
  private pushed = 0;

  push(item: T, score: number): void {
    const heap = this.heap;
    heap.push({ item, score, order: this.pushed++ });
    for (let i = heap.length - 1; i > 0; ) {
      const parent = (i - 1) >> 1;
      if (!this.before(i, parent)) break;
      [heap[i], heap[parent]] = [heap[parent], heap[i]];
      i = parent;
    }
  }

  pop(): T | undefined {
    const heap = this.heap;
    const top = heap[0];
    const last = heap.pop();
    if (heap.length > 0 && last) {
      heap[0] = last;
      for (let i = 0; ; ) {
        const left = i * 2 + 1;
        const right = left + 1;
        let best = i;
        if (left < heap.length && this.before(left, best)) best = left;
        if (right < heap.length && this.before(right, best)) best = right;
        if (best === i) break;
        [heap[i], heap[best]] = [heap[best], heap[i]];
        i = best;
      }
    }
    return top?.item;
  }

  private before(a: number, b: number): boolean {
    const x = this.heap[a];
    const y = this.heap[b];
    return x.score < y.score || (x.score === y.score && x.order < y.order);
  }
}
