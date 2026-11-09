import { type ActionEvent, type CallTurn, type Coach, callTurns, isDecision, type ModelSettings, type RunEvent } from "../harness/record";
import { ADVICE_ORDER, ADVICE_PARTS, addAdvice, type CoachAdvice, callKind } from "../protocol";
import { type Asked, readFields } from "./decision";
import type { JsonSchema } from "./openrouter";
import type { TurnKind } from "./prompt";

export const MAX_ADVICE_PART = 200;
const MAX_SINCE_LINES = 12;

const PART_RULES: Record<(typeof ADVICE_PARTS)[number], string> = {
  team: "the most important part: which Pokémon to catch, with your Poké Balls; which Pokémon to train, where and up to which level; which Pokémon to switch with the PC. Make the team bigger step by step, up to 6 Pokémon with different types: at least 2 before the first Gym, then about one more after each Gym. Train each Pokémon of the team, not only the strongest one. Name the Pokémon that gets a RARE CANDY, an evolution stone or an item to hold",
  shopping: 'what to buy at the next Poké Mart, how many and for how much money, or "nothing to buy"',
  progress: "the next steps toward the next Milestone that the objective does not already tell",
  battles: "which moves to use against which foes, when to use an item, for example a PP item when the PP are low, and when to switch, run or go back to a Pokémon Center",
};

export const ADVICE_REQUEST = [
  `- A smaller model plays the next decisions, about 20, until your next turn. It reads your advice at each of these decisions, not only at the first one, so write what stays useful for all of them.`,
  "- Tell only about the place where it is now and the next place on its way: not a place that it left, and not a place after the next town.",
  '- After a step that ends, such as a heal, write the next step: "Heal at the Pokémon Center, then go north to the forest". Under your last advice, the program tells what happened since: write your new advice from these facts.',
  `- Write in "advice" what it must do, in 4 parts of one or two short sentences. At most ${MAX_ADVICE_PART} characters for each part: the program removes the sentences after this limit. An empty part keeps your last advice for this part:`,
  ...ADVICE_PARTS.map((part) => `  - "${part}": ${PART_RULES[part]}.`),
];

export const COACH_INTRO =
  "You are the Coach of a smaller model that plays Pokémon FireRed. You play the character, reflection and review turns, the summaries of the Memory tree and the choice of a move to forget; the smaller model plays all the other decisions. At your character, reflection and review turns, you write a Coach advice, and the smaller model reads your last advice at each decision. A program plays the actions in the game, and the game is frozen while you think. Below, \"you\" is the trainer that you and the smaller model play together.";
export const COACH_DUTY =
  "The smaller model follows your advice to the letter, but it does not plan: by itself it rarely catches a Pokémon, trains a weak Pokémon, buys items or changes its team. A team of one strong Pokémon loses to the rival and to a Gym Leader with a type advantage, and with no POTION or ANTIDOTE a long walk can end in a whiteout. So your advice tells it what to do with the team, the shopping, the way forward and the battles. A weak Pokémon that stays at the back of the party does not help: tell the smaller model how to train it, or to put it in a box. Do not send it to look for one exact Pokémon in one place from what you think you know of the game: what you remember can be wrong, and the search can take a long time. Name only a Pokémon that this Run saw, or give a general advice, for example \"catch a new species in the next tall grass\".";
export const COACH_RULE =
  "A Coach, a bigger model, plays the character, reflection and review turns, the summaries of your Memory tree and the choice of a move to forget. At its character, reflection and review turns, it writes a Coach advice, and you get the last one at each decision, with what happened since. A step of the advice that these facts show as done is done: do not do it again, go to the next step.";

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

/** Keeps the full sentences that fit. With no full sentence, keeps the full words. */
function cutAdvice(text: string): string {
  if (text.length <= MAX_ADVICE_PART) return text;
  const kept = text.slice(0, MAX_ADVICE_PART + 1);
  const sentenceEnd = Math.max(...[...kept.matchAll(/[.!?](?=\s)/g)].map((match) => match.index), -1);
  if (sentenceEnd >= 0) return kept.slice(0, sentenceEnd + 1);
  const wordEnd = kept.lastIndexOf(" ");
  return wordEnd > 0 ? kept.slice(0, wordEnd) : kept.slice(0, MAX_ADVICE_PART);
}

export function readAdvice(content: string): CoachAdvice {
  const { advice } = readFields(content);
  if (typeof advice !== "object" || advice === null) return {};
  const parts = advice as Record<string, unknown>;
  return Object.fromEntries(ADVICE_PARTS.flatMap((part) => {
    const text = parts[part];
    return typeof text === "string" && text.trim() ? [[part, cutAdvice(text.trim())]] : [];
  }));
}

function itemActionText({ action, result }: ActionEvent, turn: CallTurn): string | null {
  if (result.status !== "done") return null;
  switch (action.name) {
    case "give":
      return `you gave ${action.item} to Pokémon ${action.on + 1}`;
    case "take":
      return `you took the item of Pokémon ${action.on + 1}`;
    case "use": {
      const { item, on, move } = action;
      if (on === undefined || turn.events.some((event) => event.type === "heal" && event.item === item)) return null;
      return `you used ${item} on ${move ? `${move} of ` : ""}Pokémon ${on + 1}`;
    }
    default:
      return null;
  }
}

function factText(event: CallTurn["events"][number], turn: CallTurn): string | null {
  switch (event.type) {
    case "action":
      return itemActionText(event, turn);
    case "heal": {
      if (event.source === "center") return "you healed at a Pokémon Center";
      // The party of a heal has all the Pokémon. A cure of a status raises no HP.
      const raised = event.party.filter((mon) => mon.after > mon.before).map((mon) => mon.species);
      if (event.source === "other") return `${raised.join(", ") || "your party"} healed`;
      return `you used ${event.item ?? "an item"}${raised.length > 0 ? ` on ${raised.join(", ")}` : ""}`;
    }
    case "purchase":
      return `you bought ${event.count} ${event.item}`;
    case "item":
      return `you ${event.how} ${event.count} ${event.item}`;
    case "catch":
      return `you caught a ${event.species}`;
    case "level":
      if (event.level === event.from) return `${event.species} became ${event.evolution}`;
      return `${event.species} reached level ${event.level}${event.evolution ? ` and became ${event.evolution}` : ""}`;
    case "faint":
      return event.side === "player" ? `your ${event.species} fainted` : null;
    case "trainer":
      return `you beat ${event.trainer}`;
    case "whiteout":
      return "all your Pokémon fainted";
    default:
      return null;
  }
}

/** The facts of the game since the oldest part in force. Each line has the same count of decisions as a part of the advice, so the player can compare them. */
function sinceAdvice(turns: readonly CallTurn[], from: number): string[] {
  const visited = new Set<string>();
  const lines = turns.flatMap((turn, at) => {
    const facts = turn.events.flatMap((event) => {
      if (event.type !== "map") return factText(event, turn) ?? [];
      const first = !visited.has(event.map);
      visited.add(event.map);
      return first ? `you reached ${event.map} for the first time` : [];
    });
    if (at < from || facts.length === 0) return [];
    return [`- ${decisionsAgo(turns, at)}: ${facts.join("; ")}.`];
  });
  return lines.length === 0 ? [] : ["What happened since this advice, oldest first:", ...lines.slice(-MAX_SINCE_LINES)];
}

function decisionsAgo(turns: readonly CallTurn[], at: number): string {
  const after = turns.slice(at + 1).filter(isDecision).length;
  return `${after} decision${after === 1 ? "" : "s"} ago`;
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
    return [`- ${label} (${callKind(call) ?? "coach"} turn, ${decisionsAgo(turns, part.from)}): ${part.text}`];
  });
  const oldest = Math.min(...[...latest.values()].map((part) => part.from));
  return ["Coach advice, the last one of your Coach for each part:", ...lines, ...sinceAdvice(turns, oldest)];
}
