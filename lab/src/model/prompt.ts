import type { BagItem, BagPocket, Teachable } from "../bag";
import { struggles } from "../battle";
import type { BattleTurn, FightFacts } from "../battle-facts";
import { type Milestone, MILESTONES, type WaitingFor } from "../game";
import { isStateEvent } from "../harness/game-events";
import type { ActionEntry, BattleState, NoProgress, Observation } from "../harness/harness";
import { type CallTurn, callTurns, type ModelEvent, type ModelSettings, type NodeRange, type RunEvent } from "../harness/record";
import { nicknamedSpecies } from "../menus";
import { type BoxMon, isHmMove, type PartyMon, type PartyMove, statLabel } from "../party";
import { actionText, modelEvents } from "../protocol";
import type { TrainerNames } from "../save-file";
import { characterTurn, runCharacter } from "./character";
import { actionsOf, alternatives, type Asked, type AskedKind, itemUse, MAX_SENTENCE, REFLECTION_EVERY, REMOVE_RULE, REVIEW_EVERY, sendable, teachableName } from "./decision";
import { fullAtlas, knownWorld, localView, moveObstacleHere } from "./extract";
import { type MemoryTree, nodeName, zoomLines } from "./memory-tree";
import { isExit, type Overworld, targetLines } from "./targets";

export const B_PRESSES = 3;
const LONG_TERM_GOAL = "Become the Champion: earn the 8 gym badges, then beat the Elite Four.";
const MAX_PAST_CALLS = 15;
const MAX_CALL_LINES = 30;
export const MAX_TRIES = 20;
const LOOP_AFTER = 3;
const MAX_OUTCOME = 200;
const WAITS: Record<AskedKind, string> = {
  walk: "a walk",
  choice: "a choice",
  battleAction: "a battle action",
  battleMove: "a move",
  partyPick: "a Pokémon in the party menu of the battle",
  shopMenu: "the shop menu of a Poké Mart",
  itemPc: "the item storage of a PC",
  pokemonPc: "the boxes of a PC",
  naming: "a name on the naming screen",
  learnMove: "a move to forget",
};
const MILESTONE_TEXTS: Record<Milestone, string> = {
  "has-pokemon": "Get your first Pokémon from Professor Oak in Pallet Town.",
  "first-rival-battle": "Battle your rival for the first time, in Professor Oak's lab in Pallet Town.",
  pokedex: "Get OAK'S PARCEL in Viridian City and bring it back to Professor Oak.",
  "badge-1": "Earn the Boulder Badge from Brock, the Gym Leader of Pewter City.",
  "badge-2": "Earn the Cascade Badge from Misty, the Gym Leader of Cerulean City.",
  "badge-3": "Earn the Thunder Badge from Lt. Surge, the Gym Leader of Vermilion City.",
  "badge-4": "Earn the Rainbow Badge from Erika, the Gym Leader of Celadon City.",
  "badge-5": "Earn the Soul Badge from Koga, the Gym Leader of Fuchsia City.",
  "badge-6": "Earn the Marsh Badge from Sabrina, the Gym Leader of Saffron City.",
  "badge-7": "Earn the Volcano Badge from Blaine, the Gym Leader of Cinnabar Island.",
  "badge-8": "Earn the Earth Badge from Giovanni, the Gym Leader of Viridian City.",
};
const MULTIPLIERS: Record<number, string> = { 0.25: "¼", 0.5: "½" };
const UNKNOWN_SCREEN = `The game showed a screen that no action covers: the program pressed B ${B_PRESSES} times.`;
const TEACH_RULE = "A TM works one time, then it leaves your Bag. An HM stays in your Bag. A Pokémon with 4 moves must forget a move to learn a new one: you choose the move, or you keep the 4 moves.";
const NICKNAME_RULE = "Give a nickname to each Pokémon that you get.";
const WORD_SCREEN_LEFT = "The game opened a screen to write the words of a profile, and you cannot write words: the program left it. A profile gives nothing in the game: choose NO when a person asks for your profile.";
const TRANSFERS = [
  ["withdraw", "take items from the PC and put them in your Bag", "withdraw POTION 2"],
  ["deposit", "put items of your Bag into the PC", "deposit POTION 1"],
] as const;
const LEAVE_PC = "- leave: go back to the menu of the PC, where you can turn the PC off.";
const ZOOM = "- zoom <a-b>: see the two halves of the node #a-b of your Memory tree, then choose again. The game does not move.";
const PRESS = "- press <button>: one press of A, B, Select, Up, Down, Left, Right, L or R.";

const WHITEOUT_ENDS =
  "If all your Pokémon faint, the Run ends. But a Run that plays too safe also makes no progress: do not wait for a perfect team, accept fair battles and explore. Before a difficult battle, heal your Pokémon. When a battle goes very badly, switch or `run`.";
const WHITEOUT_CONTINUES =
  "If all your Pokémon faint, the Run continues: you lose some money (more with more badges and a higher level), your party is healed, and you are back at the last Pokémon Center that you entered, or your home. Then you continue from there.";

function starterRule(starter: ModelSettings["starter"]): string {
  return starter === "free" ? "Take the first Pokémon that your character chose." : `Choose ${starter} as your first Pokémon.`;
}

function characterLine(events: readonly RunEvent[]): string[] {
  const decision = runCharacter(events);
  if (!decision) return [];
  const names = decision.names ? ` Your name: ${decision.names.player}. Your rival: ${decision.names.rival}.` : "";
  return [`Your character: ${decision.character} Your first Pokémon: ${decision.starter}.${names} Play as this trainer.`];
}

export function systemPrompt({ starter, stopAtWhiteout }: Pick<ModelSettings, "starter" | "stopAtWhiteout">, hasPokemon: boolean): string {
  const rules = [...(hasPokemon ? [] : [starterRule(starter)]), stopAtWhiteout ? WHITEOUT_ENDS : WHITEOUT_CONTINUES].join("\n");
  const offers = hasPokemon ? "" : "- When the game offers you your first Pokémon, the program answers for you: YES to the Pokémon of your character, NO to another. Then try another offer.\n";
  return `You play Pokémon FireRed. A program plays your actions in the game, and the game is frozen while you think.

Long-term goal: ${LONG_TERM_GOAL}
${rules}

At each decision, you get your Milestones, the next Milestone (the next big step of the story, with its name and place only), your Memory tree, your Bag, your money, your party, at a walk the Pokémon in your boxes and whether a REPEL is active, the part of the decision (at a walk, the Known world and the extract of your Atlas; in a battle, your Pokémon and the foe), what the game waits for, your Mission, your objective, the number of Decision points since your last progress, your tries, your last decisions with what the program played and the texts of the game, the important events since your last decision, and the actions that you can choose now. After ${REFLECTION_EVERY} Decision points with no progress, and after each ${REFLECTION_EVERY} more, you get a reflection turn at the next walk: the request to write a lesson and a new objective, and the full Atlas. Every ${REVIEW_EVERY} decisions, you get a review turn: the full Atlas, and a short check of your Mission and of your team against the facts. These two turns also list your TMs and HMs. After viewAtlas or zoom, or after an answer that the program cannot read, you get a new message at the same decision: answer again.

Your Memory tree is your notes, numbered from 1. Two neighbour nodes of the same size get a short summary, so you see only the top nodes: #a-b is the summary of the notes a to b, and #n is the note n. zoom <a-b> shows the two halves of a node; zoom again to go down to the notes.

At a walk, you get an extract of your Atlas: the map where you are, with all its rows and a legend of its signs, the edges that lead to another map, what the people of this map said to you, the fixed obstacles of this map (a cut tree, a rock or a boulder) with the move that removes each one, when your Bag has the HM or a Pokémon knows the move (until then, an obstacle or water is # on the map), the maps one exit away, and the targets. Each target has a letter, and its distance and direction from you. An exit shows the kind of place that a player sees, for example a house, a Pokémon Center or a cave entrance. It shows the name of the map where it leads only when you went through it, and it then also shows the cell where you arrive, when this cell is known. A ? cell is next to a cell where you can walk. It can be a wall: to see what it is, go to the target of its unseen cells, not to the ? cell. A blank cell is a cell that you did not see, and no cell that you saw leads to it. A line under the map tells when you saw all the cells of your part: then take an exit or a lead. An exit to a cave or a building also shows what is beyond it: unseen cells, an exit not taken, or nothing new. A map can have parts that no cell that you saw connects, and the way between them can go through other maps: a target in another part shows the number of exits to it, in place of its direction. With no known exits to it, it keeps its direction and says that no seen way goes there yet. The leads are what you did not explore in other parts and maps: unseen cells and exits not taken. Before the extract, the Known world gives one line for each town, city or route that you visited: its edges, the passages through a gate, a forest or a cave to another outdoor map, the buildings that you entered, the exits that you did not take with their cells, the groups of open cells next to unseen cells and the fixed obstacles.

In a battle, each fight action shows its effect on the foe, STAB (the move has a type of your Pokémon: ×1.5) and an estimate of its damage with no critical hit. Your Pokémon and the foe each show their status and their states, for example seeded or confused. You also get the last turn and the moves that you used on this foe, with their results. A move that has no effect also uses its PP. When no move of your Pokémon has PP, fight uses STRUGGLE (NORMAL, power 50): your Pokémon loses 1/4 of the damage that it does. A move that does no damage can help: it lowers a stat of the foe, puts it to sleep, poisons it or seeds it. Use it when it has an effect on this foe, mostly when the PP of your damage moves are low.

Answer with JSON:
- "reason": why you choose this action, in one or two short sentences.
- "action": exactly one of the actions of the message, for example "go B" or "choose NO".
- "mission": the story step that you work on, in one short sentence, for example "Find the Gym of the next town". Write it again unchanged at each decision. Change it only when the game shows that you reached it, or when the game gives you a new task. A try that fails or a person that is not where you expected does not change it: change the objective.
- "objective": what you do now for your Mission, in one short sentence, for example "Look for an exit on the north side of the town". Change it as often as you need.
- "note": a new note to keep in your Memory tree, in one line of at most ${MAX_SENTENCE} characters. A note is a fact that the game proved, for example "A person blocks the north exit of the town", or a lesson: what works, what fails and why, for example "Walks in the town gave nothing new: talk to the people first". A note can also be a guess that starts with "Guess:", for example "Guess: the Gym is in the north of the town", or the advice of a person that helps later, for example "A person said: you can never have too many Poké Balls". When one of your notes becomes false or ends, write a new note that says so, for example when the game disproves a guess, when a person moves, or when you beat a trainer that blocked a path. A note is never HP or PP values: the program removes a sentence that has them, and a note that repeats a recent note. It writes "Guess:" before a sentence with a word like "might" or "likely". Nobody changes a note later, and only a review turn can remove a sentence from your top nodes. Usually give an empty string: write a note after an important event or when you learn a lesson, and never write the same note again.
- "remove": only at a review turn: ${REMOVE_RULE}.

Rules of the program:
- The program reads all the texts for you, and waits while the game is busy. You see the texts in your last decisions.
- When the game shows a screen that no action covers, the program presses B ${B_PRESSES} times.
- "press" is one button press. Use it only when no other action fits.
- An action that is "impossible" changes nothing in the game: read its reason, then choose another action.
- People, objects and things to check are there for you to interact with. "go" walks next to them and interacts, and you read the text. An object can be a thing that you can take. A person or an object "in your way" stays there and no walk can pass it: interact with it. When nothing changes, the story needs another step first, so come back later.
${offers}- At the question of a nickname, the program answers YES for you.

When your last decisions give nothing new, do not do them again: try something that you did not try. Talk to the people, interact with the objects, check the signs and other things, take the exits that you did not take, go to the cells that you did not see. The story often continues in a place that you do not expect.

Advice of a good player:
- Check the signs and other things, and talk to the people: they often tell you the way and what to do.
- Write your guesses in your notes, then check them.
- When your Pokémon are weak, heal your Pokémon at a Pokémon Center.
- Keep your POTIONS for when they are necessary, for example before a difficult battle.
- You can use more than one Pokémon: catch more Pokémon and make a balanced team, with different types.
- When a wild battle goes badly, run.
- Before you fight a trainer, compare the levels of your Pokémon and of the Pokémon of the trainer.
- When the trainers ahead are stronger than your Pokémon, train your Pokémon in the tall grass first.
- To train a weak Pokémon, put it first with \`swap\`, then \`switch\` to a strong one when the battle is difficult: each Pokémon that took part in a battle gets experience.
- Buy Poké Balls, Potions and REPELS at a Poké Mart.
- A REPEL stops wild Pokémon with a level below your first healthy Pokémon for 100 steps. Use it to cross a cave when your team is ready: a battle that you avoid gives no experience.
- Take each ITEM BALL that you can reach: it is a free item, and it costs only the walk.
- ${TEACH_RULE}
- Each Pokémon Center has a PC. It keeps your items and your Pokémon. A Pokémon that you catch with 6 Pokémon in your party goes to a box. At the PC, put a weak Pokémon in a box to make a place before you catch a new one, and take a Pokémon from a box when it suits the next battle.
- ${NICKNAME_RULE} Write a name in the style of your character when you have one, different from the name of the species. A nickname costs nothing, because the game is frozen while you choose. It also tells two Pokémon of the same species apart in \`swap\` and \`switch\`.
- When the way is closed, explore and talk to the people: the game opens it when you do what it asks.
- When an action gives no progress, do not do it again: try a new place, a new person or a new exit.
- Your Memory tree keeps what you learned and tried: read it, and use zoom for a detail, before you choose.`;
}

const REFLECTION = [
  "Reflection turn: stop and think before you act.",
  "- Read your Memory tree and the full Atlas above. Use zoom freely to see the details of a node: zoom does not end this turn.",
  '- Write in "note" a lesson: what you tried, why it failed, and what you will do now.',
  '- Set a new "objective" that follows this lesson.',
];

const REVIEW = [
  "Review turn: check your plan against the facts before you act.",
  "- Where are you on the way to the next Milestone?",
  "- Do the facts of your Memory tree and of the full Atlas above still agree with your Mission?",
  "- What do the things that you checked and the people tell you? Which of your guesses do they confirm?",
  "- Which exits, edges, unseen cells and leads are left to explore?",
  "- Is your team ready for the next Milestone? Look at the levels, the HP, the status and the PP: does a weak Pokémon need training, do you need a Pokémon Center or items from a Poké Mart?",
  `- Write in "remove" ${REMOVE_RULE}. The number of a sentence is the [n] before it. You cannot change a sentence.`,
  '- Write the result in "mission" (change it only when the facts disagree with it), in "objective", and in a short "note".',
];

export type TurnKind = "normal" | "character" | "reflection" | "review";

export type PromptState = { noProgress: NoProgress; turn: TurnKind; happened: string[]; request: string[]; memory: string[] };

/** The request of a turn. The bot calls it once for each conversation, because a character turn selects an idea at random. */
export function turnRequest(turn: TurnKind, starter: ModelSettings["starter"], gameNames: TrainerNames | null): string[] {
  if (turn === "character") return characterTurn(starter, gameNames);
  if (turn === "reflection") return REFLECTION;
  return turn === "review" ? REVIEW : [];
}

export function showsAtlas(turn: TurnKind): boolean {
  return turn === "reflection" || turn === "review";
}

export function turnKind(kind: WaitingFor["kind"], events: readonly RunEvent[], noProgress: NoProgress, partySize: number): TurnKind {
  if (partySize === 0 && !runCharacter(events)) return "character";
  if (kind !== "walk") return "normal";
  if (reflectionDue(events, noProgress)) return "reflection";
  return reviewDue(events) ? "review" : "normal";
}

function reflectionDue(events: readonly RunEvent[], { stuck, since }: NoProgress): boolean {
  const block = Math.floor(stuck / REFLECTION_EVERY);
  const done = modelEvents(events.slice(since)).some((e) => e.reflection && Math.floor((e.stuck ?? 0) / REFLECTION_EVERY) === block);
  return block > 0 && !done;
}

function reviewDue(events: readonly RunEvent[]): boolean {
  const turns = callTurns(events);
  const last = turns.findLastIndex((turn) => turn.call?.review || turn.call?.reflection);
  return turns.slice(last + 1).filter((turn) => turn.call && turn.events.some((e) => e.type === "action")).length >= REVIEW_EVERY;
}

export function userPrompt(observation: Observation, asked: Asked, events: readonly RunEvent[], { noProgress, turn, happened, request, memory }: PromptState): string {
  const read = modelEvents(events).flatMap((e) => (e.decision ? [e.decision] : []));
  const answers = answeredTurns(events);
  const calls = pastCalls(answers);
  const tried = tries(events, noProgress.since, answers);
  const known = asked.kind === "walk" ? knownWorld(asked.overworld) : [];
  const world = known.length === 0 ? [] : [...known, ""];
  // A provider caches only the start that two prompts share, so the parts that change little come first.
  return [
    `Milestones: ${observation.milestones.join(", ") || "none"}`,
    `Next Milestone: ${nextMilestone(observation.milestones) ?? "none: you reached all the Milestones."}`,
    ...characterLine(events),
    "",
    memoryText(memory),
    "",
    ...world,
    bagText(observation.bag),
    `Money: ${observation.money}`,
    partyText(observation.party),
    ...(asked.kind === "walk" ? walkFacts(asked.overworld) : []),
    "",
    ...context(asked),
    ...(showsAtlas(turn) && asked.kind === "walk" ? [...fullAtlas(asked.overworld), ...teachDetails(asked)] : []),
    ...(asked.kind === "walk" ? fieldMoveHints(asked) : []),
    "",
    waitLine(asked, events),
    missionLine(events),
    `Objective: ${read.findLast((d) => d.objective)?.objective || "none yet"}`,
    `Decision points since your last progress (a new map, a new Milestone, a new exit seen, a level up, a new text of a person, a trainer beaten, an item found or a new species caught): ${noProgress.stuck}.`,
    ...request,
    tried.length === 0 ? "Your tries since the last progress: none." : ["Your tries since the last progress:", ...tried].join("\n"),
    ...loopWarning(answers),
    "",
    calls.length === 0 ? "Your last decisions: none yet." : ["Your last decisions, oldest first:", ...calls].join("\n"),
    "",
    ...(happened.length === 0 ? [] : [...happened.map((fact) => `Something important happened: ${fact}.`), "Write a note if it can help you later.", ""]),
    "Actions:",
    ...actionLines(asked),
    ZOOM,
    ...(actionsOf(asked).includes("press") ? [PRESS] : []),
  ].join("\n");
}

/** The question of a choice is the last text that the game showed: the texts of the last played action that had some. A zoom or a viewAtlas plays nothing, so it does not hide the question. */
function lastText(events: readonly RunEvent[]): string | undefined {
  return events.flatMap((e) => (e.type === "action" && "text" in e.result ? e.result.text : [])).at(-1);
}

function waitLine(asked: Asked, events: readonly RunEvent[]): string {
  if (asked.kind !== "choice") return `The game waits for ${WAITS[asked.kind]}.`;
  const question = lastText(events);
  if (!question) return `The game waits for ${WAITS.choice}: ${asked.options.join(", ")}.`;
  const line = `The game asks: "${question}" Choose ${alternatives(asked.options)}.`;
  return line;
}

export function atlasMessage(asked: Asked & { kind: "walk" }): string {
  return [...fullAtlas(asked.overworld).slice(1), "", chooseAgain({ ...asked, atlasShown: true })].join("\n");
}

export function zoomMessage(tree: MemoryTree, node: NodeRange, asked: Asked): string {
  const halves = zoomLines(tree, node);
  const shown = halves ? [`Node ${nodeName(node)}, its two halves:`, ...halves] : [`There is no node ${nodeName(node)} with two halves: zoom a top node of your Memory tree, or a half that a zoom showed.`];
  return [...shown, "", chooseAgain(asked)].join("\n");
}

/** The Harness refused the action, so the game is at the same Decision point: the conversation goes on with the reason. */
export function impossibleMessage(action: string, reason: string, asked: Asked): string {
  const exits = asked.kind === "walk" ? targetLines(asked.view.targets, isExit) : [];
  const hint = exits.length > 0 && /^go(To)?\b/.test(action) ? ["To leave this map, go to one of its exits (go <letter>):", ...exits] : [];
  return [`Your action "${action}" is impossible: ${reason}. The player did not move.`, ...hint, "", chooseAgain(asked)].join("\n");
}

export function errorMessage(error: string, asked: Asked): string {
  return [`Your answer could not be read: ${error}.`, "", chooseAgain(asked)].join("\n");
}

function chooseAgain(asked: Asked): string {
  return `Answer with JSON again, with one of the actions of the first message: ${alternatives(actionsOf(asked))}.`;
}

function memoryText(lines: string[]): string {
  return lines.length === 0 ? "Memory tree: none yet." : ["Memory tree, the top nodes (zoom <a-b> opens a node):", ...lines].join("\n");
}

export function missionLine(events: readonly RunEvent[]): string {
  const decisions = modelEvents(events).flatMap((e) => (e.decision ? [e.decision] : []));
  const mission = decisions.findLast((d) => d.mission)?.mission;
  if (!mission) return "Mission: none yet.";
  // An empty Mission keeps the last one.
  const times = decisions.length - 1 - decisions.findLastIndex((d) => d.mission && d.mission !== mission);
  return `Mission: ${mission} (the same for ${times} decision${times === 1 ? "" : "s"}).`;
}

export function nextMilestone(reached: readonly Milestone[]): string | null {
  const next = MILESTONES.find((milestone) => !reached.includes(milestone));
  return next ? MILESTONE_TEXTS[next] : null;
}

export function situation(asked: Asked): string {
  if (asked.kind !== "walk") return WAITS[asked.kind];
  const { map, player } = asked.overworld;
  return `a walk on ${map.name} (${player.x}, ${player.y})`;
}

type AnsweredTurn = CallTurn & { call: ModelEvent };

function answeredTurns(events: readonly RunEvent[]): AnsweredTurn[] {
  return callTurns(events).flatMap((turn) => (turn.call ? [{ call: turn.call, events: turn.events }] : []));
}

// The last Model calls, each with what the program played and the game did until the next one.
function pastCalls(answers: AnsweredTurn[]): string[] {
  return answers.slice(-MAX_PAST_CALLS).map(({ call, events: after }) => {
    const lines = after.flatMap(eventLines);
    const answer = call.decision ? `You chose: ${call.decision.action}` : `Your answer could not be read: ${call.error}`;
    const shown = lines.length > MAX_CALL_LINES ? [`… ${lines.length - MAX_CALL_LINES + 1} lines before`, ...lines.slice(-(MAX_CALL_LINES - 1))] : lines;
    return [`- At ${call.situation}. ${answer}`, ...shown.map((line) => `  ${line}`)].join("\n");
  });
}

type Try = { action: string; result: ActionEntry["result"]; texts: string[] };

// After a Model call the program plays the answer, then reads the texts and can press B: only the actions before the first readText are tries.
// The turn of the last progress counts from its Model call, so that its end (the code's B presses) is not a try.
export function tries(events: readonly RunEvent[], since: number, answers = answeredTurns(events)): string[] {
  const recent = new Set(events.slice(since));
  const first = Math.max(0, modelEvents(events.slice(0, since + 1)).length - 1);
  const played = answers.slice(first).flatMap((turn) => answerTries(turn.events, (a) => recent.has(a)));
  const grouped = new Map<string, { action: string; outcome: string; times: number }>();
  for (const t of played) {
    const key = described(t);
    const group = grouped.get(key) ?? { action: t.action, outcome: outcome(t), times: 0 };
    group.times++;
    grouped.set(key, group);
  }
  const lines = [...grouped.values()].map((g) => `- ${g.action} ×${g.times}: ${g.outcome}`);
  return lines.length <= MAX_TRIES ? lines : [`- … and ${lines.length - MAX_TRIES} other tries before`, ...lines.slice(-MAX_TRIES)];
}

function answerTries(events: readonly RunEvent[], keep: (event: RunEvent) => boolean = () => true): Try[] {
  const actions = events.flatMap((e) => (e.type === "action" ? [e] : []));
  const read = actions.findIndex((a) => a.action.name === "readText");
  const answer = (read === -1 ? actions : actions.slice(0, read)).filter(keep);
  const textsAfter = actions.slice(read === -1 ? actions.length : read).flatMap((a) => (a.action.name === "readText" && "text" in a.result ? a.result.text : []));
  return answer.map((a, i) => ({
    action: actionText(a.action),
    result: a.result,
    texts: [...("text" in a.result ? a.result.text : []), ...(i === answer.length - 1 ? textsAfter : [])],
  }));
}

function described(t: Try): string {
  return `${t.action}: ${outcome(t)}`;
}

function loopWarning(answers: AnsweredTurn[]): string[] {
  const last = answers
    .map((turn) => answerTries(turn.events).map(described).join("; "))
    .filter(Boolean)
    .slice(-LOOP_AFTER);
  return last.length === LOOP_AFTER && last.every((played) => played === last[0])
    ? [`Warning: your last ${LOOP_AFTER} decisions played the same action with the same result: ${last[0]}. If it does not bring you closer to your objective, choose another action.`]
    : [];
}

function outcome({ result, texts }: Try): string {
  const status = result.status === "done" ? (texts.length > 0 ? "" : "done") : `${result.status}${"reason" in result ? ` (${result.reason})` : ""}`;
  const text = [status, texts.map((t) => `"${t}"`).join(" ")].filter(Boolean).join(", ");
  return text.length > MAX_OUTCOME ? `${text.slice(0, MAX_OUTCOME - 1)}…` : text;
}

function eventLines(event: Exclude<RunEvent, ModelEvent>): string[] {
  // The prompt does not use the state events yet.
  if (isStateEvent(event)) return [];
  switch (event.type) {
    case "action": {
      const { action, result } = event;
      const reason = "reason" in result ? ` (${result.reason})` : "";
      const texts = "text" in result ? result.text.map((text) => `  "${text}"`) : [];
      const lines = [`${actionText(action)}: ${result.status}${reason}, ${result.frames} frames`, ...texts];
      if (result.leftWordScreen) lines.push(WORD_SCREEN_LEFT);
      // The Bot reads only at a text or when the game is busy: there, readText is impossible only on an unknown screen.
      return action.name === "readText" && result.status === "impossible" ? [...lines, UNKNOWN_SCREEN] : lines;
    }
    case "map":
      return [`now on map ${event.map}`];
    case "battle":
      return [event.state === "start" ? "a battle starts" : "the battle ends"];
    case "milestone":
    case "summary":
      return [];
  }
}

function monName({ nickname, species }: Pick<PartyMon, "nickname" | "species">): string {
  return nickname === species ? species : `${nickname} (${species})`;
}

function boxMonText(mon: BoxMon): string {
  return `${monName(mon)} level ${mon.level}, ${mon.boxName}`;
}

function walkFacts({ boxes, repelActive }: Overworld): string[] {
  return [...(boxes.length > 0 ? [`In the boxes: ${boxes.map(boxMonText).join("; ")}.`] : []), ...(repelActive ? ["A REPEL is active."] : [])];
}

function partyText(party: PartyMon[]): string {
  if (party.length === 0) return "Party: none.";
  const mon = (m: PartyMon, slot: number) => {
    const about = [
      `${slot + 1}. ${monName(m)}: level ${m.level}, HP ${m.hp}/${m.maxHp}, status ${m.status}`,
      `Type ${m.types.join(", ")}`,
      `Ability ${m.ability.name}: ${m.ability.description.replace(/\.$/, "")}`,
      `Held item ${m.heldItem ?? "none"}`,
      `Nature ${m.nature}`,
      `Stats: ${statsText(m.stats)}`,
      `EXP ${m.exp}, ${m.expToNextLevel} to the next level.`,
    ];
    return [about.join(". "), ...m.moves.map((move) => `  - ${move.name}: ${moveText(move)}. ${move.description}`)].join("\n");
  };
  return ["Party:", ...party.map(mon)].join("\n");
}

function bagText(bag: BagPocket[]): string {
  if (bag.length === 0) return "Bag: empty.";
  const pocket = ({ pocket, items }: BagPocket) => `- ${pocket}: ${items.map((i) => `${i.name} ×${i.quantity} (${i.description})`).join(", ")}`;
  return ["Bag:", ...bag.map(pocket)].join("\n");
}

function moveText(move: PartyMove): string {
  return `${move.type}, power ${move.power ?? "---"}, accuracy ${move.accuracy ?? "---"}, PP ${move.pp}/${move.maxPp}`;
}

function statsText(stats: Record<string, number>): string {
  return Object.entries(stats)
    .map(([stat, value]) => `${statLabel(stat)} ${value}`)
    .join(", ");
}

function context(asked: Asked): string[] {
  switch (asked.kind) {
    case "walk":
      return asked.view.lines;
    case "choice":
      if ("battle" in asked) return battleLines(asked.battle, asked.party);
      return [...(asked.storage === undefined ? [] : [pcLine(asked.options[asked.storage])]), ...localView(asked.overworld, [])];
    case "shopMenu": {
      const buys = asked.sellable.length === 0 ? ["The Poké Mart buys none of the items of your Bag."] : ["The Poké Mart buys these items of your Bag (the money for one item):", ...asked.sellable.map((item) => `- ${item.name} ×${item.quantity}: ${item.price / 2}`)];
      return ["The Poké Mart sells (the price of one item):", ...asked.forSale.map((item) => `- ${item.name}: ${item.price}. ${item.description}`), "", ...buys];
    }
    case "itemPc": {
      const stored = asked.pcItems.length === 0 ? ["The PC has no items."] : ["The items in the PC:", ...asked.pcItems.map((item) => `- ${item.name} ×${item.quantity}`)];
      const bag = asked.depositable.length === 0 ? ["The ITEMS pocket of your Bag is empty."] : ["The items of the ITEMS pocket of your Bag (only these go into the PC):", ...asked.depositable.map((item) => `- ${item.name} ×${item.quantity}`)];
      return [...stored, "", ...bag];
    }
    case "pokemonPc":
      return asked.boxes.length === 0 ? ["The boxes are empty."] : ["The Pokémon in the boxes:", ...asked.boxes.map((mon, row) => `${row + 1}. ${boxMonText(mon)}`)];
    case "naming":
      return [`The naming screen asks for ${asked.subject}, ${asked.maxLength} characters at most.`];
    case "learnMove": {
      const { nickname, moves } = asked.party[asked.slot];
      const { move } = asked;
      return [
        `${nickname} wants to learn ${move.name} (${moveText(move)}). ${move.description}`,
        `It already knows ${moves.length} moves. To learn ${move.name}, it must forget one of them:`,
        ...moves.map((known, i) => `- ${i + 1}. ${known.name}: ${moveText(known)}. ${known.description}${isHmMove(known.name) ? " It is an HM move: it cannot be forgotten." : ""}`),
        "This is an important choice. Before you choose, count your damage moves and compare their PP.",
      ];
    }
    default:
      return battleLines(asked.battle, asked.party);
  }
}

function pcLine(storage: string): string {
  return `This is a PC: the PC with your name has ITEM STORAGE, which keeps your items. ${storage} opens the boxes, which keep your Pokémon.`;
}

function actionLines(asked: Asked): string[] {
  switch (asked.kind) {
    case "walk": {
      const { grid } = asked.overworld;
      return [
        ...(asked.view.targets.length === 0 ? [] : ["- go <letter>: walk to the target, for example go B. At an exit, take it. At a person, an object or something you can check, walk next to it, then interact with it."]),
        `- goTo <x> <y>: walk to a cell of this map, x from 0 to ${grid.mapWidth - 1}, y from 0 to ${grid.mapHeight - 1}, or cross an edge of the list of edges. Prefer go: use goTo only for a cell that you read in the grid.`,
        "- goTo <x> <y> <map>: walk to a cell of another map.",
        ...useLine(asked),
        ...teachLine(asked),
        ...(actionsOf(asked).includes("swap") ? [`- swap <Pokémon> <Pokémon>: change the order of two Pokémon of your party. The first Pokémon starts the next battle.${pokemonHelp(asked.party)}`] : []),
        ...(actionsOf(asked).includes("viewAtlas") ? ["- viewAtlas: get the full Atlas, all the maps that you know in detail, then choose again. The game does not move. One time at most at each decision."] : []),
      ];
    }
    case "choice":
      return asked.options.map((option) => `- choose ${option}`);
    case "battleAction":
      return [
        ...fights(asked.battle),
        ...partyLine(asked, "switch", "take your Pokémon out of the battle and send this one"),
        `- run${asked.battle.kind === "trainer" ? ": impossible in a trainer battle" : ""}`,
        ...useLine(asked),
      ];
    case "battleMove":
      return fights(asked.battle);
    case "partyPick":
      return partyLine(asked, "send", "send this Pokémon into the battle");
    case "shopMenu":
      return [
        "- buy <item> <quantity>: buy items for sale, for example buy POTION 2. Your money must pay the price of all the items.",
        ...(actionsOf(asked).includes("sell") ? ["- sell <item> <quantity>: sell items of your Bag that the Poké Mart buys, for example sell POTION 1."] : []),
        "- leave: say goodbye to the clerk and walk again.",
      ];
    case "itemPc":
      return [
        ...TRANSFERS.filter(([name]) => actionsOf(asked).includes(name)).map(([name, help, example]) => `- ${name} <item> [quantity]: ${help}, for example ${example}. The quantity is 1 when you do not give it.`),
        LEAVE_PC,
      ];
    case "pokemonPc":
      return [
        `- deposit <Pokémon>: put a Pokémon of your party in a box.${pokemonHelp(asked.party)}`,
        ...(actionsOf(asked).includes("withdraw") ? [`- withdraw <Pokémon>: take a Pokémon from a box and put it in your party. Write its number in the list of the boxes, its name, or both, for example 1 ${asked.boxes[0].nickname}.`] : []),
        LEAVE_PC,
      ];
    case "naming":
      return [
        `- name <text>: type the text and press OK, for example name Sparky. The keys of the keyboard: ${keyList(asked.keys)} A " in the text types “ or ”.`,
        ...(nicknamedSpecies(asked.subject) ? [] : ["- name: keep the name that the game gives."]),
      ];
    case "learnMove": {
      const { nickname, moves } = asked.party[asked.slot];
      const forgettable = moves.filter((known) => !isHmMove(known.name));
      return [
        `- forget <move>: forget this move and learn ${asked.move.name}, for example forget ${(forgettable[0] ?? moves[0]).name}. <move> is the name of a move above, or its place, 1 to ${moves.length}.`,
        `- keep: keep the ${moves.length} moves. ${nickname} does not learn ${asked.move.name}.`,
      ];
    }
  }
}

// The space has no sign of its own.
function keyList(keys: string[]): string {
  const signs = keys.filter((key) => key !== " ").join("");
  return keys.includes(" ") ? `${signs} and the space.` : `${signs}.`;
}

function useLine(asked: Asked & { items: BagItem[] }): string[] {
  if (asked.items.length === 0) return [];
  const names = asked.items.map((item) => (itemUse(item, asked) === "pokemon" ? `${item.name} (on a Pokémon)` : item.name));
  return [`- use <item> [on <Pokémon>]: use an item of your Bag. The items that work now: ${names.join(", ")}.${pokemonHelp(asked.party)}`];
}

type WalkAsked = Asked & { kind: "walk" };

function teachLine({ overworld: { teachables } }: WalkAsked): string[] {
  return teachables.length === 0 ? [] : [`- teach <TM or HM> on <Pokémon>: teach its move to a Pokémon of your party, for example teach ${teachables[0].item} on 1. Your Bag has: ${teachables.map(teachableName).join(", ")}.`];
}

function teachDetails({ overworld: { teachables }, party }: WalkAsked): string[] {
  if (teachables.length === 0) return [];
  const mons = (slots: number[]) => slots.map((slot) => monPlace(party, slot)).join(", ");
  const about = ({ item, move, able, knowing }: Teachable) => [`- ${item}: ${move.name} (${moveText(move)}). ${move.description} Can learn it: ${mons(able) || "none"}.`, ...(knowing.length === 0 ? [] : [`Knows it: ${mons(knowing)}.`])].join(" ");
  return ["", `Your TMs and HMs. ${TEACH_RULE}`, ...teachables.map(about), "Does one of these moves help your Objective?"];
}

function fieldMoveHints({ overworld }: WalkAsked): string[] {
  return overworld.teachables.flatMap((teachable) => {
    if (teachable.knowing.length > 0 || !moveObstacleHere(teachable.move.name, overworld)) return [];
    return [`Your Bag has ${teachableName(teachable)}. It can help on this map${teachable.able.length > 0 ? ": teach it." : ", but no Pokémon of your party can learn it."}`];
  });
}

function partyLine(asked: Asked, name: "switch" | "send", help: string): string[] {
  const slots = sendable(asked);
  return slots.length === 0 ? [] : [`- ${name} <Pokémon>: ${help}.${pokemonHelp(asked.party, slots)}`];
}

function monPlace(party: PartyMon[], slot: number): string {
  return `${slot + 1} ${party[slot].nickname}`;
}

/** The help for `<Pokémon>`, with a space before it. No help when there is no place to name. */
function pokemonHelp(party: PartyMon[], slots: Iterable<number> = party.keys()): string {
  const mons = [...slots].map((slot) => monPlace(party, slot));
  if (mons.length === 0) return "";
  return ` <Pokémon> can be ${mons.join(", ")}. Write its place in the party, its name, or both, for example ${mons[0]}.`;
}

function fights({ player, fights: facts }: BattleState): string[] {
  if (struggles(player)) return [`- fight 0: no move of ${player.nickname} has PP, so ${player.nickname} uses STRUGGLE (NORMAL, power 50) and loses 1/4 of the damage that it does.`];
  return player.moves.flatMap((move, i) => {
    if (player.encoredSlot !== null && player.encoredSlot !== i) return [];
    const fact = facts[i];
    const about = move.pp === 0 ? ". No PP: you cannot use it." : !fact ? "" : "noEffect" in fact ? `. No effect: ${fact.noEffect}.` : `. On the foe: ${fightText(fact)}.`;
    return [`- fight ${i}: ${move.name} (${moveText(move)})${about}${player.encoredSlot === i ? " The ENCORE allows only this move." : ""}`];
  });
}

function fightText({ effect, stab, estimate }: Exclude<FightFacts, { noEffect: string }>): string {
  const name = effect === 0 ? "no effect" : effect < 1 ? "not very effective" : effect > 1 ? "super effective" : "normal effect";
  return [
    `${name} ×${MULTIPLIERS[effect] ?? effect}`,
    ...(stab ? ["STAB"] : []),
    ...(estimate ? [`${rangeText(estimate.minPercent, estimate.maxPercent, "%")} of its HP now`, `${rangeText(estimate.minHits, estimate.maxHits)} hit${estimate.maxHits === 1 ? "" : "s"} to KO`] : []),
  ].join(", ");
}

function rangeText(min: number, max: number, unit = ""): string {
  return min === max ? `${min}${unit}` : `${min}${unit} to ${max}${unit}`;
}

function battleLines(battle: BattleState, party: PartyMon[]): string[] {
  const { player, enemy, lastTurn, foeTurns } = battle;
  const used = foeTurns.flatMap((turn) => turn.moves.filter((m) => m.user === turn.player.before.name).map((m) => `${m.move} (${[...m.results, `its HP ${turn.foe.before.hp} → ${turn.foe.after.hp}`].join(", ")})`));
  return [
    `Battle against ${battle.kind === "trainer" ? "a trainer" : "a wild Pokémon"}.`,
    `Your ${player.nickname}: level ${player.level}, HP ${player.hp}/${player.maxHp}, status ${player.status}. States: ${player.states.join(", ") || "none"}. Stats: ${statsText(player.stats)}. Stat stages: ${stagesText(player.statStages)}.`,
    `Foe ${enemy.species} (${enemy.types.join(", ")}): level ${enemy.level}, HP ${enemy.hpPercent}%, status ${enemy.status}. States: ${enemy.states.join(", ") || "none"}. Stat stages: ${stagesText(enemy.statStages)}. Moves seen: ${enemy.movesSeen.join(", ") || "none"}.`,
    ...(battle.kind === "wild" ? [ownedLine(enemy.species, party.filter((mon) => mon.species === enemy.species).length, battle.inPc)] : []),
    ...(lastTurn ? [turnLine(lastTurn)] : []),
    ...(used.length > 0 ? [`Your moves on this foe: ${used.join(", ")}.`] : []),
    ...(fewDamagePp(player.moves) ? ["Your damage moves have few PP: use the other moves that have an effect, or switch."] : []),
  ];
}

/** All the damage moves together have a quarter of their PP or less, and a move still has PP. */
function fewDamagePp(moves: PartyMove[]): boolean {
  const damage = moves.filter((move) => move.power !== null || move.fixedDamage);
  const sum = (pp: (move: PartyMove) => number) => damage.reduce((total, move) => total + pp(move), 0);
  return damage.length > 0 && sum((move) => move.pp) * 4 <= sum((move) => move.maxPp) && moves.some((move) => move.pp > 0);
}

function ownedLine(species: string, inParty: number, inPc: number): string {
  return inParty + inPc === 0 ? `You own no ${species}.` : `You own ${inParty + inPc} ${species}: ${inParty} in the party, ${inPc} in the PC.`;
}

function turnLine({ moves, player, foe }: BattleTurn): string {
  const first = moves.length > 1 ? [`${moves[0].user} moved first.`] : [];
  const used = moves.map((m) => `${m.user} used ${m.move}${m.results.length > 0 ? `: ${m.results.join(", ")}` : ""}.`);
  return ["Last turn:", ...first, ...used, `Your ${sideText(player)}.`, `Foe ${sideText(foe)}.`].join(" ");
}

function sideText({ before, after }: BattleTurn["player"]): string {
  return before.name === after.name ? `${before.name}: HP ${before.hp} → ${after.hp}` : `${before.name}: HP ${before.hp}, then ${after.name}: HP ${after.hp}`;
}

function stagesText(stages: Record<string, number>): string {
  const changed = Object.entries(stages).filter(([, stage]) => stage !== 0);
  return changed.map(([stat, stage]) => `${statLabel(stat)} ${stage > 0 ? "+" : ""}${stage}`).join(", ") || "none";
}
