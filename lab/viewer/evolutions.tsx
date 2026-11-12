import { Dna, Flag, Gauge, Layers, Milestone, Play, RotateCcw, Square, Timer, Trophy, Users } from "lucide-preact";
import { type ComponentChildren, render } from "preact";
import { useEffect, useState } from "preact/hooks";
import type { Evolution, EvolutionFacts, Generation } from "../src/genetic/evolution";
import type { EvolutionRun } from "../src/genetic/evolve-process";
import { GROUP_NAMES, GROUPS, type Genome, weightOf } from "../src/genetic/genome";
import { BESTS_RACE, type ClientMessage, DEFAULT_PARALLEL, evolutionPath, generationRace, MAX_PARALLEL, PLAIN_NAME } from "../src/protocol";
import { Bar, Button, Card, Code, Field, Input, LABEL, Pill, Slider, StatTile, TermList, type Tone, Tooltip } from "./components";
import { GenerationChart, SignedBar } from "./components-chart";
import { Select } from "./components-layers";
import { fetched, Store, useStore } from "./cursor";

type Member = Generation["genomes"][number];


const fitnessText = (value: number) => value.toFixed(2);
const count = (value: number) => value.toLocaleString("en-US");
const raceOf = (evolution: string, generation: number | typeof BESTS_RACE) => evolutionPath(evolution, generation === BESTS_RACE ? BESTS_RACE : generationRace(generation));

function command(name: string, parallel: number): string {
  return `bun run evolve ${name || "<name>"}${parallel === DEFAULT_PARALLEL ? "" : ` --parallel ${parallel}`}`;
}

async function json<T>(url: string): Promise<T> {
  return (await fetched(url)).json();
}

function continueProblem(facts: EvolutionFacts): string | null {
  if (facts.end) return `It ended: ${facts.end}.`;
  if (facts.problem) return `It does not continue: ${facts.problem}.`;
  return null;
}

function stateOf(facts: EvolutionFacts | undefined, run: EvolutionRun | null): { tone: Tone; text: string } {
  if (run && run.name === facts?.name) return run.stopping ? { tone: "warn", text: `stops after Generation ${run.generation ?? "…"}` } : { tone: "info", text: `running · Generation ${run.generation ?? "…"}` };
  if (!facts) return { tone: "info", text: "no Generation yet" };
  if (facts.end) return { tone: "ok", text: `ended: ${facts.end}` };
  if (facts.problem) return { tone: "bad", text: `does not continue: ${facts.problem}` };
  return { tone: "warn", text: `stopped after Generation ${facts.generations}` };
}

function bornIn({ generations }: Evolution, id: number): number {
  return generations.find((g) => g.genomes.some((m) => m.id === id))?.number ?? 0;
}

function Weights({ genome, version }: { genome: Partial<Genome>; version: string }) {
  return (
    <div class="grid grid-cols-1 gap-5 @3xl:grid-cols-3">
      {GROUP_NAMES.map((group) => (
        <div key={group} class="flex min-w-0 flex-col gap-1.5">
          <span class={LABEL}>{group}</span>
          {genome[group] === undefined ? (
            <span class="text-xs text-muted">Not in the Genetic bot version {version}: each weight of this group is 0.</span>
          ) : (
            GROUPS[group].map((criterion) => {
              const weight = weightOf(genome, group, criterion);
              return (
                <div key={criterion} class="grid grid-cols-[18ch_1fr_5ch] items-center gap-2 text-xs">
                  <span class="truncate font-mono text-muted">{criterion}</span>
                  <SignedBar value={weight} />
                  <span class="text-right tabular-nums">{weight.toFixed(2)}</span>
                </div>
              );
            })
          )}
        </div>
      ))}
    </div>
  );
}

type Actions = { send: (message: ClientMessage) => void; openRace: (name: string) => void; replay: (name: string) => void };

function StartCard({ list, initial, send, onStart }: { list: readonly EvolutionFacts[]; initial: string; send: Actions["send"]; onStart: (name: string) => void }) {
  const [name, setName] = useState(initial);
  const [parallel, setParallel] = useState(DEFAULT_PARALLEL);
  useEffect(() => setName(initial), [initial]);
  const known = list.find((facts) => facts.name === name);
  const error = name !== "" && !PLAIN_NAME.test(name) ? 'Only letters, digits, "-" and "_".' : known ? (continueProblem(known) ?? undefined) : undefined;
  const hint = known ? `It has ${known.generations} Generations: Continue plays Generation ${known.generations + 1}.` : "A new folder runs/evolutions/<name>/.";
  return (
    <Card>
      <div class="flex flex-col gap-4">
        <span class={LABEL}>Start or continue</span>
        <Field label="Name of the Evolution" hint={hint} error={error}>
          <Input value={name} invalid={error !== undefined} placeholder="night-1" onInput={(event) => setName(event.currentTarget.value.trim())} />
        </Field>
        <div class="flex flex-col gap-1.5">
          <span class="flex items-baseline justify-between text-xs font-semibold text-muted">
            Runs at the same time <span class="text-fg tabular-nums">{parallel}</span>
          </span>
          <Slider value={parallel} max={MAX_PARALLEL} label="Runs at the same time" live onSeek={(value) => setParallel(Math.max(1, value))} />
          <span class="text-xs text-faint">
            {DEFAULT_PARALLEL} by default, {MAX_PARALLEL} at most. They play out of the places of the Viewer.
          </span>
        </div>
        <Button
          variant="primary"
          disabled={name === "" || error !== undefined}
          onClick={() => {
            send({ type: "start-evolution", name, parallel });
            onStart(name);
          }}
        >
          {known ? <RotateCcw size={14} /> : <Play size={14} />} {known ? "Continue" : "Start"}
        </Button>
        <span class="text-xs text-muted">
          The same as <Code>{command(name, parallel)}</Code>
        </span>
      </div>
    </Card>
  );
}

function RunningCard({ run, send }: { run: EvolutionRun; send: Actions["send"] }) {
  const reading = run.generation === null;
  return (
    <Card>
      <div class="flex flex-col gap-3.5">
        <div class="flex items-center gap-2">
          <Pill tone="info">running</Pill>
          <span class="min-w-0 truncate text-sm font-semibold">{reading ? `${run.name}: reads its file` : `${run.name}, Generation ${run.generation}`}</span>
        </div>
        <div class="flex flex-col gap-1.5">
          <span class="flex justify-between text-xs text-muted tabular-nums">
            Runs of the Generation
            <span class="text-fg">
              {Math.min(run.played, run.population)} / {run.population}
            </span>
          </span>
          <Bar value={run.played} max={run.population} tone="info" />
        </div>
        <div class="grid grid-cols-2 gap-3">
          <StatTile size="sm" label="Runs at the same time" value={run.parallel} icon={Users} />
          <StatTile size="sm" label="Last Generation" value={run.lastSeconds === null ? "–" : `${run.lastSeconds.toFixed(0)} s`} icon={Timer} />
        </div>
        <Button variant="danger" disabled={run.stopping} onClick={() => send({ type: "stop-evolution" })}>
          <Square size={13} /> {run.stopping ? `Stops after Generation ${run.generation ?? "…"}` : "Stop after this Generation"}
        </Button>
        <span class="text-xs text-faint">A stop at once would lose the Runs of the Generation that plays: the stop waits for its end.</span>
      </div>
    </Card>
  );
}

function BestCard({ evolution, best, record, actions, name }: { evolution: Evolution; best: Member; record: string | undefined; actions: Actions; name: string }) {
  const { version } = evolution.bot;
  const parents = best.parents.length > 0 ? `parents ${best.parents.join(" × ")}` : "random weights";
  return (
    <Card>
      <div class="@container flex flex-col gap-4">
        <div class="flex flex-wrap items-center gap-x-3 gap-y-2">
          <span class={LABEL}>Best Genome {best.id}</span>
          <span class="text-xs text-muted tabular-nums">
            born in Generation {bornIn(evolution, best.id)} · {parents} · {count(best.frames)} frames · {best.endReason}
          </span>
          <span class="ml-auto">
            <Button size="sm" disabled={!record} onClick={() => record && actions.replay(evolutionPath(name, record))}>
              <Play size={12} /> Replay its Run
            </Button>
          </span>
        </div>
        <div class="grid grid-cols-1 gap-6 @4xl:grid-cols-[1fr_240px]">
          <Weights genome={best.genome} version={version} />
          <div class="flex flex-col gap-2">
            <span class={LABEL}>Fitness {fitnessText(best.fitness)}</span>
            <TermList rows={Object.entries(best.terms).map(([term, { count: n, points }]) => [points.toFixed(2), `${term}: ${count(n)}`] as const)} />
          </div>
        </div>
      </div>
    </Card>
  );
}

const COLUMNS = "grid grid-cols-1 gap-4 @5xl:grid-cols-[1fr_340px]";

function Dashboard({ name, evolution, races, actions, side }: { name: string; evolution: Evolution; races: ReadonlySet<string>; actions: Actions; side: ComponentChildren }) {
  const { generations, settings } = evolution;
  const [pick, setPick] = useState(String(generations.length));
  const last = generations[generations.length - 1];
  const bestGeneration = generations.findLast((g) => g.record) ?? last;
  const best = bestGeneration.genomes[0];
  const meanOf = (g: Generation) => g.genomes.reduce((sum, m) => sum + m.fitness, 0) / g.genomes.length;
  const stuck = last.genomes.filter((m) => m.endReason === "no progress").length;
  const openRace = (generation: number) => actions.openRace(raceOf(name, generation));
  const picked = Number(pick) || generations.length;
  const hasRaces = races.has(raceOf(name, generations[0].number));
  return (
    <>
      <div class="grid grid-cols-2 gap-3 @3xl:grid-cols-3 @5xl:grid-cols-5">
        <StatTile size="lg" label="Generations" value={generations.length} total={settings.generations} detail={`bot v${evolution.bot.version} · Fitness v${evolution.fitnessVersion}`} icon={Layers} />
        <StatTile size="lg" label="Best Fitness" value={fitnessText(best.fitness)} detail={`Genome ${best.id}, Generation ${bestGeneration.number}`} icon={Trophy} tone="accent" />
        <StatTile size="lg" label="Mean, last Generation" value={meanOf(last).toFixed(1)} detail={`from ${meanOf(generations[0]).toFixed(1)} in Generation 1`} icon={Gauge} />
        <StatTile size="lg" label="Milestones of the best" value={best.milestones.length} detail={best.milestones.join(", ") || `goal: ${settings.goal}`} icon={Milestone} />
        <StatTile size="lg" label="Frame limit" value={count(last.frameBudget)} detail={`${stuck} of ${last.genomes.length} end at Stuck ${settings.noProgressLimit}`} icon={Timer} />
      </div>
      <div class={COLUMNS}>
        <Card>
          <div class="flex flex-col gap-4">
            <GenerationChart
              label="Fitness by Generation"
              points={generations.map((g) => ({ generation: g.number, best: g.genomes[0].fitness, mean: meanOf(g), newBest: g.record !== undefined }))}
              pickText={hasRaces ? "its Race" : undefined}
              onPick={hasRaces ? openRace : undefined}
            />
            <div class="flex flex-wrap items-center gap-2">
              <div class="w-44">
                <Select options={generations.map((g) => ({ value: String(g.number), label: `Generation ${g.number}`, disabledReason: races.has(raceOf(name, g.number)) ? undefined : "no Race" }))} value={String(picked)} title="A Generation" onChange={setPick} />
              </div>
              <Button size="sm" disabled={!races.has(raceOf(name, picked))} onClick={() => openRace(picked)}>
                <Flag size={13} /> Race of Generation {picked}
              </Button>
              {hasRaces && <span class="text-xs text-faint">Or click the chart at a Generation.</span>}
            </div>
          </div>
        </Card>
        {side}
      </div>
      <BestCard evolution={evolution} best={best} record={bestGeneration.record} actions={actions} name={name} />
    </>
  );
}

type Props = { shown: Store<boolean>; run: Store<EvolutionRun | null>; actions: Actions };

function EvolutionsRoot({ shown, run: runStore, actions }: Props) {
  const visible = useStore(shown);
  const run = useStore(runStore);
  const [list, setList] = useState<EvolutionFacts[] | null>(null);
  const [races, setRaces] = useState<ReadonlySet<string>>(new Set());
  const [name, setName] = useState("");
  const [evolution, setEvolution] = useState<Evolution | null>(null);
  const [error, setError] = useState<string | null>(null);
  const changes = run ? `${run.name}:${run.generation}` : "none";
  useEffect(() => {
    if (!visible) return;
    Promise.all([json<EvolutionFacts[]>("/evolution/list.json"), json<string[]>("/race/list.json")])
      .then(([facts, raceNames]) => {
        setError(null);
        setList(facts);
        setRaces(new Set(raceNames));
        setName((current) => current || (facts.at(-1)?.name ?? ""));
      })
      .catch((failure) => setError(String(failure)));
  }, [visible, changes]);
  const facts = list?.find((f) => f.name === name);
  useEffect(() => {
    if (!visible || !facts) return setEvolution(null);
    let cancelled = false;
    json<Evolution>(`/evolution/file/${encodeURIComponent(facts.name)}`)
      .then((file) => !cancelled && setEvolution(file))
      .catch((failure) => !cancelled && setError(String(failure)));
    return () => {
      cancelled = true;
    };
  }, [visible, facts?.name, facts?.generations]);
  if (!visible) return null;
  const state = stateOf(facts, run);
  const shownFile = evolution && facts && evolution.generations.length > 0 ? evolution : null;
  const side = run ? <RunningCard run={run} send={actions.send} /> : <StartCard list={list ?? []} initial={name} send={actions.send} onStart={setName} />;
  const options = [...(list ?? []).map((f) => f.name), ...(run && !list?.some((f) => f.name === run.name) ? [run.name] : [])];
  return (
    <div class="@container mx-auto flex max-w-[1300px] flex-col gap-4 p-4 min-[900px]:p-6">
      <div class="flex flex-wrap items-center gap-3">
        <Dna size={22} class="text-accent" />
        <span class="text-xl font-semibold">Evolutions</span>
        <div class="w-56">
          <Select options={options.map((value) => ({ value, label: value, group: "runs/evolutions" }))} value={name} placeholder="No Evolution yet" title="The Evolution that the page shows" onChange={setName} />
        </div>
        {name && <Pill tone={state.tone}>{state.text}</Pill>}
        <span class="ml-auto">
          <Tooltip text={races.has(raceOf(name, "bests")) ? "The best Genome of each Generation, in the Race tab" : "This Evolution has no Race of the bests"}>
            <Button disabled={!races.has(raceOf(name, "bests"))} onClick={() => actions.openRace(raceOf(name, "bests"))}>
              <Flag size={14} /> Race of the bests
            </Button>
          </Tooltip>
        </span>
      </div>
      {error && <p class="text-sm text-bad">{error}</p>}
      {shownFile ? (
        <Dashboard key={name} name={name} evolution={shownFile} races={races} actions={actions} side={side} />
      ) : (
        <div class={COLUMNS}>
          <Card>
            <p class="text-sm text-muted">{list === null ? "Reading runs/evolutions/…" : name ? `${name} has no Generation yet: its file comes after its first Generation.` : "No Evolution in runs/evolutions/ yet. Start one with the form."}</p>
          </Card>
          {side}
        </div>
      )}
    </div>
  );
}

export class EvolutionsTab {
  readonly #shown = new Store(false);
  readonly #run = new Store<EvolutionRun | null>(null);

  constructor(root: HTMLElement, actions: Actions) {
    render(<EvolutionsRoot shown={this.#shown} run={this.#run} actions={actions} />, root);
  }

  onTab(shown: boolean): void {
    this.#shown.set(shown);
  }

  onRun(run: EvolutionRun | null): void {
    this.#run.set(run);
  }
}
