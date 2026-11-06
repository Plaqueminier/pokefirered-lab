import { type Coach, callTurns, isDecision, type ModelSettings, type RunEvent } from "../harness/record";
import { callKind } from "../protocol";
import { type Asked, readFields } from "./decision";
import type { JsonSchema } from "./openrouter";
import type { TurnKind } from "./prompt";

const MAX_ADVICE = 200;
export const ADVICE_REQUEST = '- A smaller model plays the next decisions. Write in "advice" what it must do until your next turn.';
export const COACH_RULE =
  "A Coach, a bigger model, plays the character, reflection and review turns, the summaries of your Memory tree and the choice of a move to forget. At its character, reflection and review turns, it writes a Coach advice, and you get the last one at each decision.";

export function coachRole(coached: boolean, turn: TurnKind, asked: Asked): { plays: boolean; advises: boolean } {
  return { plays: coached && (turn !== "normal" || asked.kind === "learnMove"), advises: coached && turn !== "normal" };
}

/** All the calls of the Coach think at its level. After an empty answer, a turn plays at the reasoning level of the Run, as for the player. */
export function coachSettings(settings: ModelSettings, coach: Coach): ModelSettings {
  return { ...settings, id: coach.id, thinking: coach.reasoning };
}

// Required: a strict JSON schema of the providers has no optional field.
export function withAdvice(schema: JsonSchema): JsonSchema {
  const advice = { type: "string", description: `What the smaller model that plays the next decisions must do until your next turn, in ${MAX_ADVICE} characters at most, or an empty string to keep your last advice.` };
  return { ...schema, properties: { ...schema.properties, advice }, required: [...schema.required, "advice"] };
}

export function readAdvice(content: string): string {
  const { advice } = readFields(content);
  return typeof advice === "string" ? advice.trim().slice(0, MAX_ADVICE) : "";
}

export function adviceLine(events: readonly RunEvent[]): string[] {
  const turns = callTurns(events);
  const at = turns.findLastIndex((turn) => turn.call?.decision?.advice);
  const call = turns[at]?.call;
  const kind = call && callKind(call);
  if (!call?.decision?.advice || !kind) return [];
  const after = turns.slice(at + 1).filter(isDecision).length;
  return [`Coach advice (${kind} turn, ${after} decision${after === 1 ? "" : "s"} ago): ${call.decision.advice}`];
}
