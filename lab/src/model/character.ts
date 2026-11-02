import type { Decision, ModelEvent, ModelSettings, RunEvent } from "../harness/record";
import { modelEvents, STARTER_SPECIES, type StarterSpecies } from "../protocol";
import { MAX_NAME, NAME_KEYS, nameProblem, type TrainerNames } from "../save-file";
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
    name: { type: "string", description: `The name of your trainer, in ${MAX_NAME} characters at most.` },
    rival: { type: "string", description: `The name of the rival of your trainer, in ${MAX_NAME} characters at most.` },
  },
  required: [...DECISION_SCHEMA.required, "character", "starter", "name", "rival"],
};

function picked<T>(list: readonly T[], random: () => number): T {
  return list[Math.floor(random() * list.length)];
}

export function characterTurn(starter: ModelSettings["starter"], gameNames: TrainerNames | null, random: () => number = Math.random): string[] {
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
    gameNames
      ? `- The game already has your names: write ${gameNames.player} in "name" and ${gameNames.rival} in "rival".`
      : `- Choose the name of this trainer and the name of the rival of this trainer. Write them in "name" and "rival": ${MAX_NAME} characters at most for each one, no space at the start or the end, and only these characters: ${NAME_KEYS}`,
    `- Write in "character", in at most ${MAX_CHARACTER} characters: the style of the nicknames, then the trainer. You keep it for the whole Run. Then choose your action as usual.`,
  ];
}

function readName(fields: Record<string, unknown>, field: "name" | "rival"): string {
  const name = fields[field];
  if (typeof name !== "string") throw new Error(`the answer has no string "${field}"`);
  const problem = nameProblem(name);
  if (problem) throw new Error(`"${field}": ${problem}`);
  return name;
}

export function readCharacterDecision(content: string, starter: ModelSettings["starter"], gameNames: TrainerNames | null): Decision {
  const decision = readDecision(content);
  const fields = readFields(content);
  if (typeof fields.character !== "string" || fields.character.trim() === "") throw new Error('the answer has no string "character"');
  const chosen = starter === "free" ? STARTER_SPECIES.find((name) => name === String(fields.starter).toUpperCase()) : starter;
  if (!chosen) throw new Error(`"starter" must be ${alternatives([...STARTER_SPECIES])}`);
  const names = gameNames ?? { player: readName(fields, "name"), rival: readName(fields, "rival") };
  return { ...decision, character: fields.character.trim().slice(0, MAX_CHARACTER), starter: chosen, names };
}

export function runCharacter(events: readonly RunEvent[]): Decision | undefined {
  return modelEvents(events).findLast((e) => e.decision?.character)?.decision ?? undefined;
}

export function shownCharacter(calls: readonly ModelEvent[]): string | null {
  const decision = runCharacter(calls);
  if (decision?.character) return decision.names ? `${decision.names.player}, rival ${decision.names.rival}. ${decision.character}` : decision.character;
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
