import type { EventKeys, EventReads } from "../event-reads";
import type { FieldMove, Game } from "../game";
import type { WatchedMon } from "../party";
import type { StateEntry } from "../protocol";
import type { RunEvent } from "./record";

type HealedMon = { species: string; before: number; after: number; maxHp: number };

export type StateEvent =
  | { type: "heal"; source: "center" | "item" | "other"; item: string | null; party: HealedMon[] }
  | { type: "purchase"; item: string; count: number; money: number }
  | { type: "item"; how: "found" | "received"; item: string; count: number }
  | { type: "catch"; species: string }
  | { type: "faint"; species: string; side: "player" | "enemy" }
  | { type: "level"; species: string; from: number; level: number; moves: string[]; evolution: string | null }
  | { type: "money"; before: number; after: number; cause: "purchase" | "sale" | "battle" | "whiteout" | "other" }
  | { type: "trainer"; trainer: string; id: number }
  | { type: "obstacle"; move: FieldMove; map: string; x: number; y: number; species: string }
  | { type: "flash"; map: string; species: string }
  | { type: "whiteout" };

const STATE_EVENT_TYPES: ReadonlySet<string> = new Set(["heal", "purchase", "item", "catch", "faint", "level", "money", "trainer", "obstacle", "flash", "whiteout"] satisfies StateEvent["type"][]);

export function isStateEvent<E extends { type: string }>(event: E): event is Extract<E, { type: StateEvent["type"] }> {
  return STATE_EVENT_TYPES.has(event.type);
}

/** The Game events that a record without the format 1 has: no state event, and no `trainer` in the start of a battle. */
export function withoutFormat(events: readonly RunEvent[]): RunEvent[] {
  return events.filter((event) => !isStateEvent(event)).map((event) => (event.type === "battle" && event.state === "start" ? { frame: event.frame, type: "battle", state: "start" } : event));
}

type Seen = { keys: EventKeys; party: WatchedMon[]; bag: Map<string, number>; pc: Map<string, number> };

type Mode = ReturnType<Game["mode"]>;

type Moment = { inBattle: boolean; whitingOut: boolean };

export class StateWatch {
  readonly #game: Game;
  readonly #reads: EventReads;
  readonly #battle = new BattleWatch();
  readonly #levels = new LevelWatch();
  readonly #pending = new PendingPurchase();
  #seen: Seen | null = null;
  #inBattle = false;
  #whitingOut = false;
  #blocks = "";
  // After an item heal, Task_PartyMenuModifyHP (party_menu.c) sets the HP back to the old HP and raises it by 1 at each frame up to the new HP: these frames are no heal. The start and the end of a battle forget them.
  readonly #itemHealTops = new Map<number, number>();

  constructor(game: Game) {
    this.#game = game;
    this.#reads = game.eventReads();
  }

  onFrame(mode: Mode): StateEvent[] {
    const inBattle = mode === "battle";
    const events: StateEvent[] = [];
    const whitingOut = mode === "other" && this.#game.whitingOut();
    if (whitingOut && !this.#whitingOut) events.push({ type: "whiteout" });
    this.#whitingOut = whitingOut;
    events.push(...this.#battle.onFrame(this.#reads, inBattle));
    const keys = this.#reads.keys();
    const moving = keys.blocks !== this.#blocks;
    this.#blocks = keys.blocks;
    const seen = this.#seen;
    if (moving) return events;
    if (!seen) {
      this.#seen = this.#read(keys, null);
      this.#levels.reset(this.#seen?.party ?? []);
      return events;
    }
    const partyChanged = !same(keys.party, seen.keys.party);
    if (partyChanged || keys.money !== seen.keys.money || !same(keys.items, seen.keys.items) || !same(keys.flags, seen.keys.flags)) {
      const now = this.#read(keys, seen);
      if (!now) return events;
      events.push(...this.#changes(seen, now, { inBattle, whitingOut }));
      this.#seen = now;
    }
    if (!inBattle && (partyChanged || this.#inBattle)) events.push(...this.#levels.events(this.#seen?.party ?? []));
    if (inBattle !== this.#inBattle) this.#itemHealTops.clear();
    this.#inBattle = inBattle;
    return events;
  }

  #read(keys: EventKeys, seen: Seen | null): Seen | null {
    const party = seen && same(keys.party, seen.keys.party) ? seen.party : this.#reads.playerParty();
    if (!party) return null;
    const itemsSame = seen !== null && same(keys.items, seen.keys.items);
    return {
      keys,
      party,
      bag: itemsSame ? seen.bag : counts(this.#game.bag().flatMap((pocket) => pocket.items)),
      pc: itemsSame ? seen.pc : counts(this.#game.pcItems()),
    };
  }

  #changes(before: Seen, after: Seen, moment: Moment): StateEvent[] {
    const reads = this.#reads;
    const bag = withoutTransfers(withoutTransfers(difference(before.bag, after.bag), difference(before.pc, after.pc)), difference(heldCounts(before.party), heldCounts(after.party)));
    const gained = [...bag].filter(([, count]) => count > 0);
    const spent = [...bag].filter(([, count]) => count < 0);
    const money = after.keys.money - before.keys.money;
    const flags = same(before.keys.flags, after.keys.flags) ? null : reads.flagChanges(before.keys.flags, after.keys.flags);
    const events: StateEvent[] = [];
    if (gained.length > 0 && (money < 0 || reads.buying())) this.#pending.remember(gained[0][0], gained[0][1]);
    else if (gained.length > 0) {
      const hidden = reads.hiddenItemPickup();
      for (const [item, count] of gained) events.push({ type: "item", how: flags?.itemBall || hidden === item ? "found" : "received", item, count });
    }
    const purchase = money < 0 ? this.#pending.take() : null;
    if (purchase) events.push({ type: "purchase", ...purchase, money: -money });
    if (money !== 0) events.push({ type: "money", before: before.keys.money, after: after.keys.money, cause: moneyCause(money, purchase !== null, spent.length > 0, moment) });
    const used = money === 0 ? (spent[0]?.[0] ?? null) : null;
    events.push(...this.#partyEvents(before.party, after.party, used, moment));
    for (const id of flags?.trainers ?? []) events.push({ type: "trainer", trainer: reads.trainerName(id), id });
    events.push(...this.#obstacleEvents(flags?.temporary ?? [], after.party));
    if (flags?.flash) events.push(...this.#flashEvent(after.party));
    return events;
  }

  #obstacleEvents(flags: number[], party: WatchedMon[]): StateEvent[] {
    return flags.flatMap((flag): StateEvent[] => {
      const obstacle = this.#game.obstacleRemovedBy(flag);
      const user = obstacle && party.find((mon) => mon.moves.includes(obstacle.move));
      return user ? [{ type: "obstacle", move: obstacle.move, map: this.#game.map().name, x: obstacle.x, y: obstacle.y, species: user.species }] : [];
    });
  }

  #flashEvent(party: WatchedMon[]): StateEvent[] {
    const slot = this.#game.flashUser();
    return slot === null ? [] : [{ type: "flash", map: this.#game.map().name, species: party[slot].species }];
  }

  // A level or an evolution adds the same HP to the HP and to the max HP: that is not a heal.
  #partyEvents(before: WatchedMon[], after: WatchedMon[], item: string | null, { inBattle, whitingOut }: Moment): StateEvent[] {
    const both = pairs(before, after);
    const events: StateEvent[] = both.flatMap(([old, mon]): StateEvent[] => (old.hp > 0 && mon.hp === 0 ? [{ type: "faint", species: old.species, side: "player" }] : []));
    const refilled = !item && both.filter(([old, mon]) => this.#refills(old, mon)).length > 0;
    const healed = both.some(([old, mon]) => mon.hp > 0 && (mon.hp - old.hp > Math.max(0, mon.maxHp - old.maxHp) || (old.hp > 0 && old.status !== "none" && mon.status === "none")));
    // In a battle, only an item heals: a move or the end of a status is not a heal. The whiteout heals the party, and the whiteout event tells it.
    if (!healed || refilled || whitingOut || (inBattle && !item)) return events;
    const source = item ? "item" : this.#game.map().name.includes("PokemonCenter") ? "center" : "other";
    if (item) for (const [old, mon] of both) if (mon.hp > old.hp) this.#itemHealTops.set(mon.personality, mon.hp);
    events.push({ type: "heal", source, item, party: both.map(([old, mon]) => ({ species: mon.species, before: old.hp, after: mon.hp, maxHp: mon.maxHp })) });
    return events;
  }

  /** A raise of the HP of the HP bar after an item heal: it ends at the HP of the heal. */
  #refills(old: WatchedMon, mon: WatchedMon): boolean {
    const top = this.#itemHealTops.get(mon.personality);
    if (top === undefined || mon.hp <= old.hp) return false;
    if (mon.hp >= top) this.#itemHealTops.delete(mon.personality);
    return mon.hp <= top;
  }
}

function moneyCause(change: number, purchase: boolean, sold: boolean, { inBattle, whitingOut }: Moment): Extract<StateEvent, { type: "money" }>["cause"] {
  if (purchase) return "purchase";
  if (change > 0 && sold) return "sale";
  if (inBattle) return "battle";
  return whitingOut ? "whiteout" : "other";
}

export class StateTrackWatch {
  readonly entries: StateEntry[] = [];
  readonly #reads: EventReads;
  readonly #team = new TeamWatch();
  #fight: FightWatch | null = null;

  constructor(game: Game) {
    this.#reads = game.eventReads();
  }

  onBattleChange(frame: number, underway: boolean): void {
    this.#fight = underway ? new FightWatch(this.#reads.battleOpponent()) : null;
    if (this.#fight) this.entries.push({ frame, ...this.#fight.first() });
  }

  onFrame(frame: number): void {
    this.entries.push(...this.#team.onFrame(this.#reads).map((entry) => ({ frame, ...entry })));
  }

  onBattleFrame(frame: number): void {
    const fight = this.#fight?.onFrame(this.#reads);
    if (fight) this.entries.push({ frame, ...fight });
  }
}

type NewEntry<K extends StateEntry["kind"]> = Omit<Extract<StateEntry, { kind: K }>, "frame">;

class Latest {
  #text: string;

  constructor(start: unknown) {
    this.#text = JSON.stringify(start);
  }

  changed(value: unknown): boolean {
    const text = JSON.stringify(value);
    if (text === this.#text) return false;
    this.#text = text;
    return true;
  }
}

class TeamWatch {
  #bytes: Uint8Array | null = null;
  readonly #team = new Latest([]);
  readonly #health = new Latest([]);

  onFrame(reads: EventReads): (NewEntry<"team"> | NewEntry<"health">)[] {
    const bytes = reads.partyStateBytes();
    if (this.#bytes && same(bytes, this.#bytes)) return [];
    const party = reads.playerParty();
    if (!party) return [];
    this.#bytes = bytes;
    const team = party.map(({ species, nickname, level, maxHp, moves }) => ({ species, nickname, level, maxHp, moves }));
    const health = party.map(({ hp, status }) => ({ hp, status }));
    const teamChanged = this.#team.changed(team);
    const healthChanged = this.#health.changed(health);
    return [...(teamChanged ? [{ kind: "team" as const, team }] : []), ...(healthChanged ? [{ kind: "health" as const, health }] : [])];
  }
}

class FightWatch {
  #bytes: Uint8Array | null = null;
  readonly #sides = new Latest(null);

  constructor(private readonly trainer: string | null) {}

  first(): NewEntry<"battle"> {
    return { kind: "battle", trainer: this.trainer, player: null, foe: null };
  }

  onFrame(reads: EventReads): NewEntry<"battle"> | null {
    const bytes = reads.battleStateBytes();
    if (this.#bytes && same(bytes, this.#bytes)) return null;
    this.#bytes = bytes;
    const player = reads.battleSide("player");
    const foe = reads.battleSide("foe");
    return player && foe && this.#sides.changed([player, foe]) ? { kind: "battle", trainer: this.trainer, player, foe } : null;
  }
}

// The faint of an enemy, and the catch.
class BattleWatch {
  #enemy: { key: Uint8Array; party: WatchedMon[] } | null = null;
  #caught = false;

  onFrame(reads: EventReads, inBattle: boolean): StateEvent[] {
    if (!inBattle) {
      this.#enemy = null;
      return [];
    }
    const events: StateEvent[] = [];
    const caught = reads.caughtSpecies();
    if (caught && !this.#caught) events.push({ type: "catch", species: caught });
    this.#caught = caught !== null;
    const key = reads.enemyPartyBytes();
    if (this.#enemy && same(key, this.#enemy.key)) return events;
    const party = reads.enemyParty();
    if (!party) return events;
    for (const [before, after] of this.#enemy ? pairs(this.#enemy.party, party) : []) {
      if (before.hp > 0 && after.hp === 0) events.push({ type: "faint", species: before.species, side: "enemy" });
    }
    this.#enemy = { key, party };
    return events;
  }
}

// The level and the evolution: the party outside a battle, against the party at the last check.
class LevelWatch {
  #party: WatchedMon[] = [];

  reset(party: WatchedMon[]): void {
    this.#party = party;
  }

  events(party: WatchedMon[]): StateEvent[] {
    const events = pairs(this.#party, party).flatMap(([old, mon]): StateEvent[] => {
      if (mon.level <= old.level && mon.species === old.species) return [];
      const evolution = mon.species === old.species ? null : mon.species;
      return [{ type: "level", species: old.species, from: old.level, level: mon.level, moves: mon.moves.filter((move) => !old.moves.includes(move)), evolution }];
    });
    this.#party = party;
    return events;
  }
}

// The buy list puts the item in the Bag in one frame, and takes the money in a later one.
class PendingPurchase {
  #item: { item: string; count: number } | null = null;

  remember(item: string, count: number): void {
    this.#item = { item, count };
  }

  take(): { item: string; count: number } | null {
    const item = this.#item;
    this.#item = null;
    return item;
  }
}

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

function heldCounts(party: readonly WatchedMon[]): Map<string, number> {
  return counts(party.flatMap(({ heldItem }) => (heldItem === null ? [] : [{ name: heldItem, quantity: 1 }])));
}

function withoutTransfers(bag: Map<string, number>, other: Map<string, number>): Map<string, number> {
  const left = new Map<string, number>();
  for (const [name, change] of bag) {
    const otherChange = other.get(name) ?? 0;
    const rest = Math.sign(otherChange) === -Math.sign(change) ? change - Math.sign(change) * Math.min(Math.abs(change), Math.abs(otherChange)) : change;
    if (rest !== 0) left.set(name, rest);
  }
  return left;
}

function pairs(before: WatchedMon[], after: WatchedMon[]): [WatchedMon, WatchedMon][] {
  return after.flatMap((mon): [WatchedMon, WatchedMon][] => {
    const old = before.find((o) => o.personality === mon.personality);
    return old ? [[old, mon]] : [];
  });
}
