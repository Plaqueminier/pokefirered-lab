import { type BagItem, battleItems } from "../bag";
import type { BattleState, Button, Observation } from "../harness/harness";
import type { Decision } from "../harness/record";
import type { PartyMon } from "../party";
import { Keys } from "../protocol";
import { atlasExtract, type AtlasView } from "./extract";
import type { Overworld } from "./targets";

export const MAX_NOTES = 500;
// The prompt holds the Mission, the objective and an action that the Bot cannot read: they must not make it grow.
export const MAX_SENTENCE = 200;
const MAX_QUOTED_ACTION = 80;

const FIELDS = ["reason", "action", "mission", "objective", "notes"] as const satisfies readonly (keyof Decision)[];

export const DECISION_SCHEMA = {
  type: "object",
  properties: {
    reason: { type: "string", description: "Why you choose this action, in one or two short sentences." },
    action: { type: "string", description: "Exactly one of the actions of the message, for example \"go 2\"." },
    mission: { type: "string", description: "The story step that you work on, in one short sentence. Keep it until you reach it." },
    objective: { type: "string", description: "What you do now for your Mission, in one short sentence." },
    notes: { type: "string", description: `Your memory: the facts to keep, ${MAX_NOTES} characters at most.` },
  },
  required: FIELDS,
  additionalProperties: false,
} as const;

export type ModelAction =
  | { name: "go"; target: number }
  | { name: "goTo"; x: number; y: number; map?: string }
  | { name: "choose"; option: string }
  | { name: "fight"; move: number }
  | { name: "run" }
  | { name: "use"; item: string; on?: number }
  | { name: "press"; button: Button }
  | { name: "viewAtlas" };

export type Asked =
  | { kind: "walk"; overworld: Overworld; view: AtlasView; atlasViewed: boolean }
  | ({ kind: "choice"; options: string[] } & ({ overworld: Overworld } | { battle: BattleState }))
  /** `items`: the items of the Bag that work now. */
  | { kind: "battleAction" | "battleMove" | "partyPick"; battle: BattleState; items: BagItem[]; party: PartyMon[] };

export type AskedKind = Asked["kind"];

const ACTIONS: Record<AskedKind, ModelAction["name"][]> = {
  walk: ["go", "goTo", "viewAtlas", "press"],
  choice: ["choose", "press"],
  battleAction: ["fight", "run", "use", "press"],
  battleMove: ["fight", "press"],
  partyPick: ["press"],
};

export function actionsOf(asked: Asked): ModelAction["name"][] {
  return asked.kind === "walk" && asked.atlasViewed ? ACTIONS.walk.filter((name) => name !== "viewAtlas") : ACTIONS[asked.kind];
}

const BUTTONS = Object.keys(Keys) as Button[];

/** Null when the game waits for no decision of the model: a text, or a busy game. */
export function askedOf(observation: Observation, atlasViewed: boolean): Asked | null {
  const { waitingFor } = observation;
  if (observation.mode === "overworld") {
    if (waitingFor.kind === "walk") return { kind: "walk", overworld: observation, view: atlasExtract(observation), atlasViewed };
    return waitingFor.kind === "choice" ? { kind: "choice", overworld: observation, options: waitingFor.options } : null;
  }
  const { kind } = waitingFor;
  // After a catch, the battle asks for a nickname.
  if (kind === "choice") return { kind, battle: observation.battle, options: waitingFor.options };
  const { battle, bag, party } = observation;
  return kind === "battleAction" || kind === "battleMove" || kind === "partyPick" ? { kind, battle, items: battleItems(bag, battle.kind), party } : null;
}

export function readDecision(content: string): Decision {
  if (content.trim() === "") throw new Error("the answer is empty");
  let value: unknown;
  try {
    value = JSON.parse(content);
  } catch {
    throw new Error("the answer is not JSON");
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error("the answer is not a JSON object");
  const fields = value as Record<string, unknown>;
  const decision = {} as Decision;
  for (const field of FIELDS) {
    const text = fields[field];
    if (typeof text !== "string") throw new Error(`the answer has no string "${field}"`);
    decision[field] = text.trim();
  }
  return { ...decision, mission: decision.mission.slice(0, MAX_SENTENCE), objective: decision.objective.slice(0, MAX_SENTENCE), notes: decision.notes.slice(0, MAX_NOTES) };
}

export function readAction(text: string, asked: Asked): ModelAction {
  const use = text.trim().match(/^use\s+(.+?)(?:\s+on\s+(.+))?$/i);
  if (use) return readUse(use[1], use[2], asked);
  const action = parse(text.trim());
  if (!action) throw new Error(`"${quoted(text)}" is not an action`);
  const accepted = actionsOf(asked);
  if (!accepted.includes(action.name)) throw new Error(`"${action.name}" is not an action now: use ${alternatives(accepted)}`);
  if (action.name === "go") {
    const targets = asked.kind === "walk" ? asked.view.targets.length : 0;
    if (action.target < 1 || action.target > targets) {
      throw new Error(`there is no target ${action.target}: ${targets === 0 ? "the map has no targets" : `the targets are 1 to ${targets}`}`);
    }
  }
  if (action.name === "choose" && asked.kind === "choice") {
    const option = asked.options.find((o) => o.toLowerCase() === action.option.toLowerCase());
    if (!option) throw new Error(`"${quoted(action.option)}" is not an option: ${asked.options.join(", ")}`);
    return { name: "choose", option };
  }
  return action;
}

function readUse(name: string, on: string | undefined, asked: Asked): ModelAction {
  if (!actionsOf(asked).includes("use")) throw new Error(`"use" is not an action now: use ${alternatives(actionsOf(asked))}`);
  const { items, party } = asked.kind === "battleAction" ? asked : { items: [], party: [] };
  const item = items.find((i) => plain(i.name) === plain(name));
  if (!item) throw new Error(`"${quoted(name)}" is not an item that works now: ${items.map((i) => i.name).join(", ") || "none"}`);
  if (item.battle === "alone") {
    if (on !== undefined) throw new Error(`${item.name} does not work on a Pokémon: use ${item.name}`);
    return { name: "use", item: item.name };
  }
  if (on === undefined) throw new Error(`${item.name} works on a Pokémon: use ${item.name} on <Pokémon>`);
  const nickname = party.findIndex((m) => plain(m.nickname) === plain(on));
  const index = nickname >= 0 ? nickname : party.findIndex((m) => plain(m.species) === plain(on));
  if (index < 0) throw new Error(`"${quoted(on)}" is not a Pokémon of your party: ${party.map((m) => m.nickname).join(", ")}`);
  return { name: "use", item: item.name, on: index };
}

// The model can write "Poke Ball" for "POKé BALL".
function plain(text: string): string {
  return text.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase().trim();
}

function parse(action: string): ModelAction | null {
  let m: RegExpMatchArray | null;
  if ((m = action.match(/^go\s+(\d+)$/i))) return { name: "go", target: Number(m[1]) };
  if ((m = action.match(/^goto\s+(-?\d+)\s+(-?\d+)(?:\s+(\S+))?$/i))) return { name: "goTo", x: Number(m[1]), y: Number(m[2]), ...(m[3] ? { map: m[3] } : {}) };
  if ((m = action.match(/^choose\s+(.+)$/i))) return { name: "choose", option: m[1] };
  if ((m = action.match(/^fight\s+([0-3])$/i))) return { name: "fight", move: Number(m[1]) };
  if (/^run$/i.test(action)) return { name: "run" };
  if (/^viewAtlas$/i.test(action)) return { name: "viewAtlas" };
  const button = action.match(/^press\s+(\w+)$/i)?.[1].toLowerCase();
  const pressed = BUTTONS.find((b) => b.toLowerCase() === button);
  return pressed ? { name: "press", button: pressed } : null;
}

function quoted(text: string): string {
  return text.slice(0, MAX_QUOTED_ACTION);
}

export function alternatives(names: string[]): string {
  return names.length === 1 ? names[0] : `${names.slice(0, -1).join(", ")} or ${names.at(-1)}`;
}
