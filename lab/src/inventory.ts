import type { BagItem, PocketName } from "./bag";
import { safely } from "./game";
import type { PcItem } from "./pc";

export type Inventory = { bag: { pocket: PocketName; items: Pick<BagItem, "name" | "quantity" | "description">[] }[]; pc: { items: PcItem[]; pokemon: string[] } };

export type InventoryAt = { frame: number; inventory: Inventory };

export type Place = PocketName | "pc-items" | "pc-pokemon";

export type Delta = { place: Place; name: string; change: number };

const READ_EVERY = 30;

// Before the save loads, or while the game moves its save block, a read gives wrong values: quantities above 999, unknown species, and values that the next read does not repeat.
function isCorrect({ bag, pc }: Inventory): boolean {
  return [...bag.flatMap((pocket) => pocket.items), ...pc.items].every((item) => item.quantity <= 999) && pc.pokemon.every((name) => !name.startsWith("#"));
}

/** The difference of the quantity of each item, and of the number of each species in the boxes. */
export function changes(before: Inventory, after: Inventory): Delta[] {
  const all = new Map<string, Delta>();
  const count = ({ bag, pc }: Inventory, sign: 1 | -1) => {
    const add = (place: Place, name: string, quantity: number) => {
      const key = `${place}/${name}`;
      all.set(key, { place, name, change: (all.get(key)?.change ?? 0) + sign * quantity });
    };
    for (const pocket of bag) for (const item of pocket.items) add(pocket.pocket, item.name, item.quantity);
    for (const item of pc.items) add("pc-items", item.name, item.quantity);
    for (const name of pc.pokemon) add("pc-pokemon", name, 1);
  };
  count(before, -1);
  count(after, 1);
  return [...all.values()].filter(({ change }) => change !== 0);
}

function same(a: Inventory, b: Inventory): boolean {
  return changes(a, b).length === 0;
}

/** An entry only when a quantity changes; a change counts when the next read agrees, at the frame of its first read. */
export class InventoryHistory {
  #pending: InventoryAt | null = null;

  constructor(
    readonly entries: InventoryAt[] = [],
    private end = -1,
  ) {}

  onFrame(frame: number, read: () => Inventory): void {
    if (frame % READ_EVERY === 0) this.add(frame, read);
  }

  private add(frame: number, read: () => Inventory): void {
    if (frame <= this.end) return;
    this.end = frame;
    const inventory = safely(read);
    if (!inventory || !isCorrect(inventory)) return;
    if (!this.#pending || !same(this.#pending.inventory, inventory)) {
      this.#pending = { frame, inventory };
      return;
    }
    const last = this.entries.at(-1);
    if (!last || !same(last.inventory, this.#pending.inventory)) this.entries.push(this.#pending);
  }

  /** A new history with the entries up to the frame: the frames after it will be read again. */
  until(frame: number): InventoryHistory {
    return new InventoryHistory(
      this.entries.filter((entry) => entry.frame <= frame),
      frame,
    );
  }
}
