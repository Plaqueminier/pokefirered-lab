import type { Camera, MapActors, MapGrid, Warp } from "../src/game";
import type { Sight } from "../src/harness/atlas";
import type { Cell } from "../src/harness/path";
import type { ClientMessage } from "../src/protocol";
import { Store } from "./cursor";
import { floorLayout, mapFamily } from "./map-floors";
import { mapParts } from "./map-parts";
import { type CellTip, describe, draw, drawFloorName, drawScreenFrame, drawWarpLink, linkAt, type MapExtras, type View, warpPairColors } from "./mapdraw";

export type MapState = { grid: MapGrid | null; actors: MapActors | null; preview: boolean; follow: boolean; names: string[][]; lastSeen: boolean; exits: boolean; floors: boolean; floorCount: number };

type Floor = { grid: MapGrid; actors: MapActors | null; dx: number };

type MapRef = { group: number; num: number };

const DRAG_PX = 4;

export class WholeMap {
  readonly state = new Store<MapState>({ grid: null, actors: null, preview: false, follow: true, names: [], lastSeen: false, exits: true, floors: true, floorCount: 1 });
  readonly #send: (message: ClientMessage) => void;
  readonly #tip: Store<CellTip | null>;
  #grid: MapGrid | null = null;
  #actors: MapActors | null = null;
  #lastSeen = false;
  #family: string[] = [];
  #exitColors: MapExtras["exits"] = null;
  readonly #otherFloors = new Map<string, MapGrid>();
  readonly #asked = new Set<string>();
  readonly #mapParts = new Map<string, Uint8Array | null>();
  #exits = true;
  #floors = true;
  #pointed: { map: string; warp: Warp } | null = null;
  #sight: Sight = {};
  #camera: Camera | null = null;
  #names: string[][] = [];
  #preview: { grid: MapGrid; actors: MapActors | null } | null = null;
  #history: MapRef[] = [];
  #follow = true;
  #view: View = { x: 0, y: 0, cell: 12 };
  #run: string | null = null;
  #canvas: HTMLCanvasElement | null = null;
  #background = "";

  constructor(send: (message: ClientMessage) => void, tip: Store<CellTip | null>) {
    this.#send = send;
    this.#tip = tip;
  }

  #shown(): { grid: MapGrid | null; actors: MapActors | null } {
    return this.#preview ?? { grid: this.#grid, actors: this.#actors };
  }

  // A preview shows the actors of one Run only.
  onRun(run: string): void {
    if (run === this.#run) return;
    if (this.#preview) this.backToPlayer();
    this.#run = run;
    // The server sends the map of a new Run before its status, so a map shown now already belongs to this Run.
    if (this.#lastSeen) {
      this.#grid = null;
      this.#actors = null;
      this.#lastSeen = false;
    }
    this.#changed();
  }

  onMap(grid: MapGrid | null): void {
    this.#lastSeen = !grid;
    if (grid) {
      if (grid.key !== this.#grid?.key && !this.#preview) this.#fit(grid);
      this.#grid = grid;
      if (this.#follow) this.#center();
    }
    this.#changed();
  }

  onActors(actors: MapActors | null): void {
    if (!actors) return;
    this.#actors = actors;
    if (this.#follow) this.#center();
    this.#changed();
  }

  onFloors(grids: readonly MapGrid[]): void {
    for (const grid of grids) this.#otherFloors.set(grid.name, grid);
    this.#changed();
  }

  setExits(on: boolean): void {
    this.#exits = on;
    this.#changed();
  }

  setFloors(on: boolean): void {
    this.#floors = on;
    this.#changed();
  }

  onSight(sight: Sight): void {
    this.#sight = sight;
    this.#draw();
  }

  onCamera(camera: Camera | null): void {
    this.#camera = camera;
    this.#draw();
  }

  onNames(names: string[][]): void {
    this.#names = names;
    // The server sends the names at each connection, and a server from before a restart may not have answered.
    this.#asked.clear();
    this.#changed();
  }

  onPreview(grid: MapGrid | null, actors: MapActors | null): void {
    if (!grid) return;
    if (this.#grid && grid.key === this.#grid.key) return this.backToPlayer();
    this.#preview = { grid, actors };
    this.#follow = false;
    this.#fit(grid);
    this.#changed();
  }

  viewMap(group: number, num: number): void {
    const current = this.#shown().grid;
    if (current) this.#history.push({ group: current.group, num: current.num });
    this.#send({ type: "view-map", group, num });
  }

  back(): void {
    const previous = this.#history.pop();
    if (!previous) return;
    const grid = this.#grid;
    if (grid && previous.group === grid.group && previous.num === grid.num && this.#history.length === 0) return this.backToPlayer();
    this.#send({ type: "view-map", ...previous });
  }

  backToPlayer(): void {
    this.#preview = null;
    this.#history = [];
    if (this.#grid) this.#fit(this.#grid);
    this.#setFollow(true);
  }

  toggleFollow(): void {
    if (this.#preview) this.backToPlayer();
    else this.#setFollow(!this.#follow);
  }

  search(name: string): void {
    for (let group = 0; group < this.#names.length; group++) {
      const num = this.#names[group].indexOf(name);
      if (num >= 0) return this.viewMap(group, num);
    }
  }

  centerOn(x: number, y: number): void {
    this.#follow = false;
    this.#centerCell(x, y);
    this.#changed();
  }

  #setFollow(on: boolean): void {
    this.#follow = on;
    if (on) this.#center();
    this.#changed();
  }

  #fit(grid: MapGrid): void {
    if (!this.#canvas) return;
    const { width, height } = this.#canvas;
    const cell = Math.max(4, Math.min(64, Math.min(width / (grid.mapWidth + 4), height / (grid.mapHeight + 4))));
    this.#view = { cell, x: (width - grid.mapWidth * cell) / 2, y: (height - grid.mapHeight * cell) / 2 };
  }

  #center(): void {
    const player = this.#actors?.player;
    if (player && !this.#preview) this.#centerCell(player.x, player.y);
  }

  #centerCell(x: number, y: number): void {
    if (!this.#canvas) return;
    const { width, height } = this.#canvas;
    this.#view.x = width / 2 - (x + 0.5) * this.#view.cell;
    this.#view.y = height / 2 - (y + 0.5) * this.#view.cell;
  }

  #changed(): void {
    const { grid } = this.#shown();
    this.#family = grid ? mapFamily(grid.name, this.#names.flat()) : [];
    this.#exitColors = this.#exits ? warpPairColors(this.#family.flatMap((name) => this.#floorNamed(name) ?? [])) : null;
    this.#askFloors();
    this.#publish();
    this.#draw();
  }

  #askFloors(): void {
    const shown = this.#shown().grid;
    const names = this.#family.filter((name) => name !== shown?.name && !this.#otherFloors.has(name) && !this.#asked.has(name));
    if (names.length === 0) return;
    for (const name of names) this.#asked.add(name);
    this.#send({ type: "view-floors", names });
  }

  #layout(): Floor[] {
    const { grid, actors } = this.#shown();
    if (!grid) return [];
    const floors = floorLayout(grid, this.#floors ? this.#family : [], this.#otherFloors);
    return floors.map((floor) => ({ ...floor, actors: floor.grid === grid ? actors : null }));
  }

  #publish(): void {
    const { grid, actors } = this.#shown();
    this.state.set({ grid, actors, preview: !!this.#preview, follow: this.#follow, names: this.#names, lastSeen: !this.#preview && this.#lastSeen && !!grid, exits: this.#exits, floors: this.#floors, floorCount: this.#family.length });
  }

  #mapPartsOf({ grid, actors }: Floor): Uint8Array | null {
    const blocked = [...(actors?.obstacles ?? []), ...(actors?.people ?? []).filter((p) => p.stays)];
    const key = `${grid.key} ${blocked.map(({ x, y }) => `${x},${y}`).join(" ")}`;
    if (!this.#mapParts.has(key)) {
      if (this.#mapParts.size > 64) this.#mapParts.clear();
      this.#mapParts.set(key, mapParts(grid, blocked));
    }
    return this.#mapParts.get(key) ?? null;
  }

  #arrival = (warp: Warp): Cell | null => this.#floorNamed(warp.to)?.warps[warp.warpId] ?? null;

  #floorNamed(name: string): MapGrid | null {
    const { grid } = this.#shown();
    return grid?.name === name ? grid : (this.#otherFloors.get(name) ?? null);
  }

  #floorAt(x: number): (Floor & { x: number }) | null {
    const floors = this.#layout();
    const under = floors.find(({ grid, dx }) => x - dx >= grid.x0 && x - dx < grid.x0 + grid.width) ?? floors[0];
    return under ? { ...under, x: x - under.dx } : null;
  }

  #pointAt(pointed: { map: string; warp: Warp } | null): void {
    if (pointed?.warp === this.#pointed?.warp) return;
    this.#pointed = pointed;
    this.#draw();
  }

  #drawPointed(ctx: CanvasRenderingContext2D, floors: Floor[]): void {
    const pointed = this.#pointed;
    const floor = pointed && floors.find(({ grid }) => grid.name === pointed.map);
    if (!pointed || !floor) return;
    const { warp } = pointed;
    const other = floors.find(({ grid }) => grid.name === warp.to);
    const end = other?.grid.warps[warp.warpId];
    drawWarpLink(ctx, this.#view, { x: warp.x + floor.dx, y: warp.y }, other && end ? { x: end.x + other.dx, y: end.y } : null);
  }

  #draw(): void {
    const canvas = this.#canvas;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    ctx.fillStyle = this.#background;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    const floors = this.#layout();
    const moved = (dx: number): View => ({ ...this.#view, x: this.#view.x + dx * this.#view.cell });
    for (const floor of floors) {
      const view = moved(floor.dx);
      draw(ctx, floor.grid, floor.actors, view, "map", this.#sight[floor.grid.name], { mapParts: this.#mapPartsOf(floor), exits: this.#exitColors });
      if (floors.length > 1) drawFloorName(ctx, view, floor.grid);
    }
    if (floors.length > 0 && this.#camera && !this.#preview) drawScreenFrame(ctx, this.#view, this.#camera);
    this.#drawPointed(ctx, floors);
  }

  #point(canvas: HTMLCanvasElement, event: MouseEvent): [number, number] {
    const rect = canvas.getBoundingClientRect();
    const ratio = canvas.width / rect.width;
    return [(event.clientX - rect.left) * ratio, (event.clientY - rect.top) * ratio];
  }

  #cellAt(canvas: HTMLCanvasElement, event: MouseEvent): [number, number] {
    const [cx, cy] = this.#point(canvas, event);
    return [Math.floor((cx - this.#view.x) / this.#view.cell), Math.floor((cy - this.#view.y) / this.#view.cell)];
  }

  #resize(canvas: HTMLCanvasElement): void {
    const rect = canvas.getBoundingClientRect();
    const ratio = window.devicePixelRatio || 1;
    const width = Math.round(rect.width * ratio);
    const height = Math.round(rect.height * ratio);
    // The Doc tab hides the canvas (size 0); a #fit when it shows again resets the zoom.
    if (width === 0 || (width === canvas.width && height === canvas.height)) return;
    canvas.width = width;
    canvas.height = height;
    const current = this.#shown().grid;
    if (current) this.#fit(current);
    if (this.#follow) this.#center();
    this.#draw();
  }

  attach(canvas: HTMLCanvasElement): () => void {
    this.#canvas = canvas;
    this.#background = getComputedStyle(canvas).getPropertyValue("--color-bg").trim();
    let drag: { x: number; y: number; viewX: number; viewY: number; moved: boolean } | null = null;
    const controller = new AbortController();
    const on = <K extends keyof HTMLElementEventMap>(type: K, listener: (event: HTMLElementEventMap[K]) => void, options: AddEventListenerOptions = {}) =>
      canvas.addEventListener(type, listener, { ...options, signal: controller.signal });

    on(
      "wheel",
      (event) => {
        event.preventDefault();
        const [cx, cy] = this.#point(canvas, event);
        const view = this.#view;
        const next = Math.min(64, Math.max(2, view.cell * Math.exp(-event.deltaY * 0.002)));
        this.#view = { x: cx - ((cx - view.x) * next) / view.cell, y: cy - ((cy - view.y) * next) / view.cell, cell: next };
        if (this.#follow) this.#center();
        this.#draw();
      },
      { passive: false },
    );
    on("pointerdown", (event) => {
      drag = { x: event.clientX, y: event.clientY, viewX: this.#view.x, viewY: this.#view.y, moved: false };
      canvas.setPointerCapture(event.pointerId);
    });
    on("pointermove", (event) => {
      if (drag) {
        const ratio = canvas.width / canvas.getBoundingClientRect().width;
        const dx = (event.clientX - drag.x) * ratio;
        const dy = (event.clientY - drag.y) * ratio;
        if (Math.hypot(dx, dy) > DRAG_PX) drag.moved = true;
        if (this.#follow && drag.moved) this.#setFollow(false);
        if (!this.#follow) {
          this.#view.x = drag.viewX + dx;
          this.#view.y = drag.viewY + dy;
          this.#draw();
        }
        return this.#tip.set(null);
      }
      const [cellX, y] = this.#cellAt(canvas, event);
      const floor = this.#floorAt(cellX);
      if (!floor) return;
      const { grid, actors, x } = floor;
      const link = linkAt(grid, x, y);
      canvas.style.cursor = link ? "pointer" : "";
      const warp = grid.warps.find((w) => w.x === x && w.y === y);
      this.#pointAt(warp ? { map: grid.name, warp } : null);
      const facts = describe(grid, actors, x, y, this.#arrival);
      this.#tip.set(facts && { at: { x: event.clientX, y: event.clientY }, facts, link: link?.name ?? null });
    });
    on("pointerup", (event) => {
      const clicked = drag && !drag.moved;
      drag = null;
      if (!clicked) return;
      const [cellX, y] = this.#cellAt(canvas, event);
      const floor = this.#floorAt(cellX);
      const link = floor && linkAt(floor.grid, floor.x, y);
      if (link) this.viewMap(link.group, link.num);
    });
    on("pointerleave", () => {
      this.#tip.set(null);
      this.#pointAt(null);
    });
    on("dblclick", () => (this.#preview ? this.backToPlayer() : this.#setFollow(true)));
    const observer = new ResizeObserver(() => this.#resize(canvas));
    observer.observe(canvas);
    return () => {
      controller.abort();
      observer.disconnect();
      this.#tip.set(null);
      this.#canvas = null;
    };
  }
}
