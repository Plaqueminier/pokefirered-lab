import type { Decision, ModelEvent, ModelSettings, RunEvent } from "../harness/record";
import { modelEvents, STARTER_SPECIES, type StarterSpecies } from "../protocol";
import { alternatives, type Asked, DECISION_SCHEMA, readDecision, readFields } from "./decision";

const MAX_CHARACTER = 300;
export const NORMAL_TRAINER = "Normal trainer";
// With no idea to start from, 10 of 12 test answers of the model were a bold fan of CHARMANDER. These words suggest no type.
const TRAINER_JOBS = ["baker", "librarian", "taxi driver", "nurse", "chess player", "street musician", "watchmaker", "stage magician", "teacher", "journalist", "tailor", "postal worker", "painter", "mechanic", "detective", "dancer", "accountant", "actor"];
const TRAINER_TRAITS = ["shy", "proud", "curious", "lazy", "cheerful", "grumpy", "superstitious", "stubborn", "dreamy", "polite", "jealous", "generous"];
const NICKNAME_QUESTION = /give a nickname to/i;
const STARTER_QUESTION = new RegExp(`\\b(${STARTER_SPECIES.join("|")}) is your choice`);

export const CHARACTER_SCHEMA = {
  ...DECISION_SCHEMA,
  properties: {
    ...DECISION_SCHEMA.properties,
    character: { type: "string", description: `The style of your nicknames, then the trainer that you play, in ${MAX_CHARACTER} characters at most.` },
    starter: { type: "string", enum: STARTER_SPECIES, description: "The first Pokémon of your trainer." },
  },
  required: [...DECISION_SCHEMA.required, "character", "starter"],
};

function picked<T>(list: readonly T[], random: () => number): T {
  return list[Math.floor(random() * list.length)];
}

export function characterTurn(starter: ModelSettings["starter"], random: () => number = Math.random): string[] {
  const first = picked(STARTER_SPECIES, random);
  const names = [first, ...STARTER_SPECIES.filter((name) => name !== first)];
  return [
    "Character turn: invent the trainer that you play, before you act.",
    `- Start from this idea, and make it your own: a ${picked(TRAINER_TRAITS, random)} ${picked(TRAINER_JOBS, random)}.`,
    "- Give this trainer a clear taste: what the trainer likes, fears and wants, and how the trainer plays.",
    starter === "free"
      ? `- Choose the first Pokémon of this trainer: ${alternatives(names)}. Each of the three can become the Champion. Choose the one that fits this trainer, not the one that is easy for the first Gym. Write it in "starter".`
      : `- The first Pokémon of this trainer is ${starter}. Write it in "starter".`,
    "- Choose a style for the nicknames of this trainer.",
    `- Write in "character", in at most ${MAX_CHARACTER} characters: the style of the nicknames, then the trainer. You keep it for the whole Run. Then choose your action as usual.`,
  ];
}

export function readCharacterDecision(content: string, starter: ModelSettings["starter"]): Decision {
  const decision = readDecision(content);
  const fields = readFields(content);
  if (typeof fields.character !== "string" || fields.character.trim() === "") throw new Error('the answer has no string "character"');
  const chosen = starter === "free" ? STARTER_SPECIES.find((name) => name === String(fields.starter).toUpperCase()) : starter;
  if (!chosen) throw new Error(`"starter" must be ${alternatives([...STARTER_SPECIES])}`);
  return { ...decision, character: fields.character.trim().slice(0, MAX_CHARACTER), starter: chosen };
}

export function runCharacter(events: readonly RunEvent[]): Decision | undefined {
  return modelEvents(events).findLast((e) => e.decision?.character)?.decision ?? undefined;
}

export function shownCharacter(calls: readonly ModelEvent[]): string | null {
  const character = runCharacter(calls)?.character;
  if (character) return character;
  return calls.length > 0 && !calls.some((call) => call.character) ? NORMAL_TRAINER : null;
}

function wantedStarter(events: readonly RunEvent[], starter: ModelSettings["starter"]): StarterSpecies | null {
  return starter === "free" ? (runCharacter(events)?.starter ?? null) : starter;
}

// Only the text of the last played action: a text of long ago must not force an answer to another question.
function lastPlayedText(events: readonly RunEvent[]): string {
  const last = events.findLast((e) => e.type === "action");
  return (last?.type === "action" && "text" in last.result && last.result.text.at(-1)) || "";
}

/** The answer that the program gives with no Model call: YES to a nickname, and the choice of the character at a Poké Ball of Professor Oak. */
export function forcedAnswer(asked: Asked, events: readonly RunEvent[], starter: ModelSettings["starter"]): "YES" | "NO" | null {
  if (asked.kind !== "choice" || !asked.options.includes("YES")) return null;
  const question = lastPlayedText(events);
  if (NICKNAME_QUESTION.test(question)) return "YES";
  const offered = STARTER_QUESTION.exec(question)?.[1];
  const wanted = wantedStarter(events, starter);
  if (!offered || !wanted) return null;
  return offered === wanted ? "YES" : "NO";
}
