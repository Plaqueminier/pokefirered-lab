import { mapNamed } from "../harness/atlas";
import { type ActionEntry, actionText, type BattleState, type NoProgress, type Observation } from "../harness/harness";
import { callTurns, type ModelEvent, modelEvents, type RunEvent } from "../harness/record";
import type { BagItem, BagPocket } from "../bag";
import { type Milestone, MILESTONES } from "../game";
import type { PartyMon, PartyMove } from "../party";
import { actionsOf, alternatives, type Asked, type AskedKind, MAX_NOTES } from "./decision";
import { fullAtlas, localView } from "./extract";

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
};
// A name and a place only: the model finds the steps itself.
const MILESTONE_TEXTS: Record<Milestone, string> = {
  "has-pokemon": "Get your first Pokémon from Professor Oak in Pallet Town.",
  "first-rival-battle": "Battle your rival for the first time, in Professor Oak's lab in Pallet Town.",
  "has-pokedex": "Get the Pokédex from Professor Oak in Pallet Town.",
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
const PRESS = "- press <button>: one press of A, B, Start, Select, Up, Down, Left, Right, L or R.";

export function systemPrompt(starterRule: string): string {
  return `You play Pokémon FireRed. A program plays your actions in the game, and the game is frozen while you think.

Long-term goal: ${LONG_TERM_GOAL}
${starterRule}

At each decision, you get your Milestones, the next Milestone (the next big step of the story, with its name and place only), your notes, your Mission, what the game waits for, your objective, your last decisions with what the program played and the texts of the game, and the actions that you can choose now. After viewAtlas, or after an answer that the program cannot read, you get a new message at the same decision: answer again.

At a walk, you get an extract of your Atlas: the map where you are, with only the cells that you saw on the screen, what the people of this map said to you, the maps one exit away, and the numbered targets. An exit shows where it goes only when you went through it. The map legend: @ you, # blocked, . open, " tall grass, ~ water, ^ v < > a ledge that you can jump down only in that direction, ? a cell that you did not see, 1-9 and A-Z the targets (A is 10, B is 11…).

Answer with JSON:
- "reason": why you choose this action, in one or two short sentences.
- "action": exactly one of the actions of the message, for example "go 2" or "choose NO".
- "mission": the story step that you work on, in one short sentence, for example "Find the Gym of the next town". Write it again unchanged at each decision. Change it only when the game shows that you reached it, or when the game gives you a new task. A try that fails or a person that is not where you expected does not change it: change the objective.
- "objective": what you do now for your Mission, in one short sentence, for example "Look for an exit on the north side of the town". Change it as often as you need.
- "notes": your memory, at most ${MAX_NOTES} characters. You get them back at the next decision: write them again in full each time, with the facts that you want to keep. Keep the facts about your Mission until you reach it.

Rules of the program:
- The program reads all the texts for you, and waits while the game is busy. You see the texts in your last decisions.
- At the nickname question, answer NO: the program cannot type names yet.
- When the game shows a screen that no action covers, the program presses B ${B_PRESSES} times.
- "press" is one button press. Use it only when no other action fits.
- An action that is "impossible" changes nothing in the game: read its reason, then choose another action.

When your last decisions give nothing new, do not do them again: try something that you did not try. Talk to the people, read the signs, take the exits that you did not take, go to the cells that you did not see. The story often goes on in a place that you do not expect.

Advice of a good player:
- Talk to the people: they tell you where to go and what to do.
- When your Pokémon are weak, heal your Pokémon at a Pokémon Center.
- Train your Pokémon in the tall grass before you fight a Gym Leader.
- Buy Poké Balls and Potions at a Poké Mart.`;
}

export function userPrompt(observation: Observation, asked: Asked, events: readonly RunEvent[], noProgress: NoProgress): string {
  const now = asked.kind === "choice" ? `${WAITS.choice}: ${asked.options.join(", ")}` : WAITS[asked.kind];
  const read = modelEvents(events).flatMap((e) => (e.decision ? [e.decision] : []));
  const calls = pastCalls(events);
  const tried = tries(events, noProgress.since);
  // The facts that change little come first, so that the providers cache more of the prompt.
  return [
    `Milestones: ${observation.milestones.join(", ") || "none"}`,
    `Next Milestone: ${nextMilestone(observation.milestones) ?? "none: you reached all the Milestones."}`,
    `Notes: ${read.at(-1)?.notes || "none"}`,
    missionLine(events),
    "",
    `The game waits for ${now}.`,
    `Objective: ${read.findLast((d) => d.objective)?.objective || "none yet"}`,
    `Decision points with no progress: ${noProgress.decisions}.`,
    tried.length === 0 ? "Your tries since the last progress: none." : ["Your tries since the last progress (a new cell or a new Milestone):", ...tried].join("\n"),
    "",
    calls.length === 0 ? "Your last decisions: none yet." : ["Your last decisions, oldest first:", ...calls].join("\n"),
    "",
    partyText(observation.party),
    `Money: ${observation.money}`,
    bagText(observation.bag),
    "",
    ...context(asked),
    "",
    "Actions:",
    ...actionLines(asked),
    PRESS,
  ].join("\n");
}

/** The new user message after viewAtlas: the full Atlas. */
export function atlasMessage(asked: Asked & { kind: "walk" }): string {
  return [...fullAtlas(asked.overworld).slice(1), "", chooseAgain({ ...asked, atlasViewed: true })].join("\n");
}

/** The new user message after an answer that the Bot cannot read: the error. */
export function errorMessage(error: string, asked: Asked): string {
  return [`Your answer could not be read: ${error}.`, "", chooseAgain(asked)].join("\n");
}

function chooseAgain(asked: Asked): string {
  return `Answer with JSON again, with one of the actions of the first message: ${alternatives(actionsOf(asked))}.`;
}

export function missionLine(events: readonly RunEvent[]): string {
  const decisions = modelEvents(events).flatMap((e) => (e.decision ? [e.decision] : []));
  const mission = decisions.findLast((d) => d.mission)?.mission;
  if (!mission) return "Mission: none yet.";
  // An empty Mission keeps the last one.
  const times = decisions.length - 1 - decisions.findLastIndex((d) => d.mission && d.mission !== mission);
  return `Mission: ${mission} (the same for ${times} decision${times === 1 ? "" : "s"}).`;
}

/** The first Milestone, in the order of the story, that the Run did not reach; null when it reached all. */
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
  return calls.slice(-MAX_PAST_CALLS).map(({ call, events: after }, i) => {
    const lines = after.flatMap(eventLines);
    const answer = call.decision ? `You chose: ${call.decision.action}` : `Your answer could not be read: ${call.error}`;
    const shown = lines.length > MAX_CALL_LINES ? [`… ${lines.length - MAX_CALL_LINES + 1} lines before`, ...lines.slice(-(MAX_CALL_LINES - 1))] : lines;
    return [`${i + 1}. At ${call.situation}. ${answer}`, ...shown.map((line) => `   ${line}`)].join("\n");
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

// The Bag is in each prompt once, with the effect of each item: the action lines only name the items.
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
    case "choice": {
      const place = "overworld" in asked ? localView(asked.overworld, mapNamed(asked.overworld.atlas, asked.overworld.map.name), []) : battleLines(asked.battle);
      return [...place, "", "The question is the last text of your last decisions."];
    }
    case "partyPick":
      return [...battleLines(asked.battle), "No action covers the party menu: use press. Up and Down move the cursor, A chooses, B goes back."];
    default:
      return battleLines(asked.battle);
  }
}

// The actions of actionsOf, with their help; press is the last action of each list.
function actionLines(asked: Asked): string[] {
  switch (asked.kind) {
    case "walk": {
      const { grid } = asked.overworld;
      return [
        ...(asked.view.targets.length === 0 ? [] : ["- go <target number>: walk to the target. At an exit, take it. At a person or a sign, walk next to it, then talk to it or read it."]),
        `- goTo <x> <y>: walk to a cell of this map. A cell just past an edge (x -1 or ${grid.mapWidth}, y -1 or ${grid.mapHeight}) crosses that edge.`,
        "- goTo <x> <y> <map>: walk to a cell of another map.",
        ...(actionsOf(asked).includes("viewAtlas") ? ["- viewAtlas: get the full Atlas, all the maps that you know in detail, then choose again. The game does not move. One time at most at each decision."] : []),
      ];
    }
    case "choice":
      return asked.options.map((option) => `- choose ${option}`);
    case "battleAction":
      return [...fights(asked.battle), `- run${asked.battle.kind === "trainer" ? ": impossible in a trainer battle" : ""}`, ...useLine(asked.items)];
    case "battleMove":
      return fights(asked.battle);
    case "partyPick":
      return [];
  }
}

function useLine(items: BagItem[]): string[] {
  if (items.length === 0) return [];
  const names = items.map((item) => (item.battle === "pokemon" ? `${item.name} (on a Pokémon)` : item.name));
  return [`- use <item> [on <Pokémon>]: use an item of your Bag. The items that work now: ${names.join(", ")}.`];
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
