// Draws a map grid and its actors on a canvas, at any scale. Used by the overlay on
// the game screen and by the whole-map view.
import type { ConnectionSide, Direction, MapActors, MapGrid, Warp } from "../src/game";

/** Where cell (0, 0) of the map is on the canvas, and the size of one cell, in canvas pixels. */
export type View = { x: number; y: number; cell: number };

export type Style = "overlay" | "map";

const KIND_FILL: Record<Style, Record<string, string | null>> = {
  overlay: { "#": "rgba(224, 70, 70, 0.45)", "~": "rgba(60, 130, 230, 0.45)", '"': "rgba(80, 200, 110, 0.3)" },
  map: { "#": "#1c1f25", "~": "#2d6cc0", '"': "#3d8a52", ".": "#4a515c", "^": "#4a515c", v: "#4a515c", "<": "#4a515c", ">": "#4a515c" },
};
const LEDGE_ARROW: Record<string, string> = { "^": "↑", v: "↓", "<": "←", ">": "→" };
const NEVER_SEEN = "rgba(150, 155, 165, 0.8)";
const FACING_STEP: Record<number, [number, number]> = { 1: [0, 1], 2: [0, -1], 3: [-1, 0], 4: [1, 0] };

export function kindAt(grid: MapGrid, x: number, y: number): string {
  const gx = x - grid.x0;
  const gy = y - grid.y0;
  if (gx < 0 || gy < 0 || gx >= grid.width || gy >= grid.height) return " ";
  return grid.kinds[gy * grid.width + gx];
}

export function draw(ctx: CanvasRenderingContext2D, grid: MapGrid, actors: MapActors | null, view: View, style: Style, seen?: string): void {
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
      const arrow = LEDGE_ARROW[kind];
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
      if (style === "map" && inMap && seen?.[y * grid.mapWidth + x] !== "1") {
        ctx.fillStyle = NEVER_SEEN;
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
      ctx.fillStyle = "rgba(255, 60, 60, 0.35)";
      ctx.fillRect(px(sx), py(sy), c, c);
    }
    if (p.wander && style === "map") {
      ctx.setLineDash([Math.max(2, c * 0.2), Math.max(2, c * 0.2)]);
      ctx.strokeStyle = "rgba(240, 200, 40, 0.6)";
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
    ctx.strokeStyle = active ? "rgba(255, 110, 30, 0.95)" : "rgba(200, 200, 200, 0.5)";
    if (!active) ctx.setLineDash([Math.max(2, c * 0.15), Math.max(2, c * 0.15)]);
    ctx.strokeRect(px(t.x) + inset, py(t.y) + inset, c - 2 * inset, c - 2 * inset);
    ctx.setLineDash([]);
    if (active && c >= 10) {
      ctx.fillStyle = "rgba(255, 110, 30, 0.95)";
      ctx.font = `bold ${Math.round(c * 0.6)}px ui-sans-serif, system-ui`;
      ctx.fillText("!", px(t.x) + c / 2, py(t.y) + c / 2);
    }
  });

  // Signs and hidden items
  grid.signs.forEach((s, i) => {
    const found = actors?.signs[i]?.found;
    ctx.strokeStyle = s.kind === "hidden-item" ? (found ? "rgba(150, 150, 150, 0.6)" : "rgba(80, 230, 230, 0.9)") : "rgba(255, 170, 60, 0.85)";
    ctx.lineWidth = line;
    ctx.beginPath();
    ctx.arc(px(s.x) + c / 2, py(s.y) + c / 2, c * 0.22, 0, Math.PI * 2);
    ctx.stroke();
  });

  // Warps: filled when they work, outlined when the cell does not warp
  for (const w of grid.warps) {
    ctx.fillStyle = "rgba(170, 90, 230, 0.75)";
    ctx.strokeStyle = "rgba(170, 90, 230, 0.75)";
    ctx.lineWidth = line;
    if (w.how === "none") ctx.strokeRect(px(w.x) + inset, py(w.y) + inset, c - 2 * inset, c - 2 * inset);
    else ctx.fillRect(px(w.x) + inset, py(w.y) + inset, c - 2 * inset, c - 2 * inset);
  }

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
    const ring = p.trainer ? (p.trainer.defeated ? "rgba(150, 150, 150, 0.9)" : "rgba(255, 60, 60, 0.95)") : "rgba(240, 200, 40, 0.95)";
    person(p.x, p.y, p.facing, p.loaded ? "rgba(240, 200, 40, 0.75)" : null, ring);
  }
  ctx.fillStyle = "rgba(60, 170, 80, 0.85)";
  for (const o of actors?.obstacles ?? []) ctx.fillRect(px(o.x) + inset, py(o.y) + inset, c - 2 * inset, c - 2 * inset);
  if (actors?.player) person(actors.player.x, actors.player.y, actors.player.facing, "rgba(255, 255, 255, 0.95)", "rgba(232, 100, 60, 1)");

  // Connections, as labels on the edges
  if (style === "map" && c >= 4) {
    ctx.font = `600 ${Math.round(13 * (window.devicePixelRatio || 1))}px ui-sans-serif, system-ui`;
    ctx.fillStyle = "rgba(255, 255, 255, 0.9)";
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
  ctx.restore();
}

const SIDE_ARROW: Record<ConnectionSide, string> = { north: "↑", south: "↓", west: "←", east: "→", dive: "", emerge: "" };
const DIRECTION_LABEL: Record<number, string> = { 0: "?", 1: "south", 2: "north", 3: "west", 4: "east" };
const KIND_LABEL: Record<string, string> = { "#": "blocked", "~": "water (Surf)", '"': "tall grass", ".": "open", "^": "ledge (jump north)", v: "ledge (jump south)", "<": "ledge (jump west)", ">": "ledge (jump east)" };

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

/** Text for the tooltip of one cell. */
export function describe(grid: MapGrid, actors: MapActors | null, x: number, y: number): string | null {
  const gx = x - grid.x0;
  const gy = y - grid.y0;
  if (gx < 0 || gy < 0 || gx >= grid.width || gy >= grid.height) return null;
  const i = gy * grid.width + gx;
  const block = grid.blocks[i];
  const outside = x < 0 || y < 0 || x >= grid.mapWidth || y >= grid.mapHeight;
  const lines = [
    `cell (${x}, ${y})${outside ? " · border (neighbour map)" : ""}`,
    `${KIND_LABEL[grid.kinds[i]] ?? grid.kinds[i]}`,
    `metatile ${block & 0x3ff} · collision ${(block >> 10) & 3} · elevation ${block >> 12}`,
    grid.behaviorNames[grid.behaviors[i]] ?? "",
  ];
  for (const w of grid.warps) {
    if (w.x !== x || w.y !== y) continue;
    lines.push(`warp → ${w.to} (${howLabel(w)})`);
  }
  grid.triggers.forEach((t, k) => {
    if (t.x !== x || t.y !== y) return;
    if (t.weather) return lines.push("weather trigger");
    const state = actors?.triggers[k];
    const v = t.variable === 0 ? "always" : `if var 0x${t.variable.toString(16)} = ${t.value}`;
    lines.push(`script trigger (${v}): ${state === null ? "state unknown" : state ? "ACTIVE" : "inactive"}`);
  });
  grid.signs.forEach((s, k) => {
    if (s.x !== x || s.y !== y) return;
    lines.push(s.kind === "sign" ? "sign / thing to examine (A)" : `hidden item ${actors?.signs[k]?.found ? "(found)" : "(not found yet)"}`);
  });
  for (const p of actors?.people ?? []) {
    if (p.x === x && p.y === y) {
      let text = `person ${p.localId}, facing ${DIRECTION_LABEL[p.facing] ?? "?"}${p.loaded ? "" : " (off the screen: start position)"}`;
      if (p.trainer) {
        text += `\ntrainer ${p.trainer.id}, sight ${p.trainer.range} cells${p.trainer.allDirections ? ", all directions" : ""}, ${p.trainer.defeated ? "defeated" : "not defeated yet"}`;
      }
      lines.push(text);
    }
    if (p.trainer?.sight.some(([sx, sy]) => sx === x && sy === y)) lines.push(`in the sight of trainer ${p.trainer.id}`);
  }
  for (const o of actors?.obstacles ?? []) if (o.x === x && o.y === y) lines.push(`fixed obstacle: ${o.graphics.replaceAll("_", " ")} (${o.move} removes it)`);
  if (actors?.player && actors.player.x === x && actors.player.y === y) lines.push("player");
  return lines.filter(Boolean).join("\n");
}
