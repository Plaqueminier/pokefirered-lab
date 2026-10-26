import { type BagItem, battleItems, type ItemUse, sellableItems, walkItems } from "../bag";
import type { BattleState, Button, MacroAction, Observation, RawInput } from "../harness/harness";
import type { Decision, NodeRange } from "../harness/record";
import { type PartyMon, sendableSlots } from "../party";
import { Keys } from "../protocol";
import type { ShopItem } from "../shop";
import { atlasExtract, type AtlasView } from "./extract";
import { type Overworld, targetIndex, targetLetter } from "./targets";

// The text that the model writes returns in each prompt: a cap keeps the prompt small.
export const MAX_SENTENCE = 200;
/** The model bot gets a Reflection turn at each REFLECTION_EVERY more Decision points on the Stuck counter. */
export const REFLECTION_EVERY = 30;
const MAX_QUOTED_ACTION = 80;

const FIELDS = ["reason", "action", "mission", "objective", "note"] as const satisfies readonly (keyof Decision)[];

export const DECISION_SCHEMA = {
  type: "object",
  properties: {
    reason: { type: "string", description: "Why you choose this action, in one or two short sentences." },
    action: { type: "string", description: "Exactly one of the actions of the message, for example \"go B\"." },
    mission: { type: "string", description: "The story step that you work on, in one short sentence. Keep it until you reach it." },
    objective: { type: "string", description: "What you do now for your Mission, in one short sentence." },
    note: { type: "string", description: `A fact that the game proved, or a lesson (what works, what fails and why), in one line of ${MAX_SENTENCE} characters at most, or an empty string. Never a guess, never HP values. Nobody changes it later.` },
  },
  required: FIELDS,
  additionalProperties: false,
} as const;

/** The Macro-actions and the Raw input that the model can choose, and the actions that the code of the model bot plays: go, viewAtlas and zoom. */
export type ModelAction =
  | Exclude<MacroAction, { name: "interact" | "readText" }>
  | RawInput
  | { name: "go"; target: number }
  | { name: "viewAtlas" }
  | ({ name: "zoom" } & NodeRange);

/** The actions that play in the game: viewAtlas and zoom only show more to the model. */
export type PlayedAction = Exclude<ModelAction, { name: "viewAtlas" | "zoom" }>;

export function isPlayed(action: ModelAction): action is PlayedAction {
  return action.name !== "viewAtlas" && action.name !== "zoom";
}

const NAMES = { go: 0, goTo: 0, swap: 0, choose: 0, fight: 0, switch: 0, send: 0, run: 0, use: 0, buy: 0, sell: 0, leave: 0, press: 0, viewAtlas: 0, zoom: 0 } satisfies Record<ModelAction["name"], 0>;

/** All the names of the actions of the model. The type check fails when a new action is not in the list. */
export const MODEL_ACTION_NAMES = Object.keys(NAMES) as ModelAction["name"][];

export type Asked = { party: PartyMon[] } & (
  | { kind: "walk"; overworld: Overworld; view: AtlasView; atlasShown: boolean; items: BagItem[] }
  | ({ kind: "choice"; options: string[] } & ({ overworld: Overworld } | { battle: BattleState }))
  | { kind: "battleAction" | "battleMove" | "partyPick"; battle: BattleState; items: BagItem[] }
  | { kind: "shopMenu"; forSale: ShopItem[]; sellable: BagItem[] }
);

export type AskedKind = Asked["kind"];

const ACTIONS: Record<AskedKind, ModelAction["name"][]> = {
  walk: ["go", "goTo", "swap", "use", "viewAtlas", "zoom", "press"],
  choice: ["choose", "zoom", "press"],
  battleAction: ["fight", "switch", "run", "use", "zoom", "press"],
  battleMove: ["fight", "zoom", "press"],
  partyPick: ["send", "zoom", "press"],
  shopMenu: ["buy", "sell", "leave", "zoom"],
};

export function actionsOf(asked: Asked): ModelAction["name"][] {
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
      case "sell":
        return asked.kind === "shopMenu" && asked.sellable.length > 0;
      default:
        return true;
    }
  });
}

export function sendable(asked: Asked): PartyMon[] {
  if (!("battle" in asked)) return [];
  return sendableSlots(asked.party, asked.battle.player.partyIndex).map((slot) => asked.party[slot]);
}

const BUTTONS = Object.keys(Keys) as Button[];

/** Null when the game waits for no decision of the model: a text, or a busy game. */
export function askedOf(observation: Observation, atlasShown: boolean): Asked | null {
  const { waitingFor, party } = observation;
  if (observation.mode === "overworld") {
    if (waitingFor.kind === "walk") return { kind: "walk", party, overworld: observation, view: atlasExtract(observation), atlasShown, items: walkItems(observation.bag) };
    if (waitingFor.kind === "shopMenu") return { kind: "shopMenu", party, forSale: waitingFor.items, sellable: sellableItems(observation.bag) };
    return waitingFor.kind === "choice" ? { kind: "choice", party, overworld: observation, options: waitingFor.options } : null;
  }
  const { battle } = observation;
  if (waitingFor.kind === "choice") return { kind: "choice", party, battle, options: waitingFor.options };
  const { kind } = waitingFor;
  return kind === "battleAction" || kind === "battleMove" || kind === "partyPick" ? { kind, party, battle, items: battleItems(observation.bag, battle.kind) } : null;
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

export function readDecision(content: string): Decision {
  if (content.trim() === "") throw new Error("the answer is empty");
  const value = readJson(content);
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error("the answer is not a JSON object");
  const fields = value as Record<string, unknown>;
  const decision = {} as Decision;
  for (const field of FIELDS) {
    const text = fields[field];
    if (typeof text !== "string") throw new Error(`the answer has no string "${field}"`);
    decision[field] = text.trim();
  }
  return { ...decision, mission: decision.mission.slice(0, MAX_SENTENCE), objective: decision.objective.slice(0, MAX_SENTENCE), note: decision.note.slice(0, MAX_SENTENCE) };
}

/** An action as the model writes it: the Pokémon, the item and the option are still texts. */
type Written =
  | { name: "go"; target: string }
  | { name: "switch" | "send" | "swap"; pokemon: string }
  | { name: "use"; item: string; on?: string }
  | { name: "buy" | "sell"; item: string; quantity: number };
type ParsedAction = Exclude<ModelAction, { name: Written["name"] }> | Written;

export function readAction(text: string, asked: Asked): ModelAction {
  const action = parse(text.trim());
  if (!action) throw new Error(`"${quoted(text)}" is not an action`);
  const accepted = actionsOf(asked);
  if (!accepted.includes(action.name)) throw new Error(`"${action.name}" is not an action now: use ${alternatives(accepted)}`);
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
    case "use":
      return readUse(action.item, action.on, asked);
    case "buy":
    case "sell":
      return readTrade(action.name, action.item, action.quantity, asked);
    default:
      return action;
  }
}

function readUse(name: string, on: string | undefined, asked: Asked): ModelAction {
  const items = "items" in asked ? asked.items : [];
  const item = items.find((i) => plain(i.name) === plain(name));
  if (!item) throw new Error(`"${quoted(name)}" is not an item that works now: ${items.map((i) => i.name).join(", ") || "none"}`);
  if (itemUse(item, asked) === "alone") {
    if (on !== undefined) throw new Error(`${item.name} does not work on a Pokémon: use ${item.name}`);
    return { name: "use", item: item.name };
  }
  if (on === undefined) throw new Error(`${item.name} works on a Pokémon: use ${item.name} on <Pokémon>`);
  return { name: "use", item: item.name, on: partySlot(on, asked.party) };
}

function readTrade(name: "buy" | "sell", item: string, quantity: number, asked: Asked): ModelAction {
  const names = (asked.kind !== "shopMenu" ? [] : name === "buy" ? asked.forSale : asked.sellable).map((i) => i.name);
  const found = names.find((n) => plain(n) === plain(item));
  if (!found) throw new Error(`"${quoted(item)}" is not an item ${name === "buy" ? "for sale" : "of your Bag that the Poké Mart buys"}: ${names.join(", ") || "none"}`);
  return { name, item: found, quantity };
}

export function itemUse(item: BagItem, asked: Asked): ItemUse | null {
  return asked.kind === "walk" ? item.walk : item.battle;
}

function plain(text: string): string {
  return text.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase().trim();
}

function withSpaces(action: string): string {
  const call = action.match(/^(\w+)\s*\((.*)\)$/);
  if (!call) return action;
  const separator = call[1].toLowerCase() === "use" ? " on " : " ";
  return `${call[1]} ${call[2].split(",").map((arg) => arg.trim()).join(separator)}`.trim();
}

function parse(written: string): ParsedAction | null {
  const action = withSpaces(written);
  let m: RegExpMatchArray | null;
  if ((m = action.match(/^use\s+(.+?)(?:\s+on\s+(.+))?$/i))) return { name: "use", item: m[1], ...(m[2] === undefined ? {} : { on: m[2] }) };
  if ((m = action.match(/^(buy|sell)\s+(.+?)\s+(\d+)$/i))) return { name: m[1].toLowerCase() as "buy" | "sell", item: m[2], quantity: Number(m[3]) };
  if ((m = action.match(/^switch\s+(.+)$/i))) return { name: "switch", pokemon: m[1] };
  if ((m = action.match(/^send\s+(.+)$/i))) return { name: "send", pokemon: m[1] };
  if ((m = action.match(/^swap\s+(.+)$/i))) return { name: "swap", pokemon: m[1] };
  if ((m = action.match(/^go\s+(\S+)$/i))) return { name: "go", target: m[1] };
  if ((m = action.match(/^goto\s+(-?\d+)\s+(-?\d+)(?:\s+(\S+))?$/i))) return { name: "goTo", x: Number(m[1]), y: Number(m[2]), ...(m[3] ? { map: m[3] } : {}) };
  if ((m = action.match(/^choose\s+(.+)$/i))) return { name: "choose", option: m[1] };
  if ((m = action.match(/^fight\s+([0-3])$/i))) return { name: "fight", move: Number(m[1]) };
  if (/^run$/i.test(action)) return { name: "run" };
  if (/^leave$/i.test(action)) return { name: "leave" };
  if (/^viewAtlas$/i.test(action)) return { name: "viewAtlas" };
  if ((m = action.match(/^zoom\s+#?(\d+)(?:-(\d+))?$/i))) return { name: "zoom", from: Number(m[1]), to: Number(m[2] ?? m[1]) };
  const button = action.match(/^press\s+(\w+)$/i)?.[1].toLowerCase();
  const pressed = BUTTONS.find((b) => b.toLowerCase() === button);
  return pressed ? { name: "press", button: pressed } : null;
}

function partySlot(pokemon: string, party: PartyMon[]): number {
  if (/^\d+$/.test(pokemon)) {
    const place = Number(pokemon);
    if (place < 1 || place > party.length) throw new Error(`there is no Pokémon ${place}: the places in the party are 1 to ${party.length}`);
    return place - 1;
  }
  const slots = party.flatMap((mon, slot) => (mon.nickname.toLowerCase() === pokemon.toLowerCase() ? [slot] : []));
  if (slots.length === 1) return slots[0];
  if (slots.length === 0) throw new Error(`"${quoted(pokemon)}" is not a Pokémon of your party: ${party.map((mon) => mon.nickname).join(", ")}`);
  throw new Error(`${slots.length} Pokémon of your party have the name ${pokemon}: give the place in the party, 1 to ${party.length}`);
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
