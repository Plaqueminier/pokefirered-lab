import type { Decision, ModelEvent, RunEvent } from "../src/harness/record";
import type { ShownRun } from "../src/protocol";
import { element } from "./dom";
import { runKey } from "./runs";

const BLOCK_TITLES: [RegExp, string][] = [
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
];

type Answer = Decision | { error: string; raw: string | null };

type CallView = { title: string; answer: Answer; fields: Record<string, string>; usage: string; blocks: { title: string; text: string }[] };

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
  const { system, user, turns = [] } = call.prompt;
  const turnBlocks = turns.flatMap((turn) => [{ title: "Your answer", text: turn.assistant }, ...messageBlocks(turn.user)]);
  const cached = cachedTokens === undefined ? "" : ` (${cachedTokens} cached)`;
  return {
    title: [`call ${index + 1}`, `frame ${call.frame}`, call.model, call.situation, ...stuckText(call.stuck, turnText(call))].join(" · "),
    answer: call.decision ?? { error: call.error, raw: call.answer },
    fields: call.decision ? answerFields(call.decision) : {},
    usage: `${promptTokens} tokens in${cached} · ${completionTokens} out (${reasoningTokens} reasoning) · ${Number(cost.toFixed(6))} $ · ${(call.latencyMs / 1000).toFixed(1)} s`,
    blocks: [...messageBlocks(user), ...turnBlocks, { title: "Rules", text: system }],
  };
}

function turnText({ reflection, review }: ModelEvent): string | undefined {
  return reflection ? "reflection turn" : review ? "review turn" : undefined;
}

function stuckText(stuck: number | undefined, turn: string | undefined): string[] {
  return stuck === undefined ? [] : [`stuck ${stuck}`, ...(turn ? [turn] : [])];
}

function answerFields(decision: Decision): Record<string, string> {
  return { Mission: decision.mission || "–", Objective: decision.objective || "–", Note: decision.note || "–" };
}

function messageBlocks(message: string): { title: string; text: string }[] {
  return message.split("\n\n").map((text) => ({ title: BLOCK_TITLES.find(([start]) => start.test(text))?.[1] ?? "Other", text }));
}

// A Run that ended with an error can have a Model call with no model event.
export function callsStarted(shown: ShownRun): number {
  return shown.kind === "bot" && shown.run.playing ? (shown.run.model?.callsStarted ?? 0) : 0;
}

export type ModelPanelElements = { title: HTMLElement; follow: HTMLButtonElement; calls: HTMLElement; answer: HTMLElement; blocks: HTMLElement };

export class ModelPanel {
  #events: readonly RunEvent[] = [];
  #callsStarted = 0;
  #selected: number | null = null;
  #shownCall = "";
  #run = "";

  constructor(private readonly ui: ModelPanelElements) {
    ui.follow.addEventListener("click", () => this.select(null));
    ui.calls.addEventListener("click", (event) => {
      const row = (event.target as HTMLElement).closest<HTMLElement>("[data-call]");
      if (row) this.select(Number(row.dataset.call));
    });
  }

  onEvents(events: readonly RunEvent[]): void {
    if (events.length < this.#events.length) this.#selected = null;
    this.#events = events;
    this.render();
  }

  onStatus(shown: ShownRun): void {
    const run = runKey(shown);
    const started = callsStarted(shown);
    if (run === this.#run && started === this.#callsStarted) return;
    if (run !== this.#run) this.#selected = null;
    this.#run = run;
    this.#callsStarted = started;
    this.render();
  }

  private select(index: number | null): void {
    this.#selected = index;
    this.render();
  }

  private render(): void {
    const view = modelPanelView(this.#events, this.#callsStarted, this.#selected);
    const { ui } = this;
    ui.title.textContent = [view.call?.title ?? "no Model call yet", view.thinking ? "the model thinks…" : null].filter(Boolean).join(" · ");
    ui.follow.classList.toggle("on", this.#selected === null);
    ui.calls.replaceChildren(
      ...view.rows.map((row, i) => {
        const line = document.createElement("div");
        line.className = `model-call${i === view.selected ? " on" : ""}`;
        line.dataset.call = String(i);
        const frame = document.createElement("span");
        frame.className = "muted";
        frame.textContent = String(row.frame);
        const action = document.createElement("b");
        action.textContent = row.action ?? "unreadable";
        const stuck = document.createElement("span");
        stuck.className = row.turn ? "model-reflection" : "muted";
        stuck.textContent = stuckText(row.stuck, row.turn).map((text) => ` · ${text}`).join("");
        line.append(frame, ` ${row.situation} → `, action, stuck);
        return line;
      }),
    );
    // scrollIntoView also scrolls the page: scroll only the list.
    if (this.#selected === null) ui.calls.scrollTop = ui.calls.scrollHeight;
    const key = view.call ? `${view.selected} ${view.call.title}` : "";
    if (key === this.#shownCall) return;
    this.#shownCall = key;
    ui.answer.replaceChildren(...(view.call ? answerNodes(view.call) : []));
    ui.blocks.replaceChildren(...(view.call?.blocks ?? []).flatMap((block) => [element("h3", block.title), element("pre", block.text, "model-pre")]));
  }
}

function answerNodes({ answer, fields, usage }: CallView): HTMLElement[] {
  const nodes =
    "error" in answer
      ? [element("div", `Unreadable answer: ${answer.error}`, "model-error"), element("pre", answer.raw ?? "(no answer: the request failed)", "model-pre")]
      : [element("div", `→ ${answer.action}`, "model-action"), element("div", answer.reason), definitions(fields)];
  return [...nodes, element("div", usage, "mono muted")];
}

function definitions(pairs: Record<string, string>): HTMLElement {
  const list = element("dl", "", "model-dl");
  for (const [term, text] of Object.entries(pairs)) list.append(element("dt", term), element("dd", text));
  return list;
}
