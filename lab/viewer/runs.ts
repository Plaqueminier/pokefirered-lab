import { type ClientMessage, DEFAULT_MODEL, DEFAULT_REASONING, DEFAULT_STARTER, REASONING, type RunSummary, type ShownRun, STARTERS } from "../src/protocol";

const VIEWER_RUN = "";

export function dollars(cost: number): string {
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

// A scripted Bot refuses any model option: a default value goes as no option.
function option(value: string, byDefault: string): string | undefined {
  return value === byDefault ? undefined : value;
}

function selectOptions(select: HTMLSelectElement, values: readonly string[], byDefault: string, label: (value: string) => string): void {
  select.replaceChildren(...values.map((value) => new Option(label(value), value, value === byDefault, value === byDefault)));
  select.addEventListener("change", () => select.blur());
}

export type RunsElements = {
  runs: HTMLSelectElement;
  bots: HTMLSelectElement;
  model: HTMLInputElement;
  costLimit: HTMLInputElement;
  reasoning: HTMLSelectElement;
  starter: HTMLSelectElement;
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
    selectOptions(ui.reasoning, REASONING, DEFAULT_REASONING, (level) => `reasoning ${level}`);
    selectOptions(ui.starter, STARTERS, DEFAULT_STARTER, (starter) => (starter === "free" ? "starter free" : starter));
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
      const model = {
        id: ui.model.value.trim() || undefined,
        costLimit: costLimit ? Number(costLimit) : undefined,
        reasoning: option(ui.reasoning.value, DEFAULT_REASONING),
        starter: option(ui.starter.value, DEFAULT_STARTER),
      };
      send({ type: "start-bot", name: ui.bots.value, model });
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
    this.ui.shownModel.textContent = run?.model ? `Run ${run.id}: model ${run.model.id}, reasoning ${run.model.reasoning}, starter ${run.model.starter}, cost ${dollars(run.model.cost)} of ${dollars(run.model.costLimit)}` : "";
  }
}
