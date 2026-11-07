import { type Coach, callTurns, isDecision, type ModelSettings, type RunEvent } from "../harness/record";
import { ADVICE_ORDER, ADVICE_PARTS, addAdvice, type CoachAdvice, callKind } from "../protocol";
import { type Asked, readFields } from "./decision";
import type { JsonSchema } from "./openrouter";
import type { TurnKind } from "./prompt";

export const MAX_ADVICE_PART = 150;

const PART_RULES: Record<(typeof ADVICE_PARTS)[number], string> = {
  team: "the most important part: which Pokémon to catch and where, with your Poké Balls; which Pokémon to train, where and up to which level; which Pokémon to switch with the PC. Two or three trained Pokémon win more battles than one strong Pokémon",
  shopping: 'what to buy at the next Poké Mart, how many and for how much money, or "nothing to buy"',
  progress: "the next steps toward the next Milestone that the objective does not already tell",
  battles: "which moves to use against which foes, and when to switch, run or go back to a Pokémon Center",
};

export const ADVICE_REQUEST = [
  `- A smaller model plays the next decisions, about 20, until your next turn. Write in "advice" what it must do, in 4 parts of at most ${MAX_ADVICE_PART} characters each. An empty part keeps your last advice for this part:`,
  ...ADVICE_PARTS.map((part) => `  - "${part}": ${PART_RULES[part]}.`),
];

export const COACH_INTRO =
  "You are the Coach of a smaller model that plays Pokémon FireRed. You play the character, reflection and review turns, the summaries of the Memory tree and the choice of a move to forget; the smaller model plays all the other decisions. At your character, reflection and review turns, you write a Coach advice, and the smaller model reads your last advice at each decision. A program plays the actions in the game, and the game is frozen while you think. Below, \"you\" is the trainer that you and the smaller model play together.";
export const COACH_DUTY =
  "The smaller model follows your advice to the letter, but it does not plan: by itself it rarely catches a Pokémon, trains a weak Pokémon, buys items or changes its team. A team of one strong Pokémon loses to the rival and to a Gym Leader with a type advantage, and with no POTION or ANTIDOTE a long walk can end in a whiteout. So your advice tells it what to do with the team, the shopping, the way forward and the battles.";
export const COACH_RULE =
  "A Coach, a bigger model, plays the character, reflection and review turns, the summaries of your Memory tree and the choice of a move to forget. At its character, reflection and review turns, it writes a Coach advice, and you get the last one at each decision.";

export function coachRole(coached: boolean, turn: TurnKind, asked: Asked): { plays: boolean; advises: boolean } {
  return { plays: coached && (turn !== "normal" || asked.kind === "learnMove"), advises: coached && turn !== "normal" };
}

/** All the calls of the Coach think at the thinking level of the Run: with a Coach, the player never uses it. After an empty answer, a turn plays at the reasoning level of the Run, as for the player. */
export function coachSettings(settings: ModelSettings, coach: Coach): ModelSettings {
  return { ...settings, id: coach.id };
}

// Required: a strict JSON schema of the providers has no optional field.
export function withAdvice(schema: JsonSchema): JsonSchema {
  const part = (name: (typeof ADVICE_PARTS)[number]) => ({ type: "string", description: `${PART_RULES[name]}; at most ${MAX_ADVICE_PART} characters, or an empty string to keep your last advice for this part` });
  const advice = {
    type: "object",
    description: "What the smaller model that plays the next decisions must do until your next turn.",
    properties: Object.fromEntries(ADVICE_PARTS.map((name) => [name, part(name)])),
    required: ADVICE_PARTS,
    additionalProperties: false,
  };
  return { ...schema, properties: { ...schema.properties, advice }, required: [...schema.required, "advice"] };
}

export function readAdvice(content: string): CoachAdvice {
  const { advice } = readFields(content);
  if (typeof advice !== "object" || advice === null) return {};
  const parts = advice as Record<string, unknown>;
  return Object.fromEntries(ADVICE_PARTS.flatMap((part) => {
    const text = parts[part];
    return typeof text === "string" && text.trim() ? [[part, text.trim().slice(0, MAX_ADVICE_PART)]] : [];
  }));
}

/** The last text of each part, with the turn that wrote it and the number of decisions after it. */
export function adviceLine(events: readonly RunEvent[]): string[] {
  const turns = callTurns(events);
  const latest = new Map<string, { text: string; from: number }>();
  turns.forEach((turn, at) => addAdvice(latest, turn.call?.decision?.advice, at));
  if (latest.size === 0) return [];
  const lines = ADVICE_ORDER.flatMap((label) => {
    const part = latest.get(label);
    const call = part && turns[part.from].call;
    if (!part || !call) return [];
    const after = turns.slice(part.from + 1).filter(isDecision).length;
    return [`- ${label} (${callKind(call) ?? "coach"} turn, ${after} decision${after === 1 ? "" : "s"} ago): ${part.text}`];
  });
  return ["Coach advice, the last one of your Coach for each part:", ...lines];
}
