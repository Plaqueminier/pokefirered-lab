// The layout is the verdict of the prototype in issue #60.
import { CircleDot, Clock, Coins, Frown, Heart, ShoppingBag, Skull, Swords, TriangleAlert } from "lucide-preact";
import type { ComponentChildren, ComponentType } from "preact";
import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import type { Areas } from "../src/game";
import type { Continuation, RunEvent } from "../src/harness/record";
import { GBA_FPS, SPEND_WORDS, type Spend, spendText, tokens } from "../src/protocol";
import { Bar, Button, Card, Collapsible, LABEL, ListRow, Pill, StatTile, type Tone, Tooltip, toneText } from "./components";
import type { Moment, Span } from "./cursor";
import type { UnusualCall } from "./model-calls";
import { money, signedMoney, spendShort } from "./runs";
import { AreaRow, ChapterSteps, Chart, type Graph, type Picks, TimeAxis } from "./stats-charts";
import {
  spentAt,
  graphWindow,
  hasModel,
  isInside,
  promptAt,
  type Scope,
  type Selected,
  scopeOf,
  scopeSpans,
  scopeText,
  selected,
  statsView,
  type StatsView,
  stuckAt,
  upTo,
  windowText,
} from "./stats-data";
import { type EventLine, type GameCounts, eventLines, gameCounts, type SinceHeal, sinceHeal } from "./stats-events";
import { clock, stuckTone } from "./stats-format";
import { KindIcon } from "./timeline";
import { NO_GAME_EVENTS, type TimelineKind } from "./timeline-events";

// `gameEvents`: in a replay, the Game events of the whole record; null for a record from before the Game events.
export type StatsPanelProps = {
  events: readonly RunEvent[];
  gameEvents: readonly RunEvent[] | null;
  areas: Areas;
  rows: readonly UnusualCall[];
  playing: number;
  moment: Moment;
  limit: Spend | null;
  continued: Continuation | null;
  kinds: ReadonlySet<TimelineKind>;
  picks: Picks;
  jump: (frame: number) => void;
};

const LATEST = 3;
const MAX_ROWS = 400;
const LAST_HOURS = 2;
const LAST_FRAMES = LAST_HOURS * 60 * 60 * GBA_FPS;

type TileLook = { key: keyof GameCounts | "unusual"; label: string; icon: ComponentType<{ size?: number }>; tone?: Tone; money?: true };

const TILES: TileLook[] = [
  { key: "heals", label: "Heals", icon: Heart, tone: "ok" },
  { key: "purchases", label: "Purchases", icon: ShoppingBag },
  { key: "spent", label: "Money spent", icon: Coins, tone: "warn", money: true },
  { key: "catches", label: "Catches", icon: CircleDot, tone: "info" },
  { key: "faints", label: "Faints", icon: Skull, tone: "bad" },
  { key: "trainers", label: "Trainers beaten", icon: Swords, tone: "accent" },
  { key: "whiteouts", label: "Whiteouts", icon: Frown, tone: "bad" },
  { key: "unusual", label: "Unusual calls", icon: TriangleAlert, tone: "warn" },
];

type Counts = GameCounts & { unusual: number };

const tileValue = (counts: Counts, look: TileLook) => (look.money ? money(counts[look.key]) : String(counts[look.key]));

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;

// The window stays while the cursor moves inside it, so a click in a chart does not move the chart.
function useLastHours(at: number, cursor: number | null) {
  const [on, setOn] = useState(false);
  const shownEnd = useRef<number | null>(null);
  const kept = shownEnd.current;
  const end = cursor !== null && kept !== null && cursor >= kept - LAST_FRAMES && cursor <= kept ? kept : at;
  const can = end >= LAST_FRAMES;
  // Off when it cannot show 2 h, so it does not start again by itself later.
  useEffect(() => {
    if (!can) setOn(false);
  }, [can]);
  const extent = on && can ? { from: end - LAST_FRAMES, to: end } : null;
  shownEnd.current = extent && end;
  return { on: on && can, can, extent, toggle: () => setOn(!on) };
}

function Section({ title, detail, action, children }: { title: string; detail?: string; action?: ComponentChildren; children: ComponentChildren }) {
  return (
    <section class="flex flex-col gap-2">
      <div class="flex min-h-7 min-w-0 items-center gap-2">
        <h3 class={`${LABEL} shrink-0`}>{title}</h3>
        {detail && <span class="min-w-0 truncate text-xs text-muted tabular-nums">{detail}</span>}
        {action && <span class="ml-auto flex shrink-0 items-center gap-1">{action}</span>}
      </div>
      {children}
    </section>
  );
}

function SinceCard({ since, at }: { since: SinceHeal | null; at: number }) {
  if (!since) {
    return (
      <Card size="sm">
        <p class="text-sm text-muted">No heal before the cursor.</p>
      </Card>
    );
  }
  const { change } = since;
  return (
    <Card size="sm">
      <h3 class={`${LABEL} mb-2 truncate`}>
        Since the last heal · {clock(since.frame)} · {since.how}
      </h3>
      <div class="grid grid-cols-4 gap-3">
        <StatTile size="sm" label="Time" value={clock(at - since.frame)} icon={Clock} />
        <StatTile size="sm" label="Faints" value={since.faints} icon={Skull} tone="bad" />
        <StatTile size="sm" label="Trainers" value={since.trainers} icon={Swords} tone="accent" />
        <StatTile
          size="sm"
          label="₽ now"
          value={since.money?.toLocaleString("en-US") ?? "–"}
          icon={Coins}
          tone="warn"
          detail={change ? <span class={change > 0 ? "text-ok" : "text-bad"}>{signedMoney(change)}</span> : undefined}
        />
      </div>
    </Card>
  );
}

function LatestEvents({ lines, jump }: { lines: readonly EventLine[]; jump: (frame: number) => void }) {
  return (
    <Card size="sm">
      <h3 class={`${LABEL} mb-2`}>Latest events</h3>
      {lines.length === 0 && <p class="text-sm text-muted">Nothing yet.</p>}
      <div class="flex flex-col gap-px">
        {lines.map((line, i) => (
          <ListRow
            key={`${line.frame}-${line.kind}-${i}`}
            cells={[{ text: clock(line.frame), chars: 7 }]}
            onClick={() => jump(line.frame)}
            text={
              <span class="flex min-w-0 items-center gap-1.5">
                <KindIcon kind={line.kind} size={13} />
                <span class={`max-w-full shrink-0 truncate ${line.tone ? toneText(line.tone) : ""}`}>{line.text}</span>
                {line.detail && <span class="min-w-0 truncate text-muted">· {line.detail}</span>}
              </span>
            }
          />
        ))}
      </div>
    </Card>
  );
}

function ActionsChosen({ part }: { part: Selected }) {
  const max = Math.max(1, ...part.actions.map((a) => a.count));
  return (
    <div class="flex flex-col gap-1">
      <h3 class={`${LABEL} mb-1`}>Actions chosen</h3>
      {part.actions.map(({ name, count }) => (
        <div key={name} class={`grid grid-cols-[96px_1fr_36px] items-center gap-2 text-xs ${count === 0 ? "text-faint" : ""}`}>
          <span class="truncate">{name}</span>
          <Bar value={count} max={max} />
          <span class="text-right tabular-nums">{count}</span>
        </div>
      ))}
    </div>
  );
}

function Problems({ part }: { part: Selected }) {
  const group = (title: string, counts: Selected["impossible"]) => (
    <div class="flex flex-col gap-1">
      <h3 class={LABEL}>{title}</h3>
      {counts.length === 0 && <span class="text-xs text-faint">–</span>}
      {counts.map(({ name, count }) => (
        <div key={name} class="flex gap-2 text-xs">
          <span class="w-8 shrink-0 text-right text-muted tabular-nums">{count}×</span>
          <span class="min-w-0 break-words font-mono">{name}</span>
        </div>
      ))}
    </div>
  );
  return (
    <div class="flex flex-col gap-3">
      {group("Impossible actions", part.impossible)}
      {group("Unreadable answers", part.unreadable)}
    </div>
  );
}

function CallsList({ part, picked, picks }: { part: Selected; picked: number | null; picks: Picks }) {
  const shownCalls = new Set(part.calls.map((c) => c.index));
  const alone = part.played.filter((p) => p.call === null || !shownCalls.has(p.call));
  const items = [...alone, ...part.calls.flatMap((call) => [call, ...part.played.filter((p) => p.call === call.index)])];
  return (
    <div class="flex flex-col gap-px">
      <h3 class={`${LABEL} mb-1`}>Model calls and their actions</h3>
      {items.length === 0 && <p class="text-sm text-muted">–</p>}
      {items.slice(0, MAX_ROWS).map((item) =>
        "answer" in item ? (
          <ListRow
            key={`call-${item.index}`}
            cells={[{ text: clock(item.frame), chars: 7 }]}
            text={`${item.answer.kind === "action" ? item.answer.text : item.answer.error} · ${item.situation}`}
            error={item.answer.kind === "unreadable"}
            selected={picked === item.index}
            onClick={() => picks.pickCall(item.index, item.frame)}
            icons={
              <>
                {item.reflection && <Pill tone="warn">reflection</Pill>}
                {item.stuck !== null && <Pill tone={stuckTone(item.stuck)}>{item.stuck}</Pill>}
              </>
            }
          />
        ) : (
          <ListRow
            key={`played-${item.frame}-${item.text}`}
            cells={[{ text: clock(item.frame), chars: 7 }]}
            text={`↳ ${item.status}: ${item.text}${item.reason ? ` · ${item.reason}` : ""}`}
            error={item.status === "impossible"}
            onClick={() => picks.pickFrame(item.frame)}
          />
        ),
      )}
      {items.length > MAX_ROWS && <p class="px-2 text-xs text-faint">+ {items.length - MAX_ROWS} more rows: select a smaller range</p>}
    </div>
  );
}

function ModelCalls({ part, picked, picks }: { part: Selected; picked: number | null; picks: Picks }) {
  const [open, setOpen] = useState(false);
  const unreadable = part.unreadable.reduce((sum, c) => sum + c.count, 0);
  const detail = [
    plural(part.calls.length, "call"),
    plural(part.played.length, "played action"),
    `${unreadable} unreadable`,
    plural(part.summaries.length, "Summary call"),
    plural(part.notes, "note"),
    plural(part.reflections, "Reflection turn"),
  ].join(" · ");
  return (
    <Collapsible title="Model calls of the selection" detail={detail} open={open} onToggle={() => setOpen(!open)}>
      <div class="grid grid-cols-1 gap-3 min-[1280px]:grid-cols-3">
        <Card size="sm">
          <ActionsChosen part={part} />
        </Card>
        <Card size="sm">
          <Problems part={part} />
        </Card>
        <Card size="sm">
          <div class="max-h-[320px] overflow-auto">
            <CallsList part={part} picked={picked} picks={picks} />
          </div>
        </Card>
      </div>
    </Collapsible>
  );
}

function AtCursor({ view, at, limit, model }: { view: StatsView; at: number; limit: Spend | null; model: boolean }) {
  const stuck = stuckAt(view, at);
  const prompt = promptAt(view, at);
  return (
    <div class="grid grid-cols-2 gap-2 min-[1280px]:grid-cols-4">
      <StatTile size="lg" label="Time" value={clock(at)} />
      {model && (
        <>
          <StatTile size="lg" label={SPEND_WORDS[view.unit].name} value={spendShort({ unit: view.unit, amount: Math.max(0, spentAt(view, at) - (view.parentEnd?.spent ?? 0)) })} detail={limit === null ? undefined : `limit ${spendText(limit)}`} />
          <StatTile size="lg" label="Stuck counter" value={stuck ?? "–"} tone={stuck === null ? undefined : stuckTone(stuck)} />
          <StatTile size="lg" label="Prompt tokens" value={prompt === null ? "–" : tokens(prompt)} />
        </>
      )}
    </div>
  );
}

// `now` moves in steps of 60 frames (about one second), so the panel makes the view of the Run again once a second, not at each status.
const NOW_STEP = 60;

export function StatsPanel({ events, gameEvents, areas, rows, playing, moment, limit, continued, kinds, picks, jump }: StatsPanelProps) {
  const now = Math.ceil(Math.max(playing, events.at(-1)?.frame ?? 0) / NOW_STEP) * NOW_STEP;
  const at = moment.cursor?.frame ?? playing;
  const unit = limit?.unit;
  const view = useMemo(() => statsView(events, { now, areas, continued, unit }), [events, now, areas, continued, unit]);
  const allLines = useMemo(() => (gameEvents ? eventLines(gameEvents, areas) : []), [gameEvents, areas]);
  const flagged = useMemo(() => rows.filter((row) => row.flags.length > 0), [rows]);
  const [area, setArea] = useState<string | null>(null);
  const scope = scopeOf(view, moment, area);
  const spans = scopeSpans(view, scope);
  const part = selected(view, spans);
  const text = scopeText(view, scope);
  const model = hasModel(view, limit?.amount ?? null);
  const last = useLastHours(at, moment.cursor?.frame ?? null);
  const chosen = scope.kind !== "run";
  const shown = graphWindow(scope, spans, last.extent, Math.max(1, now, at));
  const graph: Graph = { view, part, shown, at, spans: chosen ? spans : [], limit: limit?.amount ?? null, short: text.short, picks };
  const setScope = (next: Scope) => {
    const again = (next.kind === "chapter" || next.kind === "stay") && scope.kind === next.kind && scope.index === next.index;
    setArea(next.kind === "area" ? next.area : null);
    if (next.kind === "run" || again) return picks.clear();
    picks.selectRange(scopeSpans(view, next)[0]);
  };
  // In a replay, the Game events of the frames not played yet do not count.
  const counts = (within: readonly Span[]): Counts => {
    const played = upTo(within, playing);
    return { ...gameCounts(gameEvents ?? [], played), unusual: flagged.filter((row) => isInside(played, row.call.frame)).length };
  };
  const spansKey = spans.map((s) => `${s.from}-${s.to}`).join();
  // `spans` is a new array at each render: its text is the key of the memo.
  const counted = useMemo(() => counts(spans), [gameEvents, flagged, spansKey, playing]);
  const whole = useMemo(() => (chosen ? counts([{ from: 0, to: now }]) : null), [chosen, gameEvents, flagged, now, playing]);
  const since = useMemo(() => gameEvents && sinceHeal(gameEvents, at), [gameEvents, at]);
  const latest = allLines.filter((line) => kinds.has(line.kind) && line.frame <= at).slice(-LATEST).reverse();
  const impossible = part.impossible.reduce((sum, c) => sum + c.count, 0);
  const wholeRun = chosen && (
    <Button size="sm" variant="ghost" onClick={() => setScope({ kind: "run" })}>
      Whole Run
    </Button>
  );
  return (
    <div class="flex flex-col gap-5">
      <Section title={`${moment.cursor ? "At the cursor" : "Now"} · ${clock(at)}`}>
        <AtCursor view={view} at={at} limit={limit} model={model} />
        {gameEvents ? (
          <div class="grid grid-cols-1 gap-2 min-[1280px]:grid-cols-2">
            <SinceCard since={since} at={at} />
            <LatestEvents lines={latest} jump={jump} />
          </div>
        ) : (
          <p class="text-sm text-muted">{NO_GAME_EVENTS}.</p>
        )}
      </Section>
      <Section
        title="Graphs"
        detail={windowText(shown, spans, text.short)}
        action={
          <>
            {shown.zooms && wholeRun}
            <Tooltip text={last.can ? `Show the last ${LAST_HOURS} h before the cursor; the selection does not change` : `There is less than ${LAST_HOURS} h of Run before the cursor`}>
              <Button size="sm" pressed={last.on} disabled={!last.can} onClick={last.toggle}>
                −{LAST_HOURS} h
              </Button>
            </Tooltip>
          </>
        }
      >
        <Card size="sm">
          <div class="flex flex-col gap-3">
            <ChapterSteps chapters={view.chapters} at={at} scope={scope} onScope={setScope} />
            <AreaRow view={view} extent={shown.extent} at={at} scope={scope} onScope={setScope} />
            {model && (["cost", "stuck", "prompt"] as const).map((kind) => <Chart key={kind} kind={kind} graph={graph} />)}
            <TimeAxis extent={shown.extent} />
          </div>
        </Card>
      </Section>
      <Section title={text.title} detail={text.detail} action={wholeRun}>
        <div class="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted tabular-nums">
          <span>{spendText({ unit: view.unit, amount: part.spent })}</span>
          <span>{plural(part.calls.length, "Model call")}</span>
          <span class={impossible > 0 ? "text-bad" : ""}>{impossible} impossible</span>
          {part.stuckMax !== null && <Pill tone={stuckTone(part.stuckMax)}>Stuck max {part.stuckMax}</Pill>}
        </div>
        {gameEvents ? (
          <div class="grid grid-cols-2 gap-2 min-[1280px]:grid-cols-4">
            {TILES.map((look) => (
              <StatTile key={look.key} size="md" label={look.label} value={tileValue(counted, look)} total={whole ? tileValue(whole, look) : undefined} icon={look.icon} tone={look.tone} />
            ))}
          </div>
        ) : (
          <p class="text-sm text-muted">{NO_GAME_EVENTS}.</p>
        )}
      </Section>
      <ModelCalls part={part} picked={moment.cursor?.call ?? null} picks={picks} />
    </div>
  );
}
