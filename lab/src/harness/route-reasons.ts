import { KIND } from "../cells";
import { destinationNow, type FieldMove, type Obstacle } from "../game";
import { type Atlas, type AtlasMap, atlasCells, blockedText, cellAt, elevationSplit, personName, seenIn } from "./atlas";
import { allCells, type BlockOf, type Cell, type Destination, inside, type Leg, MAX_ROUTE_MAPS, type MapSource, obstacleOnRoute, pastEdge, type Place, type RouteMap, type RoutePerson, walkable } from "./path";
import { partAt, partNear, slidesLeaving } from "./slides";

export type Remedies = { move: (move: FieldMove) => string; obstacle: (obstacle: Obstacle) => string };

export function outsideReason(cell: Place, map: RouteMap | null, canExit: boolean, blockOf: BlockOf, remedy: Remedies["move"]): string | null {
  if (!map || inside(map, cell)) return null;
  const range = `the cells of ${map.name} are x from 0 to ${map.mapWidth - 1}, y from 0 to ${map.mapHeight - 1}`;
  const side = pastEdge(map, cell);
  if (!side) return `(${cell.x}, ${cell.y}) is outside ${map.name}; ${range}`;
  if (!canExit) return `(${cell.x}, ${cell.y}) is outside ${map.name}, and a cell past an edge crosses it only in a goTo with no map; ${range}`;
  const block = blockOf(map.name, side);
  if (block) return blockedText(map.name, side, remedy("SURF"));
  if (map.connections.some((c) => c.direction === side)) return `(${cell.x}, ${cell.y}) leads to a cell of the next map where the player cannot stand: cross the ${side} edge at another cell`;
  return `no map connects to the ${side} edge of ${map.name}; ${range}`;
}

export function noRouteReason(here: Place, destination: Destination, asked: Place, maps: MapSource, { maps: known }: Atlas, remedies: Remedies): string {
  const obstacle = obstacleOnRoute(here, destination, maps);
  if (obstacle) return `you cannot go there now: a ${obstacle.name} at ${at(obstacle)} blocks the way. ${remedies.obstacle(obstacle)}`;
  const map = known.find((m) => m.name === asked.map);
  if (map?.dark && !seenIn(map)(asked)) return `you did not see (${asked.x}, ${asked.y}) of ${asked.map}: on a dark map, you walk only on the cells that you saw`;
  const kind = map && seenIn(map)(asked) ? cellAt(map, asked) : null;
  if (kind === KIND.water) return `(${asked.x}, ${asked.y}) of ${asked.map} is water. ${remedies.move("SURF")}`;
  if (kind === KIND.blocked) return `(${asked.x}, ${asked.y}) is a blocked cell of ${asked.map}: nobody can stand there. Read its row and its column in the grid again, then choose an open cell`;
  if (map?.dark) return `no way to ${at(asked)} on the cells that you saw: on a dark map, you walk only on these`;
  const parts = map && here.map === asked.map ? (noFootWayReason(map, here, asked) ?? elevationReason(map, here, asked)) : null;
  if (parts) return parts;
  const elevator = elevatorReason(here, asked, maps);
  if (elevator) return elevator;
  return `no route from ${at(here)} to ${at(asked)} in ${MAX_ROUTE_MAPS} maps`;
}

function elevatorReason(here: Place, asked: Place, maps: MapSource): string | null {
  const exit = asked.map === here.map ? undefined : maps(here.map)?.warps.find((w) => w.dynamic);
  if (!exit) return null;
  const now = destinationNow(exit);
  if (now === asked.map) return null;
  return `${here.map} is an Elevator, and its exit leads ${now ? `to ${now}` : "to no floor"} now: choose another floor at the panel first`;
}

export function stayingReason(person: RoutePerson & Place, { maps: known }: Atlas): string {
  const seen = known.find((m) => m.name === person.map)?.people.find((p) => p.x === person.x && p.y === person.y);
  if (!seen) return "a person or an object that you did not see stands on the only way on the cells that you saw";
  return `the ${personName(seen)} at ${at(person)} stands on the only way on the cells that you saw, and it does not leave by itself. Walk next to it and interact with it, or look for another way`;
}

export function at(place: Place): string {
  return `${place.map} (${place.x}, ${place.y})`;
}

export function noFootWayReason(map: AtlasMap, here: Cell, asked: Cell): string | null {
  const own = partNear(map, here);
  const to = partNear(map, asked);
  if (!own || !to || own === to) return null;
  const view = atlasCells(map);
  const cells = allCells(view).filter((c) => partAt(map, c) === own);
  const leaves = slidesLeaving(view, cells, seenIn(map), map.slides, () => false).length > 0;
  return leaves ? `(${asked.x}, ${asked.y}) is in Part ${to}, and you are in Part ${own}: no way on foot. Only a slide leaves Part ${own}: goTo one of its spin tiles` : null;
}

/** The reason of a goTo with no route to `asked`, when `asked` is at another elevation than `here` (elevationSplit). It comes after the route searched the maps that the player knows. */
export function elevationReason(map: AtlasMap, here: Cell, asked: Cell): string | null {
  if (!elevationSplit(map, here)?.(asked)) return null;
  return `(${asked.x}, ${asked.y}) is on another level of ${map.name} than you, and no stairs that you saw join the two levels. A step from one level to the next is possible only on stairs, and no route that you know reaches it now: explore other exits first`;
}

/** The cells of the maps of `route` that the map data has open, and that a map script closed before the last step of the player on these maps. */
export function closedOnRouteMaps(route: readonly Leg[], lastSteps: MapSource, rom: MapSource): string[] {
  return [...new Set(route.map((leg) => leg.map))].flatMap((name) => {
    const now = lastSteps(name);
    const data = rom(name);
    if (!now || !data) return [];
    return allCells(data).filter((c) => walkable(data, c) && !walkable(now, c)).map((c) => at({ map: name, ...c }));
  });
}

/** Stops a walk that arrives on another map at a cell where an earlier leg of the same walk arrived. */
export class LoopGuard {
  readonly #arrivals = new Set<string>();
  readonly #closed = new Set<string>();
  #lastMap: string | null = null;

  /** The reason to stop when the walk arrives again at `here`. */
  arrive(here: Place): string | null {
    const arrived = this.#lastMap !== null && here.map !== this.#lastMap;
    this.#lastMap = here.map;
    if (!arrived) return null;
    if (this.#arrivals.has(at(here))) return loopReason(here, [...this.#closed]);
    this.#arrivals.add(at(here));
    return null;
  }

  /** The walk takes a route on the cells of the ROM: the reason names the cells that it can need. */
  romRoute(route: readonly Leg[], lastSteps: MapSource, rom: MapSource): void {
    for (const cell of closedOnRouteMaps(route, lastSteps, rom)) this.#closed.add(cell);
  }
}

function loopReason(here: Place, closed: readonly string[]): string {
  const cells = closed.length > 0 ? `; on the maps of the route, the map data has ${closed.join(", ")} open, but a map script closed them before your last step there` : "";
  return `the walk arrives again at ${at(here)}: the way to the target through the other maps is not open${cells}`;
}
