import type { ComponentChildren } from "preact";
import { rowButton } from "./components";

export function MonIcon({ src, species, level }: { src: string | null; species: string; level?: number }) {
  return (
    <span class="relative inline-block size-6 shrink-0" title={species}>
      {src && <img src={src} alt={species} class="size-6 [image-rendering:pixelated]" />}
      {level !== undefined && <span class="absolute right-0 bottom-0 rounded-sm bg-bg/85 px-0.5 font-mono text-[10px] leading-none text-fg tabular-nums">{level}</span>}
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
          <span class="font-mono font-semibold">{id}</span>
          {state}
          <span class="ml-auto text-muted tabular-nums">{cost}</span>
        </span>
        <span class="flex h-6 items-center justify-between gap-2">
          <span class="flex min-w-0 items-center gap-0.5">{team}</span>
          {badges}
        </span>
      </span>
    </button>
  );
}
