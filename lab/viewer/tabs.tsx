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

const TABS = ["lab", "doc", "components"] as const;

type Tab = (typeof TABS)[number];

export type TabElements = {
  buttons: Record<Tab, HTMLButtonElement>;
  tabs: Record<Tab, HTMLElement>;
  bots: HTMLTableSectionElement;
};

export class ViewerTabs {
  #shown: Tab = "lab";

  constructor(
    private readonly ui: TabElements,
    onLeaveLab: () => void,
  ) {
    for (const tab of TABS) {
      ui.buttons[tab].addEventListener("click", () => {
        this.#shown = tab;
        for (const other of TABS) {
          ui.tabs[other].hidden = other !== tab;
          ui.buttons[other].classList.toggle("on", other === tab);
        }
        if (tab !== "lab") onLeaveLab();
      });
    }
  }

  get labShown(): boolean {
    return this.#shown === "lab";
  }

  setBots(bots: BotInfo[]): void {
    this.ui.bots.replaceChildren(...bots.map(botRow));
  }
}
