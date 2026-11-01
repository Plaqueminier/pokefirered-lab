import { readdir, rename } from "node:fs/promises";
import { join } from "node:path";
import { withoutFormat } from "./game-events";
import { RunPool } from "./pool";
import { hasStateEvents, isCurrentRecord, isRunRecord, RECORD_FORMAT, RecordPlayer, type Replay, RUNS_DIR, type RunEvent, type RunRecord, withStateEvents } from "./record";

type Migrated = { name: string; error: string | null };

// A Milestone that the Harness got later is not in an old record: only the maps and the battles tell that the replay walks the same way.
function mapsAndBattles(events: readonly RunEvent[]): RunEvent[] {
  return withoutFormat(events).filter((event) => event.type === "map" || event.type === "battle");
}

function refusal(record: RunRecord, replayed: Replay): string | null {
  const last = new RecordPlayer(record).frames;
  if (replayed.frame !== last) return `the replay ends on frame ${replayed.frame}, not on the last frame of the buttons (${last})`;
  return Bun.deepEquals(mapsAndBattles(replayed.events), mapsAndBattles(record.events)) ? null : "the replay does not give the maps and the battles of the record";
}

async function migrateRecord(path: string, record: RunRecord, pool: RunPool): Promise<string | null> {
  const replayed = await pool.replayToEnd({ ...record, events: [] });
  const refused = refusal(record, replayed);
  if (refused) return refused;
  const events = hasStateEvents(record) ? record.events : withStateEvents(record.events, replayed.events);
  await Bun.write(`${path}.tmp`, JSON.stringify({ ...record, format: RECORD_FORMAT, events, track: replayed.track, state: replayed.state }));
  await rename(`${path}.tmp`, path);
  return null;
}

export async function migrate(dir = RUNS_DIR, onDone?: (done: Migrated) => void): Promise<Migrated[]> {
  const left = (await readdir(dir)).filter((name) => name.endsWith(".json")).sort();
  const pool = new RunPool();
  const results: Migrated[] = [];
  const worker = async () => {
    for (let name = left.shift(); name !== undefined; name = left.shift()) {
      const path = join(dir, name);
      const record: unknown = await Bun.file(path).json().catch(() => null);
      if (!isRunRecord(record) || isCurrentRecord(record)) continue;
      const done = { name, error: await migrateRecord(path, record, pool).catch((failure) => String(failure)) };
      results.push(done);
      onDone?.(done);
    }
  };
  await Promise.all(Array.from({ length: pool.free }, worker));
  return results.sort((a, b) => a.name.localeCompare(b.name));
}

if (import.meta.main) {
  const report = await migrate(RUNS_DIR, ({ name, error }) => console.log(error === null ? `${name}: migrated` : `${name}: REFUSED, ${error}`));
  const refused = report.filter(({ error }) => error !== null).length;
  console.log(`${report.length - refused} records migrated, ${refused} refused`);
  process.exit(refused > 0 ? 1 : 0);
}
