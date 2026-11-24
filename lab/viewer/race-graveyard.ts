import type { StarterSpecies } from "../src/protocol";
import { CELL, type RaceFile } from "../src/race/file";
import { Store } from "./cursor";
import type { RaceArt } from "./race-art";
import type { CellBox, RaceCamera } from "./race-camera";
import { isDeath, type RaceDeath, type RaceGrave, raceGraves, type StarterStats, starterOf, starterStats } from "./race-deaths";
import type { GhostNow, GhostPlace, RaceMoment } from "./race-ghosts";
import type { GraveMarks, GraveSpot, PlaceMark } from "./race-grave-marks";

export type GraveMode = "off" | "cemetery" | "memorial" | "tour";

export type GraveFilter = "whiteouts" | "all";

export type OrderedGrave = RaceGrave & { order: number };

export type Grave = GraveSpot & OrderedGrave & { ghost: GhostNow };

type GraveyardInputs = { race: RaceFile; camera: RaceCamera; art: RaceArt; ghostAt: (run: number, frame: number) => GhostNow; titleOf: (map: string) => string };

/** `now`: the clock of the animations, in ms. */
export type GraveFrame = { frame: number; width: number; height: number; now: number };

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

function upTo<G extends { frame: number }>(graves: readonly G[], frame: number): G[] {
  return graves.filter((grave) => grave.frame <= frame);
}

function average(values: readonly number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export class RaceGraveyard {
  readonly deaths: (RaceDeath & { order: number })[];
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
  readonly #gravesByFilter: Record<GraveFilter, OrderedGrave[]>;
  #onScreen: Grave[] = [];

  constructor(inputs: GraveyardInputs) {
    this.#inputs = inputs;
    this.#starters = inputs.race.runs.map(starterOf);
    const all = raceGraves(inputs.race, this.#starters);
    const ordered = <G extends RaceGrave>(graves: readonly G[]) => graves.map((grave, order) => ({ ...grave, order }));
    this.deaths = ordered(all.filter(isDeath));
    this.#gravesByFilter = { whiteouts: this.deaths, all: ordered(all) };
  }

  get graves(): readonly OrderedGrave[] {
    return this.#gravesByFilter[this.filter.value];
  }

  get mode(): GraveMode {
    return this.#mode;
  }

  get tour(): { readonly index: number; readonly since: number } {
    return this.#tour;
  }

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
    if (this.#mode === "memorial") this.#inputs.camera.glide();
  }

  stepTour(by: number, now: number): void {
    const count = this.graves.length;
    if (count === 0) return;
    this.#tour = { index: (((this.#tour.index + by) % count) + count) % count, since: now };
    this.#inputs.camera.frameAgain();
  }

  settle(): void {
    this.#seen = null;
  }

  deathsAt(frame: number): RaceDeath[] {
    return upTo(this.deaths, frame);
  }

  gravesAt(frame: number): OrderedGrave[] {
    return upTo(this.graves, frame);
  }

  ghostOf(grave: RaceGrave): GhostNow {
    let ghost = this.#ghosts.get(grave.id);
    if (!ghost) {
      ghost = this.#inputs.ghostAt(grave.run, grave.frame);
      this.#ghosts.set(grave.id, ghost);
    }
    return ghost;
  }

  placeOf(grave: RaceGrave): string {
    return this.#inputs.titleOf(this.ghostOf(grave).map);
  }

  byPlace(frame: number): Map<string, RaceDeath[]> {
    return Map.groupBy(this.deathsAt(frame), (death) => this.placeOf(death));
  }

  starters(frame: number, moment: RaceMoment): StarterStats[] {
    return starterStats(this.#starters, moment.ghosts, this.deathsAt(frame), BADGES);
  }

  hides(ghost: GhostNow): boolean {
    if (this.#mode === "off" || ghost.result === null) return false;
    return ghost.result === "whiteout" || this.#mode === "tour" || this.filter.value === "all";
  }

  /** Null: the camera frames the Ghosts of the Race. */
  box(frame: number): CellBox | null {
    if (this.#mode === "tour") {
      const grave = this.graves[this.#tour.index];
      return grave ? boxAround([this.ghostOf(grave).place], TOUR_MARGIN) : null;
    }
    if (this.#mode !== "memorial") return null;
    const focused = this.deaths.find((death) => death.id === this.focus.value);
    if (focused) return boxAround([this.ghostOf(focused).place], FOCUS_MARGIN);
    return boxAround(
      this.gravesAt(frame).map((grave) => this.ghostOf(grave).place),
      MEMORIAL_MARGIN,
    );
  }

  hit(marks: GraveMarks, x: number, y: number): Grave | null {
    return this.#onScreen.findLast((grave) => marks.hits(grave, x, y)) ?? null;
  }

  draw(ctx: CanvasRenderingContext2D, marks: GraveMarks, at: GraveFrame): void {
    this.#onScreen = this.#mode === "off" ? [] : this.#layout(at);
    this.#startFalls(at);
    const sheetOf = (grave: Grave) => this.#inputs.art.ghost(grave.ghost.number);
    if (this.#mode === "cemetery") marks.cemetery(ctx, this.#onScreen, (grave) => this.#age(grave, at.now), sheetOf);
    else if (this.#mode === "memorial") marks.memorial(ctx, this.#onScreen, this.#places(), this.#onScreen.find((grave) => grave.id === this.focus.value), at.width, at.height);
    else if (this.#mode === "tour") marks.tour(ctx, this.#onScreen, { ...this.#tour, now: at.now }, sheetOf, at.width, at.height);
  }

  #startFalls({ frame, now }: GraveFrame): void {
    const seen = this.#seen ?? frame;
    for (const grave of this.#onScreen) if (grave.frame > seen && !this.#falls.has(grave.id)) this.#falls.set(grave.id, now);
    const shown = new Set(this.#onScreen.map((grave) => grave.id));
    for (const id of this.#falls.keys()) if (!shown.has(id)) this.#falls.delete(id);
    this.#seen = frame;
  }

  #age(grave: Grave, now: number): number {
    const start = this.#falls.get(grave.id);
    return start === undefined ? Number.POSITIVE_INFINITY : now - start;
  }

  #places(): PlaceMark[] {
    const whiteouts = this.#onScreen.filter(isDeath);
    return [...Map.groupBy(whiteouts, (grave) => this.placeOf(grave))].map(([name, members]) => ({
      name,
      count: members.length,
      x: average(members.map((grave) => grave.x)),
      y: average(members.map((grave) => grave.y)),
      top: Math.min(...members.map((grave) => grave.y)) - members[0].s * 1.3,
      s: members[0].s,
    }));
  }

  #layout(at: GraveFrame): Grave[] {
    const { camera } = this.#inputs;
    const s = Math.max(MIN_STONE, Math.min(MAX_STONE, CELL * camera.zoom * STONE_CELLS));
    const graves: Grave[] = [];
    const onMap = this.gravesAt(at.frame).flatMap((grave) => {
      const ghost = this.ghostOf(grave);
      const { place } = ghost;
      return place.kind === "nowhere" ? [] : [{ mark: { ...grave, ghost }, place }];
    });
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
          s,
        });
      });
    }
    return graves.sort((a, b) => a.y - b.y);
  }
}
