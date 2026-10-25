// Typed reads of the game memory, from the debug info.
// Example: mem.global("gSaveBlock1Ptr").deref().field("pos").field("x").int()
import type { Global, Member, Symbols, TypeId, TypeInfo } from "./symbols";

export interface MemoryBus {
  read(address: number, length: number): Uint8Array;
}

/** The first index where `test` is true, for an array where `test` is false and then true. */
function firstIndex<T>(sorted: T[], test: (item: T) => boolean): number {
  let low = 0;
  let high = sorted.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (test(sorted[middle])) high = middle;
    else low = middle + 1;
  }
  return low;
}

export class Memory {
  #byAddress: Global[] | null = null;

  constructor(
    readonly bus: MemoryBus,
    readonly symbols: Symbols,
  ) {}

  global(name: string): Ref {
    const g = this.symbols.globals[name];
    if (!g) throw new Error(`unknown global ${name}`);
    return new Ref(this, g.addr, g.type);
  }

  /** The global with the highest address that is at or before `address`; of two globals at one address, the first one. */
  globalBefore(address: number): Ref | null {
    const sorted = (this.#byAddress ??= Object.values(this.symbols.globals).sort((a, b) => a.addr - b.addr));
    const after = firstIndex(sorted, (g) => g.addr > address);
    if (after === 0) return null;
    const best = sorted[firstIndex(sorted, (g) => g.addr >= sorted[after - 1].addr)];
    return new Ref(this, best.addr, best.type);
  }

  type(id: TypeId): TypeInfo {
    const t = this.symbols.types[id];
    if (!t) throw new Error(`unknown type ${id}`);
    return t;
  }

  /** Follows typedefs and const/volatile to the real type. */
  resolve(id: TypeId): TypeInfo {
    let t = this.type(id);
    while ((t.k === "typedef" || t.k === "cv") && t.to) t = this.type(t.to);
    return t;
  }

  sizeOf(id: TypeId): number {
    const t = this.resolve(id);
    switch (t.k) {
      case "base":
      case "struct":
      case "union":
      case "enum":
        return t.size;
      case "ptr":
        return 4;
      case "array":
        return t.counts.reduce((a, b) => a * b, 1) * this.sizeOf(t.of);
      default:
        return 0;
    }
  }

  u8(address: number): number {
    return this.bus.read(address, 1)[0];
  }

  u16(address: number): number {
    const b = this.bus.read(address, 2);
    return b[0] | (b[1] << 8);
  }

  u32(address: number): number {
    const b = this.bus.read(address, 4);
    return (b[0] | (b[1] << 8) | (b[2] << 16) | (b[3] << 24)) >>> 0;
  }
}

/** A bit field: `size` bits, starting `shift` bits after `addr`. */
type Bits = { size: number; shift: number };

export class Ref {
  constructor(
    readonly mem: Memory,
    readonly addr: number,
    readonly typeId: TypeId,
    readonly bits?: Bits,
  ) {}

  private member(m: Member): Ref {
    if (m.bitSize === undefined) return new Ref(this.mem, this.addr + m.off, m.type);
    // The bit offset counts from the start of the struct.
    return new Ref(this.mem, this.addr + Math.floor(m.bitOff! / 8), m.type, { size: m.bitSize, shift: m.bitOff! % 8 });
  }

  get info(): TypeInfo {
    return this.mem.resolve(this.typeId);
  }

  get size(): number {
    return this.mem.sizeOf(this.typeId);
  }

  field(name: string): Ref {
    const t = this.info;
    if (t.k !== "struct" && t.k !== "union") throw new Error(`.${name} on a ${t.k}`);
    const direct = t.members.find((m) => m.name === name);
    if (direct) return this.member(direct);
    // Members of anonymous inner structs and unions.
    for (const m of t.members) {
      if (m.name !== null) continue;
      try {
        return this.member(m).field(name);
      } catch {}
    }
    throw new Error(`no field ${name} in ${t.name ?? "anonymous"}`);
  }

  /** Element i of an array (first dimension), or of the memory a pointer points to. */
  at(i: number): Ref {
    const t = this.info;
    if (t.k === "array") {
      const inner = t.counts.length > 1 ? this.subArray(t) : t.of;
      return new Ref(this.mem, this.addr + i * this.mem.sizeOf(inner), inner);
    }
    if (t.k === "ptr" && t.to) return new Ref(this.mem, this.mem.u32(this.addr) + i * this.mem.sizeOf(t.to), t.to);
    throw new Error(`[${i}] on a ${t.k}`);
  }

  get length(): number {
    const t = this.info;
    return t.k === "array" ? t.counts[0] : 0;
  }

  deref(): Ref {
    return this.at(0);
  }

  /** The address stored in this pointer. */
  pointer(): number {
    return this.mem.u32(this.addr);
  }

  int(): number {
    if (this.bits) {
      const word = BigInt(this.mem.u32(this.addr));
      return Number((word >> BigInt(this.bits.shift)) & ((1n << BigInt(this.bits.size)) - 1n));
    }
    const t = this.info;
    const size = t.k === "base" || t.k === "enum" ? t.size : 4;
    const signed = t.k === "base" && t.signed;
    const raw = size === 1 ? this.mem.u8(this.addr) : size === 2 ? this.mem.u16(this.addr) : this.mem.u32(this.addr);
    if (!signed) return raw;
    const bits = size * 8;
    return raw >= 2 ** (bits - 1) ? raw - 2 ** bits : raw;
  }

  bytes(length = this.size): Uint8Array {
    return this.mem.bus.read(this.addr, length);
  }

  /** Plain JavaScript value, for display. Stops at maxDepth and at pointers. */
  value(maxDepth = 4): unknown {
    const t = this.info;
    switch (t.k) {
      case "base":
        return this.int();
      case "enum": {
        const v = this.int();
        return Object.entries(t.values).find(([, n]) => n === v)?.[0] ?? v;
      }
      case "ptr":
        return `0x${this.pointer().toString(16).padStart(8, "0")}`;
      case "array": {
        if (maxDepth <= 0) return `[${t.counts.join("x")}]`;
        const out: unknown[] = [];
        for (let i = 0; i < Math.min(this.length, 64); i++) out.push(this.at(i).value(maxDepth - 1));
        return out;
      }
      case "struct":
      case "union": {
        if (maxDepth <= 0) return `{${t.name ?? ""}}`;
        const out: Record<string, unknown> = {};
        for (const m of t.members) {
          out[m.name ?? `@${m.off}`] = this.member(m).value(maxDepth - 1);
        }
        return out;
      }
      default:
        return null;
    }
  }

  private subArray(t: Extract<TypeInfo, { k: "array" }>): TypeId {
    // Multi-dimensional arrays: a synthetic type for the inner dimensions.
    const id = `${this.typeId}/sub`;
    const types = this.mem.symbols.types;
    if (!types[id]) types[id] = { k: "array", of: t.of, counts: t.counts.slice(1) };
    return id;
  }
}
