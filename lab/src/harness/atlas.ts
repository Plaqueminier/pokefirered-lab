import { DIRECTION_STEP, type Direction, type Game, type MapGrid, type Warp } from "../game";
import type { ActionEntry, KnowledgeLevel } from "./harness";
import { type Cell, cellKey, edgeCells, inside, kindAt, type Place, walkable } from "./path";

// The camera keeps the player at screen cell (7, 5) of the 15 x 10 cells of the screen (field_camera.c).
const SCREEN_LEFT = 7;
const SCREEN_RIGHT = 7;
const SCREEN_UP = 5;
const SCREEN_DOWN = 4;

export type AtlasWarp = { x: number; y: number; behavior: string; to: string | null };

export type AtlasEdge = { side: Direction; to: string | null };

export type AtlasSign = { x: number; y: number; facing: Direction | "any"; text: string | null };

/** A person that talked to the player: its texts, all different, in their order, and the last cell where the player saw it. */
export type AtlasPerson = { localId: number; graphics: string; x: number; y: number; texts: string[] };

export type AtlasMap = {
  name: string;
  width: number;
  height: number;
  /** UNSEEN for a cell that the player did not see. */
  cells: string;
  warps: AtlasWarp[];
  edges: AtlasEdge[];
  signs: AtlasSign[];
  people: AtlasPerson[];
  entry: Cell | null;
};

export type Atlas = { maps: AtlasMap[] };

const UNSEEN = "?";

export function cellAt(map: AtlasMap, { x, y }: Cell): string {
  return map.cells[y * map.width + x];
}

export function seenIn(map: AtlasMap): (cell: Cell) => boolean {
  return (c) => inside({ mapWidth: map.width, mapHeight: map.height }, c) && cellAt(map, c) !== UNSEEN;
}

export function mapNamed(atlas: Atlas, name: string): AtlasMap {
  const map = atlas.maps.find((m) => m.name === name);
  if (!map) throw new Error(`the Atlas has no map ${name}`);
  return map;
}

/** For each visited map, one character for each cell, row by row: "1" seen, "0" not seen. */
export type Sight = Record<string, string>;

type Visit = {
  grid: MapGrid;
  seen: Uint8Array;
  entry: Cell | null;
  /** The destination of each warp taken, by cellKey. */
  warpsTaken: Map<string, string>;
  edgesTaken: Map<Direction, string>;
  /** The text of each sign read, by cellKey. */
  signTexts: Map<string, string>;
  /** The people that talked to the player, by localId: a person keeps its texts when it moves. */
  people: Map<number, AtlasPerson>;
};

/** The texts of one talk: all the readTexts after a done interact with a person. `index`: the place of the text in the texts of the person, null when the person said it before. */
type Talk = { person: AtlasPerson; text: string | null; index: number | null };

export class AtlasWatch {
  readonly #visits = new Map<string, Visit>();
  readonly #grids = new Map<string, MapGrid | null>();
  #place: Place | null = null;
  #lastAction: ActionEntry | null = null;
  #talk: Talk | null = null;

  constructor(private readonly game: Game) {}

  onFrame(): void {
    const { game } = this;
    if (game.mode() !== "overworld") return;
    const player = game.player();
    if (!player) return;
    const map = game.map();
    const last = this.#place;
    if (last?.map === map.name && last.x === player.x && last.y === player.y) return;
    const visit = this.visit(map.name, map.group, map.num);
    if (!visit) return;
    const here = { map: map.name, x: player.x, y: player.y };
    this.#place = here;
    this.see(visit, here);
    this.seePeople(visit, here);
    if (last && last.map !== here.map) this.crossed(last, here);
  }

  /** A sign has the texts of a readText just after a done interact with it. A person has the texts of all the readTexts after a done interact with it. */
  onAction(entry: ActionEntry): void {
    const previous = this.#lastAction;
    this.#lastAction = entry;
    const { action, result } = entry;
    const visit = this.#place && this.#visits.get(this.#place.map);
    if (action.name !== "readText") this.#talk = visit && this.#place && action.name === "interact" && result.status === "done" ? this.talkWith(visit, action, this.#place) : null;
    if (!visit || action.name !== "readText" || !("text" in result) || result.text.length === 0) return;
    if (this.#talk) told(this.#talk, result.text.join(" "));
    const interact = previous?.action.name === "interact" && previous.result.status === "done" ? previous.action : null;
    if (interact && visit.grid.signs.some((s) => s.kind === "sign" && s.x === interact.x && s.y === interact.y)) visit.signTexts.set(cellKey(interact), result.text.join(" "));
  }

  atlas(knowledge: KnowledgeLevel): Atlas {
    if (knowledge === "player") return { maps: [...this.#visits.values()].map(atlasMap) };
    const maps = this.game.allMapNames.flatMap((names, group) =>
      names.flatMap((name, num) => {
        const grid = this.grid(name, group, num);
        return grid ? [atlasMap(fullVisit(grid, this.#visits.get(name)))] : [];
      }),
    );
    return { maps };
  }

  // A person behind a counter talks when the player faces the counter, so the cell after it counts too.
  private talkWith(visit: Visit, { x, y }: Cell, player: Cell): Talk | null {
    const cells = [{ x, y }, { x: 2 * x - player.x, y: 2 * y - player.y }];
    const people = this.game.mapView(visit.grid.name)?.actors.people ?? [];
    const found = cells.flatMap((c) => people.filter((p) => p.loaded && p.x === c.x && p.y === c.y))[0];
    if (!found) return null;
    const person = visit.people.get(found.localId) ?? { localId: found.localId, graphics: found.graphics, x: found.x, y: found.y, texts: [] };
    Object.assign(person, { x: found.x, y: found.y });
    visit.people.set(found.localId, person);
    return { person, text: null, index: null };
  }

  private seePeople(visit: Visit, { x, y }: Cell): void {
    if (visit.people.size === 0) return;
    for (const p of this.game.mapView(visit.grid.name)?.actors.people ?? []) {
      const person = visit.people.get(p.localId);
      if (person && p.loaded && onScreen({ x, y }, p)) Object.assign(person, { x: p.x, y: p.y });
    }
  }

  sight(): Sight {
    return Object.fromEntries([...this.#visits].map(([name, visit]) => [name, visit.seen.join("")]));
  }

  private grid(name: string, group: number, num: number): MapGrid | null {
    if (!this.#grids.has(name)) this.#grids.set(name, this.game.gridOf(group, num));
    return this.#grids.get(name)!;
  }

  private visit(name: string, group: number, num: number): Visit | null {
    const known = this.#visits.get(name);
    if (known) return known;
    const grid = this.grid(name, group, num);
    if (!grid) return null;
    const visit = { grid, seen: new Uint8Array(grid.mapWidth * grid.mapHeight), entry: null, warpsTaken: new Map(), edgesTaken: new Map(), signTexts: new Map(), people: new Map() };
    this.#visits.set(name, visit);
    return visit;
  }

  private see(visit: Visit, { x, y }: Cell): void {
    const { grid, seen } = visit;
    for (let cy = Math.max(0, y - SCREEN_UP); cy <= Math.min(grid.mapHeight - 1, y + SCREEN_DOWN); cy++) {
      for (let cx = Math.max(0, x - SCREEN_LEFT); cx <= Math.min(grid.mapWidth - 1, x + SCREEN_RIGHT); cx++) seen[cy * grid.mapWidth + cx] = 1;
    }
    if (!visit.entry && walkable(grid, { x, y })) visit.entry = { x, y };
  }

  // The warps of the game are in pairs: issue #11 counts the arrival exit as taken too.
  private crossed(from: Place, to: Place): void {
    const left = this.#visits.get(from.map);
    const arrived = this.#visits.get(to.map);
    if (left) take(left, from, to.map, warpOn(left.grid, from) ?? pressWarpFrom(left.grid, from, to.map));
    if (arrived) take(arrived, to, from.map, warpOn(arrived.grid, to));
  }
}

function onScreen(player: Cell, { x, y }: Cell): boolean {
  return x >= player.x - SCREEN_LEFT && x <= player.x + SCREEN_RIGHT && y >= player.y - SCREEN_UP && y <= player.y + SCREEN_DOWN;
}

/** A talk can have many readTexts: its text grows, and it stays once in the texts of the person. */
function told(talk: Talk, part: string): void {
  const { texts } = talk.person;
  if (talk.index !== null) texts.splice(talk.index, 1);
  talk.text = talk.text ? `${talk.text} ${part}` : part;
  talk.index = texts.includes(talk.text) ? null : texts.push(talk.text) - 1;
}

function take(visit: Visit, cell: Cell, other: string, warp: Warp | undefined): void {
  if (warp) {
    visit.warpsTaken.set(cellKey(warp), other);
    return;
  }
  const side = edgesOf(visit.grid).find((c) => c.map === other && edgeCells(visit.grid, c.direction).some((e) => e.x === cell.x && e.y === cell.y))?.direction;
  if (side) visit.edgesTaken.set(side, other);
}

function warpOn(grid: MapGrid, { x, y }: Cell): Warp | undefined {
  return grid.warps.find((w) => w.how !== "none" && w.x === x && w.y === y);
}

function pressWarpFrom(grid: MapGrid, { x, y }: Cell, to: string): Warp | undefined {
  return grid.warps.find((w) => w.how === "press" && w.from.x === x && w.from.y === y && w.to === to);
}

type Edge = MapGrid["connections"][number] & { direction: Direction };

function edgesOf(grid: MapGrid): Edge[] {
  return grid.connections.filter((c): c is Edge => c.direction in DIRECTION_STEP);
}

function atlasMap({ grid, seen, entry, warpsTaken, edgesTaken, signTexts, people }: Visit): AtlasMap {
  const isSeen = ({ x, y }: Cell) => seen[y * grid.mapWidth + x] === 1;
  return {
    name: grid.name,
    width: grid.mapWidth,
    height: grid.mapHeight,
    cells: Array.from(seen, (s, i) => (s ? kindAt(grid, { x: i % grid.mapWidth, y: Math.floor(i / grid.mapWidth) }) : UNSEEN)).join(""),
    warps: grid.warps.flatMap((w) => {
      const to = warpsTaken.get(cellKey(w)) ?? null;
      return w.how !== "none" && (to || isSeen(w)) ? [{ x: w.x, y: w.y, behavior: w.behavior, to }] : [];
    }),
    edges: edgesOf(grid).flatMap((c) => {
      const to = edgesTaken.get(c.direction) ?? null;
      return to || edgeCells(grid, c.direction).some(isSeen) ? [{ side: c.direction, to }] : [];
    }),
    signs: grid.signs.flatMap((s) => (s.kind === "sign" && isSeen(s) ? [{ x: s.x, y: s.y, facing: s.playerFacing, text: signTexts.get(cellKey(s)) ?? null }] : [])),
    people: [...people.values()].map((p) => ({ ...p, texts: [...p.texts] })),
    entry,
  };
}

/** At the full level, the player knows a map as if it saw all its cells and took all its exits. */
function fullVisit(grid: MapGrid, visit: Visit | undefined): Visit {
  return {
    grid,
    seen: new Uint8Array(grid.mapWidth * grid.mapHeight).fill(1),
    entry: visit?.entry ?? entryOf(grid),
    warpsTaken: new Map(grid.warps.map((w) => [cellKey(w), w.to])),
    edgesTaken: new Map(edgesOf(grid).map((c) => [c.direction, c.map])),
    signTexts: visit?.signTexts ?? new Map(),
    people: visit?.people ?? new Map(),
  };
}

function entryOf(grid: MapGrid): Cell | null {
  const nextToWarps = grid.warps.flatMap((w) => Object.values(DIRECTION_STEP).map(([dx, dy]) => ({ x: w.x + dx, y: w.y + dy })));
  const onEdges = edgesOf(grid).flatMap((c) => edgeCells(grid, c.direction));
  return [...nextToWarps, ...onEdges].find((cell) => walkable(grid, cell)) ?? null;
}
