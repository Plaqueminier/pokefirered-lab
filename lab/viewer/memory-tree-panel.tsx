import { Network, ScrollText } from "lucide-preact";
import { useState } from "preact/hooks";
import { Breadcrumb, Button, Card, Collapsible, LABEL, ListRow, Pill, Tabs, Tooltip } from "./components";
import { type Focus, focusOn, type MemoryPanelView, type SummaryCallRow, type TreeNode } from "./memory-panel";
import { CostPills, NowButton } from "./model-panel";
import { PromptText } from "./prompt-text";
import { dollars, seconds } from "./runs";
import { clock } from "./stats-lanes";

type PickCall = (call: number, frame: number) => void;

type Blocks = { open: Record<string, boolean>; toggle: (title: string) => void };

const ROOT = "What the model sees";

const OPEN_BLOCKS: Record<string, boolean> = { Prompt: true, Answer: true, Rules: false };

function Counts({ view }: { view: MemoryPanelView }) {
  return (
    <span class="min-w-0 truncate text-xs text-faint tabular-nums">
      {view.notes} notes · {view.calls.length} Summary calls{view.selection && " in the selection"} · {dollars(view.cost)}
      {view.failed > 0 && <span class="text-bad"> · {view.failed} failed</span>}
    </span>
  );
}

function NodeTitle({ node }: { node: TreeNode }) {
  return (
    <div class="flex flex-wrap items-center gap-2">
      <span class={LABEL}>
        {node.size === 1 ? "Note" : "Node"} {node.name}
      </span>
      {node.size > 1 && <span class="text-xs text-faint tabular-nums">{node.size} notes</span>}
      {node.top && (
        <Tooltip text="The model sees this node in each prompt">
          <Pill tone="accent">in the prompt</Pill>
        </Tooltip>
      )}
      {node.inSelection && <Pill tone="accent">in the selection</Pill>}
      {node.failed.length > 0 && <Pill tone="bad">{node.failed.length} failed</Pill>}
    </div>
  );
}

function CallPills({ call }: { call: SummaryCallRow }) {
  return (
    <>
      <Tooltip text="Frame of the Summary call">
        <Pill>{clock(call.frame)}</Pill>
      </Tooltip>
      <CostPills cost={call.cost} latencyMs={call.latencyMs} promptTokens={call.promptTokens} completionTokens={call.completionTokens} />
    </>
  );
}

function SummaryCall({ title, call, blocks, pills }: { title: string; call: SummaryCallRow; blocks: Blocks; pills?: boolean }) {
  const texts = [
    { title: "Prompt", text: call.prompt.user },
    { title: "Answer", text: call.answer },
    { title: "Rules", text: call.prompt.system },
  ];
  return (
    <>
      <div class="flex flex-wrap items-center gap-1.5">
        <span class={`${LABEL} mr-1`}>{title}</span>
        {pills && <CallPills call={call} />}
      </div>
      <div class="flex flex-col gap-1">
        {texts.map(({ title, text }) => (
          <Collapsible key={title} title={title} detail={`${text.length} chars`} open={blocks.open[title]} onToggle={() => blocks.toggle(title)}>
            <PromptText text={text} highlight />
          </Collapsible>
        ))}
      </div>
    </>
  );
}

function FailedCalls({ calls, blocks }: { calls: readonly SummaryCallRow[]; blocks: Blocks }) {
  return calls.map((call) => <SummaryCall key={call.id} title="Failed Summary call" call={call} blocks={blocks} pills />);
}

function NodeCard({ node, clamp, focus }: { node: TreeNode; clamp?: boolean; focus: (name: string) => void }) {
  return (
    <Card size="sm" onClick={() => focus(node.name)}>
      <div class="flex flex-col gap-1.5">
        <NodeTitle node={node} />
        <p class={`text-sm leading-relaxed ${clamp ? "line-clamp-4" : ""}`}>{node.text}</p>
        {node.halves.length > 0 && <span class="text-xs text-faint">open: {node.halves.map((half) => half.name).join(" and ")}</span>}
      </div>
    </Card>
  );
}

function FocusedNode({ node, focus, pickCall, blocks }: { node: TreeNode; focus: (name: string) => void; pickCall: PickCall; blocks: Blocks }) {
  const { note, call } = node;
  return (
    <>
      <Card size="sm">
        <div class="flex flex-col gap-2">
          <NodeTitle node={node} />
          <p class="text-sm leading-relaxed">{node.text}</p>
          {note && (
            <div class="flex items-center gap-2 text-xs text-muted">
              Written by Model call {note.call + 1} at {clock(note.frame)}
              <Button size="sm" variant="ghost" onClick={() => pickCall(note.call, note.frame)}>
                Go to the call
              </Button>
            </div>
          )}
          {call && (
            <div class="flex flex-wrap items-center gap-1.5">
              <CallPills call={call} />
            </div>
          )}
        </div>
      </Card>
      {node.halves.length > 0 && (
        <>
          <span class={LABEL}>Its two halves</span>
          <div class="grid grid-cols-2 gap-3">
            {node.halves.map((half) => (
              <NodeCard key={half.name} node={half} clamp focus={focus} />
            ))}
          </div>
        </>
      )}
      {call && <SummaryCall title="The Summary call that made it" call={call} blocks={blocks} />}
      <FailedCalls calls={node.failed} blocks={blocks} />
    </>
  );
}

function Shown({ shown, view, focus, pickCall, blocks }: { shown: Focus; view: MemoryPanelView; focus: (name: string) => void; pickCall: PickCall; blocks: Blocks }) {
  switch (shown.kind) {
    case "node":
      return <FocusedNode node={shown.path[shown.path.length - 1]} focus={focus} pickCall={pickCall} blocks={blocks} />;
    case "unmade":
      return (
        <>
          <p class="text-sm text-muted">No Summary call made {shown.name} yet.</p>
          <FailedCalls calls={shown.failed} blocks={blocks} />
        </>
      );
    case "tops":
      if (view.tops.length === 0) return <p class="text-sm text-muted">no note yet</p>;
      return view.tops.map((top) => <NodeCard key={top.name} node={top} focus={focus} />);
  }
}

export type MemoryTreePanelProps = { view: MemoryPanelView; following: boolean; pickCall: PickCall; now: () => void };

export function MemoryTreePanel({ view, following, pickCall, now }: MemoryTreePanelProps) {
  const [tab, setTab] = useState<"tree" | "calls">("tree");
  const [focused, setFocused] = useState<string | null>(null);
  const [open, setOpen] = useState(OPEN_BLOCKS);
  const blocks = { open, toggle: (title: string) => setOpen({ ...open, [title]: !open[title] }) };
  const shown = focusOn(view, focused);
  const steps = shown.kind === "node" ? shown.path.map((step) => step.name) : shown.kind === "unmade" ? [shown.name] : [];
  const focus = (name: string) => {
    setFocused(name);
    setTab("tree");
  };
  return (
    <div class="flex h-full min-h-0 flex-col gap-3">
      <div class="flex items-center gap-3">
        <Tabs
          value={tab}
          onChange={setTab}
          items={[
            { id: "tree", label: "Tree", icon: <Network size={14} /> },
            { id: "calls", label: `Summary calls ${view.calls.length}`, icon: <ScrollText size={14} /> },
          ]}
        />
        <Counts view={view} />
        <span class="ml-auto shrink-0">
          <NowButton following={following} now={now} />
        </span>
      </div>
      {tab === "tree" ? (
        <>
          <Breadcrumb steps={[ROOT, ...steps]} onPick={(i) => setFocused(i === 0 ? null : steps[i - 1])} />
          <div class="flex min-h-0 flex-1 flex-col gap-3 overflow-auto">
            <Shown shown={shown} view={view} focus={focus} pickCall={pickCall} blocks={blocks} />
          </div>
        </>
      ) : (
        <div class="flex min-h-0 flex-1 flex-col gap-px overflow-auto">
          {view.calls.length > 0 ? (
            view.calls.map((call) => (
              <ListRow
                key={call.id}
                cells={[
                  { text: clock(call.frame), chars: 7 },
                  { text: seconds(call.latencyMs), chars: 6 },
                ]}
                text={
                  <>
                    <span class="whitespace-pre">{call.node}  </span>
                    {call.result}
                  </>
                }
                error={call.failed}
                onClick={() => focus(call.node)}
              />
            ))
          ) : (
            <p class="text-sm text-muted">{view.selection ? "no Summary call in the selection" : "no Summary call yet"}</p>
          )}
        </div>
      )}
    </div>
  );
}
