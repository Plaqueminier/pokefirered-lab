import { DIRECTION_STEPS, type Direction, KIND } from "../cells";
import { type AtlasMap, cellAt, mapNamed, UNSEEN } from "../harness/atlas";
import { type Cell, cellKey, inside } from "../harness/path";
import { Parts } from "../model/parts";
import type { Overworld } from "../model/targets";
import type { WalkCriterion } from "./genome";

type WalkTarget =
  | { kind: "exit"; cell: Cell; to: string | null }
  | { kind: "edge"; side: Direction; to: string | null }
  | { kind: "person"; cell: Cell; localId: number }
  | { kind: "sign"; cell: Cell; facing: Direction | "any" }
  | { kind: "cell"; cell: Cell };

export type WalkAction = { target: WalkTarget; criteria: Partial<Record<WalkCriterion, number>> };

/** What the Bot remembers: the cells where the player stood at a walk Decision point, by map, and the maps where the player arrived, in order. */
export type WalkMemory = { walked: ReadonlyMap<string, ReadonlySet<string>>; arrivals: readonly string[] };

function distance(a: Cell, b: Cell): number {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}

function stepsToEdge({ width, height }: AtlasMap, { x, y }: Cell, side: Direction): number {
  return { north: y + 1, south: height - y, west: x + 1, east: width - x }[side];
}

// 0 visits gives 0, 1 visit 0.5, 3 visits 0.75: the value stays below 1.
function share(count: number): number {
  return count / (1 + count);
}

function unknownNeighbours(map: AtlasMap, { x, y }: Cell): number {
  const unknown = DIRECTION_STEPS.filter(([, [dx, dy]]) => {
    const next = { x: x + dx, y: y + dy };
    return inside({ mapWidth: map.width, mapHeight: map.height }, next) && cellAt(map, next) === UNSEEN;
  });
  return unknown.length / DIRECTION_STEPS.length;
}

function onMapEdge({ width, height }: AtlasMap, { x, y }: Cell): boolean {
  return x === 0 || y === 0 || x === width - 1 || y === height - 1;
}

/** The seen exits, people and signs of the map, then each seen cell that the player can reach, in the order of one search from the player. */
export function walkActions(overworld: Overworld, { walked, arrivals }: WalkMemory): WalkAction[] {
  const { atlas, map, player, grid, people } = overworld;
  const here = mapNamed(atlas, map.name);
  const scale = here.width + here.height;
  const near = (steps: number) => Math.min(1, steps / scale);
  const previous = arrivals.findLast((name) => name !== here.name);
  const visits = (name: string) => arrivals.filter((arrival) => arrival === name).length;
  // At the `player` Knowledge level, the Bot knows where an exit leads only after it took the exit.
  const exitCriteria = (to: string | null, steps: number) => ({
    notUsed: Number(to === null),
    distance: near(steps),
    isExit: 1,
    newMap: Number(to === null || !arrivals.includes(to)),
    previousMap: Number(to !== null && to === previous),
    mapVisits: to === null ? 0 : share(visits(to)),
  });
  const exits = here.warps.map(({ x, y, to }): WalkAction => ({ target: { kind: "exit", cell: { x, y }, to }, criteria: exitCriteria(to, distance(player, { x, y })) }));
  const edges = here.edges.map(({ side, to }): WalkAction => ({ target: { kind: "edge", side, to }, criteria: exitCriteria(to, stepsToEdge(here, player, side)) }));
  // As for the model bot: a person that left the map, for example the Poké Ball of the starter, is not a target.
  const present = new Set(people.map((p) => p.localId));
  const talks = here.people.filter((p) => present.has(p.localId)).map(({ localId, x, y, texts }): WalkAction => {
    const cell = people.find((p) => p.localId === localId && p.loaded) ?? { x, y };
    return { target: { kind: "person", cell: { x: cell.x, y: cell.y }, localId }, criteria: { notUsed: Number(texts.length === 0), distance: near(distance(player, cell)), isPerson: 1 } };
  });
  const signs = here.signs.map(({ x, y, facing, text }): WalkAction => ({ target: { kind: "sign", cell: { x, y }, facing }, criteria: { notUsed: Number(text === null), distance: near(distance(player, { x, y })), isSign: 1 } }));
  const exitCells = new Set(here.warps.map(cellKey));
  const walkedHere = walked.get(here.name);
  const reachable = new Parts(atlas, here, grid, player, people.filter((p) => p.stays)).own.cells.slice(1).filter((cell) => !exitCells.has(cellKey(cell)));
  const cells = reachable.map(
    (cell): WalkAction => ({
      target: { kind: "cell", cell },
      criteria: { distance: near(distance(player, cell)), isCell: 1, neverWalked: Number(!walkedHere?.has(cellKey(cell))), unknownNeighbours: unknownNeighbours(here, cell), mapEdge: Number(onMapEdge(here, cell)), tallGrass: Number(cellAt(here, cell) === KIND.grass) },
    }),
  );
  return [...exits, ...edges, ...talks, ...signs, ...cells];
}
