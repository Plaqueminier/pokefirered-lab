import { DIRECTION_STEP, type Direction, ELEVATION_SHIFT, KIND, withSurf } from "../cells";
import { type Game, type MapActors, type MapGrid, type MapScriptCells, mapScriptCells, type Obstacle, type Warp, walkRemoves } from "../game";
import type { ActionEntry, KnowledgeLevel } from "./harness";
import { hasSpinTiles, numberParts, spinDirection } from "./slides";
import { type BlockOf, type Cell, cellKey, edgeBlock, type EdgeBlock, edgeCells, elevationAt, hasElevationEdges, inside, joinCells, kindAt, type MapCells, type Place, walkable, walkGroups } from "./path";

type Area = { left: number; right: number; up: number; down: number };

// The camera keeps the player at screen cell (7, 5) of the 15 x 10 cells of the screen (field_camera.c).
const SCREEN: Area = { left: 7, right: 7, up: 5, down: 4 };
// The game shows a circle of 24 px in the dark (sFlashLevelToRadius): the centres of these 3 x 3 cells are in it.
const DARK_AREA: Area = { left: 1, right: 1, up: 1, down: 1 };
const RIVAL_GRAPHICS = "BLUE";

/** What a player sees of an exit, before it takes the exit. */
export type ExitPlace = "center" | "mart" | "departmentStore" | "gym" | "house" | "gate" | "cave" | "path" | "harbor" | "building" | "outside";

export type AtlasWarp = { x: number; y: number; behavior: string; place: ExitPlace | null; to: string | null; arrival: Cell | null; elevator?: true };

export type TakenWarp = { to: string; arrival: Cell | null };

export type AtlasEdge = { side: Direction; to: string | null; blocked?: EdgeBlock };

export type AtlasSlide = { from: Cell; to: Cell };

/** `pc`: a PC metatile, not a bg event. */
export type AtlasSign = { x: number; y: number; facing: Direction | "any"; text: string | null; pc?: true };

/** x and y: where the player last saw the person on the screen, not where the person is now. */
// The members of the Game that an AtlasWatch reads. A test fakes these only (see fakes.ts).
export type AtlasGame = Pick<
  Game,
  "actors" | "allMapNames" | "battleUnderway" | "flashActive" | "flashBadgeMissing" | "flashUser" | "flyLanding" | "grid" | "gridOf" | "map" | "mapScriptKey" | "mapView" | "mode" | "obstaclesOf" | "player" | "rivalName" | "usableFieldMoves"
>;

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
  /** The map is dark for the model. `missingBadge`: a Pokémon knows FLASH, and the player does not have this badge. */
  dark?: { missingBadge: number | null };
  slides: AtlasSlide[];
  parts: number[];
  /** Only on a map with a step between two cells of land that the elevation rule refuses (hasElevationEdges): the elevation of each cell as a hex digit, 0 for an unseen cell. */
  elevations?: string;
};

export function personName({ graphics, rival }: AtlasPerson): string {
  return rival ? `${rival} (your rival)` : graphics.replaceAll("_", " ");
}

export type Atlas = { maps: AtlasMap[]; lastTalk: { map: string; localId: number } | null };

export const UNSEEN = "?";

export function blockedText(map: string, side: Direction, remedy: string): string {
  return `you cannot go there now: the ${side} edge of ${map} is water. ${remedy}`;
}

export function cellAt(map: AtlasMap, { x, y }: Cell): string {
  return map.cells[y * map.width + x];
}

export function seenIn(map: AtlasMap): (cell: Cell) => boolean {
  return (c) => inside({ mapWidth: map.width, mapHeight: map.height }, c) && cellAt(map, c) !== UNSEEN;
}

/** Blocks with only the elevation bits, from the hex digits of `AtlasMap.elevations`. */
export function elevationBlocks(elevations: string): number[] {
  return Array.from(elevations, (digit) => Number.parseInt(digit, 16) << ELEVATION_SHIFT);
}

export function atlasCells(map: Pick<AtlasMap, "cells" | "width" | "height" | "elevations">): MapCells {
  const blocks = map.elevations && elevationBlocks(map.elevations);
  return { kinds: map.cells, x0: 0, y0: 0, width: map.width, mapWidth: map.width, mapHeight: map.height, ...(blocks ? { blocks } : {}) };
}

/**
 * On a map with elevations: a test of a seen cell at another elevation than `here`, with no stairs that the player saw
 * between the two. A walk reaches the cell through its joinCells.
 */
export function elevationSplit(map: AtlasMap, here: Cell): ((cell: Cell) => boolean) | null {
  if (!map.elevations) return null;
  const seen = seenIn(map);
  const view = atlasCells(map);
  const { blocks: _, ...flat } = view;
  const groupsOf = (cells: MapCells) => walkGroups(cells, (c) => seen(c) && walkable(cells, c)).groups;
  const joins = (groups: Map<string, number>, cell: Cell) => {
    const own = groups.get(cellKey(here));
    return own !== undefined && joinCells(view, cell).some((c) => groups.get(cellKey(c)) === own);
  };
  const [apart, together] = [groupsOf(view), groupsOf(flat)];
  return (cell) => seen(cell) && !joins(apart, cell) && joins(together, cell);
}

export function fitsScreen({ width, height }: Pick<AtlasMap, "width" | "height">): boolean {
  return width <= SCREEN.left + SCREEN.right + 1 && height <= SCREEN.up + SCREEN.down + 1;
}

export function isInnerMap(map: Pick<AtlasMap, "hasEdges" | "width" | "height">): boolean {
  return !map.hasEdges && !fitsScreen(map);
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
  /** The arrival cell on each floor of the Elevator exit, by floor. One for the map: all its dynamic warps share the one dynamic warp of the game. */
  floors: Map<string, Cell | null>;
  edgesTaken: Map<Direction, string>;
  /** The text of each sign read, by cellKey. */
  signTexts: Map<string, string>;
  slidesTaken: Map<string, AtlasSlide>;
  parts: number[];
  people: Map<number, AtlasPerson>;
  obstacles: Set<number>;
  lastStepCells: Map<string, MapScriptCells>;
  /** The map has a step between two cells of land that the elevation rule refuses (hasElevationEdges). A map script changes the metatile of a cell and keeps its elevation, so the ROM grid tells it. */
  hasElevations: boolean;
};

type FieldUses = { on: (grid: MapGrid) => { cells: MapCells; obstacles: Obstacle[] }; closed: (obstacle: Obstacle) => boolean; surf: boolean };

type CaveGrid = Pick<MapGrid, "cave">;

type Talk = { person: AtlasPerson; text: string | null; index: number | null };

// `talk.person` is an object of `visits`: a copy must keep them as one object, as `structuredClone` does.
export type AtlasSnapshot = {
  visits: Map<string, Visit>;
  grids: Map<string, MapGrid | null>;
  blocks: Map<string, EdgeBlock | null>;
  place: Place | null;
  lastAction: ActionEntry | null;
  talk: Talk | null;
  lastTalk: Atlas["lastTalk"];
  battle: "none" | "during" | "after";
  inDarkness: boolean;
  darkCells: number;
  flew: boolean;
};

export class AtlasWatch {
  #visits = new Map<string, Visit>();
  #grids = new Map<string, MapGrid | null>();
  readonly #elevations = new Map<string, boolean>();
  #blocks = new Map<string, EdgeBlock | null>();
  #place: Place | null = null;
  #lastAction: ActionEntry | null = null;
  #talk: Talk | null = null;
  #lastTalk: Atlas["lastTalk"] = null;
  #battle: "none" | "during" | "after" = "none";
  #inDarkness = false;
  #darkCells = 0;
  #flew = false;

  constructor(
    private readonly game: AtlasGame,
    private readonly knowledge: KnowledgeLevel,
  ) {}

  snapshot(): AtlasSnapshot {
    return {
      visits: this.#visits,
      grids: this.#grids,
      blocks: this.#blocks,
      place: this.#place,
      lastAction: this.#lastAction,
      talk: this.#talk,
      lastTalk: this.#lastTalk,
      battle: this.#battle,
      inDarkness: this.#inDarkness,
      darkCells: this.#darkCells,
      flew: this.#flew,
    };
  }

  restore(snapshot: AtlasSnapshot): void {
    this.#visits = snapshot.visits;
    this.#grids = snapshot.grids;
    this.#blocks = snapshot.blocks;
    this.#place = snapshot.place;
    this.#lastAction = snapshot.lastAction;
    this.#talk = snapshot.talk;
    this.#lastTalk = snapshot.lastTalk;
    this.#battle = snapshot.battle;
    this.#inDarkness = snapshot.inDarkness;
    this.#darkCells = snapshot.darkCells;
    this.#flew = snapshot.flew;
  }

  // The grids are shared: they never change after the first visit.
  clone(): AtlasWatch {
    const copy = new AtlasWatch(this.game, this.knowledge);
    for (const [name, visit] of this.#visits) {
      copy.#visits.set(name, {
        ...visit,
        seen: visit.seen.slice(),
        warpsTaken: new Map(visit.warpsTaken),
        floors: new Map(visit.floors),
        edgesTaken: new Map(visit.edgesTaken),
        signTexts: new Map(visit.signTexts),
        slidesTaken: new Map(visit.slidesTaken),
        parts: [...visit.parts],
        people: structuredClone(visit.people),
        obstacles: structuredClone(visit.obstacles),
        lastStepCells: new Map(visit.lastStepCells),
      });
    }
    for (const [key, grid] of this.#grids) copy.#grids.set(key, grid);
    for (const [key, has] of this.#elevations) copy.#elevations.set(key, has);
    for (const [key, block] of this.#blocks) copy.#blocks.set(key, block);
    copy.#place = this.#place;
    copy.#lastAction = this.#lastAction;
    copy.#lastTalk = this.#lastTalk;
    copy.#battle = this.#battle;
    copy.#inDarkness = this.#inDarkness;
    copy.#flew = this.#flew;
    copy.#darkCells = this.#darkCells;
    return copy;
  }

  onFrame(): void {
    const { game } = this;
    if (game.battleUnderway()) this.#battle = "during";
    if (game.flyLanding()) this.#flew = true;
    if (game.mode() !== "overworld") return;
    const player = game.player();
    if (!player) return;
    const map = game.map();
    const visit = this.visit(map.name, map.group, map.num);
    if (!visit) return;
    const last = this.#place;
    const inDarkness = this.isDark(visit.grid);
    if (last?.map === map.name && last.x === player.x && last.y === player.y && inDarkness === this.#inDarkness) return;
    const here = { map: map.name, x: player.x, y: player.y };
    this.#place = here;
    const live = game.grid();
    if (live) visit.lastStepCells.set(this.game.mapScriptKey(map.name), mapScriptCells(live));
    this.#inDarkness = inDarkness;
    this.see(visit, here);
    this.seeActors(visit, here);
    if (last && last.map !== here.map && !this.#flew) this.crossed(last, here);
    this.#flew = false;
  }

  onAction(entry: ActionEntry): void {
    const previous = this.#lastAction;
    this.#lastAction = entry;
    const { action, result } = entry;
    const visit = this.#place && this.#visits.get(this.#place.map);
    if (visit) recordSlide(visit, entry);
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

  get darkCells(): number {
    return this.#darkCells;
  }

  get darkHere(): boolean {
    return this.#inDarkness;
  }

  lastStepCells(map: string): MapScriptCells | null {
    return this.#visits.get(map)?.lastStepCells.get(this.game.mapScriptKey(map)) ?? null;
  }

  peopleSeen(map: string): number {
    return this.#visits.get(map)?.people.size ?? 0;
  }

  lookAround(): void {
    const place = this.#place;
    const visit = place && this.#visits.get(place.map);
    if (visit) this.seeActors(visit, place);
  }

  sawObstacle(map: string, localId: number): boolean {
    return this.#visits.get(map)?.obstacles.has(localId) ?? false;
  }

  atlas(): Atlas {
    const lastTalk = this.#lastTalk;
    const uses = this.fieldUsesNow();
    const blocked: BlockOf = (map, side) => this.blockWith(map, side, uses.surf);
    if (this.knowledge === "player") return { maps: [...this.#visits.values()].map((visit) => atlasMap(visit, blocked, uses, this.darkOf(visit.grid))), lastTalk };
    const grids = this.game.allMapNames.flatMap((names, group) => names.flatMap((name, num) => this.grid(name, group, num) ?? []));
    const floorsOf = (elevator: string) => {
      const floors = new Map<string, Cell>();
      for (const g of grids) for (const w of g.warps) if (w.to === elevator && w.how !== "none" && !floors.has(g.name)) floors.set(g.name, { x: w.x, y: w.y });
      return floors;
    };
    const maps = grids.map((grid) => {
      const floors = grid.warps.some((w) => w.dynamic) ? floorsOf(grid.name) : new Map<string, Cell>();
      return atlasMap(fullVisit(grid, this.#visits.get(grid.name), (w) => this.arrivalOf(w), floors, this.hasElevations(grid)), blocked, uses, undefined);
    });
    return { maps, lastTalk };
  }

  darkSight(grid: Pick<MapGrid, "cave" | "name">): ((cell: Cell) => boolean) | null {
    if (!this.darkForModel(grid)) return null;
    const visit = this.#visits.get(grid.name);
    return visit ? seenOn(visit) : () => false;
  }

  private isDark({ cave }: CaveGrid): boolean {
    return cave && this.knowledge === "player" && !this.game.flashActive();
  }

  darkForModel(grid: CaveGrid): boolean {
    return this.isDark(grid) && this.game.flashUser() === null;
  }

  private darkOf(grid: CaveGrid): AtlasMap["dark"] {
    return this.darkForModel(grid) ? { missingBadge: this.game.flashBadgeMissing() } : undefined;
  }

  private areaOf(grid: CaveGrid): Area {
    return this.isDark(grid) ? DARK_AREA : SCREEN;
  }

  // A map load returns each obstacle to its cell of the ROM. The ROM has the doors of Silph Co. open, and their map scripts
  // close them at each load: so another map has the cells of the last step of the player on it.
  private fieldUsesNow(): FieldUses {
    const usable = this.game.usableFieldMoves();
    const grid = this.game.grid();
    const actors = grid && this.game.actors(grid);
    const live = grid && actors ? { cells: grid, obstacles: actors.obstacles } : null;
    return {
      on: (map) => (live && map.name === live.cells.name ? live : { cells: { ...map, ...this.lastStepCells(map.name) }, obstacles: this.game.obstaclesOf(map) }),
      closed: (o) => !walkRemoves(o, usable),
      surf: usable.has("SURF"),
    };
  }

  readonly blockOf: BlockOf = (map, side) => this.blockWith(map, side, this.game.usableFieldMoves().has("SURF"));

  private blockWith(map: string, side: Direction, surf: boolean): EdgeBlock | null {
    const key = `${map} ${side} ${surf}`;
    if (!this.#blocks.has(key)) {
      const load = (name: string) => {
        const grid = this.game.mapView(name)?.grid;
        return grid ? { ...grid, kinds: withSurf(grid.kinds, surf) } : null;
      };
      const grid = load(map);
      this.#blocks.set(key, grid && edgeBlock(grid, side, load));
    }
    return this.#blocks.get(key)!;
  }

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
    const area = this.areaOf(visit.grid);
    for (const p of actors?.people ?? []) if (p.loaded && inArea(area, player, p)) this.seen(visit, p);
    for (const o of actors?.obstacles ?? []) if (inArea(area, player, o) && inside(visit.grid, o)) visit.obstacles.add(o.localId);
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

  private hasElevations(grid: MapGrid): boolean {
    if (!this.#elevations.has(grid.name)) this.#elevations.set(grid.name, hasElevationEdges(grid));
    return this.#elevations.get(grid.name) ?? false;
  }

  private visit(name: string, group: number, num: number): Visit | null {
    const known = this.#visits.get(name);
    if (known) return known;
    const grid = this.grid(name, group, num);
    if (!grid) return null;
    const visit = { grid, seen: new Uint8Array(grid.mapWidth * grid.mapHeight), entry: null, warpsTaken: new Map(), floors: new Map(), edgesTaken: new Map(), signTexts: new Map(), slidesTaken: new Map(), parts: [], people: new Map(), obstacles: new Set<number>(), lastStepCells: new Map(), hasElevations: this.hasElevations(grid) };
    this.#visits.set(name, visit);
    return visit;
  }

  private see(visit: Visit, { x, y }: Cell): void {
    const { grid, seen } = visit;
    const { left, right, up, down } = this.areaOf(grid);
    const counts = this.darkForModel(grid);
    for (let cy = Math.max(0, y - up); cy <= Math.min(grid.mapHeight - 1, y + down); cy++) {
      for (let cx = Math.max(0, x - left); cx <= Math.min(grid.mapWidth - 1, x + right); cx++) {
        const cell = cy * grid.mapWidth + cx;
        if (counts && !seen[cell]) this.#darkCells++;
        seen[cell] = 1;
      }
    }
    if (!visit.entry && walkable(grid, { x, y })) visit.entry = { x, y };
    visit.parts = partsOf(visit);
  }

  // The warps of the game are in pairs: issue #11 counts the arrival exit as taken too.
  private crossed(from: Place, to: Place): void {
    const left = this.#visits.get(from.map);
    const arrived = this.#visits.get(to.map);
    const exit = left && (warpOn(left.grid, from) ?? pressWarpFrom(left.grid, from, to.map));
    if (left) take(left, from, { to: to.map, arrival: { x: to.x, y: to.y } }, exit);
    if (!arrived) return;
    const pair = warpOn(arrived.grid, to);
    if (!pair) take(arrived, to, { to: from.map, arrival: null }, pair);
    else if (pair.dynamic) take(arrived, to, { to: from.map, arrival: exit ? { x: exit.x, y: exit.y } : null }, pair);
    else if (pair.to === from.map) take(arrived, to, { to: from.map, arrival: this.arrivalOf(pair) }, pair);
  }

  private arrivalOf(warp: Warp): Cell | null {
    const arrival = this.grid(warp.to, warp.group, warp.num)?.warps[warp.warpId];
    return arrival ? { x: arrival.x, y: arrival.y } : null;
  }
}

function inArea({ left, right, up, down }: Area, player: Cell, { x, y }: Cell): boolean {
  return x >= player.x - left && x <= player.x + right && y >= player.y - up && y <= player.y + down;
}

function partsOf({ grid, seen, parts }: Visit): number[] {
  if (!hasSpinTiles(grid.kinds)) return [];
  const isSeen = (c: Cell) => seen[c.y * grid.mapWidth + c.x] === 1;
  const seenSpin = Array.from(seen).some((s, i) => s === 1 && spinDirection(grid, { x: i % grid.mapWidth, y: Math.floor(i / grid.mapWidth) }) !== null);
  return seenSpin ? numberParts(grid, (c) => isSeen(c) && walkable(grid, c), parts) : [];
}

function recordSlide(visit: Visit, { action, result }: ActionEntry): void {
  if (action.name === "goTo" && result.status === "done" && result.slidTo) visit.slidesTaken.set(cellKey(action), { from: { x: action.x, y: action.y }, to: result.slidTo });
}

function told(talk: Talk, part: string): void {
  const { texts } = talk.person;
  if (talk.index !== null) texts.splice(talk.index, 1);
  talk.text = talk.text ? `${talk.text} ${part}` : part;
  talk.index = texts.includes(talk.text) ? null : texts.push(talk.text) - 1;
}

function take(visit: Visit, cell: Cell, taken: TakenWarp, warp: Warp | undefined): void {
  if (warp?.dynamic) {
    visit.floors.set(taken.to, taken.arrival);
    return;
  }
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

export function atlasWarps({ warps, outside }: Pick<MapGrid, "warps" | "outside">, taken: ReadonlyMap<string, TakenWarp>, isSeen: (cell: Cell) => boolean, floors: ReadonlyMap<string, Cell | null>): AtlasWarp[] {
  return exitCells(warps.filter((w) => w.how !== "none")).flatMap((cells) => {
    const shown = cells.find((w) => taken.has(cellKey(w))) ?? cells.find(isSeen);
    if (!shown) return [];
    const exit = { x: shown.x, y: shown.y, behavior: shown.behavior, place: outside ? placeFromOutside(shown) : placeFromInside(shown) };
    if (shown.dynamic) {
      const known = floors.size === 0 ? [{ to: null, arrival: null }] : [...floors].map(([to, arrival]) => ({ to, arrival }));
      return known.map((floor) => ({ ...exit, ...floor, elevator: true as const }));
    }
    const { to = null, arrival = null } = taken.get(cellKey(shown)) ?? {};
    return [{ ...exit, to, arrival }];
  });
}

function seenWarps(visit: Visit): AtlasWarp[] {
  return atlasWarps(visit.grid, visit.warpsTaken, seenOn(visit), visit.floors);
}

function seenEdges(visit: Visit): Edge[] {
  const isSeen = seenOn(visit);
  return edgesOf(visit.grid).filter((c) => visit.edgesTaken.has(c.direction) || edgeCells(visit.grid, c.direction).some(isSeen));
}

function atlasMap(visit: Visit, blocked: BlockOf, uses: FieldUses, dark: AtlasMap["dark"]): AtlasMap {
  const { grid, entry, edgesTaken, signTexts, slidesTaken, people, obstacles } = visit;
  const isSeen = seenOn(visit);
  const now = uses.on(grid);
  const closing = now.obstacles.filter(uses.closed);
  const walls = new Set(closing.map(cellKey));
  const kinds = { ...now.cells, kinds: withSurf(now.cells.kinds, uses.surf) };
  const kindOf = (cell: Cell) => (walls.has(cellKey(cell)) ? KIND.blocked : kindAt(kinds, cell));
  return {
    name: grid.name,
    width: grid.mapWidth,
    height: grid.mapHeight,
    cells: seenString(visit, kindOf, UNSEEN),
    warps: seenWarps(visit),
    edges: seenEdges(visit).map(({ direction: side }) => {
      const block = blocked(grid.name, side);
      return { side, to: edgesTaken.get(side) ?? null, ...(block ? { blocked: block } : {}) };
    }),
    hasEdges: edgesOf(grid).length > 0,
    outside: grid.outside,
    signs: grid.signs.flatMap((s) => (s.kind === "sign" && isSeen(s) ? [{ x: s.x, y: s.y, facing: s.playerFacing, text: signTexts.get(cellKey(s)) ?? null, ...(s.pc ? { pc: s.pc } : {}) }] : [])),
    people: [...people.values()].map((p) => ({ ...p, texts: [...p.texts] })),
    obstacles: closing.filter((o) => obstacles.has(o.localId)),
    entry,
    stepExits: grid.warps.flatMap((w) => (w.how === "step" && isSeen(w) ? [{ x: w.x, y: w.y }] : [])),
    slides: [...slidesTaken.values()],
    parts: [...visit.parts],
    ...(visit.hasElevations ? { elevations: seenString(visit, (cell) => elevationAt(now.cells, cell).toString(16), "0") } : {}),
    ...(dark ? { dark } : {}),
  };
}

function seenString({ seen, grid }: Pick<Visit, "seen" | "grid">, signOf: (cell: Cell) => string, unseen: string): string {
  return Array.from(seen, (s, i) => (s ? signOf({ x: i % grid.mapWidth, y: Math.floor(i / grid.mapWidth) }) : unseen)).join("");
}

/** At the full level, the player knows a map as if it saw all its cells and took all its exits. */
function fullVisit(grid: MapGrid, visit: Visit | undefined, arrivalOf: (warp: Warp) => Cell | null, floors: Map<string, Cell>, hasElevations: boolean): Visit {
  const full: Visit = {
    grid,
    seen: new Uint8Array(grid.mapWidth * grid.mapHeight).fill(1),
    entry: visit?.entry ?? entryOf(grid),
    warpsTaken: new Map(grid.warps.flatMap((w) => (w.dynamic ? [] : [[cellKey(w), { to: w.to, arrival: arrivalOf(w) }]]))),
    floors,
    edgesTaken: new Map(edgesOf(grid).map((c) => [c.direction, c.map])),
    signTexts: visit?.signTexts ?? new Map(),
    slidesTaken: visit?.slidesTaken ?? new Map(),
    parts: visit?.parts ?? [],
    people: visit?.people ?? new Map(),
    obstacles: visit?.obstacles ?? new Set(),
    lastStepCells: visit?.lastStepCells ?? new Map(),
    hasElevations,
  };
  return { ...full, parts: partsOf(full) };
}

function entryOf(grid: MapGrid): Cell | null {
  const nextToWarps = grid.warps.flatMap((w) => Object.values(DIRECTION_STEP).map(([dx, dy]) => ({ x: w.x + dx, y: w.y + dy })));
  const onEdges = edgesOf(grid).flatMap((c) => edgeCells(grid, c.direction));
  return [...nextToWarps, ...onEdges].find((cell) => walkable(grid, cell)) ?? null;
}
