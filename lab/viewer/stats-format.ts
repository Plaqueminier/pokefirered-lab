import { REFLECTION_EVERY } from "../src/model/decision";
import { GBA_FPS } from "../src/protocol";
import type { Tone } from "./components";

export type StuckLevel = "low" | "mid" | "high";

export function stuckLevel(stuck: number): StuckLevel {
  if (stuck < REFLECTION_EVERY / 3) return "low";
  return stuck < (2 * REFLECTION_EVERY) / 3 ? "mid" : "high";
}

const STUCK_TONES: Record<StuckLevel, Tone> = { low: "ok", mid: "warn", high: "bad" };

export function stuckTone(stuck: number): Tone {
  return STUCK_TONES[stuckLevel(stuck)];
}

/** The game time of a Race, always with the hours: h:mm:ss. */
export function raceTime(frames: number): string {
  const total = Math.floor(frames / GBA_FPS);
  const minutes = Math.floor(total / 60);
  return `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

export function clock(frame: number): string {
  const seconds = Math.round(frame / GBA_FPS);
  const minutes = Math.floor(seconds / 60);
  const mmss = `${String(minutes % 60).padStart(minutes >= 60 ? 2 : 1, "0")}:${String(seconds % 60).padStart(2, "0")}`;
  return minutes >= 60 ? `${Math.floor(minutes / 60)}:${mmss}` : mmss;
}

export function spanText({ from, to }: { from: number; to: number }): string {
  return `${clock(from)} → ${clock(to)} (${clock(to - from)})`;
}
