import { DIRECTION_STEP, type Direction } from "../cells";
import type { Game, MapActors, MapGrid, Obstacle, Warp } from "../game";
import type { ActionEntry, KnowledgeLevel } from "./harness";
import { type BlockOf, type Cell, cellKey, edgeBlock, type EdgeBlock, edgeCells, inside, kindAt, type Place, walkable } from "./path";

// The camera keeps the player at screen cell (7, 5) of the 15 x 10 cells of the screen (field_camera.c).
const SCREEN_LEFT = 7;
const SCREEN_RIGHT = 7;
const SCREEN_UP = 5;
const SCREEN_DOWN = 4;
const RIVAL_GRAPHICS = "BLUE";

/** What a player sees of an exit, before it takes the exit. */
export type ExitPlace = "center" | "mart" | "departmentStore" | "gym" | "house" | "gate" | "cave" | "path" | "harbor" | "building" | "outside";

export type AtlasWarp = { x: number; y: number; behavior: string; place: ExitPlace | null; to: string | null; arrival: Cell | null };

export type TakenWarp = { to: string; arrival: Cell | null };

export type AtlasEdge = { side: Direction; to: string | null; blocked?: EdgeBlock };

export type AtlasSign = { x: number; y: number; facing: Direction | "any"; text: string | null };

/** x and y: where the player last saw the person on the screen, not where the person is now. */
export type AtlasPerson = { localId: number; graphics: string; rival?: string; x: number; y: number; texts: string[] };

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
  outside: boolean;
  signs: AtlasSign[];
  people: AtlasPerson[];
  obstacles: Obstacle[];
  entry: Cell | null;
  /** The seen cells where a step leaves the map, also the other cells of a wide exit. */
  stepExits: Cell[];
};

export function personName({ graphics, rival }: AtlasPerson): string {
  return rival ? `${rival} (your rival)` : graphics.replaceAll("_", " ");
}

export type Atlas = { maps: AtlasMap[]; lastTalk: { map: string; localId: number } | null };

export const UNSEEN = "?";

export const WATER_RULE = "Only a Pokémon that knows SURF can cross water";

const BLOCK_REASONS: Record<EdgeBlock, string> = { water: `is water. ${WATER_RULE}` };

export function blockedText(map: string, side: Direction, block: EdgeBlock): string {
  return `you cannot go there now: the ${side} edge of ${map} ${BLOCK_REASONS[block]}`;
}

export function cellAt(map: AtlasMap, { x, y }: Cell): string {
  return map.cells[y * map.width + x];
}

export function seenIn(map: AtlasMap): (cell: Cell) => boolean {
  return (c) => inside({ mapWidth: map.width, mapHeight: map.height }, c) && cellAt(map, c) !== UNSEEN;
}

export function fitsScreen({ width, height }: Pick<AtlasMap, "width" | "height">): boolean {
  return width <= SCREEN_LEFT + SCREEN_RIGHT + 1 && height <= SCREEN_UP + SCREEN_DOWN + 1;
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
  warpsTaken: Map<string, TakenWarp>;
  edgesTaken: Map<Direction, string>;
  /** The text of each sign read, by cellKey. */
  signTexts: Map<string, string>;
  people: Map<number, AtlasPerson>;
  obstacles: Map<string, Obstacle>;
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
  #battle: "none" | "during" | "after" = "none";

  constructor(private readonly game: Game) {}

  // The grids are shared: they never change after the first visit.
  clone(): AtlasWatch {
    const copy = new AtlasWatch(this.game);
    for (const [name, visit] of this.#visits) {
      copy.#visits.set(name, {
        ...visit,
        seen: visit.seen.slice(),
        warpsTaken: new Map(visit.warpsTaken),
        edgesTaken: new Map(visit.edgesTaken),
        signTexts: new Map(visit.signTexts),
        people: structuredClone(visit.people),
        obstacles: structuredClone(visit.obstacles),
      });
    }
    for (const [key, grid] of this.#grids) copy.#grids.set(key, grid);
    for (const [key, block] of this.#blocks) copy.#blocks.set(key, block);
    copy.#place = this.#place;
    copy.#lastAction = this.#lastAction;
    copy.#lastTalk = this.#lastTalk;
    copy.#battle = this.#battle;
    return copy;
  }

  onFrame(): void {
    const { game } = this;
    if (game.battleUnderway()) this.#battle = "during";
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
    this.seeActors(visit, here);
    if (last && last.map !== here.map) this.crossed(last, here);
  }

  onAction(entry: ActionEntry): void {
    const previous = this.#lastAction;
    this.#lastAction = entry;
    const { action, result } = entry;
    const visit = this.#place && this.#visits.get(this.#place.map);
    const afterBattle = this.#battle === "after";
    this.#battle = this.#battle === "during" || (afterBattle && action.name === "readText") ? "after" : "none";
    if (action.name !== "readText") {
      const talked = action.name === "interact" && result.status === "done";
      this.#talk = visit && this.#place && talked ? this.talkWith(visit, action, this.#place) : null;
      if (this.#talk && this.#place) this.#lastTalk = { map: this.#place.map, localId: this.#talk.person.localId };
    }
    if (!visit || action.name !== "readText" || !("text" in result) || result.text.length === 0) return;
    if (afterBattle) this.#talk ??= this.talkAfterBattle(visit);
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
    if (visit) this.seeActors(visit, place);
  }

  atlas(knowledge: KnowledgeLevel): Atlas {
    const blocked = this.blockOf;
    const lastTalk = this.#lastTalk;
    if (knowledge === "player") return { maps: [...this.#visits.values()].map((visit) => atlasMap(visit, blocked)), lastTalk };
    const maps = this.game.allMapNames.flatMap((names, group) =>
      names.flatMap((name, num) => {
        const grid = this.grid(name, group, num);
        return grid ? [atlasMap(fullVisit(grid, this.#visits.get(name), (w) => this.arrivalOf(w)), blocked)] : [];
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

  // A script can go on after its battle with no interact; its person then stands in front of the player.
  private talkAfterBattle(visit: Visit): Talk | null {
    const player = this.game.player();
    if (!player) return null;
    const [dx, dy] = DIRECTION_STEP[player.facing];
    return this.talkWith(visit, { x: player.x + dx, y: player.y + dy }, player);
  }

  private seeActors(visit: Visit, player: Cell): void {
    const actors = this.game.mapView(visit.grid.name)?.actors;
    for (const p of actors?.people ?? []) if (p.loaded && onScreen(player, p)) this.seen(visit, p);
    for (const o of actors?.obstacles ?? []) if (onScreen(player, o)) visit.obstacles.set(cellKey(o), o);
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
    if (!this.#grids.has(name)) {
      const grid = this.game.gridOf(group, num);
      this.#grids.set(name, grid && this.game.withObstacles(grid, this.game.actorsOf(grid)));
    }
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
    if (left) take(left, from, { to: to.map, arrival: { x: to.x, y: to.y } }, warpOn(left.grid, from) ?? pressWarpFrom(left.grid, from, to.map));
    if (!arrived) return;
    const pair = warpOn(arrived.grid, to);
    if (!pair) take(arrived, to, { to: from.map, arrival: null }, pair);
    else if (pair.to === from.map) take(arrived, to, { to: from.map, arrival: this.arrivalOf(pair) }, pair);
  }

  private arrivalOf(warp: Warp): Cell | null {
    const arrival = this.grid(warp.to, warp.group, warp.num)?.warps[warp.warpId];
    return arrival ? { x: arrival.x, y: arrival.y } : null;
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

function take(visit: Visit, cell: Cell, taken: TakenWarp, warp: Warp | undefined): void {
  if (warp) {
    visit.warpsTaken.set(cellKey(warp), taken);
    return;
  }
  const side = edgesOf(visit.grid).find((c) => c.map === taken.to && edgeCells(visit.grid, c.direction).some((e) => e.x === cell.x && e.y === cell.y))?.direction;
  if (side) visit.edgesTaken.set(side, taken.to);
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

function exitCells(warps: Warp[]): Warp[][] {
  let exits: Warp[][] = [];
  for (const warp of warps) {
    const touches = (cells: Warp[]) => cells.some((w) => w.to === warp.to && Math.abs(w.x - warp.x) + Math.abs(w.y - warp.y) === 1);
    exits = [...exits.filter((cells) => !touches(cells)), [...exits.filter(touches).flat(), warp]];
  }
  return exits;
}

const BUILDING_PLACES: [RegExp, ExitPlace][] = [
  [/PokemonCenter/, "center"],
  [/_Mart$/, "mart"],
  [/DepartmentStore/, "departmentStore"],
  [/_Gym$/, "gym"],
  [/_Harbor$|^SSAnne/, "harbor"],
  [/^Route\d+_(.*Entrance|EastBuilding)|^UndergroundPath_|SafariZone_Entrance/, "gate"],
  [/House|Cottage/, "house"],
];

/** From outside, a player sees what a building is by its look. The cell does not tell it: a gate or a museum can have a cave door. */
export function placeFromOutside({ to, toKind }: Pick<Warp, "to" | "toKind">): ExitPlace {
  if (toKind === "outdoor") return "path";
  if (toKind === "underground") return "cave";
  return BUILDING_PLACES.find(([pattern]) => pattern.test(to))?.[1] ?? "building";
}

export function placeFromInside({ behavior, toKind }: Pick<Warp, "behavior" | "toKind">): ExitPlace | null {
  if (behavior !== "MB_CAVE_DOOR" || toKind === "indoor") return null;
  return toKind === "outdoor" ? "outside" : "cave";
}

export function atlasWarps({ warps, outside }: Pick<MapGrid, "warps" | "outside">, taken: ReadonlyMap<string, TakenWarp>, isSeen: (cell: Cell) => boolean): AtlasWarp[] {
  return exitCells(warps.filter((w) => w.how !== "none")).flatMap((cells) => {
    const shown = cells.find((w) => taken.has(cellKey(w))) ?? cells.find(isSeen);
    if (!shown) return [];
    const { to = null, arrival = null } = taken.get(cellKey(shown)) ?? {};
    return [{ x: shown.x, y: shown.y, behavior: shown.behavior, place: outside ? placeFromOutside(shown) : placeFromInside(shown), to, arrival }];
  });
}

function seenWarps(visit: Visit): AtlasWarp[] {
  return atlasWarps(visit.grid, visit.warpsTaken, seenOn(visit));
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
    cells: Array.from(seen, (s, i) => (s ? kindAt(grid, { x: i % grid.mapWidth, y: Math.floor(i / grid.mapWidth) }) : UNSEEN)).join(""),
    warps: seenWarps(visit),
    edges: seenEdges(visit).map(({ direction: side }) => {
      const block = blocked(grid.name, side);
      return { side, to: edgesTaken.get(side) ?? null, ...(block ? { blocked: block } : {}) };
    }),
    hasEdges: edgesOf(grid).length > 0,
    outside: grid.outside,
    signs: grid.signs.flatMap((s) => (s.kind === "sign" && isSeen(s) ? [{ x: s.x, y: s.y, facing: s.playerFacing, text: signTexts.get(cellKey(s)) ?? null }] : [])),
    people: [...people.values()].map((p) => ({ ...p, texts: [...p.texts] })),
    obstacles: [...obstacles.values()],
    entry,
    stepExits: grid.warps.flatMap((w) => (w.how === "step" && isSeen(w) ? [{ x: w.x, y: w.y }] : [])),
  };
}

/** At the full level, the player knows a map as if it saw all its cells and took all its exits. */
function fullVisit(grid: MapGrid, visit: Visit | undefined, arrivalOf: (warp: Warp) => Cell | null): Visit {
  return {
    grid,
    seen: new Uint8Array(grid.mapWidth * grid.mapHeight).fill(1),
    entry: visit?.entry ?? entryOf(grid),
    warpsTaken: new Map(
      grid.warps.map((w) => [cellKey(w), { to: w.to, arrival: arrivalOf(w) }]),
    ),
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
