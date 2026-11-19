import { Bot } from "lucide-preact";
import type { ComponentChildren } from "preact";
import { botVersion, dotOf, type RaceKiller, shortModelId } from "../src/race/file";
import { Pill, rowButton } from "./components";
import type { OtherEnd } from "./race-deaths";
import { RESULT_LOOK, type ResultLook } from "./race-marks";
import { Name } from "./pokemon";

const ICON_SIZES = { sm: "size-6", lg: "size-10" } as const;

export function MonIcon({ src, species, level, size = "sm" }: { src: string | null; species: string; level?: number; size?: keyof typeof ICON_SIZES }) {
  return (
    <span class={`relative inline-block shrink-0 ${ICON_SIZES[size]}`} title={species}>
      {src && <img src={src} alt={species} class={`${ICON_SIZES[size]} [image-rendering:pixelated]`} />}
      {level !== undefined && <span class="absolute right-0 bottom-0 rounded-sm bg-bg/85 px-0.5 font-mono text-[10px] leading-none text-fg tabular-nums">{level}</span>}
    </span>
  );
}

export function ModelName({ id, bot = "", coach, short }: { id: string; bot?: string; coach?: string; short?: boolean }) {
  const family = dotOf({ bot, model: id });
  const name = (model: string) => (short ? shortModelId(model) : model);
  const text = family === "genetic" ? `Genetic bot ${botVersion(bot)}` : coach ? `${name(id)} + coach ${name(coach)}` : name(id);
  if (!text) return null;
  return (
    <span class="flex min-w-0 items-center gap-1.5 text-xs text-muted">
      {family && <span class="size-2 shrink-0 rounded-full border border-black" style={{ backgroundColor: `var(--color-model-${family})` }} />}
      <span class="truncate">{text}</span>
    </span>
  );
}

export const LEADERBOARD_ROW_HEIGHT = 60;

export function LeaderboardRow({
  rank,
  face,
  id,
  team,
  badges,
  cost,
  state,
  model,
  bot,
  coach,
  faded,
  selected,
  onClick,
}: {
  rank: number;
  face: ComponentChildren;
  id: string;
  team: ComponentChildren;
  badges: ComponentChildren;
  cost: string;
  state: ComponentChildren;
  model: string;
  bot?: string;
  coach?: string;
  faded?: boolean;
  selected?: boolean;
  onClick: () => void;
}) {
  return (
    <button type="button" aria-pressed={selected} onClick={onClick} style={{ height: `${LEADERBOARD_ROW_HEIGHT}px` }} class={`w-full ${rowButton(selected, faded)}`}>
      <span class="w-[3ch] shrink-0 text-right font-semibold tabular-nums">{rank}</span>
      <span class="shrink-0">{face}</span>
      <span class="flex min-w-0 flex-1 flex-col gap-1">
        <span class="flex items-center gap-2">
          <span class="shrink-0 font-mono font-semibold">{id}</span>
          <span class="min-w-0 flex-1">
            <ModelName id={model} bot={bot} coach={coach} short />
          </span>
          <span class="w-[128px] shrink-0">{state}</span>
          <span class="w-[9ch] shrink-0 whitespace-nowrap text-right text-muted tabular-nums">{cost}</span>
        </span>
        <span class="flex h-6 items-center justify-between gap-2">
          <span class="flex min-w-0 items-center gap-0.5">{team}</span>
          {badges}
        </span>
      </span>
    </button>
  );
}

type IconOf = (species: string) => string | null;

type DeadMon = { species: string; nickname: string; level: number };

export type GraveCause = { kind: "whiteout"; endedRun: boolean; killer: RaceKiller | null } | { kind: "end"; result: OtherEnd };

/** `face`: the sprite of the Ghost. `lead`: the starter of the Run, or its evolution. */
export type GraveFacts = {
  face: ComponentChildren;
  icon: IconOf;
  run: string;
  cause: GraveCause;
  lead: DeadMon | undefined;
  epitaph: string;
  team: readonly DeadMon[];
  model: string;
  coach?: string;
  character: string;
  place: string;
  time: string;
};

function foeName({ trainer, species }: RaceKiller): string {
  return trainer ? `${trainer}'s ${species}` : `a wild ${species}`;
}

export function causeLook(cause: GraveCause): ResultLook & { label: string } {
  if (cause.kind === "end") return { ...RESULT_LOOK[cause.result], label: cause.result };
  return { ...RESULT_LOOK.whiteout, label: cause.endedRun ? "whiteout" : "whiteout, played on" };
}

function causeLine(cause: GraveCause): string | null {
  if (cause.kind === "end") return cause.result;
  const { killer } = cause;
  if (!killer) return null;
  return killer.poison ? `poison, after ${foeName(killer)}` : foeName(killer);
}

function CausePill({ cause }: { cause: GraveCause }) {
  const { icon: Icon, tone, label } = causeLook(cause);
  return (
    <Pill tone={tone}>
      <span class="inline-flex items-center gap-1">
        <Icon size={12} />
        {label}
      </span>
    </Pill>
  );
}

function KillerLine({ killer, icon }: { killer: RaceKiller | null; icon: IconOf }) {
  if (!killer) return <span class="text-xs text-muted">No foe before the whiteout</span>;
  return (
    <span class="flex min-w-0 items-center gap-1.5 text-xs">
      <span class="shrink-0 text-muted">Killed by</span>
      {killer.poison ? (
        <>
          <Pill tone="warn">PSN</Pill>
          <span class="truncate text-muted">after {foeName(killer)}</span>
        </>
      ) : (
        <>
          <MonIcon src={icon(killer.species)} species={killer.species} level={killer.level} />
          <span class="truncate font-semibold">{foeName(killer)}</span>
        </>
      )}
    </span>
  );
}

/** `typed`: the share of the text that shows, from 0 to 1. */
function LastWords({ text, size = "sm", typed = 1 }: { text: string; size?: "sm" | "lg"; typed?: number }) {
  if (!text) return null;
  const done = typed >= 1;
  return (
    <span class={`flex gap-1.5 ${size === "lg" ? "text-2xl leading-snug" : "text-xs"}`}>
      <Bot size={size === "lg" ? 24 : 14} class="mt-0.5 shrink-0 text-muted" />
      <span>
        “{done ? text : text.slice(0, Math.round(text.length * Math.max(0, typed)))}
        {done && "”"}
      </span>
    </span>
  );
}

export function DeathCard({ death }: { death: GraveFacts }) {
  const { lead, icon } = death;
  return (
    <div class="flex w-[320px] flex-col gap-2">
      <div class="flex items-center gap-2">
        {death.face}
        <span class="font-mono text-sm font-semibold">{death.run}</span>
        <span class="ml-auto">
          <CausePill cause={death.cause} />
        </span>
      </div>
      {lead && (
        <div class="flex items-center gap-2">
          <MonIcon src={icon(lead.species)} species={lead.species} level={lead.level} />
          <Name mon={lead} />
        </div>
      )}
      {death.cause.kind === "whiteout" && <KillerLine killer={death.cause.killer} icon={icon} />}
      <LastWords text={death.epitaph} />
      <div class="flex flex-wrap gap-1">
        {death.team.map((mon, i) => (
          <MonIcon key={i} src={icon(mon.species)} species={mon.species} level={mon.level} />
        ))}
      </div>
      <ModelName id={death.model} coach={death.coach} />
      <span class="text-xs">{death.character}</span>
      <span class="text-xs text-muted">
        {death.place} · <span class="font-mono">{death.time}</span>
      </span>
    </div>
  );
}

/** `onFocus` and `onLeave`: the pointer or the keyboard focus comes to the row, or goes from it. */
export function DeathRow({ death, focused, onFocus, onLeave }: { death: GraveFacts; focused: boolean; onFocus: () => void; onLeave: () => void }) {
  const { lead } = death;
  return (
    <button type="button" aria-pressed={focused} onPointerEnter={onFocus} onFocus={onFocus} onPointerLeave={onLeave} onBlur={onLeave} class={`w-full !flex-col !items-stretch gap-0.5 py-1.5 ${rowButton(focused)}`}>
      <span class="flex items-center gap-2">
        {death.face}
        {lead ? <Name mon={lead} /> : <span class="text-muted">No Pokémon</span>}
        {lead && <span class="shrink-0 text-muted">Lv. {lead.level}</span>}
        <span class="ml-auto shrink-0 font-mono text-muted">{death.run}</span>
      </span>
      {death.epitaph && <span class="truncate pl-6 text-muted">“{death.epitaph}”</span>}
    </button>
  );
}

export function Epitaph({ death, typed }: { death: GraveFacts; typed?: number }) {
  const { lead, cause, icon } = death;
  const src = lead && icon(lead.species);
  return (
    <div class="flex w-[640px] max-w-full flex-col gap-3 text-fg [text-shadow:0_2px_8px_rgb(0_0_0/0.9)]">
      <span class="text-lg text-muted">Here lies</span>
      <div class="flex items-end gap-4">
        {src && <img src={src} alt="" class="size-20 shrink-0 [image-rendering:pixelated]" />}
        <div class="flex min-w-0 flex-col gap-2">
          <span class="truncate text-[56px] leading-none font-semibold">{lead?.nickname ?? death.run}</span>
          <span class="text-xl text-muted">
            {[lead && `${lead.species} Lv. ${lead.level}`, causeLine(cause)].filter(Boolean).join(" · ")}
          </span>
        </div>
      </div>
      <LastWords text={death.epitaph} size="lg" typed={typed} />
      <span class="flex items-center gap-2 text-sm text-muted">
        <ModelName id={death.model} coach={death.coach} /> · {death.place} · <span class="font-mono">{death.time}</span>
      </span>
    </div>
  );
}

/** `badges`: for each badge, the number of Runs of this starter that got it. */
export function StarterRow({ src, starter, runs, whiteouts, badges }: { src: string | null; starter: string; runs: number; whiteouts: number; badges: readonly { badge: number; runs: number }[] }) {
  return (
    <div class="flex h-9 items-center gap-2">
      <MonIcon src={src} species={starter} />
      <span class="w-28 text-sm font-semibold">{starter}</span>
      <span class="text-xs text-muted">
        {runs} Runs · {whiteouts} whiteouts
      </span>
      <span class="ml-auto flex gap-1">
        {badges.map(({ badge, runs: got }) => (
          <Pill key={badge} tone={got === 0 ? "bad" : undefined}>
            badge {badge} · {got}
          </Pill>
        ))}
      </span>
    </div>
  );
}
