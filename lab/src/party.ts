import type { Memory, Ref } from "./memory";
import { IN_BOX_COUNT } from "./pc";
import { type Decode, oneLine } from "./prompts";

// SUBSTRUCT_CASE rows of GetSubstruct (pokemon.c): growth, attacks, EVs, misc positions per personality % 24.
const SUBSTRUCT_POSITIONS = ["0123", "0132", "0213", "0312", "0231", "0321", "1023", "1032", "2013", "3012", "2031", "3021", "1203", "1302", "2103", "3102", "2301", "3201", "1230", "1320", "2130", "3120", "2310", "3210"];
const SUBSTRUCT_SIZE = 12;
const MAX_MON_MOVES = 4;
export const MOVE_NONE = 0;
export const PARTY_SIZE = 6;
const GROWTH_HELD_ITEM = 2;
const GROWTH_EXPERIENCE = 4;
const GROWTH_PP_BONUSES = 8;
const ATTACKS_PP = 8;
// PokemonSubstruct3 (pokemon.h): isEgg is bit 30 and abilityNum is bit 31 of the u32 that holds the IVs.
const MISC_IV_WORD = 4;
const IS_EGG_BIT = 30;
const ABILITY_NUM_BIT = 31;
const NUM_NATURES = 25;
const MAX_LEVEL = 100;
const EXP_SIZE = 4;
const ITEM_NONE = 0;
export const SPECIES_NONE = 0;
// The Summary screen shows "---" for a power below 2 and for an accuracy of 0 (pokemon_summary_screen.c).
const MIN_SHOWN_POWER = 2;
const FIXED_DAMAGE_POWER = 1;
const MAX_STRING = 256;
// sHMMoves (pokemon.c): the learn-move flow refuses to forget them.
const HM_MOVES = new Set(["CUT", "FLY", "SURF", "STRENGTH", "FLASH", "ROCK SMASH", "WATERFALL", "DIVE"]);
const TMHM_WORD_BITS = 32;
const STAT_NAMES = ["attack", "defense", "speed", "spAttack", "spDefense"] as const;
// The order of STAT_ATK to STAT_EVASION (constants/pokemon.h).
export const STAGE_NAMES = [...STAT_NAMES, "accuracy", "evasion"] as const;
const STAT_LABELS: Record<string, string> = { spAttack: "special attack", spDefense: "special defense" };
// STATUS1_* (constants/battle.h); the game shows PSN for STATUS1_POISON and STATUS1_TOXIC_POISON.
const STATUS_BITS: [number, Status][] = [
  [0x07, "sleep"],
  [0x08 | 0x80, "poison"],
  [0x10, "burn"],
  [0x20, "freeze"],
  [0x40, "paralysis"],
];

export type Status = "none" | "sleep" | "poison" | "burn" | "freeze" | "paralysis";

export type Stats = Record<(typeof STAT_NAMES)[number], number>;

export type StageName = (typeof STAGE_NAMES)[number];

// effect: the EFFECT_* of the move (constants/battle_move_effects.h).
// fixedDamage: the power in the game is 1, so the move has its own damage rule (SEISMIC TOSS, DRAGON RAGE, SUPER FANG…).
export type PartyMove = { name: string; type: string; effect: number; power: number | null; fixedDamage?: true; accuracy: number | null; pp: number; maxPp: number; description: string };

export type PartyMon = {
  species: string;
  nickname: string;
  types: string[];
  ability: { name: string; description: string };
  heldItem: string | null;
  isEgg: boolean;
  nature: string;
  level: number;
  exp: number;
  levelExp: number;
  expToNextLevel: number;
  hp: number;
  maxHp: number;
  status: Status;
  stats: Stats;
  moves: PartyMove[];
};

export function readParty(mem: Memory, decode: Decode): PartyMon[] {
  const count = Math.min(mem.global("gPlayerPartyCount").int(), PARTY_SIZE);
  const party = mem.global("gPlayerParty");
  return Array.from({ length: count }, (_, i) => {
    const mon = party.at(i);
    const box = mon.field("box");
    const personality = box.field("personality").int();
    const { substructs, growth, attacks, misc } = decryptBox(box);
    const ivWord = substructs.getUint32(misc + MISC_IV_WORD, true);
    const species = substructs.getUint16(growth, true);
    const info = mem.global("gSpeciesInfo").at(species);
    const item = substructs.getUint16(growth + GROWTH_HELD_ITEM, true);
    const level = mon.field("level").int();
    const exp = substructs.getUint32(growth + GROWTH_EXPERIENCE, true);
    const expTable = mem.global("gExperienceTables").at(info.field("growthRate").int());
    const nextLevel = level < MAX_LEVEL ? expTable.at(level + 1).int() : exp;
    return {
      species: nameAt(mem, "gSpeciesNames", species, decode),
      nickname: decode(box.field("nickname").bytes()),
      types: speciesTypes(mem, species, decode),
      ability: monAbility(mem, decode, species, ivWord),
      heldItem: item === ITEM_NONE ? null : decode(mem.global("gItems").at(item).field("name").bytes()),
      isEgg: ((ivWord >>> IS_EGG_BIT) & 1) === 1,
      nature: textAt(mem, mem.global("gNatureNamePointers").at(personality % NUM_NATURES).pointer(), decode),
      level,
      exp,
      levelExp: expTable.at(level).int(),
      expToNextLevel: nextLevel - exp,
      hp: mon.field("hp").int(),
      maxHp: mon.field("maxHP").int(),
      status: statusOf(mon.field("status").int()),
      stats: readStats(mon),
      moves: monMoves(mem, decode, substructs, growth, attacks),
    };
  });
}

export function canLearnTmHm(mem: Memory, slot: number, tm: number): boolean {
  const box = mem.global("gPlayerParty").at(slot).field("box");
  const { substructs, growth } = decryptBox(box);
  const word = mem.global("sTMHMLearnsets").at(substructs.getUint16(growth, true)).at(Math.floor(tm / TMHM_WORD_BITS)).int();
  return ((word >>> (tm % TMHM_WORD_BITS)) & 1) === 1;
}

export type BoxMon = { box: number; boxName: string; position: number; species: string; nickname: string; level: number } & Pick<PartyMon, "types" | "ability" | "moves">;

function monMoves(mem: Memory, decode: Decode, substructs: DataView, growth: number, attacks: number): PartyMove[] {
  return readMoves(mem, decode, substructs.getUint8(growth + GROWTH_PP_BONUSES), (slot) => ({ move: substructs.getUint16(attacks + slot * 2, true), pp: substructs.getUint8(attacks + ATTACKS_PP + slot) }));
}

function monAbility(mem: Memory, decode: Decode, species: number, ivWord: number): PartyMon["ability"] {
  const ability = mem.global("gSpeciesInfo").at(species).field("abilities").at((ivWord >>> ABILITY_NUM_BIT) & 1).int();
  return { name: nameAt(mem, "gAbilityNames", ability, decode), description: textAt(mem, mem.global("gAbilityDescriptionPointers").at(ability).pointer(), decode) };
}

export type WatchedMon = { personality: number; species: string; nickname: string; level: number; hp: number; maxHp: number; status: Status; moves: string[] };

export function readWatchedParty(mem: Memory, decode: Decode, global: "gPlayerParty" | "gEnemyParty", count: number): WatchedMon[] | null {
  const party = mem.global(global);
  const watched: WatchedMon[] = [];
  for (let i = 0; i < count; i++) {
    const mon = party.at(i);
    const box = mon.field("box");
    const personality = box.field("personality").int();
    const { substructs, growth, attacks, valid } = decryptBox(box);
    if (!valid) return null;
    const species = substructs.getUint16(growth, true);
    if (species === SPECIES_NONE) continue;
    const moves = Array.from({ length: MAX_MON_MOVES }, (_, slot) => substructs.getUint16(attacks + slot * 2, true)).filter((move) => move !== MOVE_NONE);
    watched.push({
      personality,
      species: nameAt(mem, "gSpeciesNames", species, decode),
      nickname: decode(box.field("nickname").bytes()),
      level: mon.field("level").int(),
      hp: mon.field("hp").int(),
      maxHp: mon.field("maxHP").int(),
      status: statusOf(mon.field("status").int()),
      moves: moves.map((move) => nameAt(mem, "gMoveNames", move, decode)),
    });
  }
  return watched;
}

function checksum(substructs: DataView): number {
  let sum = 0;
  for (let offset = 0; offset < substructs.byteLength; offset += 2) sum += substructs.getUint16(offset, true);
  return sum & 0xffff;
}

export function readBoxMons(mem: Memory, decode: Decode): BoxMon[] {
  const storage = mem.global("gPokemonStoragePtr").deref();
  const boxes = storage.field("boxes");
  const first = boxes.at(0).at(0);
  const offset = (name: string) => first.field(name).addr - first.addr;
  const [personalityAt, otIdAt, checksumAt, secureAt, nicknameAt] = [offset("personality"), offset("otId"), offset("checksum"), offset("secure"), offset("nickname")];
  const nicknameSize = first.field("nickname").size;
  const boxNames = storage.field("boxNames");
  const expTables = mem.global("gExperienceTables");
  const expRowSize = expTables.at(0).size;
  // One read of all the boxes and of all the experience tables: 420 separate reads are slow.
  const raw = boxes.bytes();
  const view = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
  const expRaw = expTables.bytes();
  const expView = new DataView(expRaw.buffer, expRaw.byteOffset, expRaw.byteLength);
  const mons: BoxMon[] = [];
  for (let mon = 0; mon < raw.byteLength; mon += first.size) {
    const personality = view.getUint32(mon + personalityAt, true);
    const { substructs, growth, attacks, misc } = decryptMon(personality, view.getUint32(mon + otIdAt, true), view.getUint16(mon + checksumAt, true), raw.slice(mon + secureAt, mon + secureAt + SUBSTRUCT_SIZE * 4));
    const species = substructs.getUint16(growth, true);
    if (species === SPECIES_NONE) continue;
    const index = mon / first.size;
    const box = Math.floor(index / IN_BOX_COUNT);
    mons.push({
      box,
      boxName: decode(boxNames.at(box).bytes()),
      position: index % IN_BOX_COUNT,
      species: nameAt(mem, "gSpeciesNames", species, decode),
      nickname: decode(raw.slice(mon + nicknameAt, mon + nicknameAt + nicknameSize)),
      level: levelFromExp(expView, mem.global("gSpeciesInfo").at(species).field("growthRate").int() * expRowSize, substructs.getUint32(growth + GROWTH_EXPERIENCE, true)),
      types: speciesTypes(mem, species, decode),
      ability: monAbility(mem, decode, species, substructs.getUint32(misc + MISC_IV_WORD, true)),
      moves: monMoves(mem, decode, substructs, growth, attacks),
    });
  }
  return mons;
}

// A box Pokémon keeps no level: see GetLevelFromBoxMonExp in the decomp.
function levelFromExp(expTables: DataView, table: number, exp: number): number {
  let level = 1;
  while (level < MAX_LEVEL && expTables.getUint32(table + (level + 1) * EXP_SIZE, true) <= exp) level++;
  return level;
}

export function statLabel(stat: string): string {
  return STAT_LABELS[stat] ?? stat;
}

export function isDamageMove({ power, fixedDamage }: Pick<PartyMove, "power" | "fixedDamage">): boolean {
  return power !== null || fixedDamage === true;
}

export function isHmMove(move: string): boolean {
  return HM_MOVES.has(move);
}

/** The slots of the party that can enter a battle: not fainted, and not already in the battle. */
export function sendableSlots(party: PartyMon[], inBattle: (number | undefined)[]): number[] {
  return party.flatMap((mon, slot) => (mon.hp > 0 && !inBattle.includes(slot) ? [slot] : []));
}

export function readMoves(mem: Memory, decode: Decode, ppBonuses: number, slot: (slot: number) => { move: number; pp: number }): PartyMove[] {
  const moves: PartyMove[] = [];
  for (let i = 0; i < MAX_MON_MOVES; i++) {
    const { move, pp } = slot(i);
    if (move !== MOVE_NONE) moves.push(partyMove(mem, decode, move, pp, maxPp(mem, move, ppBonuses, i)));
  }
  return moves;
}

export function newMove(mem: Memory, decode: Decode, move: number): PartyMove {
  const pp = mem.global("gBattleMoves").at(move).field("pp").int();
  return partyMove(mem, decode, move, pp, pp);
}

function partyMove(mem: Memory, decode: Decode, move: number, pp: number, maxPp: number): PartyMove {
  const data = mem.global("gBattleMoves").at(move);
  const power = data.field("power").int();
  const accuracy = data.field("accuracy").int();
  return {
    name: nameAt(mem, "gMoveNames", move, decode),
    type: typeName(mem, data.field("type").int(), decode),
    effect: data.field("effect").int(),
    power: power >= MIN_SHOWN_POWER ? power : null,
    ...(power === FIXED_DAMAGE_POWER ? { fixedDamage: true as const } : {}),
    accuracy: accuracy === 0 ? null : accuracy,
    pp,
    maxPp,
    description: textAt(mem, mem.global("gMoveDescriptionPointers").at(move - 1).pointer(), decode),
  };
}

/** The decrypted substructs of a Pokémon and the offsets of the growth, attacks and misc substructs. */
export function decryptBox(box: Ref): DecryptedMon {
  return decryptMon(box.field("personality").int(), box.field("otId").int(), box.field("checksum").int(), box.field("secure").bytes(SUBSTRUCT_SIZE * 4));
}

/** `valid`: the substructs give the checksum of the box. SetBoxMonData changes a box before it writes the new checksum. */
type DecryptedMon = { substructs: DataView; growth: number; attacks: number; misc: number; valid: boolean };

// `secure` is changed in place. GetBoxMonData and SetBoxMonData (pokemon.c) decrypt a box in place, and a frame can end before they encrypt it again: then the bytes are already plain.
function decryptMon(personality: number, otId: number, boxChecksum: number, secure: Uint8Array): DecryptedMon {
  const key = (personality ^ otId) >>> 0;
  const substructs = new DataView(secure.buffer, secure.byteOffset, secure.byteLength);
  const plain = checksum(substructs) === boxChecksum;
  xorSecure(substructs, key);
  if (plain && checksum(substructs) !== boxChecksum) xorSecure(substructs, key);
  const valid = plain || checksum(substructs) === boxChecksum;
  const positions = SUBSTRUCT_POSITIONS[personality % SUBSTRUCT_POSITIONS.length];
  return { substructs, growth: Number(positions[0]) * SUBSTRUCT_SIZE, attacks: Number(positions[1]) * SUBSTRUCT_SIZE, misc: Number(positions[3]) * SUBSTRUCT_SIZE, valid };
}

function xorSecure(substructs: DataView, key: number): void {
  for (let offset = 0; offset < substructs.byteLength; offset += 4) substructs.setUint32(offset, (substructs.getUint32(offset, true) ^ key) >>> 0, true);
}

export function statusOf(status1: number): Status {
  return STATUS_BITS.find(([bits]) => status1 & bits)?.[1] ?? "none";
}

function maxPp(mem: Memory, move: number, ppBonuses: number, slot: number): number {
  const basePp = mem.global("gBattleMoves").at(move).field("pp").int();
  const ppUps = (ppBonuses >> (2 * slot)) & 3;
  return basePp + Math.floor((basePp * 20 * ppUps) / 100);
}

/** The name tables of the game have no name at id 0. */
export function nameAt(mem: Memory, table: string, id: number, decode: Decode): string {
  const names = mem.global(table);
  if (id < 1 || id >= names.length) return `#${id}`;
  return decode(names.at(id).bytes());
}

/** gTypeNames has a name at id 0: TYPE_NORMAL. */
export function typeName(mem: Memory, type: number, decode: Decode): string {
  const names = mem.global("gTypeNames");
  return type < names.length ? decode(names.at(type).bytes()) : `#${type}`;
}

export function speciesTypes(mem: Memory, species: number, decode: Decode): string[] {
  const types = mem.global("gSpeciesInfo").at(species).field("types");
  return [...new Set([0, 1].map((i) => types.at(i).int()))].map((type) => typeName(mem, type, decode));
}

/** The stats of a party Pokémon or of a battle Pokémon: the two structs have the same field names. */
export function readStats(mon: Ref): Stats {
  return Object.fromEntries(STAT_NAMES.map((name) => [name, mon.field(name).int()])) as Stats;
}

function textAt(mem: Memory, address: number, decode: Decode): string {
  return oneLine(decode(mem.bus.read(address, MAX_STRING)));
}
