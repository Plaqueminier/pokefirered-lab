import type { EndReason } from "../src/protocol";
import type { StarterSpecies } from "../src/protocol";
import { CELL, type RaceFile } from "../src/race/file";
import { Store } from "./cursor";
import type { RaceArt } from "./race-art";
import type { CellBox, RaceCamera } from "./race-camera";
import { type RaceDeath, raceDeaths, type StarterStats, starterOf, starterStats } from "./race-deaths";
import type { GhostNow, GhostPlace, RaceMoment } from "./race-ghosts";
import type { GraveMarks, GraveSpot, PlaceMark } from "./race-grave-marks";

export type GraveMode = "off" | "cemetery" | "memorial" | "tour";

export type GraveFilter = "whiteouts" | "all";

type GraveMark = { id: string; ghost: GhostNow; frame: number } & ({ kind: "stone"; death: RaceDeath } | { kind: "end"; result: EndReason });

export type Grave = GraveSpot & GraveMark;

type GraveyardInputs = { race: RaceFile; camera: RaceCamera; art: RaceArt; ghostAt: (run: number, frame: number) => GhostNow; titleOf: (map: string) => string };

/** `now`: the clock of the animations, in ms. */
export type GraveFrame = { frame: number; moment: RaceMoment; width: number; height: number; now: number };

const BADGES = [1, 2];
const STONES_IN_A_ROW = 4;
const MIN_STONE = 30;
const MAX_STONE = 76;
const STONE_CELLS = 2.4;
const MEMORIAL_MARGIN = { x: 6, y: 8 };
const FOCUS_MARGIN = { x: 10, y: 7 };
const TOUR_MARGIN = { x: 7, y: 5 };

function boxAround(places: readonly GhostPlace[], margin: { x: number; y: number }): CellBox | null {
  const cells = places.flatMap((place) => (place.kind === "nowhere" ? [] : [place]));
  if (cells.length === 0) return null;
  const xs = cells.map(({ x }) => x);
  const ys = cells.map(({ y }) => y);
  return { left: Math.min(...xs) - margin.x, top: Math.min(...ys) - margin.y, right: Math.max(...xs) + margin.x, bottom: Math.max(...ys) + margin.y * 0.6 };
}

function average(values: readonly number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export class RaceGraveyard {
  readonly deaths: RaceDeath[];
  readonly filter = new Store<GraveFilter>("whiteouts");
  /** The death of the row under the pointer in the Deaths panel: the memorial frames it. */
  readonly focus = new Store<string | null>(null);
  readonly #inputs: GraveyardInputs;
  readonly #starters: (StarterSpecies | null)[];
  readonly #ghosts = new Map<string, GhostNow>();
  /** The start of each fall, in ms; a mark that is not here stands. */
  readonly #falls = new Map<string, number>();
  /** Null after a jump in time: the next drawing starts no fall. */
  #seen: number | null = null;
  #mode: GraveMode = "off";
  #tour = { index: 0, since: 0 };
  #graves: Grave[] = [];

  constructor(inputs: GraveyardInputs) {
    this.#inputs = inputs;
    this.#starters = inputs.race.runs.map(starterOf);
    this.deaths = raceDeaths(inputs.race, this.#starters);
  }

  get mode(): GraveMode {
    return this.#mode;
  }

  get tour(): { readonly index: number; readonly since: number } {
    return this.#tour;
  }

  /** The Tour starts at its first whiteout. */
  show(mode: GraveMode): void {
    if (mode === this.#mode) return;
    this.#mode = mode;
    this.focus.set(null);
    if (mode === "tour") this.#tour = { index: 0, since: performance.now() };
    this.settle();
    this.#inputs.camera.frameAgain();
  }

  setFocus(id: string | null): void {
    if (id === this.focus.value) return;
    this.focus.set(id);
    if (this.#mode === "memorial") this.#inputs.camera.frameAgain();
  }

  /** `by`: the number of whiteouts to go forward, or back when it is negative. */
  stepTour(by: number, now: number): void {
    const count = this.deaths.length;
    if (count === 0) return;
    this.#tour = { index: (((this.#tour.index + by) % count) + count) % count, since: now };
    this.#inputs.camera.frameAgain();
  }

  settle(): void {
    this.#seen = null;
  }

  visible(frame: number): RaceDeath[] {
    return this.deaths.filter((death) => death.frame <= frame);
  }

  /** The Ghost at its whiteout: its cell, its team. */
  ghostOf(death: RaceDeath): GhostNow {
    let ghost = this.#ghosts.get(death.id);
    if (!ghost) {
      ghost = this.#inputs.ghostAt(death.run, death.frame);
      this.#ghosts.set(death.id, ghost);
    }
    return ghost;
  }

  placeOf(death: RaceDeath): string {
    return this.#inputs.titleOf(this.ghostOf(death).map);
  }

  byPlace(frame: number): Map<string, RaceDeath[]> {
    return Map.groupBy(this.visible(frame), (death) => this.placeOf(death));
  }

  starters(frame: number, moment: RaceMoment): StarterStats[] {
    return starterStats(this.#starters, moment.ghosts, this.visible(frame), BADGES);
  }

  get #endMarks(): boolean {
    return this.filter.value === "all" && this.#mode !== "tour";
  }

  hides(ghost: GhostNow): boolean {
    if (this.#mode === "off" || ghost.result === null) return false;
    return ghost.result === "whiteout" || this.#mode === "tour" || this.#endMarks;
  }

  /** Null: the camera frames the Ghosts of the Race. */
  box(frame: number): CellBox | null {
    if (this.#mode === "tour") {
      const death = this.deaths[this.#tour.index];
      return death ? boxAround([this.ghostOf(death).place], TOUR_MARGIN) : null;
    }
    if (this.#mode !== "memorial") return null;
    const focused = this.deaths.find((death) => death.id === this.focus.value);
    if (focused) return boxAround([this.ghostOf(focused).place], FOCUS_MARGIN);
    return boxAround(
      this.visible(frame).map((death) => this.ghostOf(death).place),
      MEMORIAL_MARGIN,
    );
  }

  hit(marks: GraveMarks, x: number, y: number): Grave | null {
    return this.#graves.findLast((grave) => marks.hits(grave, x, y)) ?? null;
  }

  draw(ctx: CanvasRenderingContext2D, marks: GraveMarks, at: GraveFrame): void {
    this.#graves = this.#mode === "off" ? [] : this.#layout(at);
    this.#startFalls(at);
    const sheetOf = (grave: Grave) => this.#inputs.art.ghost(grave.ghost.number);
    if (this.#mode === "cemetery") marks.cemetery(ctx, this.#graves, (grave) => this.#age(grave, at.now), sheetOf);
    else if (this.#mode === "memorial") marks.memorial(ctx, this.#graves, this.#places(), this.#graves.find((grave) => grave.id === this.focus.value), at.width, at.height);
    else if (this.#mode === "tour") marks.tour(ctx, this.#graves, { ...this.#tour, now: at.now }, sheetOf, at.width, at.height);
  }

  #startFalls({ frame, now }: GraveFrame): void {
    const seen = this.#seen ?? frame;
    for (const grave of this.#graves) if (grave.frame > seen && !this.#falls.has(grave.id)) this.#falls.set(grave.id, now);
    const shown = new Set(this.#graves.map((grave) => grave.id));
    for (const id of this.#falls.keys()) if (!shown.has(id)) this.#falls.delete(id);
    this.#seen = frame;
  }

  #age(grave: Grave, now: number): number {
    const start = this.#falls.get(grave.id);
    return start === undefined ? Number.POSITIVE_INFINITY : now - start;
  }

  #places(): PlaceMark[] {
    const stones = this.#graves.flatMap((grave) => (grave.kind === "stone" ? [grave] : []));
    return [...Map.groupBy(stones, (grave) => this.placeOf(grave.death))].map(([name, members]) => ({
      name,
      count: members.length,
      x: average(members.map((grave) => grave.x)),
      y: average(members.map((grave) => grave.y)),
      top: Math.min(...members.map((grave) => grave.y)) - members[0].s * 1.3,
      s: members[0].s,
    }));
  }

  #marks({ frame, moment }: GraveFrame): { mark: GraveMark; place: GhostPlace }[] {
    const stones = this.visible(frame).map((death) => {
      const ghost = this.ghostOf(death);
      return { mark: { kind: "stone", id: death.id, death, ghost, frame: death.frame } as const, place: ghost.place };
    });
    if (!this.#endMarks) return stones;
    const ends = moment.ghosts.flatMap((ghost) => {
      const { result, run, number, place } = ghost;
      return result && result !== "whiteout" ? [{ mark: { kind: "end", id: `end:${number}`, result, ghost, frame: this.#inputs.race.runs[run].end.frame } as const, place }] : [];
    });
    return [...stones, ...ends];
  }

  /** Marks on the same cell stand in rows, the stones first. */
  #layout(at: GraveFrame): Grave[] {
    const { camera } = this.#inputs;
    const s = Math.max(MIN_STONE, Math.min(MAX_STONE, CELL * camera.zoom * STONE_CELLS));
    const graves: Grave[] = [];
    const onMap = this.#marks(at).flatMap(({ mark, place }) => (place.kind === "nowhere" ? [] : [{ mark, place }]));
    for (const members of Map.groupBy(onMap, ({ place }) => `${Math.round(place.x)}:${Math.round(place.y)}`).values()) {
      const sorted = members.sort((a, b) => Number(a.mark.kind === "end") - Number(b.mark.kind === "end") || a.mark.frame - b.mark.frame);
      const wide = Math.min(sorted.length, STONES_IN_A_ROW) - 1;
      sorted.forEach(({ place, mark }, i) => {
        const column = i % STONES_IN_A_ROW;
        const row = Math.floor(i / STONES_IN_A_ROW);
        graves.push({
          ...mark,
          x: camera.screenX(place.x + 0.5 * place.scale) + (column - wide / 2) * s * 0.62 + (row % 2) * s * 0.3,
          y: camera.screenY(place.y + place.scale) - row * s * 0.42,
          s: mark.kind === "stone" ? s : s * 0.5,
        });
      });
    }
    return graves.sort((a, b) => a.y - b.y);
  }
}
