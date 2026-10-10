// Reads the DWARF debug info of a build (.elf) and gives the address and type of
// every global variable, plus the start address of every function.
// The result is cached next to the harness, keyed by the .elf modification time.
import { mkdir } from "node:fs/promises";
import { basename, join } from "node:path";

export type TypeId = string;

export type TypeInfo =
  | { k: "base"; name: string; size: number; signed: boolean }
  | { k: "ptr"; to: TypeId | null }
  | { k: "typedef"; name: string; to: TypeId | null }
  | { k: "cv"; to: TypeId | null }
  | { k: "struct" | "union"; name: string | null; size: number; members: Member[] }
  | { k: "array"; of: TypeId; counts: number[] }
  | { k: "enum"; name: string | null; size: number; values: Record<string, number> }
  | { k: "func" };

export type Member = { name: string | null; off: number; type: TypeId; bitSize?: number; bitOff?: number };

export type Global = { addr: number; type: TypeId; file: string };

export type Symbols = {
  types: Record<TypeId, TypeInfo>;
  globals: Record<string, Global>;
  /** Sorted by address: [address, name]. */
  functions: [number, string][];
};

const CACHE_VERSION = 4;

export async function loadSymbols(elfPath: string, cacheDir: string): Promise<Symbols> {
  const mtime = (await Bun.file(elfPath).stat()).mtimeMs;
  const cachePath = join(cacheDir, `${basename(elfPath)}.symbols.json`);
  const cached = Bun.file(cachePath);
  if (await cached.exists()) {
    const data = await cached.json();
    if (data.version === CACHE_VERSION && data.mtime === mtime) return data.symbols;
  }
  const symbols = await parseDwarf(elfPath);
  await mkdir(cacheDir, { recursive: true });
  await Bun.write(cachePath, JSON.stringify({ version: CACHE_VERSION, mtime, symbols }));
  return symbols;
}

type Die = {
  tag: string;
  depth: number;
  attrs: Record<string, string>;
  children: string[];
};

const DIE_RE = /^0x([0-9a-f]+):(\s+)(DW_TAG_\w+|NULL)/;
const ATTR_RE = /^\s+(DW_AT_\w+)\s+\((.*)\)$/;

async function parseDwarf(elfPath: string): Promise<Symbols> {
  const proc = Bun.spawn(["dwarfdump", "--debug-info", elfPath], { stdout: "pipe", stderr: "ignore" });
  const text = await new Response(proc.stdout).text();
  // dwarfdump exits with 1 on small errors in assembly units; the output is still complete.
  await proc.exited;
  if (!text.includes("DW_TAG_compile_unit")) throw new Error(`dwarfdump failed on ${elfPath}`);
  const elfSymbols = await readSymbolTable(elfPath);

  const dies = new Map<string, Die>();
  const stack: string[] = [];
  let current: Die | null = null;
  for (const line of text.split("\n")) {
    const head = DIE_RE.exec(line);
    if (head) {
      const depth = (head[2].length - 1) / 2;
      if (head[3] === "NULL") {
        current = null;
        continue;
      }
      const id = head[1];
      current = { tag: head[3], depth, attrs: {}, children: [] };
      dies.set(id, current);
      stack.length = depth;
      if (depth > 0) dies.get(stack[depth - 1])?.children.push(id);
      stack[depth] = id;
      continue;
    }
    if (!current) continue;
    const attr = ATTR_RE.exec(line);
    if (attr) {
      current.attrs[attr[1]] = attr[2];
    }
  }
  return buildSymbols(dies, elfSymbols);
}

/** Addresses from the ELF symbol table: also covers data defined in assembly (no debug info). */
async function readSymbolTable(elfPath: string): Promise<Map<string, number>> {
  const proc = Bun.spawn(["nm", elfPath], { stdout: "pipe", stderr: "ignore" });
  const text = await new Response(proc.stdout).text();
  await proc.exited;
  const out = new Map<string, number>();
  for (const line of text.split("\n")) {
    const m = /^([0-9a-f]{8}) [A-Za-z] (\S+)$/.exec(line);
    if (m) out.set(m[2], parseInt(m[1], 16));
  }
  return out;
}

function unquote(value: string): string {
  return value.startsWith('"') ? value.slice(1, -1) : value;
}

function ref(value: string | undefined): string | null {
  const m = value && /^0x([0-9a-f]+)/.exec(value);
  return m ? m[1] : null;
}

function num(value: string | undefined): number {
  if (value === undefined) return 0;
  const m = /^\(?(-?0x[0-9a-f]+|-?\d+)/.exec(value);
  return m ? Number(m[1]) : 0;
}

function buildSymbols(dies: Map<string, Die>, elfSymbols: Map<string, number>): Symbols {
  // Many compile units repeat the same types: map each repeated type to one id.
  const canonical = new Map<string, string>();
  const byKey = new Map<string, string>();
  const keyOf = (id: string, seen = new Set<string>()): string => {
    const die = dies.get(id);
    if (!die) return `?${id}`;
    const name = die.attrs.DW_AT_name ? unquote(die.attrs.DW_AT_name) : null;
    const to = ref(die.attrs.DW_AT_type);
    if (seen.has(id)) return `cycle:${name}`;
    seen.add(id);
    const target = () => (to ? keyOf(to, seen) : "void");
    switch (die.tag) {
      case "DW_TAG_base_type":
      case "DW_TAG_structure_type":
      case "DW_TAG_union_type":
      case "DW_TAG_enumeration_type":
        if (name) return die.tag === "DW_TAG_base_type" ? `${die.tag}:${name}:${num(die.attrs.DW_AT_byte_size)}` : `${die.tag}:${name}`;
        return `${die.tag}:anon:${die.children.map((c) => dies.get(c)?.attrs.DW_AT_name ?? "").join(",")}:${num(die.attrs.DW_AT_byte_size)}`;
      case "DW_TAG_typedef":
        return `typedef:${name}`;
      case "DW_TAG_array_type":
        return `array:${die.children.map((c) => num(dies.get(c)?.attrs.DW_AT_upper_bound ?? dies.get(c)?.attrs.DW_AT_count)).join("x")}:${target()}`;
      default:
        return `${die.tag}:${target()}`;
    }
  };
  const canon = (id: string | null): string | null => {
    if (!id) return null;
    let c = canonical.get(id);
    if (c) return c;
    const key = keyOf(id);
    c = byKey.get(key) ?? id;
    byKey.set(key, c);
    canonical.set(id, c);
    return c;
  };

  // A named struct can be only declared in a file ("struct Foo;"): use the full definition.
  for (const [id, die] of dies) {
    const named = die.tag === "DW_TAG_structure_type" || die.tag === "DW_TAG_union_type" || die.tag === "DW_TAG_enumeration_type";
    if (named && die.attrs.DW_AT_name && !die.attrs.DW_AT_declaration) {
      const key = `${die.tag}:${unquote(die.attrs.DW_AT_name)}`;
      if (!byKey.has(key)) byKey.set(key, id);
    }
  }

  const types: Record<TypeId, TypeInfo> = {};
  const addType = (rawId: string | null): TypeId | null => {
    const id = canon(rawId);
    if (!id || types[id]) return id;
    const die = dies.get(id);
    if (!die) return null;
    const name = die.attrs.DW_AT_name ? unquote(die.attrs.DW_AT_name) : null;
    const size = num(die.attrs.DW_AT_byte_size);
    const to = ref(die.attrs.DW_AT_type);
    switch (die.tag) {
      case "DW_TAG_base_type":
        types[id] = { k: "base", name: name ?? "?", size, signed: /signed_char|DW_ATE_signed\b/.test(die.attrs.DW_AT_encoding ?? "") };
        break;
      case "DW_TAG_pointer_type":
        types[id] = { k: "ptr", to: null };
        (types[id] as { to: TypeId | null }).to = addType(to);
        break;
      case "DW_TAG_typedef":
        types[id] = { k: "typedef", name: name ?? "?", to: null };
        (types[id] as { to: TypeId | null }).to = addType(to);
        break;
      case "DW_TAG_const_type":
      case "DW_TAG_volatile_type":
        types[id] = { k: "cv", to: null };
        (types[id] as { to: TypeId | null }).to = addType(to);
        break;
      case "DW_TAG_structure_type":
      case "DW_TAG_union_type": {
        const info: TypeInfo = { k: die.tag === "DW_TAG_union_type" ? "union" : "struct", name, size, members: [] };
        types[id] = info;
        for (const childId of die.children) {
          const child = dies.get(childId);
          if (!child || child.tag !== "DW_TAG_member") continue;
          const member: Member = {
            name: child.attrs.DW_AT_name ? unquote(child.attrs.DW_AT_name) : null,
            off: num(child.attrs.DW_AT_data_member_location),
            type: addType(ref(child.attrs.DW_AT_type)) ?? "void",
          };
          if (child.attrs.DW_AT_bit_size) {
            member.bitSize = num(child.attrs.DW_AT_bit_size);
            member.bitOff = num(child.attrs.DW_AT_data_bit_offset);
          }
          info.members.push(member);
        }
        break;
      }
      case "DW_TAG_array_type": {
        const counts = die.children
          .map((c) => dies.get(c))
          .filter((c) => c?.tag === "DW_TAG_subrange_type")
          .map((c) => (c!.attrs.DW_AT_count ? num(c!.attrs.DW_AT_count) : c!.attrs.DW_AT_upper_bound ? num(c!.attrs.DW_AT_upper_bound) + 1 : 0));
        types[id] = { k: "array", of: "void", counts };
        (types[id] as { of: TypeId }).of = addType(to) ?? "void";
        break;
      }
      case "DW_TAG_enumeration_type": {
        const values: Record<string, number> = {};
        for (const childId of die.children) {
          const child = dies.get(childId);
          if (child?.tag === "DW_TAG_enumerator") values[unquote(child.attrs.DW_AT_name)] = num(child.attrs.DW_AT_const_value);
        }
        types[id] = { k: "enum", name, size, values };
        break;
      }
      default:
        types[id] = { k: "func" };
    }
    return id;
  };

  const globals: Record<string, Global> = {};
  const functions: [number, string][] = [];
  const declarations = new Map<string, Die>();
  for (const die of dies.values()) {
    if (die.tag === "DW_TAG_variable") {
      const loc = /DW_OP_addr (0x[0-9a-f]+)\)?$/.exec(die.attrs.DW_AT_location ?? "");
      if (!loc) {
        if (die.attrs.DW_AT_declaration && die.attrs.DW_AT_name && die.attrs.DW_AT_type) {
          const name = unquote(die.attrs.DW_AT_name);
          if (!declarations.has(name)) declarations.set(name, die);
        }
        continue;
      }
      // A definition can point to its declaration for the name and type.
      const spec = dies.get(ref(die.attrs.DW_AT_specification) ?? "");
      const nameAttr = die.attrs.DW_AT_name ?? spec?.attrs.DW_AT_name;
      const typeAttr = die.attrs.DW_AT_type ?? spec?.attrs.DW_AT_type;
      if (!nameAttr || !typeAttr) continue;
      const name = unquote(nameAttr);
      const file = basename(unquote(die.attrs.DW_AT_decl_file ?? spec?.attrs.DW_AT_decl_file ?? ""));
      const entry = { addr: Number(loc[1]), type: addType(ref(typeAttr))!, file };
      // Two files can each have a static variable with the same name.
      const key = globals[name] && globals[name].addr !== entry.addr ? `${file}:${name}` : name;
      globals[key] = entry;
    } else if (die.tag === "DW_TAG_subprogram" && die.attrs.DW_AT_low_pc) {
      // Inlined or declared-first functions carry their name on the origin: (0x... "Name").
      const named = die.attrs.DW_AT_name ?? die.attrs.DW_AT_abstract_origin ?? die.attrs.DW_AT_specification;
      const name = named && /"(.*)"$/.exec(named)?.[1];
      if (name) functions.push([num(die.attrs.DW_AT_low_pc), name]);
    }
  }
  // Declared in C but defined in assembly (for example gMapGroups): address from the symbol table.
  for (const [name, die] of declarations) {
    const addr = elfSymbols.get(name);
    if (globals[name] || addr === undefined) continue;
    globals[name] = { addr, type: addType(ref(die.attrs.DW_AT_type))!, file: basename(unquote(die.attrs.DW_AT_decl_file ?? "")) };
  }
  functions.sort((a, b) => a[0] - b[0]);
  return { types, globals, functions };
}

/** Name of the function at this address (the Thumb bit is ignored). */
export function functionName(symbols: Symbols, address: number): string | null {
  const target = address & ~1;
  const list = symbols.functions;
  let lo = 0;
  let hi = list.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (list[mid][0] === target) return list[mid][1];
    if (list[mid][0] < target) lo = mid + 1;
    else hi = mid - 1;
  }
  return null;
}
