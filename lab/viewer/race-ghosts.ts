import type { EndReason } from "../src/harness/harness";
import { TRACK_FIELD, TRACK_POINT } from "../src/protocol";
import { decodeTrack, type RaceFile, type RaceRun } from "../src/race/file";
import type { Door, WorldMap, WorldPlace } from "../src/race/world";
import type { CellBox } from "./race-camera";

const STEP_FRAMES = 16;
/** The player can stand 1 cell before a door that it presses into, and a wide door has 2 cells. */
const DOOR_REACH = 2;

export type GhostWorld = { places: readonly WorldPlace[]; maps: readonly Pick<WorldMap, "key" | "warps" | "door">[] };

type GhostBattle = { trainer: boolean | null; name: string | null };

export type GhostPlace = { kind: "world"; x: number; y: number; scale: number } | { kind: "door"; door: Door; x: number; y: number; scale: number } | { kind: "nowhere" };

export type GhostNow = {
  run: number;
  number: number;
  map: string;
  x: number;
  y: number;
  facing: number;
  walk: number;
  battle: GhostBattle | null;
  result: EndReason | null;
  place: GhostPlace;
};

export type RaceDoor = { key: string; door: Door; ghosts: GhostNow[]; interiors: { map: string; ghosts: GhostNow[] }[] };

export type RaceMoment = { ghosts: GhostNow[]; doors: RaceDoor[]; inside: Map<string, GhostNow[]>; leader: number | null };

type Ghost = { run: RaceRun; track: Int32Array; doors: (Door | null)[] };

export function worldCell(place: WorldPlace, x: number, y: number): { x: number; y: number; scale: number } {
  return { x: place.x + x * place.scale, y: place.y + y * place.scale, scale: place.scale };
}

/** All the Ghosts when no Run plays: the end of a Race and a jump to it still have a picture to frame. */
export function framedBox(ghosts: readonly GhostNow[]): CellBox | null {
  const playing = ghosts.filter(({ result }) => result === null);
  const cells = (playing.length > 0 ? playing : ghosts).flatMap(({ place }) => (place.kind === "nowhere" ? [] : [place]));
  if (cells.length === 0) return null;
  const xs = cells.map(({ x }) => x);
  const ys = cells.map(({ y }) => y);
  return { left: Math.min(...xs), top: Math.min(...ys), right: Math.max(...xs) + 1, bottom: Math.max(...ys) + 1 };
}

function keyOf(track: Int32Array, point: number): string {
  return `${track[point * TRACK_POINT + TRACK_FIELD.group]}.${track[point * TRACK_POINT + TRACK_FIELD.num]}`;
}

function pointAt(track: Int32Array, frame: number): number {
  let low = 0;
  let high = track.length / TRACK_POINT - 1;
  while (low < high) {
    const middle = (low + high + 1) >> 1;
    if (track[middle * TRACK_POINT + TRACK_FIELD.frame] <= frame) low = middle;
    else high = middle - 1;
  }
  return low;
}

function battleAt(run: RaceRun, frame: number): GhostBattle | null {
  const index = run.battles.findIndex(([start, end]) => frame >= start && frame < end);
  if (index === -1) return null;
  const [start, , trainer] = run.battles[index];
  const next = run.battles[index + 1]?.[0] ?? Number.POSITIVE_INFINITY;
  // The Game event of a trainer comes after the battle, and only when the player wins.
  return { trainer, name: trainer ? (run.trainers.find(([at]) => at >= start && at < next)?.[1] ?? null) : null };
}

function leaderAt(ghosts: readonly Ghost[], frame: number): number | null {
  let leader: number | null = null;
  let most = 0;
  let first = Number.POSITIVE_INFINITY;
  ghosts.forEach(({ run }, index) => {
    const reached = run.milestones.filter(([at]) => at <= frame);
    const last = reached.at(-1)?.[0] ?? Number.POSITIVE_INFINITY;
    if (reached.length > most || (reached.length === most && most > 0 && last < first)) {
      leader = index;
      most = reached.length;
      first = last;
    }
  });
  return leader;
}

function doorsOf(ghosts: readonly GhostNow[]): RaceDoor[] {
  const doors = new Map<string, RaceDoor>();
  for (const ghost of ghosts) {
    if (ghost.place.kind !== "door") continue;
    const { door } = ghost.place;
    const key = `${door.map}.${door.x}.${door.y}`;
    const entry = doors.get(key) ?? { key, door, ghosts: [], interiors: [] };
    entry.ghosts.push(ghost);
    const interior = entry.interiors.find(({ map }) => map === ghost.map);
    if (interior) interior.ghosts.push(ghost);
    else entry.interiors.push({ map: ghost.map, ghosts: [ghost] });
    doors.set(key, entry);
  }
  for (const { interiors } of doors.values()) interiors.sort((a, b) => b.ghosts.length - a.ghosts.length);
  return [...doors.values()];
}

export class RaceGhosts {
  readonly lastFrame: number;
  readonly #ghosts: Ghost[];
  readonly #places: Map<string, WorldPlace>;
  readonly #maps: Map<string, GhostWorld["maps"][number]>;

  constructor(race: RaceFile, world: GhostWorld) {
    this.#places = new Map(world.places.map((place) => [place.map, place]));
    this.#maps = new Map(world.maps.map((map) => [map.key, map]));
    this.#ghosts = race.runs.map((run) => {
      const track = decodeTrack(run.track);
      return { run, track, doors: this.#doorsOf(track) };
    });
    this.lastFrame = Math.max(0, ...race.runs.map((run) => run.end.frame));
  }

  at(frame: number): RaceMoment {
    const ghosts = this.#ghosts.map((ghost, index) => this.#ghostAt(ghost, index, frame));
    const inside = new Map<string, GhostNow[]>();
    for (const ghost of ghosts) if (ghost.place.kind !== "world") inside.set(ghost.map, [...(inside.get(ghost.map) ?? []), ghost]);
    return { ghosts, doors: doorsOf(ghosts), inside, leader: leaderAt(this.#ghosts, frame) };
  }

  winners(milestone: string, frame: number): number {
    return this.#ghosts.filter(({ run }) => run.milestones.some(([at, name]) => name === milestone && at <= frame)).length;
  }

  #doorsOf(track: Int32Array): (Door | null)[] {
    const doors: (Door | null)[] = [];
    for (let point = 0; point < track.length / TRACK_POINT; point++) {
      const map = keyOf(track, point);
      if (this.#places.has(map)) {
        doors.push(null);
        continue;
      }
      const before = point > 0 ? keyOf(track, point - 1) : null;
      const at = (point - 1) * TRACK_POINT;
      if (before === map) doors.push(doors[point - 1]);
      else if (before !== null && this.#places.has(before)) doors.push(this.#doorFrom(before, track[at + TRACK_FIELD.x], track[at + TRACK_FIELD.y], map));
      else if (before !== null && this.#linked(before, map)) doors.push(doors[point - 1]);
      else doors.push(this.#maps.get(map)?.door ?? doors[point - 1] ?? null);
    }
    return doors;
  }

  // No warp near the cell: the Ghost did not walk in (a whiteout, a Fly).
  #doorFrom(map: string, x: number, y: number, to: string): Door | null {
    const distance = (warp: { x: number; y: number }) => Math.abs(warp.x - x) + Math.abs(warp.y - y);
    const near = this.#maps.get(map)?.warps.filter((warp) => warp.to === to && distance(warp) <= DOOR_REACH) ?? [];
    if (near.length === 0) return this.#maps.get(to)?.door ?? { map, x, y };
    const first = near.reduce((door, warp) => (warp.x < door.x || warp.y < door.y ? warp : door));
    return { map, x: first.x, y: first.y };
  }

  #linked(a: string, b: string): boolean {
    return (this.#maps.get(a)?.warps.some((warp) => warp.to === b) ?? false) || (this.#maps.get(b)?.warps.some((warp) => warp.to === a) ?? false);
  }

  #worldCell(map: string, x: number, y: number): { x: number; y: number; scale: number } | null {
    const place = this.#places.get(map);
    return place ? worldCell(place, x, y) : null;
  }

  #placeOf(map: string, x: number, y: number, door: Door | null): GhostPlace {
    const cell = this.#worldCell(map, x, y);
    if (cell) return { kind: "world", ...cell };
    const doorCell = door && this.#worldCell(door.map, door.x, door.y);
    return door && doorCell ? { kind: "door", door, ...doorCell } : { kind: "nowhere" };
  }

  #ghostAt({ run, track, doors }: Ghost, index: number, frame: number): GhostNow {
    const point = pointAt(track, frame);
    const at = point * TRACK_POINT;
    const map = keyOf(track, point);
    const x = track[at + TRACK_FIELD.x];
    const y = track[at + TRACK_FIELD.y];
    const result = frame >= run.end.frame ? run.end.result : null;
    const battle = battleAt(run, frame);
    const now: GhostNow = { run: index, number: run.number, map, x, y, facing: track[at + TRACK_FIELD.facing], walk: 0, battle, result, place: this.#placeOf(map, x, y, doors[point]) };
    return battle || result ? now : this.#slid(now, track, point, frame);
  }

  // The game changes the cell at the start of a step: the Ghost goes from the cell before the point to its cell.
  #slid(now: GhostNow, track: Int32Array, point: number, frame: number): GhostNow {
    if (point === 0) return now;
    const at = point * TRACK_POINT;
    const start = track[at + TRACK_FIELD.frame];
    const next = (point + 1) * TRACK_POINT < track.length ? track[at + TRACK_POINT + TRACK_FIELD.frame] : Number.POSITIVE_INFINITY;
    const progress = (frame - start) / Math.min(STEP_FRAMES, next - start);
    const step = progress < 1 ? this.#stepFrom(track, point, now) : null;
    if (!step) return now;
    const dx = step.dx * (1 - progress);
    const dy = step.dy * (1 - progress);
    const { place } = now;
    return {
      ...now,
      x: now.x + dx,
      y: now.y + dy,
      walk: progress < 0.5 ? 1 + (point % 2) : 0,
      place: place.kind === "world" ? { ...place, x: place.x + dx * place.scale, y: place.y + dy * place.scale } : place,
    };
  }

  /** Null when the point is a warp or a turn on the spot. A step over a connection touches on the world. */
  #stepFrom(track: Int32Array, point: number, now: GhostNow): { dx: number; dy: number } | null {
    const at = (point - 1) * TRACK_POINT;
    const x = track[at + TRACK_FIELD.x];
    const y = track[at + TRACK_FIELD.y];
    const map = keyOf(track, point - 1);
    const before = map === now.map ? { dx: x - now.x, dy: y - now.y } : this.#worldStep(map, x, y, now.place);
    return before && Math.abs(before.dx) + Math.abs(before.dy) === 1 ? before : null;
  }

  #worldStep(map: string, x: number, y: number, place: GhostPlace): { dx: number; dy: number } | null {
    const cell = this.#worldCell(map, x, y);
    return cell && place.kind === "world" ? { dx: cell.x - place.x, dy: cell.y - place.y } : null;
  }
}
