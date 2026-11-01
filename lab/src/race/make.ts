import { mkdir, readdir, rename, stat } from "node:fs/promises";
import { join } from "node:path";
import { RecordPlayer, readRecord, RUNS_DIR, type RunEvent, type RunRecord } from "../harness/record";
import { encodeTrack, RACE_VERSION, type RaceBattle, type RaceFile, type RaceRun } from "./file";

export const RACES_DIR = join(import.meta.dir, "..", "..", "races");

export const RACE_SUFFIX = ".json.gz";

const MODEL_BOT = "model";

function battlesOf(events: readonly RunEvent[], lastFrame: number): RaceBattle[] {
  const battles: RaceBattle[] = [];
  let open: { start: number; trainer: boolean | null } | null = null;
  for (const event of events) {
    if (event.type !== "battle") continue;
    if (event.state === "start") open = { start: event.frame, trainer: event.trainer ?? null };
    else if (open) {
      battles.push([open.start, event.frame, open.trainer]);
      open = null;
    }
  }
  return open ? [...battles, [open.start, lastFrame, open.trainer]] : battles;
}

function raceRun(number: number, name: string, record: RunRecord): RaceRun {
  if (record.track === undefined) throw new Error(`${name} has no track: run "bun run migrate" first`);
  const { events, header } = record;
  const lastFrame = new RecordPlayer(record).frames;
  return {
    number,
    record: name,
    bot: `${header.bot.name} ${header.bot.version}`,
    model: header.bot.model?.id ?? "",
    track: encodeTrack(record.track),
    battles: battlesOf(events, lastFrame),
    trainers: events.flatMap((e) => (e.type === "trainer" ? [[e.frame, e.trainer] as [number, string]] : [])),
    milestones: events.flatMap((e) => (e.type === "milestone" ? [[e.frame, e.milestone] as [number, string]] : [])),
    end: { frame: lastFrame, result: record.result.endReason },
  };
}

function dateOf(name: string): string {
  return /\d{4}-\d{2}-\d{2}T[\d.-]+Z\.json$/.exec(name)?.[0] ?? name;
}

function findRecord(names: readonly string[], wanted: string): string {
  if (names.includes(wanted)) return wanted;
  const found = names.filter((name) => name.startsWith(wanted));
  if (found.length === 0) throw new Error(`no Run record has the name "${wanted}"`);
  if (found.length > 1) throw new Error(`${found.length} Run records start with "${wanted}"`);
  return found[0];
}

// A Continued Run replays the whole play of its parent, so the parent as a Ghost would count the same play twice.
function continuedBy(chosen: readonly string[], records: ReadonlyMap<string, RunRecord>): Set<string> {
  const continued = new Set<string>();
  for (const name of chosen) {
    let parent = records.get(name)?.header.parent;
    while (parent !== undefined && !continued.has(parent)) {
      continued.add(parent);
      parent = records.get(parent)?.header.parent;
    }
  }
  return continued;
}

export async function makeRace(dir = RUNS_DIR, wanted?: readonly string[]): Promise<RaceFile> {
  const files = (await readdir(dir)).filter((name) => name.endsWith(".json"));
  const records = new Map<string, RunRecord>();
  for (const name of files) {
    const record = readRecord(await Bun.file(join(dir, name)).json().catch(() => null));
    if (record) records.set(name, record);
  }
  const names = [...records.keys()];
  const series = names.filter((name) => records.get(name)?.header.bot.name === MODEL_BOT).sort((a, b) => dateOf(a).localeCompare(dateOf(b)));
  const chosen = wanted?.map((name) => findRecord(names, name)) ?? series;
  for (const name of chosen) if (!series.includes(name)) throw new Error(`${name} is not a Run of a model bot`);
  const continued = continuedBy(chosen, records);
  const runs: RaceRun[] = [];
  for (const name of [...new Set(chosen)].sort((a, b) => series.indexOf(a) - series.indexOf(b))) {
    if (continued.has(name)) {
      console.warn(`${name} stays out of the Race: a Run of the Race continues it`);
      continue;
    }
    const record = records.get(name) as RunRecord;
    // A Run that stops before its first step on the overworld has no place to show, but it keeps its rank in the series.
    if (record.track?.length === 0) console.warn(`${name} has no point in its track: it stays out of the Race`);
    else runs.push(raceRun(series.indexOf(name) + 1, name, record));
  }
  return { version: RACE_VERSION, runs };
}

export async function writeRace(name: string, race: RaceFile, dir = RACES_DIR): Promise<string> {
  if (!/^[\w-]+$/.test(name)) throw new Error(`the name of a Race has only letters, digits, "-" and "_": ${name}`);
  await mkdir(dir, { recursive: true });
  const path = join(dir, `${name}${RACE_SUFFIX}`);
  await Bun.write(`${path}.tmp`, Bun.gzipSync(JSON.stringify(race)));
  await rename(`${path}.tmp`, path);
  return path;
}

export async function raceNames(dir = RACES_DIR): Promise<string[]> {
  const files = await readdir(dir).catch(() => []);
  return files.filter((name) => name.endsWith(RACE_SUFFIX)).map((name) => name.slice(0, -RACE_SUFFIX.length)).sort();
}

if (import.meta.main) {
  const [name, ...wanted] = process.argv.slice(2);
  if (!name) {
    console.error("Usage: bun run race <name> [records…]");
    process.exit(1);
  }
  try {
    const race = await makeRace(RUNS_DIR, wanted.length > 0 ? wanted : undefined);
    const path = await writeRace(name, race);
    console.log(`${path}: ${race.runs.length} Runs, ${Math.round((await stat(path)).size / 1024)} KB`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
