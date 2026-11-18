import { HeartPulse, type LucideIcon, Skull, Star } from "lucide-preact";
import { useEffect, useState } from "preact/hooks";
import { type GridMon, lineOf, whiteoutKind } from "../src/protocol";
import { Pill, type Tone } from "./components";
import { MonIcon } from "./components-race";
import type { CellLimits, GridCell } from "./grid-cells";
import { HpBar, Name, StatusPill } from "./pokemon";
import { loadArt, type RaceArt } from "./race-art";

const PARTY_SLOTS = 6;

const UNKNOWN_PARTY: Record<GridCell["kind"], string> = { live: "The party shows when the worker reads the game.", replay: "No party: this Run record has no State track (before format 3)." };

// In FireRed, only the starter gives a Pokémon of the 3 starter lines.
function starterMon(party: readonly GridMon[]): GridMon | null {
  return party.find((mon) => lineOf(mon.species) !== null) ?? null;
}

function useIcons(): (species: string) => string | null {
  const [art, setArt] = useState<RaceArt | null>(null);
  useEffect(() => {
    let mounted = true;
    loadArt()
      .then((loaded) => mounted && setArt(loaded))
      .catch(() => {});
    return () => {
      mounted = false;
    };
  }, []);
  return (species) => art?.iconUrl(species) ?? null;
}

export function StarterName({ party }: { party: readonly GridMon[] }) {
  const starter = starterMon(party);
  if (!starter) return null;
  return (
    <span class="flex min-w-0 items-center gap-1" title={`The starter: ${starter.nickname} (${starter.species})`}>
      <Star size={12} class="shrink-0 text-accent" />
      {starter.nickname !== starter.species ? <span class="truncate font-semibold">{starter.nickname}</span> : <span class="text-muted italic">no nickname</span>}
    </span>
  );
}

type WhiteoutLook = { icon: LucideIcon; title: string; text: string; tone: Tone | undefined };

// A Bot with no model has no limits: the Harness never stops it at a whiteout.
export function whiteoutLook(limits: CellLimits | null): WhiteoutLook {
  const whiteouts = limits?.whiteouts ?? 0;
  const form = whiteoutKind(limits?.whiteoutLimit ?? null);
  if (form.kind === "none") return { icon: HeartPulse, title: "After a whiteout, the Run continues.", text: "no whiteout limit", tone: undefined };
  if (form.kind === "first") return { icon: Skull, title: "The first whiteout ends the Run.", text: "whiteout = death", tone: "bad" };
  const left = form.limit - whiteouts;
  return { icon: Skull, title: "The Run ends when the whiteouts reach the limit.", text: `whiteouts ${whiteouts} of ${form.limit}`, tone: left <= 1 ? "bad" : whiteouts > 0 ? "warn" : undefined };
}

export function WhiteoutPill({ look }: { look: WhiteoutLook }) {
  const { icon: Icon, title, text, tone } = look;
  return (
    <span title={title}>
      <Pill tone={tone}>
        <span class="inline-flex items-center gap-1">
          <Icon size={12} />
          {text}
        </span>
      </Pill>
    </span>
  );
}

function PartyRow({ mon, starter, src }: { mon: GridMon; starter: boolean; src: string | null }) {
  const fainted = mon.hp === 0;
  return (
    <span class={`relative flex min-w-0 items-center gap-1.5 rounded-sm px-1 py-0.5 ${starter ? "ring-1 ring-accent/60" : ""} ${fainted ? "opacity-45" : ""}`}>
      {starter && <Star size={10} class="absolute top-0.5 left-0.5 text-accent" />}
      <span class={`flex ${fainted ? "grayscale" : ""}`}>
        <MonIcon src={src} species={mon.species} size="lg" />
      </span>
      <span class="flex min-w-0 flex-1 flex-col gap-0.5">
        <span class="flex items-baseline justify-between gap-1">
          <Name mon={mon} />
          <span class="shrink-0 text-muted">Lv. {mon.level}</span>
        </span>
        <HpBar mon={mon} />
        <span class="flex items-center justify-between gap-1 font-mono text-[10px] leading-3 text-muted tabular-nums">
          <span>
            {mon.hp}/{mon.maxHp}
          </span>
          <StatusPill mon={mon} />
        </span>
      </span>
    </span>
  );
}

export function PartySheet({ party, kind }: { party: readonly GridMon[] | null; kind: GridCell["kind"] }) {
  const icon = useIcons();
  const starter = party && starterMon(party);
  return (
    <div class="grid w-full grid-cols-[repeat(auto-fill,minmax(11rem,1fr))] content-start gap-1 text-xs leading-4 cell-row:flex cell-row:w-56 cell-row:shrink-0 cell-row:flex-col">
      {party ? (
        Array.from({ length: PARTY_SLOTS }, (_, i) => party[i] ?? null).map((mon, i) =>
          mon ? <PartyRow key={i} mon={mon} starter={mon === starter} src={icon(mon.species)} /> : <span key={i} class="h-11 rounded-sm border border-dashed border-line/50" />,
        )
      ) : (
        <span class="col-span-full text-muted">{UNKNOWN_PARTY[kind]}</span>
      )}
    </div>
  );
}
