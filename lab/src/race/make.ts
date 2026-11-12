import { mkdir, readdir, rename, stat } from "node:fs/promises";
import { basename, join } from "node:path";
import { type CurrentRecord, isCurrentRecord, limitOf, RECORD_FORMAT, RecordPlayer, readRecord, RUNS_DIR, type RunEvent, type RunRecord } from "../harness/record";
import { NORMAL_TRAINER, shownCharacter } from "../model/character";
import { modelEvents, parseRunId, type SpendUnit, spentIn, TRACK_FIELD, TRACK_POINT } from "../protocol";
import { encodeTrack, GENETIC_BOT, RACE_VERSION, type RaceBattle, type RaceFile, type RaceRun } from "./file";

export const RACES_DIR = join(import.meta.dir, "..", "..", "races");

export const RACE_SUFFIX = ".json.gz";

const RACE_BOTS = ["model", GENETIC_BOT];
const COST_STEP = 0.01;
const TOKEN_STEP = 10_000;

function battlesOf(events: readonly RunEvent[], lastFrame: number): RaceBattle[] {
  const battles: RaceBattle[] = [];
  let open: number | null = null;
  for (const event of events) {
    if (event.type !== "battle") continue;
    if (event.state === "start") open = event.frame;
    else if (open !== null) {
      battles.push([open, event.frame]);
      open = null;
    }
  }
  return open === null ? battles : [...battles, [open, lastFrame]];
}

function costOf(events: readonly RunEvent[], unit: SpendUnit): RaceRun["cost"] {
  const step = unit === "tokens" ? TOKEN_STEP : COST_STEP;
  const points: RaceRun["cost"] = [];
  let cost = 0;
  let calls = 0;
  let kept = 0;
  let last: RaceRun["cost"][number] | null = null;
  for (const event of events) {
    if (event.type !== "model" && event.type !== "summary") continue;
    if (event.type === "model") calls++;
    cost += spentIn(unit, event.usage);
    last = [event.frame, cost, calls];
    if (cost - kept < step) continue;
    points.push(last);
    kept = cost;
  }
  return last && points.at(-1) !== last ? [...points, last] : points;
}

function moneyOf(events: readonly RunEvent[]): RaceRun["money"] {
  const changes = events.flatMap((event) => (event.type === "money" ? [event] : []));
  return changes.length === 0 ? [] : [[0, changes[0].before], ...changes.map(({ frame, after }): [number, number] => [frame, after])];
}

// After a whiteout the game warps the player to a Pokémon Center and heals the party. A Run that ends there lost at the cell before: its Ghost stays on that cell, with its team as it lost. A Run that plays on after a whiteout keeps the warp.
function playUntilEnd({ events, track, state, result }: CurrentRecord): Pick<CurrentRecord, "track" | "state"> {
  const whiteout = result.endReason === "whiteout" ? events.findLast((event) => event.type === "whiteout") : undefined;
  if (!whiteout) return { track, state };
  let end = track.length;
  while (end > TRACK_POINT && track[end - TRACK_POINT + TRACK_FIELD.frame] > whiteout.frame) end -= TRACK_POINT;
  return { track: track.slice(0, end), state: state.filter((entry) => entry.frame <= whiteout.frame) };
}

export function raceRun(number: number, name: string, record: CurrentRecord): RaceRun {
  const { events, header } = record;
  const lastFrame = new RecordPlayer(record).frames;
  const unit = header.bot.model ? limitOf(header.bot.model).unit : "dollars";
  const { track, state } = playUntilEnd(record);
  return {
    number,
    record: name,
    bot: `${header.bot.name} ${header.bot.version}`,
    model: header.bot.model?.id ?? "",
    ...(header.bot.model?.coach ? { coach: header.bot.model.coach.id } : {}),
    character: shownCharacter(modelEvents(events)) ?? NORMAL_TRAINER,
    track: encodeTrack(track),
    battles: battlesOf(events, lastFrame),
    trainers: events.flatMap((e) => (e.type === "trainer" ? [[e.frame, e.trainer] as [number, string]] : [])),
    milestones: events.flatMap((e) => (e.type === "milestone" ? [[e.frame, e.milestone] as [number, string]] : [])),
    end: { frame: lastFrame, result: record.result.endReason },
    state,
    ...(unit === "tokens" ? { unit } : {}),
    cost: costOf(events, unit),
    faints: events.flatMap((e) => (e.type === "faint" && e.side === "player" ? [e.frame] : [])),
    money: moneyOf(events),
  };
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
  const files = [...(await readdir(dir)).filter((name) => name.endsWith(".json")), ...(wanted ?? []).filter((name) => name.includes("/"))];
  const records = new Map<string, RunRecord>();
  for (const name of files) {
    const record = readRecord(await Bun.file(join(dir, name)).json().catch(() => null));
    if (record) records.set(name, record);
  }
  const names = [...records.keys()];
  const raceRuns = names.filter((name) => RACE_BOTS.includes(records.get(name)?.header.bot.name ?? ""));
  const chosen = wanted?.map((name) => findRecord(names, name)) ?? raceRuns;
  for (const name of chosen) if (!raceRuns.includes(name)) throw new Error(`${name} is not a Run of a model bot or of the Genetic bot`);
  const continued = continuedBy(chosen, records);
  const runs: RaceRun[] = [];
  for (const name of new Set(chosen)) {
    const record = records.get(name);
    if (!record) continue;
    if (!isCurrentRecord(record)) throw new Error(`${name} is below format ${RECORD_FORMAT}: run "bun run migrate" first`);
    const number = record.header.genomeId ?? parseRunId(basename(name));
    if (number === null) console.warn(`${name} has no Run id at the start of its name: it stays out of the Race`);
    else if (continued.has(name)) console.warn(`${name} stays out of the Race: a Run of the Race continues it`);
    else if (record.track.length === 0) console.warn(`${name} has no point in its track: it stays out of the Race`);
    else runs.push(raceRun(number, name, record));
  }
  return { version: RACE_VERSION, runs: runs.sort((a, b) => a.number - b.number) };
}

export async function writeRace(name: string, race: RaceFile, dir = RACES_DIR): Promise<string> {
  if (!/^[\w-]+$/.test(name)) throw new Error(`the name of a Race has only letters, digits, "-" and "_": ${name}`);
  await mkdir(dir, { recursive: true });
  const path = join(dir, `${name}${RACE_SUFFIX}`);
  await Bun.write(`${path}.tmp`, Bun.gzipSync(JSON.stringify(race)));
  await rename(`${path}.tmp`, path);
  return path;
}

export async function readRace(name: string, dir = RACES_DIR): Promise<RaceFile | null> {
  const file = Bun.file(join(dir, `${name}${RACE_SUFFIX}`));
  if (!(await file.exists())) return null;
  return JSON.parse(new TextDecoder().decode(Bun.gunzipSync(await file.bytes())));
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
