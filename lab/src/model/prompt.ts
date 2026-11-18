import { BICYCLE, type BagItem, type BagPocket, battleBag, type ItemUse, type Stone, type Teachable } from "../bag";
import { type Milestone, MILESTONES, type WaitingFor } from "../game";
import type { NoProgress, Observation } from "../harness/harness";
import { callTurns, isDecision, type ModelSettings, type NodeRange, type RunEvent, sinceLastCall, textsOf } from "../harness/record";
import { nicknamedSpecies } from "../menus";
import { type BoxMon, hasTakableItem, isDamageMove, isHmMove, type PartyMon, type PartyMove, type Status, walkStatus } from "../party";
import { badgeNeeded, hoursText, modelEvents, timeLimitHours, whiteoutKind } from "../protocol";
import type { TrainerNames } from "../save-file";
import { battleLines, fights, itemEstimates } from "./battle-text";
import { characterTurn, runCharacter } from "./character";
import { COACH_DUTY, COACH_INTRO, COACH_RULE } from "./coach";
import { actionsOf, alternatives, type Asked, type BattleAsked, inBattle, itemUse, MAX_SENTENCE, REFLECTION_EVERY, REMOVE_RULE, REVIEW_EVERY, sendable, teachableName } from "./decision";
import { darkOfMap, fullAtlas, knownWorld, localView, moveObstacleHere } from "./extract";
import { answeredTurns, B_PRESSES, finishedBattles, loopWarning, pastCalls, returnLine, sinceBattleStart, tries, WAITS, walkHistory } from "./history";
import { type MemoryTree, nodeName, zoomLines } from "./memory-tree";
import { bagText, boxMonText, itemText, monName, monPlace, moveAtMaxPp, moveText, partyText, pokemonHelp } from "./party-text";
import { isExit, type Overworld, targetLines } from "./targets";

const LONG_TERM_GOAL = "Become the Champion: earn the 8 gym badges, then beat the Elite Four.";
const MIN_CROSSINGS = 6;
const MILESTONE_TEXTS: Record<Milestone, string> = {
  "has-pokemon": "Get your first Pokémon from Professor Oak in Pallet Town.",
  "first-rival-battle": "Battle your rival for the first time, in Professor Oak's lab in Pallet Town.",
  pokedex: "Get the Pokédex.",
  "badge-1": "Earn the Boulder Badge from Brock, the Gym Leader of Pewter City.",
  "badge-2": "Earn the Cascade Badge from Misty, the Gym Leader of Cerulean City.",
  "badge-3": "Earn the Thunder Badge from Lt. Surge, the Gym Leader of Vermilion City.",
  "badge-4": "Earn the Rainbow Badge from Erika, the Gym Leader of Celadon City.",
  "badge-5": "Earn the Soul Badge from Koga, the Gym Leader of Fuchsia City.",
  "badge-6": "Earn the Marsh Badge from Sabrina, the Gym Leader of Saffron City.",
  "badge-7": "Earn the Volcano Badge from Blaine, the Gym Leader of Cinnabar Island.",
  "badge-8": "Earn the Earth Badge from Giovanni, the Gym Leader of Viridian City.",
};
const AS_IS = (status: Status): Status => status;
const TEACH_RULE = "A TM works one time, then it leaves your Bag. An HM stays in your Bag. A Pokémon with 4 moves must forget a move to learn a new one: you choose the move, or you keep the 4 moves.";
const NICKNAME_RULE = "Give a nickname to each Pokémon that you get.";
const TRANSFERS = [
  ["withdraw", "take items from the PC and put them in your Bag", "withdraw POTION 2"],
  ["deposit", "put items of your Bag into the PC", "deposit POTION 1"],
] as const;
const LEAVE_PC = "- leave: go back to the menu of the PC, where you can turn the PC off.";
const ZOOM = "- zoom <a-b>: see the two halves of the node #a-b of your Memory tree, then choose again. The game does not move.";
const PRESS = "- press <button>: one press of A, B, Select, Up, Down, Left, Right, L or R.";
const REPEL_ITEMS = ["REPEL", "SUPER REPEL", "MAX REPEL"];
const REPEL_FACTS = "A REPEL stops wild battles with Pokémon of a lower level than the first Pokémon of your party that has not fainted, for 100 steps (SUPER REPEL 200, MAX REPEL 250). Use it to explore without fights. Do not use it when your Pokémon need experience.";
const REPEL_WORE_OFF = /REPEL's effect wore off/;
const SURFING_LINE = "You are on the water with SURF.";
const BOULDERS_MOVED = "Leave this map and return to it: each boulder then returns to its first cell.";
const PUSH_LINE = "- push <x> <y> <direction> [steps]: walk behind the boulder at (x, y), then push it steps cells to the north, south, west or east (1 when you do not give steps), for example push 2 0 south. A walk never pushes a boulder.";
const BICYCLE_FACTS = "Riding the BICYCLE takes 6 frames per cell, running takes 8. It costs no extra decision: your choice stays after a door.";
const MAX_BOX_LINES = 12;

const WHITEOUT_CARE = "So before a difficult battle, train your team and heal your Pokémon. When a battle goes very badly, switch or `run`. But a Run that plays too safe also makes no progress: train up to a level that you choose, then continue.";
const WHITEOUT_COST = "you lose some money (more with more badges and a higher level), your party is healed, and you are back at the last Pokémon Center that you entered, or your home";
const WHITEOUT_ENDS = `If all your Pokémon faint, the Run ends. ${WHITEOUT_CARE}`;
const WHITEOUT_CONTINUES = `If all your Pokémon faint, the Run continues: ${WHITEOUT_COST}. Then you continue from there.`;

function starterRule(starter: ModelSettings["starter"]): string {
  return starter === "free" ? "Take the first Pokémon that your character chose." : `Choose ${starter} as your first Pokémon.`;
}

function characterLine(events: readonly RunEvent[]): string[] {
  const decision = runCharacter(events);
  if (!decision) return [];
  const names = decision.names ? ` Your name: ${decision.names.player}. Your rival: ${decision.names.rival}.` : "";
  const voice = decision.voice ? ` Your voice in "say": ${decision.voice}` : "";
  return [`Your character: ${decision.character} Your first Pokémon: ${decision.starter}.${names} Play as this trainer.${voice}`];
}

const PLAYER_INTRO = "You play Pokémon FireRed. A program plays your actions in the game, and the game is frozen while you think.";
const BATTLE_RULES =
  'In a battle, each fight action shows its effect on the foe, STAB (the move has a type of your Pokémon: ×1.5) and an estimate of its damage with no critical hit and no held item. When an ability of the foe stops a move (for example LEVITATE stops the GROUND moves), the fight action tells it: "No effect" when the foe surely has this ability, "can have" when it is one of the two abilities of its species. When the stages of accuracy and evasion change it, a fight action also shows its chance to hit now. The chance to hit counts only the stages of accuracy and evasion, not the held items, the abilities or the weather. A move that takes 2 turns (for example DIG, FLY or SKULL BASH) hits at the 2nd turn, and the foe acts at the 1st turn: the number of hits to KO counts the hits, not the turns. SOLARBEAM takes only 1 turn in strong sunlight. After a move with a recharge turn (for example HYPER BEAM), your Pokémon cannot act at the next turn. Your Pokémon and the foe each show their status and their states, for example seeded or confused. Bad poison is the poison of TOXIC: its damage grows at each turn, and the line of your Pokémon gives the poison damage of the next 3 turns. An ANTIDOTE cures bad poison as it cures poison. At a walk, a Pokémon with bad poison shows poison. Under the use line, each item that works now on your Pokémon in the battle shows its effect: the HP before and after, the status that it cures, and, when your Pokémon has poison and the item does not cure it, that the poison stays, with its damage in the next turns. A REVIVE shows the HP of each fainted Pokémon after it, and an X item the stat and the stage that it raises. You also get the last turn and the moves that you used on this foe, with their results. A move that has no effect also uses its PP. When no move of your Pokémon has PP, fight uses STRUGGLE (NORMAL, power 50): your Pokémon loses 1/4 of the damage that it does. A move that does no damage can help: it lowers a stat of the foe, puts it to sleep, poisons it or seeds it. Use it when it has an effect on this foe, mostly when the PP of your damage moves are low.';
const REASON_FIELD = '- "reason": why you choose this action, in one or two short sentences.';
const SAY_FIELD =
  '- "say": what your trainer says now, out loud, in one short sentence in English, or an empty string. Only the people who watch the Run read it, and it changes nothing in the game: keep "reason" plain. Talk as your character: the words, the tone and the things that your character notices. No catchphrase, and do not say a line again.';
const PROGRAM_RULES = [
  "- The program reads all the texts for you, and waits while the game is busy. You see the texts in your last decisions.",
  `- When the game shows a screen that no action covers, the program presses B ${B_PRESSES} times.`,
  '- "press" is one button press. Use it only when no other action fits.',
  '- An action that is "impossible" changes nothing in the game: read its reason, then choose another action.',
].join("\n");
const WILD_BATTLE_RULE =
  "- When a wild battle stops a walk, the program continues the walk to the same target after the battle, with no new decision. You choose again if a Pokémon fainted, if a Pokémon has a status, if your first Pokémon that can fight has less than half of its HP or no damage move with PP, if a walk to a cell of this map left it, or after a walk into unseen cells on a dark map. A lead, a far map and a goTo with a map continue on another map too.";
const NICKNAME_ANSWER = "- At the question of a nickname, the program answers YES for you.";
const KEEP_POTIONS = "- Keep your POTIONS for when they are necessary, for example before a difficult battle.";
const RUN_AWAY = "- When a wild battle goes badly, run.";
const COMPARE_LEVELS = "- Before you fight a trainer, compare the levels of your Pokémon and of the Pokémon of the trainer.";
const SHARED_EXPERIENCE =
  "- Each Pokémon that was in the battle against a foe, and did not faint, gets an equal part of the experience of this foe, also with no move. So to train a weak Pokémon, put it first with `swap`, then `switch` to a strong Pokémon at the first turn. Against a trainer, this counts for each of its Pokémon: the weak Pokémon gets a part only of the foes that it was in the battle against.";
const BATTLE_COACH_RULE = "In a battle, you get only the Battles part of the last advice, and the lines of what your Coach wants in this battle.";

function whiteoutRule(limit: number | null): string {
  const form = whiteoutKind(limit);
  if (form.kind === "none") return WHITEOUT_CONTINUES;
  if (form.kind === "first") return WHITEOUT_ENDS;
  return `If all your Pokémon faint, ${WHITEOUT_COST}. The Run ends at the ${ordinal(form.limit)} whiteout. ${WHITEOUT_CARE}`;
}

function ordinal(n: number): string {
  const tens = n % 100;
  const suffix = tens >= 11 && tens <= 13 ? "th" : ({ 1: "st", 2: "nd", 3: "rd" } as Record<number, string>)[n % 10] ?? "th";
  return `${n}${suffix}`;
}

function timeRule(hours: number | null): string[] {
  return hours === null ? [] : [`The Run ends after ${hours} hour${hours === 1 ? "" : "s"} of game time. The game is frozen while you think: only your actions use game time.`];
}

type Limits = Pick<ModelSettings, "whiteoutLimit" | "timeLimit">;

export function systemPrompt({ starter, whiteoutLimit, timeLimit, coach }: Pick<ModelSettings, "starter" | "coach"> & Limits, hasPokemon: boolean, role: "player" | "coach" = "player"): string {
  const coachLine = role === "coach" ? [COACH_DUTY] : coach ? [COACH_RULE] : [];
  const rules = [...(hasPokemon ? [] : [starterRule(starter)]), whiteoutRule(whiteoutLimit), ...timeRule(timeLimit), ...coachLine].join("\n");
  const intro = role === "coach" ? COACH_INTRO : PLAYER_INTRO;
  const offers = hasPokemon ? "" : "- When the game offers you your first Pokémon, the program answers for you: YES to the Pokémon of your character, NO to another. Then try another offer.\n";
  return `${intro}

Long-term goal: ${LONG_TERM_GOAL}
${rules}

At each decision, you get your Milestones, the next Milestone (the next big step of the story, with its name and place only), your Memory tree, your Bag, your money, your party, at a walk the Pokémon in your boxes, whether a REPEL is active and, with a BICYCLE in your Bag, whether you ride, the part of the decision (at a walk, the Known world, the list What is left on a floor of a cave, a forest or a large building, and the extract of your Atlas), what the game waits for, your Mission, your objective, the Coach advice and what happened since when the Run has a Coach, the number of Decision points since your last progress, your tries, your last decisions with what the program played and the texts of the game, the important events since your last decision, and the actions that you can choose now. In a battle, you get another prompt, about the battle only. After ${REFLECTION_EVERY} Decision points with no progress, and after each ${REFLECTION_EVERY} more, you get a reflection turn at the next walk: the request to write a lesson and a new objective, and the full Atlas. Every ${REVIEW_EVERY} decisions, you get a review turn: the full Atlas, and a short check of your Mission and of your team against the facts. These two turns also list your TMs and HMs, the items in your PC and the Pokémon in your boxes with their moves. The review turn also counts the Pokémon caught, the Pokémon in the boxes and the whiteouts so far in the game. After viewAtlas or zoom, or after an answer that the program cannot read, you get a new message at the same decision: answer again.

Your Memory tree is your notes, numbered from 1. Two neighbour nodes of the same size get a short summary, so you see only the top nodes: #a-b is the summary of the notes a to b, and #n is the note n. zoom <a-b> shows the two halves of a node; zoom again to go down to the notes.

At a walk, you get an extract of your Atlas: the map where you are, with all its rows and a legend of its signs, the edges that lead to another map, what the people of this map said to you, the fixed obstacles of this map (a cut tree or a rock that you cannot remove yet, with the move that removes it, and a boulder, with the move that pushes it), when your Bag has the HM or a Pokémon knows the move (until then, an obstacle or water is # on the map), the maps one exit away, and the targets. Each target has a letter, and its distance and direction from you. An exit shows the kind of place that a player sees, for example a house, a Pokémon Center or a cave entrance. It shows the name of the map where it leads only when you went through it, and it then also shows the cell where you arrive, when this cell is known. A ? cell is next to a cell where you can walk. It can be a wall: to see what it is, go to the target of its unseen cells, not to the ? cell. A blank cell is a cell that you did not see, and no cell that you saw leads to it on foot; a slide can go through it. A line under the map tells when you saw all the cells that you can reach from where you are: other parts of the map can still have unseen cells, so take an exit or a lead. An exit to a cave or a building also shows what is beyond it: unseen cells, an exit not taken, or nothing new. A map can have parts that no cell that you saw connects, and the way between them can go through other maps: a target in another part shows the number of exits to it, in place of its direction. With no known exits to it, it keeps its direction and says that no seen way goes there yet. On a map with spin tiles, the extract also gives the parts of the map, the slides that leave each part and where each slide ends, and a target in another part shows its part and the number of exits or slides to it. The leads are what you did not explore in other parts and maps: unseen cells, exits not taken, and slides whose end you did not see. On a floor of a cave, a forest or a large building, the list What is left counts, from the game, the unseen places and the exits not taken in your part, in the other parts and on the floors that the exits reach. Trust it more than your notes. Before the extract, the Known world gives one line for each town, city or route that you visited: its edges, the passages through a gate, a forest or a cave to another outdoor map, the buildings that you entered, the exits that you did not take with their cells, the groups of open cells next to unseen cells and the fixed obstacles.

Answer with JSON:
${REASON_FIELD}
- "action": exactly one of the actions of the message, for example "go B" or "choose NO".
- "mission": the story step that you work on, in one short sentence, for example "Find the Gym of the next town". Write it again unchanged at each decision. Change it only when the game shows that you reached it, or when the game gives you a new task. A try that fails or a person that is not where you expected does not change it: change the objective.
- "objective": what you do now for your Mission, in one short sentence, for example "Look for an exit on the north side of the town". Change it as often as you need.
- "note": a new note to keep in your Memory tree, in one line of at most ${MAX_SENTENCE} characters. A note is a fact that the game proved, for example "A person blocks the north exit of the town", or a lesson: what works, what fails and why, for example "Walks in the town gave nothing new: talk to the people first". A note can also be a guess that starts with "Guess:", for example "Guess: the Gym is in the north of the town", or the advice of a person that helps later, for example "A person said: you can never have too many Poké Balls". When one of your notes becomes false or ends, write a new note that says so, for example when the game disproves a guess, when a person moves, or when you beat a trainer that blocked a path. A note is never HP or PP values: the program removes a sentence that has them, and a note that repeats a recent note. A note never says that a place is explored, crossed or a dead end: the program removes this sentence, except after "Guess:" or "A person said:", because the list What is left tells it from the game. It also removes a sentence that repeats one that a review turn removed. It writes "Guess:" before a sentence with a word like "might" or "likely". Nobody changes a note later, and only a review turn or these rules can remove a sentence from your top nodes. Usually give an empty string: write a note after an important event or when you learn a lesson, and never write the same note again.
${SAY_FIELD}
- "remove": only at a review turn: ${REMOVE_RULE}.

Rules of the program:
${PROGRAM_RULES}
- People, objects and things to check are there for you to interact with. "go" walks next to them and interacts, and you read the text. An object can be a thing that you can take. A person or an object "in your way" stays there and no walk on the cells that you saw can pass it: interact with it, or look for another way. When nothing changes, the story needs another step first, so come back later.
${WILD_BATTLE_RULE}
${offers}${NICKNAME_ANSWER}

When your last decisions give nothing new, do not do them again: try something that you did not try. Talk to the people, interact with the objects, check the signs and other things, take the exits that you did not take, go to the cells that you did not see. The story often continues in a place that you do not expect.

Advice of a good player:
- Check the signs and other things, and talk to the people: they often tell you the way and what to do.
- Write your guesses in your notes, then check them.
- When your Pokémon are weak, heal your Pokémon at a Pokémon Center.
${KEEP_POTIONS}
- You can use more than one Pokémon: catch more Pokémon, step by step, up to a balanced team of 6 with different types.
${RUN_AWAY}
${COMPARE_LEVELS}
- When the trainers ahead are stronger than your Pokémon, train your Pokémon in the tall grass first.
${SHARED_EXPERIENCE}
- Buy Poké Balls and Potions at a Poké Mart.
- ${REPEL_FACTS}
- Take each ITEM BALL that you can reach: it is a free item, and it costs only the walk.
- ${TEACH_RULE}
- Each Pokémon Center has a PC on its first floor, in the list of the things to check. It keeps your items and your Pokémon. A Pokémon that you catch with 6 Pokémon in your party goes to a box. At the PC, put a weak Pokémon in a box to make a place before you catch a new one, and take a Pokémon from a box when it suits the next battle.
- ${NICKNAME_RULE} Write a name in the style of your character when you have one, different from the name of the species. A nickname costs nothing, because the game is frozen while you choose. It also tells two Pokémon of the same species apart in \`swap\` and \`switch\`.
- When the way is closed, explore and talk to the people: the game opens it when you do what it asks.
- When an action gives no progress, do not do it again: try a new place, a new person or a new exit.
- Your Memory tree keeps what you learned and tried: read it, and use zoom for a detail, before you choose.`;
}

// Only the settings of the Run feed this prompt, so that it stays the same from call to call and the cache holds.
export function battleSystemPrompt({ whiteoutLimit, coach }: Pick<ModelSettings, "whiteoutLimit" | "coach">): string {
  const rules = [whiteoutRule(whiteoutLimit), ...(coach ? [`${COACH_RULE} ${BATTLE_COACH_RULE}`] : [])].join("\n");
  return `${PLAYER_INTRO}

Long-term goal: ${LONG_TERM_GOAL}
${rules}

You are in a battle. At each decision of the battle, you get your Milestones, the next Milestone (the next big step of the story, with its name and place only), your Bag (only the pockets that work in a battle), your money, your party, your Pokémon and the foe, what the game waits for, your Mission and your Objective, the Battles part of the Coach advice when the Run has a Coach, your decisions since the decision that started the battle, with what the program played and the texts of the game, the important events since your last decision, and the actions that you can choose now. Your Mission and your Objective come from your walk before the battle: read them, but do not write them. They stay the same after the battle. After an answer that the program cannot read, or after an impossible action, you get a new message at the same decision: answer again.

${BATTLE_RULES}

Answer with JSON:
${REASON_FIELD}
- "action": exactly one of the actions of the message, for example "fight 0" or "run".
- "note": a new note to keep in your notes, which you read at each walk, in one line of at most ${MAX_SENTENCE} characters: a fact that the battle proved, for example "KOFFING has LEVITATE: GROUND moves miss", or a lesson: what works, what fails and why. A note is never HP or PP values: the program removes a sentence that has them, and a note that repeats a recent note. Usually give an empty string: write a note only when you learn a lesson.
${SAY_FIELD}

Rules of the program:
${PROGRAM_RULES}
${WILD_BATTLE_RULE}
${NICKNAME_ANSWER}

Advice of a good player:
${RUN_AWAY}
${KEEP_POTIONS}
${SHARED_EXPERIENCE}
${COMPARE_LEVELS}`;
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

export function reviewRequestIn(user: string): string | null {
  return /^Review turn:.*(\n- .*)*/m.exec(user)?.[0] ?? null;
}

export type TurnKind = "normal" | "character" | "reflection" | "review";

type LimitState = Limits & { whiteouts: number; frame: number };

export type PromptState = { noProgress: NoProgress; turn: TurnKind; happened: string[]; request: string[]; memory: string[]; advice: string[]; limits: LimitState };

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
  return turns.slice(last + 1).filter(isDecision).length >= REVIEW_EVERY;
}

export function userPrompt(observation: Observation, asked: Asked, events: readonly RunEvent[], state: PromptState): string {
  return inBattle(asked) ? battlePrompt(observation, asked, events, state) : walkPrompt(observation, asked, events, state);
}

function walkPrompt(observation: Observation, asked: Asked, events: readonly RunEvent[], { noProgress, turn, happened, request, memory, advice, limits }: PromptState): string {
  const answers = answeredTurns(events);
  const battles = finishedBattles(answers);
  const calls = walkHistory(answers, battles, events);
  const tried = tries(events, noProgress.since, answers);
  const known = asked.kind === "walk" ? knownWorld(asked.overworld) : [];
  const world = known.length === 0 ? [] : [...known, ""];
  // A provider caches only the start that two prompts share, so the parts that change little come first.
  return [
    `Milestones: ${observation.milestones.join(", ") || "none"}`,
    `Next Milestone: ${nextMilestone(observation.milestones) ?? "none: you reached all the Milestones."}`,
    ...whiteoutLine(limits),
    ...characterLine(events),
    "",
    memoryText(memory),
    "",
    ...world,
    bagText(observation.bag),
    `Money: ${observation.money}`,
    partyText(observation.party, asked.kind === "learnMove" ? moveAtMaxPp : moveText, observation.mode === "battle" ? AS_IS : walkStatus),
    ...(asked.kind === "walk" ? [...boxFacts(asked, showsAtlas(turn)), ...(turn === "review" ? [gameCounts(asked.overworld.boxes, events)] : []), ...repelLines(asked.overworld, observation.bag, events), ...safariLines(asked.overworld), ...bicycleLines(asked.overworld, observation.bag), ...surfLines(asked.overworld), ...(asked.overworld.strength.moved ? [BOULDERS_MOVED] : [])] : []),
    "",
    ...(asked.kind === "walk" ? leftBlock(asked.view.left, asked.overworld.map.name, events) : []),
    ...context(asked),
    ...(showsAtlas(turn) && asked.kind === "walk" ? [...fullAtlas(asked.overworld), ...teachDetails(asked)] : []),
    ...(asked.kind === "walk" ? [...darkLine(asked), ...fieldMoveHints(asked)] : []),
    "",
    waitLine(asked, events),
    missionLine(events),
    objectiveLine(events),
    ...advice,
    ...gameTimeLine(limits),
    `Decision points since your last progress (a new map, a new Milestone, a new exit seen, a level up, a new text of a person, a trainer beaten, ${lastProgressKinds(asked)}): ${noProgress.stuck}.`,
    ...request,
    tried.length === 0 ? "Your tries since the last progress: none." : ["Your tries since the last progress:", ...tried].join("\n"),
    ...loopWarning(answers),
    "",
    calls.length === 0 ? "Your last decisions: none yet." : ["Your last decisions, oldest first:", ...calls].join("\n"),
    "",
    ...happenedLines(happened),
    ...returnLine(asked, answers, battles, events),
    "Actions:",
    ...actionLines(asked),
    ZOOM,
    ...(actionsOf(asked).includes("press") ? [PRESS] : []),
  ].join("\n");
}

function battlePrompt(observation: Observation, asked: BattleAsked, events: readonly RunEvent[], { happened, advice, limits }: PromptState): string {
  const calls = pastCalls(sinceBattleStart(answeredTurns(events)));
  return [
    `Milestones: ${observation.milestones.join(", ") || "none"}`,
    `Next Milestone: ${nextMilestone(observation.milestones) ?? "none: you reached all the Milestones."}`,
    ...whiteoutLine(limits),
    ...characterLine(events),
    "",
    bagText(battleBag(observation.bag)),
    `Money: ${observation.money}`,
    partyText(observation.party, moveText, AS_IS),
    "",
    ...context(asked),
    "",
    waitLine(asked, events),
    missionLine(events),
    objectiveLine(events),
    ...advice,
    "",
    calls.length === 0 ? "Your last decisions in this battle: none yet." : ["Your last decisions, from the one that started this battle, oldest first:", ...calls].join("\n"),
    "",
    ...happenedLines(happened),
    "Actions:",
    ...actionLines(asked),
    ...(actionsOf(asked).includes("press") ? [PRESS] : []),
  ].join("\n");
}

function happenedLines(happened: string[]): string[] {
  return happened.length === 0 ? [] : [...happened.map((fact) => `Something important happened: ${fact}.`), "Write a note if it can help you later.", ""];
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

function leftBlock(left: string[], here: string, events: readonly RunEvent[]): string[] {
  return left.length === 0 ? [] : [...left, ...crossingLine(here, events), ""];
}

function crossingLine(here: string, events: readonly RunEvent[]): string[] {
  const maps = events.flatMap((e) => (e.type === "map" ? [e.map] : []));
  const crossings = new Map<string, number>();
  for (const [i, map] of maps.entries()) {
    const next = maps[i + 1];
    if (next === undefined || (map !== here && next !== here)) continue;
    const pair = [map, next].toSorted().join(" and ");
    crossings.set(pair, (crossings.get(pair) ?? 0) + 1);
  }
  const [pair, times] = [...crossings].toSorted((a, b) => b[1] - a[1])[0] ?? ["", 0];
  return times < MIN_CROSSINGS ? [] : [`- You crossed between ${pair} ${times} times.`];
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

function objectiveLine(events: readonly RunEvent[]): string {
  const objective = modelEvents(events).findLast((e) => e.decision?.objective)?.decision?.objective;
  return `Objective: ${objective || "none yet"}`;
}

function whiteoutLine({ whiteouts, whiteoutLimit }: LimitState): string[] {
  const form = whiteoutKind(whiteoutLimit);
  if (form.kind !== "counted" || whiteouts === 0) return [];
  return [`Whiteouts: ${whiteouts} of ${form.limit}.${form.limit - whiteouts === 1 ? " One more whiteout ends the Run." : ""}`];
}

// Under the prefix that the provider caches: the game time changes at each decision.
function gameTimeLine({ frame, timeLimit }: LimitState): string[] {
  return timeLimit === null ? [] : [`Game time: ${hoursText(frame)} of ${timeLimitHours(timeLimit)}.`];
}

export function nextMilestone(reached: readonly Milestone[]): string | null {
  const next = MILESTONES.find((milestone) => !reached.includes(milestone));
  return next ? MILESTONE_TEXTS[next] : null;
}

function boxFacts({ overworld: { boxes, pcItems }, party }: WalkAsked, detailed: boolean): string[] {
  if (!detailed) return boxes.length === 0 ? [] : [`In the boxes: ${boxes.map(boxMonText).join("; ")}.`];
  return [pcItems.length === 0 ? "The PC has no items." : `The items in the PC: ${pcItems.map(itemText).join(", ")}.`, ...boxLines(boxes, party)];
}

function gameCounts(boxes: BoxMon[], events: readonly RunEvent[]): string {
  const whiteouts = events.filter((e) => e.type === "whiteout").length;
  return `So far in the game: ${events.filter((e) => e.type === "catch").length} Pokémon caught, ${boxes.length} Pokémon in the boxes, ${whiteouts} whiteout${whiteouts === 1 ? "" : "s"}.`;
}

function bicycleLines({ riding, rideChosen }: Overworld, bag: BagPocket[]): string[] {
  if (!bag.some(({ items }) => items.some((item) => item.name === BICYCLE))) return [];
  const state = rideChosen ? "You chose to ride: you walk only where the game does not allow the BICYCLE. Use BICYCLE to walk again." : riding ? "You did not choose to ride: the next walk leaves the BICYCLE where the game allows it. Use BICYCLE to keep it." : "You walk. Use BICYCLE to ride.";
  return [`${BICYCLE_FACTS} ${state}`];
}

function safariLines({ safari }: Overworld): string[] {
  return safari ? [`Safari Zone: ${safari.steps} steps and ${safari.balls} SAFARI BALLs left. At 0 steps or 0 balls, the game takes you back to the gate.`] : [];
}

function surfLines({ surfing }: Overworld): string[] {
  return surfing ? [SURFING_LINE] : [];
}

function repelLines({ mapKind, repelActive }: Overworld, bag: BagPocket[], events: readonly RunEvent[]): string[] {
  if (repelActive) return ["A REPEL is active."];
  const repels = bag.flatMap(({ items }) => items).filter((item) => REPEL_ITEMS.includes(item.name));
  if (repels.length === 0) return [];
  const woreOff = textsOf(sinceLastCall(events)).some((text) => REPEL_WORE_OFF.test(text)) ? ["You can use another REPEL."] : [];
  return [...(mapKind === "underground" ? [`You have ${repels.map(itemText).join(", ")}. ${REPEL_FACTS}`] : []), ...woreOff];
}

function boxLines(boxes: BoxMon[], party: PartyMon[]): string[] {
  if (boxes.length === 0) return ["The boxes are empty."];
  const sorted = boxes.toSorted((a, b) => b.level - a.level);
  const shown = sorted.slice(0, MAX_BOX_LINES);
  const line = (mon: BoxMon) => `- ${boxMonText(mon)}: type ${mon.types.join(", ")}, ability ${mon.ability.name}. Moves: ${mon.moves.map((move) => `${move.name} (${moveText(move)})`).join(", ")}.`;
  const title = sorted.length > MAX_BOX_LINES ? `The Pokémon in the boxes, the ${MAX_BOX_LINES} of the highest levels:` : "The Pokémon in the boxes:";
  return [title, ...shown.map(line), ...othersLine(sorted.slice(MAX_BOX_LINES)), ...boxDescriptions(shown, party)];
}

function othersLine(others: BoxMon[]): string[] {
  if (others.length === 0) return [];
  const groups = [...Map.groupBy(others, (mon) => mon.species)].map(([species, mons]) => `${species} ×${mons.length} (level${mons.length === 1 ? "" : "s"} ${levelsText(mons.map((mon) => mon.level))})`);
  return [`- And ${others.length} more: ${groups.join(", ")}.`];
}

function levelsText(levels: number[]): string {
  const rows: number[][] = [];
  for (const level of levels.toSorted((a, b) => a - b)) {
    const row = rows.at(-1);
    if (row && level - (row.at(-1) ?? level) <= 1) row.push(level);
    else rows.push([level]);
  }
  return rows.map((row) => (row.length >= 3 ? `${row[0]}–${row.at(-1)}` : row.join(", "))).join(", ");
}

function boxDescriptions(shown: BoxMon[], party: PartyMon[]): string[] {
  const known = new Set(party.flatMap((mon) => [mon.ability.name, ...mon.moves.map((move) => move.name)]));
  const descriptions = new Map(shown.flatMap((mon) => [mon.ability, ...mon.moves]).filter(({ name }) => !known.has(name)).map(({ name, description }) => [name, description]));
  return descriptions.size === 0 ? [] : ["What these moves and abilities do:", ...[...descriptions].map(([name, description]) => `- ${name}: ${description}`)];
}

function context(asked: Asked): string[] {
  switch (asked.kind) {
    case "walk":
      return asked.view.lines;
    case "choice":
      if (inBattle(asked)) return battleLines(asked.battle, asked.party);
      return [...(asked.storage === undefined ? [] : [pcLine(asked.options[asked.storage])]), ...localView(asked.overworld)];
    case "shopMenu": {
      const buys = asked.sellable.length === 0 ? ["The Poké Mart buys none of the items of your Bag."] : ["The Poké Mart buys these items of your Bag (the money for one item):", ...asked.sellable.map((item) => `- ${itemText(item)}: ${item.price / 2}`)];
      return ["The Poké Mart sells (the price of one item):", ...asked.forSale.map((item) => `- ${item.name}: ${item.price}. ${item.description}${REPEL_ITEMS.includes(item.name) ? ` ${REPEL_FACTS}` : ""}`), "", ...buys];
    }
    case "itemPc": {
      const stored = asked.pcItems.length === 0 ? ["The PC has no items."] : ["The items in the PC:", ...asked.pcItems.map((item) => `- ${itemText(item)}`)];
      const bag = asked.depositable.length === 0 ? ["The ITEMS pocket of your Bag is empty."] : ["The items of the ITEMS pocket of your Bag (only these go into the PC):", ...asked.depositable.map((item) => `- ${itemText(item)}`)];
      return [...stored, "", ...bag];
    }
    case "pokemonPc":
      return asked.boxes.length === 0 ? ["The boxes are empty."] : ["The Pokémon in the boxes:", ...asked.boxes.map((mon, row) => `${row + 1}. ${boxMonText(mon)}`)];
    case "naming":
      return [`The naming screen asks for ${asked.subject}, ${asked.maxLength} characters at most.`];
    case "learnMove":
      return learnMoveLines(asked.party[asked.slot], asked.move);
    default:
      return battleLines(asked.battle, asked.party);
  }
}

function learnMoveLines(mon: PartyMon, move: PartyMove): string[] {
  const { moves } = mon;
  const forgetting = (known: PartyMove) => {
    if (isHmMove(known.name)) return "It is an HM move: it cannot be forgotten.";
    const after = [...moves.filter((other) => other !== known), move];
    return `If you forget it: ${damageLeft(mon, after)}`;
  };
  return [
    `${monName(mon)} wants to learn ${move.name} (${moveAtMaxPp(move)}). ${move.description}`,
    `It already knows ${moves.length} moves. To learn ${move.name}, it must forget one of them:`,
    ...moves.map((known, i) => `- ${i + 1}. ${known.name}: ${moveAtMaxPp(known)}. ${known.description} ${forgetting(known)}`),
    "A Pokémon Center gives back all the PP, so this prompt shows only the maximum PP of each move.",
    `If you keep your moves: ${damageLeft(mon, moves)}`,
    "Keep at least 2 damage moves when you can: with only one, a foe can resist it and its PP can run out.",
    "This is an important choice. Before you choose, count your damage moves and compare their maximum PP.",
  ];
}

function damageLeft({ nickname, types }: PartyMon, moves: PartyMove[]): string {
  const hasStab = (move: PartyMove) => move.power !== null && types.includes(move.type);
  const damage = moves.filter(isDamageMove).map((move) => `${move.name} (${move.type}${hasStab(move) ? ", STAB" : ""}, max PP ${move.maxPp})`);
  const count = `${nickname} then has ${damage.length} damage ${damage.length === 1 ? "move" : "moves"}`;
  return damage.length === 0 ? `${count}.` : `${count}: ${damage.join(", ")}.`;
}

function pcLine(storage: string): string {
  return `This is a PC: the PC with your name has ITEM STORAGE, which keeps your items. ${storage} opens the boxes, which keep your Pokémon.`;
}

const SLIDE_GOTO = "  On this map, goTo never steps on a spin tile on the way. A goTo to a spin tile next to your part walks next to it, then steps on it, and you slide.";

function actionLines(asked: Asked): string[] {
  switch (asked.kind) {
    case "walk": {
      const { grid } = asked.overworld;
      return [
        ...(asked.view.targets.length === 0 ? [] : [`- go <letter>: walk to the target, for example go B. At an exit, take it. At a person, an object or something you can check, walk next to it, then interact with it.${darkOfMap(asked.overworld) ? DARK_GO_RULE : ""}`]),
        `- goTo <x> <y>: walk to a cell of this map, x from 0 to ${grid.mapWidth - 1}, y from 0 to ${grid.mapHeight - 1}, or cross an edge of the list of edges. Prefer go: use goTo only for a cell that you read in the grid.`,
        ...(asked.view.spinTiles ? [SLIDE_GOTO] : []),
        "- goTo <x> <y> <map>: walk to a cell of another map.",
        ...(actionsOf(asked).includes("push") ? [PUSH_LINE] : []),
        ...useLine(asked),
        ...teachLine(asked),
        ...giveLine(asked),
        ...takeLine(asked),
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
  const moveItem = asked.items.find((item) => itemUse(item, asked) === "move");
  const moveHelp = moveItem ? ` On a move, write the Pokémon and then the move, for example use ${moveItem.name} on 1 ${asked.party[0].moves[0].name}.` : "";
  const details = asked.kind === "walk" ? stoneLines(asked.overworld.stones, asked.party) : inBattle(asked) ? itemEstimates(asked.items, asked.battle.player, asked.party) : [];
  return [`- use <item> [on <Pokémon>${moveItem ? " [<move>]" : ""}]: use an item of your Bag. The items that work now: ${asked.items.map((item) => itemWithTarget(item, asked)).join(", ")}.${pokemonHelp(asked.party)}${moveHelp}`, ...details];
}

const ITEM_TARGETS: Record<ItemUse, string> = { alone: "", pokemon: " (on a Pokémon)", move: " (on a move of a Pokémon)" };

function itemWithTarget(item: BagItem, asked: Asked): string {
  return `${item.name}${ITEM_TARGETS[itemUse(item, asked) ?? "alone"]}`;
}

function stoneLines(stones: Stone[], party: PartyMon[]): string[] {
  return stones.filter(({ evolutions }) => evolutions.length > 0).map(({ item, evolutions }) => `  ${item}: ${evolutions.map(({ slot, species }) => `${monPlace(party, slot)} becomes ${species}`).join(", ")}.`);
}

type WalkAsked = Asked & { kind: "walk" };

function teachLine({ overworld: { teachables } }: WalkAsked): string[] {
  return teachables.length === 0 ? [] : [`- teach <TM or HM> on <Pokémon>: teach its move to a Pokémon of your party, for example teach ${teachables[0].item} on 1. Your Bag has: ${teachables.map(teachableName).join(", ")}.`];
}

function giveLine({ holdable, party }: WalkAsked): string[] {
  return holdable.length === 0 ? [] : [`- give <item> on <Pokémon>: a Pokémon of your party holds an item of your Bag, for example give ${holdable[0].name} on 1. When it holds an item, this item goes back to your Bag. The items with an effect when a Pokémon holds them: ${holdable.map((item) => item.name).join(", ")}.${pokemonHelp(party)}`];
}

function takeLine({ party }: WalkAsked): string[] {
  const holders = [...party.keys()].filter((slot) => hasTakableItem(party[slot]));
  return holders.length === 0 ? [] : [`- take <Pokémon>: put the item that a Pokémon holds in your Bag. Holders: ${holders.map((slot) => `${monPlace(party, slot)} (${party[slot].heldItem?.name})`).join(", ")}.`];
}

function teachDetails({ overworld: { teachables }, party }: WalkAsked): string[] {
  if (teachables.length === 0) return [];
  const mons = (slots: number[]) => slots.map((slot) => monPlace(party, slot)).join(", ");
  const about = ({ item, move, able, knowing }: Teachable) => [`- ${item}: ${move.name} (${moveAtMaxPp(move)}). ${move.description} Can learn it: ${mons(able) || "none"}.`, ...(knowing.length === 0 ? [] : [`Knows it: ${mons(knowing)}.`])].join(" ");
  return ["", `Your TMs and HMs. ${TEACH_RULE}`, ...teachables.map(about), "Does one of these moves help your Objective?"];
}

// #74: the model does not see the screen, so this exception to #78 names the move, but no place and no HM number.
function darkLine({ overworld }: WalkAsked): string[] {
  const dark = darkOfMap(overworld);
  if (!dark) return [];
  return [`This map is dark: you see about 3 x 3 cells. ${dark.missingBadge === null ? "The HM move FLASH lights it, and no Pokémon of your party knows it." : `${badgeNeeded("FLASH", dark.missingBadge)}.`}`];
}

function lastProgressKinds(asked: Asked): string {
  return asked.kind === "walk" && darkOfMap(asked.overworld) ? "an item found, a new species caught or a new cell seen on this dark map" : "an item found or a new species caught";
}

const DARK_GO_RULE = " At unseen cells of this dark map, the walk continues in the same direction, then along a wall while the side of that direction stays unseen: a wall in front, an exit, a new person or a battle stops it.";

function flyHint(teachable: Teachable, { milestones, fly }: WalkAsked["overworld"]): string {
  const towns = fly.destinations.length === 0 ? "a town after you visit it" : alternatives(fly.destinations.map(({ area }) => area));
  const learn = teachable.able.length > 0 ? ": teach it." : ". No Pokémon of your party can learn it: catch a Pokémon that can learn FLY.";
  return `Your Bag has ${teachableName(teachable)}. FLY can take you to the Pokémon Center of ${towns}${learn}${milestones.includes("badge-3") ? "" : " FLY needs badge 3."}`;
}

function fieldMoveHints({ overworld }: WalkAsked): string[] {
  return overworld.teachables.flatMap((teachable) => {
    if (teachable.knowing.length > 0) return [];
    if (teachable.move.name === "FLY") return [flyHint(teachable, overworld)];
    if (!moveObstacleHere(teachable.move.name, overworld)) return [];
    return [`Your Bag has ${teachableName(teachable)}. It can help on this map${teachable.able.length > 0 ? ": teach it." : ", but no Pokémon of your party can learn it."}`];
  });
}

function partyLine(asked: Asked, name: "switch" | "send", help: string): string[] {
  const slots = sendable(asked);
  return slots.length === 0 ? [] : [`- ${name} <Pokémon>: ${help}.${pokemonHelp(asked.party, slots)}`];
}
