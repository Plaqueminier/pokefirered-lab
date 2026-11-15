import { Clapperboard, Skull } from "lucide-preact";
import { useEffect, useState } from "preact/hooks";
import { runIdText } from "../src/protocol";
import { Button, Card, LABEL, Pill, StatTile, Tabs } from "./components";
import { type DeathFacts, DeathCard, DeathRow, Epitaph, StarterRow } from "./components-race";
import { useRefresh, useStore } from "./cursor";
import { GhostCard, GhostFace } from "./race-cards";
import { leadOf, type RaceDeath } from "./race-deaths";
import type { Grave, GraveMode } from "./race-graveyard";
import { RESULT_LOOK } from "./race-marks";
import type { RaceView } from "./race-view";
import { raceTime } from "./stats-format";

const COUNTER_REFRESH_MS = 500;
const TOUR_STEP_MS = 5200;
/** The stone of the Tour falls first: the last words type after it. */
const TYPE_FROM_MS = 1300;
const TYPE_MS = 1600;
const TYPE_REFRESH_MS = 40;

function deathFacts(view: RaceView, death: RaceDeath): DeathFacts {
  const ghost = view.graveyard.ghostOf(death);
  return {
    face: <GhostFace view={view} number={death.number} size="h-6 w-4" />,
    icon: (species) => view.art.iconUrl(species),
    run: runIdText(death.number),
    endedRun: death.endedRun,
    lead: leadOf(ghost.team, death.starter),
    killer: death.killer,
    epitaph: death.epitaph,
    team: ghost.team,
    model: ghost.model,
    coach: ghost.coach,
    character: ghost.character,
    place: view.graveyard.placeOf(death),
    time: raceTime(death.frame),
  };
}

export function GraveCard({ view, grave }: { view: RaceView; grave: Grave }) {
  return grave.kind === "stone" ? <DeathCard death={deathFacts(view, grave.death)} /> : <GhostCard view={view} ghost={grave.ghost} />;
}

function GraveCounter({ view }: { view: RaceView }) {
  useRefresh(COUNTER_REFRESH_MS);
  return (
    <div class="pointer-events-none absolute top-3 left-3 w-[190px]">
      <Card glass size="sm">
        <StatTile size="md" label="Whiteouts" value={view.graveyard.visible(view.frame).length} icon={Skull} tone="bad" total={view.graveyard.deaths.length} />
      </Card>
    </div>
  );
}

function StoppedRuns({ view }: { view: RaceView }) {
  const counts = new Map<keyof typeof RESULT_LOOK, number>();
  for (const { result } of view.moment.ghosts) if (result && result !== "whiteout") counts.set(result, (counts.get(result) ?? 0) + 1);
  if (counts.size === 0) return null;
  return (
    <section class="flex flex-col gap-1">
      <span class={LABEL}>Stopped with no whiteout</span>
      <div class="flex flex-wrap gap-1.5">
        {[...counts].map(([result, count]) => {
          const { icon: Icon, tone } = RESULT_LOOK[result];
          return (
            <Pill key={result} tone={tone}>
              <span class="inline-flex items-center gap-1">
                <Icon size={12} />
                {result} · {count}
              </span>
            </Pill>
          );
        })}
      </div>
    </section>
  );
}

/** While it shows, the map is the memorial. The panel around it draws it again each 500 ms. */
export function DeathsPanel({ view, onTour }: { view: RaceView; onTour: () => void }) {
  const { graveyard } = view;
  const filter = useStore(graveyard.filter);
  const focus = useStore(graveyard.focus);
  const deaths = graveyard.visible(view.frame);
  return (
    <div class="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto">
      <div class="flex items-center justify-between gap-2">
        <Tabs
          kind="segmented"
          items={[
            { id: "whiteouts", label: `Whiteouts · ${deaths.length}` },
            { id: "all", label: "All ends" },
          ]}
          value={filter}
          onChange={(next) => graveyard.filter.set(next)}
        />
        <Button disabled={graveyard.deaths.length === 0} onClick={onTour}>
          <Clapperboard size={15} />
          Tour
        </Button>
      </div>
      <section class="flex flex-col gap-1">
        <span class={LABEL}>Starters</span>
        {graveyard.starters(view.frame, view.moment).map(({ starter, runs, whiteouts, badges }) => (
          <StarterRow key={starter} src={view.art.iconUrl(starter)} starter={starter} runs={runs} whiteouts={whiteouts} badges={badges} />
        ))}
      </section>
      {deaths.length === 0 && <span class="text-sm text-muted">No whiteout yet at this time of the Race.</span>}
      {[...graveyard.byPlace(view.frame)].map(([place, list]) => (
        <section key={place} class="flex flex-col gap-1">
          <div class="flex items-center justify-between">
            <span class={LABEL}>{place}</span>
            <Pill tone="bad">{list.length}</Pill>
          </div>
          {list.map((death) => (
            <DeathRow key={death.id} death={deathFacts(view, death)} focused={focus === death.id} onFocus={() => graveyard.setFocus(death.id)} onLeave={() => graveyard.setFocus(null)} />
          ))}
        </section>
      ))}
      {filter === "all" && <StoppedRuns view={view} />}
    </div>
  );
}

function isControl(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && (target.matches("input, textarea, select, button, [role=slider]") || target.isContentEditable);
}

/** The Race view starts the Tour; this part shows it, steps it and reads its keys. */
function Tour({ view, onLeave }: { view: RaceView; onLeave: () => void }) {
  useRefresh(TYPE_REFRESH_MS);
  const [paused, setPaused] = useState(false);
  const { graveyard } = view;
  const { index, since } = graveyard.tour;

  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || isControl(event.target)) return;
      const name = event.key.toLowerCase();
      if (name === "n") graveyard.stepTour(1, performance.now());
      else if (name === "p") graveyard.stepTour(-1, performance.now());
      else if (name === " ") setPaused((value) => !value);
      else if (name === "escape") onLeave();
      else return;
      event.preventDefault();
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [graveyard, onLeave]);
  useEffect(() => {
    if (paused) return;
    const id = setTimeout(() => graveyard.stepTour(1, performance.now()), TOUR_STEP_MS);
    return () => clearTimeout(id);
  }, [graveyard, index, paused]);

  const current = graveyard.deaths[index];
  if (!current) return null;
  return (
    <div class="pointer-events-none absolute inset-0 overflow-hidden">
      <div class="absolute inset-x-0 top-0 h-[9%] bg-black" />
      <div class="absolute inset-x-0 bottom-0 h-[9%] bg-black" />
      <div class="absolute top-[11%] right-6 flex items-center gap-3 text-fg">
        <Skull size={44} class="text-bad" />
        <span class="text-[64px] leading-none font-semibold tabular-nums">{index + 1}</span>
        <span class="text-lg text-muted">/ {graveyard.deaths.length}</span>
      </div>
      <div key={current.id} class="absolute bottom-[12%] left-8">
        <Epitaph death={deathFacts(view, current)} typed={(performance.now() - since - TYPE_FROM_MS) / TYPE_MS} />
      </div>
      <span class="absolute bottom-[2.5%] left-1/2 -translate-x-1/2 text-xs text-faint">N next · P previous · Space {paused ? "play" : "pause"} · Esc leave</span>
    </div>
  );
}

export function GraveyardLayer({ view, mode, onLeave }: { view: RaceView; mode: GraveMode; onLeave: () => void }) {
  if (mode === "tour") return <Tour view={view} onLeave={onLeave} />;
  return mode === "off" ? null : <GraveCounter view={view} />;
}
