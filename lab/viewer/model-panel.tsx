import {
  Ban,
  Bell,
  BookOpen,
  Brain,
  CircleHelp,
  ClipboardCheck,
  Compass,
  Eye,
  FileQuestion,
  FileText,
  Flag as FlagIcon,
  Flame,
  Gamepad2,
  Globe,
  Heart,
  History,
  Layers,
  ListTree,
  Map as MapIcon,
  MessageSquare,
  Repeat,
  RotateCcw,
  ShoppingCart,
  Swords,
  Target,
  TriangleAlert,
  Trophy,
  Users,
  ZoomIn,
} from "lucide-preact";
import type { ComponentType } from "preact";
import { useLayoutEffect, useMemo, useRef, useState } from "preact/hooks";
import type { ActionEvent, ModelEvent } from "../src/harness/record";
import { actionText } from "../src/protocol";
import { Button, Card, Collapsible, FilterChip, LABEL, ListRow, Pill, type Tone, Tooltip, toggled, toneText } from "./components";
import { type BlockTitle, FLAGS, type Flag, promptBlocks, reviewText, type UnusualCall } from "./model-calls";
import { PromptText } from "./prompt-text";
import { milliDollars, seconds, tokens } from "./runs";
import { clock, stuckTone } from "./stats-lanes";

type Icon = ComponentType<{ size?: number }>;

export const FLAG_LOOKS: Record<Flag, { label: string; icon: Icon; tone: Tone }> = {
  unreadable: { label: "Unreadable", icon: FileQuestion, tone: "bad" },
  impossible: { label: "Impossible", icon: Ban, tone: "bad" },
  reflection: { label: "Reflection", icon: Brain, tone: "warn" },
  review: { label: "Review", icon: ClipboardCheck, tone: "accent" },
  expensive: { label: "Expensive", icon: Flame, tone: "warn" },
  turns: { label: "More turns", icon: Layers, tone: "info" },
  mission: { label: "New Mission", icon: FlagIcon, tone: "ok" },
  repeat: { label: "Repeated", icon: Repeat, tone: "warn" },
};

const STATUS_TONES: Record<ActionEvent["result"]["status"], Tone> = { done: "ok", impossible: "bad", blocked: "warn", interrupted: "info" };

const OPEN_BLOCKS: ReadonlySet<BlockTitle> = new Set<BlockTitle>(["Situation", "Battle", "Actions", "Events", "Error", "Your answer", "Question"]);

const BLOCK_ICONS: Record<BlockTitle, Icon> = {
  Progress: Trophy,
  "Memory tree": ListTree,
  Situation: Eye,
  History,
  Events: Bell,
  Party: Heart,
  "Known world": Globe,
  "Local view": MapIcon,
  People: Users,
  Atlas: Compass,
  Targets: Target,
  "Full Atlas": MapIcon,
  Zoom: ZoomIn,
  Battle: Swords,
  "Poké Mart": ShoppingCart,
  Question: CircleHelp,
  Actions: Gamepad2,
  Error: TriangleAlert,
  Request: RotateCcw,
  Impossible: Ban,
  "Your answer": MessageSquare,
  Rules: BookOpen,
  Other: FileText,
};

function FlagIcons({ row }: { row: UnusualCall }) {
  return (
    <>
      {row.flags.map(({ flag, why }) => {
        const { label, icon: Icon, tone } = FLAG_LOOKS[flag];
        return (
          <Tooltip key={flag} text={`${label}: ${why}`}>
            <span class={`flex ${toneText(tone)}`}>
              <Icon size={13} />
            </span>
          </Tooltip>
        );
      })}
    </>
  );
}

function FilterChips({ rows, on, toggle, clear }: { rows: readonly UnusualCall[]; on: ReadonlySet<Flag>; toggle: (flag: Flag) => void; clear: () => void }) {
  const counts = useMemo(() => {
    const counted = new Map<Flag, number>();
    for (const row of rows) for (const { flag } of row.flags) counted.set(flag, (counted.get(flag) ?? 0) + 1);
    return counted;
  }, [rows]);
  return (
    <div class="flex flex-wrap items-center gap-1.5">
      {FLAGS.map((flag) => {
        const { label, icon: Icon, tone } = FLAG_LOOKS[flag];
        return <FilterChip key={flag} icon={<Icon size={13} />} tone={tone} label={label} hideLabel count={counts.get(flag) ?? 0} on={on.has(flag)} onToggle={() => toggle(flag)} />;
      })}
      {on.size > 0 && (
        <Button size="sm" variant="ghost" onClick={clear}>
          All calls
        </Button>
      )}
    </div>
  );
}

function Played({ row }: { row: UnusualCall }) {
  if (row.played.length === 0) return <p class="text-xs text-faint">no action played</p>;
  return (
    <div class="flex flex-col gap-1">
      {row.played.map((entry, i) => {
        const { result } = entry;
        const texts = "text" in result ? result.text.join(" / ") : "";
        return (
          <div key={i} class="flex min-w-0 items-center gap-1.5 text-xs">
            <Pill tone={STATUS_TONES[result.status]}>
              {result.status}
              {"reason" in result && `: ${result.reason}`}
            </Pill>
            <span class="shrink-0 font-mono text-faint">{actionText(entry.action)}</span>
            {texts && <span class="min-w-0 truncate text-muted">{texts}</span>}
          </div>
        );
      })}
    </div>
  );
}

function UsagePills({ call }: { call: ModelEvent }) {
  const { promptTokens, completionTokens, cost } = call.usage;
  return (
    <div class="flex flex-wrap items-center gap-1.5">
      <Tooltip text="Situation">
        <Pill>{call.situation}</Pill>
      </Tooltip>
      {call.stuck !== undefined && (
        <Tooltip text="Stuck counter">
          <Pill tone={stuckTone(call.stuck)}>Stuck {call.stuck}</Pill>
        </Tooltip>
      )}
      <CostPills cost={cost} latencyMs={call.latencyMs} promptTokens={promptTokens} completionTokens={completionTokens} />
    </div>
  );
}

export function CostPills({ cost, latencyMs, promptTokens, completionTokens }: { cost: number; latencyMs: number; promptTokens: number; completionTokens: number }) {
  return (
    <>
      <Tooltip text="Cost of the call">
        <Pill>{milliDollars(cost)}</Pill>
      </Tooltip>
      <Tooltip text="Latency">
        <Pill>{seconds(latencyMs)}</Pill>
      </Tooltip>
      <Tooltip text="Prompt tokens / completion tokens">
        <Pill>
          {tokens(promptTokens)} / {tokens(completionTokens)} tok
        </Pill>
      </Tooltip>
    </>
  );
}

export function NowButton({ following, now }: { following: boolean; now: () => void }) {
  return (
    <Tooltip text={following ? "The panel follows the last call" : "Back to now (Esc)"}>
      <Button size="sm" pressed={following} onClick={now}>
        Now
      </Button>
    </Tooltip>
  );
}

function Goals({ row }: { row: UnusualCall }) {
  const { decision } = row.call;
  if (!decision) return null;
  const goals = [
    { term: "Mission", text: decision.mission, changed: row.missionChanged },
    { term: "Objective", text: decision.objective, changed: row.objectiveChanged },
    { term: "Note", text: decision.note, changed: false },
  ].filter((goal) => goal.term !== "Note" || goal.text);
  return (
    <dl class="grid grid-cols-[max-content_1fr] gap-x-3 gap-y-1 text-sm">
      {goals.map(({ term, text, changed }) => (
        <div key={term} class="contents">
          <dt class="text-muted">{term}</dt>
          <dd class={changed ? "text-accent" : ""}>
            {text || "–"}
            {changed && (
              <span class="ml-1.5 align-middle">
                <Pill tone="accent">changed</Pill>
              </span>
            )}
          </dd>
        </div>
      ))}
    </dl>
  );
}

export function CallSummary({ row, count, thinking }: { row: UnusualCall; count: number; thinking?: boolean }) {
  const { call } = row;
  const review = call.review ? reviewText(call) : null;
  return (
    <div class="flex flex-col gap-2">
      <div class="flex items-center gap-2">
        <span class={LABEL}>
          Call {row.index + 1} / {count} · {clock(call.frame)}
        </span>
        <span class="flex items-center gap-1">
          <FlagIcons row={row} />
        </span>
        {thinking && (
          <span class="ml-auto">
            <Pill tone="info">the model thinks…</Pill>
          </span>
        )}
      </div>
      {call.decision ? (
        <>
          <p class="font-mono text-lg text-accent">→ {call.decision.action}</p>
          <p class="text-sm leading-relaxed">{call.decision.reason}</p>
        </>
      ) : (
        <>
          <p class="text-sm text-bad">Unreadable answer: {call.error}</p>
          <p class="font-mono text-xs whitespace-pre-wrap text-muted">{call.answer ?? "(no answer: the request failed)"}</p>
        </>
      )}
      <Goals row={row} />
      <Played row={row} />
      <UsagePills call={call} />
      {review && <p class="border-t border-line pt-2 text-xs whitespace-pre-line text-muted">{review}</p>}
    </div>
  );
}

function PromptBlocks({ call }: { call: ModelEvent }) {
  const [open, setOpen] = useState<Record<string, boolean>>({});
  return (
    <div class="flex flex-col gap-1">
      {promptBlocks(call).map((block) => {
        const Icon = BLOCK_ICONS[block.title];
        const shown = open[block.id] ?? OPEN_BLOCKS.has(block.title);
        const lines = block.text.split("\n").length;
        return (
          <Collapsible
            key={block.id}
            title={block.id}
            icon={<Icon size={13} />}
            detail={`${lines} line${lines > 1 ? "s" : ""}`}
            open={shown}
            onToggle={() => setOpen({ ...open, [block.id]: !shown })}
          >
            <PromptText text={block.text} highlight />
          </Collapsible>
        );
      })}
    </div>
  );
}

// Not scrollIntoView: it also scrolls the page. A hidden panel has no layout: the observer places the list when it shows.
function useKeepInView(list: { current: HTMLElement | null }, following: boolean, key: string) {
  useLayoutEffect(() => {
    const box = list.current;
    if (!box) return;
    const place = () => {
      if (following) return void (box.scrollTop = box.scrollHeight);
      const row = box.querySelector<HTMLElement>('[aria-pressed="true"]');
      if (!row) return;
      const top = row.getBoundingClientRect().top - box.getBoundingClientRect().top;
      if (top < 0 || top + row.offsetHeight > box.clientHeight) box.scrollTop += top - (box.clientHeight - row.offsetHeight) / 2;
    };
    place();
    const observer = new ResizeObserver(place);
    observer.observe(box);
    return () => observer.disconnect();
  }, [list, following, key]);
}

export type ModelPanelProps = {
  rows: readonly UnusualCall[];
  index: number | null;
  following: boolean;
  thinking: boolean;
  pick: (index: number, frame: number) => void;
  now: () => void;
};

export function ModelPanel({ rows, index, following, thinking, pick, now }: ModelPanelProps) {
  const [on, setOn] = useState<ReadonlySet<Flag>>(new Set());
  const shown = useMemo(() => (on.size === 0 ? rows : rows.filter((row) => row.flags.some(({ flag }) => on.has(flag)))), [rows, on]);
  const list = useRef<HTMLDivElement>(null);
  useKeepInView(list, following, `${index} ${[...on].join()} ${shown.length}`);
  const row = index === null ? null : rows[index];
  return (
    <div class="grid h-full min-h-0 grid-cols-[minmax(300px,2fr)_3fr] gap-4">
      <div class="flex min-h-0 flex-col gap-2">
        <div class="flex items-center gap-2">
          <span class={LABEL}>Model calls</span>
          <span class="text-xs text-faint tabular-nums">
            {shown.length} / {rows.length}
          </span>
          <span class="ml-auto">
            <NowButton following={following} now={now} />
          </span>
        </div>
        <FilterChips rows={rows} on={on} toggle={(flag) => setOn(toggled(on, flag))} clear={() => setOn(new Set())} />
        <div ref={list} class="flex min-h-0 flex-1 flex-col gap-px overflow-auto">
          {shown.map((r) => (
            <ListRow
              key={r.index}
              cells={[
                { text: String(r.index + 1), chars: 4 },
                { text: clock(r.call.frame), chars: 7 },
              ]}
              text={r.call.decision?.action ?? "unreadable"}
              error={!r.call.decision}
              icons={r.flags.length > 0 && <FlagIcons row={r} />}
              selected={r.index === index}
              onClick={() => pick(r.index, r.call.frame)}
            />
          ))}
        </div>
      </div>
      <div class="flex min-h-0 flex-col gap-3 overflow-auto">
        {row ? (
          <>
            <Card size="sm">
              <CallSummary row={row} count={rows.length} thinking={thinking} />
            </Card>
            <PromptBlocks call={row.call} />
          </>
        ) : (
          <p class="text-sm text-muted">no Model call yet</p>
        )}
      </div>
    </div>
  );
}
