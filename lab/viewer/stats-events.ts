import type { Areas } from "../src/game";
import type { RunEvent } from "../src/harness/record";
import { GBA_FPS } from "../src/protocol";
import type { Tone } from "./components";
import type { Span } from "./cursor";
import { money, signedMoney } from "./runs";
import { isInside } from "./stats-data";
import { areaOf, type TimelineEvent, timelineEvents } from "./timeline-events";

export type GameCounts = { heals: number; purchases: number; spent: number; catches: number; faints: number; trainers: number; whiteouts: number };

export function gameCounts(events: readonly RunEvent[], spans: readonly Span[]): GameCounts {
  const counts: GameCounts = { heals: 0, purchases: 0, spent: 0, catches: 0, faints: 0, trainers: 0, whiteouts: 0 };
  for (const event of events) {
    if (!isInside(spans, event.frame)) continue;
    switch (event.type) {
      case "heal":
        counts.heals++;
        break;
      case "purchase":
        counts.purchases++;
        counts.spent += event.money;
        break;
      case "catch":
        counts.catches++;
        break;
      case "faint":
        if (event.side === "player") counts.faints++;
        break;
      case "trainer":
        counts.trainers++;
        break;
      case "whiteout":
        counts.whiteouts++;
        break;
    }
  }
  return counts;
}

export type EventLine = TimelineEvent & { detail: string | null; tone?: Tone };

type Money = Extract<RunEvent, { type: "money" }>;

// The money of a trainer battle comes just before its end, often minutes after its start.
const MONEY_FRAMES = 60 * GBA_FPS;

// A party that is not full never shows 100 %.
const percent = (part: number, whole: number) => Math.min(part < whole ? 99 : 100, Math.round((100 * part) / Math.max(1, whole)));

function healDetail(party: Extract<RunEvent, { type: "heal" }>["party"]): string {
  const maxHp = party.reduce((sum, mon) => sum + mon.maxHp, 0);
  const before = party.reduce((sum, mon) => sum + mon.before, 0);
  const after = party.reduce((sum, mon) => sum + mon.after, 0);
  const up = party.filter((mon) => mon.before > 0).length;
  return `party ${up}/${party.length} up, ${percent(before, maxHp)} % HP → ${after >= maxHp ? "full" : `${percent(after, maxHp)} %`}`;
}

export function eventLines(events: readonly RunEvent[], areas: Areas): EventLine[] {
  const maps = events.filter((e) => e.type === "map");
  const byFrame = Map.groupBy(events, (e) => e.frame);
  const moneys = events.filter((e): e is Money => e.type === "money");
  const placeAt = (frame: number) => {
    const map = maps.findLast((m) => m.frame <= frame)?.map;
    return map === undefined ? null : areaOf(areas, map);
  };
  const lines = timelineEvents(events, areas).map((event): EventLine => {
    const where = placeAt(event.frame);
    const at = byFrame.get(event.frame) ?? [];
    switch (event.kind) {
      case "heal": {
        const heal = at.find((e) => e.type === "heal");
        if (heal?.type !== "heal") return { ...event, detail: null };
        const text = heal.source === "center" && where ? `Healed at ${where.area} Pokémon Center` : event.text;
        return { ...event, text, detail: healDetail(heal.party) };
      }
      case "purchase": {
        const purchase = at.find((e) => e.type === "purchase");
        return { ...event, detail: purchase?.type === "purchase" ? money(purchase.money) : null };
      }
      case "trainer": {
        // A trainer that the record does not pair with a battle has no end: its money is near the flag.
        const [from, to] = event.end === undefined ? [event.frame - MONEY_FRAMES, event.frame + MONEY_FRAMES] : [event.frame, event.end + MONEY_FRAMES];
        const won = moneys.find((m) => m.cause === "battle" && m.after > m.before && m.frame >= from && m.frame < to);
        return { ...event, detail: won ? signedMoney(won.after - won.before) : null };
      }
      case "faint":
      case "catch":
      case "wild":
        return { ...event, detail: where && (where.place ? `${where.area}, ${where.place}` : where.area) };
      default:
        return { ...event, detail: null };
    }
  });
  for (const event of events) {
    if (event.type !== "whiteout") continue;
    const lost = moneys.find((m) => m.cause === "whiteout" && Math.abs(m.frame - event.frame) < MONEY_FRAMES);
    lines.push({ frame: event.frame, kind: "faint", text: "Whiteout: the whole party fainted", detail: lost ? signedMoney(lost.after - lost.before) : null, tone: "bad" });
  }
  return lines.sort((a, b) => a.frame - b.frame);
}

function moneyAt(events: readonly RunEvent[], frame: number): number | null {
  let money: number | null = null;
  for (const event of events) {
    if (event.type !== "money") continue;
    if (event.frame > frame) return money ?? event.before;
    money = event.after;
  }
  return money;
}

export type SinceHeal = { frame: number; how: string; faints: number; trainers: number; money: number | null; change: number | null };

export function sinceHeal(events: readonly RunEvent[], at: number): SinceHeal | null {
  const heal = events.findLast((e) => e.type === "heal" && e.frame <= at);
  if (heal?.type !== "heal") return null;
  const between = events.filter((e) => e.frame > heal.frame && e.frame <= at);
  const now = moneyAt(events, at);
  const then = moneyAt(events, heal.frame);
  return {
    frame: heal.frame,
    how: heal.source === "center" ? "Pokémon Center" : heal.source === "item" ? (heal.item ?? "item") : "other",
    faints: between.filter((e) => e.type === "faint" && e.side === "player").length,
    trainers: between.filter((e) => e.type === "trainer").length,
    money: now,
    change: now !== null && then !== null ? now - then : null,
  };
}
