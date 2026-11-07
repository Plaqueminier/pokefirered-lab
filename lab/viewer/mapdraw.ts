// Draws a map grid and its actors on a canvas, at any scale. Used by the overlay on
// the game screen and by the whole-map view.
import { type Direction, LEDGE, SPIN, STOP } from "../src/cells";
import type { Camera, ConnectionSide, MapActors, MapGrid, Warp } from "../src/game";
import type { Cell } from "../src/harness/path";
import { obstacleRemedy } from "../src/protocol";

/** Where cell (0, 0) of the map is on the canvas, and the size of one cell, in canvas pixels. */
export type View = { x: number; y: number; cell: number };

export type Style = "overlay" | "map";

export type MapExtras = { mapParts: Uint8Array | null; exits: WarpColor | null };

type WarpColor = (grid: MapGrid, index: number) => string;

const OVERLAY_FILL = { "#": "rgba(224, 70, 70, 0.45)", "~": "rgba(60, 130, 230, 0.45)", '"': "rgba(80, 200, 110, 0.3)" };
const DIRECTIONS = Object.keys(SPIN) as Direction[];
const KIND_FILL: Record<Style, Record<string, string | null>> = {
  overlay: OVERLAY_FILL,
  map: { "#": "#1c1f25", "~": "#2d6cc0", '"': "#3d8a52", ".": "#4a515c", "^": "#4a515c", v: "#4a515c", "<": "#4a515c", ">": "#4a515c", "-": "#4a515c", _: "#4a515c", "[": "#4a515c", "]": "#4a515c", ...Object.fromEntries([...Object.values(SPIN), STOP].map((sign) => [sign, "#4a515c"])) },
};
const CELL_GLYPH: Record<string, string> = {
  ...Object.fromEntries(DIRECTIONS.flatMap((d) => [[LEDGE[d], SPIN[d]], [SPIN[d], SPIN[d]]])),
  [STOP]: STOP,
};
const FACING_STEP: Record<number, [number, number]> = { 1: [0, 1], 2: [0, -1], 3: [-1, 0], 4: [1, 0] };

const MAP_PART_TINTS = ["rgba(240, 170, 60, 0.28)", "rgba(190, 110, 230, 0.28)", "rgba(90, 200, 220, 0.28)", "rgba(240, 110, 130, 0.28)", "rgba(170, 210, 80, 0.28)", "rgba(255, 255, 255, 0.16)"];
const WARP_PAIR_COLORS = ["#ff6b6b", "#ffa94d", "#ffd43b", "#a9e34b", "#51cf66", "#20c997", "#22b8cf", "#4dabf7", "#748ffc", "#cc5de8", "#f783ac", "#e9ecef"];
const LABEL_MIN_CELL = 12;

const COLOR = {
  neverSeen: "rgba(150, 155, 165, 0.8)",
  screen: "rgba(255, 255, 255, 0.8)",
  sight: "rgba(255, 60, 60, 0.35)",
  wander: "rgba(240, 200, 40, 0.6)",
  trigger: "rgba(255, 110, 30, 0.95)",
  inactiveTrigger: "rgba(200, 200, 200, 0.5)",
  sign: "rgba(255, 170, 60, 0.85)",
  hiddenItem: "rgba(80, 230, 230, 0.9)",
  foundItem: "rgba(150, 150, 150, 0.6)",
  warp: "rgba(170, 90, 230, 0.75)",
  person: "rgba(240, 200, 40, 0.95)",
  personFill: "rgba(240, 200, 40, 0.75)",
  trainer: "rgba(255, 60, 60, 0.95)",
  beaten: "rgba(150, 150, 150, 0.9)",
  obstacle: "rgba(60, 170, 80, 0.85)",
  player: "rgba(255, 255, 255, 0.95)",
  playerRing: "rgba(232, 100, 60, 1)",
};

export function draw(ctx: CanvasRenderingContext2D, grid: MapGrid, actors: MapActors | null, view: View, style: Style, seen?: string, extras?: MapExtras): void {
  const { width, height } = ctx.canvas;
  const c = view.cell;
  const px = (x: number) => view.x + x * c;
  const py = (y: number) => view.y + y * c;
  const visible = (x: number, y: number) => px(x) + c > 0 && py(y) + c > 0 && px(x) < width && py(y) < height;
  ctx.save();
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  // Cells
  const fills = KIND_FILL[style];
  for (let gy = 0; gy < grid.height; gy++) {
    for (let gx = 0; gx < grid.width; gx++) {
      const x = gx + grid.x0;
      const y = gy + grid.y0;
      if (!visible(x, y)) continue;
      const kind = grid.kinds[gy * grid.width + gx];
      const fill = fills[kind];
      if (fill) {
        ctx.fillStyle = fill;
        ctx.fillRect(px(x), py(y), c, c);
      }
      const arrow = CELL_GLYPH[kind];
      if (arrow && c >= 8) {
        ctx.fillStyle = "rgba(255, 255, 255, 0.95)";
        ctx.font = `bold ${Math.round(c * 0.7)}px ui-sans-serif, system-ui`;
        ctx.fillText(arrow, px(x) + c / 2, py(y) + c / 2);
      }
      if (c >= 12) {
        ctx.strokeStyle = style === "overlay" ? "rgba(255, 255, 255, 0.12)" : "rgba(0, 0, 0, 0.25)";
        ctx.strokeRect(px(x) + 0.5, py(y) + 0.5, c - 1, c - 1);
      }
      const inMap = x >= 0 && y >= 0 && x < grid.mapWidth && y < grid.mapHeight;
      const part = inMap ? (extras?.mapParts?.[y * grid.mapWidth + x] ?? 0) : 0;
      if (part > 1) {
        ctx.fillStyle = MAP_PART_TINTS[(part - 2) % MAP_PART_TINTS.length];
        ctx.fillRect(px(x), py(y), c, c);
      }
      if (style === "map" && inMap && seen?.[y * grid.mapWidth + x] !== "1") {
        ctx.fillStyle = COLOR.neverSeen;
        ctx.fillRect(px(x), py(y), c, c);
      }
    }
  }
  if (style === "map") {
    // The border belongs to the neighbor maps: shade it.
    ctx.fillStyle = "rgba(10, 12, 15, 0.55)";
    ctx.fillRect(px(grid.x0), py(grid.y0), grid.width * c, -grid.y0 * c);
    ctx.fillRect(px(grid.x0), py(grid.mapHeight), grid.width * c, (grid.height + grid.y0 - grid.mapHeight) * c);
    ctx.fillRect(px(grid.x0), py(0), -grid.x0 * c, grid.mapHeight * c);
    ctx.fillRect(px(grid.mapWidth), py(0), (grid.width + grid.x0 - grid.mapWidth) * c, grid.mapHeight * c);
  }

  const inset = Math.max(1, c * 0.12);
  const line = Math.max(1, c * 0.08);

  // Trainer sight and wander areas, under the people
  for (const p of actors?.people ?? []) {
    for (const [sx, sy] of p.trainer?.sight ?? []) {
      ctx.fillStyle = COLOR.sight;
      ctx.fillRect(px(sx), py(sy), c, c);
    }
    if (p.wander && style === "map") {
      ctx.setLineDash([Math.max(2, c * 0.2), Math.max(2, c * 0.2)]);
      ctx.strokeStyle = COLOR.wander;
      ctx.lineWidth = 1;
      ctx.strokeRect(px(p.wander.x) + 0.5, py(p.wander.y) + 0.5, p.wander.w * c - 1, p.wander.h * c - 1);
      ctx.setLineDash([]);
    }
  }

  // Triggers: solid when active, dashed when not
  grid.triggers.forEach((t, i) => {
    if (t.weather) return;
    const active = actors?.triggers[i];
    ctx.lineWidth = line * 1.5;
    ctx.strokeStyle = active ? COLOR.trigger : COLOR.inactiveTrigger;
    if (!active) ctx.setLineDash([Math.max(2, c * 0.15), Math.max(2, c * 0.15)]);
    ctx.strokeRect(px(t.x) + inset, py(t.y) + inset, c - 2 * inset, c - 2 * inset);
    ctx.setLineDash([]);
    if (active && c >= 10) {
      ctx.fillStyle = COLOR.trigger;
      ctx.font = `bold ${Math.round(c * 0.6)}px ui-sans-serif, system-ui`;
      ctx.fillText("!", px(t.x) + c / 2, py(t.y) + c / 2);
    }
  });

  // Signs and hidden items
  grid.signs.forEach((s, i) => {
    const found = actors?.signs[i]?.found;
    ctx.strokeStyle = s.kind === "hidden-item" ? (found ? COLOR.foundItem : COLOR.hiddenItem) : COLOR.sign;
    ctx.lineWidth = line;
    ctx.beginPath();
    ctx.arc(px(s.x) + c / 2, py(s.y) + c / 2, c * 0.22, 0, Math.PI * 2);
    ctx.stroke();
  });

  // Warps: filled when they work, outlined when the cell does not warp
  grid.warps.forEach((w, i) => {
    const color = extras?.exits && !grid.outside ? extras.exits(grid, i) : COLOR.warp;
    ctx.fillStyle = color;
    ctx.strokeStyle = color;
    ctx.lineWidth = line;
    if (w.how === "none") ctx.strokeRect(px(w.x) + inset, py(w.y) + inset, c - 2 * inset, c - 2 * inset);
    else ctx.fillRect(px(w.x) + inset, py(w.y) + inset, c - 2 * inset, c - 2 * inset);
  });

  // People and player
  const person = (x: number, y: number, facing: number, fill: string | null, ring: string) => {
    const cx = px(x) + c / 2;
    const cy = py(y) + c / 2;
    ctx.beginPath();
    ctx.arc(cx, cy, c * 0.32, 0, Math.PI * 2);
    if (fill) {
      ctx.fillStyle = fill;
      ctx.fill();
    }
    ctx.strokeStyle = ring;
    ctx.lineWidth = Math.max(1.5, c * 0.1);
    ctx.stroke();
    const step = FACING_STEP[facing];
    if (step) {
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx + step[0] * c * 0.45, cy + step[1] * c * 0.45);
      ctx.stroke();
    }
  };
  for (const p of actors?.people ?? []) {
    const ring = p.trainer ? (p.trainer.defeated ? COLOR.beaten : COLOR.trainer) : COLOR.person;
    person(p.x, p.y, p.facing, p.loaded ? COLOR.personFill : null, ring);
  }
  ctx.fillStyle = COLOR.obstacle;
  for (const o of actors?.obstacles ?? []) ctx.fillRect(px(o.x) + inset, py(o.y) + inset, c - 2 * inset, c - 2 * inset);
  if (actors?.player) person(actors.player.x, actors.player.y, actors.player.facing, COLOR.player, COLOR.playerRing);

  // Connections, as labels on the edges
  if (style === "map" && c >= 4) {
    setMapLabelStyle(ctx);
    for (const conn of grid.connections) {
      const label = `${SIDE_ARROW[conn.direction]} ${conn.map}`;
      const at: Record<string, [number, number]> = {
        north: [grid.mapWidth / 2, -1.5],
        south: [grid.mapWidth / 2, grid.mapHeight + 1.5],
        west: [-3.5, grid.mapHeight / 2],
        east: [grid.mapWidth + 3.5, grid.mapHeight / 2],
      };
      const pos = at[conn.direction];
      if (pos) ctx.fillText(label, px(pos[0]), py(pos[1]));
    }
  }
  if (extras?.exits) drawExitLabels(ctx, grid, view);
  ctx.restore();
}

export function warpPairColors(floors: readonly MapGrid[]): WarpColor {
  const mapId = ({ group, num }: Pick<MapGrid, "group" | "num">) => `${group}.${num}`;
  const here = new Map(floors.map((grid) => [mapId(grid), grid]));
  const insideKey = (grid: MapGrid, w: Warp) => {
    const other = here.get(mapId(w));
    if (!other) return null;
    const back = other.warps[w.warpId];
    return back && mapId(back) === mapId(grid) ? [`${mapId(grid)}.${back.warpId}`, `${mapId(w)}.${w.warpId}`].sort().join() : `to ${mapId(w)}.${w.warpId}`;
  };
  const ordered = [...new Set(floors.flatMap((grid) => grid.warps.flatMap((w) => insideKey(grid, w) ?? [])))].sort();
  const colors = new Map(ordered.map((key, i) => [key, WARP_PAIR_COLORS[i % WARP_PAIR_COLORS.length]]));
  // A warp that leaves these floors cannot read its other end, so all the warps between two maps share the color of the pair of maps.
  const hashed = (key: string) => WARP_PAIR_COLORS[[...key].reduce((hash, char) => (hash * 31 + char.charCodeAt(0)) >>> 0, 0) % WARP_PAIR_COLORS.length];
  return (grid, index) => {
    const w = grid.warps[index];
    const key = insideKey(grid, w);
    return (key && colors.get(key)) ?? hashed([mapId(grid), mapId(w)].sort().join());
  };
}

export function shortMapName(to: string, from: string): string {
  const others = from.split("_");
  const parts = to.split("_");
  let same = 0;
  while (same < parts.length - 1 && parts[same] === others[same]) same++;
  return parts.slice(same).join("_");
}

function drawExitLabels(ctx: CanvasRenderingContext2D, grid: MapGrid, view: View): void {
  const ratio = window.devicePixelRatio || 1;
  const c = view.cell;
  if (c < LABEL_MIN_CELL * ratio) return;
  const size = Math.round(10 * ratio);
  const height = size + 4 * ratio;
  const pad = 3 * ratio;
  ctx.font = labelFont(size);
  const taken: { x: number; y: number; w: number; h: number }[] = [];
  for (const w of grid.warps) {
    const label = shortMapName(w.to, grid.name);
    const width = ctx.measureText(label).width + 2 * pad;
    const x = view.x + w.x * c + c / 2 - width / 2;
    const tries = [view.y + w.y * c - height - ratio, view.y + (w.y + 1) * c + ratio];
    const y = tries.find((top) => !taken.some((t) => x < t.x + t.w && t.x < x + width && top < t.y + t.h && t.y < top + height));
    if (y === undefined) continue;
    taken.push({ x, y, w: width, h: height });
    ctx.fillStyle = "rgba(10, 12, 15, 0.82)";
    ctx.fillRect(x, y, width, height);
    ctx.fillStyle = "rgba(255, 255, 255, 0.95)";
    ctx.fillText(label, x + width / 2, y + height / 2);
  }
}

export function drawWarpLink(ctx: CanvasRenderingContext2D, view: View, from: Cell, to: Cell | null): void {
  const c = view.cell;
  const center = ({ x, y }: Cell): [number, number] => [view.x + (x + 0.5) * c, view.y + (y + 0.5) * c];
  const ring = (cell: Cell) => {
    ctx.beginPath();
    ctx.arc(...center(cell), c * 0.75, 0, Math.PI * 2);
    ctx.stroke();
  };
  ctx.save();
  ctx.strokeStyle = COLOR.screen;
  ctx.lineWidth = Math.max(2, c * 0.1);
  ring(from);
  if (to) {
    ring(to);
    ctx.setLineDash([c * 0.4, c * 0.3]);
    ctx.beginPath();
    ctx.moveTo(...center(from));
    ctx.lineTo(...center(to));
    ctx.stroke();
  }
  ctx.restore();
}

function labelFont(px: number): string {
  return `600 ${px}px ui-sans-serif, system-ui`;
}

function setMapLabelStyle(ctx: CanvasRenderingContext2D): void {
  ctx.font = labelFont(Math.round(13 * (window.devicePixelRatio || 1)));
  ctx.fillStyle = "rgba(255, 255, 255, 0.9)";
}

export function drawFloorName(ctx: CanvasRenderingContext2D, view: View, grid: MapGrid): void {
  ctx.save();
  ctx.textAlign = "left";
  setMapLabelStyle(ctx);
  ctx.fillText(grid.name, view.x, view.y + (grid.y0 - 1) * view.cell);
  ctx.restore();
}

export function drawScreenFrame(ctx: CanvasRenderingContext2D, view: View, camera: Camera): void {
  ctx.strokeStyle = COLOR.screen;
  ctx.lineWidth = 2;
  ctx.strokeRect(view.x - (camera.x / 16) * view.cell, view.y - (camera.y / 16) * view.cell, 15 * view.cell, 10 * view.cell);
}

// A faint canvas color is not visible on a 10 px swatch, so some swatches have more alpha.
function swatch(color: string, alpha: number): string {
  return color.replace(/[\d.]+\)$/, `${alpha})`);
}

const SWATCH = {
  person: `border-radius: 50%; background: ${swatch(COLOR.personFill, 0.8)}`,
  trainer: `border-radius: 50%; border: 2px solid ${COLOR.trainer}`,
  sight: `background: ${COLOR.sight}`,
  warp: `background: ${COLOR.warp}`,
  trigger: `border: 2px solid ${COLOR.trigger}`,
  inactiveTrigger: `border: 2px dashed ${swatch(COLOR.inactiveTrigger, 0.6)}`,
  sign: `border-radius: 50%; border: 2px solid ${COLOR.sign}`,
  hiddenItem: `border-radius: 50%; border: 2px solid ${COLOR.hiddenItem}`,
  obstacle: `background: ${COLOR.obstacle}`,
  neverSeen: `background: ${COLOR.neverSeen}`,
};

export const OVERLAY_SWATCHES = [
  { label: "blocked", style: `background: ${swatch(OVERLAY_FILL["#"], 0.55)}` },
  { label: "water", style: `background: ${swatch(OVERLAY_FILL["~"], 0.55)}` },
  { label: "tall grass", style: `background: ${swatch(OVERLAY_FILL['"'], 0.35)}` },
  { label: "warp (outline: inactive)", style: SWATCH.warp },
  { label: "person (hollow: off the screen)", style: SWATCH.person },
  { label: "fixed obstacle (cut tree, rock, boulder)", style: SWATCH.obstacle },
  { label: "trainer", style: SWATCH.trainer },
  { label: "trainer sight", style: SWATCH.sight },
  { label: "active trigger (!)", style: SWATCH.trigger },
  { label: "inactive trigger", style: SWATCH.inactiveTrigger },
  { label: "sign", style: SWATCH.sign },
  { label: "hidden item", style: SWATCH.hiddenItem },
  { label: "never seen (whole map)", style: SWATCH.neverSeen },
  { label: "ledge", glyph: "➜" },
];

export const MAP_SWATCHES = [
  { label: "open", style: `background: ${KIND_FILL.map["."]}` },
  { label: "blocked", style: `background: ${KIND_FILL.map["#"]}; outline: 1px solid var(--color-line-strong)` },
  { label: "water (Surf)", style: `background: ${KIND_FILL.map["~"]}` },
  { label: "tall grass", style: `background: ${KIND_FILL.map['"']}` },
  { label: "never seen by the player", style: SWATCH.neverSeen },
  { label: "game screen now", style: `border: 2px solid ${COLOR.screen}` },
  { label: "player", style: `border-radius: 50%; background: ${COLOR.player}; border: 2px solid ${COLOR.playerRing}` },
  { label: "person (hollow: off the screen)", style: SWATCH.person },
  { label: "trainer (grey: beaten)", style: SWATCH.trainer },
  { label: "trainer sight", style: SWATCH.sight },
  { label: "warp (outline: inactive)", style: SWATCH.warp },
  { label: "active trigger (!)", style: SWATCH.trigger },
  { label: "inactive trigger", style: SWATCH.inactiveTrigger },
  { label: "sign", style: SWATCH.sign },
  { label: "hidden item", style: SWATCH.hiddenItem },
  { label: "fixed obstacle", style: SWATCH.obstacle },
  { label: "wander area", style: `border: 1px dashed ${COLOR.wander}` },
  { label: "tint: map parts that a walk does not connect", style: `background: ${swatch(MAP_PART_TINTS[0], 0.6)}` },
  { label: "warp color: both ends of a warp", style: `background: linear-gradient(90deg, ${WARP_PAIR_COLORS[0]} 50%, ${WARP_PAIR_COLORS[7]} 50%)` },
];

const SIDE_ARROW: Record<ConnectionSide, string> = { north: "↑", south: "↓", west: "←", east: "→", dive: "", emerge: "" };
const DIRECTION_LABEL: Record<number, string> = { 0: "?", 1: "south", 2: "north", 3: "west", 4: "east" };
const KIND_LABEL: Record<string, string> = { "#": "blocked", "~": "water (Surf)", '"': "tall grass", ".": "open", "^": "ledge (jump north)", v: "ledge (jump south)", "<": "ledge (jump west)", ">": "ledge (jump east)", "-": "open, thin wall on the north side", _: "open, thin wall on the south side", "[": "open, thin wall on the west side", "]": "open, thin wall on the east side", ...Object.fromEntries(DIRECTIONS.map((d) => [SPIN[d], `spin tile (slide ${d})`])), [STOP]: "stop tile (ends a slide)" };

export function howLabel(w: Warp): string {
  switch (w.how) {
    case "step":
      return "walk onto it";
    case "press":
      return w.from.x === w.x && w.from.y === w.y ? `stand on it and push ${w.direction}` : `push ${w.direction} from (${w.from.x}, ${w.from.y})`;
    case "none":
      return "inactive: the cell is not a warp cell";
  }
}

export type StopState = "active" | "inactive" | "unknown" | "beaten" | "not-beaten";

export const STOP_LABEL: Record<StopState, string> = { active: "active", inactive: "inactive", unknown: "state unknown", beaten: "beaten", "not-beaten": "not beaten" };

export function triggerState(active: boolean | null | undefined): StopState {
  return active === true ? "active" : active === false ? "inactive" : "unknown";
}

export type CellFacts = { title: string; kind?: string; facts: string[]; tech?: string };

export type CellTip = { at: { x: number; y: number }; facts: CellFacts; link: string | null };

export function describe(grid: MapGrid, actors: MapActors | null, x: number, y: number, arrival?: (warp: Warp) => Cell | null): CellFacts | null {
  const gx = x - grid.x0;
  const gy = y - grid.y0;
  if (gx < 0 || gy < 0 || gx >= grid.width || gy >= grid.height) return linkAt(grid, x, y) ? { title: "Edge of the map", facts: [] } : null;
  const i = gy * grid.width + gx;
  const block = grid.blocks[i];
  const outside = x < 0 || y < 0 || x >= grid.mapWidth || y >= grid.mapHeight;
  const behavior = grid.behaviorNames[grid.behaviors[i]];
  const facts: string[] = [];
  for (const w of grid.warps) {
    if (w.x !== x || w.y !== y) continue;
    const end = arrival?.(w);
    facts.push(`warp → ${w.to}${end ? ` (${end.x}, ${end.y})` : ""} (${howLabel(w)})`);
  }
  grid.triggers.forEach((t, k) => {
    if (t.x !== x || t.y !== y) return;
    if (t.weather) return facts.push("weather trigger");
    const state = triggerState(actors?.triggers[k]);
    const v = t.variable === 0 ? "always" : `if var 0x${t.variable.toString(16)} = ${t.value}`;
    facts.push(`script trigger (${v}): ${state === "active" ? "ACTIVE" : STOP_LABEL[state]}`);
  });
  grid.signs.forEach((s, k) => {
    if (s.x !== x || s.y !== y) return;
    facts.push(s.kind === "sign" ? "sign / thing to examine (A)" : `hidden item ${actors?.signs[k]?.found ? "(found)" : "(not found yet)"}`);
  });
  for (const p of actors?.people ?? []) {
    if (p.x === x && p.y === y) {
      facts.push(`person ${p.localId}, facing ${DIRECTION_LABEL[p.facing] ?? "?"}${p.loaded ? "" : " (off the screen: start position)"}`);
      if (p.trainer) facts.push(`trainer ${p.trainer.id}, sight ${p.trainer.range} cells${p.trainer.allDirections ? ", all directions" : ""}, ${STOP_LABEL[p.trainer.defeated ? "beaten" : "not-beaten"]}`);
    }
    if (p.trainer?.sight.some(([sx, sy]) => sx === x && sy === y)) facts.push(`in the sight of trainer ${p.trainer.id}`);
  }
  for (const o of actors?.obstacles ?? []) if (o.x === x && o.y === y) facts.push(`fixed obstacle: ${o.name}. ${obstacleRemedy(o.move)}`);
  if (actors?.player && actors.player.x === x && actors.player.y === y) facts.push("player");
  return {
    title: `Cell (${x}, ${y})${outside ? " · border (neighbour map)" : ""}`,
    kind: KIND_LABEL[grid.kinds[i]] ?? grid.kinds[i],
    facts,
    tech: `metatile ${block & 0x3ff} · collision ${(block >> 10) & 3} · elevation ${block >> 12}${behavior ? ` · ${behavior}` : ""}`,
  };
}

export function linkAt(g: MapGrid, x: number, y: number): { group: number; num: number; name: string } | null {
  const warp = g.warps.find((w) => w.x === x && w.y === y);
  if (warp) return { group: warp.group, num: warp.num, name: warp.to };
  const side = y < 0 ? "north" : y >= g.mapHeight ? "south" : x < 0 ? "west" : x >= g.mapWidth ? "east" : null;
  const conn = side ? g.connections.find((c) => c.direction === side) : undefined;
  return conn ? { group: conn.group, num: conn.num, name: conn.map } : null;
}
