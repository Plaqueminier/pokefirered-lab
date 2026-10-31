import { BookOpen, LayoutGrid, Shapes } from "lucide-preact";
import { render } from "preact";
import { useState } from "preact/hooks";
import { Tabs } from "./components";
import { DOC_PARAM } from "./doc";

const TABS = [
  { id: "lab", label: "Lab", icon: <LayoutGrid size={15} /> },
  { id: "doc", label: "Doc", icon: <BookOpen size={15} /> },
  { id: "components", label: "Components", icon: <Shapes size={15} /> },
] as const;

type Tab = (typeof TABS)[number]["id"];

function setDocParam(page: string | null): void {
  const url = new URL(location.href);
  if (page === null) url.searchParams.delete(DOC_PARAM);
  else url.searchParams.set(DOC_PARAM, page);
  history.replaceState(null, "", url);
}

function NavBar({ initial, onChange }: { initial: Tab; onChange: (tab: Tab) => void }) {
  const [tab, setTab] = useState(initial);
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
};

export class ViewerTabs {
  #shown: Tab = "lab";
  #docPage: string | null = new URLSearchParams(location.search).get(DOC_PARAM);

  constructor(
    private readonly ui: TabElements,
    private readonly onLeaveLab: () => void,
  ) {
    const initial: Tab = this.#docPage === null ? "lab" : "doc";
    render(<NavBar initial={initial} onChange={(tab) => this.#show(tab)} />, ui.nav);
    this.#show(initial);
  }

  #show(tab: Tab): void {
    if (this.#shown === "doc" && tab !== "doc") {
      this.#docPage = new URLSearchParams(location.search).get(DOC_PARAM);
      setDocParam(null);
    }
    if (tab === "doc" && this.#docPage !== null) setDocParam(this.#docPage);
    this.#shown = tab;
    for (const { id } of TABS) this.ui.tabs[id].hidden = id !== tab;
    if (tab !== "lab") this.onLeaveLab();
  }

  get labShown(): boolean {
    return this.#shown === "lab";
  }
}
