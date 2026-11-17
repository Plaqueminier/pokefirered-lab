import { DIRECTION_STEP } from "../cells";
import { isStateEvent } from "../harness/game-events";
import type { ActionEntry, PushReport } from "../harness/harness";
import { type ActionEvent, type BattleStart, type CallTurn, callTurns, isBattleStart, isDecision, isSilentRead, type ModelEvent, type RunEvent } from "../harness/record";
import { actionText, modelEvents } from "../protocol";
import type { Asked, AskedKind } from "./decision";

export const B_PRESSES = 3;
const MAX_PAST_CALLS = 15;
const MAX_CALL_LINES = 30;
export const MAX_TRIES = 20;
const LOOP_AFTER = 3;
const MAX_OUTCOME = 200;
export const WAITS: Record<AskedKind, string> = {
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
const UNKNOWN_SCREEN = `The game showed a screen that no action covers: the program pressed B ${B_PRESSES} times.`;
const WORD_SCREEN_LEFT = "The game opened a screen to write the words of a profile, and you cannot write words: the program left it. A profile gives nothing in the game: choose NO when a person asks for your profile.";

export function sinceBattleStart(answers: AnsweredTurn[]): AnsweredTurn[] {
  const start = answers.findLastIndex((turn) => turn.events.some(isBattleStart));
  return answers.slice(Math.max(0, start));
}

type FinishedBattle = { start: number; end: number; begin: BattleStart };

export function finishedBattles(answers: AnsweredTurn[]): FinishedBattle[] {
  const battles: FinishedBattle[] = [];
  let open: { start: number; begin: BattleStart } | null = null;
  answers.forEach(({ events }, i) => {
    for (const event of events) {
      if (event.type !== "battle") continue;
      if (isBattleStart(event)) open = { start: i, begin: event };
      else if (open) {
        battles.push({ ...open, end: i });
        open = null;
      }
    }
  });
  return battles;
}

/** The last decisions of the walk, with one line for each battle that ended. The newest first, so that only the lines that show are written. */
export function walkHistory(answers: AnsweredTurn[], battles: FinishedBattle[], events: readonly RunEvent[]): string[] {
  const newest: string[] = [];
  let end = answers.length;
  for (const battle of battles.toReversed()) {
    newest.push(...pastCalls(answers.slice(battle.end + 1, end)).toReversed());
    if (newest.length >= MAX_PAST_CALLS) break;
    newest.push(`- ${battleText(answers, battle, events)}`);
    end = battle.start + 1;
  }
  if (newest.length < MAX_PAST_CALLS) newest.push(...pastCalls(answers.slice(0, end)).toReversed());
  return newest.slice(0, MAX_PAST_CALLS).toReversed();
}

export function returnLine(asked: Asked, answers: AnsweredTurn[], battles: FinishedBattle[], events: readonly RunEvent[]): string[] {
  const last = battles.at(-1);
  if (asked.kind !== "walk" || !last) return [];
  const walked = answers.slice(last.end + 1).some((turn) => isDecision(turn) && turn.call.situation.startsWith(WAITS.walk));
  return walked ? [] : [`Back to the walk. ${battleText(answers, last, events)}`, ""];
}

function battleText(answers: AnsweredTurn[], { start, end, begin }: FinishedBattle, events: readonly RunEvent[]): string {
  const { trainer, foe } = begin;
  const after = answers.slice(start, end + 1).flatMap((turn) => turn.events);
  const fought = after.slice(after.indexOf(begin));
  const decisions = answers.slice(start + 1, end + 1).filter(isDecision).length;
  const fainted = fought.flatMap((e) => (e.type === "faint" && e.side === "player" ? [e.species] : []));
  const objective = answers.slice(0, start + 1).findLast((turn) => turn.call.decision?.objective)?.call.decision?.objective;
  return [
    `Battle against ${foe ?? (trainer ? "a trainer" : "a wild Pokémon")}, ${decisions} decision${decisions === 1 ? "" : "s"}: ${battleResult(fought, trainer)}.`,
    fainted.length === 0 ? "None of your Pokémon fainted." : `${[fainted.slice(0, -1).join(", "), fainted.at(-1)].filter(Boolean).join(" and ")} fainted.`,
    ...stoppedText(answers[start], events),
    ...(objective ? [`Your Objective before the battle was "${objective}".`] : []),
  ].join(" ");
}

function battleResult(fought: readonly RunEvent[], trainer: boolean | undefined): string {
  const caught = fought.find((e) => e.type === "catch");
  if (caught) return `you caught ${caught.species}`;
  if (fought.some((e) => e.type === "trainer")) return "you won";
  if (trainer || fought.some((e) => e.type === "whiteout")) return "you lost";
  if (fought.some((e) => e.type === "faint" && e.side === "enemy")) return "you won";
  return fought.some((e) => e.type === "action" && e.action.name === "run" && e.result.status === "done") ? "you ran" : "the foe fled";
}

function stoppedText({ call, events: played }: AnsweredTurn, events: readonly RunEvent[]): string[] {
  const stopped = played.find((e): e is ActionEvent => e.type === "action" && e.result.status === "interrupted" && (e.result.reason === "battle" || e.result.reason === "trainer"));
  if (!stopped || !call.decision || !("x" in stopped.action && "y" in stopped.action)) return [];
  const { x, y } = stopped.action;
  const map = (stopped.action.name === "goTo" ? stopped.action.map : undefined) ?? events.slice(0, events.indexOf(stopped)).findLast((e) => e.type === "map")?.map;
  return [`The battle stopped your ${call.decision.action}: a walk to (${x}, ${y})${map ? ` on ${map}` : ""}.`];
}

export function situation(asked: Asked): string {
  if (asked.kind !== "walk") return WAITS[asked.kind];
  const { map, player } = asked.overworld;
  return `a walk on ${map.name} (${player.x}, ${player.y})`;
}

type AnsweredTurn = CallTurn & { call: ModelEvent };

export function answeredTurns(events: readonly RunEvent[]): AnsweredTurn[] {
  return callTurns(events).flatMap((turn) => (turn.call ? [{ call: turn.call, events: withoutSilentInterruptions(turn.events) }] : []));
}

function withoutSilentInterruptions<E extends RunEvent>(events: E[]): E[] {
  const hidden = new Set<E>();
  events.forEach((interruption, i) => {
    if (interruption.type !== "action" || interruption.result.status !== "interrupted" || interruption.result.reason !== "trigger") return;
    let first = i + 1;
    while (first < events.length && events[first].type !== "action") first++;
    let end = first;
    while (end < events.length && isSilentRead(events[end])) end++;
    const replay = events[end];
    if (replay?.type !== "action" || actionText(replay.action) !== actionText(interruption.action)) return;
    hidden.add(interruption);
    for (const read of events.slice(first, end)) hidden.add(read);
  });
  return hidden.size === 0 ? events : events.filter((event) => !hidden.has(event));
}

// The last Model calls, each with what the program played and the game did until the next one.
export function pastCalls(answers: AnsweredTurn[]): string[] {
  return answers.slice(-MAX_PAST_CALLS).map(({ call, events: after }) => {
    const lines = after.flatMap(eventLines);
    const said = call.decision?.say ? `. You said: "${call.decision.say}"` : "";
    const answer = call.decision ? `You chose: ${call.decision.action}${said}` : `Your answer could not be read: ${call.error}`;
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

export function loopWarning(answers: AnsweredTurn[]): string[] {
  const last = answers
    .map((turn) => answerTries(turn.events).map(described).join("; "))
    .filter(Boolean)
    .slice(-LOOP_AFTER);
  return last.length === LOOP_AFTER && last.every((played) => played === last[0])
    ? [`Warning: your last ${LOOP_AFTER} decisions played the same action with the same result: ${last[0]}. If it does not bring you closer to your objective, choose another action.`]
    : [];
}

function statusText(result: Try["result"]): string {
  const status = result.status === "done" ? "done" : `${result.status} (${result.reason})`;
  const effect = effectText(result);
  return effect ? `${status}, ${effect}` : status;
}

function effectText({ push, slidTo }: Try["result"]): string | null {
  if (push) return pushText(push);
  return slidTo ? `you stepped on the spin tile and slid to (${slidTo.x}, ${slidTo.y})` : null;
}

function pushText(push: PushReport): string {
  const { pushes, x, y, direction } = push;
  const count = `${pushes} push${pushes === 1 ? "" : "es"}`;
  const [dx, dy] = DIRECTION_STEP[direction];
  switch (push.stop) {
    case "blocked":
      return `${count}: the boulder cannot move to the ${direction}: (${x + dx}, ${y + dy}) is blocked`;
    case "hole":
      return `${count}: the boulder fell through the hole at (${x}, ${y})${push.into ? ` to ${push.into}` : ""}`;
    case "switch":
      return `${count}: the boulder is at (${x}, ${y}), on a switch`;
    default:
      return `${count}: the boulder is at (${x}, ${y})`;
  }
}

function outcome({ result, texts }: Try): string {
  const status = result.status === "done" && effectText(result) === null && texts.length > 0 ? "" : statusText(result);
  const text = [status, texts.map((t) => `"${t}"`).join(" ")].filter(Boolean).join(", ");
  return text.length > MAX_OUTCOME ? `${text.slice(0, MAX_OUTCOME - 1)}…` : text;
}

function eventLines(event: Exclude<RunEvent, ModelEvent>): string[] {
  // The last decisions do not show the state events: the Coach advice tells them.
  if (isStateEvent(event)) return [];
  switch (event.type) {
    case "action": {
      const { action, result } = event;
      const texts = "text" in result ? result.text.map((text) => `  "${text}"`) : [];
      const lines = [`${actionText(action)}: ${statusText(result)}, ${result.frames} frames`, ...texts];
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
