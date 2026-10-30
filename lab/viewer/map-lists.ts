import type { MapActors, MapGrid } from "../src/game";
import type { Tone } from "./components";
import { howLabel, STOP_LABEL, type StopState, triggerState } from "./mapdraw";

export type ExitRow = { key: string; edge: boolean; cell: string; to: string; tip: string; group: number; num: number };

export function exitList(grid: MapGrid): { count: number; rows: ExitRow[] } {
  const rows: ExitRow[] = grid.connections.map((c) => ({
    key: `edge-${c.direction}`,
    edge: true,
    cell: c.direction,
    to: c.map,
    tip: `${c.direction} edge → ${c.map} · walk past the edge`,
    group: c.group,
    num: c.num,
  }));
  const byMap = new Map<string, MapGrid["warps"]>();
  for (const w of grid.warps) {
    const key = `${w.group}.${w.num}`;
    byMap.set(key, [...(byMap.get(key) ?? []), w]);
  }
  for (const [key, warps] of byMap) {
    const [w] = warps;
    const many = warps.length > 1;
    rows.push({
      key: `warp-${key}`,
      edge: false,
      cell: many ? `${warps.length} warps` : `${w.x}, ${w.y}`,
      to: w.to,
      tip: many ? `${warps.length} warps → ${w.to}: ${warps.map((x) => `${x.x}, ${x.y}`).join(" · ")}` : `${w.x}, ${w.y} → ${w.to} · ${howLabel(w)}`,
      group: w.group,
      num: w.num,
    });
  }
  return { count: grid.connections.length + grid.warps.length, rows };
}

const STOP_TONE: Partial<Record<StopState, Tone>> = { active: "warn", "not-beaten": "bad" };

const TRIGGER_GROUP = { inactive: "Inactive triggers", unknown: "Unknown triggers" } as const;

export type StopRow = { type: "row"; key: string; x: number; y: number; text: string; kind: StopState; state: string; tone?: Tone; tip: string };

export type StopGroup = { type: "group"; key: string; text: string; rows: StopRow[] };

function stopRow(key: string, x: number, y: number, text: string, what: string, kind: StopState): StopRow {
  const label = STOP_LABEL[kind];
  return { type: "row", key, x, y, text, kind, state: label, tone: STOP_TONE[kind], tip: `${what} · ${label} · click: show it on the map` };
}

export function stopList(grid: MapGrid, actors: MapActors | null): { count: number; items: (StopRow | StopGroup)[] } {
  const triggers = grid.triggers.flatMap((t, i) => {
    if (t.weather) return [];
    return [stopRow(`trigger-${i}`, t.x, t.y, "Trigger", `Trigger at ${t.x}, ${t.y}`, triggerState(actors?.triggers[i]))];
  });
  const trainers = (actors?.people ?? []).flatMap((p) =>
    p.trainer ? [stopRow(`trainer-${p.localId}`, p.x, p.y, `Trainer ${p.trainer.id}`, `Trainer ${p.trainer.id} at ${p.x}, ${p.y} · sight ${p.trainer.range}`, p.trainer.defeated ? "beaten" : "not-beaten")] : [],
  );
  const items: (StopRow | StopGroup)[] = [...triggers.filter((row) => row.kind === "active"), ...trainers];
  for (const [kind, text] of Object.entries(TRIGGER_GROUP)) {
    const rows = triggers.filter((row) => row.kind === kind);
    if (rows.length === 1) items.push(rows[0]);
    else if (rows.length > 1) items.push({ type: "group", key: `group-${kind}`, text, rows });
  }
  return { count: triggers.length + trainers.length, items };
}
