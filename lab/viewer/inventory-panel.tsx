import { Backpack, History, Monitor } from "lucide-preact";
import type { ComponentChildren } from "preact";
import { useMemo, useRef, useState } from "preact/hooks";
import { POCKET_NAMES, type PocketName } from "../src/bag";
import { changes, type Delta, type Inventory, type InventoryAt, type Place } from "../src/inventory";
import { blurClickedButton, Button, Card, LABEL, ListRow, Pill, useKeepInView } from "./components";
import { signed } from "./runs";
import { clock } from "./stats-format";

type Choice = Place | "changes";
type Item = { name: string; quantity: number; description?: string };
type Entry = InventoryAt & { at: number; deltas: Delta[] };

const POCKETS: Record<PocketName, string> = { ITEMS: "Items", "KEY ITEMS": "Key items", "POKé BALLS": "Poké Balls", "TM CASE": "TM Case", "BERRY POUCH": "Berries" };

function pocketItems({ bag }: Inventory, pocket: PocketName): Item[] {
  return bag.find((p) => p.pocket === pocket)?.items ?? [];
}

const SUFFIXES: Partial<Record<Place, string>> = { "pc-items": " (PC)", "pc-pokemon": " (box)" };

function firstPocket(inventory: Inventory): Choice {
  return POCKET_NAMES.find((pocket) => pocketItems(inventory, pocket).length > 0) ?? "ITEMS";
}

function Empty({ children }: { children: ComponentChildren }) {
  return <p class="text-sm text-muted">{children}</p>;
}

export type InventoryPanelProps = { history: readonly InventoryAt[]; cursor: number | null; playing: number; now: () => void; pick: (frame: number) => void };

export function InventoryPanel({ history, cursor, playing, now, pick }: InventoryPanelProps) {
  const entries = useMemo(() => history.map((entry, at) => ({ ...entry, at, deltas: at === 0 ? [] : changes(history[at - 1].inventory, entry.inventory) })), [history]);
  const index = history.findLastIndex((entry) => entry.frame <= (cursor ?? playing));
  const entry = entries[index];
  const [choice, setChoice] = useState<Choice | null>(null);
  // At the first view of a Run, the first pocket that is not empty; a new history is another Run.
  const [first, setFirst] = useState<{ start: InventoryAt; choice: Choice } | null>(null);
  if (entry && first?.start !== history[0]) setFirst({ start: history[0], choice: firstPocket(entry.inventory) });
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions lint/a11y/useKeyWithClickEvents: the panel only takes the focus from a clicked button, so Enter goes to the game.
    <div class="@container flex h-full min-h-0 flex-col gap-3" onClick={blurClickedButton}>
      <div class="flex h-8 shrink-0 items-center gap-2.5 text-sm">
        <Pill tone={cursor === null ? "ok" : "accent"}>{cursor === null ? "Now" : `At cursor ${clock(cursor)}`}</Pill>
        <span class="text-muted">{index > 0 ? `last change at ${clock(entry.frame)}` : entry ? "no change yet" : "no change read yet"}</span>
        {cursor !== null && (
          <Button size="sm" variant="ghost" onClick={now}>
            Now
          </Button>
        )}
      </div>
      {entry ? (
        <Contents entries={entries} index={index} shown={choice ?? first?.choice ?? firstPocket(entry.inventory)} choose={setChoice} pick={pick} />
      ) : (
        <Empty>No Bag and PC read at this time.</Empty>
      )}
    </div>
  );
}

type ContentsProps = { entries: readonly Entry[]; index: number; shown: Choice; choose: (choice: Choice) => void; pick: (frame: number) => void };

function Contents({ entries, index, shown, choose, pick }: ContentsProps) {
  const { inventory, deltas } = entries[index];
  const list = useRef<HTMLDivElement>(null);
  useKeepInView(list, `${shown} ${index} ${entries.length}`, "third");
  const row = (id: Choice, label: string, count: number) => (
    <ListRow
      key={id}
      text={label}
      mark={deltas.some((delta) => delta.place === id)}
      icons={<span class="text-faint tabular-nums">{count}</span>}
      selected={id === shown}
      onClick={() => choose(id)}
    />
  );
  return (
    <Card fill>
      <div class="grid min-h-0 flex-1 grid-cols-[180px_1fr] gap-4">
        <div class="flex min-h-0 flex-col gap-0.5 overflow-y-auto border-r border-line pr-3">
          <Group icon={<Backpack size={14} />} title="Bag" first />
          {POCKET_NAMES.map((pocket) => row(pocket, POCKETS[pocket], pocketItems(inventory, pocket).length))}
          <Group icon={<Monitor size={14} />} title="PC" />
          {row("pc-items", "PC items", inventory.pc.items.length)}
          {row("pc-pokemon", "PC Pokémon", inventory.pc.pokemon.length)}
          <Group icon={<History size={14} />} title="History" />
          {row("changes", "Changes", entries.length - 1)}
        </div>
        <div ref={list} class="min-h-0 overflow-y-auto pr-1">
          {shown === "changes" ? (
            <Changes entries={entries} index={index} pick={pick} />
          ) : shown === "pc-pokemon" ? (
            <Species names={inventory.pc.pokemon} />
          ) : (
            <Items
              items={shown === "pc-items" ? inventory.pc.items : pocketItems(inventory, shown)}
              changes={new Map(deltas.filter(({ place }) => place === shown).map(({ name, change }) => [name, change]))}
              empty={shown === "pc-items" ? "No item in the PC" : "Empty pocket"}
            />
          )}
        </div>
      </div>
    </Card>
  );
}

function Group({ icon, title, first }: { icon: ComponentChildren; title: string; first?: boolean }) {
  return (
    <span class={`${LABEL} ${first ? "" : "mt-3"} mb-1 flex items-center gap-2`}>
      {icon} {title}
    </span>
  );
}

function Items({ items, changes, empty }: { items: readonly Item[]; changes: ReadonlyMap<string, number>; empty: string }) {
  if (items.length === 0) return <Empty>{empty}</Empty>;
  return (
    <div class="flex flex-col divide-y divide-line">
      {items.map((item) => {
        const change = changes.get(item.name);
        return (
          <div key={item.name} class="flex flex-col gap-0.5 py-1.5">
            <div class="flex items-baseline gap-2 text-sm">
              <span class="min-w-0 truncate font-mono">{item.name}</span>
              <span class="ml-auto flex shrink-0 items-center gap-2 text-muted tabular-nums">
                {change !== undefined && <Pill tone={change > 0 ? "ok" : "bad"}>{signed(change)}</Pill>}×{item.quantity}
              </span>
            </div>
            {item.description && <p class="text-xs text-muted">{item.description}</p>}
          </div>
        );
      })}
    </div>
  );
}

function Species({ names }: { names: readonly string[] }) {
  if (names.length === 0) return <Empty>No Pokémon in the boxes</Empty>;
  const counted = new Map<string, number>();
  for (const name of names) counted.set(name, (counted.get(name) ?? 0) + 1);
  return (
    <div class="flex flex-wrap gap-1.5">
      {[...counted].map(([name, count]) => (
        <Pill key={name}>
          {name}
          {count > 1 && <span class="text-muted"> ×{count}</span>}
        </Pill>
      ))}
    </div>
  );
}

function Changes({ entries, index, pick }: { entries: readonly Entry[]; index: number; pick: (frame: number) => void }) {
  if (entries.length < 2) return <Empty>No change yet</Empty>;
  return (
    <div class="flex flex-col gap-0.5">
      {entries
        .slice(1)
        .reverse()
        .map(({ frame, at, deltas }) => (
          <ListRow
            key={frame}
            cells={[{ text: clock(frame), chars: 8 }]}
            text={
              <span class="flex gap-1.5">
                {deltas.map(({ place, name, change }) => (
                  <Pill key={place + name} tone={change > 0 ? "ok" : "bad"}>
                    {signed(change)} {name}
                    {SUFFIXES[place]}
                  </Pill>
                ))}
              </span>
            }
            selected={at === index}
            faded={at > index}
            onClick={() => pick(frame)}
          />
        ))}
    </div>
  );
}
