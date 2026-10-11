import type { Memory } from "./memory";

// SUBSTRUCT_CASE rows of GetSubstruct (pokemon.c): growth, attacks, EVs, misc positions per personality % 24.
const SUBSTRUCT_POSITIONS = ["0123", "0132", "0213", "0312", "0231", "0321", "1023", "1032", "2013", "3012", "2031", "3021", "1203", "1302", "2103", "3102", "2301", "3201", "1230", "1320", "2130", "3120", "2310", "3210"];
const SUBSTRUCT_SIZE = 12;
const MAX_MON_MOVES = 4;
const PARTY_SIZE = 6;
const GROWTH_PP_BONUSES = 8;
const ATTACKS_PP = 8;
// STATUS1_* (constants/battle.h); the game shows PSN for STATUS1_POISON and STATUS1_TOXIC_POISON.
const STATUS_BITS: [number, Status][] = [
  [0x07, "sleep"],
  [0x08 | 0x80, "poison"],
  [0x10, "burn"],
  [0x20, "freeze"],
  [0x40, "paralysis"],
];

type Decode = (bytes: Uint8Array) => string;

export type Status = "none" | "sleep" | "poison" | "burn" | "freeze" | "paralysis";

export type PartyMove = { name: string; pp: number; maxPp: number };

export type PartyMon = { species: string; nickname: string; level: number; hp: number; maxHp: number; status: Status; moves: PartyMove[] };

export function readParty(mem: Memory, decode: Decode): PartyMon[] {
  const count = Math.min(mem.global("gPlayerPartyCount").int(), PARTY_SIZE);
  const party = mem.global("gPlayerParty");
  return Array.from({ length: count }, (_, i) => {
    const mon = party.at(i);
    const box = mon.field("box");
    const personality = box.field("personality").int();
    const substructs = decryptSubstructs(box.field("secure").bytes(SUBSTRUCT_SIZE * 4), (personality ^ box.field("otId").int()) >>> 0);
    const positions = SUBSTRUCT_POSITIONS[personality % SUBSTRUCT_POSITIONS.length];
    const growth = Number(positions[0]) * SUBSTRUCT_SIZE;
    const attacks = Number(positions[1]) * SUBSTRUCT_SIZE;
    const ppBonuses = substructs.getUint8(growth + GROWTH_PP_BONUSES);
    const moves: PartyMove[] = [];
    for (let slot = 0; slot < MAX_MON_MOVES; slot++) {
      const move = substructs.getUint16(attacks + slot * 2, true);
      if (move === 0) continue;
      moves.push({ name: nameAt(mem, "gMoveNames", move, decode), pp: substructs.getUint8(attacks + ATTACKS_PP + slot), maxPp: maxPp(mem, move, ppBonuses, slot) });
    }
    const status = mon.field("status").int();
    return {
      species: nameAt(mem, "gSpeciesNames", substructs.getUint16(growth, true), decode),
      nickname: decode(box.field("nickname").bytes()),
      level: mon.field("level").int(),
      hp: mon.field("hp").int(),
      maxHp: mon.field("maxHP").int(),
      status: STATUS_BITS.find(([bits]) => status & bits)?.[1] ?? "none",
      moves,
    };
  });
}

function decryptSubstructs(raw: Uint8Array, key: number): DataView {
  const words = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
  for (let offset = 0; offset < raw.byteLength; offset += 4) words.setUint32(offset, (words.getUint32(offset, true) ^ key) >>> 0, true);
  return words;
}

function maxPp(mem: Memory, move: number, ppBonuses: number, slot: number): number {
  const basePp = mem.global("gBattleMoves").at(move).field("pp").int();
  const ppUps = (ppBonuses >> (2 * slot)) & 3;
  return basePp + Math.floor((basePp * 20 * ppUps) / 100);
}

function nameAt(mem: Memory, table: string, id: number, decode: Decode): string {
  const names = mem.global(table);
  if (id <= 0 || id >= names.length) return `#${id}`;
  return decode(names.at(id).bytes());
}
