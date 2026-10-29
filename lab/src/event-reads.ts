import type { Game } from "./game";
import { bitAt, type Memory } from "./memory";
import { nameAt, PARTY_SIZE, readWatchedParty, SPECIES_NONE, type WatchedMon } from "./party";
import type { Decode } from "./prompts";

export const TRAINER_FLAGS_START = 0x500;
export const TRAINER_FLAGS_COUNT = 768;
export const FLAG_HIDDEN_ITEMS_START = 0x3e8;
export const FLAG_HIDDEN_ITEMS_COUNT = 200;
// TRAINER_CLASS_RIVAL_EARLY, TRAINER_CLASS_RIVAL_LATE and TRAINER_CLASS_CHAMPION: the name of these trainers is the name that the player gave to the rival.
const RIVAL_CLASSES = new Set([81, 89, 90]);
const B_OUTCOME_CAUGHT = 7;
const BATTLE_TYPE_TRAINER = 1 << 3;
// BATTLE_TYPE_OLD_MAN_TUTORIAL and BATTLE_TYPE_POKEDUDE.
const TUTORIAL_BATTLES = (1 << 9) | (1 << 16);

// A map load moves the save blocks, and a frame can end in the middle of the copy.
export type EventKeys = { blocks: string; money: number; party: Uint8Array; items: Uint8Array; flags: Uint8Array };

/** The reads of the game that only the Game events use. */
export class EventReads {
  constructor(
    private readonly game: Game,
    private readonly mem: Memory,
    private readonly decode: Decode,
    private readonly itemBallFlags: readonly number[],
  ) {}

  keys(): EventKeys {
    const block = this.mem.global("gSaveBlock1Ptr").deref();
    // The item PC and the five pockets of the Bag follow each other in SaveBlock1.
    const first = block.field("pcItems");
    const last = block.field("bagPocket_Berries");
    const block2 = this.mem.global("gSaveBlock2Ptr");
    return {
      blocks: `${this.mem.global("gSaveBlock1Ptr").pointer()} ${block2.pointer()} ${block2.deref().field("encryptionKey").int()}`,
      money: this.game.money(),
      party: this.mem.global("gPlayerParty").bytes(),
      items: this.mem.bus.read(first.addr, last.addr + last.size - first.addr),
      flags: block.field("flags").bytes(),
    };
  }

  playerParty(): WatchedMon[] | null {
    return readWatchedParty(this.mem, this.decode, "gPlayerParty", Math.min(this.mem.global("gPlayerPartyCount").int(), PARTY_SIZE));
  }

  enemyParty(): WatchedMon[] | null {
    return readWatchedParty(this.mem, this.decode, "gEnemyParty", PARTY_SIZE);
  }

  enemyPartyBytes(): Uint8Array {
    return this.mem.global("gEnemyParty").bytes();
  }

  flagChanges(before: Uint8Array, after: Uint8Array): { trainers: number[]; itemBall: boolean } {
    const set = (id: number) => bitAt(before, id) === 0 && bitAt(after, id) === 1;
    const trainers = Array.from({ length: TRAINER_FLAGS_COUNT }, (_, i) => i).filter((i) => set(TRAINER_FLAGS_START + i));
    return { trainers, itemBall: this.itemBallFlags.some(set) };
  }

  trainerName(id: number): string {
    const trainer = this.mem.global("gTrainers").at(id);
    const trainerClass = trainer.field("trainerClass").int();
    const name = RIVAL_CLASSES.has(trainerClass) ? this.game.rivalName() : this.decode(trainer.field("trainerName").bytes());
    return `${this.decode(this.mem.global("gTrainerClassNames").at(trainerClass).bytes())} ${name}`;
  }

  // The script of a hidden item sets its flag only after its text.
  hiddenItemPickup(): string | null {
    const flag = this.mem.global("gSpecialVar_0x8004").int();
    if (flag < FLAG_HIDDEN_ITEMS_START || flag >= FLAG_HIDDEN_ITEMS_START + FLAG_HIDDEN_ITEMS_COUNT || this.game.flag(flag)) return null;
    return this.decode(this.mem.global("gItems").at(this.mem.global("gSpecialVar_0x8005").int()).field("name").bytes());
  }

  // The buy list puts the item in the Bag first, and takes the money after its text.
  buying(): boolean {
    return this.game.context().callback2 === "CB2_BuyMenu";
  }

  // The game sets the type of a battle before its start screen.
  trainerBattle(): boolean {
    return (this.mem.global("gBattleTypeFlags").int() & BATTLE_TYPE_TRAINER) !== 0;
  }

  // A tutorial battle leaves its outcome in memory with species 0 up to the next battle: that is not a catch.
  caughtSpecies(): string | null {
    if (this.mem.global("gBattleOutcome").int() !== B_OUTCOME_CAUGHT || this.mem.global("gBattleTypeFlags").int() & TUTORIAL_BATTLES) return null;
    const species = this.mem.global("gBattleResults").field("caughtMonSpecies").int();
    return species === SPECIES_NONE ? null : nameAt(this.mem, "gSpeciesNames", species, this.decode);
  }
}
