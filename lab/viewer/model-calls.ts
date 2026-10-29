import type { ActionEntry } from "../src/harness/harness";
import type { ActionEvent, Decision, ModelEvent, RunEvent } from "../src/harness/record";
import type { ShownRun } from "../src/protocol";

const BLOCK_TITLES = [
  [/^Milestones/, "Progress"],
  [/^Memory tree/, "Memory tree"],
  [/^The game waits|^The game asks|^The naming screen asks/, "Situation"],
  [/^Your last decisions/, "History"],
  [/^Something important happened/, "Events"],
  [/^Party/, "Party"],
  [/^Known world/, "Known world"],
  [/^Map /, "Local view"],
  [/^What the people/, "People"],
  [/^Maps one exit away/, "Atlas"],
  [/^Targets/, "Targets"],
  [/^Exits of this map/, "Targets"],
  [/^Full Atlas/, "Full Atlas"],
  [/^Node #|^There is no node/, "Zoom"],
  [/^Battle against/, "Battle"],
  [/^The Poké Mart sells/, "Poké Mart"],
  [/^The question is/, "Question"], // The prompts of the old Run records
  [/^Actions/, "Actions"],
  [/^Your answer could not be read/, "Error"],
  [/^Answer with JSON again/, "Request"],
  [/^Your action ".*" is impossible/, "Impossible"],
] as const;

export type BlockTitle = (typeof BLOCK_TITLES)[number][1] | "Your answer" | "Rules" | "Other";

type Answer = Decision | { error: string; raw: string | null };

export type PromptBlock = { id: string; title: BlockTitle; text: string };

type CallView = { title: string; answer: Answer; fields: Record<string, string>; usage: string; blocks: PromptBlock[] };

type CallRow = { frame: number; situation: string; action: string | null; stuck?: number; turn?: string };

export type ModelPanelView = { rows: CallRow[]; selected: number | null; thinking: boolean; call: CallView | null };

export function modelCalls(events: readonly RunEvent[]): { calls: ModelEvent[]; thinking: (callsStarted: number) => boolean } {
  const calls = events.filter((e): e is ModelEvent => e.type === "model");
  return { calls, thinking: (callsStarted) => callsStarted > calls.length };
}

export function modelPanelView(events: readonly RunEvent[], callsStarted: number, selected: number | null): ModelPanelView {
  const { calls, thinking } = modelCalls(events);
  const index = selected !== null && selected < calls.length ? selected : calls.length - 1;
  const call = calls[index];
  return {
    rows: calls.map((c) => ({ frame: c.frame, situation: c.situation, action: c.decision?.action ?? null, stuck: c.stuck, turn: turnText(c) })),
    selected: call ? index : null,
    thinking: thinking(callsStarted),
    call: call ? callView(call, index) : null,
  };
}

function callView(call: ModelEvent, index: number): CallView {
  const { promptTokens, cachedTokens, completionTokens, reasoningTokens, cost } = call.usage;
  const cached = cachedTokens === undefined ? "" : ` (${cachedTokens} cached)`;
  return {
    title: [`call ${index + 1}`, `frame ${call.frame}`, call.model, call.situation, ...stuckText(call.stuck, turnText(call))].join(" · "),
    answer: call.decision ?? { error: call.error, raw: call.answer },
    fields: call.decision ? answerFields(call.decision) : {},
    usage: `${promptTokens} tokens in${cached} · ${completionTokens} out (${reasoningTokens} reasoning) · ${Number(cost.toFixed(6))} $ · ${(call.latencyMs / 1000).toFixed(1)} s`,
    blocks: promptBlocks(call),
  };
}

function turnKind({ reflection, review }: ModelEvent): "reflection" | "review" | undefined {
  return reflection ? "reflection" : review ? "review" : undefined;
}

function turnText(call: ModelEvent): string | undefined {
  const kind = turnKind(call);
  return kind && `${kind} turn`;
}

// The request of a Review turn is in the prompt of the Model call: the question, then the checks as a list.
export function reviewText({ prompt }: ModelEvent): string | null {
  return /^Review turn:.*(\n- .*)*/m.exec(prompt.user)?.[0] ?? null;
}

function stuckText(stuck: number | undefined, turn: string | undefined): string[] {
  return stuck === undefined ? [] : [`stuck ${stuck}`, ...(turn ? [turn] : [])];
}

function answerFields(decision: Decision): Record<string, string> {
  return { Mission: decision.mission || "–", Objective: decision.objective || "–", Note: decision.note || "–" };
}

function messageBlocks(message: string): { title: BlockTitle; text: string }[] {
  return message.split("\n\n").map((text): { title: BlockTitle; text: string } => ({ title: BLOCK_TITLES.find(([start]) => start.test(text))?.[1] ?? "Other", text }));
}

export function promptBlocks({ prompt }: ModelEvent): PromptBlock[] {
  const { system, user, turns = [] } = prompt;
  const blocks: { title: BlockTitle; text: string }[] = [
    ...messageBlocks(user),
    ...turns.flatMap((turn) => [{ title: "Your answer" as const, text: turn.assistant }, ...messageBlocks(turn.user)]),
    { title: "Rules", text: system },
  ];
  const seen = new Map<string, number>();
  return blocks.map((block) => {
    const n = (seen.get(block.title) ?? 0) + 1;
    seen.set(block.title, n);
    return { ...block, id: n > 1 ? `${block.title} ${n}` : block.title };
  });
}

// A Run that ended with an error can have a Model call with no model event.
export function callsStarted(shown: ShownRun): number {
  return shown.kind === "bot" && shown.run.playing ? (shown.run.model?.callsStarted ?? 0) : 0;
}

export const FLAGS = ["unreadable", "impossible", "reflection", "review", "expensive", "turns", "mission", "repeat"] as const;

export type Flag = (typeof FLAGS)[number];

export type UnusualCall = {
  index: number;
  call: ModelEvent;
  /** In the order of FLAGS, each with the text that tells why it is on. */
  flags: { flag: Flag; why: string }[];
  played: ActionEvent[];
  missionChanged: boolean;
  objectiveChanged: boolean;
};

const EXPENSIVE = 3;
const REPEATS = 3;

// The 4 kinds of more turn of bots/model.ts, by the first block of their user message.
const TURN_ACTIONS: Partial<Record<BlockTitle, string>> = { Zoom: "zoom", "Full Atlas": "viewAtlas", Impossible: "retry after an impossible action", Error: "retry after an unreadable answer" };

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
}

function expensiveText(call: ModelEvent, medians: { cost: number; latency: number; tokens: number }): string {
  const above = (name: string, value: number, median: number) => (median > 0 && value > EXPENSIVE * median ? [`${name} ${(value / median).toFixed(1)}× the median`] : []);
  return [...above("cost", call.usage.cost, medians.cost), ...above("latency", call.latencyMs, medians.latency), ...above("prompt tokens", call.usage.promptTokens, medians.tokens)].join(", ");
}

function turnsText({ prompt }: ModelEvent): string {
  const actions = (prompt.turns ?? []).map((turn) => {
    const title = messageBlocks(turn.user)[0]?.title ?? "Other";
    return TURN_ACTIONS[title] ?? title;
  });
  return actions.length ? `${actions.length} more turn${actions.length > 1 ? "s" : ""}: ${actions.join(", ")}` : "";
}

function refusal({ result }: ActionEntry): string {
  return (result.status === "impossible" || result.status === "blocked") && "reason" in result ? `${result.status}: ${result.reason}` : "";
}

// The browser bundle cannot import the functions of record.ts (bun:ffi).
function callsWithActions(events: readonly RunEvent[]): { call: ModelEvent; played: ActionEvent[] }[] {
  const rows: { call: ModelEvent; played: ActionEvent[] }[] = [];
  for (const event of events) {
    if (event.type === "model") rows.push({ call: event, played: [] });
    else if (event.type === "action") rows.at(-1)?.played.push(event);
  }
  return rows;
}

/** The flags of each Model call of a Run, from its events: the Viewer calculates them, they are not in the Run record. */
export function unusualCalls(events: readonly RunEvent[]): UnusualCall[] {
  const rows = callsWithActions(events);
  const calls = rows.map((row) => row.call);
  const medians = { cost: median(calls.map((c) => c.usage.cost)), latency: median(calls.map((c) => c.latencyMs)), tokens: median(calls.map((c) => c.usage.promptTokens)) };
  let last: Decision | null = null;
  return rows.map(({ call, played }, index) => {
    const { decision } = call;
    const before = calls.slice(Math.max(0, index - REPEATS + 1), index);
    const missionChanged = !!decision && !!last && decision.mission !== last.mission;
    const objectiveChanged = !!decision && !!last && decision.objective !== last.objective;
    const why: Partial<Record<Flag, string>> = {};
    if (!decision) why.unreadable = call.error || "unreadable";
    else {
      if (missionChanged) why.mission = decision.mission || "–";
      if (before.length === REPEATS - 1 && before.every((c) => c.decision?.action === decision.action) && (call.stuck ?? 0) > (before[0].stuck ?? 0))
        why.repeat = `${decision.action} ${REPEATS} times, no progress`;
      last = decision;
    }
    const refused = played.map(refusal).find(Boolean);
    if (refused) why.impossible = refused;
    if (call.reflection) why.reflection = "Reflection turn";
    if (call.review) why.review = "Review turn";
    const expensive = expensiveText(call, medians);
    if (expensive) why.expensive = expensive;
    const turns = turnsText(call);
    if (turns) why.turns = turns;
    return { index, call, flags: FLAGS.flatMap((flag) => (why[flag] === undefined ? [] : [{ flag, why: why[flag] }])), played, missionChanged, objectiveChanged };
  });
}
