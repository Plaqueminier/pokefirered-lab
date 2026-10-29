import { Fragment } from "preact";
import { type ReplayStatus, replayOf, type ShownRun } from "../src/protocol";
import { Card, fraction, LABEL, Pill, Slider } from "./components";
import { dollars } from "./runs";
import { clock } from "./stats-lanes";

const SEEK_STEP = 60;

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
          { label: "Reasoning", value: model.reasoning },
          { label: "Starter", value: model.starter },
          { label: "Model calls", value: String(model.calls), detail: `/ ${model.totalCalls}` },
          { label: "Cost", value: dollars(model.cost), detail: `/ ${dollars(model.totalCost)}` },
          { label: "Cost limit", value: dollars(model.costLimit) },
        ]
      : [{ label: "Model", value: "none (a scripted Bot)" }]),
    ...(continued ? [{ label: "Continues", value: `from ${clock(continued.frame)}`, detail: `${continued.events} events` }] : []),
    replay.gameEvents === null ? { label: "Game events", value: "No Game events in this record", detail: "only maps, battles and Milestones" } : { label: "Game events", value: String(replay.gameEvents) },
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

function NoReplay({ shown }: { shown: ShownRun | null }) {
  const text =
    shown?.kind === "bot"
      ? `The Viewer shows Run ${shown.run.id} of the Bot ${shown.run.bot}. The Replay panel shows a replay only.`
      : "No replay: the keyboard plays the Viewer Run. Choose a Run record in the Run select of the top bar to replay it.";
  return (
    <Card>
      <p class="text-sm text-muted">{text}</p>
    </Card>
  );
}

export function ReplayPanel({ shown, frame, seek }: { shown: ShownRun | null; frame: number; seek: (frame: number) => void }) {
  const replay = replayOf(shown);
  if (!replay) return <NoReplay shown={shown} />;
  const at = replay.seeking?.to ?? frame;
  return (
    <div class="flex max-w-[560px] flex-col gap-4">
      <div class="flex h-6.5 items-center gap-2">
        <span class={LABEL}>Replay</span>
        <ReplayState replay={replay} />
      </div>
      <Card>
        <div class="flex flex-col gap-3">
          <span class="truncate font-mono text-sm">{replay.name}</span>
          <Slider label="Frame of the replay" value={at} max={replay.frames} reached={replay.reached} step={SEEK_STEP} format={clock} onSeek={seek} />
          <div class="grid grid-cols-3 text-sm tabular-nums">
            <span>{clock(at)}</span>
            <span class="text-center text-muted">{replay.ended ? `end: ${replay.endReason}` : `${Math.round(fraction(at, replay.frames) * 100)} %`}</span>
            <span class="text-right text-muted">{clock(replay.frames)}</span>
          </div>
        </div>
      </Card>
      <Card>
        <div class="flex flex-col gap-3">
          <span class={LABEL}>Run record</span>
          <RecordFacts replay={replay} />
        </div>
      </Card>
    </div>
  );
}
