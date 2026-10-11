import type { RunEvent } from "../src/harness/record";
import type { ClientMessage, ShownRun } from "../src/protocol";

type ActionEvent = Extract<RunEvent, { type: "action" }>;

function actionLabel({ action }: ActionEvent): string {
  const { name, ...args } = action;
  return `${name}(${Object.values(args).join(", ")})`;
}

function resultLabel({ result }: ActionEvent): string {
  const reason = "reason" in result ? ` (${result.reason})` : "";
  return `${result.status}${reason} en ${result.frames} images`;
}

function texts({ result }: ActionEvent): string[] {
  return "text" in result ? result.text.map((text) => `« ${text} »`) : [];
}

function eventLabel(event: Exclude<RunEvent, ActionEvent>): string {
  switch (event.type) {
    case "map":
      return `carte ${event.map}`;
    case "battle":
      return event.state === "start" ? "début du combat" : "fin du combat";
    case "milestone":
      return `étape ${event.milestone}`;
    case "model":
      return `modèle : ${event.text}`;
  }
}

function statusText(frame: number, shown: ShownRun): string {
  if (shown.kind === "bot") return `Run ${shown.run.id} · image ${frame}`;
  const { replay } = shown;
  if (!replay) return "pas de replay : le clavier joue la Run";
  if (replay.ended) return `${replay.name} · fin du replay à l'image ${replay.frames} · ${replay.endReason}`;
  return `${replay.name} · image ${frame} / ${replay.frames}`;
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
    if (names.length === 0) this.ui.records.append(new Option("aucun Run record dans lab/runs/", ""));
  }

  onEvents(events: RunEvent[]): void {
    this.events = events;
    this.render();
  }

  onStatus(frame: number, shown: ShownRun): void {
    this.frame = frame;
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
    this.ui.detail.textContent = action ? [`depuis l'image ${action.frame} · ${done ? resultLabel(action) : "en cours"}`, ...(done ? texts(action) : [])].join("\n") : "";
    this.ui.model.textContent = this.events.findLast((e) => e.type === "model")?.text ?? "";
    const log = this.events.map((event) => `${String(event.frame).padStart(6)}  ${event.type === "action" ? actionLabel(event) : eventLabel(event)}`).join("\n");
    if (this.ui.events.textContent === log) return;
    this.ui.events.textContent = log;
    this.ui.events.scrollTop = this.ui.events.scrollHeight;
  }
}
