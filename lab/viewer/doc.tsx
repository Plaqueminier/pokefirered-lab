// Issue #61. The Doc tells what the lab can do; lab/README.md gives only the setup and the commands.
import { Bike, Bot, Brain, CircleStop, Construction, Dna, FileClock, Flag, Gamepad2, Ghost, Grid2x2, Lightbulb, ListTree, MessageSquareText, Monitor, Plug, Swords, Workflow } from "lucide-preact";
import { type ComponentChildren, type ComponentType, render } from "preact";
import { useRef, useState } from "preact/hooks";
import type { BotInfo } from "../src/protocol";
import { Button, LABEL } from "./components";
import type { Readable } from "./cursor";
import { GenomePage } from "./doc-genetic";
import { EndPage, MacroPage, MilestonesPage, NotYetPage, RecordPage, SpeedPage } from "./doc-harness";
import { BotsContext, BotsPage, DoubleBattlePage, MemoryPage, ProgressPage, PromptPage, ProvidersPage } from "./doc-model";
import { GridPage, LoopPage, PrinciplePage, RacePage, ViewerPage } from "./doc-overview";

/** `title` is in the side list; `heading`, when the title of the page is longer. */
type DocPage = { id: string; title: string; heading?: string; icon: ComponentType<{ size?: number; class?: string }>; render: () => ComponentChildren };

const GROUPS: { title: string; pages: DocPage[] }[] = [
  {
    title: "Overview",
    pages: [
      { id: "loop", title: "The loop", icon: Workflow, render: () => <LoopPage /> },
      { id: "principle", title: "Principle", icon: Lightbulb, render: () => <PrinciplePage /> },
      { id: "viewer", title: "The Viewer", icon: Monitor, render: () => <ViewerPage /> },
      { id: "grid", title: "The Grid", icon: Grid2x2, render: () => <GridPage /> },
      { id: "race", title: "The Race", icon: Ghost, render: () => <RacePage /> },
    ],
  },
  {
    title: "Harness",
    pages: [
      { id: "actions", title: "Macro-actions", icon: Gamepad2, render: () => <MacroPage /> },
      { id: "speed", title: "Running and the BICYCLE", icon: Bike, render: () => <SpeedPage /> },
      { id: "milestones", title: "Milestones", icon: Flag, render: () => <MilestonesPage /> },
      { id: "end", title: "End of a Run", icon: CircleStop, render: () => <EndPage /> },
      { id: "record", title: "Run record", heading: "Run record and parallel Runs", icon: FileClock, render: () => <RecordPage /> },
      { id: "notyet", title: "Not yet", icon: Construction, render: () => <NotYetPage /> },
    ],
  },
  {
    title: "Model bot",
    pages: [
      { id: "bots", title: "Bots", icon: Bot, render: () => <BotsPage /> },
      { id: "providers", title: "Model providers", icon: Plug, render: () => <ProvidersPage /> },
      { id: "prompt", title: "Prompt and actions", icon: MessageSquareText, render: () => <PromptPage /> },
      { id: "double", title: "Double battle", icon: Swords, render: () => <DoubleBattlePage /> },
      { id: "progress", title: "Stuck, reflection, review", heading: "Stuck, reflection and review", icon: Brain, render: () => <ProgressPage /> },
      { id: "memory", title: "Memory tree", icon: ListTree, render: () => <MemoryPage /> },
    ],
  },
  {
    title: "Genetic bot",
    pages: [{ id: "genome", title: "Genome and criteria", icon: Dna, render: () => <GenomePage /> }],
  },
];

const PAGES = GROUPS.flatMap((group) => group.pages);
/** The page of the Doc in the URL. A reload with it opens the Doc tab (tabs.tsx). */
export const DOC_PARAM = "doc";

function pageInUrl(): DocPage {
  const id = new URLSearchParams(location.search).get(DOC_PARAM);
  return PAGES.find((page) => page.id === id) ?? PAGES[0];
}

function DocTab() {
  const [shown, setShown] = useState(pageInUrl);
  const focusPage = useRef(false);
  const pick = (page: DocPage) => {
    focusPage.current = true;
    const url = new URL(location.href);
    url.searchParams.set(DOC_PARAM, page.id);
    history.replaceState(null, "", url);
    setShown(page);
    scrollTo({ top: 0 });
  };
  return (
    <div class="ds flex flex-col min-[900px]:h-full min-[900px]:flex-row">
      <nav
        aria-label="Pages of the Doc"
        ref={(nav) => nav?.querySelector("[aria-pressed=true]")?.scrollIntoView({ block: "nearest", inline: "nearest" })}
        class="flex shrink-0 gap-5 overflow-x-auto border-b border-line px-4 py-3 min-[900px]:w-60 min-[900px]:flex-col min-[900px]:overflow-x-hidden min-[900px]:overflow-y-auto min-[900px]:border-r min-[900px]:border-b-0 min-[900px]:p-4"
      >
        <div class="hidden flex-col gap-1 px-2 min-[900px]:flex">
          <span class="text-lg font-bold">What the lab can do</span>
          <span class="text-xs text-muted">Commands: lab/README.md</span>
        </div>
        {GROUPS.map((group) => (
          <div key={group.title} class="flex shrink-0 flex-col gap-1">
            <span class={`${LABEL} px-2 pb-1`}>{group.title}</span>
            <div class="flex gap-1 min-[900px]:flex-col">
              {group.pages.map((page) => (
                <Button key={page.id} variant="ghost" pressed={page === shown} onClick={() => pick(page)}>
                  <page.icon size={16} />
                  <span class="truncate">{page.title}</span>
                </Button>
              ))}
            </div>
          </div>
        ))}
      </nav>
      {/* The focus goes to the new page, so that the arrow keys scroll it. */}
      <div
        key={shown.id}
        tabIndex={-1}
        ref={(page) => {
          if (!page || !focusPage.current) return;
          focusPage.current = false;
          page.focus({ preventScroll: true });
        }}
        class="@container min-w-0 flex-1 p-4 outline-none min-[900px]:overflow-y-auto min-[900px]:p-8"
      >
        <div class="mx-auto flex max-w-[1100px] flex-col gap-2">
          <h2 class="m-0 flex items-center gap-2.5 text-xl font-semibold tracking-tight min-[900px]:text-2xl">
            <shown.icon size={24} class="shrink-0 text-accent" /> {shown.heading ?? shown.title}
          </h2>
          {shown.render()}
        </div>
      </div>
    </div>
  );
}

export function mountDocTab(root: HTMLElement, bots: Readable<BotInfo[] | null>): void {
  render(
    <BotsContext.Provider value={bots}>
      <DocTab />
    </BotsContext.Provider>,
    root,
  );
}
