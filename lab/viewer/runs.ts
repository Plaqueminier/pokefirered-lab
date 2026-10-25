import { type ClientMessage, DEFAULT_MODEL, DEFAULT_REASONING, REASONING, type RunSummary, type ShownRun } from "../src/protocol";

const VIEWER_RUN = "";

function dollars(cost: number): string {
  return `${cost.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 4 })} $`;
}

function runState(run: RunSummary): string {
  if (run.playing) return run.stopAsked ? "stops…" : "plays";
  if (run.error) return `error: ${run.error}`;
  return `end: ${run.endReason}`;
}

function runLabel(run: RunSummary): string {
  return `Run ${run.id} · ${run.bot} · ${runState(run)}`;
}

// A scripted Bot refuses any model option: the default reasoning goes as no option.
function reasoningOption(level: string): string | undefined {
  return level === DEFAULT_REASONING ? undefined : level;
}

export type RunsElements = {
  runs: HTMLSelectElement;
  bots: HTMLSelectElement;
  model: HTMLInputElement;
  costLimit: HTMLInputElement;
  reasoning: HTMLSelectElement;
  start: HTMLButtonElement;
  stop: HTMLButtonElement;
  shownModel: HTMLElement;
};

export class RunsPanel {
  #shownRun: number | null = null;

  constructor(
    private readonly ui: RunsElements,
    send: (message: ClientMessage) => void,
  ) {
    ui.model.placeholder = DEFAULT_MODEL;
    ui.reasoning.replaceChildren(...REASONING.map((level) => new Option(`reasoning ${level}`, level, level === DEFAULT_REASONING, level === DEFAULT_REASONING)));
    ui.reasoning.addEventListener("change", () => ui.reasoning.blur());
    ui.runs.addEventListener("change", () => {
      send({ type: "show", runId: ui.runs.value === VIEWER_RUN ? null : Number(ui.runs.value) });
      ui.runs.blur();
    });
    ui.bots.addEventListener("change", () => ui.bots.blur());
    ui.stop.addEventListener("click", () => {
      if (this.#shownRun !== null) send({ type: "stop-run", runId: this.#shownRun });
    });
    ui.start.addEventListener("click", () => {
      if (!ui.bots.value) return;
      const costLimit = ui.costLimit.value.trim();
      send({ type: "start-bot", name: ui.bots.value, model: { id: ui.model.value.trim() || undefined, costLimit: costLimit ? Number(costLimit) : undefined, reasoning: reasoningOption(ui.reasoning.value) } });
    });
  }

  setBots(names: string[]): void {
    this.ui.bots.replaceChildren(...names.map((name) => new Option(name, name)));
    this.ui.start.disabled = names.length === 0;
  }

  onStatus(runs: RunSummary[], shown: ShownRun): void {
    const labels = ["Viewer Run (keyboard or replay)", ...runs.map(runLabel)];
    const values = [VIEWER_RUN, ...runs.map((run) => String(run.id))];
    const { options } = this.ui.runs;
    if (options.length !== labels.length || labels.some((label, i) => options[i].text !== label)) {
      this.ui.runs.replaceChildren(...labels.map((label, i) => new Option(label, values[i])));
    }
    this.ui.runs.value = shown.kind === "viewer" ? VIEWER_RUN : String(shown.run.id);
    const run = shown.kind === "bot" ? shown.run : null;
    this.#shownRun = run?.id ?? null;
    this.ui.stop.disabled = !run?.playing || run.stopAsked;
    this.ui.shownModel.textContent = run?.model ? `Run ${run.id}: model ${run.model.id}, reasoning ${run.model.reasoning}, cost ${dollars(run.model.cost)} of ${dollars(run.model.costLimit)}` : "";
  }
}
