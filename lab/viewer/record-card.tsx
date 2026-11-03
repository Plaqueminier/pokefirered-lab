import { Fragment } from "preact";
import type { ReplayStatus } from "../src/protocol";
import { LABEL, Pill } from "./components";
import { SPEND_WORDS, spendText } from "../src/protocol";
import { clock } from "./stats-format";
import { NO_GAME_EVENTS } from "./timeline-events";

function ReplayState({ replay }: { replay: ReplayStatus }) {
  if (replay.seeking) return <Pill tone="info">jumps to {clock(replay.seeking.to)}…</Pill>;
  return replay.ended ? <Pill tone="warn">ended: {replay.endReason}</Pill> : <Pill tone="ok">plays</Pill>;
}

function RecordFacts({ replay }: { replay: ReplayStatus }) {
  const { model, continued } = replay;
  const facts: { label: string; value: string; detail?: string }[] = [
    { label: "Frames", value: clock(replay.frames), detail: replay.frames.toLocaleString("en-US") },
    ...(model
      ? [
          { label: "Model", value: model.id },
          { label: "Provider", value: model.provider },
          { label: "Reasoning", value: model.reasoning },
          { label: "Thinking", value: model.thinking },
          { label: "Starter", value: model.starter },
          { label: "Model calls", value: String(model.calls), detail: `/ ${model.totalCalls}` },
          { label: SPEND_WORDS[model.limit.unit].name, value: spendText(model.spent), detail: `/ ${spendText(model.totalSpent)}` },
          { label: SPEND_WORDS[model.limit.unit].limit, value: spendText(model.limit) },
        ]
      : [{ label: "Model", value: "none (a scripted Bot)" }]),
    ...(continued ? [{ label: "Limit counts", value: `from ${clock(continued.frame)}`, detail: `${continued.events} events` }] : []),
    replay.gameEvents === null ? { label: "Game events", value: NO_GAME_EVENTS, detail: "only maps, battles and Milestones" } : { label: "Game events", value: String(replay.gameEvents) },
  ];
  return (
    <dl class="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1.5 text-sm">
      {facts.map((fact) => (
        <Fragment key={fact.label}>
          <dt class="text-muted">{fact.label}</dt>
          <dd class="min-w-0 truncate tabular-nums">
            {fact.value} {fact.detail && <span class="text-muted">{fact.detail}</span>}
          </dd>
        </Fragment>
      ))}
    </dl>
  );
}

export function RecordCard({ replay }: { replay: ReplayStatus }) {
  return (
    <div class="flex w-[460px] max-w-full flex-col gap-3">
      <div class="flex items-center gap-2">
        <span class={LABEL}>Run record</span>
        <span class="ml-auto">
          <ReplayState replay={replay} />
        </span>
      </div>
      <span class="truncate font-mono text-sm">{replay.name}</span>
      <RecordFacts replay={replay} />
    </div>
  );
}
