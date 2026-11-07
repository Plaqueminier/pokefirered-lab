import { KIND } from "../cells";
import type { FieldMove } from "../game";
import { type Atlas, type AtlasMap, atlasCells, blockedText, cellAt, personName, seenIn, WATER_RULE } from "./atlas";
import { allCells, type BlockOf, type Cell, type Destination, inside, MAX_ROUTE_MAPS, type MapSource, obstacleOnRoute, pastEdge, type Place, type RouteMap, type RoutePerson } from "./path";
import { partAt, partNear, slidesLeaving } from "./slides";

export function outsideReason(cell: Place, map: RouteMap | null, canExit: boolean, blockOf: BlockOf): string | null {
  if (!map || inside(map, cell)) return null;
  const range = `the cells of ${map.name} are x from 0 to ${map.mapWidth - 1}, y from 0 to ${map.mapHeight - 1}`;
  const side = pastEdge(map, cell);
  if (!side) return `(${cell.x}, ${cell.y}) is outside ${map.name}; ${range}`;
  if (!canExit) return `(${cell.x}, ${cell.y}) is outside ${map.name}, and a cell past an edge crosses it only in a goTo with no map; ${range}`;
  const block = blockOf(map.name, side);
  if (block) return blockedText(map.name, side, block);
  if (map.connections.some((c) => c.direction === side)) return `(${cell.x}, ${cell.y}) leads to a cell of the next map where the player cannot stand: cross the ${side} edge at another cell`;
  return `no map connects to the ${side} edge of ${map.name}; ${range}`;
}

export function noRouteReason(here: Place, destination: Destination, asked: Place, maps: MapSource, { maps: known }: Atlas, remedy: (move: FieldMove) => string): string {
  const obstacle = obstacleOnRoute(here, destination, maps);
  if (obstacle) return `you cannot go there now: a ${obstacle.name} at ${at(obstacle)} blocks the way. ${remedy(obstacle.move)}`;
  const map = known.find((m) => m.name === asked.map);
  if (map?.dark && !seenIn(map)(asked)) return `you did not see (${asked.x}, ${asked.y}) of ${asked.map}: on a dark map, you walk only on the cells that you saw`;
  const kind = map && seenIn(map)(asked) ? cellAt(map, asked) : null;
  if (kind === KIND.water) return `(${asked.x}, ${asked.y}) of ${asked.map} is water. ${WATER_RULE}`;
  if (kind === KIND.blocked) return `(${asked.x}, ${asked.y}) is a blocked cell of ${asked.map}: nobody can stand there. Read its row and its column in the grid again, then choose an open cell`;
  if (map?.dark) return `no way to ${at(asked)} on the cells that you saw: on a dark map, you walk only on these`;
  const parts = map && here.map === asked.map ? noFootWayReason(map, here, asked) : null;
  if (parts) return parts;
  return `no route from ${at(here)} to ${at(asked)} in ${MAX_ROUTE_MAPS} maps`;
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
