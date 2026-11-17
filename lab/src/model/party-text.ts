import type { BagPocket } from "../bag";
import { type BoxMon, type PartyMon, type PartyMove, type Status, statLabel } from "../party";

export function monName({ nickname, species }: Pick<PartyMon, "nickname" | "species">): string {
  return nickname === species ? species : `${nickname} (${species})`;
}

export function boxMonText(mon: BoxMon): string {
  return `${monName(mon)} level ${mon.level}, ${mon.boxName}`;
}

export function itemText({ name, quantity, move }: { name: string; quantity: number; move?: string }): string {
  return `${name}${move ? ` ${move}` : ""} ×${quantity}`;
}

export function partyText(party: PartyMon[], moveAbout: (move: PartyMove) => string, statusAbout: (status: Status) => Status): string {
  if (party.length === 0) return "Party: none.";
  const mon = (m: PartyMon, slot: number) => {
    const about = [
      `${slot + 1}. ${monName(m)}: level ${m.level}, HP ${m.hp}/${m.maxHp}, status ${statusAbout(m.status)}`,
      `Type ${m.types.join(", ")}`,
      `Ability ${m.ability.name}: ${m.ability.description.replace(/\.$/, "")}`,
      `Held item ${m.heldItem ? `${m.heldItem.name}: ${m.heldItem.description.replace(/\.$/, "")}` : "none"}`,
      `Nature ${m.nature}`,
      `Stats: ${statsText(m.stats)}`,
      `EXP ${m.exp}, ${m.expToNextLevel} to the next level.`,
    ];
    return [about.join(". "), ...m.moves.map((move) => `  - ${move.name}: ${moveAbout(move)}. ${move.description}`)].join("\n");
  };
  return ["Party:", ...party.map(mon)].join("\n");
}

export function bagText(bag: BagPocket[]): string {
  if (bag.length === 0) return "Bag: empty.";
  const pocket = ({ pocket, items }: BagPocket) => `- ${pocket}: ${items.map((i) => `${itemText(i)} (${i.description})`).join(", ")}`;
  return ["Bag:", ...bag.map(pocket)].join("\n");
}

function moveFacts(move: PartyMove): string {
  return `${move.type}, power ${move.power ?? "---"}, accuracy ${move.accuracy ?? "---"}`;
}

export function moveAtMaxPp(move: PartyMove): string {
  return `${moveFacts(move)}, max PP ${move.maxPp}`;
}

export function moveText(move: PartyMove): string {
  return `${moveFacts(move)}, PP ${move.pp}/${move.maxPp}`;
}

export function statsText(stats: Record<string, number>): string {
  return Object.entries(stats)
    .map(([stat, value]) => `${statLabel(stat)} ${value}`)
    .join(", ");
}

export function monPlace(party: PartyMon[], slot: number): string {
  return `${slot + 1} ${party[slot].nickname}`;
}

/** The help for `<Pokémon>`, with a space before it. No help when there is no place to name. */
export function pokemonHelp(party: PartyMon[], slots: Iterable<number> = party.keys()): string {
  const mons = [...slots].map((slot) => monPlace(party, slot));
  if (mons.length === 0) return "";
  return ` <Pokémon> can be ${mons.join(", ")}. Write its place in the party, its name, or both, for example ${mons[0]}.`;
}
