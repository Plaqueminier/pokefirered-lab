import { DIRECTION_STEPS, type Direction, KIND, LEDGE, type MapGrid, type WarpExit } from "../game";

export type Cell = { x: number; y: number };
export type Place = Cell & { map: string };

export type RouteMap = Pick<MapGrid, "name" | "kinds" | "x0" | "y0" | "width" | "height" | "mapWidth" | "mapHeight"> & {
  warps: WarpExit[];
  connections: Pick<MapGrid["connections"][number], "direction" | "offset" | "map">[];
  people: Cell[];
};

export type Move = { direction: Direction; kind: "walk" | "jump" | "push" };

export type Leg = { map: string; moves: Move[] };

export type MapSource = (name: string) => RouteMap | null;

const WALKABLE = new Set<string>([KIND.open, KIND.grass]);
const WARP_COST = 4;
export const MAX_ROUTE_MAPS = 32;

type Edge = { to: Place; move: Move; cost: number; leaves: boolean };
type Link = { from: string; move: Move; leaves: boolean; to: string };

export function findRoute(from: Place, to: Place, mapOf: MapSource): Leg[] | null {
  const maps = new Map<string, RouteMap | null>();
  const load = (name: string) => {
    if (!maps.has(name)) maps.set(name, maps.size < MAX_ROUTE_MAPS ? mapOf(name) : null);
    return maps.get(name)!;
  };
  const target = load(to.map);
  if (!load(from.map) || !target || !free(target, to)) return null;

  const id = (p: Place) => `${p.map}:${p.x},${p.y}`;
  const estimate = (p: Place) => (p.map === to.map ? Math.abs(p.x - to.x) + Math.abs(p.y - to.y) : 0);
  const cost = new Map<string, number>([[id(from), 0]]);
  const cameFrom = new Map<string, Link>();
  const open = new Queue<Place>();
  open.push(from, estimate(from));

  for (let place = open.pop(); place; place = open.pop()) {
    const here = id(place);
    if (here === id(to)) return legsTo(here, from.map, cameFrom);
    const spent = cost.get(here)!;
    for (const edge of edges(place, load)) {
      const next = id(edge.to);
      const total = spent + edge.cost;
      if (cost.has(next) && cost.get(next)! <= total) continue;
      cost.set(next, total);
      cameFrom.set(next, { from: here, move: edge.move, leaves: edge.leaves, to: edge.to.map });
      open.push(edge.to, total + estimate(edge.to));
    }
  }
  return null;
}

function* edges(place: Place, load: MapSource): Generator<Edge> {
  const map = load(place.map)!;
  for (const [direction, [dx, dy]] of DIRECTION_STEPS) {
    const walk: Move = { direction, kind: "walk" };
    const press = map.warps.find((w) => w.how === "press" && w.from.x === place.x && w.from.y === place.y && w.direction === direction);
    if (press) {
      const arrival = arrivalOf(press, load);
      if (arrival) yield { to: arrival, move: { direction, kind: "push" }, cost: 1 + WARP_COST, leaves: true };
      continue;
    }
    const next = { map: place.map, x: place.x + dx, y: place.y + dy };
    if (!inside(map, next)) {
      const across = acrossConnection(map, next, direction, load);
      if (across) yield { to: across, move: walk, cost: 1, leaves: true };
      continue;
    }
    if (kindAt(map, next) === LEDGE[direction]) {
      const landing = { map: place.map, x: next.x + dx, y: next.y + dy };
      if (inside(map, landing) && free(map, landing)) yield { to: landing, move: { direction, kind: "jump" }, cost: 2, leaves: false };
      continue;
    }
    if (!free(map, next)) continue;
    const step = map.warps.find((w) => w.how === "step" && w.x === next.x && w.y === next.y);
    if (step) {
      const arrival = arrivalOf(step, load);
      if (arrival) yield { to: arrival, move: walk, cost: 1 + WARP_COST, leaves: true };
      continue;
    }
    yield { to: next, move: walk, cost: 1, leaves: false };
  }
}

function arrivalOf(warp: WarpExit, load: MapSource): Place | null {
  const arrival = load(warp.to)?.warps[warp.warpId];
  return arrival ? { map: warp.to, x: arrival.x, y: arrival.y } : null;
}

// The arrival cell follows SetPositionFromConnection in fieldmap.c.
function acrossConnection(map: RouteMap, outside: Place, direction: Direction, load: MapSource): Place | null {
  const connection = map.connections.find((c) => c.direction === direction);
  const next = connection && load(connection.map);
  if (!connection || !next) return null;
  const { offset } = connection;
  const place =
    direction === "north" ? { x: outside.x - offset, y: next.mapHeight - 1 }
    : direction === "south" ? { x: outside.x - offset, y: 0 }
    : direction === "west" ? { x: next.mapWidth - 1, y: outside.y - offset }
    : { x: 0, y: outside.y - offset };
  const arrival = { map: next.name, ...place };
  return inside(next, arrival) && free(next, arrival) ? arrival : null;
}

function inside(map: RouteMap, c: Cell): boolean {
  return c.x >= 0 && c.y >= 0 && c.x < map.mapWidth && c.y < map.mapHeight;
}

function kindAt(map: RouteMap, c: Cell): string {
  return map.kinds[(c.y - map.y0) * map.width + (c.x - map.x0)];
}

function free(map: RouteMap, c: Cell): boolean {
  return inside(map, c) && WALKABLE.has(kindAt(map, c)) && !map.people.some((p) => p.x === c.x && p.y === c.y);
}

function legsTo(end: string, start: string, cameFrom: Map<string, Link>): Leg[] {
  const links: Link[] = [];
  for (let link = cameFrom.get(end); link; link = cameFrom.get(link.from)) links.push(link);
  const legs: Leg[] = [{ map: start, moves: [] }];
  for (const link of links.reverse()) {
    legs.at(-1)!.moves.push(link.move);
    if (link.leaves) legs.push({ map: link.to, moves: [] });
  }
  return legs;
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
