import type { BagItem, BagPocket } from "../bag";
import { type Milestone, MILESTONES, type WaitingFor } from "../game";
import { mapNamed } from "../harness/atlas";
import { type ActionEntry, type BattleState, type NoProgress, type Observation } from "../harness/harness";
import { callTurns, type ModelEvent, modelEvents, type NodeRange, type RunEvent } from "../harness/record";
import type { PartyMon, PartyMove } from "../party";
import { actionText } from "../protocol";
import { actionsOf, alternatives, type Asked, type AskedKind, itemUse, MAX_SENTENCE, REFLECTION_EVERY, sendable } from "./decision";
import { fullAtlas, localView } from "./extract";
import { type MemoryTree, memoryLines, memoryTree, nodeName, zoomLines } from "./memory-tree";
import { isExit, targetLines } from "./targets";

export const B_PRESSES = 3;
const LONG_TERM_GOAL = "Become the Champion: earn the 8 gym badges, then beat the Elite Four.";
const MAX_PAST_CALLS = 15;
const MAX_CALL_LINES = 30;
export const MAX_TRIES = 20;
const MAX_OUTCOME = 200;
const WAITS: Record<AskedKind, string> = {
  walk: "a walk",
  choice: "a choice",
  battleAction: "a battle action",
  battleMove: "a move",
  partyPick: "a Pokémon in the party menu of the battle",
  shopMenu: "the shop menu of a Poké Mart",
};
const MILESTONE_TEXTS: Record<Milestone, string> = {
  "has-pokemon": "Get your first Pokémon from Professor Oak in Pallet Town.",
  "first-rival-battle": "Battle your rival for the first time, in Professor Oak's lab in Pallet Town.",
  "badge-1": "Earn the Boulder Badge from Brock, the Gym Leader of Pewter City.",
  "badge-2": "Earn the Cascade Badge from Misty, the Gym Leader of Cerulean City.",
  "badge-3": "Earn the Thunder Badge from Lt. Surge, the Gym Leader of Vermilion City.",
  "badge-4": "Earn the Rainbow Badge from Erika, the Gym Leader of Celadon City.",
  "badge-5": "Earn the Soul Badge from Koga, the Gym Leader of Fuchsia City.",
  "badge-6": "Earn the Marsh Badge from Sabrina, the Gym Leader of Saffron City.",
  "badge-7": "Earn the Volcano Badge from Blaine, the Gym Leader of Cinnabar Island.",
  "badge-8": "Earn the Earth Badge from Giovanni, the Gym Leader of Viridian City.",
};
const STAT_LABELS: Record<string, string> = { spAttack: "special attack", spDefense: "special defense" };
const UNKNOWN_SCREEN = `The game showed a screen that no action covers: the program pressed B ${B_PRESSES} times.`;
const ZOOM = "- zoom <a-b>: see the two halves of the node #a-b of your Memory tree, then choose again. The game does not move.";
const PRESS = "- press <button>: one press of A, B, Start, Select, Up, Down, Left, Right, L or R.";
const POKEMON = "<Pokémon> is the name of a Pokémon of your party, or its place in the party (1 is the first).";

export function systemPrompt(starterRule: string): string {
  return `You play Pokémon FireRed. A program plays your actions in the game, and the game is frozen while you think.

Long-term goal: ${LONG_TERM_GOAL}
${starterRule}

At each decision, you get your Milestones, the next Milestone (the next big step of the story, with its name and place only), your Mission, your Memory tree, what the game waits for, your objective, the number of Decision points since your last progress, your last decisions with what the program played and the texts of the game, the important events since your last decision, and the actions that you can choose now. After ${REFLECTION_EVERY} Decision points with no progress, and after each ${REFLECTION_EVERY} more, you get a reflection turn: the full Atlas, and the request to write a lesson and a new objective. After viewAtlas or zoom, or after an answer that the program cannot read, you get a new message at the same decision: answer again.

Your Memory tree is your notes, numbered from 1. Two neighbour nodes of the same size get a short summary, so you see only the top nodes: #a-b is the summary of the notes a to b, and #n is the note n. zoom <a-b> shows the two halves of a node; zoom again to go down to the notes.

At a walk, you get an extract of your Atlas: the map where you are, with all its rows and ? for the cells that you did not see on the screen, the edges that lead to another map, what the people of this map said to you, the maps one exit away, and the targets. Each target has a letter, and its distance and direction from you. An exit shows where it leads only when you went through it.

Answer with JSON:
- "reason": why you choose this action, in one or two short sentences.
- "action": exactly one of the actions of the message, for example "go B" or "choose NO".
- "mission": the story step that you work on, in one short sentence, for example "Find the Gym of the next town". Write it again unchanged at each decision. Change it only when the game shows that you reached it, or when the game gives you a new task. A try that fails or a person that is not where you expected does not change it: change the objective.
- "objective": what you do now for your Mission, in one short sentence, for example "Look for an exit on the north side of the town". Change it as often as you need.
- "note": a new note to keep in your Memory tree, in one line of at most ${MAX_SENTENCE} characters. A note is a fact that the game proved, for example "A person blocks the north exit of the town", or a lesson: what works, what fails and why, for example "Walks in the town gave nothing new: talk to the people first". A note is never a guess, and never HP values. Nobody changes a note later, and you cannot remove it. Usually give an empty string: write a note after an important event or when you learn a lesson, and never write the same note again.

Rules of the program:
- The program reads all the texts for you, and waits while the game is busy. You see the texts in your last decisions.
- At the nickname question, answer NO: the program cannot type names yet.
- When the game shows a screen that no action covers, the program presses B ${B_PRESSES} times.
- "press" is one button press. Use it only when no other action fits.
- An action that is "impossible" changes nothing in the game: read its reason, then choose another action.

When your last decisions give nothing new, do not do them again: try something that you did not try. Talk to the people, read the signs, take the exits that you did not take, go to the cells that you did not see. The story often continues in a place that you do not expect.

Advice of a good player:
- Talk to the people: they tell you where to go and what to do.
- When your Pokémon are weak, heal your Pokémon at a Pokémon Center.
- Train your Pokémon in the tall grass before you fight a Gym Leader.
- Buy Poké Balls and Potions at a Poké Mart.
- When the way is closed, explore and talk to the people: the game opens it when you do what it asks.
- When an action gives no progress, do not do it again: try a new place, a new person or a new exit.
- Your Memory tree keeps what you learned and tried: read it, and use zoom for a detail, before you choose.`;
}

const REFLECTION = [
  "Reflection turn: stop and think before you act.",
  "- Read your Memory tree above and the full Atlas below. Use zoom freely to see the details of a node: zoom does not end this turn.",
  '- Write in "note" a lesson: what you tried, why it failed, and what you will do now.',
  '- Set a new "objective" that follows this lesson.',
];

/** `happened`: the facts of importantEvents. */
export type PromptState = { noProgress: NoProgress; reflection: boolean; happened: string[] };

// The count can pass a multiple of 30 during a battle: the reflection turn then waits for the next walk of the same block of 30.
export function reflectionTurn(kind: WaitingFor["kind"], events: readonly RunEvent[], { stuck, since }: NoProgress): boolean {
  const block = Math.floor(stuck / REFLECTION_EVERY);
  const done = modelEvents(events.slice(since)).some((e) => e.reflection && Math.floor((e.stuck ?? 0) / REFLECTION_EVERY) === block);
  return kind === "walk" && block > 0 && !done;
}

export function userPrompt(observation: Observation, asked: Asked, events: readonly RunEvent[], { noProgress, reflection, happened }: PromptState): string {
  const read = modelEvents(events).flatMap((e) => (e.decision ? [e.decision] : []));
  const calls = pastCalls(events);
  const tried = tries(events, noProgress.since);
  // The facts that change little come first, so that the providers cache more of the prompt.
  return [
    `Milestones: ${observation.milestones.join(", ") || "none"}`,
    `Next Milestone: ${nextMilestone(observation.milestones) ?? "none: you reached all the Milestones."}`,
    missionLine(events),
    "",
    memoryText(memoryTree(events)),
    "",
    waitLine(asked, events),
    `Objective: ${read.findLast((d) => d.objective)?.objective || "none yet"}`,
    `Decision points since your last progress (a new map, a new Milestone, a new exit seen, a level up or a new text of a person): ${noProgress.stuck}.`,
    ...(reflection ? REFLECTION : []),
    tried.length === 0 ? "Your tries since the last progress: none." : ["Your tries since the last progress:", ...tried].join("\n"),
    "",
    calls.length === 0 ? "Your last decisions: none yet." : ["Your last decisions, oldest first:", ...calls].join("\n"),
    "",
    ...(happened.length === 0 ? [] : [...happened.map((fact) => `Something important happened: ${fact}.`), "Write a note if it can help you later.", ""]),
    partyText(observation.party),
    `Money: ${observation.money}`,
    bagText(observation.bag),
    "",
    ...context(asked),
    ...(reflection && asked.kind === "walk" ? fullAtlas(asked.overworld) : []),
    "",
    "Actions:",
    ...actionLines(asked),
    ZOOM,
    ...(actionsOf(asked).includes("press") ? [PRESS] : []),
  ].join("\n");
}

function waitLine(asked: Asked, events: readonly RunEvent[]): string {
  if (asked.kind !== "choice") return `The game waits for ${WAITS[asked.kind]}.`;
  const last = callTurns(events).findLast((turn) => turn.call)?.events ?? [];
  const question = last.flatMap((e) => (e.type === "action" && "text" in e.result ? e.result.text : [])).at(-1);
  return question ? `The game asks: "${question}" Choose ${alternatives(asked.options)}.` : `The game waits for ${WAITS.choice}: ${asked.options.join(", ")}.`;
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

function memoryText(tree: MemoryTree): string {
  const lines = memoryLines(tree);
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

// The last Model calls, each with what the program played and the game did until the next one.
function pastCalls(events: readonly RunEvent[]): string[] {
  const calls = callTurns(events).flatMap((turn) => (turn.call ? [{ call: turn.call, events: turn.events }] : []));
  return calls.slice(-MAX_PAST_CALLS).map(({ call, events: after }) => {
    const lines = after.flatMap(eventLines);
    const answer = call.decision ? `You chose: ${call.decision.action}` : `Your answer could not be read: ${call.error}`;
    const shown = lines.length > MAX_CALL_LINES ? [`… ${lines.length - MAX_CALL_LINES + 1} lines before`, ...lines.slice(-(MAX_CALL_LINES - 1))] : lines;
    return [`- At ${call.situation}. ${answer}`, ...shown.map((line) => `  ${line}`)].join("\n");
  });
}

type Try = { action: string; result: ActionEntry["result"]; texts: string[] };

// After a Model call the program plays the answer, then reads the texts and can press B: only the actions before the first readText are tries.
// The turn of the last progress counts from its Model call, so that its end (the code's B presses) is not a try.
export function tries(events: readonly RunEvent[], since: number): string[] {
  const recent = new Set(events.slice(since));
  const start = events.findLastIndex((e, i) => i <= since && e.type === "model");
  const played = callTurns(events.slice(Math.max(0, start))).flatMap((turn): Try[] => {
    if (!turn.call) return [];
    const actions = turn.events.flatMap((e) => (e.type === "action" ? [e] : []));
    const read = actions.findIndex((a) => a.action.name === "readText");
    const answer = (read === -1 ? actions : actions.slice(0, read)).filter((a) => recent.has(a));
    const textsAfter = actions.slice(read === -1 ? actions.length : read).flatMap((a) => (a.action.name === "readText" && "text" in a.result ? a.result.text : []));
    return answer.map((a, i) => ({
      action: actionText(a.action),
      result: a.result,
      texts: [...("text" in a.result ? a.result.text : []), ...(i === answer.length - 1 ? textsAfter : [])],
    }));
  });
  const grouped = new Map<string, { action: string; outcome: string; times: number }>();
  for (const t of played) {
    const result = outcome(t);
    const key = `${t.action}: ${result}`;
    const group = grouped.get(key) ?? { action: t.action, outcome: result, times: 0 };
    group.times++;
    grouped.set(key, group);
  }
  const lines = [...grouped.values()].map((g) => `- ${g.action} ×${g.times}: ${g.outcome}`);
  return lines.length <= MAX_TRIES ? lines : [`- … and ${lines.length - MAX_TRIES} other tries before`, ...lines.slice(-MAX_TRIES)];
}

function outcome({ result, texts }: Try): string {
  const status = result.status === "done" ? (texts.length > 0 ? "" : "done") : `${result.status}${"reason" in result ? ` (${result.reason})` : ""}`;
  const text = [status, texts.map((t) => `"${t}"`).join(" ")].filter(Boolean).join(", ");
  return text.length > MAX_OUTCOME ? `${text.slice(0, MAX_OUTCOME - 1)}…` : text;
}

function eventLines(event: Exclude<RunEvent, ModelEvent>): string[] {
  switch (event.type) {
    case "action": {
      const { action, result } = event;
      const reason = "reason" in result ? ` (${result.reason})` : "";
      const texts = "text" in result ? result.text.map((text) => `  "${text}"`) : [];
      const lines = [`${actionText(action)}: ${result.status}${reason}, ${result.frames} frames`, ...texts];
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

function partyText(party: PartyMon[]): string {
  if (party.length === 0) return "Party: none.";
  const mon = (m: PartyMon) => {
    const name = m.nickname === m.species ? m.species : `${m.nickname} (${m.species})`;
    const about = [
      `- ${name}: level ${m.level}, HP ${m.hp}/${m.maxHp}, status ${m.status}`,
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
    .map(([stat, value]) => `${STAT_LABELS[stat] ?? stat} ${value}`)
    .join(", ");
}

function context(asked: Asked): string[] {
  switch (asked.kind) {
    case "walk":
      return asked.view.lines;
    case "choice":
      return "battle" in asked ? battleLines(asked.battle) : localView(asked.overworld, mapNamed(asked.overworld.atlas, asked.overworld.map.name), []);
    case "shopMenu": {
      const buys = asked.sellable.length === 0 ? ["The Poké Mart buys none of the items of your Bag."] : ["The Poké Mart buys these items of your Bag (the money for one item):", ...asked.sellable.map((item) => `- ${item.name} ×${item.quantity}: ${item.price / 2}`)];
      return ["The Poké Mart sells (the price of one item):", ...asked.forSale.map((item) => `- ${item.name}: ${item.price}`), "", ...buys];
    }
    default:
      return battleLines(asked.battle);
  }
}

function actionLines(asked: Asked): string[] {
  switch (asked.kind) {
    case "walk": {
      const { grid } = asked.overworld;
      return [
        ...(asked.view.targets.length === 0 ? [] : ["- go <letter>: walk to the target, for example go B. At an exit, take it. At a person or a sign, walk next to it, then talk to it or read it."]),
        `- goTo <x> <y>: walk to a cell of this map, x from 0 to ${grid.mapWidth - 1}, y from 0 to ${grid.mapHeight - 1}, or cross an edge of the list of edges. Prefer go: use goTo only for a cell that you read in the grid.`,
        "- goTo <x> <y> <map>: walk to a cell of another map.",
        ...useLine(asked),
        ...(actionsOf(asked).includes("swap") ? [`- swap <Pokémon> <Pokémon>: change the order of two Pokémon of your party. The first Pokémon starts the next battle. ${POKEMON}`] : []),
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
  }
}

function useLine(asked: Asked & { items: BagItem[] }): string[] {
  if (asked.items.length === 0) return [];
  const names = asked.items.map((item) => (itemUse(item, asked) === "pokemon" ? `${item.name} (on a Pokémon)` : item.name));
  return [`- use <item> [on <Pokémon>]: use an item of your Bag. The items that work now: ${names.join(", ")}. ${POKEMON}`];
}

function partyLine(asked: Asked, name: "switch" | "send", help: string): string[] {
  const mons = sendable(asked);
  return mons.length === 0 ? [] : [`- ${name} <Pokémon>: ${help}. It can be ${mons.map((mon) => mon.nickname).join(", ")}. ${POKEMON}`];
}

function fights({ player }: BattleState): string[] {
  return player.moves.map((move, i) => `- fight ${i}: ${move.name} (${moveText(move)})`);
}

function battleLines({ kind, player, enemy }: BattleState): string[] {
  return [
    `Battle against ${kind === "trainer" ? "a trainer" : "a wild Pokémon"}.`,
    `Your ${player.nickname}: level ${player.level}, HP ${player.hp}/${player.maxHp}, status ${player.status}. Stats: ${statsText(player.stats)}. Stat stages: ${stagesText(player.statStages)}.`,
    `Foe ${enemy.species} (${enemy.types.join(", ")}): level ${enemy.level}, HP ${enemy.hpPercent}%, status ${enemy.status}. Stat stages: ${stagesText(enemy.statStages)}. Moves seen: ${enemy.movesSeen.join(", ") || "none"}.`,
  ];
}

function stagesText(stages: Record<string, number>): string {
  const changed = Object.entries(stages).filter(([, stage]) => stage !== 0);
  return changed.map(([stat, stage]) => `${STAT_LABELS[stat] ?? stat} ${stage > 0 ? "+" : ""}${stage}`).join(", ") || "none";
}
