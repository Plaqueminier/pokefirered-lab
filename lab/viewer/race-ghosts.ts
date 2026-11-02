import type { EndReason } from "../src/harness/harness";
import { type MonHealth, type SpendUnit, type StateEntry, type TeamMon, TRACK_FIELD, TRACK_POINT } from "../src/protocol";
import { decodeTrack, type RaceBattle, type RaceFile, type RaceRun } from "../src/race/file";
import type { Door, WorldMap, WorldPlace } from "../src/race/world";
import type { CellBox } from "./race-camera";

const STEP_FRAMES = 16;
/** The player can stand 1 cell before a door that it presses into, and a wide door has 2 cells. */
const DOOR_REACH = 2;
const BADGE_PREFIX = "badge-";
const NO_BADGES: boolean[] = new Array(8).fill(false);

export type GhostWorld = { places: readonly WorldPlace[]; maps: readonly Pick<WorldMap, "key" | "warps" | "door">[] };

type GhostBattle = Extract<StateEntry, { kind: "battle" }>;

type GhostMon = TeamMon & MonHealth;

type GhostStats = { milestones: number; lastMilestone: number; badges: readonly boolean[]; cost: number; calls: number; battles: number; trainers: number; faints: number; money: number | null };

export type GhostPlace = { kind: "world"; x: number; y: number; scale: number } | { kind: "door"; door: Door; x: number; y: number; scale: number } | { kind: "nowhere" };

export type GhostNow = {
  run: number;
  number: number;
  character: string;
  map: string;
  x: number;
  y: number;
  facing: number;
  walk: number;
  battle: GhostBattle | null;
  result: EndReason | null;
  place: GhostPlace;
  team: GhostMon[];
  unit: SpendUnit;
  stats: GhostStats;
};

export type RaceDoor = { key: string; door: Door; ghosts: GhostNow[]; interiors: { map: string; ghosts: GhostNow[] }[] };

export type RaceMoment = { ghosts: GhostNow[]; doors: RaceDoor[]; inside: Map<string, GhostNow[]>; leader: number | null; ranking: GhostNow[] };

type TeamAt = { frame: number; mons: GhostMon[] };

type BadgesAt = { frame: number; got: boolean[] };

type Ghost = {
  run: RaceRun;
  track: Int32Array;
  doors: (Door | null)[];
  team: FrameList<TeamAt>;
  fights: FrameList<GhostBattle>;
  battles: FrameList<RaceBattle>;
  milestones: FrameList<RaceRun["milestones"][number]>;
  badges: FrameList<BadgesAt>;
  trainers: FrameList<RaceRun["trainers"][number]>;
  cost: FrameList<RaceRun["cost"][number]>;
  money: FrameList<RaceRun["money"][number]>;
  faints: FrameList<number>;
};

/** How many of `length` sorted frames are at or before `frame`. */
function countUntil(length: number, frameAt: (index: number) => number, frame: number): number {
  let low = 0;
  let high = length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (frameAt(middle) <= frame) low = middle + 1;
    else high = middle;
  }
  return low;
}

class FrameList<T> {
  constructor(
    private readonly items: readonly T[],
    private readonly frameOf: (item: T) => number,
  ) {}

  count(frame: number): number {
    return countUntil(this.items.length, (i) => this.frameOf(this.items[i]), frame);
  }

  last(frame: number): T | undefined {
    return this.items[this.count(frame) - 1];
  }
}

function byFirst<T extends readonly [number, ...unknown[]]>(items: readonly T[]): FrameList<T> {
  return new FrameList(items, (item) => item[0]);
}

function byFrame<T extends { frame: number }>(items: readonly T[]): FrameList<T> {
  return new FrameList(items, ({ frame }) => frame);
}

function badgeTimeline(milestones: RaceRun["milestones"]): BadgesAt[] {
  let got = NO_BADGES;
  return milestones.flatMap(([frame, milestone]) => {
    if (!milestone.startsWith(BADGE_PREFIX)) return [];
    got = got.map((old, i) => old || i === Number(milestone.slice(BADGE_PREFIX.length)) - 1);
    return [{ frame, got }];
  });
}

function teamTimeline(state: readonly StateEntry[]): TeamAt[] {
  const timeline: TeamAt[] = [];
  let team: readonly TeamMon[] = [];
  let health: readonly MonHealth[] = [];
  for (const entry of state) {
    if (entry.kind === "team") team = entry.team;
    else if (entry.kind === "health") health = entry.health;
    else continue;
    timeline.push({ frame: entry.frame, mons: team.map((mon, i) => ({ ...mon, ...(health[i] ?? { hp: mon.maxHp, status: "none" }) })) });
  }
  return timeline;
}

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
  return Math.max(0, countUntil(track.length / TRACK_POINT, (point) => track[point * TRACK_POINT + TRACK_FIELD.frame], frame) - 1);
}

function battleAt({ battles, fights }: Ghost, frame: number): GhostBattle | null {
  const battle = battles.last(frame);
  return battle && frame < battle[1] ? (fights.last(frame) ?? null) : null;
}

function statsAt(ghost: Ghost, frame: number): GhostStats {
  const cost = ghost.cost.last(frame);
  return {
    milestones: ghost.milestones.count(frame),
    lastMilestone: ghost.milestones.last(frame)?.[0] ?? 0,
    badges: ghost.badges.last(frame)?.got ?? NO_BADGES,
    cost: cost?.[1] ?? 0,
    calls: cost?.[2] ?? 0,
    battles: ghost.battles.count(frame),
    trainers: ghost.trainers.count(frame),
    faints: ghost.faints.count(frame),
    money: ghost.money.last(frame)?.[1] ?? null,
  };
}

function rankingOf(ghosts: readonly GhostNow[]): GhostNow[] {
  const levels = (ghost: GhostNow) => ghost.team.reduce((sum, mon) => sum + mon.level, 0);
  return [...ghosts].sort((a, b) => b.stats.milestones - a.stats.milestones || a.stats.lastMilestone - b.stats.lastMilestone || levels(b) - levels(a) || a.number - b.number);
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
      return {
        run,
        track,
        doors: this.#doorsOf(track),
        team: byFrame(teamTimeline(run.state)),
        fights: byFrame(run.state.filter((entry): entry is GhostBattle => entry.kind === "battle")),
        battles: byFirst(run.battles),
        milestones: byFirst(run.milestones),
        badges: byFrame(badgeTimeline(run.milestones)),
        trainers: byFirst(run.trainers),
        cost: byFirst(run.cost),
        money: byFirst(run.money),
        faints: new FrameList(run.faints, (frame) => frame),
      };
    });
    this.lastFrame = Math.max(0, ...race.runs.map((run) => run.end.frame));
  }

  at(frame: number): RaceMoment {
    const ghosts = this.#ghosts.map((ghost, index) => this.#ghostAt(ghost, index, frame));
    const inside = new Map<string, GhostNow[]>();
    for (const ghost of ghosts) if (ghost.place.kind !== "world") inside.set(ghost.map, [...(inside.get(ghost.map) ?? []), ghost]);
    const ranking = rankingOf(ghosts);
    const first = ranking[0];
    return { ghosts, doors: doorsOf(ghosts), inside, ranking, leader: first && first.stats.milestones > 0 ? first.run : null };
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

  #ghostAt(ghost: Ghost, index: number, frame: number): GhostNow {
    const { run, track, doors } = ghost;
    const point = pointAt(track, frame);
    const at = point * TRACK_POINT;
    const map = keyOf(track, point);
    const x = track[at + TRACK_FIELD.x];
    const y = track[at + TRACK_FIELD.y];
    const result = frame >= run.end.frame ? run.end.result : null;
    const battle = battleAt(ghost, frame);
    const now: GhostNow = { run: index, number: run.number, character: run.character, map, x, y, facing: track[at + TRACK_FIELD.facing], walk: 0, battle, result, place: this.#placeOf(map, x, y, doors[point]), team: ghost.team.last(frame)?.mons ?? [], unit: run.unit ?? "dollars", stats: statsAt(ghost, frame) };
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
