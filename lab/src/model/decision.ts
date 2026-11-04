import { nicknamedSpecies } from "../menus";
import { type BagItem, battleItems, depositableItems, type ItemUse, sellableItems, type Teachable, walkItems } from "../bag";
import type { BattleState, Button, MacroAction, Observation, RawInput } from "../harness/harness";
import type { Decision, NodeRange, NodeSentence } from "../harness/record";
import { type BoxMon, type PartyMon, type PartyMove, sendableSlots } from "../party";
import type { PcItem } from "../pc";
import { Keys } from "../protocol";
import type { ShopItem } from "../shop";
import { atlasExtract, type AtlasView } from "./extract";
import { type Overworld, targetIndex, targetLetter } from "./targets";

// The text that the model writes returns in each prompt: a cap keeps the prompt small.
export const MAX_SENTENCE = 200;
/** The model bot gets a Reflection turn at each REFLECTION_EVERY more Decision points on the Stuck counter. */
export const REFLECTION_EVERY = 20;
export const REVIEW_EVERY = 20;
const MAX_REMOVED = 5;
export const REMOVE_RULE = `the numbers of the sentences of your Memory tree that are false now or useless, ${MAX_REMOVED} at most, or an empty list`;
const MAX_QUOTED_ACTION = 80;

const FIELDS = ["reason", "action", "mission", "objective", "note"] as const satisfies readonly (keyof Decision)[];

export const DECISION_SCHEMA = {
  type: "object",
  properties: {
    reason: { type: "string", description: "Why you choose this action, in one or two short sentences." },
    action: { type: "string", description: "Exactly one of the actions of the message, for example \"go B\"." },
    mission: { type: "string", description: "The story step that you work on, in one short sentence. Keep it until you reach it." },
    objective: { type: "string", description: "What you do now for your Mission, in one short sentence." },
    note: { type: "string", description: `A fact that the game proved, a lesson (what works, what fails and why), or a guess that starts with "Guess:", in one line of ${MAX_SENTENCE} characters at most, or an empty string. Never HP or PP values.` },
  },
  required: FIELDS,
  additionalProperties: false,
} as const;

export const REVIEW_SCHEMA = {
  ...DECISION_SCHEMA,
  properties: {
    ...DECISION_SCHEMA.properties,
    remove: { type: "array", items: { type: "integer" }, description: `Only at a review turn: ${REMOVE_RULE}.` },
  },
  required: [...DECISION_SCHEMA.required, "remove"],
};

/** The Macro-actions and the Raw input that the model can choose, and the actions that the code of the model bot plays: go, viewAtlas and zoom. */
export type ModelAction =
  | Exclude<MacroAction, { name: "interact" | "readText" | "walkOn" }>
  | RawInput
  | { name: "go"; target: number }
  | { name: "viewAtlas" }
  | ({ name: "zoom" } & NodeRange);

/** The actions that play in the game: viewAtlas and zoom only show more to the model. */
export type PlayedAction = Exclude<ModelAction, { name: "viewAtlas" | "zoom" }>;

export function isPlayed(action: ModelAction): action is PlayedAction {
  return action.name !== "viewAtlas" && action.name !== "zoom";
}

type BoxAction = Extract<MacroAction, { name: "depositPokemon" | "withdrawPokemon" }>;

type ActionVerb = Exclude<ModelAction["name"], BoxAction["name"]>;

const NAMES = { go: 0, goTo: 0, swap: 0, teach: 0, choose: 0, fight: 0, switch: 0, send: 0, run: 0, use: 0, buy: 0, sell: 0, withdraw: 0, deposit: 0, leave: 0, name: 0, forget: 0, keep: 0, press: 0, viewAtlas: 0, zoom: 0 } satisfies Record<ActionVerb, 0>;

/** All the names of the actions of the model. The type check fails when a new action is not in the list. */
export const MODEL_ACTION_NAMES = Object.keys(NAMES) as ActionVerb[];

export type Asked = { party: PartyMon[] } & (
  | { kind: "walk"; overworld: Overworld; view: AtlasView; atlasShown: boolean; items: BagItem[]; bagEmpty?: boolean }
  | ({ kind: "choice"; options: string[] } & ({ overworld: Overworld; storage?: number } | { battle: BattleState }))
  | { kind: "battleAction" | "battleMove" | "partyPick"; battle: BattleState; items: BagItem[]; bagEmpty?: boolean }
  | { kind: "shopMenu"; forSale: ShopItem[]; sellable: BagItem[] }
  | { kind: "itemPc"; pcItems: PcItem[]; depositable: BagItem[] }
  | { kind: "pokemonPc"; boxes: BoxMon[] }
  | { kind: "naming"; subject: string; maxLength: number; keys: string[] }
  | { kind: "learnMove"; slot: number; move: PartyMove }
);

export type AskedKind = Asked["kind"];

const ACTIONS: Record<AskedKind, ActionVerb[]> = {
  walk: ["go", "goTo", "swap", "use", "teach", "viewAtlas", "zoom", "press"],
  choice: ["choose", "zoom"],
  battleAction: ["fight", "switch", "run", "use", "zoom"],
  battleMove: ["fight", "zoom", "press"],
  partyPick: ["send", "zoom", "press"],
  shopMenu: ["buy", "sell", "leave", "zoom"],
  itemPc: ["withdraw", "deposit", "leave", "zoom"],
  pokemonPc: ["deposit", "withdraw", "leave", "zoom"],
  naming: ["name", "zoom"],
  learnMove: ["forget", "keep", "zoom"],
};

export function actionsOf(asked: Asked): ActionVerb[] {
  return ACTIONS[asked.kind].filter((name) => {
    switch (name) {
      case "viewAtlas":
        return !(asked.kind === "walk" && asked.atlasShown);
      case "swap":
        return asked.party.length > 1;
      case "switch":
      case "send":
        return sendable(asked).length > 0;
      case "use":
        return "items" in asked && asked.items.length > 0;
      case "teach":
        return asked.kind === "walk" && asked.overworld.teachables.length > 0;
      case "sell":
        return asked.kind === "shopMenu" && asked.sellable.length > 0;
      case "withdraw":
        return asked.kind === "pokemonPc" ? asked.boxes.length > 0 : asked.kind === "itemPc" && asked.pcItems.length > 0;
      case "deposit":
        return asked.kind === "pokemonPc" || (asked.kind === "itemPc" && asked.depositable.length > 0);
      default:
        return true;
    }
  });
}

export function sendable(asked: Asked): number[] {
  if (!("battle" in asked)) return [];
  return sendableSlots(asked.party, asked.battle.player.partyIndex);
}

const BUTTONS = Object.keys(Keys) as Button[];

/** Null when the game waits for no decision of the model: a text, or a busy game. */
export function askedOf(observation: Observation, atlasShown: boolean): Asked | null {
  const { waitingFor, party } = observation;
  const bagEmpty = observation.bag.every((pocket) => pocket.items.length === 0);
  if (waitingFor.kind === "learnMove") return { kind: "learnMove", party, slot: waitingFor.slot, move: waitingFor.move };
  if (observation.mode === "naming") return waitingFor.kind === "naming" ? { kind: "naming", party, subject: waitingFor.subject, maxLength: waitingFor.maxLength, keys: waitingFor.keys } : null;
  if (observation.mode === "overworld") {
    if (waitingFor.kind === "walk") return { kind: "walk", party, overworld: observation, view: atlasExtract(observation), atlasShown, items: walkItems(observation.bag), bagEmpty };
    if (waitingFor.kind === "shopMenu") return { kind: "shopMenu", party, forSale: waitingFor.items, sellable: sellableItems(observation.bag) };
    if (waitingFor.kind === "itemPc") return { kind: "itemPc", party, pcItems: waitingFor.items, depositable: depositableItems(observation.bag) };
    if (waitingFor.kind === "pokemonPc") return { kind: "pokemonPc", party, boxes: observation.boxes };
    return waitingFor.kind === "choice" ? { kind: "choice", party, overworld: observation, options: waitingFor.options, storage: waitingFor.storage } : null;
  }
  if (observation.mode === "menu") return null;
  const { battle } = observation;
  if (waitingFor.kind === "choice") return { kind: "choice", party, battle, options: waitingFor.options };
  const { kind } = waitingFor;
  return kind === "battleAction" || kind === "battleMove" || kind === "partyPick" ? { kind, party, battle, items: battleItems(observation.bag, battle.kind), bagEmpty } : null;
}

// Some models write a stray "{" line or a code fence before the object, and copy it again after the error.
export function readJson(content: string): unknown {
  try {
    return JSON.parse(content);
  } catch {}
  const end = content.lastIndexOf("}");
  for (let start = content.indexOf("{"); start !== -1 && start < end; start = content.indexOf("{", start + 1)) {
    try {
      return JSON.parse(content.slice(start, end + 1));
    } catch {}
  }
  throw new Error("the answer is not JSON");
}

export function readFields(content: string): Record<string, unknown> {
  if (content.trim() === "") throw new Error("the answer is empty");
  const value = readJson(content);
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error("the answer is not a JSON object");
  return value as Record<string, unknown>;
}

export function readDecision(content: string): Decision {
  const fields = readFields(content);
  const decision = {} as Decision;
  for (const field of FIELDS) {
    const text = fields[field];
    if (typeof text !== "string") throw new Error(`the answer has no string "${field}"`);
    decision[field] = text.trim();
  }
  return { ...decision, mission: decision.mission.slice(0, MAX_SENTENCE), objective: decision.objective.slice(0, MAX_SENTENCE) };
}

export function readRemoved(content: string, shown: readonly NodeSentence[]): NodeSentence[] {
  const { remove } = readFields(content);
  const numbers = new Set(Array.isArray(remove) ? remove.slice(0, MAX_REMOVED) : []);
  return shown.filter((_, index) => numbers.has(index + 1));
}

type QuantityName = "buy" | "sell" | "withdraw" | "deposit";

/** An action as the model writes it: the Pokémon, the item and the option are still texts. */
type Written =
  | { name: "go"; target: string }
  | { name: "switch" | "send" | "swap"; pokemon: string }
  | { name: "use"; item: string; on?: string }
  | { name: "teach"; item: string; on: string }
  | { name: QuantityName; item: string; quantity: number }
  | { name: "forget"; move: string };
type ParsedAction = Exclude<ModelAction, { name: Written["name"] | BoxAction["name"] }> | Written;

export function readAction(text: string, asked: Asked): ModelAction {
  const transfer = asked.kind === "pokemonPc" ? readBoxTransfer(text.trim(), asked) : null;
  if (transfer) return transfer;
  const action = parse(text.trim());
  const accepted = actionsOf(asked);
  if (!action) throw new Error(unreadable(text.trim(), accepted));
  if (!accepted.includes(action.name)) throw new Error(notNow(action.name, accepted));
  switch (action.name) {
    case "go": {
      const targets = asked.kind === "walk" ? asked.view.targets.length : 0;
      const index = targetIndex(action.target);
      if (index >= 0 && index < targets) return { name: "go", target: index };
      const known = targets === 0 ? "the map has no targets" : `the targets are ${index < 0 ? "letters, " : ""}A to ${targetLetter(targets - 1)}`;
      throw new Error(`there is no target ${quoted(action.target)}: ${known}`);
    }
    case "switch":
    case "send":
      return { name: action.name, slot: partySlot(action.pokemon, asked.party) };
    case "swap":
      return swapOf(action.pokemon, asked.party);
    case "choose": {
      if (asked.kind !== "choice") return action;
      const option = asked.options.find((o) => o.toLowerCase() === action.option.toLowerCase());
      if (!option) throw new Error(`"${quoted(action.option)}" is not an option: ${asked.options.join(", ")}`);
      return { name: "choose", option };
    }
    case "name": {
      const species = asked.kind === "naming" ? nicknamedSpecies(asked.subject) : null;
      const text = action.text.trim().toLowerCase();
      if (species && (text === "" || text === species.toLowerCase())) throw new Error(`a nickname must be a new name, not "${quoted(action.text)}": write name <text>, with a name that you invent`);
      return action;
    }
    case "use":
      return readUse(action.item, action.on, asked);
    case "teach":
      return readTeach(action.item, action.on, asked);
    case "buy":
    case "sell":
    case "withdraw":
    case "deposit":
      return readQuantity(action.name, action.item, action.quantity, asked);
    case "forget":
      return { name: "forget", move: forgotten(action.move, asked) };
    case "press":
      if (action.button === "Start") throw new Error(noStartMenu(asked));
      return action;
    default:
      return action;
  }
}

function noStartMenu(asked: Asked): string {
  const hint = "there is no Start menu: write use <item> to use an item of your Bag";
  if (!("items" in asked)) return hint;
  const teach = asked.kind === "walk" && asked.overworld.teachables.length > 0 ? "; write teach <TM or HM> on <Pokémon> for a TM or an HM" : "";
  if (asked.items.length > 0) return `${hint}; the items that work now: ${asked.items.map((i) => i.name).join(", ")}${teach}`;
  return `${hint}; ${asked.bagEmpty ? "your Bag is empty" : "your Bag has no item that works now"}${teach}`;
}

function forgotten(move: string, asked: Asked): string {
  if (asked.kind !== "learnMove") return move;
  const { moves } = asked.party[asked.slot];
  // A name or a place that is not a move of the Pokémon goes to the Harness, which gives the reason.
  const place = /^\d+$/.test(move) ? moves[Number(move) - 1] : undefined;
  return (place ?? moves.find((m) => plain(m.name) === plain(move)))?.name ?? move;
}

function readUse(name: string, writtenOn: string | undefined, asked: Asked): ModelAction {
  const items = "items" in asked ? asked.items : [];
  const [itemName, on] = writtenOn === undefined ? withoutOn(name, items) : [name, writtenOn];
  const item = items.find((i) => plain(i.name) === plain(itemName));
  const tm = asked.kind === "walk" ? asked.overworld.teachables.find((t) => plain(t.item) === plain(itemName)) : undefined;
  if (tm) throw new Error(`${tm.item} is a TM or an HM: write teach ${tm.item} on <Pokémon>`);
  if (!item) throw new Error(`"${quoted(name)}" is not an item that works now: ${items.map((i) => i.name).join(", ") || "none"}`);
  if (itemUse(item, asked) === "alone") {
    if (on !== undefined) throw new Error(`${item.name} does not work on a Pokémon: use ${item.name}`);
    return { name: "use", item: item.name };
  }
  if (on === undefined) throw new Error(`${item.name} works on a Pokémon: use ${item.name} on <Pokémon>`);
  return { name: "use", item: item.name, on: partySlot(on, asked.party) };
}

function readTeach(name: string, on: string, asked: Asked): ModelAction {
  const teachables = asked.kind === "walk" ? asked.overworld.teachables : [];
  const found = teachables.find((t) => plain(t.item) === plain(name) || plain(teachableName(t)) === plain(name));
  if (!found) throw new Error(`"${quoted(name)}" is not a TM or an HM of your Bag: ${teachables.map(teachableName).join(", ")}`);
  return { name: "teach", item: found.item, on: partySlot(on, asked.party) };
}

export function teachableName({ item, move }: Teachable): string {
  return `${item} (${move.name})`;
}

function withoutOn(written: string, items: BagItem[]): [item: string, on: string | undefined] {
  if (items.some((i) => plain(i.name) === plain(written))) return [written, undefined];
  const starts = items.filter((i) => written[i.name.length] === " " && plain(written.slice(0, i.name.length)) === plain(i.name));
  const item = starts.sort((a, b) => b.name.length - a.name.length)[0];
  return item ? [item.name, written.slice(item.name.length).trim()] : [written, undefined];
}

/** The items that a buy, a sell, a withdraw or a deposit can name, and where they are. */
function tradable(name: QuantityName, asked: Asked): { items: { name: string }[]; where: string } {
  switch (name) {
    case "buy":
      return { items: asked.kind === "shopMenu" ? asked.forSale : [], where: "for sale" };
    case "sell":
      return { items: asked.kind === "shopMenu" ? asked.sellable : [], where: "of your Bag that the Poké Mart buys" };
    case "withdraw":
      return { items: asked.kind === "itemPc" ? asked.pcItems : [], where: "in the PC" };
    case "deposit":
      return { items: asked.kind === "itemPc" ? asked.depositable : [], where: "of the ITEMS pocket of your Bag" };
  }
}

function readQuantity(name: QuantityName, item: string, quantity: number, asked: Asked): ModelAction {
  const { items, where } = tradable(name, asked);
  const found = items.find((i) => plain(i.name) === plain(item));
  if (!found) throw new Error(`"${quoted(item)}" is not an item ${where}: ${items.map((i) => i.name).join(", ") || "none"}`);
  return { name, item: found.name, quantity };
}

export function itemUse(item: BagItem, asked: Asked): ItemUse | null {
  return asked.kind === "walk" ? item.walk : item.battle;
}

function plain(text: string): string {
  return text.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase().trim();
}

// The separator of the arguments in the form action(a, b) or action a, b, as a written action: a space when the action is not here. A null keeps the text as one argument.
const ARGUMENT_SEPARATORS = new Map<string, string | null>([["use", " on "], ["teach", " on "], ["name", null], ["choose", null]]);

function withSpaces(action: string): string {
  const call = action.match(/^(\w+)\s*\((.*)\)$/) ?? (action.includes(",") ? action.match(/^(\w+)\s+(.*)$/) : null);
  if (!call) return action;
  const [, verb, args] = call;
  const separator = ARGUMENT_SEPARATORS.get(verb.toLowerCase());
  const written = separator === null ? args : args.split(",").map((arg) => arg.trim()).filter((arg) => arg !== "").join(separator ?? " ");
  return `${verb} ${written}`.trim();
}

const FORMS: Record<ActionVerb, [form: string, example: string]> = {
  go: ["go <letter>", "go B"],
  goTo: ["goTo <x> <y>", "goTo 9 42"],
  swap: ["swap <Pokémon> <Pokémon>", "swap 1 2"],
  choose: ["choose <option>", "choose YES"],
  fight: ["fight <0-3>", "fight 0"],
  switch: ["switch <Pokémon>", "switch 2"],
  send: ["send <Pokémon>", "send 2"],
  run: ["run", "run"],
  use: ["use <item> [on <Pokémon>]", "use POTION on 1"],
  teach: ["teach <TM or HM> on <Pokémon>", "teach TM13 on 1"],
  buy: ["buy <item> <quantity>", "buy POTION 2"],
  sell: ["sell <item> <quantity>", "sell POTION 2"],
  withdraw: ["withdraw <item> [quantity]", "withdraw POTION 2"],
  deposit: ["deposit <item> [quantity]", "deposit POTION 2"],
  leave: ["leave", "leave"],
  name: ["name <text>", "name Sparky"],
  forget: ["forget <move>", "forget TACKLE"],
  keep: ["keep", "keep"],
  press: ["press <button>", "press A"],
  viewAtlas: ["viewAtlas", "viewAtlas"],
  zoom: ["zoom <a-b>", "zoom 1-8"],
};

function notNow(name: string, accepted: ActionVerb[]): string {
  return `"${name}" is not an action now: use ${alternatives(accepted)}`;
}

function unreadable(text: string, accepted: ActionVerb[]): string {
  const verb = text.match(/^\w+/)?.[0].toLowerCase();
  const name = MODEL_ACTION_NAMES.find((n) => n.toLowerCase() === verb);
  if (!name) return `"${quoted(text)}" is not an action`;
  if (!accepted.includes(name)) return notNow(name, accepted);
  const [form, example] = FORMS[name];
  return `"${quoted(text)}" is not an action: write ${form}${form === example ? "" : `, for example ${example}`}`;
}

function parse(written: string): ParsedAction | null {
  const action = withSpaces(written);
  let m: RegExpMatchArray | null;
  if ((m = action.match(/^use\s+(.+?)(?:\s+on\s+(.+))?$/i))) return { name: "use", item: m[1], ...(m[2] === undefined ? {} : { on: m[2] }) };
  if ((m = action.match(/^teach\s+(.+?)\s+on\s+(.+)$/i))) return { name: "teach", item: m[1], on: m[2] };
  if ((m = action.match(/^(buy|sell|withdraw|deposit)\s+(.+?)(?:\s+(\d+))?$/i))) {
    const name = m[1].toLowerCase() as QuantityName;
    // The quantity is 1 when a withdraw or a deposit does not give it. A buy or a sell must give it.
    if (m[3] !== undefined || name === "withdraw" || name === "deposit") return { name, item: m[2], quantity: Number(m[3] ?? 1) };
  }
  if ((m = action.match(/^switch\s+(.+)$/i))) return { name: "switch", pokemon: m[1] };
  if ((m = action.match(/^send\s+(.+)$/i))) return { name: "send", pokemon: m[1] };
  if ((m = action.match(/^swap\s+(.+)$/i))) return { name: "swap", pokemon: m[1] };
  if ((m = action.match(/^go\s+(\S+)$/i))) return { name: "go", target: m[1] };
  if ((m = action.match(/^goto\s+(-?\d+)\s+(-?\d+)(?:\s+(\S+))?$/i))) return { name: "goTo", x: Number(m[1]), y: Number(m[2]), ...(m[3] ? { map: m[3] } : {}) };
  if ((m = action.match(/^choose\s+(.+)$/i))) return { name: "choose", option: m[1] };
  if ((m = action.match(/^fight\s+([0-3])$/i))) return { name: "fight", move: Number(m[1]) };
  if (/^run$/i.test(action)) return { name: "run" };
  if (/^leave$/i.test(action)) return { name: "leave" };
  if (/^keep$/i.test(action)) return { name: "keep" };
  if ((m = action.match(/^forget\s+(.+)$/i))) return { name: "forget", move: m[1] };
  if ((m = action.match(/^name(?:\s+(.*))?$/i))) return { name: "name", text: m[1] ?? "" };
  if (/^viewAtlas$/i.test(action)) return { name: "viewAtlas" };
  if ((m = action.match(/^zoom\s+#?(\d+)(?:-(\d+))?$/i))) return { name: "zoom", from: Number(m[1]), to: Number(m[2] ?? m[1]) };
  const button = action.match(/^press\s+(\w+)$/i)?.[1].toLowerCase();
  const pressed = BUTTONS.find((b) => b.toLowerCase() === button);
  return pressed ? { name: "press", button: pressed } : null;
}

const PARTY_LIST = { owner: "your party", place: "place in the party", places: "places in the party" };
const BOXES_LIST = { owner: "your boxes", place: "number in the list", places: "numbers in the list" };

function partySlot(pokemon: string, party: PartyMon[]): number {
  return monIndex(pokemon, party, PARTY_LIST);
}

function monIndex(pokemon: string, mons: readonly { nickname: string }[], { owner, place, places }: typeof PARTY_LIST): number {
  const placed = placeOf(pokemon);
  const named = mons.flatMap((mon, index) => (mon.nickname.toLowerCase() === pokemon.toLowerCase() ? [index] : []));
  // A nickname that is the whole text wins over a place in the text, as in "Pidgey 2".
  if (placed && !(placed.name !== undefined && named.length === 1)) {
    const mon = mons[placed.place - 1];
    if (!mon) throw new Error(`there is no Pokémon ${placed.place}: the ${places} are 1 to ${mons.length}`);
    if (placed.name !== undefined && mon.nickname.toLowerCase() !== placed.name.toLowerCase()) throw new Error(`the Pokémon ${placed.place} of ${owner} is ${mon.nickname}, not ${quoted(placed.name)}`);
    return placed.place - 1;
  }
  if (named.length === 1) return named[0];
  if (named.length === 0) throw new Error(`"${quoted(pokemon)}" is not a Pokémon of ${owner}: ${mons.map((mon) => mon.nickname).join(", ")}`);
  throw new Error(`${named.length} Pokémon of ${owner} have the name ${pokemon}: give the ${place}, 1 to ${mons.length}`);
}

function readBoxTransfer(written: string, asked: Asked & { kind: "pokemonPc" }): BoxAction | null {
  const transfer = withSpaces(written).match(/^(deposit|withdraw)(?:\s+(.+))?$/i);
  if (!transfer) return null;
  const verb = transfer[1].toLowerCase() as "deposit" | "withdraw";
  const accepted = actionsOf(asked);
  if (!accepted.includes(verb)) throw new Error(notNow(verb, accepted));
  const pokemon = transfer[2];
  if (pokemon === undefined) throw new Error(`"${verb}" is not an action: write ${verb} <Pokémon>, for example ${verb} 1`);
  if (verb === "deposit") return { name: "depositPokemon", slot: partySlot(pokemon, asked.party) };
  const { box, position } = asked.boxes[monIndex(pokemon, asked.boxes, BOXES_LIST)];
  return { name: "withdrawPokemon", box, position };
}

/** The place in the text: "2", "Pidgey 2", "Pidgey (2)", "Pidgey (place 2)" or "2 Pidgey". Null when the text has no place. */
function placeOf(pokemon: string): { name?: string; place: number } | null {
  if (/^\d+$/.test(pokemon)) return { place: Number(pokemon) };
  const after = pokemon.match(/^(.+?)\s*(?:\(\s*(?:(?:position|place)\s*)?(\d+)\s*\)|\s(\d+))$/i);
  if (after) return { name: after[1], place: Number(after[2] ?? after[3]) };
  const before = pokemon.match(/^(\d+)\s+(.+)$/);
  return before ? { name: before[2], place: Number(before[1]) } : null;
}

function swapOf(pokemons: string, party: PartyMon[]): ModelAction {
  let error: unknown = new Error(`"${quoted(pokemons)}" is not two Pokémon of your party`);
  for (const [i, c] of [...pokemons].entries()) {
    if (c !== " ") continue;
    try {
      return { name: "swap", first: partySlot(pokemons.slice(0, i).trim(), party), second: partySlot(pokemons.slice(i + 1).trim(), party) };
    } catch (e) {
      error = e;
    }
  }
  throw error;
}

function quoted(text: string): string {
  return text.slice(0, MAX_QUOTED_ACTION);
}

export function alternatives(names: string[]): string {
  return names.length === 1 ? names[0] : `${names.slice(0, -1).join(", ")} or ${names.at(-1)}`;
}
