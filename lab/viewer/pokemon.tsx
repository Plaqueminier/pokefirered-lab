import type { PartyMon, Status } from "../src/party";
import { Bar, Card, ExpBar, HoverCard, hpTone, Num, Pill, StatBar, Tooltip, TypeChip } from "./components";

// The abbreviations of the game.
const STATUS: Record<Exclude<Status, "none">, string> = { sleep: "SLP", poison: "PSN", burn: "BRN", freeze: "FRZ", paralysis: "PAR" };

const STATS = [
  ["attack", "Attack"],
  ["defense", "Defense"],
  ["spAttack", "Sp. Atk"],
  ["spDefense", "Sp. Def"],
  ["speed", "Speed"],
] as const;

/** FNT at 0 HP, as the game shows it. A Pokémon with 0 HP keeps its status. */
function StatusPill({ mon }: { mon: PartyMon }) {
  if (mon.hp === 0) return <Pill tone="bad">FNT</Pill>;
  return mon.status === "none" ? null : <Pill tone="warn">{STATUS[mon.status]}</Pill>;
}

function Name({ mon }: { mon: PartyMon }) {
  return (
    <span class="min-w-0 truncate">
      <span class="font-semibold">{mon.nickname}</span>
      {mon.nickname !== mon.species && <span class="text-muted"> ({mon.species})</span>}
    </span>
  );
}

function Hp({ mon }: { mon: PartyMon }) {
  return (
    <span class="text-muted">
      <Num value={mon.hp} />/{mon.maxHp}
    </span>
  );
}

function hpBar(mon: PartyMon) {
  return <Bar value={mon.hp} max={mon.maxHp} tone={hpTone(mon.maxHp > 0 ? mon.hp / mon.maxHp : 0)} />;
}

/** The compact card of a party Pokémon. A hover opens its summary. */
export function PokemonCard({ mon }: { mon: PartyMon }) {
  return (
    <HoverCard card={<PokemonSummary mon={mon} />}>
      <Card interactive size="sm">
        <div class="flex items-baseline gap-2 text-sm">
          <Name mon={mon} />
          <span class="ml-auto shrink-0 text-xs text-muted">Lv. {mon.level}</span>
        </div>
        <div class="mt-2">{hpBar(mon)}</div>
        <div class="mt-1.5 flex h-5 items-center justify-between text-xs">
          <Hp mon={mon} />
          <StatusPill mon={mon} />
        </div>
        <div class="mt-2 grid grid-cols-4 gap-1">
          {mon.moves.map((move) => (
            <Bar key={move.name} value={move.pp} max={move.maxPp} type={move.type} />
          ))}
        </div>
      </Card>
    </HoverCard>
  );
}

const MOVE_ROW = "grid flex-1 grid-cols-[1fr_64px_32px_36px_44px_40px] items-center gap-2";

/** The summary of a party Pokémon on one card (the hover card H1 of issue #57). */
export function PokemonSummary({ mon }: { mon: PartyMon }) {
  const best = Math.max(...Object.values(mon.stats));
  return (
    <div class="flex w-[400px] flex-col gap-3 text-sm">
      <div class="flex items-center gap-2">
        <Name mon={mon} />
        <span class="shrink-0 text-xs text-muted">Lv. {mon.level}</span>
        <StatusPill mon={mon} />
        <span class="ml-auto flex shrink-0 gap-1">
          {mon.types.map((type) => (
            <TypeChip key={type} type={type} />
          ))}
        </span>
      </div>
      <div>
        <div class="mb-1 flex justify-between text-xs">
          <span class="font-semibold text-muted">HP</span>
          <Hp mon={mon} />
        </div>
        {hpBar(mon)}
      </div>
      <div class="grid grid-cols-2 gap-4">
        <dl class="flex flex-col gap-1.5 text-xs">
          <div>
            <dt class="text-muted">Ability</dt>
            <dd class="font-semibold">{mon.ability.name}</dd>
            <dd class="text-muted">{mon.ability.description}</dd>
          </div>
          <div class="flex justify-between">
            <dt class="text-muted">Nature</dt>
            <dd class="font-semibold">{mon.nature}</dd>
          </div>
          <div class="flex justify-between">
            <dt class="text-muted">Held item</dt>
            <dd class="font-semibold">{mon.heldItem ?? "none"}</dd>
          </div>
        </dl>
        <div class="flex flex-col gap-1">
          {STATS.map(([stat, label]) => (
            <StatBar key={stat} label={label} value={mon.stats[stat]} max={best} />
          ))}
        </div>
      </div>
      <ExpBar level={mon.level} exp={mon.exp} levelExp={mon.levelExp} expToNextLevel={mon.expToNextLevel} />
      <div class="flex flex-col gap-1 text-xs">
        <div class={`${MOVE_ROW} text-faint`}>
          <span>Move</span>
          <span>Type</span>
          <span class="text-right">Pow.</span>
          <span class="text-right">Acc.</span>
          <span>PP</span>
          <span />
        </div>
        {mon.moves.map((move) => (
          <Tooltip key={move.name} text={move.description} wide>
            <div class={`${MOVE_ROW} cursor-default rounded-sm py-0.5 hover:bg-raised`}>
              <span class="truncate font-semibold">{move.name}</span>
              <span>
                <TypeChip type={move.type} />
              </span>
              <span class="text-right">{move.power ?? "—"}</span>
              <span class="text-right">{move.accuracy === null ? "—" : `${move.accuracy}%`}</span>
              <Bar value={move.pp} max={move.maxPp} type={move.type} />
              <span class={`text-right ${move.pp === 0 ? "text-bad" : "text-muted"}`}>
                {move.pp}/{move.maxPp}
              </span>
            </div>
          </Tooltip>
        ))}
      </div>
    </div>
  );
}
