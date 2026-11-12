import { DIRECTION_STEP, DIRECTION_STEPS, type Direction, OPPOSITE, SPIN } from "../cells";
import { destinationNow, type MapGrid } from "../game";
import { type ExitPlace, type AtlasEdge, type AtlasMap, type AtlasPerson, type AtlasSign, type AtlasWarp, atlasCells, blockedText, isInnerMap, personName, seenIn } from "../harness/atlas";
import type { Observation } from "../harness/harness";
import { type Cell, cellKey, edgeCells, free, inside, walkable } from "../harness/path";
import { type Beyond, closedCells, type Lead, type Parts, unseenPlaces } from "./parts";

const ITEM_BALL = "ITEM_BALL";
const OBJECTS = new Set([ITEM_BALL, "FOSSIL", "OLD_AMBER", "CLIPBOARD", "POKEDEX", "TOWN_MAP", "LAPRAS_DOLL", "METEORITE", "RUBY", "SAPPHIRE", "SNORLAX", "MEWTWO", "ARTICUNO", "ZAPDOS", "MOLTRES", "LUGIA", "HO_OH"]);
const STARTERS_MAP = "PalletTown_ProfessorOaksLab";

export type Overworld = Extract<Observation, { mode: "overworld" }>;

export type Target = { label: string } & (
  | { kind: "exit"; name: string; cell: Cell; to: string | null; warp: AtlasWarp }
  | { kind: "frontier"; cell: Cell; direction: Direction }
  | { kind: "person"; cell: Cell; localId: number }
  | { kind: "sign"; cell: Cell; facing: Direction | "any" }
  | { kind: "edge"; name: string; side: Direction; to: string | null }
  | { kind: "map" | "lead"; map: string; cell: Cell }
);

export type Exit = Target & { kind: "exit" | "edge" };

export type LocalTarget = Exclude<Target, { kind: "map" | "lead" }>;

type Located = { target: LocalTarget; inPart: boolean; inWay: boolean };

export type InTheWay = Map<string, string>;

export function peopleInTheWay({ grid, people }: Overworld, here: AtlasMap, parts: Parts): InTheWay {
  const staying = people.filter((p) => p.stays && !isBehindCounter(grid, parts, p));
  const closed = closedCells(here, atlasCells(here), staying);
  return new Map(here.people.filter((p) => closed.has(cellKey(p))).map((p) => [cellKey(p), personName(p)]));
}

// The player talks across a counter only from its own side: a person on that side next to a counter is not behind it.
function isBehindCounter(grid: MapGrid, { own }: Parts, person: Cell): boolean {
  return DIRECTION_STEPS.some(([, step]) => {
    const from = talkFrom(grid, person, step);
    return from.across && own.keys.has(cellKey(from.cell));
  });
}

function pastThe(inWay: InTheWay, cell: Cell): string {
  const name = inWay.get(cellKey(cell));
  return name ? `, past the ${name} on this cell` : "";
}

type TargetGroup = { title: string; kinds: Target["kind"][]; empty?: string };

export const EXITS_GROUP: TargetGroup = { title: "Exits of this map:", kinds: ["exit", "edge"], empty: "none seen yet." };

export const TARGET_GROUPS: TargetGroup[] = [
  { title: "Leads, what you did not explore in other parts and maps:", kinds: ["lead"] },
  EXITS_GROUP,
  { title: "Unseen cells:", kinds: ["frontier"] },
  { title: "People, objects and things to check:", kinds: ["person", "sign"] },
  { title: "Far maps:", kinds: ["map"] },
];

function targetGroup({ kind }: Target): number {
  return TARGET_GROUPS.findIndex((group) => group.kinds.includes(kind));
}

export const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

const EXIT_NAMES: [RegExp, string][] = [
  [/CAVE_DOOR/, "entrance"],
  [/DOOR/, "door"],
  [/LADDER/, "ladder"],
  [/ESCALATOR/, "escalator"],
  [/STAIR/, "stairs"],
  [/ARROW_WARP/, "exit mat"],
  [/REGULAR_WARP/, "teleport pad"],
  [/FALL_WARP/, "hole"],
];
const PLACE_TEXT: Record<ExitPlace, string> = {
  center: "a Pokémon Center",
  mart: "a Poké Mart",
  departmentStore: "a department store",
  gym: "a Gym",
  house: "a house",
  gate: "a gate building",
  cave: "a cave entrance",
  path: "a path to another map",
  harbor: "a harbor",
  building: "a building",
  outside: "the outside",
};
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

function placeText({ place }: AtlasWarp): string[] {
  return place ? [PLACE_TEXT[place]] : [];
}

function withArrival(text: string, arrival: Cell | null): string {
  return arrival ? `${text} (${arrival.x}, ${arrival.y})` : text;
}

function beyondText(beyond: Beyond | null): string {
  return beyond ? `; beyond it: ${BEYOND_TEXT[beyond]}` : "";
}

function warpFacts(w: AtlasWarp): string {
  return [...placeText(w), withArrival(destination(w.to), w.arrival)].join(", ");
}

function edgeName(side: Direction): string {
  return `${side} edge`;
}

function exitAt(w: AtlasWarp): string {
  return `${exitName(w.behavior)} at (${w.x}, ${w.y})`;
}

export function exitSight(w: AtlasWarp): string {
  return [exitAt(w), ...placeText(w)].join(", ");
}

export function warpLabel(w: AtlasWarp): string {
  return `${exitAt(w)}, ${warpFacts(w)}`;
}

/** The labels of the exits of a map, with the rows of an Elevator exit as one exit. */
export function exitLabels(warps: AtlasWarp[]): string[] {
  const [first, ...more] = warps.filter((w) => w.elevator);
  const elevator = first ? [`${exitAt(first)}, ${ELEVATOR_TEXT}${floorsKnown([first, ...more]).map((known) => `; ${known}`).join("") || ", not taken"}`] : [];
  return [...warps.filter((w) => !w.elevator).map(warpLabel), ...elevator];
}

const ELEVATOR_TEXT = "an Elevator, to the floor chosen at the panel";

function floorsKnown(floors: AtlasWarp[]): string[] {
  const known = floors.flatMap((w) => (w.to ? [withArrival(w.to, w.arrival)] : []));
  return known.length > 0 ? [`floors known: ${known.join(", ")}`] : [];
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

export function localTargets(overworld: Overworld, here: AtlasMap, parts: Parts, inWay: InTheWay): LocalTarget[] {
  const { grid, player, people } = overworld;
  const seen = seenIn(here);
  const { own } = parts;
  const elsewhere = (cells: Cell[], direction: string) => {
    const exits = parts.exitsTo(cells);
    const part = cells.map((c) => parts.partName(c)).find((name) => name !== null);
    if (exits === Number.POSITIVE_INFINITY) return `${direction}${part ? `, in ${part}` : ""}, no seen way there yet`;
    return `in ${part ?? "another part of this map"}, ${away(exits, hopsOf(parts))}`;
  };
  const where = (cell: Cell, inPart: boolean) => (inPart ? whereFrom(player, cell) : elsewhere([cell], whereFrom(player, cell)));
  const present = new Map(people.map((p) => [p.localId, p]));
  const located = (cell: Cell, inPart: boolean, target: (where: string) => LocalTarget): Located => ({ inPart, inWay: false, target: target(where(cell, inPart)) });
  const edge = (e: AtlasEdge): Located => {
    const cells = edgeCells(atlasCells(here), e.side).filter((c) => seen(c) && walkable(atlasCells(here), c));
    const inPart = cells.some(own.touches);
    const direction = `${edgeSteps(here, player, e.side)} ${e.side}`;
    return { inPart, inWay: false, target: edgeTarget(e, inPart ? direction : elsewhere(cells, direction)) };
  };
  const person = (p: AtlasPerson): Located => {
    const counter = isBehindCounter(grid, parts, p);
    const closes = inWay.has(cellKey(p));
    return { ...located(p, own.touches(p) || counter, (w) => personTarget(p, w, { behindCounter: counter, unbeatenTrainer: present.get(p.localId)?.unbeatenTrainer === true, object: objectText(p, here), inWay: closes })), inWay: closes };
  };
  const elevator = (floors: AtlasWarp[]): Located[] => {
    const [first] = floors;
    if (!first) return [];
    const live = grid.warps.find((w) => w.dynamic);
    return [located(first, own.touches(first), (place) => elevatorTarget(first, floors, live ? destinationNow(live) : null, place, parts))];
  };
  const targets = [
    ...here.warps.filter((w) => !w.elevator).map((w) => located(w, own.touches(w), (place) => exitTarget(w, place, parts))),
    ...elevator(here.warps.filter((w) => w.elevator)),
    ...here.edges.filter((e) => !e.blocked).map(edge),
    ...unseenPlaces(own).map(({ direction, cell }) => located(cell, true, (place): LocalTarget => ({ kind: "frontier", label: `unseen cells ${direction} of (${cell.x}, ${cell.y}), ${place}${pastThe(inWay, cell)}`, cell, direction }))),
    ...here.people.filter((p) => present.has(p.localId) && seen(p)).map(person),
    ...here.signs.map((s) => located(s, own.touches(s), (place) => signTarget(s, place))),
  ];
  const steps = ({ target }: Located) => (target.kind === "edge" ? edgeSteps(here, player, target.side) : distance(player, target.cell));
  // Run 00062: a lead had 6 letters in 371 prompts, so these maps sort by cell and not by distance.
  const cellOrder = ({ target }: Located) => (target.kind === "edge" ? 0 : target.cell.y * here.width + target.cell.x);
  const order = isInnerMap(here) ? cellOrder : steps;
  return targets.toSorted((a, b) => targetGroup(a.target) - targetGroup(b.target) || Number(b.inPart) - Number(a.inPart) || Number(b.inWay) - Number(a.inWay) || order(a) - order(b)).map(({ target }) => target);
}

export function nearestUnseen(targets: Target[], player: Overworld["player"]): string | null {
  const frontiers = targets.flatMap((target, index) => (target.kind === "frontier" ? [{ cell: target.cell, index }] : []));
  const nearest = frontiers.toSorted((a, b) => distance(player, a.cell) - distance(player, b.cell))[0];
  return nearest ? `${whereFrom(player, nearest.cell)} (go ${targetLetter(nearest.index)})` : null;
}

export function leadTargets(parts: Parts, inWay: InTheWay): Target[] {
  return parts.leads().map((lead) => ({ kind: "lead", map: lead.map.name, cell: lead.cell, label: `${leadLabel(lead, parts)}${lead.map.name === parts.own.map.name ? pastThe(inWay, lead.cell) : ""}` }));
}

export type Hops = readonly [one: string, many: string];

const EXIT_HOPS: Hops = ["exit", "exits"];
const SLIDE_HOPS: Hops = ["exit or slide", "exits or slides"];

export function hopsOf(parts: Parts): Hops {
  return parts.hasSlides ? SLIDE_HOPS : EXIT_HOPS;
}

export function away(distance: number, [one, many]: Hops = EXIT_HOPS): string {
  return distance === Number.POSITIVE_INFINITY ? "no known route" : `${distance} ${distance === 1 ? one : many} away`;
}

function leadLabel(lead: Lead, parts: Parts): string {
  const here = parts.own.map;
  const part = lead.map.name === here.name ? parts.partName(lead.kind === "slide" ? lead.from : lead.cell) : null;
  const place = lead.map.name !== here.name ? `on ${lead.map.name}` : part ? `in ${part} of this map` : "in another part of this map";
  const distance = away(lead.away, hopsOf(parts));
  if (lead.kind === "unseen") return `unseen cells ${lead.direction} of (${lead.cell.x}, ${lead.cell.y}) ${place}, ${distance}`;
  if (lead.kind === "slide") return `spin tile ${SPIN[lead.direction]} at (${lead.cell.x}, ${lead.cell.y}) ${place}, a slide whose end you did not see, ${distance}`;
  return `${exitAt(lead.warp)} ${place}, ${warpFacts(lead.warp)}, ${distance}: go walks next to it`;
}

function exitTarget(w: AtlasWarp, where: string, parts: Parts): LocalTarget {
  const beyond = parts.beyond(w);
  return { kind: "exit", name: exitName(w.behavior), label: `${exitAt(w)}, ${where}: ${warpFacts(w)}${w.to ? ", taken" : ""}${beyondText(beyond)}`, cell: { x: w.x, y: w.y }, to: w.to, warp: w };
}

function elevatorTarget(first: AtlasWarp, floors: AtlasWarp[], now: string | null, where: string, parts: Parts): LocalTarget {
  const facts = [...(now ? [`now ${now}`] : []), ...floorsKnown(floors)].join("; ");
  const current = floors.find((w) => w.to !== null && w.to === now);
  const label = `${exitAt(first)}, ${where}: ${ELEVATOR_TEXT}, ${facts || "not taken"}${beyondText(current ? parts.beyond(current) : null)}`;
  return { kind: "exit", name: exitName(first.behavior), label, cell: { x: first.x, y: first.y }, to: now, warp: current ?? { ...first, to: now, arrival: null } };
}

function edgeTarget(e: AtlasEdge, where: string): LocalTarget {
  const name = edgeName(e.side);
  return { kind: "edge", name, label: `${name}, ${where}: ${taken(e.to)}`, side: e.side, to: e.to };
}

function objectText({ graphics }: AtlasPerson, here: AtlasMap): string {
  if (graphics === ITEM_BALL && here.name !== STARTERS_MAP) return ": a free item, go takes it";
  return OBJECTS.has(graphics) ? ", an object that you can interact with" : "";
}

function personTarget(p: AtlasPerson, where: string, { behindCounter, unbeatenTrainer, object, inWay }: { behindCounter: boolean; unbeatenTrainer: boolean; object: string; inWay: boolean }): LocalTarget {
  const counter = behindCounter ? ", behind a counter: go talks across it" : "";
  const trainer = unbeatenTrainer ? ", a trainer that you did not beat yet: a talk starts a battle" : "";
  const way = inWay ? ", in your way: on the cells that you saw, the way past it stays closed while it is here" : "";
  const talked = p.texts.length > 0 ? `: talked, "${p.texts.at(-1)}"` : "";
  return { kind: "person", label: `${personName(p)} at (${p.x}, ${p.y}), ${where}${counter}${trainer}${object}${way}${talked}`, cell: { x: p.x, y: p.y }, localId: p.localId };
}

export function checkName({ x, y }: Cell): string {
  return `something you can check at (${x}, ${y})`;
}

function signTarget(s: AtlasSign, where: string): LocalTarget {
  const read = s.text ? `: read, "${s.text}"` : "";
  return { kind: "sign", label: `${checkName(s)}, ${where}${read}`, cell: { x: s.x, y: s.y }, facing: s.facing };
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

/** The fields of a target that `approaches` reads: a `LocalTarget` of the model bot, or a walk target of the Genetic bot. */
type Approached = { kind: "exit" | "frontier" | "person"; cell: Cell } | { kind: "edge"; side: Direction } | { kind: "sign"; cell: Cell; facing: Direction | "any" };

export function approaches(target: Approached, { grid, player, people }: Overworld): Cell[] {
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
