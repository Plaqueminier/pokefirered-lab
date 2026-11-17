// Usage: bun run shot --keys "<frame>:<button>[+<button>][/<frames held>] ..." [options]: see lab/README.md, "Take screenshots of the game".
import { mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { CACHE_DIR } from "../core";
import { errorText } from "../harness/harness";
import { Keys } from "../protocol";
import { ROM_NAME, Run, START_SAVE } from "../run";
import { contactSheet, encodePng, type Image, scaled } from "./png";

export type Press = { frame: number; keys: number; hold: number };

const DEFAULT_HOLD = 4;
const FRAMES_AFTER_LAST_PRESS = 120;
const DEFAULT_COLUMNS = 4;
const USAGE = `Usage: bun run shot [--keys "<frame>:<button>[+<button>][/<frames held>] ..."] [--frames <last frame>] [--every <n>] [--at <frame>,...] [--sheet] [--columns <n>] [--scale <n>] [--save <file>] [--rom <name>] [--seed <n>] [--out <folder>]
Buttons: ${Object.keys(Keys).join(", ")}.`;

/** Reads "120:A 300:Start 360:Down+B/16": a press of A at frame 120, of Start at 300, and Down with B held 16 frames from frame 360. */
export function parsePresses(text: string): Press[] {
  return text
    .split(/[\s,]+/)
    .filter(Boolean)
    .map((word) => {
      const [, frame, buttons, hold] = word.match(/^(\d+):([A-Za-z+]+)(?:\/(\d+))?$/) ?? [];
      if (!frame) throw new Error(`write a press as <frame>:<button>[+<button>][/<frames held>], not "${word}"`);
      const keys = buttons.split("+").reduce((sum, name) => {
        const key = Object.entries(Keys).find(([button]) => button.toLowerCase() === name.toLowerCase())?.[1];
        if (key === undefined) throw new Error(`no button "${name}": the buttons are ${Object.keys(Keys).join(", ")}`);
        return sum | key;
      }, 0);
      return { frame: Number(frame), keys, hold: hold === undefined ? DEFAULT_HOLD : Number(hold) };
    });
}

/** The keys held while the game plays frame `frame` (the first frame is 0). */
export function keysAt(presses: readonly Press[], frame: number): number {
  return presses.reduce((keys, press) => (frame >= press.frame && frame < press.frame + press.hold ? keys | press.keys : keys), 0);
}

/** The frames to keep: each `every` frames from `every`, each frame of `at`, and the last frame. */
export function shotFrames(last: number, every: number | null, at: readonly number[]): number[] {
  const steps = every === null ? [] : Array.from({ length: Math.floor(last / every) }, (_, i) => (i + 1) * every);
  return [...new Set([...steps, ...at.filter((frame) => frame <= last), last])].sort((a, b) => a - b);
}

function whole(value: string | undefined, name: string, fallback: number): number {
  if (value === undefined) return fallback;
  const number = Number(value);
  if (!Number.isInteger(number) || number < 0) throw new Error(`--${name} must be a whole number, not "${value}"`);
  return number;
}

async function main(args: string[]): Promise<void> {
  const { values } = parseArgs({
    args,
    options: { keys: { type: "string" }, frames: { type: "string" }, every: { type: "string" }, at: { type: "string" }, sheet: { type: "boolean" }, columns: { type: "string" }, scale: { type: "string" }, save: { type: "string" }, rom: { type: "string" }, seed: { type: "string" }, out: { type: "string" }, help: { type: "boolean" } },
  });
  if (values.help) return console.log(USAGE);
  const presses = parsePresses(values.keys ?? "");
  const lastPress = Math.max(0, ...presses.map((press) => press.frame + press.hold));
  const last = whole(values.frames, "frames", lastPress + FRAMES_AFTER_LAST_PRESS);
  const every = values.every === undefined ? null : whole(values.every, "every", 0) || null;
  const at = (values.at ?? "").split(",").filter(Boolean).map((frame) => whole(frame, "at", 0));
  const scale = Math.max(1, whole(values.scale, "scale", 1));
  const startSave = values.save ? resolve(values.save) : START_SAVE;
  if (!(await Bun.file(startSave).exists())) throw new Error(`${startSave} not found`);
  const out = values.out ? resolve(values.out) : join(CACHE_DIR, "shots");
  await mkdir(out, { recursive: true });

  const run = await Run.open({ startSave, romName: values.rom ?? ROM_NAME, seed: values.seed === undefined ? undefined : Number(values.seed) });
  const wanted = new Set(shotFrames(last, every, at));
  const shots: { image: Image; number: number }[] = [];
  try {
    for (let frame = 0; frame < last; frame++) {
      run.runFrame(keysAt(presses, frame));
      if (!wanted.has(frame + 1)) continue;
      const image = scaled({ width: run.core.width, height: run.core.height, rgba: run.core.screen().slice() }, scale);
      const file = join(out, `frame-${String(frame + 1).padStart(6, "0")}.png`);
      await Bun.write(file, encodePng(image));
      shots.push({ image, number: frame + 1 });
      console.log(file);
    }
  } finally {
    run.core.close();
  }
  if (values.sheet) {
    const file = join(out, "sheet.png");
    await Bun.write(file, encodePng(contactSheet(shots, Math.max(1, whole(values.columns, "columns", DEFAULT_COLUMNS)))));
    console.log(file);
  }
}

if (import.meta.main)
  await main(process.argv.slice(2)).catch((error: unknown) => {
    console.error(errorText(error));
    process.exit(1);
  });
