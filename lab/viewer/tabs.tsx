import { BookOpen, LayoutGrid, Shapes } from "lucide-preact";
import { render } from "preact";
import { useState } from "preact/hooks";
import type { BotInfo } from "../src/protocol";
import { Tabs } from "./components";

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

const TABS = [
  { id: "lab", label: "Lab", icon: <LayoutGrid size={15} /> },
  { id: "doc", label: "Doc", icon: <BookOpen size={15} /> },
  { id: "components", label: "Components", icon: <Shapes size={15} /> },
] as const;

type Tab = (typeof TABS)[number]["id"];

function NavBar({ onChange }: { onChange: (tab: Tab) => void }) {
  const [tab, setTab] = useState<Tab>("lab");
  const select = (next: Tab) => {
    setTab(next);
    onChange(next);
  };
  return (
    <div class="flex h-14 items-center gap-6 px-6">
      <span class="text-lg font-bold">FireRed Lab</span>
      <Tabs items={[...TABS]} value={tab} onChange={select} />
    </div>
  );
}

export type TabElements = {
  nav: HTMLElement;
  tabs: Record<Tab, HTMLElement>;
  bots: HTMLTableSectionElement;
};

export class ViewerTabs {
  #shown: Tab = "lab";

  constructor(
    private readonly ui: TabElements,
    private readonly onLeaveLab: () => void,
  ) {
    render(<NavBar onChange={(tab) => this.#show(tab)} />, ui.nav);
  }

  #show(tab: Tab): void {
    this.#shown = tab;
    for (const { id } of TABS) this.ui.tabs[id].hidden = id !== tab;
    if (tab !== "lab") this.onLeaveLab();
  }

  get labShown(): boolean {
    return this.#shown === "lab";
  }

  setBots(bots: BotInfo[]): void {
    this.ui.bots.replaceChildren(...bots.map(botRow));
  }
}
