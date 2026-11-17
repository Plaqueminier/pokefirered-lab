// Usage: bun run map [<map name>] [--save <file>] [--rom <name>]: see lab/README.md, "Print a map".
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { ELEVATION_SHIFT, KIND, LEDGE, SPIN, STOP, SWITCH, WALL } from "../cells";
import type { MapActors, MapGrid, Warp } from "../game";
import { errorText, Harness } from "../harness/harness";
import { FIELD_MOVES, gridLines } from "../model/extract";
import { ROM_NAME, Run, START_SAVE } from "../run";

type MapView = { grid: MapGrid; actors: MapActors };

const PLAYER = "@";
const PERSON = "P";
const WARP = "W";
const CHECK = "?";
const TRIGGER = "!";
const SUGGESTIONS = 20;

const LEGEND = [
  `${KIND.blocked} blocked`,
  `${KIND.open} open`,
  `${KIND.grass} tall grass`,
  `${KIND.water} water`,
  `${Object.values(LEDGE).join("")} ledge (jump direction)`,
  `${Object.values(WALL).join("")} thin wall on the north, south, west or east side`,
  `${Object.values(SPIN).join("")} spin tile`,
  `${STOP} stop tile`,
  `${SWITCH} switch`,
  ...Object.entries(FIELD_MOVES).flatMap(([move, { sign }]) => (move === "SURF" ? [] : [`${sign} ${move}`])),
  `${WARP} warp`,
  `${PERSON} person`,
  `${CHECK} thing to check or hidden item, on an open cell`,
  `${TRIGGER} trigger, on an open cell`,
  `${PLAYER} player`,
].join("; ");

const at = ({ x, y }: { x: number; y: number }) => `(${x}, ${y})`;

/** The cells of the map itself, row by row, with no border: one character per cell from `cell`. */
function mapRows(grid: MapGrid, cell: (index: number, x: number, y: number) => string): string[] {
  return Array.from({ length: grid.mapHeight }, (_, y) => Array.from({ length: grid.mapWidth }, (_, x) => cell((y - grid.y0) * grid.width + (x - grid.x0), x, y)).join(""));
}

/** The sign of each cell. A trigger and a thing to check show only on an open cell, so that they do not hide a switch or a wall. */
function cellSigns({ grid, actors }: MapView): string[] {
  const marks = new Map<string, string>();
  const mark = (cell: { x: number; y: number }, sign: string) => marks.set(at(cell), sign);
  for (const trigger of grid.triggers) mark(trigger, TRIGGER);
  for (const sign of grid.signs) mark(sign, CHECK);
  const weak = new Map(marks);
  marks.clear();
  for (const warp of grid.warps) mark(warp, WARP);
  for (const obstacle of actors.obstacles) mark(obstacle, FIELD_MOVES[obstacle.move].sign);
  for (const person of actors.people) mark(person, PERSON);
  if (actors.player) mark(actors.player, PLAYER);
  return mapRows(grid, (i, x, y) => {
    const kind = grid.kinds[i];
    return marks.get(at({ x, y })) ?? (kind === KIND.open ? weak.get(at({ x, y })) : undefined) ?? kind;
  });
}

function warpText(warp: Warp): string {
  const to = warp.dynamic === "unknown" ? "the floor chosen at the panel" : warp.to;
  const how = warp.how === "press" ? `press ${warp.direction} at ${at(warp.from)}` : warp.how === "step" ? `step${warp.from ? ` from ${at(warp.from)}` : ""}` : "no way in";
  return `${at(warp)} to ${to} (warp ${warp.warpId}), ${how}, ${warp.behavior}`;
}

function personText({ localId, x, y, graphics, stays, wander, trainer }: MapActors["people"][number]): string {
  const moves = stays ? "stays" : wander ? `walks in (${wander.x}, ${wander.y}) ${wander.w} x ${wander.h}` : "moves";
  const fights = trainer ? `, trainer ${trainer.id} (${trainer.defeated ? "defeated" : "not defeated"}, sight ${trainer.range})` : "";
  return `#${localId} ${graphics} at (${x}, ${y}), ${moves}${fights}`;
}

function checkText(sign: MapGrid["signs"][number], found: { found: boolean } | null): string {
  if (sign.kind === "hidden-item") return `${at(sign)} hidden item${found?.found ? ", found" : ""}`;
  return `${at(sign)} ${sign.pc ? "PC" : "sign"}, ${sign.playerFacing === "any" ? "from any side" : `the player faces ${sign.playerFacing}`}`;
}

function section(title: string, lines: string[]): string[] {
  return lines.length === 0 ? [] : ["", `${title}:`, ...lines.map((line) => `- ${line}`)];
}

/** The map as text: its cells with the warps, the people and the obstacles on them, its elevations, then the lists. */
export function mapText(view: MapView, live: boolean): string[] {
  const { grid, actors } = view;
  const size = { width: grid.mapWidth, height: grid.mapHeight };
  const kind = [grid.outside ? "outdoor" : "indoor", ...(grid.cave ? ["cave"] : [])].join(", ");
  const source = live ? "the cells of the game now, after the map scripts" : "the cells of the ROM, before the map scripts";
  return [
    `Map ${grid.name} (${grid.key}): ${grid.mapWidth} x ${grid.mapHeight} cells, ${kind}, ${source}.`,
    `Legend: ${LEGEND}.`,
    "",
    ...gridLines(size, cellSigns(view)),
    "",
    `Elevation (bits ${ELEVATION_SHIFT}-15 of each block, in hex):`,
    ...gridLines(size, mapRows(grid, (i) => (grid.blocks[i] >> ELEVATION_SHIFT).toString(16))),
    ...section("Connections", grid.connections.map((c) => `${c.direction} to ${c.map}, offset ${c.offset}`)),
    ...section("Warps", grid.warps.map(warpText)),
    ...section("People", actors.people.map(personText)),
    ...section("Fixed obstacles", actors.obstacles.map((o) => `${FIELD_MOVES[o.move].sign} ${o.name} #${o.localId} at ${at(o)}`)),
    ...section("Things to check", grid.signs.map((sign, i) => checkText(sign, actors.signs[i] ?? null))),
    ...section("Triggers", grid.triggers.map((t, i) => `${at(t)} when var 0x${t.variable.toString(16)} = ${t.value}${t.weather ? ", weather" : ""}, ${actors.triggers[i] === null ? "unknown" : actors.triggers[i] ? "active" : "inactive"}`)),
  ];
}

/** The map names that hold `name`, with no case. */
export function similarNames(names: readonly string[], name: string): string[] {
  const wanted = name.toLowerCase();
  return names.filter((n) => n.toLowerCase().includes(wanted)).slice(0, SUGGESTIONS);
}

async function main(args: string[]): Promise<void> {
  const { values, positionals } = parseArgs({ args, allowPositionals: true, options: { save: { type: "string" }, rom: { type: "string" } } });
  const startSave = values.save ? resolve(values.save) : START_SAVE;
  const run = await Run.open({ startSave, romName: values.rom ?? ROM_NAME });
  // The Harness plays the boot to the first walk: the flags of the save then say which people and obstacles the map has.
  const harness = await Harness.open({}, run);
  try {
    const { game } = run;
    const name = positionals[0] ?? game.map().name;
    const view = game.mapView(name);
    if (!view) {
      const near = similarNames(game.allMapNames.flat(), name);
      throw new Error(`no map ${name}${near.length > 0 ? `. Maps with this name in them: ${near.join(", ")}` : ""}`);
    }
    console.log(mapText(view, name === game.map().name).join("\n"));
  } finally {
    harness.close();
  }
}

if (import.meta.main)
  await main(process.argv.slice(2)).catch((error: unknown) => {
    console.error(errorText(error));
    process.exit(1);
  });
