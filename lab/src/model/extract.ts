import type { Direction, Obstacle } from "../game";
import { type Atlas, type AtlasEdge, type AtlasMap, type AtlasPerson, cellAt, mapNamed, seenIn } from "../harness/atlas";
import { type Cell, cellKey, kindAt } from "../harness/path";
import { obstacleRemedy } from "../protocol";
import { EXITS_GROUP, edgeLabel, isExit, localTargets, type Overworld, personName, TARGET_GROUPS, type Target, targetLetter, targetLines, warpLabel } from "./targets";

export const OTHER_MAPS_BUDGET = 1500;
export const FULL_ATLAS_BUDGET = 100_000;
const LEGEND = 'Legend: # blocked, . open, " tall grass, ~ water, ^ v < > a ledge that you jump down in that direction only, ? not seen, @ you, letters the targets';
const LONG_MARK = "*";

export type AtlasView = { lines: string[]; targets: Target[] };

type MapDistance = { map: AtlasMap; distance: number };

export function atlasExtract(overworld: Overworld): AtlasView {
  const here = mapNamed(overworld.atlas, overworld.map.name);
  const local = localTargets(overworld, here);
  const view = [...localView(overworld, here, local), ...edgeLines(here), ...peopleLines(here), ...obstacleLines(here)];
  const outside = outsideLine(overworld.atlas, here, local);
  let neighbours: string[] = [];
  let targets = [...local];
  const lines = () => extractLines(view, neighbours, targets, outside);
  const localSize = lines().join("\n").length;
  for (const { map, distance } of byDistance(overworld.atlas, here.name)) {
    const before = { neighbours, targets };
    if (distance === 1) neighbours = [...neighbours, neighbourLine(map, local)];
    else if (map.entry) targets = [...targets, { kind: "map", label: `${map.name}, ${away(distance)}`, map: map.name, cell: map.entry }];
    else continue;
    if (lines().join("\n").length - localSize <= OTHER_MAPS_BUDGET) continue;
    ({ neighbours, targets } = before);
    break;
  }
  return { lines: lines(), targets };
}

export function localView({ grid, player }: Overworld, here: AtlasMap, targets: Target[]): string[] {
  const seen = seenIn(here);
  const marks = new Map<string, string>();
  targets.forEach((t, i) => {
    const letter = targetLetter(i);
    if (t.kind !== "edge" && t.kind !== "map") marks.set(cellKey(t.cell), letter.length === 1 ? letter : LONG_MARK);
  });
  marks.set(cellKey(player), "@");
  const cell = (c: Cell) => marks.get(cellKey(c)) ?? (seen(c) ? kindAt(grid, c) : "?");
  const legend = [...marks.values()].includes(LONG_MARK) ? `${LEGEND}, ${LONG_MARK} a target after Z.` : `${LEGEND}.`;
  return [`Map ${here.name}: ${ranges(here)}. You are at (${player.x}, ${player.y}), facing ${player.facing}.`, legend, ...gridLines(here, cell)];
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

function neighbourLine(map: AtlasMap, targets: Target[]): string {
  const by = targets.flatMap((t, i) => (isExit(t) && t.to === map.name ? [`${targetLetter(i)} (${t.name})`] : []));
  const lead = by.length === 0 ? `- ${map.name}.` : `- ${by.join(" and ")} lead${by.length === 1 ? "s" : ""} to ${map.name}.`;
  return `${lead} Its exits (cells of ${map.name}): ${exitsText(map)}.`;
}

export function fullAtlas(overworld: Overworld): string[] {
  const lines = ["", "Full Atlas, the other maps that you know, nearest first:"];
  let size = lines.join("\n").length;
  let detailed = true;
  for (const { map, distance } of byDistance(overworld.atlas, overworld.map.name)) {
    const talked = talkedPeople(map);
    const about = `${away(distance)}. Exits: ${exitsText(map)}.${signsText(map)}${talked.length === 0 ? "" : ` People: ${talked.map(personText).join("; ")}.`}${obstaclesText(map)}`;
    const block = [`Map ${map.name}: ${ranges(map)}, ${about}`, ...gridLines(map, (c) => cellAt(map, c))];
    const blockSize = block.join("\n").length + 1;
    if (detailed && size + blockSize <= FULL_ATLAS_BUDGET) {
      lines.push(...block);
      size += blockSize;
      continue;
    }
    detailed = false;
    lines.push(`- ${map.name}, ${about}`);
  }
  return lines;
}

function gridLines(map: AtlasMap, cell: (c: Cell) => string): string[] {
  const digits = Math.max(2, String(map.height - 1).length);
  const margin = " ".repeat(digits + 4);
  const columns = range(0, map.width - 1);
  return [
    `${margin}${columns.map((x) => (x % 10 === 0 ? String(Math.floor(x / 10) % 10) : " ")).join("")}`.trimEnd(),
    `${margin}${columns.map((x) => x % 10).join("")}`,
    ...range(0, map.height - 1).map((y) => `y=${String(y).padStart(digits)}  ${columns.map((x) => cell({ x, y })).join("")}`),
  ];
}

function exitsText(map: AtlasMap): string {
  return [...map.warps.map(warpLabel), ...map.edges.map((e) => edgeLabel(e, map.name))].join("; ") || "none";
}

function signsText(map: AtlasMap): string {
  const read = map.signs.flatMap((s) => (s.text ? [`sign at (${s.x}, ${s.y}): "${s.text}"`] : []));
  return read.length === 0 ? "" : ` Signs: ${read.join("; ")}.`;
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

function away(distance: number): string {
  if (distance === Number.POSITIVE_INFINITY) return "no known route";
  return `${distance} exit${distance === 1 ? "" : "s"} away`;
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

function range(from: number, to: number): number[] {
  return Array.from({ length: to - from + 1 }, (_, i) => from + i);
}
