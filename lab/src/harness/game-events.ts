// The Game events that the Harness reads from the party, the Bag, the money and the flags, next to the map, battle and Milestone events.
import type { EventKeys, Game } from "../game";
import type { WatchedMon } from "../party";

type HealedMon = { species: string; before: number; after: number; maxHp: number };

/** `item`: the item of a heal with an item, else null. `party`: the HP of each Pokémon of the party before and after the heal. */
export type StateEvent =
  | { type: "heal"; source: "center" | "item" | "other"; item: string | null; party: HealedMon[] }
  | { type: "purchase"; item: string; count: number; money: number }
  | { type: "item"; how: "found" | "received"; item: string; count: number }
  | { type: "catch"; species: string }
  | { type: "faint"; species: string; side: "player" | "enemy" }
  /** `from`: the level before. `moves`: the moves learned since then. `evolution`: the new species, else null. */
  | { type: "level"; species: string; from: number; level: number; moves: string[]; evolution: string | null }
  | { type: "money"; before: number; after: number; cause: "purchase" | "sale" | "battle" | "whiteout" | "other" }
  | { type: "trainer"; trainer: string; id: number }
  | { type: "whiteout" };

export const STATE_EVENT_TYPES = ["heal", "purchase", "item", "catch", "faint", "level", "money", "trainer", "whiteout"] as const satisfies StateEvent["type"][];

type Seen = { keys: EventKeys; party: WatchedMon[]; bag: Map<string, number>; pc: Map<string, number> };

type Mode = ReturnType<Game["mode"]>;

/** Reads the full state only when its raw bytes change. A battle keeps its level events to its end, with all the moves learned in it. */
export class StateWatch {
  #seen: Seen | null = null;
  #levels: WatchedMon[] = [];
  #enemy: { key: Uint8Array; party: WatchedMon[] } | null = null;
  #inBattle = false;
  #caught = false;
  #whitingOut = false;
  #purchase: { item: string; count: number } | null = null;
  #blocks = "";

  constructor(private readonly game: Game) {}

  onFrame(mode: Mode): StateEvent[] {
    const inBattle = mode === "battle";
    const events: StateEvent[] = [];
    const whitingOut = mode === "other" && this.game.whitingOut();
    if (whitingOut && !this.#whitingOut) events.push({ type: "whiteout" });
    this.#whitingOut = whitingOut;
    if (inBattle) events.push(...this.battleEvents());
    else this.#enemy = null;
    const keys = this.game.eventKeys();
    const moving = keys.blocks !== this.#blocks;
    this.#blocks = keys.blocks;
    const seen = this.#seen;
    if (moving) return events;
    if (!seen) {
      this.#seen = this.read(keys, null);
      this.#levels = this.#seen?.party ?? [];
      return events;
    }
    const partyChanged = !same(keys.party, seen.keys.party);
    if (partyChanged || keys.money !== seen.keys.money || !same(keys.items, seen.keys.items) || !same(keys.flags, seen.keys.flags)) {
      const now = this.read(keys, seen);
      // The next frame reads the party again, when the game has encrypted it.
      if (!now) return events;
      events.push(...this.changes(seen, now, inBattle));
      this.#seen = now;
    }
    if (!inBattle && (partyChanged || this.#inBattle)) events.push(...this.levelEvents());
    this.#inBattle = inBattle;
    return events;
  }

  private read(keys: EventKeys, seen: Seen | null): Seen | null {
    const party = seen && same(keys.party, seen.keys.party) ? seen.party : this.game.watchedParty("player");
    if (!party) return null;
    const itemsSame = seen !== null && same(keys.items, seen.keys.items);
    return {
      keys,
      party,
      bag: itemsSame ? seen.bag : counts(this.game.bag().flatMap((pocket) => pocket.items)),
      pc: itemsSame ? seen.pc : counts(this.game.pcItems()),
    };
  }

  private battleEvents(): StateEvent[] {
    const events: StateEvent[] = [];
    // The outcome of the last battle stays in memory up to the start of the next one: only a change to a catch counts.
    const caught = this.game.caughtSpecies();
    if (caught && !this.#caught) events.push({ type: "catch", species: caught });
    this.#caught = caught !== null;
    const key = this.game.enemyPartyBytes();
    if (this.#enemy && same(key, this.#enemy.key)) return events;
    const party = this.game.watchedParty("enemy");
    if (!party) return events;
    for (const [before, after] of this.#enemy ? pairs(this.#enemy.party, party) : []) {
      if (before.hp > 0 && after.hp === 0) events.push({ type: "faint", species: before.species, side: "enemy" });
    }
    this.#enemy = { key, party };
    return events;
  }

  private changes(before: Seen, after: Seen, inBattle: boolean): StateEvent[] {
    const bag = withoutPcMoves(difference(before.bag, after.bag), difference(before.pc, after.pc));
    const gained = [...bag].filter(([, count]) => count > 0);
    const spent = [...bag].filter(([, count]) => count < 0);
    const money = after.keys.money - before.keys.money;
    const flags = same(before.keys.flags, after.keys.flags) ? null : this.game.flagChanges(before.keys.flags, after.keys.flags);
    const events: StateEvent[] = [];
    if (gained.length > 0 && (money < 0 || this.game.buying())) this.#purchase = { item: gained[0][0], count: gained[0][1] };
    else if (gained.length > 0) {
      const hidden = this.game.hiddenItemPickup();
      for (const [item, count] of gained) events.push({ type: "item", how: flags?.itemBall || hidden === item ? "found" : "received", item, count });
    }
    const purchase = money < 0 ? this.#purchase : null;
    if (purchase) {
      events.push({ type: "purchase", ...purchase, money: -money });
      this.#purchase = null;
    }
    if (money !== 0) {
      const cause = purchase ? "purchase" : money > 0 && spent.length > 0 ? "sale" : inBattle ? "battle" : this.#whitingOut ? "whiteout" : "other";
      events.push({ type: "money", before: before.keys.money, after: after.keys.money, cause });
    }
    const used = money === 0 ? (spent[0]?.[0] ?? null) : null;
    events.push(...this.partyEvents(before.party, after.party, inBattle, used));
    for (const id of flags?.trainers ?? []) events.push({ type: "trainer", trainer: this.game.trainerName(id), id });
    return events;
  }

  // A level or an evolution adds the same HP to the HP and to the max HP: that is not a heal.
  private partyEvents(before: WatchedMon[], after: WatchedMon[], inBattle: boolean, item: string | null): StateEvent[] {
    const both = pairs(before, after);
    const events: StateEvent[] = both.flatMap(([old, mon]): StateEvent[] => (old.hp > 0 && mon.hp === 0 ? [{ type: "faint", species: old.species, side: "player" }] : []));
    const healed = both.some(([old, mon]) => mon.hp > 0 && (mon.hp - old.hp > Math.max(0, mon.maxHp - old.maxHp) || (old.hp > 0 && old.status !== "none" && mon.status === "none")));
    // In a battle, only an item heals: a move or the end of a status is not a heal. The whiteout heals the party, and the whiteout event tells it.
    if (!healed || this.#whitingOut || (inBattle && !item)) return events;
    const source = item ? "item" : this.game.map().name.includes("PokemonCenter") ? "center" : "other";
    events.push({ type: "heal", source, item, party: both.map(([old, mon]) => ({ species: mon.species, before: old.hp, after: mon.hp, maxHp: mon.maxHp })) });
    return events;
  }

  private levelEvents(): StateEvent[] {
    const party = this.#seen?.party ?? [];
    const events = pairs(this.#levels, party).flatMap(([old, mon]): StateEvent[] => {
      if (mon.level <= old.level && mon.species === old.species) return [];
      const evolution = mon.species === old.species ? null : mon.species;
      return [{ type: "level", species: old.species, from: old.level, level: mon.level, moves: mon.moves.filter((move) => !old.moves.includes(move)), evolution }];
    });
    this.#levels = party;
    return events;
  }
}

// A plain loop: this compare runs at each frame.
function same(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

function counts(items: readonly { name: string; quantity: number }[]): Map<string, number> {
  const all = new Map<string, number>();
  for (const { name, quantity } of items) all.set(name, (all.get(name) ?? 0) + quantity);
  return all;
}

function difference(before: Map<string, number>, after: Map<string, number>): Map<string, number> {
  const changes = new Map<string, number>();
  for (const name of new Set([...before.keys(), ...after.keys()])) {
    const change = (after.get(name) ?? 0) - (before.get(name) ?? 0);
    if (change !== 0) changes.set(name, change);
  }
  return changes;
}

/** The changes of the Bag without the items that went to the item PC or came from it. */
function withoutPcMoves(bag: Map<string, number>, pc: Map<string, number>): Map<string, number> {
  const left = new Map<string, number>();
  for (const [name, change] of bag) {
    const pcChange = pc.get(name) ?? 0;
    const rest = Math.sign(pcChange) === -Math.sign(change) ? change - Math.sign(change) * Math.min(Math.abs(change), Math.abs(pcChange)) : change;
    if (rest !== 0) left.set(name, rest);
  }
  return left;
}

/** Each Pokémon that is in the two parties, by its personality. */
function pairs(before: WatchedMon[], after: WatchedMon[]): [WatchedMon, WatchedMon][] {
  return after.flatMap((mon): [WatchedMon, WatchedMon][] => {
    const old = before.find((o) => o.personality === mon.personality);
    return old ? [[old, mon]] : [];
  });
}
