import { type ClientMessage, DEFAULT_MODEL, type RunSummary, type ShownRun } from "../src/protocol";

const VIEWER_RUN = "";

function dollars(cost: number): string {
  return `${cost.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 4 })} $`;
}

function runState(run: RunSummary): string {
  if (run.playing) return run.stopAsked ? "s'arrête…" : "joue";
  if (run.error) return `erreur : ${run.error}`;
  return `fin : ${run.endReason}`;
}

function runLabel(run: RunSummary): string {
  return `Run ${run.id} · ${run.bot} · ${runState(run)}`;
}

export type RunsElements = {
  runs: HTMLSelectElement;
  bots: HTMLSelectElement;
  model: HTMLInputElement;
  costLimit: HTMLInputElement;
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
      send({ type: "start-bot", name: ui.bots.value, model: { id: ui.model.value.trim() || undefined, costLimit: costLimit ? Number(costLimit) : undefined } });
    });
  }

  setBots(names: string[]): void {
    this.ui.bots.replaceChildren(...names.map((name) => new Option(name, name)));
    this.ui.start.disabled = names.length === 0;
  }

  onStatus(runs: RunSummary[], shown: ShownRun): void {
    const labels = ["Run du Viewer (clavier ou replay)", ...runs.map(runLabel)];
    const values = [VIEWER_RUN, ...runs.map((run) => String(run.id))];
    const { options } = this.ui.runs;
    if (options.length !== labels.length || labels.some((label, i) => options[i].text !== label)) {
      this.ui.runs.replaceChildren(...labels.map((label, i) => new Option(label, values[i])));
    }
    this.ui.runs.value = shown.kind === "viewer" ? VIEWER_RUN : String(shown.run.id);
    const run = shown.kind === "bot" ? shown.run : null;
    this.#shownRun = run?.id ?? null;
    this.ui.stop.disabled = !run?.playing || run.stopAsked;
    this.ui.shownModel.textContent = run?.model ? `Run ${run.id} : modèle ${run.model.id}, coût ${dollars(run.model.cost)} sur ${dollars(run.model.costLimit)}` : "";
  }
}
