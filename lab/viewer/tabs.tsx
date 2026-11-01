import { BookOpen, Flag, Grid2x2, LayoutGrid, Shapes } from "lucide-preact";
import { render } from "preact";
import { Tabs } from "./components";
import { DOC_PARAM } from "./doc";

const TABS = [
  { id: "lab", label: "Lab", icon: <LayoutGrid size={15} /> },
  { id: "grid", label: "Grid", icon: <Grid2x2 size={15} /> },
  { id: "race", label: "Race", icon: <Flag size={15} /> },
  { id: "doc", label: "Doc", icon: <BookOpen size={15} /> },
  { id: "components", label: "Components", icon: <Shapes size={15} /> },
] as const;

export type Tab = (typeof TABS)[number]["id"];

function setDocParam(page: string | null): void {
  const url = new URL(location.href);
  if (page === null) url.searchParams.delete(DOC_PARAM);
  else url.searchParams.set(DOC_PARAM, page);
  history.replaceState(null, "", url);
}

function NavBar({ value, onChange }: { value: Tab; onChange: (tab: Tab) => void }) {
  return (
    <div class="flex h-14 items-center gap-6 px-6">
      <span class="text-lg font-bold">FireRed Lab</span>
      <Tabs items={[...TABS]} value={value} onChange={onChange} />
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
    private readonly onShow: (tab: Tab) => void,
  ) {
    this.show(this.#docPage === null ? "lab" : "doc");
  }

  show(tab: Tab): void {
    if (this.#shown === "doc" && tab !== "doc") {
      this.#docPage = new URLSearchParams(location.search).get(DOC_PARAM);
      setDocParam(null);
    }
    if (tab === "doc" && this.#docPage !== null) setDocParam(this.#docPage);
    this.#shown = tab;
    for (const { id } of TABS) this.ui.tabs[id].hidden = id !== tab;
    render(<NavBar value={tab} onChange={(next) => this.show(next)} />, this.ui.nav);
    this.onShow(tab);
  }

  get labShown(): boolean {
    return this.#shown === "lab";
  }
}
