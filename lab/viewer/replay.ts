import type { RunEvent } from "../src/harness/record";
import type { ClientMessage, ShownRun } from "../src/protocol";
import { callsStarted, modelCalls } from "./model-panel";

type ActionEvent = Extract<RunEvent, { type: "action" }>;

function actionLabel({ action }: ActionEvent): string {
  const { name, ...args } = action;
  return `${name}(${Object.values(args).join(", ")})`;
}

function resultLabel({ result }: ActionEvent): string {
  const reason = "reason" in result ? ` (${result.reason})` : "";
  return `${result.status}${reason} in ${result.frames} frames`;
}

function texts({ result }: ActionEvent): string[] {
  return "text" in result ? result.text.map((text) => `« ${text} »`) : [];
}

function eventLabel(event: Exclude<RunEvent, ActionEvent>): string {
  switch (event.type) {
    case "map":
      return `map ${event.map}`;
    case "battle":
      return event.state === "start" ? "battle start" : "battle end";
    case "milestone":
      return `Milestone ${event.milestone}`;
    case "model":
      return `model: ${event.decision?.action ?? "no action"}`;
  }
}

function modelText(events: RunEvent[], callsStarted: number): string {
  const { calls, thinking } = modelCalls(events);
  const mission = calls.findLast((e) => e.decision?.mission)?.decision?.mission;
  const objective = calls.findLast((e) => e.decision?.objective)?.decision?.objective;
  const last = calls.at(-1);
  const answer =
    thinking(callsStarted) ? "the model thinks…"
    : !last ? null
    : last.decision ? `${last.decision.reason} → ${last.decision.action}`
    : `no action: ${last.error}`;
  return [mission ? `Mission: ${mission}` : null, objective ? `Objective: ${objective}` : null, answer].filter((line) => line !== null).join("\n");
}

function statusText(frame: number, shown: ShownRun): string {
  if (shown.kind === "bot") return `Run ${shown.run.id} · frame ${frame}`;
  const { replay } = shown;
  if (!replay) return "no replay: the keyboard plays the Run";
  if (replay.ended) return `${replay.name} · end of the replay at frame ${replay.frames} · ${replay.endReason}`;
  return `${replay.name} · frame ${frame} / ${replay.frames}`;
}

export type ReplayElements = {
  records: HTMLSelectElement;
  start: HTMLButtonElement;
  end: HTMLButtonElement;
  status: HTMLElement;
  action: HTMLElement;
  detail: HTMLElement;
  model: HTMLElement;
  events: HTMLElement;
};

export class ReplayPanel {
  private events: RunEvent[] = [];
  private frame = 0;
  private modelCallsStarted = 0;

  constructor(
    private readonly ui: ReplayElements,
    send: (message: ClientMessage) => void,
  ) {
    ui.start.addEventListener("click", () => {
      if (ui.records.value) send({ type: "replay", name: ui.records.value });
    });
    ui.end.addEventListener("click", () => send({ type: "end-replay" }));
    // A focused list takes the arrow keys, and they must go to the game.
    ui.records.addEventListener("change", () => ui.records.blur());
  }

  setRecords(names: string[]): void {
    this.ui.records.replaceChildren(...names.map((name) => new Option(name, name)));
    this.ui.start.disabled = names.length === 0;
    if (names.length === 0) this.ui.records.append(new Option("no Run record in lab/runs/", ""));
  }

  onEvents(events: RunEvent[]): void {
    this.events = events;
    this.render();
  }

  onStatus(frame: number, shown: ShownRun): void {
    this.frame = frame;
    this.modelCallsStarted = callsStarted(shown);
    const keyboard = shown.kind === "viewer" && !shown.replay;
    if (keyboard) this.events = [];
    this.ui.end.hidden = shown.kind === "bot" || keyboard;
    this.ui.status.textContent = statusText(frame, shown);
    this.render();
  }

  private render(): void {
    const action = this.events.findLast((e): e is ActionEvent => e.type === "action");
    const done = action !== undefined && this.frame >= action.frame + action.result.frames;
    this.ui.action.textContent = action ? actionLabel(action) : "–";
    this.ui.detail.textContent = action ? [`from frame ${action.frame} · ${done ? resultLabel(action) : "playing"}`, ...(done ? texts(action) : [])].join("\n") : "";
    this.ui.model.textContent = modelText(this.events, this.modelCallsStarted);
    const log = this.events.map((event) => `${String(event.frame).padStart(6)}  ${event.type === "action" ? actionLabel(event) : eventLabel(event)}`).join("\n");
    if (this.ui.events.textContent === log) return;
    this.ui.events.textContent = log;
    this.ui.events.scrollTop = this.ui.events.scrollHeight;
  }
}
