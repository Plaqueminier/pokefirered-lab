import type { Areas, Milestone } from "../src/game";
import type { RunEvent } from "../src/harness/record";
import { clock } from "./stats-format";

export type TimelineKind = "milestone" | "faint" | "catch" | "evolution" | "trainer" | "heal" | "place" | "level" | "wild" | "purchase" | "item";

/** `end`: the end of a trainer battle. */
export type TimelineEvent = { frame: number; kind: TimelineKind; text: string; end?: number };

export const NO_GAME_EVENTS = "No Game events in this record";

export const MILESTONE_NAMES: Record<Milestone, string> = {
  "has-pokemon": "First Pokémon",
  "first-rival-battle": "Rival",
  pokedex: "Pokédex",
  "badge-1": "Brock",
  "badge-2": "Misty",
  "badge-3": "Lt. Surge",
  "badge-4": "Erika",
  "badge-5": "Koga",
  "badge-6": "Sabrina",
  "badge-7": "Blaine",
  "badge-8": "Giovanni",
};

function titleCase(name: string): string {
  return name.toLowerCase().replace(/(^|[\s.-])(\p{L})/gu, (_, before: string, letter: string) => before + letter.toUpperCase());
}

/** The Area of a map; a map with no Area in the table is its own Area, outside. */
export function areaOf(areas: Areas, map: string): { area: string; place: string | null } {
  return areas[map] ?? { area: map, place: null };
}

// `stay`: the number of the stay in an Area. `trainer`: what the start of the battle tells; a record without the format 1 does not tell it.
type Battle = { from: number; to: number | null; stay: number; area: string; trainer: boolean | undefined; name: string | null };

/** The Game events of a Run as the events of the Timeline: the levels and the wild battles of a stay in an Area make one event. */
export function timelineEvents(events: readonly RunEvent[], areas: Areas): TimelineEvent[] {
  const shown: TimelineEvent[] = [];
  const battles: Battle[] = [];
  const visited = new Set<string>();
  const levels = new Map<string, { event: TimelineEvent; from: number }>();
  let area = "";
  let stay = 0;
  for (const event of events) {
    switch (event.type) {
      case "map": {
        const next = areaOf(areas, event.map).area;
        if (next !== area) {
          area = next;
          stay++;
          levels.clear();
        }
        if (!visited.has(area)) {
          visited.add(area);
          shown.push({ frame: event.frame, kind: "place", text: area });
        }
        break;
      }
      case "milestone":
        shown.push({ frame: event.frame, kind: "milestone", text: MILESTONE_NAMES[event.milestone] ?? event.milestone });
        break;
      case "battle": {
        const last = battles.at(-1);
        if (event.state === "start") battles.push({ from: event.frame, to: null, stay, area, trainer: event.trainer, name: null });
        else if (last && last.to === null) last.to = event.frame;
        break;
      }
      // The flag of a trainer changes at the end of its battle, or just after it.
      case "trainer": {
        const last = battles.at(-1);
        if (last && last.trainer !== false && !last.name) last.name = event.trainer;
        else shown.push({ frame: event.frame, kind: "trainer", text: `Trainer battle: ${titleCase(event.trainer)}` });
        break;
      }
      case "faint":
        if (event.side === "player") shown.push({ frame: event.frame, kind: "faint", text: `${titleCase(event.species)} fainted` });
        break;
      case "catch":
        shown.push({ frame: event.frame, kind: "catch", text: `New Pokémon: ${titleCase(event.species)}` });
        break;
      case "level": {
        if (event.evolution) shown.push({ frame: event.frame, kind: "evolution", text: `${titleCase(event.species)} evolved into ${titleCase(event.evolution)}` });
        let level = levels.get(event.species);
        if (!level) {
          level = { event: { frame: event.frame, kind: "level", text: "" }, from: event.from };
          shown.push(level.event);
        }
        level.event.text = `${titleCase(event.species)} Lv ${level.from} → ${event.level}`;
        // After an evolution, the next levels of the Pokémon join the same event under its new name.
        levels.delete(event.species);
        levels.set(event.evolution ?? event.species, level);
        break;
      }
      case "heal": {
        const text = event.source === "center" ? "Healed at the Pokémon Center" : event.item ? `Healed with ${event.item}` : "Healed";
        shown.push({ frame: event.frame, kind: "heal", text });
        break;
      }
      case "purchase":
        shown.push({ frame: event.frame, kind: "purchase", text: `Bought ${event.count} × ${event.item}` });
        break;
      case "item":
        shown.push({ frame: event.frame, kind: "item", text: `Got ${event.count > 1 ? `${event.count} × ` : ""}${event.item}` });
        break;
    }
  }
  const wild = new Map<number, { event: TimelineEvent; count: number }>();
  for (const battle of battles) {
    const time = battle.to === null ? "" : ` (${clock(battle.to - battle.from)})`;
    if (battle.name || battle.trainer) {
      const text = `Trainer battle${battle.name ? `: ${titleCase(battle.name)}` : ""}${time}`;
      shown.push({ frame: battle.from, kind: "trainer", text, end: battle.to ?? undefined });
      continue;
    }
    const group = wild.get(battle.stay) ?? { event: { frame: battle.from, kind: "wild", text: "" }, count: 0 };
    if (group.count === 0) shown.push(group.event);
    group.count++;
    wild.set(battle.stay, group);
    group.event.text = `${group.count} wild battle${group.count > 1 ? "s" : ""} in ${battle.area}`;
  }
  return shown.sort((a, b) => a.frame - b.frame);
}
