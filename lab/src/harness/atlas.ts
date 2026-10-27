import { DIRECTION_STEP, type Direction, type Game, KIND, type MapActors, type MapGrid, type Obstacle, type Warp } from "../game";
import type { ActionEntry, KnowledgeLevel } from "./harness";
import { type BlockOf, type Cell, cellKey, edgeBlock, type EdgeBlock, edgeCells, inside, kindAt, type Place, walkable } from "./path";

// The camera keeps the player at screen cell (7, 5) of the 15 x 10 cells of the screen (field_camera.c).
const SCREEN_LEFT = 7;
const SCREEN_RIGHT = 7;
const SCREEN_UP = 5;
const SCREEN_DOWN = 4;
const RIVAL_GRAPHICS = "BLUE";

export type AtlasWarp = { x: number; y: number; behavior: string; to: string | null };

export type AtlasEdge = { side: Direction; to: string | null; blocked?: EdgeBlock };

export type AtlasSign = { x: number; y: number; facing: Direction | "any"; text: string | null };

/** x and y: where the player last saw the person on the screen, not where the person is now. */
export type AtlasPerson = { localId: number; graphics: string; rival?: string; x: number; y: number; texts: string[] };

export type AtlasObstacle = Omit<Obstacle, "localId">;

export type AtlasMap = {
  name: string;
  width: number;
  height: number;
  /** UNSEEN for a cell that the player did not see. */
  cells: string;
  warps: AtlasWarp[];
  edges: AtlasEdge[];
  /** An edge of the map goes to another map, seen or not: a building has none. */
  hasEdges: boolean;
  signs: AtlasSign[];
  people: AtlasPerson[];
  obstacles: AtlasObstacle[];
  entry: Cell | null;
};

export type Atlas = { maps: AtlasMap[]; lastTalk: { map: string; localId: number } | null };

const UNSEEN = "?";

const BLOCK_REASONS: Record<EdgeBlock, string> = { water: "is water. Only a Pokémon that knows SURF can cross water, and you have none" };

export function blockedText(map: string, side: Direction, block: EdgeBlock): string {
  return `you cannot go there now: the ${side} edge of ${map} ${BLOCK_REASONS[block]}`;
}

export function obstacleName({ graphics }: { graphics: string }): string {
  return graphics.replaceAll("_", " ");
}

export function obstacleRemedy(move: string): string {
  return `Only a Pokémon that knows ${move} can remove it`;
}

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
  people: Map<number, AtlasPerson>;
  obstacles: Map<string, AtlasObstacle>;
};

type Talk = { person: AtlasPerson; text: string | null; index: number | null };

export class AtlasWatch {
  readonly #visits = new Map<string, Visit>();
  readonly #grids = new Map<string, MapGrid | null>();
  readonly #blocks = new Map<string, EdgeBlock | null>();
  #place: Place | null = null;
  #lastAction: ActionEntry | null = null;
  #talk: Talk | null = null;
  #lastTalk: Atlas["lastTalk"] = null;

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

  onAction(entry: ActionEntry): void {
    const previous = this.#lastAction;
    this.#lastAction = entry;
    const { action, result } = entry;
    const visit = this.#place && this.#visits.get(this.#place.map);
    if (action.name !== "readText") {
      const talked = action.name === "interact" && result.status === "done";
      this.#talk = visit && this.#place && talked ? this.talkWith(visit, action, this.#place) : null;
      if (this.#talk && this.#place) this.#lastTalk = { map: this.#place.map, localId: this.#talk.person.localId };
    }
    if (!visit || action.name !== "readText" || !("text" in result) || result.text.length === 0) return;
    if (this.#talk) told(this.#talk, result.text.join(" "));
    const interact = previous?.action.name === "interact" && previous.result.status === "done" ? previous.action : null;
    if (interact && visit.grid.signs.some((s) => s.kind === "sign" && s.x === interact.x && s.y === interact.y)) visit.signTexts.set(cellKey(interact), result.text.join(" "));
  }

  /** The number of different texts of the people that the player heard. */
  get heard(): number {
    let texts = 0;
    for (const visit of this.#visits.values()) for (const person of visit.people.values()) texts += person.texts.length;
    return texts;
  }

  get exits(): number {
    let exits = 0;
    for (const visit of this.#visits.values()) exits += seenWarps(visit).length + seenEdges(visit).length;
    return exits;
  }

  lookAround(): void {
    const place = this.#place;
    const visit = place && this.#visits.get(place.map);
    if (visit) this.seePeople(visit, place);
  }

  atlas(knowledge: KnowledgeLevel): Atlas {
    const blocked = this.blockOf;
    const lastTalk = this.#lastTalk;
    if (knowledge === "player") return { maps: [...this.#visits.values()].map((visit) => atlasMap(visit, blocked)), lastTalk };
    const maps = this.game.allMapNames.flatMap((names, group) =>
      names.flatMap((name, num) => {
        const grid = this.grid(name, group, num);
        return grid ? [atlasMap(fullVisit(grid, this.#visits.get(name)), blocked)] : [];
      }),
    );
    return { maps, lastTalk };
  }

  readonly blockOf: BlockOf = (map, side) => {
    const key = `${map} ${side}`;
    if (!this.#blocks.has(key)) {
      const load = (name: string) => this.game.mapView(name)?.grid ?? null;
      const grid = load(map);
      this.#blocks.set(key, grid && edgeBlock(grid, side, load));
    }
    return this.#blocks.get(key)!;
  };

  // A person behind a counter talks across it: the cell after the counter counts too.
  private talkWith(visit: Visit, { x, y }: Cell, player: Cell): Talk | null {
    const behind = { x: 2 * x - player.x, y: 2 * y - player.y };
    const cells = [{ x, y }, behind];
    const people = this.game.mapView(visit.grid.name)?.actors.people ?? [];
    const found = cells.flatMap((c) => people.filter((p) => p.loaded && p.x === c.x && p.y === c.y))[0];
    if (!found) return null;
    return { person: this.seen(visit, found), text: null, index: null };
  }

  private seePeople(visit: Visit, player: Cell): void {
    const actors = this.game.mapView(visit.grid.name)?.actors;
    for (const p of actors?.people ?? []) if (p.loaded && onScreen(player, p)) this.seen(visit, p);
    for (const { localId, ...obstacle } of actors?.obstacles ?? []) if (onScreen(player, obstacle)) visit.obstacles.set(cellKey(obstacle), obstacle);
  }

  private seen(visit: Visit, { localId, graphics, x, y }: MapActors["people"][number]): AtlasPerson {
    const person = visit.people.get(localId) ?? { localId, graphics, ...(graphics === RIVAL_GRAPHICS ? { rival: this.game.rivalName() } : {}), x, y, texts: [] };
    Object.assign(person, { x, y });
    visit.people.set(localId, person);
    return person;
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
    const visit = { grid, seen: new Uint8Array(grid.mapWidth * grid.mapHeight), entry: null, warpsTaken: new Map(), edgesTaken: new Map(), signTexts: new Map(), people: new Map(), obstacles: new Map() };
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

function seenOn(visit: Visit): (cell: Cell) => boolean {
  return ({ x, y }) => visit.seen[y * visit.grid.mapWidth + x] === 1;
}

function seenWarps(visit: Visit): AtlasWarp[] {
  const isSeen = seenOn(visit);
  return visit.grid.warps.flatMap((w) => {
    const to = visit.warpsTaken.get(cellKey(w)) ?? null;
    return w.how !== "none" && (to || isSeen(w)) ? [{ x: w.x, y: w.y, behavior: w.behavior, to }] : [];
  });
}

function seenEdges(visit: Visit): Edge[] {
  const isSeen = seenOn(visit);
  return edgesOf(visit.grid).filter((c) => visit.edgesTaken.has(c.direction) || edgeCells(visit.grid, c.direction).some(isSeen));
}

function atlasMap(visit: Visit, blocked: BlockOf): AtlasMap {
  const { grid, seen, entry, edgesTaken, signTexts, people, obstacles } = visit;
  const isSeen = seenOn(visit);
  return {
    name: grid.name,
    width: grid.mapWidth,
    height: grid.mapHeight,
    cells: Array.from(seen, (s, i) => {
      const cell = { x: i % grid.mapWidth, y: Math.floor(i / grid.mapWidth) };
      return !s ? UNSEEN : obstacles.has(cellKey(cell)) ? KIND.blocked : kindAt(grid, cell);
    }).join(""),
    warps: seenWarps(visit),
    edges: seenEdges(visit).map(({ direction: side }) => {
      const block = blocked(grid.name, side);
      return { side, to: edgesTaken.get(side) ?? null, ...(block ? { blocked: block } : {}) };
    }),
    hasEdges: edgesOf(grid).length > 0,
    signs: grid.signs.flatMap((s) => (s.kind === "sign" && isSeen(s) ? [{ x: s.x, y: s.y, facing: s.playerFacing, text: signTexts.get(cellKey(s)) ?? null }] : [])),
    people: [...people.values()].map((p) => ({ ...p, texts: [...p.texts] })),
    obstacles: [...obstacles.values()],
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
    obstacles: visit?.obstacles ?? new Map(),
  };
}

function entryOf(grid: MapGrid): Cell | null {
  const nextToWarps = grid.warps.flatMap((w) => Object.values(DIRECTION_STEP).map(([dx, dy]) => ({ x: w.x + dx, y: w.y + dy })));
  const onEdges = edgesOf(grid).flatMap((c) => edgeCells(grid, c.direction));
  return [...nextToWarps, ...onEdges].find((cell) => walkable(grid, cell)) ?? null;
}
