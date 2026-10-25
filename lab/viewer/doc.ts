import type { BotInfo } from "../src/protocol";

function botRow(bot: BotInfo): HTMLTableRowElement {
  const row = document.createElement("tr");
  row.insertCell().textContent = bot.name;
  if ("kind" in bot) {
    for (const text of [bot.kind, bot.version, bot.goal ?? "none"]) row.insertCell().textContent = text;
  } else {
    const cell = row.insertCell();
    cell.colSpan = 3;
    cell.textContent = `does not load: ${bot.error}`;
  }
  return row;
}

export type DocElements = {
  labButton: HTMLButtonElement;
  docButton: HTMLButtonElement;
  lab: HTMLElement;
  doc: HTMLElement;
  bots: HTMLTableSectionElement;
  modelPlanned: HTMLElement;
};

export class DocTab {
  constructor(
    private readonly ui: DocElements,
    onOpen: () => void,
  ) {
    const select = (open: boolean) => {
      ui.lab.hidden = open;
      ui.doc.hidden = !open;
      ui.labButton.classList.toggle("on", !open);
      ui.docButton.classList.toggle("on", open);
      if (open) onOpen();
    };
    ui.labButton.addEventListener("click", () => select(false));
    ui.docButton.addEventListener("click", () => select(true));
  }

  get open(): boolean {
    return !this.ui.doc.hidden;
  }

  setBots(bots: BotInfo[]): void {
    this.ui.bots.replaceChildren(...bots.map(botRow));
    this.ui.modelPlanned.hidden = !bots.every((bot) => "kind" in bot && bot.kind === "scripted");
  }
}
