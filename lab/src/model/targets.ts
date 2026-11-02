import { DIRECTION_STEP, DIRECTION_STEPS, type Direction, type MapGrid, OPPOSITE } from "../game";
import { type AtlasEdge, type AtlasMap, type AtlasPerson, type AtlasSign, type AtlasWarp, blockedText, seenIn } from "../harness/atlas";
import type { Observation } from "../harness/harness";
import { type Cell, cellKey, edgeCells, free, inside, walkable } from "../harness/path";
import { atlasCells, type Beyond, type Lead, type Parts, unseenSides } from "./parts";

export type Overworld = Extract<Observation, { mode: "overworld" }>;

export type Target = { label: string } & (
  | { kind: "exit"; name: string; cell: Cell; to: string | null; warp: AtlasWarp }
  | { kind: "frontier"; cell: Cell }
  | { kind: "person"; cell: Cell; localId: number }
  | { kind: "sign"; cell: Cell; facing: Direction | "any" }
  | { kind: "edge"; name: string; side: Direction; to: string | null }
  | { kind: "map" | "lead"; map: string; cell: Cell }
);

export type Exit = Target & { kind: "exit" | "edge" };

export type LocalTarget = Exclude<Target, { kind: "map" | "lead" }>;

type Located = { target: LocalTarget; inPart: boolean };

type TargetGroup = { title: string; kinds: Target["kind"][]; empty?: string };

export const EXITS_GROUP: TargetGroup = { title: "Exits of this map:", kinds: ["exit", "edge"], empty: "none seen yet." };

export const TARGET_GROUPS: TargetGroup[] = [
  EXITS_GROUP,
  { title: "Unseen cells:", kinds: ["frontier"] },
  { title: "People and signs:", kinds: ["person", "sign"] },
  { title: "Leads, what you did not explore in other parts and maps:", kinds: ["lead"] },
  { title: "Far maps:", kinds: ["map"] },
];

const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

const EXIT_NAMES: [RegExp, string][] = [
  [/CAVE_DOOR/, "cave entrance"],
  [/DOOR/, "door"],
  [/STAIR|LADDER|ESCALATOR/, "stairs"],
  [/ARROW_WARP/, "exit mat"],
];
const EDGE_TRIES = 3;
const BEYOND_TEXT: Record<Beyond, string> = { unseen: "unseen cells", exit: "an exit not taken", nothing: "nothing new" };

function exitName(behavior: string): string {
  return EXIT_NAMES.find(([pattern]) => pattern.test(behavior))?.[1] ?? "warp";
}

function destination(to: string | null): string {
  return to ? `to ${to}` : "not taken";
}

function taken(to: string | null): string {
  return to ? `${destination(to)}, taken` : destination(to);
}

function warpDestination({ to, arrival }: AtlasWarp): string {
  return arrival ? `${destination(to)} (${arrival.x}, ${arrival.y})` : destination(to);
}

function edgeName(side: Direction): string {
  return `${side} edge`;
}

function exitPlace(w: AtlasWarp): string {
  return `${exitName(w.behavior)} at (${w.x}, ${w.y})`;
}

export function warpLabel(w: AtlasWarp): string {
  return `${exitPlace(w)}, ${warpDestination(w)}`;
}

export function edgeLabel(e: AtlasEdge, map: string): string {
  return e.blocked ? `${edgeName(e.side)}: ${blockedText(map, e.side, e.blocked)}` : `${edgeName(e.side)}, ${destination(e.to)}`;
}

export function targetLetter(index: number): string {
  return index < LETTERS.length ? LETTERS[index] : targetLetter(Math.floor(index / LETTERS.length) - 1) + LETTERS[index % LETTERS.length];
}

export function targetIndex(text: string): number {
  const letters = text.toUpperCase();
  return /^[A-Z]+$/.test(letters) ? [...letters].reduce((n, c) => n * LETTERS.length + LETTERS.indexOf(c) + 1, 0) - 1 : -1;
}

export function isExit(target: Target): target is Exit {
  return target.kind === "exit" || target.kind === "edge";
}

export function targetLines(targets: Target[], keep: (target: Target) => boolean): string[] {
  return targets.flatMap((t, i) => (keep(t) ? [`${targetLetter(i)}. ${t.label}`] : []));
}

export function personName({ graphics, rival }: AtlasPerson): string {
  return rival ? `${rival} (your rival)` : graphics.replaceAll("_", " ");
}

export function localTargets(overworld: Overworld, here: AtlasMap, parts: Parts): LocalTarget[] {
  const { grid, player, people } = overworld;
  const seen = seenIn(here);
  const { own } = parts;
  // The player talks across a counter only from its own side: a person on that side next to a counter is not behind it.
  const behindCounter = (p: Cell) => DIRECTION_STEPS.some(([, step]) => {
    const from = talkFrom(grid, p, step);
    return from.across && own.keys.has(cellKey(from.cell));
  });
  const elsewhere = (cells: Cell[], direction: string) => {
    const exits = parts.exitsTo(cells);
    return exits === Number.POSITIVE_INFINITY ? `${direction}, no seen way there yet` : `in another part of this map, ${away(exits)}`;
  };
  const where = (cell: Cell, inPart: boolean) => (inPart ? whereFrom(player, cell) : elsewhere([cell], whereFrom(player, cell)));
  const present = new Map(people.map((p) => [p.localId, p]));
  const located = (cell: Cell, inPart: boolean, target: (where: string) => LocalTarget): Located => ({ inPart, target: target(where(cell, inPart)) });
  const edge = (e: AtlasEdge): Located => {
    const cells = edgeCells(atlasCells(here), e.side).filter((c) => seen(c) && walkable(atlasCells(here), c));
    const inPart = cells.some(own.touches);
    const direction = `${edgeSteps(here, player, e.side)} ${e.side}`;
    return { inPart, target: edgeTarget(e, inPart ? direction : elsewhere(cells, direction)) };
  };
  const person = (p: AtlasPerson): Located => {
    const counter = behindCounter(p);
    return located(p, own.touches(p) || counter, (w) => personTarget(p, w, counter, present.get(p.localId)?.unbeatenTrainer === true));
  };
  const targets = [
    ...here.warps.map((w) => located(w, own.touches(w), (place) => exitTarget(w, place, parts))),
    ...here.edges.filter((e) => !e.blocked).map(edge),
    ...unseenSides(own).map(({ direction, cell }) => located(cell, true, (place): LocalTarget => ({ kind: "frontier", label: `unseen cells ${direction} of (${cell.x}, ${cell.y}), ${place}`, cell }))),
    ...here.people.filter((p) => present.has(p.localId) && seen(p)).map(person),
    ...here.signs.map((s) => located(s, own.touches(s), (place) => signTarget(s, place))),
  ];
  const group = ({ target }: Located) => TARGET_GROUPS.findIndex((g) => g.kinds.includes(target.kind));
  const steps = ({ target }: Located) => (target.kind === "edge" ? edgeSteps(here, player, target.side) : distance(player, target.cell));
  return targets.toSorted((a, b) => group(a) - group(b) || Number(b.inPart) - Number(a.inPart) || steps(a) - steps(b)).map(({ target }) => target);
}

export function leadTargets(parts: Parts): Target[] {
  return parts.leads().map((lead) => ({ kind: "lead", map: lead.map.name, cell: lead.cell, label: leadLabel(lead, parts.own.map) }));
}

export function away(distance: number): string {
  return distance === Number.POSITIVE_INFINITY ? "no known route" : `${distance} exit${distance === 1 ? "" : "s"} away`;
}

function leadLabel(lead: Lead, here: AtlasMap): string {
  const place = lead.map.name === here.name ? "in another part of this map" : `on ${lead.map.name}`;
  if (lead.kind === "unseen") return `unseen cells ${lead.direction} of (${lead.cell.x}, ${lead.cell.y}) ${place}, ${away(lead.away)}`;
  return `${exitPlace(lead.warp)} ${place}, not taken, ${away(lead.away)}: go walks next to it`;
}

function exitTarget(w: AtlasWarp, where: string, parts: Parts): LocalTarget {
  const beyond = parts.beyond(w);
  return { kind: "exit", name: exitName(w.behavior), label: `${exitPlace(w)}, ${where}: ${w.to ? `${warpDestination(w)}, taken` : destination(w.to)}${beyond ? `; beyond it: ${BEYOND_TEXT[beyond]}` : ""}`, cell: { x: w.x, y: w.y }, to: w.to, warp: w };
}

function edgeTarget(e: AtlasEdge, where: string): LocalTarget {
  const name = edgeName(e.side);
  return { kind: "edge", name, label: `${name}, ${where}: ${taken(e.to)}`, side: e.side, to: e.to };
}

function personTarget(p: AtlasPerson, where: string, behindCounter: boolean, unbeatenTrainer: boolean): LocalTarget {
  const counter = behindCounter ? ", behind a counter: go talks across it" : "";
  const trainer = unbeatenTrainer ? ", a trainer that you did not beat yet: a talk starts a battle" : "";
  const talked = p.texts.length > 0 ? `: talked, "${p.texts.at(-1)}"` : "";
  return { kind: "person", label: `${personName(p)} at (${p.x}, ${p.y}), ${where}${counter}${trainer}${talked}`, cell: { x: p.x, y: p.y }, localId: p.localId };
}

function signTarget(s: AtlasSign, where: string): LocalTarget {
  const read = s.text ? `: read, "${s.text}"` : "";
  return { kind: "sign", label: `sign at (${s.x}, ${s.y}), ${where}${read}`, cell: { x: s.x, y: s.y }, facing: s.facing };
}

function whereFrom(player: Overworld["player"], cell: Cell): string {
  const dx = cell.x - player.x;
  const dy = cell.y - player.y;
  if (dx === 0 && dy === 0) return "you stand on it";
  const [side] = DIRECTION_STEPS.find(([, [sx, sy]]) => sx === dx && sy === dy) ?? [];
  if (side) return `adjacent ${side}${side === player.facing ? ", you face it" : ""}`;
  return [dy < 0 ? `${-dy} north` : dy > 0 ? `${dy} south` : "", dx > 0 ? `${dx} east` : dx < 0 ? `${-dx} west` : ""].filter(Boolean).join(", ");
}

function edgeSteps(map: AtlasMap, { x, y }: Cell, side: Direction): number {
  return { north: y + 1, south: map.height - y, west: x + 1, east: map.width - x }[side];
}

export function approaches(target: LocalTarget, { grid, player, people }: Overworld): Cell[] {
  const isFree = (c: Cell) => free({ ...grid, people }, c);
  const nearest = (cells: Cell[]) => cells.filter(isFree).toSorted((a, b) => distance(a, player) - distance(b, player));
  switch (target.kind) {
    case "exit":
    case "frontier":
      return [target.cell];
    case "edge": {
      const [dx, dy] = DIRECTION_STEP[target.side];
      const edge = edgeCells(grid, target.side);
      const cells = nearest(edge).slice(0, EDGE_TRIES);
      const tries = cells.length > 0 ? cells : [dx === 0 ? { x: player.x, y: edge[0].y } : { x: edge[0].x, y: player.y }];
      return tries.map((c) => ({ x: c.x + dx, y: c.y + dy }));
    }
    case "person":
    case "sign": {
      const facing = target.kind === "sign" ? target.facing : "any";
      const sides = DIRECTION_STEPS.filter(([direction]) => facing === "any" || direction === OPPOSITE[facing]);
      const { x, y } = target.cell;
      const cells = nearest(sides.map(([, step]) => (target.kind === "person" ? talkFrom(grid, target.cell, step).cell : { x: x + step[0], y: y + step[1] })));
      return cells.length > 0 ? cells : [target.cell];
    }
  }
}

/** The cell to interact with from `from`: the target next to it, or the counter between them (the game lets the player talk across a counter). */
export function interactCell(target: { kind: Target["kind"]; cell: Cell }, grid: MapGrid, from: Cell): Cell | null {
  if (nextTo(from, target.cell)) return target.cell;
  if (target.kind !== "person") return null;
  const { x, y } = target.cell;
  const [, step] = DIRECTION_STEPS.find(([, step]) => {
    const side = talkFrom(grid, target.cell, step);
    return side.across && side.cell.x === from.x && side.cell.y === from.y;
  }) ?? [];
  return step ? { x: x + step[0], y: y + step[1] } : null;
}

function talkFrom(grid: MapGrid, { x, y }: Cell, [dx, dy]: [number, number]): { cell: Cell; across: boolean } {
  const across = isCounter(grid, { x: x + dx, y: y + dy });
  return { cell: across ? { x: x + 2 * dx, y: y + 2 * dy } : { x: x + dx, y: y + dy }, across };
}

function isCounter(grid: MapGrid, c: Cell): boolean {
  return inside(grid, c) && grid.behaviorNames[grid.behaviors[(c.y - grid.y0) * grid.width + (c.x - grid.x0)]] === "MB_COUNTER";
}

function nextTo(a: Cell, b: Cell): boolean {
  return distance(a, b) === 1;
}

function distance(a: Cell, b: Cell): number {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}
