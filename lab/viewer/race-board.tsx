import { useState } from "preact/hooks";
import { runIdText } from "../src/protocol";
import { Badges, useHeight } from "./components";
import { PointerCard } from "./components-layers";
import { LEADERBOARD_ROW_HEIGHT, LeaderboardRow } from "./components-race";
import { useStore } from "./cursor";
import { GhostCard, GhostFace, GhostState, GhostStatsRow, TeamIcons } from "./race-cards";
import type { GhostNow } from "./race-ghosts";
import type { RaceView } from "./race-view";

const EXTRA_ROWS = 4;

function Row({ view, ghost, rank, selected }: { view: RaceView; ghost: GhostNow; rank: number; selected: boolean }) {
  return (
    <LeaderboardRow
      rank={rank + 1}
      face={<GhostFace view={view} number={ghost.number} size="h-9 w-6" />}
      id={runIdText(ghost.number)}
      team={<TeamIcons view={view} ghost={ghost} />}
      badges={<Badges got={ghost.stats.badges} />}
      cost={`${ghost.stats.cost.toFixed(2)} $`}
      state={<GhostState ghost={ghost} />}
      faded={ghost.result !== null}
      selected={selected}
      onClick={() => view.followGhost(ghost.run)}
    />
  );
}

export function Leaderboard({ view }: { view: RaceView }) {
  const [list, height] = useHeight();
  const [scroll, setScroll] = useState(0);
  const [pointer, setPointer] = useState<{ x: number; y: number } | null>(null);
  const selected = useStore(view.selected);
  const { ranking } = view.moment;
  const first = Math.max(0, Math.floor(scroll / LEADERBOARD_ROW_HEIGHT) - EXTRA_ROWS);
  const end = Math.min(ranking.length, Math.ceil((scroll + height) / LEADERBOARD_ROW_HEIGHT) + EXTRA_ROWS);
  const top = list.current?.getBoundingClientRect().top ?? 0;
  const hovered = pointer && ranking[Math.floor((pointer.y - top + scroll) / LEADERBOARD_ROW_HEIGHT)];
  return (
    <div ref={list} class="min-h-0 flex-1 overflow-y-auto" onScroll={(event) => setScroll(event.currentTarget.scrollTop)} onPointerMove={(event) => setPointer({ x: event.clientX, y: event.clientY })} onPointerLeave={() => setPointer(null)}>
      <div class="relative" style={{ height: `${ranking.length * LEADERBOARD_ROW_HEIGHT}px` }}>
        {ranking.slice(first, end).map((ghost, i) => (
          <div key={ghost.run} class="absolute inset-x-0" style={{ top: `${(first + i) * LEADERBOARD_ROW_HEIGHT}px` }}>
            <Row view={view} ghost={ghost} rank={first + i} selected={ghost.run === selected} />
          </div>
        ))}
      </div>
      <PointerCard at={hovered ? pointer : null} glass>
        {hovered && (
          <GhostCard view={view} ghost={hovered}>
            <GhostStatsRow ghost={hovered} />
          </GhostCard>
        )}
      </PointerCard>
    </div>
  );
}
