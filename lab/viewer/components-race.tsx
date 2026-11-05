import type { ComponentChildren } from "preact";
import { rowButton } from "./components";
import { modelFamily, shortModelId } from "./race-ghosts";

export function MonIcon({ src, species, level }: { src: string | null; species: string; level?: number }) {
  return (
    <span class="relative inline-block size-6 shrink-0" title={species}>
      {src && <img src={src} alt={species} class="size-6 [image-rendering:pixelated]" />}
      {level !== undefined && <span class="absolute right-0 bottom-0 rounded-sm bg-bg/85 px-0.5 font-mono text-[10px] leading-none text-fg tabular-nums">{level}</span>}
    </span>
  );
}

export function ModelName({ id, short }: { id: string; short?: boolean }) {
  if (!id) return null;
  const family = modelFamily(id);
  return (
    <span class="flex min-w-0 items-center gap-1.5 text-xs text-muted">
      {family && <span class="size-2 shrink-0 rounded-full border border-black" style={{ backgroundColor: `var(--color-model-${family})` }} />}
      <span class="truncate">{short ? shortModelId(id) : id}</span>
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
            <ModelName id={model} short />
          </span>
          <span class="shrink-0">{state}</span>
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
