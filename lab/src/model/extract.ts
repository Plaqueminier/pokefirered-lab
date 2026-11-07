import { type Direction, KIND, LEDGE, SPIN, STOP, WALL } from "../cells";
import type { FieldMove, Obstacle } from "../game";
import { type Atlas, type AtlasEdge, type AtlasMap, type AtlasPerson, atlasCells, isInnerMap, mapNamed, seenIn, UNSEEN, personName } from "../harness/atlas";
import { type Cell, cellKey, kindAt, type MapCells } from "../harness/path";
import type { Slide } from "../harness/slides";
import { obstacleRemedy } from "../protocol";
import { explorableCells, type LeftPlace, type Part, Parts, unknownSlides, unseenGroups } from "./parts";
import { away, EXITS_GROUP, type Hops, hopsOf, edgeLabel, exitSight, isExit, LETTERS, leadTargets, localTargets, nearestUnseen, type Overworld, peopleInTheWay, checkName, exitLabels, TARGET_GROUPS, type Target, targetLetter, targetLines, warpLabel } from "./targets";

export const OTHER_MAPS_BUDGET = 1500;
export const MAX_FAR_MAPS = 8;
export const FULL_ATLAS_BUDGET = 100_000;
const LONG_MARK = "*";
const BLANK = " ";
const PLAYER_SIGN = "@";
const RULER_EVERY = 10;
const FIELD_MOVES: Record<FieldMove, { hm: string; sign: string; legend: string }> = {
  CUT: { hm: "HM01", sign: "t", legend: "a cut tree" },
  "ROCK SMASH": { hm: "HM06", sign: "r", legend: "a rock that ROCK SMASH breaks" },
  STRENGTH: { hm: "HM04", sign: "b", legend: "a boulder that STRENGTH pushes" },
  SURF: { hm: "HM03", sign: "w", legend: "water" },
};
const SPIN_SIGNS = Object.values(SPIN);
const SPIN_RULE =
  "Spin tiles: when you step on a spin tile, you slide in the direction of its arrow and you cannot stop. Another spin tile on the way changes your direction to its arrow. You stop on a stop tile (o), or on the last cell before a blocked cell or a person. A stop tile that you walk on, with no slide, is normal floor.";
const PARTS_TITLE = "Parts of this map: the cells of a part connect on foot, with no spin tile, and slides link the parts. The numbers of the parts stay the same on this map.";
const LEGEND: [signs: string, text: string][] = [
  [KIND.blocked, `${KIND.blocked} blocked`],
  [KIND.open, `${KIND.open} open`],
  [KIND.grass, `${KIND.grass} tall grass`],
  ...Object.entries(LEDGE).map(([side, sign]): [string, string] => [sign, `${sign} a ledge that you jump down to the ${side} only`]),
  [UNSEEN, `${UNSEEN} not seen, next to a cell where you can walk`],
  [BLANK, "a blank cell not seen, and no cell that you saw leads to it"],
  [PLAYER_SIGN, `${PLAYER_SIGN} you`],
  [LETTERS, "letters the targets"],
  ...Object.entries(WALL).map(([side, sign]): [string, string] => [sign, `${sign} an open cell with a thin wall on its ${side} side: you cannot step across that side`]),
  ...Object.values(FIELD_MOVES).map(({ sign, legend }): [string, string] => [sign, `${sign} ${legend}`]),
  [SPIN_SIGNS.join(""), `${SPIN_SIGNS.join(" ")} a spin tile`],
  [STOP, `${STOP} a stop tile`],
  [LONG_MARK, `${LONG_MARK} a target after Z`],
];
const OWN_PART_SEEN = "You saw all the cells that you can reach from here on this map. Other parts of it can have unseen cells: to go on, take an exit or a lead.";
const MAP_SEEN = "You saw all the cells of this map.";
const LEFT_TITLE = "What is left (from the game, not from your notes: if your Memory tree disagrees, this list is right):";
const NOTHING_LEFT = "- Nothing that a way that you saw reaches: to go on, take an exit to another map.";

export type AtlasView = { lines: string[]; targets: Target[]; left: string[]; spinTiles: boolean };

type MapDistance = { map: AtlasMap; distance: number };

type HasMove = (move: FieldMove) => boolean;

type WorldFacts = Pick<Overworld, "atlas" | "bag" | "party">;

function readableWorld({ atlas, bag, party }: WorldFacts): { atlas: Atlas; hasMove: HasMove } {
  const items = new Set(bag.flatMap((pocket) => pocket.items.map((item) => item.name)));
  const known = new Set(party.flatMap((mon) => mon.moves.map((move) => move.name)));
  const hasMove: HasMove = (move) => items.has(FIELD_MOVES[move].hm) || known.has(move);
  return { atlas: { ...atlas, maps: atlas.maps.map((map) => ({ ...map, obstacles: map.obstacles.filter((o) => hasMove(o.move)) })) }, hasMove };
}

export function darkOfMap({ atlas, map }: Pick<Overworld, "atlas" | "map">): AtlasMap["dark"] {
  return mapNamed(atlas, map.name).dark;
}

/** The current map has what this move works on: FLASH a map that is dark for the model, SURF an edge with water, CUT, ROCK SMASH and STRENGTH their Fixed obstacle. */
export function moveObstacleHere(move: string, overworld: Overworld): boolean {
  if (move === "FLASH") return darkOfMap(overworld) !== undefined;
  const here = mapNamed(overworld.atlas, overworld.map.name);
  return move === "SURF" ? here.edges.some((edge) => edge.blocked === "water") : here.obstacles.some((obstacle) => obstacle.move === move);
}

export function atlasExtract(overworld: Overworld): AtlasView {
  const { atlas, hasMove } = readableWorld(overworld);
  const here = mapNamed(atlas, overworld.map.name);
  const parts = new Parts(atlas, here, overworld.grid, overworld.player, overworld.people.filter((p) => p.stays));
  const inWay = peopleInTheWay(overworld, here, parts);
  const near = [...leadTargets(parts, inWay), ...localTargets(overworld, here, parts, inWay)];
  const view = [...drawnView(overworld, here, hasMove, near), ...seenLines(here, near, parts), ...partLines(parts), ...edgeLines(here), ...peopleLines(here), ...obstacleLines(here)];
  const outside = outsideLine(atlas, here, near);
  let neighbours: string[] = [];
  let targets = near;
  const lines = () => extractLines(view, neighbours, targets, outside);
  const localSize = lines().join("\n").length;
  for (const { map, distance } of byDistance(atlas, here.name)) {
    const before = { neighbours, targets };
    if (distance === 1) neighbours = [...neighbours, ...neighbourLines(map, near, parts)];
    else if (map.entry && targets.length - near.length < MAX_FAR_MAPS) targets = [...targets, { kind: "map", label: `${map.name}, ${away(distance)}`, map: map.name, cell: map.entry }];
    else continue;
    if (lines().join("\n").length - localSize <= OTHER_MAPS_BUDGET) continue;
    ({ neighbours, targets } = before);
    break;
  }
  return { lines: lines(), targets, left: leftLines(overworld, here, parts, near), spinTiles: parts.hasSlides };
}

function leftLines({ player }: Overworld, here: AtlasMap, parts: Parts, targets: Target[]): string[] {
  if (!isInnerMap(here)) return [];
  const lines = parts.left().flatMap((place) => leftLine(place, here, place.ownPart ? nearestUnseen(targets, player) : null, hopsOf(parts)));
  return [LEFT_TITLE, ...(lines.length > 0 ? lines : [NOTHING_LEFT])];
}

function leftLine({ map, away: exits, ownPart, unseen, notTaken }: LeftPlace, here: AtlasMap, nearest: string | null, hops: Hops): string[] {
  const facts = [
    ...(unseen > 0 ? [`${counted(unseen, "unseen place", "unseen places")}${nearest ? `, the nearest ${nearest}` : ""}`] : []),
    ...(notTaken > 0 ? [counted(notTaken, "exit not taken", "exits not taken")] : []),
  ];
  if (facts.length === 0) return [];
  const distance = exits === Number.POSITIVE_INFINITY ? "no seen way yet" : away(exits, hops);
  const where = ownPart ? "your part" : `${map.name === here.name ? "other parts, " : ""}${distance}`;
  return [`- ${map.name}, ${where}: ${facts.join(", ")}.`];
}

function counted(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

export function localView(overworld: Overworld): string[] {
  const { atlas, hasMove } = readableWorld(overworld);
  return drawnView(overworld, mapNamed(atlas, overworld.map.name), hasMove, []);
}

function drawnView({ grid, player }: Overworld, here: AtlasMap, hasMove: HasMove, targets: Target[]): string[] {
  const marks = new Map<string, string>();
  targets.forEach((t, i) => {
    const letter = targetLetter(i);
    if (t.kind !== "edge" && t.kind !== "lead") marks.set(cellKey(t.cell), letter.length === 1 ? letter : LONG_MARK);
  });
  marks.set(cellKey(player), PLAYER_SIGN);
  const sign = cellSigns(here, grid, hasMove);
  const rows = cellRows(here, (c) => marks.get(cellKey(c)) ?? sign(c));
  const rule = here.parts.length > 0 ? [SPIN_RULE] : [];
  return [`Map ${here.name}: ${ranges(here)}. You are at (${player.x}, ${player.y}), facing ${player.facing}.`, legendOf(rows), ...rule, ...gridLines(here, rows)];
}

function partLines(parts: Parts): string[] {
  if (!parts.hasSlides) return [];
  const slideLine = ({ from, direction, to, onSpin, taken }: Slide) => {
    const tile = `  - spin tile ${SPIN[direction]} at (${from.x}, ${from.y})`;
    if (!to) return `${tile}: its way goes through a cell that you did not see, so its end is unknown`;
    const part = parts.partName(to);
    const where = onSpin ? ", a spin tile where you stop" : part ? `, in ${part}` : "";
    return `${tile}: slides to (${to.x}, ${to.y})${where}${taken ? ", taken" : ""}`;
  };
  const partBlock = ({ part, number }: { part: Part; number: number }) => {
    const tags = part === parts.own ? " (you)" : parts.visited(part) ? " (visited)" : "";
    const xs = part.cells.map((c) => c.x);
    const ys = part.cells.map((c) => c.y);
    const box = `x ${Math.min(...xs)}-${Math.max(...xs)}, y ${Math.min(...ys)}-${Math.max(...ys)}`;
    const slides = part.slides.length === 0 ? ["  - no slide to another part"] : part.slides.map(slideLine);
    return [`Part ${number}${tags}: ${part.cells.length} cells, ${box}.`, ...slides];
  };
  const numbered = parts.slideParts().flatMap((part) => {
    const number = parts.numberOf(part.from);
    return number === null ? [] : [{ part, number }];
  });
  return ["", PARTS_TITLE, ...numbered.toSorted((a, b) => a.number - b.number).flatMap(partBlock)];
}

function cellSigns(map: AtlasMap, view: MapCells, hasMove: HasMove): (c: Cell) => string {
  const seen = seenIn(map);
  const explorable = explorableCells(map);
  const obstacles = new Map(map.obstacles.map((o) => [cellKey(o), FIELD_MOVES[o.move].sign]));
  return (c) => {
    if (!seen(c)) return explorable.has(cellKey(c)) ? UNSEEN : BLANK;
    const kind = kindAt(view, c);
    if (kind === KIND.water) return hasMove("SURF") ? FIELD_MOVES.SURF.sign : KIND.blocked;
    return obstacles.get(cellKey(c)) ?? kind;
  };
}

function legendOf(rows: string[]): string {
  const drawn = new Set(rows.join(""));
  return `Legend: ${LEGEND.flatMap(([signs, text]) => ([...signs].some((sign) => drawn.has(sign)) ? [text] : [])).join("; ")}.`;
}

function seenLines(here: AtlasMap, targets: Target[], parts: Parts): string[] {
  if (targets.some((t) => t.kind === "frontier") || unknownSlides(parts.own).length > 0) return [];
  return [here.cells.includes(UNSEEN) ? OWN_PART_SEEN : MAP_SEEN];
}

function extractLines(view: string[], neighbours: string[], targets: Target[], outside: string | null): string[] {
  const groups = TARGET_GROUPS.flatMap((group) => {
    const lines = targetLines(targets, (t) => group.kinds.includes(t.kind));
    const shown = lines.length > 0 ? [group.title, ...lines] : group.empty ? [`${group.title} ${group.empty}`] : [];
    return group === EXITS_GROUP && outside ? [...shown, outside] : shown;
  });
  return [...view, ...(neighbours.length === 0 ? [] : ["", "Maps one exit away:", ...neighbours]), "", ...groups];
}

function ranges(map: AtlasMap): string {
  return `x from 0 to ${map.width - 1}, y from 0 to ${map.height - 1}`;
}

const CROSS: Record<Direction, (map: AtlasMap) => string> = {
  north: () => "goTo <x> -1",
  south: (map) => `goTo <x> ${map.height}`,
  west: () => "goTo -1 <y>",
  east: (map) => `goTo ${map.width} <y>`,
};

function edgeLines(here: AtlasMap): string[] {
  const line = (e: AtlasEdge) => `- ${edgeLabel(e, here.name)}${e.blocked ? "." : `: ${CROSS[e.side](here)}`}`;
  if (here.edges.length > 0) return ["Edges that lead to another map:", ...here.edges.map(line)];
  return [here.hasEdges ? "Edges: no edge that you saw leads to another map yet." : "Edges: no edge of this map leads to another map."];
}

function outsideLine(atlas: Atlas, here: AtlasMap, targets: Target[]): string | null {
  const leadsOn = (to: string | null) => {
    const there = to && atlas.maps.find((m) => m.name === to);
    return !there || [...there.warps, ...there.edges].some((e) => e.to !== here.name);
  };
  if (targets.some((t) => isExit(t) && leadsOn(t.to))) return null;
  const unseen = targets.flatMap((t, i) => (t.kind === "frontier" ? [targetLetter(i)] : []));
  return `No exit to the outside is seen yet${unseen.length === 0 ? "." : `: explore ${unseen.join(" or ")}.`}`;
}

function neighbourLines(map: AtlasMap, targets: Target[], parts: Parts): string[] {
  const all = `Its exits (cells of ${map.name}): ${exitsText(map)}.`;
  const lines = new Map<string, { by: string[]; exits: string }>();
  targets.forEach((t, i) => {
    if (!isExit(t) || t.to !== map.name) return;
    const part = t.kind === "exit" ? parts.partPast(t.warp) : null;
    const exits = part?.exits.length ? `From there you can walk to: ${exitLabels(part.exits).join("; ")}.` : all;
    const line = lines.get(exits) ?? { by: [], exits };
    lines.set(exits, { ...line, by: [...line.by, `${targetLetter(i)} (${t.name})`] });
  });
  if (lines.size === 0) return [`- ${map.name}. ${all}`];
  return [...lines.values()].map(({ by, exits }) => `- ${by.join(" and ")} lead${by.length === 1 ? "s" : ""} to ${map.name}. ${exits}`);
}

export function fullAtlas(overworld: Overworld): string[] {
  const { atlas, hasMove } = readableWorld(overworld);
  const title = ["", "Full Atlas, the other maps that you know, nearest first:"];
  const lines: string[] = [];
  const drawnRows: string[] = [];
  let size = title.join("\n").length;
  let detailed = true;
  for (const { map, distance } of byDistance(atlas, overworld.map.name)) {
    const talked = talkedPeople(map);
    const about = `${away(distance)}. Exits: ${exitsText(map)}.${signsText(map)}${talked.length === 0 ? "" : ` People: ${talked.map(personText).join("; ")}.`}${obstaclesText(map)}`;
    if (detailed) {
      const rows = cellRows(map, cellSigns(map, atlasCells(map), hasMove));
      const block = [`Map ${map.name}: ${ranges(map)}, ${about}`, ...gridLines(map, rows)];
      const blockSize = block.join("\n").length + 1;
      if (size + blockSize <= FULL_ATLAS_BUDGET) {
        lines.push(...block);
        drawnRows.push(...rows);
        size += blockSize;
        continue;
      }
      detailed = false;
    }
    lines.push(`- ${map.name}, ${about}`);
  }
  return [...title, ...(drawnRows.length === 0 ? [] : [legendOf(drawnRows)]), ...lines];
}

function cellRows(map: AtlasMap, cell: (c: Cell) => string): string[] {
  return range(0, map.height - 1).map((y) => range(0, map.width - 1).map((x) => cell({ x, y })).join(""));
}

function gridLines(map: AtlasMap, rows: string[]): string[] {
  const digits = Math.max(2, String(map.height - 1).length);
  const margin = " ".repeat(digits + 4);
  const columns = range(0, map.width - 1);
  const header = [
    `${margin}${columns.map((x) => (x % 10 === 0 ? String(Math.floor(x / 10) % 10) : " ")).join("")}`.trimEnd(),
    `${margin}${columns.map((x) => x % 10).join("")}`,
  ];
  return rows.flatMap((row, y) => [...(y % RULER_EVERY === 0 ? header : []), `y=${String(y).padStart(digits)}  ${row}`]);
}

function exitsText(map: AtlasMap): string {
  return [...exitLabels(map.warps), ...map.edges.map((e) => edgeLabel(e, map.name))].join("; ") || "none";
}

function signsText(map: AtlasMap): string {
  const read = map.signs.flatMap((s) => (s.text ? [`${checkName(s)}: "${s.text}"`] : []));
  return read.length === 0 ? "" : ` Things to check: ${read.join("; ")}.`;
}

function talkedPeople(map: AtlasMap): AtlasPerson[] {
  return map.people.filter((p) => p.texts.length > 0);
}

function peopleLines(map: AtlasMap): string[] {
  const talked = talkedPeople(map);
  return talked.length === 0 ? [] : ["", "What the people of this map said to you:", ...talked.map((p) => `- ${personText(p)}`)];
}

function obstacleText({ name, x, y, move }: Obstacle): string {
  return `${name} at (${x}, ${y}). ${obstacleRemedy(move)}.`;
}

function obstacleLines(map: AtlasMap): string[] {
  return map.obstacles.length === 0 ? [] : ["", "Fixed obstacles of this map, not targets:", ...map.obstacles.map((o) => `- ${obstacleText(o)}`)];
}

function obstaclesText(map: AtlasMap): string {
  return map.obstacles.length === 0 ? "" : ` Fixed obstacles: ${map.obstacles.map(obstacleText).join(" ")}`;
}

function personText(person: AtlasPerson): string {
  return `${personName(person)}, last seen at (${person.x}, ${person.y}): ${person.texts.map((t) => `"${t}"`).join("; ")}`;
}

function byDistance(atlas: Atlas, from: string): MapDistance[] {
  const links = new Map<string, Set<string>>();
  const link = (a: string, b: string) => links.set(a, (links.get(a) ?? new Set()).add(b));
  for (const map of atlas.maps) {
    for (const to of [...map.warps, ...map.edges].map((e) => e.to)) {
      if (!to) continue;
      link(map.name, to);
      link(to, map.name);
    }
  }
  const distances = new Map([[from, 0]]);
  const queue = [from];
  for (let name = queue.shift(); name !== undefined; name = queue.shift()) {
    for (const next of links.get(name) ?? []) {
      if (distances.has(next)) continue;
      distances.set(next, distances.get(name)! + 1);
      queue.push(next);
    }
  }
  return atlas.maps
    .filter((m) => m.name !== from)
    .map((map) => ({ map, distance: distances.get(map.name) ?? Number.POSITIVE_INFINITY }))
    .toSorted((a, b) => a.distance - b.distance);
}

export function knownWorld(facts: WorldFacts): string[] {
  const { atlas } = readableWorld(facts);
  const lines = atlas.maps.filter((m) => m.outside).map((map) => knownMapLine(atlas, map));
  return lines.length === 0 ? [] : ["Known world, the outdoor maps that you visited, the first visit first:", ...lines];
}

function knownMapLine(atlas: Atlas, map: AtlasMap): string {
  const edge = ({ side, to, blocked }: AtlasEdge) => `${side} ${blocked ? `blocked (${blocked})` : to ? `to ${to}` : "not visited"}`;
  const passages: string[] = [];
  const buildings: string[] = [];
  const entered = new Set<string>();
  for (const warp of map.warps) {
    if (!warp.to || entered.has(warp.to)) continue;
    entered.add(warp.to);
    const { through, outdoor } = beyond(atlas, map.name, warp.to);
    if (outdoor.length === 0) buildings.push(warpLabel(warp));
    else passages.push(`${warpLabel(warp)}, a passage${through.length === 0 ? "" : ` through ${through.join(", ")}`} to ${outdoor.join(" and ")}`);
  }
  const notTaken = map.warps.filter((w) => !w.to).map(exitSight);
  const groups = unseenGroups(map);
  return [
    `- ${map.name}: edges: ${map.edges.map(edge).join(", ") || "none seen"}.`,
    ...(passages.length === 0 ? [] : [`Passages: ${passages.join("; ")}.`]),
    ...(buildings.length === 0 ? [] : [`Buildings entered: ${buildings.join("; ")}.`]),
    ...(notTaken.length === 0 ? [] : [`Exits not taken: ${notTaken.join("; ")}.`]),
    groups === 0 ? "No open cell next to unseen cells." : `${groups} group${groups === 1 ? "" : "s"} of open cells next to unseen cells.`,
    ...(map.obstacles.length === 0 ? [] : [`Fixed obstacles: ${map.obstacles.map(({ name, x, y }) => `${name} at (${x}, ${y})`).join(", ")}.`]),
  ].join(" ");
}

function beyond(atlas: Atlas, from: string, first: string): { through: string[]; outdoor: string[] } {
  const maps = new Map(atlas.maps.map((m) => [m.name, m]));
  if (maps.get(first)?.outside) return { through: [], outdoor: [first] };
  const indoor = [first];
  const outdoor = new Set<string>();
  for (const name of indoor) {
    for (const to of [...(maps.get(name)?.warps ?? []), ...(maps.get(name)?.edges ?? [])].map((e) => e.to)) {
      const next = to && maps.get(to);
      if (!next || indoor.includes(next.name)) continue;
      if (!next.outside) indoor.push(next.name);
      else if (next.name !== from) outdoor.add(next.name);
    }
  }
  return { through: indoor.slice(1), outdoor: [...outdoor] };
}

function range(from: number, to: number): number[] {
  return Array.from({ length: to - from + 1 }, (_, i) => from + i);
}
