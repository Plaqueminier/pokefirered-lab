import { actionText, type BattleState, type Observation } from "../harness/harness";
import { kindAt } from "../harness/path";
import { type ModelEvent, modelEvents, type RunEvent } from "../harness/record";
import type { PartyMon } from "../party";
import { type Asked, type AskedKind, MAX_NOTES } from "./decision";
import type { Overworld, Target } from "./targets";

export const B_PRESSES = 3;
const LONG_TERM_GOAL = "Become the Champion: earn the 8 gym badges, then beat the Elite Four.";
const MAX_PAST_CALLS = 15;
const MAX_CALL_LINES = 30;
const MARKS = "123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const WAITS: Record<AskedKind, string> = {
  walk: "a walk",
  choice: "a choice",
  battleAction: "a battle action",
  battleMove: "a move",
  partyPick: "a Pokémon in the party menu of the battle",
};
const STAT_LABELS: Record<string, string> = { spAttack: "special attack", spDefense: "special defense" };
const UNKNOWN_SCREEN = `The game showed a screen that no action covers: the program pressed B ${B_PRESSES} times.`;
const PRESS = "- press <button>: one press of A, B, Start, Select, Up, Down, Left, Right, L or R.";

export function systemPrompt(runGoal: string): string {
  return `You play Pokémon FireRed. A program plays your actions in the game, and the game is frozen while you think.

Long-term goal: ${LONG_TERM_GOAL}
Goal of this run: ${runGoal}

At each decision, you get what the game waits for, your objective, your notes, your last decisions with what the program played and the texts of the game, and the actions that you can choose now.

Answer with JSON:
- "reason": why you choose this action, in one or two short sentences.
- "action": exactly one of the actions of the message, for example "go 2" or "choose NO".
- "objective": what you do now, in one short sentence, for example "Take the parcel to Professor Oak". Change it when the game gives you a new task.
- "notes": your memory, at most ${MAX_NOTES} characters. You get them back at the next decision: write them again in full each time, with the facts that you want to keep.

Rules of the program:
- The program reads all the texts for you, and waits while the game is busy. You see the texts in your last decisions.
- At the nickname question, answer NO: the program cannot type names yet.
- When the game shows a screen that no action covers, the program presses B ${B_PRESSES} times.
- "press" is one button press. Use it only when no other action fits.
- An action that is "impossible" changes nothing in the game: read its reason, then choose another action.

When your last decisions give nothing new, do not do them again: try something that you did not try. Talk to the people, read the signs, take the exits and the edges to a map that you have not visited. The story often goes on in a place that you do not expect.`;
}

/** The Objective is the last one that the model gave; the notes are those of the last answer that the Bot could read. */
export function userPrompt(observation: Observation, asked: Asked, events: readonly RunEvent[]): string {
  const now = asked.kind === "choice" ? `${WAITS.choice}: ${asked.options.join(", ")}` : WAITS[asked.kind];
  const read = modelEvents(events).flatMap((e) => (e.decision ? [e.decision] : []));
  const calls = pastCalls(events);
  return [
    `The game waits for ${now}.`,
    `Objective: ${read.findLast((d) => d.objective)?.objective || "none yet"}`,
    `Notes: ${read.at(-1)?.notes || "none"}`,
    "",
    calls.length === 0 ? "Your last decisions: none yet." : ["Your last decisions, oldest first:", ...calls].join("\n"),
    "",
    partyText(observation.party),
    `Milestones: ${observation.milestones.join(", ") || "none"}`,
    "",
    ...context(asked),
    "",
    "Actions:",
    ...actionLines(asked),
    PRESS,
  ].join("\n");
}

export function situation(asked: Asked): string {
  if (asked.kind !== "walk") return WAITS[asked.kind];
  const { map, player } = asked.overworld;
  return `a walk on ${map.name} (${player.x}, ${player.y})`;
}

// The last Model calls, each with what the program played and the game did until the next one.
function pastCalls(events: readonly RunEvent[]): string[] {
  const starts = events.flatMap((e, i) => (e.type === "model" ? [i] : []));
  const calls: { call: ModelEvent; lines: string[] }[] = [];
  for (const event of events.slice(starts[Math.max(0, starts.length - MAX_PAST_CALLS)] ?? events.length)) {
    if (event.type === "model") calls.push({ call: event, lines: [] });
    else calls.at(-1)?.lines.push(...eventLines(event));
  }
  return calls.map(({ call, lines }, i) => {
    const answer = call.decision ? `You chose: ${call.decision.action}` : `Your answer could not be read: ${call.error}`;
    const shown = lines.length > MAX_CALL_LINES ? [`… ${lines.length - MAX_CALL_LINES + 1} lines before`, ...lines.slice(-(MAX_CALL_LINES - 1))] : lines;
    return [`${i + 1}. At ${call.situation}. ${answer}`, ...shown.map((line) => `   ${line}`)].join("\n");
  });
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
    return `- ${name}: level ${m.level}, HP ${m.hp}/${m.maxHp}, status ${m.status}, moves ${m.moves.map((move) => `${move.name} (PP ${move.pp}/${move.maxPp})`).join(", ")}`;
  };
  return ["Party:", ...party.map(mon)].join("\n");
}

function context(asked: Asked): string[] {
  switch (asked.kind) {
    case "walk":
      return mapLines(asked.overworld, asked.targets);
    case "choice":
      return [...mapLines(asked.overworld, []), "", "The question is the last text of your last decisions."];
    case "partyPick":
      return [...battleLines(asked.battle), "", "No action covers the party menu: use press. Up and Down move the cursor, A chooses, B goes back."];
    default:
      return battleLines(asked.battle);
  }
}

// The same actions as MODEL_ACTIONS, with their help; press is the last action of each list.
function actionLines(asked: Asked): string[] {
  switch (asked.kind) {
    case "walk": {
      const { grid } = asked.overworld;
      return [
        ...(asked.targets.length === 0 ? [] : ["- go <target number>: walk to the target. At an exit, take it. At a person or a sign, walk next to it, then talk to it or read it."]),
        `- goTo <x> <y>: walk to a cell of this map. A cell just past an edge (x -1 or ${grid.mapWidth}, y -1 or ${grid.mapHeight}) crosses that edge.`,
        "- goTo <x> <y> <map>: walk to a cell of another map.",
      ];
    }
    case "choice":
      return asked.options.map((option) => `- choose ${option}`);
    case "battleAction":
      return [...fights(asked.battle), `- run${asked.battle.kind === "trainer" ? ": impossible in a trainer battle" : ""}`];
    case "battleMove":
      return fights(asked.battle);
    case "partyPick":
      return [];
  }
}

function fights({ player }: BattleState): string[] {
  return player.moves.map((move, i) => `- fight ${i}: ${move.name} (PP ${move.pp}/${move.maxPp})`);
}

function mapLines({ grid, player }: Overworld, targets: Target[]): string[] {
  const rows = Array.from({ length: grid.mapHeight }, (_, y) => Array.from({ length: grid.mapWidth }, (_, x) => kindAt(grid, { x, y })));
  targets.forEach((target, i) => {
    if (target.kind !== "edge" && rows[target.cell.y]?.[target.cell.x] !== undefined) rows[target.cell.y][target.cell.x] = MARKS[i] ?? "*";
  });
  rows[player.y][player.x] = "@";
  const columns = Array.from({ length: grid.mapWidth }, (_, x) => x);
  return [
    `Map ${grid.name}, ${grid.mapWidth} × ${grid.mapHeight} cells. You are at (${player.x}, ${player.y}), facing ${player.facing}.`,
    `    ${columns.map((x) => (x % 10 === 0 ? String(Math.floor(x / 10) % 10) : " ")).join("")}`,
    `    ${columns.map((x) => x % 10).join("")}`,
    ...rows.map((row, y) => `${String(y).padStart(3)} ${row.join("")}`),
    'Legend: @ you, # blocked, . open, " tall grass, ~ water, ^ v < > a ledge that you can jump down only in that direction, 1-9 and A-Z the targets (A is 10, B is 11…).',
    ...(targets.length === 0 ? [] : ["", "Targets:", ...targets.map((t, i) => `${i + 1}. ${t.label}`)]),
  ];
}

function battleLines({ kind, player, enemy }: BattleState): string[] {
  const stats = Object.entries(player.stats).map(([stat, value]) => `${STAT_LABELS[stat] ?? stat} ${value}`);
  return [
    `Battle against ${kind === "trainer" ? "a trainer" : "a wild Pokémon"}.`,
    `Your ${player.nickname}: level ${player.level}, HP ${player.hp}/${player.maxHp}, status ${player.status}. Stats: ${stats.join(", ")}. Stat stages: ${stagesText(player.statStages)}.`,
    `Foe ${enemy.species}: level ${enemy.level}, HP ${enemy.hpPercent}%, status ${enemy.status}. Stat stages: ${stagesText(enemy.statStages)}. Moves seen: ${enemy.movesSeen.join(", ") || "none"}.`,
  ];
}

function stagesText(stages: Record<string, number>): string {
  const changed = Object.entries(stages).filter(([, stage]) => stage !== 0);
  return changed.map(([stat, stage]) => `${STAT_LABELS[stat] ?? stat} ${stage > 0 ? "+" : ""}${stage}`).join(", ") || "none";
}
