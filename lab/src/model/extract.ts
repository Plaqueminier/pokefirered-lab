import { type Atlas, type AtlasMap, cellAt, mapNamed, seenIn } from "../harness/atlas";
import { type Cell, cellKey, kindAt } from "../harness/path";
import { edgeLabel, localTargets, type Overworld, type Target, warpLabel } from "./targets";

export const EXTRACT_BUDGET = 2000;
export const FULL_ATLAS_BUDGET = 15_000;
const MARKS = "123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";

export type AtlasView = { lines: string[]; targets: Target[] };

type MapDistance = { map: AtlasMap; distance: number };

/** Past the budget only the far maps lose their line, by the choice in issue #11: the map of the player and its targets stay. */
export function atlasExtract(overworld: Overworld): AtlasView {
  const here = mapNamed(overworld.atlas, overworld.map.name);
  const local = localTargets(overworld, here);
  const view = localView(overworld, here, local);
  let neighbours: string[] = [];
  let targets = [...local];
  for (const { map, distance } of byDistance(overworld.atlas, here.name)) {
    const next =
      distance === 1 ? { neighbours: [...neighbours, `- ${map.name}: ${exitsText(map)}`], targets }
      : map.entry ? { neighbours, targets: [...targets, mapTarget(map, map.entry, distance)] }
      : null;
    if (!next) continue;
    if (extractLines(view, next.neighbours, next.targets).join("\n").length > EXTRACT_BUDGET) break;
    ({ neighbours, targets } = next);
  }
  return { lines: extractLines(view, neighbours, targets), targets };
}

export function localView({ grid, player }: Overworld, here: AtlasMap, targets: Target[]): string[] {
  const seen = seenIn(here);
  const marks = new Map<string, string>();
  targets.forEach((t, i) => {
    if (t.kind !== "edge" && t.kind !== "map") marks.set(cellKey(t.cell), MARKS[i] ?? "*");
  });
  marks.set(cellKey(player), "@");
  const cell = (c: Cell) => marks.get(cellKey(c)) ?? (seen(c) ? kindAt(grid, c) : "?");
  return [`Map ${here.name}, ${here.width} × ${here.height} cells. You are at (${player.x}, ${player.y}), facing ${player.facing}.`, ...gridLines(here, cell)];
}

function extractLines(view: string[], neighbours: string[], targets: Target[]): string[] {
  return [
    ...view,
    ...(neighbours.length === 0 ? [] : ["", "Maps one exit away:", ...neighbours]),
    ...(targets.length === 0 ? [] : ["", "Targets:", ...targets.map((t, i) => `${i + 1}. ${t.label}`)]),
  ];
}

function mapTarget(map: AtlasMap, cell: Cell, distance: number): Target {
  return { kind: "map", label: `go to ${map.name} (${away(distance)})`, map: map.name, cell };
}

export function fullAtlas(overworld: Overworld): string[] {
  const lines = ["", "Full Atlas, the other maps that you know, nearest first:"];
  let size = lines.join("\n").length;
  let detailed = true;
  for (const { map, distance } of byDistance(overworld.atlas, overworld.map.name)) {
    const about = `${away(distance)}. Exits: ${exitsText(map)}.${signsText(map)}`;
    const block = [`Map ${map.name}, ${map.width} × ${map.height} cells, ${about}`, ...gridLines(map, (c) => cellAt(map, c))];
    const blockSize = block.join("\n").length + 1;
    if (detailed && size + blockSize <= FULL_ATLAS_BUDGET) {
      lines.push(...block);
      size += blockSize;
      continue;
    }
    detailed = false;
    const line = `- ${map.name}, ${about}`;
    if (size + line.length + 1 > FULL_ATLAS_BUDGET) break;
    lines.push(line);
    size += line.length + 1;
  }
  return lines;
}

function gridLines(map: AtlasMap, cell: (c: Cell) => string): string[] {
  const seen = seenIn(map);
  const xs: number[] = [];
  const ys: number[] = [];
  for (let y = 0; y < map.height; y++) {
    for (let x = 0; x < map.width; x++) {
      if (!seen({ x, y })) continue;
      xs.push(x);
      ys.push(y);
    }
  }
  if (xs.length === 0) return [];
  const columns = range(Math.min(...xs), Math.max(...xs));
  return [
    `    ${columns.map((x, i) => (x % 10 === 0 || i === 0 ? String(Math.floor(x / 10) % 10) : " ")).join("")}`.trimEnd(),
    `    ${columns.map((x) => x % 10).join("")}`,
    ...range(Math.min(...ys), Math.max(...ys)).map((y) => `${String(y).padStart(3)} ${columns.map((x) => cell({ x, y })).join("")}`),
  ];
}

function exitsText(map: AtlasMap): string {
  return [...map.warps.map(warpLabel), ...map.edges.map(edgeLabel)].join("; ") || "none";
}

function signsText(map: AtlasMap): string {
  const read = map.signs.flatMap((s) => (s.text ? [`sign at (${s.x}, ${s.y}): "${s.text}"`] : []));
  return read.length === 0 ? "" : ` Signs: ${read.join("; ")}.`;
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
