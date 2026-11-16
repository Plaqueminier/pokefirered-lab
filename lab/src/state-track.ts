import { type GridMon, gridMon, type MonHealth, type StateEntry, type TeamMon } from "./protocol";

export type StateMon = TeamMon & MonHealth;

export type TeamAt = { frame: number; mons: StateMon[] };

/** How many of `length` sorted frames are at or before `frame`. */
export function countUntil(length: number, frameAt: (index: number) => number, frame: number): number {
  let low = 0;
  let high = length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (frameAt(middle) <= frame) low = middle + 1;
    else high = middle;
  }
  return low;
}

export class FrameList<T> {
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

export function byFrame<T extends { frame: number }>(items: readonly T[]): FrameList<T> {
  return new FrameList(items, ({ frame }) => frame);
}

/** The party at each change of the State track: `health` follows the order of the last `team`. */
export function teamTimeline(state: readonly StateEntry[]): TeamAt[] {
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

/** The party of a Run record at a frame of its replay; null for a record with no State track. */
export function partyOf(state: readonly StateEntry[] | undefined): (frame: number) => GridMon[] | null {
  if (!state) return () => null;
  const teams = byFrame(teamTimeline(state));
  return (frame) => (teams.last(frame)?.mons ?? []).map(gridMon);
}
