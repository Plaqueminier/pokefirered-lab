import { Play, Square } from "lucide-preact";
import { useState } from "preact/hooks";
import { type BotInfo, type ClientMessage, DEFAULT_MODEL, DEFAULT_REASONING, DEFAULT_STARTER, DEFAULT_THINKING, REASONING, type ReasoningLevel, type RunSummary, type ShownRun, STARTERS } from "../src/protocol";
import { Button, Checkbox, Field, Input } from "./components";
import { Select } from "./components-layers";

type Send = (message: ClientMessage) => void;

export function botRunKey(id: number): string {
  return `bot ${id}`;
}

export function replayKey(name: string): string {
  return `viewer ${name}`;
}

export function runKey(shown: ShownRun): string {
  return shown.kind === "bot" ? botRunKey(shown.run.id) : replayKey(shown.replay?.name ?? "");
}

export function dollars(cost: number): string {
  return `${cost.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 4 })} $`;
}

// Under 0.1 m$, 2 decimals would show 0.00.
export function milliDollars(cost: number): string {
  const milli = cost * 1000;
  return `${milli.toFixed(milli < 0.1 ? 3 : 2)} m$`;
}

export function seconds(ms: number): string {
  return `${(ms / 1000).toFixed(1)} s`;
}

export function money(amount: number): string {
  return `${amount.toLocaleString("en-US")} ₽`;
}

/** A change with its sign: "+3", "−500 ₽". */
export function signed(change: number, format: (value: number) => string = String): string {
  return `${change < 0 ? "−" : "+"}${format(Math.abs(change))}`;
}

export function signedMoney(change: number): string {
  return signed(change, money);
}

export function tokens(count: number): string {
  return count.toLocaleString("en-US");
}

function runState(run: RunSummary): string {
  if (run.playing) return run.stopAsked ? "stops…" : "plays";
  if (run.error) return `error: ${run.error}`;
  return `end: ${run.endReason}`;
}

function runLabel(run: RunSummary): string {
  return `Run ${run.id} · ${run.bot}${run.parent ? ` (continues ${run.parent})` : ""} · ${runState(run)}`;
}

// A scripted Bot refuses any model option: a default value goes as no option.
function option<T extends string>(value: T, byDefault: T): T | undefined {
  return value === byDefault ? undefined : value;
}

const VIEWER = "viewer";

function shownValue(shown: ShownRun): string {
  if (shown.kind === "bot") return `run:${shown.run.id}`;
  return shown.replay ? `replay:${shown.replay.name}` : VIEWER;
}

// One Select for all that the Viewer can show: its own Run, the Runs of the Bots and the replay of a Run record.
export function RunSelect({ shown, runs, records, send }: { shown: ShownRun | null; runs: readonly RunSummary[]; records: readonly string[]; send: Send }) {
  const options = [
    { value: VIEWER, label: "Viewer Run (keyboard)", group: "Viewer Run" },
    ...runs.map((run) => ({ value: `run:${run.id}`, label: runLabel(run), group: "Runs of the Bots" })),
    ...records.map((name) => ({ value: `replay:${name}`, label: name, group: "Replay a Run record" })),
  ];
  const value = shown ? shownValue(shown) : VIEWER;
  return (
    <Select
      options={options}
      value={value}
      placeholder={shown?.kind === "viewer" && shown.replay ? `Replay of ${shown.replay.name}` : "connecting…"}
      title="The Run that the Viewer shows"
      onChange={(next) => {
        if (next === VIEWER) {
          // From a Run of a Bot, go back to the Run of the Viewer as it is; from a replay, give the keyboard the Run.
          if (shown?.kind === "bot") send({ type: "show", runId: null });
          else send({ type: "end-replay" });
        } else if (next.startsWith("run:")) send({ type: "show", runId: Number(next.slice(4)) });
        else send({ type: "replay", name: next.slice(7) });
      }}
    />
  );
}

const FROM_START = "";

function shownModel(run: RunSummary | null): string {
  if (!run?.model) return "";
  const { id, reasoning, thinking, starter, cost, costLimit } = run.model;
  return `Run ${run.id}: model ${id}, reasoning ${reasoning}, thinking ${thinking}, starter ${starter}, cost ${dollars(cost)} of ${dollars(costLimit)}`;
}

export type Places = { free: number; limit: number };

function countError(countOk: boolean, { free, limit }: Places): string | undefined {
  if (free === 0) return `No free place: the Runs of the Bots and the Grid replays use the ${limit} places.`;
  return countOk ? undefined : `From 1 to ${free}.`;
}

function totalCost(count: number, given: string, byDefault: number | null): string {
  const limit = given.trim() ? Number(given) : byDefault;
  if (limit === null || !Number.isFinite(limit)) return "no cost limit";
  return count === 1 ? dollars(limit) : `${count} × ${dollars(limit)} = ${dollars(count * limit)}`;
}

const LEVEL_OPTIONS = REASONING.map((level) => ({ value: level, label: level }));

export function BotsPanel({ shown, bots, records, places, send }: { shown: ShownRun | null; bots: readonly BotInfo[]; records: readonly string[]; places: Places; send: Send }) {
  const freePlaces = places.free;
  const names = bots.map((info) => info.name);
  const [bot, setBot] = useState("");
  const [model, setModel] = useState("");
  const [costLimit, setCostLimit] = useState("");
  const [reasoning, setReasoning] = useState<ReasoningLevel>(DEFAULT_REASONING);
  const [thinking, setThinking] = useState<ReasoningLevel>(DEFAULT_THINKING);
  const [starter, setStarter] = useState<(typeof STARTERS)[number]>(DEFAULT_STARTER);
  const [stopAtWhiteout, setStopAtWhiteout] = useState(true);
  const [from, setFrom] = useState(FROM_START);
  const [countText, setCountText] = useState("1");
  const count = Number(countText);
  const countOk = Number.isInteger(count) && count >= 1 && count <= freePlaces;
  const chosenBot = names.includes(bot) ? bot : (names[0] ?? "");
  const chosenInfo = bots.find((info) => info.name === chosenBot);
  const defaultLimit = chosenInfo && "costLimit" in chosenInfo ? chosenInfo.costLimit : null;
  const chosenFrom = records.includes(from) ? from : FROM_START;
  const run = shown?.kind === "bot" ? shown.run : null;
  const start = () => {
    if (!chosenBot || !countOk) return;
    const limit = costLimit.trim();
    const options = {
      id: model.trim() || undefined,
      costLimit: limit ? Number(limit) : undefined,
      reasoning: option(reasoning, DEFAULT_REASONING),
      thinking: option(thinking, DEFAULT_THINKING),
      starter: option(starter, DEFAULT_STARTER),
      stopAtWhiteout,
    };
    send({ type: "start-bot", name: chosenBot, model: options, count, ...(chosenFrom === FROM_START ? {} : { parent: chosenFrom }) });
  };
  return (
    <div class="flex w-[560px] max-w-full flex-col gap-4">
      <div class="grid grid-cols-2 gap-3">
        <Field label="Bot">
          <Select options={names.map((name) => ({ value: name, label: name }))} value={chosenBot} placeholder="no Bot" onChange={setBot} />
        </Field>
        <Field label="Start from">
          <Select
            options={[{ value: FROM_START, label: "the Starting save" }, ...records.map((name) => ({ value: name, label: `continue ${name}` }))]}
            value={chosenFrom}
            onChange={setFrom}
          />
        </Field>
        <Field label="Model" hint="Empty: the default model.">
          <Input value={model} placeholder={DEFAULT_MODEL} autocomplete="off" onInput={(event) => setModel(event.currentTarget.value)} />
        </Field>
        <Field label="Cost limit" hint="Empty: LAB_COST_LIMIT, or 0.50 $.">
          <Input type="number" min="0.01" step="0.05" unit="$" placeholder="0.50" value={costLimit} onInput={(event) => setCostLimit(event.currentTarget.value)} />
        </Field>
        <Field label="Reasoning" hint="For the usual decisions. off is cheaper, but the model makes more mistakes.">
          <Select options={LEVEL_OPTIONS} value={reasoning} onChange={setReasoning} />
        </Field>
        <Field label="Thinking" hint="For the Character, Reflection and Review turns.">
          <Select options={LEVEL_OPTIONS} value={thinking} onChange={setThinking} />
        </Field>
        <Field label="Starter" hint="free: the character of the model chooses.">
          <Select options={STARTERS.map((name) => ({ value: name, label: name }))} value={starter} onChange={setStarter} />
        </Field>
        <Field label="Count" hint={`Runs of the Bot to start: 1 to ${freePlaces}, the free places.`} error={countError(countOk, places)}>
          <Input type="number" min="1" max={String(freePlaces)} step="1" invalid={!countOk} value={countText} onInput={(event) => setCountText(event.currentTarget.value)} />
        </Field>
        <Field label="Maximum total cost" hint="Each Run keeps its own cost limit.">
          <p class="flex h-8 items-center font-mono text-sm tabular-nums">{totalCost(countOk ? count : 1, costLimit, defaultLimit)}</p>
        </Field>
      </div>
      <Checkbox on={stopAtWhiteout} onChange={setStopAtWhiteout}>
        Stop at a whiteout: the Run ends when all the Pokémon of the party faint
      </Checkbox>
      <div class="flex items-center gap-2">
        <Button variant="primary" disabled={!chosenBot || !countOk} onClick={start}>
          <Play size={14} />
          {countOk && count > 1 ? `Start ${count} Runs` : "Start the Bot"}
        </Button>
        <Button
          variant="danger"
          disabled={!run?.playing || run.stopAsked}
          title="Stops the shown Run after the action or the Model call that plays, and writes its Run record"
          onClick={() => run && send({ type: "stop-run", runId: run.id })}
        >
          <Square size={14} />
          Stop the shown Run
        </Button>
      </div>
      {run?.model && <p class="font-mono text-xs text-muted">{shownModel(run)}</p>}
      <p class="text-xs leading-relaxed text-faint">
        The Runs of the Bots play at the same time, at full speed, with no sound. They share {places.limit} places with the replays of the Grid. To show another Run does not stop them. "Stop the shown Run" ends it with
        user stop and writes its Run record. "continue" starts the Bot from the end of a Run record, with its Memory tree, its Mission and its Atlas: the cost
        limit counts the new Model calls only, and the model can be another one.
      </p>
    </div>
  );
}
