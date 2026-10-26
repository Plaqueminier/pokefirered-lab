import { mapNamed } from "../harness/atlas";
import type { Observation } from "../harness/harness";
import { callTurns, type RunEvent } from "../harness/record";
import type { PartyMon } from "../party";
import { personName } from "./targets";

export function importantEvents(before: Observation | null, now: Observation, events: readonly RunEvent[]): string[] {
  const start = events.findLastIndex((e) => e.type === "model") + 1;
  if (start === 0) return [];
  const recent = events.slice(start);
  const known = new Set(events.slice(0, start).flatMap((e) => (e.type === "map" ? [e.map] : [])));
  const impossible = impossibleInARow(events);
  return [
    ...new Set(recent.flatMap((e) => (e.type === "map" && !known.has(e.map) ? [`you entered the map ${e.map} for the first time`] : []))),
    ...(textsOf(recent).some((t) => /whited out/i.test(t)) ? ["you lost a battle"] : []),
    ...(before && healed(before, now, recent) ? [healFact(now)] : []),
    ...(before ? newItems(before, now).map((item) => `you got ${item}`) : []),
    ...(impossible >= 2 ? [`your last ${impossible} actions were impossible: they changed nothing in the game`] : []),
  ];
}

function textsOf(events: readonly RunEvent[]): string[] {
  return events.flatMap((e) => (e.type === "action" && "text" in e.result ? e.result.text : []));
}

function healed(before: Observation, now: Observation, recent: readonly RunEvent[]): boolean {
  const full = (party: PartyMon[]) => party.every((mon) => mon.hp === mon.maxHp);
  const sameParty = before.party.length > 0 && before.party.map((mon) => mon.species).join() === now.party.map((mon) => mon.species).join();
  return sameParty && !full(before.party) && full(now.party) && !recent.some((e) => e.type === "battle" || (e.type === "action" && e.action.name === "use"));
}

function healFact(now: Observation): string {
  if (now.mode !== "overworld") return "your party was healed";
  const { lastTalk } = now.atlas;
  const person = lastTalk && mapNamed(now.atlas, lastTalk.map).people.find((p) => p.localId === lastTalk.localId);
  return `your party was healed on ${now.map.name}${person ? `, after you talked to ${personName(person)}` : ""}`;
}

function newItems(before: Observation, now: Observation): string[] {
  const names = (o: Observation) => o.bag.flatMap((pocket) => pocket.items.map((item) => item.name));
  const had = new Set(names(before));
  return names(now).filter((name) => !had.has(name));
}

function impossibleInARow(events: readonly RunEvent[]): number {
  let count = 0;
  for (const turn of callTurns(events).toReversed()) {
    const actions = turn.events.filter((e) => e.type === "action");
    if (actions.length === 0) continue;
    if (!actions.every((a) => a.result.status === "impossible")) break;
    count++;
  }
  return count;
}
