import type { ComponentChildren } from "preact";
import { type BattleSide, runIdText } from "../src/protocol";
import { Pill, StatTile } from "./components";
import { ModelName, MonIcon } from "./components-race";
import { HpBar, Name, StatusPill } from "./pokemon";
import type { GhostNow } from "./race-ghosts";
import { RESULT_LOOK } from "./race-marks";
import type { RaceView } from "./race-view";
import { money } from "./runs";

const GROUP_CARD_RUNS = 24;

type GhostLook = Pick<GhostNow, "result" | "battle">;

function ghostStatus({ result, battle }: GhostLook) {
  if (result) return { ...RESULT_LOOK[result], text: result };
  return battle ? ({ icon: null, tone: "info", text: "in battle" } as const) : ({ icon: null, tone: "ok", text: "plays" } as const);
}

export function GhostState({ ghost }: { ghost: GhostLook }) {
  const { icon: Icon, tone, text } = ghostStatus(ghost);
  return (
    <Pill tone={tone}>
      <span class="inline-flex items-center gap-1">
        {Icon && <Icon size={12} />}
        {text}
      </span>
    </Pill>
  );
}

export function GhostFace({ view, number, size }: { view: RaceView; number: number; size: string }) {
  return <img src={view.art.faceUrl(number)} alt="" class={`${size} [image-rendering:pixelated]`} />;
}

export function TeamIcons({ view, ghost }: { view: RaceView; ghost: GhostNow }) {
  return ghost.team.map((mon, i) => <MonIcon key={i} src={view.art.iconUrl(mon.species)} species={mon.species} level={mon.level} />);
}

function MonLine({ view, mon, side }: { view: RaceView; mon: BattleSide & { moves?: readonly string[] }; side?: string }) {
  return (
    <div class="flex items-center gap-2 text-xs">
      <MonIcon src={view.art.iconUrl(mon.species)} species={mon.species} />
      <div class="flex min-w-0 flex-1 flex-col gap-0.5">
        <div class="flex items-center gap-2">
          <span class="min-w-0 truncate">
            {side && <span class="text-faint">{side} </span>}
            <Name mon={mon} />
          </span>
          <span class="ml-auto shrink-0 text-muted">Lv. {mon.level}</span>
          <StatusPill mon={mon} />
        </div>
        <HpBar mon={mon} />
        {mon.moves && <span class="text-faint">{mon.moves.join(" · ")}</span>}
      </div>
    </div>
  );
}

function BattleLines({ view, ghost }: { view: RaceView; ghost: GhostNow }) {
  const { battle } = ghost;
  if (!battle) return null;
  return (
    <div class="flex flex-col gap-1.5 border-b border-line pb-2">
      <span class="truncate text-xs font-semibold">{battle.trainer ?? "wild"}</span>
      {battle.player && <MonLine view={view} side="You" mon={battle.player} />}
      {battle.foe && <MonLine view={view} side="Foe" mon={battle.foe} />}
    </div>
  );
}

export function GhostStatsRow({ ghost }: { ghost: GhostNow }) {
  const { battles, trainers, faints, money: amount, calls } = ghost.stats;
  return (
    <div class="grid grid-cols-3 gap-2 border-t border-line pt-2">
      <StatTile size="sm" label="Battles" value={battles} />
      <StatTile size="sm" label="Trainers beaten" value={trainers} />
      <StatTile size="sm" label="Faints" value={faints} />
      <StatTile size="sm" label="Money" value={amount === null ? "–" : money(amount)} />
      <StatTile size="sm" label="Model calls" value={calls} />
    </div>
  );
}

export function GhostCard({ view, ghost, children }: { view: RaceView; ghost: GhostNow; children?: ComponentChildren }) {
  return (
    <div class="flex w-[320px] flex-col gap-2">
      <div class="flex items-center gap-2">
        <GhostFace view={view} number={ghost.number} size="h-6 w-4" />
        <span class="font-mono text-sm font-semibold">{runIdText(ghost.number)}</span>
        <span class="ml-auto">
          <GhostState ghost={ghost} />
        </span>
      </div>
      <ModelName id={ghost.model} bot={ghost.bot} coach={ghost.coach} />
      <span class="text-xs">{ghost.character}</span>
      <span class="truncate text-xs text-muted">{view.titleOf(ghost.map)}</span>
      <BattleLines view={view} ghost={ghost} />
      {ghost.team.length === 0 ? <span class="text-xs text-muted">No Pokémon yet</span> : ghost.team.map((mon, i) => <MonLine key={i} view={view} mon={mon} />)}
      {children}
    </div>
  );
}

function GroupCard({ view, ghosts }: { view: RaceView; ghosts: readonly GhostNow[] }) {
  const sorted = [...ghosts].sort((a, b) => a.number - b.number);
  return (
    <div class="flex w-[220px] flex-col gap-1">
      <span class="text-sm font-semibold">{ghosts.length} Ghosts</span>
      {sorted.slice(0, GROUP_CARD_RUNS).map((ghost) => (
        <div key={ghost.run} class="flex h-6 items-center gap-1.5">
          <span class="w-[5ch] shrink-0 font-mono text-xs text-muted">{runIdText(ghost.number)}</span>
          <TeamIcons view={view} ghost={ghost} />
        </div>
      ))}
      {sorted.length > GROUP_CARD_RUNS && <span class="text-xs text-muted">…</span>}
    </div>
  );
}

export function GhostsCard({ view, ghosts }: { view: RaceView; ghosts: readonly GhostNow[] }) {
  return ghosts.length === 1 ? <GhostCard view={view} ghost={ghosts[0]} /> : <GroupCard view={view} ghosts={ghosts} />;
}
