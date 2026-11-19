import type { Observation, ReplayedState } from "../harness/harness";
import type { ModelSettings, NodeSentence, Prompt, RunEvent } from "../harness/record";
import { CHARACTER_SCHEMA } from "./character";
import { ADVICE_REQUEST, adviceLine, battleAdviceLine, coachRole, wantLines, withAdvice } from "./coach";
import { type Asked, BATTLE_SCHEMA, inBattle, REVIEW_SCHEMA } from "./decision";
import { importantEvents } from "./important-events";
import { memoryLines, memoryTree, reviewMemory } from "./memory-tree";
import { type AnswerFormat, DECISION_FORMAT } from "./openrouter";
import { battleSystemPrompt, systemPrompt, type TurnKind, turnRequest, userPrompt } from "./prompt";

/** The version of the model bot. A change of what the bot sends to the model needs a new version, here and in the README. */
export const BOT_VERSION = "52";

const TURN_FORMATS: Record<TurnKind, AnswerFormat> = {
  normal: DECISION_FORMAT,
  character: { name: "character", schema: CHARACTER_SCHEMA },
  reflection: DECISION_FORMAT,
  review: { name: "review", schema: REVIEW_SCHEMA },
};

const BATTLE_FORMAT: AnswerFormat = { name: "battle", schema: BATTLE_SCHEMA };

export type PromptInput = Omit<ReplayedState, "events"> & { events: readonly RunEvent[]; before: Observation | null };

type Opening = { prompt: Prompt; format: AnswerFormat; plays: boolean; advises: boolean; thinks: boolean; sentences: NodeSentence[] };

function turnFormat(turn: TurnKind, advises: boolean, battle: boolean): AnswerFormat {
  const format = battle ? BATTLE_FORMAT : TURN_FORMATS[turn];
  return advises ? { ...format, schema: withAdvice(format.schema) } : format;
}

/** The first prompt of a conversation, with the format of the answer: the bot and the battle lab build it here. */
export function openingPrompt(settings: ModelSettings, { observation, before, events, noProgress, names, frame, whiteouts }: PromptInput, asked: Asked, turn: TurnKind): Opening {
  const happened = importantEvents(before, observation, events);
  const tree = memoryTree(events);
  const memory = turn === "review" ? reviewMemory(tree) : { lines: memoryLines(tree), sentences: [] };
  const coached = settings.coach !== undefined;
  const { plays, advises } = coachRole(coached, turn, asked);
  const battle = inBattle(asked);
  const request = [...turnRequest(turn, settings.starter, names, events), ...(advises ? ADVICE_REQUEST : [])];
  const advice = coached ? [...(battle ? battleAdviceLine(events) : adviceLine(events)), ...wantLines(events, asked, observation.bag)] : [];
  const limits = { whiteoutLimit: settings.whiteoutLimit, timeLimit: settings.timeLimit, whiteouts, frame };
  const user = userPrompt(observation, asked, events, { noProgress, turn, happened, request, memory: memory.lines, advice, limits });
  const system = battle ? battleSystemPrompt(settings) : systemPrompt(settings, observation.party.length > 0, plays ? "coach" : "player");
  return { prompt: { system, user }, format: turnFormat(turn, advises, battle), plays, advises, thinks: turn !== "normal" || plays, sentences: memory.sentences };
}
