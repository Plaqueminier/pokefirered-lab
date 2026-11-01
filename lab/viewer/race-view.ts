import { GBA_FPS } from "../src/protocol";
import { CELL, type RaceFile } from "../src/race/file";
import type { Door, IslandLink, World, WorldGym, WorldMap, WorldPlace } from "../src/race/world";
import { Store } from "./cursor";
import { fitCanvas, RaceArt } from "./race-art";
import { RaceCamera } from "./race-camera";
import { framedBox, type GhostNow, type RaceDoor, RaceGhosts, type RaceMoment, worldCell } from "./race-ghosts";
import { type Box, inBox, RaceMarks, type RaceTheme, raceTheme } from "./race-marks";
import { FRAME_WIDTH, SHEET_HEIGHT } from "./race-sprite";

const MIN_SPRITE_SCALE = 0.75;
const NUMBERS_ZOOM = 0.5;
const MAX_STEP_MS = 100;
const ROUTE_NAME_MIN_WIDTH = 70;
const ROUTE_NAME_MIN_HEIGHT = 28;
const GROUP_REACH_X = 24;
const GROUP_REACH_Y = 16;
const BUILDING_CELLS = { w: 9, h: 6 };
const CAVE_CELLS = { w: 14, h: 12 };
const HIT_MARGIN = 4;
const HIT_MIN_WIDTH = 24;
const ENDED_ALPHA = 0.4;
const OFF_SCREEN = 60;
const LABEL_REACH = 7;

// Down, up, left, right: the stand frame and the two walk frames. The game mirrors the left frames for the right facing.
const SPRITE_FRAMES = [
  [0, 3, 4],
  [1, 5, 6],
  [2, 7, 8],
  [2, 7, 8],
];
const FACING_RIGHT = 3;

export type RaceHit = { kind: "door"; door: RaceDoor } | { kind: "open"; key: string } | { kind: "ghosts"; ghosts: GhostNow[]; nearest: GhostNow };

type Item = { ghost: GhostNow; x: number; y: number };

/** `box`: the sprite and its label on the screen. */
export type GhostHit = { box: Box; ghost: GhostNow; group: GhostNow[] };

type Surface = { canvas: HTMLCanvasElement; theme: RaceTheme; marks: RaceMarks };

type DrawFrame = { ctx: CanvasRenderingContext2D; theme: RaceTheme; marks: RaceMarks; width: number; height: number };

export function nearestGhost(hits: readonly GhostHit[], x: number, y: number): GhostHit | null {
  let best: GhostHit | null = null;
  let nearest = Number.POSITIVE_INFINITY;
  for (const hit of hits) {
    const { box } = hit;
    if (Math.hypot(Math.max(box.x - x, 0, x - box.x - box.w), Math.max(box.y - y, 0, y - box.y - box.h)) > HIT_MARGIN) continue;
    const distance = Math.hypot(box.x + box.w / 2 - x, box.y + box.h / 2 - y);
    if (distance < nearest) {
      nearest = distance;
      best = hit;
    }
  }
  return best;
}

function runName(ghost: GhostNow): string {
  return `Run ${ghost.number}${ghost.result ? ` · ${ghost.result}` : ""}`;
}

export class RaceView {
  readonly art: RaceArt;
  readonly camera = new RaceCamera();
  readonly live = new Set<() => void>();
  speed = 20;
  playing = true;
  readonly selected = new Store<number | null>(null);
  frame = 0;
  moment: RaceMoment;
  readonly #ghosts: RaceGhosts;
  /** The floor of a building is the busiest one at the click: it stays while the building is open. */
  readonly #opened = new Map<string, { door: Door; map: string }>();
  #last = 0;
  #surface: Surface | null = null;
  #ghostHits: GhostHit[] = [];
  #doorHits: { door: RaceDoor; box: Box }[] = [];
  #openHits: { box: Box; key: string; hits: GhostHit[] }[] = [];
  readonly #places: WorldPlace[];
  readonly #placeOf: Map<string, WorldPlace>;
  readonly #links: IslandLink[];
  readonly #gyms: WorldGym[];

  constructor(race: RaceFile, world: World) {
    this.art = new RaceArt(world);
    this.#places = world.regions.flatMap((region) => region.places);
    this.#placeOf = new Map(this.#places.map((place) => [place.map, place]));
    this.#links = world.regions.flatMap((region) => region.links);
    this.#gyms = world.gyms;
    this.#ghosts = new RaceGhosts(race, { places: this.#places, maps: world.maps });
    this.moment = this.#ghosts.at(0);
  }

  get lastFrame(): number {
    return this.#ghosts.lastFrame;
  }

  mapOf(key: string): WorldMap | undefined {
    return this.art.maps.get(key);
  }

  titleOf(key: string): string {
    return this.mapOf(key)?.title ?? key;
  }

  attach(canvas: HTMLCanvasElement | null): void {
    if (!canvas) {
      this.#surface = null;
      return;
    }
    const theme = raceTheme(canvas);
    this.#surface = { canvas, theme, marks: new RaceMarks(theme) };
  }

  /** The loop runs only when the tab shows: the clock stands still while it is hidden. */
  tick(time: number): void {
    const elapsed = this.#last ? Math.min(MAX_STEP_MS, time - this.#last) : 0;
    this.#last = time;
    if (this.playing) {
      this.frame = Math.min(this.lastFrame, this.frame + (elapsed / 1000) * GBA_FPS * this.speed);
      if (this.frame >= this.lastFrame) this.playing = false;
    }
    this.moment = this.#ghosts.at(Math.floor(this.frame));
    this.#draw();
    for (const draw of this.live) draw();
  }

  togglePlay(): void {
    if (!this.playing && this.frame >= this.lastFrame) this.seek(0);
    this.playing = !this.playing;
  }

  seek(frame: number): void {
    this.frame = frame;
    this.camera.snap();
  }

  /** A follow always has its Ghost: a click on an empty place does not end it. */
  select(run: number | null): void {
    if (run !== null || this.camera.aim !== "selected") this.selected.set(run);
  }

  followGhost(run: number): void {
    const again = this.camera.aim === "selected" && this.selected.value === run;
    this.selected.set(run);
    this.camera.aim = again ? "all" : "selected";
  }

  isOpen(key: string): boolean {
    return this.#opened.has(key);
  }

  openBuilding({ key, door, interiors }: RaceDoor): void {
    this.#opened.set(key, { door, map: interiors[0].map });
  }

  closeBuilding(key: string): void {
    this.#opened.delete(key);
  }

  /** In the inverse of the order of the drawing. */
  hit(x: number, y: number): RaceHit | null {
    const door = this.#doorHits.find(({ box }) => inBox(box, x, y))?.door;
    if (door) return { kind: "door", door };
    const ghost = nearestGhost(this.#ghostHits, x, y);
    if (ghost) return { kind: "ghosts", ghosts: ghost.group, nearest: ghost.ghost };
    const open = this.#openHits.find(({ box }) => inBox(box, x, y));
    return open ? { kind: "open", key: open.key } : null;
  }

  #doorCell({ map, x, y }: Door): { x: number; y: number } | null {
    const place = this.#placeOf.get(map);
    return place ? worldCell(place, x, y) : null;
  }

  #draw(): void {
    if (!this.#surface) return;
    const { canvas, theme, marks } = this.#surface;
    const fitted = fitCanvas(canvas);
    if (!fitted) return;
    const { ctx, width, height } = fitted;
    ctx.fillStyle = theme.bg;
    ctx.fillRect(0, 0, width, height);
    const { aim } = this.camera;
    const followed = aim === "selected" && this.selected.value !== null ? this.moment.ghosts[this.selected.value] : null;
    const box = aim === "free" ? null : framedBox(followed ? [followed] : this.moment.ghosts);
    if (box) this.camera.frame(box, width, height);
    const frame: DrawFrame = { ctx, theme, marks, width, height };
    this.#drawLinks(frame);
    this.#drawPlaces(frame);
    this.#openHits = [...this.#opened].flatMap(([key, building]) => this.#drawOpenBuilding(frame, key, building));
    const { hits, labels } = this.#drawGhosts(frame, this.#outdoorItems(width, height), Math.max(this.camera.zoom, MIN_SPRITE_SCALE), this.camera.zoom);
    this.#ghostHits = [...hits, ...this.#openHits.flatMap((open) => open.hits)];
    const gyms = this.#drawGyms(frame);
    this.#doorHits = this.moment.doors.flatMap((door) => this.#drawDoor(frame, door));
    this.#drawNames(frame, [...labels, ...gyms, ...this.#doorHits.map((hit) => hit.box)]);
  }

  #outdoorItems(width: number, height: number): Item[] {
    return this.moment.ghosts.flatMap((ghost) => {
      if (ghost.place.kind !== "world") return [];
      const x = this.camera.screenX(ghost.place.x + 0.5 * ghost.place.scale);
      const y = this.camera.screenY(ghost.place.y + ghost.place.scale);
      return x > -OFF_SCREEN && y > -OFF_SCREEN && x < width + OFF_SCREEN && y < height + OFF_SCREEN ? [{ ghost, x, y }] : [];
    });
  }

  #drawLinks({ ctx, theme }: DrawFrame): void {
    const { camera } = this;
    ctx.save();
    ctx.setLineDash([5, 5]);
    ctx.strokeStyle = theme.fg;
    ctx.globalAlpha = 0.55;
    ctx.lineWidth = 1.5;
    for (const link of this.#links) {
      const door = this.#doorCell(link);
      const island = this.#placeOf.get(link.island);
      const map = this.mapOf(link.island);
      if (!door || !island || !map) continue;
      const x = door.x + 0.5;
      const y = door.y + 0.5;
      ctx.beginPath();
      ctx.moveTo(camera.screenX(x), camera.screenY(y));
      ctx.lineTo(camera.screenX(Math.max(island.x, Math.min(island.x + map.width * island.scale, x))), camera.screenY(Math.max(island.y, Math.min(island.y + map.height * island.scale, y))));
      ctx.stroke();
    }
    ctx.restore();
  }

  #drawPlaces({ ctx, theme, width, height }: DrawFrame): void {
    const { camera } = this;
    ctx.imageSmoothingEnabled = camera.zoom < 1;
    for (const place of this.#places) {
      const map = this.mapOf(place.map);
      if (!map) continue;
      const x = camera.screenX(place.x);
      const y = camera.screenY(place.y);
      const w = map.width * CELL * place.scale * camera.zoom;
      const h = map.height * CELL * place.scale * camera.zoom;
      if (x > width || y > height || x + w < 0 || y + h < 0) continue;
      ctx.drawImage(this.art.paint(place.map), x, y, w, h);
      if (!place.island) continue;
      ctx.save();
      ctx.strokeStyle = theme.fg;
      ctx.globalAlpha = 0.55;
      ctx.lineWidth = 1.5;
      ctx.strokeRect(x, y, w, h);
      ctx.restore();
    }
  }

  #drawGhosts(frame: DrawFrame, items: readonly Item[], scale: number, zoom: number): { hits: GhostHit[]; labels: Box[] } {
    const labelY = (y: number) => y - 24 * scale - 7;
    const groups: { x: number; labelY: number; items: Item[] }[] = [];
    for (const item of items) {
      const y = labelY(item.y);
      const group = groups.find((other) => Math.abs(other.x - item.x) < GROUP_REACH_X && Math.abs(other.labelY - y) < GROUP_REACH_Y);
      if (group) group.items.push(item);
      else groups.push({ x: item.x, labelY: y, items: [item] });
    }
    for (const item of [...items].sort((a, b) => a.y - b.y)) this.#drawSprite(frame, item, scale);
    const { leader } = this.moment;
    const hits: GhostHit[] = [];
    const labels: Box[] = [];
    for (const { items: members } of groups.sort((a, b) => a.items[0].y - b.items[0].y)) {
      const lead = members.find(({ ghost }) => ghost.run === this.selected.value) ?? members.find(({ ghost }) => ghost.run === leader) ?? members.find(({ ghost }) => !ghost.result) ?? members[0];
      labels.push(this.#drawLabel(frame, members, lead, labelY(lead.y), zoom));
      const group = members.map(({ ghost }) => ghost);
      const w = Math.max(FRAME_WIDTH * scale, HIT_MIN_WIDTH);
      for (const { ghost, x, y } of members) hits.push({ ghost, group, box: { x: x - w / 2, y: labelY(y) - LABEL_REACH, w, h: y - labelY(y) + LABEL_REACH } });
    }
    return { hits, labels };
  }

  #drawSprite({ ctx, marks }: DrawFrame, { ghost, x, y }: Item, scale: number): void {
    if (ghost.run === this.selected.value) marks.ring(ctx, x, y, scale);
    const frame = SPRITE_FRAMES[ghost.facing][ghost.walk];
    const sheet = this.art.ghost(ghost.number);
    const width = FRAME_WIDTH * scale;
    const height = SHEET_HEIGHT * scale;
    ctx.save();
    ctx.imageSmoothingEnabled = false;
    ctx.globalAlpha = ghost.result ? ENDED_ALPHA : 1;
    const top = y - height + 2 * scale;
    if (ghost.facing === FACING_RIGHT) {
      ctx.translate(x, 0);
      ctx.scale(-1, 1);
      ctx.drawImage(sheet, frame * FRAME_WIDTH, 0, FRAME_WIDTH, SHEET_HEIGHT, -width / 2, top, width, height);
    } else ctx.drawImage(sheet, frame * FRAME_WIDTH, 0, FRAME_WIDTH, SHEET_HEIGHT, x - width / 2, top, width, height);
    ctx.restore();
  }

  #drawLabel({ ctx, marks }: DrawFrame, members: readonly Item[], { ghost, x }: Item, y: number, zoom: number): Box {
    const fights = members.filter((member) => member.ghost.battle);
    const crown = members.some((member) => member.ghost.run === this.moment.leader);
    const selected = members.find((member) => member.ghost.run === this.selected.value)?.ghost;
    const group = members.length > 1;
    const shown = zoom >= NUMBERS_ZOOM || group || fights.length > 0 || crown || selected !== undefined;
    return marks.label(ctx, {
      x,
      y,
      text: !shown ? null : group ? `×${members.length}` : `${ghost.number}`,
      ended: members.every((member) => member.ghost.result),
      group,
      battle: fights.length === 0 ? null : { trainer: fights.some((member) => member.ghost.battle && member.ghost.battle.trainer !== null), count: group ? fights.length : 0 },
      crown,
      result: group ? null : ghost.result,
      selected: selected ? runName(selected) : null,
    });
  }

  #drawGyms({ ctx, marks }: DrawFrame): Box[] {
    const { camera } = this;
    const size = Math.max(18, Math.min(30, CELL * camera.zoom * 1.2));
    return this.#gyms.flatMap(({ milestone, door }, badge) => {
      const cell = this.#doorCell(door);
      if (!cell) return [];
      const y = camera.screenY(cell.y) - 30 - size / 2;
      return [marks.gym(ctx, this.art.badges, badge, camera.screenX(cell.x + 0.5), y, size, this.#ghosts.winners(milestone, Math.floor(this.frame)))];
    });
  }

  #drawDoor({ ctx, marks }: DrawFrame, door: RaceDoor): { door: RaceDoor; box: Box }[] {
    const cell = this.#doorCell(door.door);
    if (!cell) return [];
    const x = this.camera.screenX(cell.x + 0.5);
    const y = this.camera.screenY(cell.y) - (this.isOpen(door.key) ? 0 : 6);
    const crown = door.ghosts.some((ghost) => ghost.run === this.moment.leader);
    const box = marks.doorCount(ctx, x, y, door.ghosts.length, crown);
    const selected = door.ghosts.find((ghost) => ghost.run === this.selected.value);
    if (selected && selected.map !== this.#opened.get(door.key)?.map) marks.selectedName(ctx, x, box.y - (crown ? 34 : 20), runName(selected));
    return [{ door, box }];
  }

  #drawOpenBuilding(frame: DrawFrame, key: string, { door, map: mapKey }: { door: Door; map: string }): { box: Box; key: string; hits: GhostHit[] }[] {
    const { ctx, theme } = frame;
    const { camera } = this;
    const cell = this.#doorCell(door);
    const map = this.mapOf(mapKey);
    if (!cell || !map) return [];
    const cave = map.kind === "cave" || map.kind === "route";
    const cellsWide = cave ? CAVE_CELLS.w : Math.min(map.width, BUILDING_CELLS.w);
    const cellsHigh = cave ? CAVE_CELLS.h : Math.min(map.height, BUILDING_CELLS.h);
    const box: Box = {
      x: camera.screenX(cave ? cell.x + 2 : cell.x + 0.5 - cellsWide / 2),
      y: camera.screenY(cave ? cell.y - cellsHigh / 2 : cell.y - cellsHigh),
      w: cellsWide * CELL * camera.zoom,
      h: cellsHigh * CELL * camera.zoom,
    };
    ctx.fillStyle = theme.bg;
    ctx.strokeStyle = theme.accent;
    ctx.lineWidth = 1.5;
    const outline = new Path2D();
    outline.roundRect(box.x, box.y, box.w, box.h, theme.radius);
    ctx.fill(outline);
    ctx.save();
    ctx.clip(outline);
    const hits = this.drawInterior(ctx, mapKey, box);
    ctx.restore();
    ctx.stroke(outline);
    return [{ box, key, hits }];
  }

  drawInterior(ctx: CanvasRenderingContext2D, key: string, box: Box): GhostHit[] {
    const map = this.mapOf(key);
    if (!map || !this.#surface) return [];
    const { theme, marks } = this.#surface;
    const fit = Math.min(box.w / (map.width * CELL), box.h / (map.height * CELL));
    const left = box.x + (box.w - map.width * CELL * fit) / 2;
    const top = box.y + (box.h - map.height * CELL * fit) / 2;
    ctx.imageSmoothingEnabled = fit < 1;
    ctx.drawImage(this.art.paint(key), left, top, map.width * CELL * fit, map.height * CELL * fit);
    const items = (this.moment.inside.get(key) ?? []).map((ghost): Item => ({ ghost, x: left + (ghost.x + 0.5) * CELL * fit, y: top + (ghost.y + 1) * CELL * fit }));
    return this.#drawGhosts({ ctx, theme, marks, width: box.w, height: box.h }, items, Math.max(fit, 0.6), Math.max(fit, NUMBERS_ZOOM)).hits;
  }

  #drawNames({ ctx, marks, width, height }: DrawFrame, taken: readonly Box[]): void {
    const { camera } = this;
    const isTown = (place: WorldPlace) => place.island || this.mapOf(place.map)?.kind === "town";
    const placed = [...taken];
    for (const place of [...this.#places].sort((a, b) => Number(isTown(b)) - Number(isTown(a)))) {
      const map = this.mapOf(place.map);
      if (!map) continue;
      const left = Math.max(0, camera.screenX(place.x));
      const top = Math.max(0, camera.screenY(place.y));
      const right = Math.min(width, camera.screenX(place.x + map.width * place.scale));
      const bottom = Math.min(height, camera.screenY(place.y + map.height * place.scale));
      const town = isTown(place);
      if (right <= left || bottom <= top || (!town && (right - left < ROUTE_NAME_MIN_WIDTH || bottom - top < ROUTE_NAME_MIN_HEIGHT))) continue;
      marks.mapName(ctx, map.title, town, { x: left, y: top, w: right - left, h: bottom - top }, placed);
    }
  }
}
