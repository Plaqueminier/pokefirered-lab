import type { BattleState, Button, Observation } from "../harness/harness";
import type { Decision } from "../harness/record";
import { Keys } from "../protocol";
import { type Overworld, type Target, targetsOf } from "./targets";

export const MAX_NOTES = 500;
// The prompt holds the objective and an action that the Bot cannot read: they must not make it grow.
export const MAX_OBJECTIVE = 200;
const MAX_QUOTED_ACTION = 80;

const FIELDS = ["reason", "action", "objective", "notes"] as const satisfies readonly (keyof Decision)[];

export const DECISION_SCHEMA = {
  type: "object",
  properties: {
    reason: { type: "string", description: "Why you choose this action, in one or two short sentences." },
    action: { type: "string", description: "Exactly one of the actions of the message, for example \"go 2\"." },
    objective: { type: "string", description: "What you do now, in one short sentence." },
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
  | { name: "press"; button: Button };

/** What the game asks the model: the overworld at a walk or a choice, the battle at a battle menu or the party menu. */
export type Asked =
  | { kind: "walk"; overworld: Overworld; targets: Target[] }
  | { kind: "choice"; overworld: Overworld; options: string[] }
  | { kind: "battleAction" | "battleMove" | "partyPick"; battle: BattleState };

export type AskedKind = Asked["kind"];

export const MODEL_ACTIONS: Record<AskedKind, ModelAction["name"][]> = {
  walk: ["go", "goTo", "press"],
  choice: ["choose", "press"],
  battleAction: ["fight", "run", "press"],
  battleMove: ["fight", "press"],
  partyPick: ["press"],
};

const BUTTONS = Object.keys(Keys) as Button[];

/** Null when the game waits for no decision of the model: a text, or a busy game. */
export function askedOf(observation: Observation, visited: ReadonlySet<string>): Asked | null {
  const { waitingFor } = observation;
  if (observation.mode === "overworld") {
    if (waitingFor.kind === "walk") return { kind: "walk", overworld: observation, targets: targetsOf(observation, visited) };
    return waitingFor.kind === "choice" ? { kind: "choice", overworld: observation, options: waitingFor.options } : null;
  }
  const { kind } = waitingFor;
  return kind === "battleAction" || kind === "battleMove" || kind === "partyPick" ? { kind, battle: observation.battle } : null;
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
  return { ...decision, objective: decision.objective.slice(0, MAX_OBJECTIVE), notes: decision.notes.slice(0, MAX_NOTES) };
}

export function readAction(text: string, asked: Asked): ModelAction {
  const action = parse(text.trim());
  if (!action) throw new Error(`"${quoted(text)}" is not an action`);
  const accepted = MODEL_ACTIONS[asked.kind];
  if (!accepted.includes(action.name)) throw new Error(`"${action.name}" is not an action now: use ${alternatives(accepted)}`);
  if (action.name === "go") {
    const targets = asked.kind === "walk" ? asked.targets.length : 0;
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

function parse(action: string): ModelAction | null {
  let m: RegExpMatchArray | null;
  if ((m = action.match(/^go\s+(\d+)$/i))) return { name: "go", target: Number(m[1]) };
  if ((m = action.match(/^goto\s+(-?\d+)\s+(-?\d+)(?:\s+(\S+))?$/i))) return { name: "goTo", x: Number(m[1]), y: Number(m[2]), ...(m[3] ? { map: m[3] } : {}) };
  if ((m = action.match(/^choose\s+(.+)$/i))) return { name: "choose", option: m[1] };
  if ((m = action.match(/^fight\s+([0-3])$/i))) return { name: "fight", move: Number(m[1]) };
  if (/^run$/i.test(action)) return { name: "run" };
  const button = action.match(/^press\s+(\w+)$/i)?.[1].toLowerCase();
  const pressed = BUTTONS.find((b) => b.toLowerCase() === button);
  return pressed ? { name: "press", button: pressed } : null;
}

function quoted(text: string): string {
  return text.slice(0, MAX_QUOTED_ACTION);
}

function alternatives(names: string[]): string {
  return names.length === 1 ? names[0] : `${names.slice(0, -1).join(", ")} or ${names.at(-1)}`;
}
