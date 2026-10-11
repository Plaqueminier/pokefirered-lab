import type { ClientMessage, RunSummary, ShownRun } from "../src/protocol";

const VIEWER_RUN = "";

function runState(run: RunSummary): string {
  if (run.playing) return "joue";
  if (run.error) return `erreur : ${run.error}`;
  return `fin : ${run.endReason}`;
}

function runLabel(run: RunSummary): string {
  return `Run ${run.id} · ${run.bot} · ${runState(run)}`;
}

export type RunsElements = { runs: HTMLSelectElement; bots: HTMLSelectElement; start: HTMLButtonElement };

export class RunsPanel {
  constructor(
    private readonly ui: RunsElements,
    send: (message: ClientMessage) => void,
  ) {
    ui.runs.addEventListener("change", () => {
      send({ type: "show", runId: ui.runs.value === VIEWER_RUN ? null : Number(ui.runs.value) });
      ui.runs.blur();
    });
    ui.bots.addEventListener("change", () => ui.bots.blur());
    ui.start.addEventListener("click", () => {
      if (ui.bots.value) send({ type: "start-bot", name: ui.bots.value });
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
  }
}
