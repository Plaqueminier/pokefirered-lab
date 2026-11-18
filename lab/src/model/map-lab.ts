import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { Harness, type Observation } from "../harness/harness";
import { ELEVATION_SHIFT, SHORE_ELEVATION } from "../cells";
import { type Cell, cellKey, joinCells, walkable, walkGroups } from "../harness/path";
import type { ModelSettings } from "../harness/record";
import { Run, SAVES_DIR } from "../run";
import { askedOf, readAction } from "./decision";
import { type Answer, askAll, hashOf, type LabCall, LABS_DIR, type LabOptions, readResults, runOptions } from "./lab";
import { BOT_VERSION, openingPrompt, type PromptInput } from "./opening";
import { showsAtlas, turnKind } from "./prompt";

const LAB_DIR = join(LABS_DIR, "map");
const MOMENTS_FILE = join(LAB_DIR, "moments.json");
const RESULTS_FILE = join(LAB_DIR, "results.jsonl");
const REPORT_FILE = join(LAB_DIR, "report.md");
const PARTY_SAVE = join(SAVES_DIR, "test-party.sav");
const PALLET_DOOR = { x: 6, y: 7 };

// The settings of the model bot in Runs 00078 and 00079.
const SETTINGS: ModelSettings = { id: "claude-haiku-5-5", reasoning: "low", thinking: "medium", temperature: null, starter: "free", whiteoutLimit: null, timeLimit: null, coach: { id: "claude-opus-5-5" }, provider: "claude-code", tokenLimit: 20_000_000 };

// Cells from where land at another elevation is on the screen, and no stairs join the two elevations on the map.
const SPOTS: readonly ({ map: string } & Cell)[] = [
  { map: "SafariZone_West", x: 24, y: 9 },
  { map: "SafariZone_West", x: 21, y: 12 },
  { map: "SafariZone_West", x: 29, y: 20 },
  { map: "SeafoamIslands_B2F", x: 21, y: 6 },
  { map: "SeafoamIslands_B2F", x: 6, y: 8 },
  { map: "SeafoamIslands_B2F", x: 21, y: 9 },
  { map: "SeafoamIslands_B2F", x: 31, y: 12 },
  { map: "SixIsland_WaterPath", x: 12, y: 22 },
];

/** old: the snapshot with no elevation, as the Parts and the talk cells of version 48 saw it. now: the prompt of the current code. */
const VARIANTS = ["old", "now"] as const;

type Variant = (typeof VARIANTS)[number];

type Moment = { id: string; map: string; cell: Cell; observation: Observation };

type Score = "reachable" | "unreachable" | "elsewhere" | "unread";

type Result = Answer & { id: string; variant: Variant; bot: string; repeat: number };

async function snapshot(spot: { map: string } & Cell): Promise<Moment> {
  const run = await Run.open({ startSave: PARTY_SAVE });
  try {
    const warp = run.game.mem.global("sWarpDestination");
    let warped = false;
    const onFrame = () => {
      run.core.patch16(run.game.mem.global("sWildEncountersDisabled").addr, 1);
      if (warped || run.game.map().name === spot.map) {
        warped = true;
        return;
      }
      const group = run.game.allMapNames.findIndex((names) => names.includes(spot.map));
      run.core.patch16(warp.addr, group | (run.game.allMapNames[group].indexOf(spot.map) << 8));
      run.core.patch16(warp.field("warpId").addr, 0xff);
      run.core.patch16(warp.field("x").addr, spot.x);
      run.core.patch16(warp.field("y").addr, spot.y);
    };
    const harness = await Harness.open({ onFrame }, run);
    await harness.goTo(PALLET_DOOR.x, PALLET_DOOR.y);
    const observation = harness.observe();
    if (observation.mode !== "overworld" || observation.map.name !== spot.map || observation.player.x !== spot.x || observation.player.y !== spot.y) throw new Error(`the warp to ${spot.map} (${spot.x}, ${spot.y}) failed`);
    return { id: `${spot.map}@${spot.x},${spot.y}`, map: spot.map, cell: { x: spot.x, y: spot.y }, observation };
  } finally {
    run.core.close();
  }
}

function inputOf(moment: Moment, variant: Variant): PromptInput {
  const observation = moment.observation;
  const input = { observation, before: null, events: [], noProgress: { stuck: 0, since: 0 }, names: null, frame: 0, whiteouts: 0 };
  if (variant !== "old" || observation.mode !== "overworld") return input;
  // All the cells at the elevation of the shore: each step joins, as in version 48, and SURF still starts on each shore.
  const blocks = observation.grid.blocks.map((block) => (block & ((1 << ELEVATION_SHIFT) - 1)) | (SHORE_ELEVATION << ELEVATION_SHIFT));
  const maps = observation.atlas.maps.map(({ elevations: _, ...map }) => map);
  return { ...input, observation: { ...observation, grid: { ...observation.grid, blocks }, atlas: { ...observation.atlas, maps } } };
}

const PROMPTS = new Map<string, ReturnType<typeof buildPrompt>>();

function promptOf(moment: Moment, variant: Variant): ReturnType<typeof buildPrompt> {
  const key = `${moment.id}|${variant}`;
  const built = PROMPTS.get(key) ?? buildPrompt(moment, variant);
  PROMPTS.set(key, built);
  return built;
}

function buildPrompt(moment: Moment, variant: Variant) {
  const input = inputOf(moment, variant);
  const turn = turnKind(input.observation.waitingFor.kind, input.events, input.noProgress, input.observation.party.length);
  const asked = askedOf(input.observation, showsAtlas(turn));
  if (!asked) throw new Error(`no Decision point at ${moment.id}`);
  const opening = openingPrompt(SETTINGS, input, asked, turn);
  return { ...opening, asked };
}

const WALK_GROUPS = new Map<string, Map<string, number>>();

function walkGroupsOf({ id, observation }: Moment): Map<string, number> {
  if (observation.mode !== "overworld") return new Map();
  const { grid } = observation;
  const groups = WALK_GROUPS.get(id) ?? walkGroups(grid, (c) => walkable(grid, c)).groups;
  WALK_GROUPS.set(id, groups);
  return groups;
}

/** Where the answer goes on the map of the moment, and if the player can walk there: the real grid, with its elevations, decides. */
function scoreOf(moment: Moment, variant: Variant, text: string): Score {
  const { observation } = moment;
  if (observation.mode !== "overworld") return "unread";
  const { asked } = promptOf(moment, variant);
  let target: { map: string; cell: Cell } | null;
  try {
    const action = readAction(text, asked);
    const goal = action.name === "go" && asked.kind === "walk" ? asked.view.targets[action.target] : null;
    if (action.name === "goTo") target = { map: action.map ?? moment.map, cell: { x: action.x, y: action.y } };
    else if (goal && "cell" in goal) target = { map: "map" in goal && typeof goal.map === "string" ? goal.map : moment.map, cell: goal.cell };
    else target = null;
  } catch {
    return "unread";
  }
  if (!target || target.map !== moment.map) return "elsewhere";
  const { grid } = observation;
  const groups = walkGroupsOf(moment);
  const own = groups.get(cellKey(observation.player));
  return joinCells(grid, target.cell).some((c) => groups.get(cellKey(c)) === own) ? "reachable" : "unreachable";
}

async function play(moments: readonly Moment[], { models, repeats, only, ...limits }: LabOptions): Promise<void> {
  const chosen = moments.flatMap((moment) => VARIANTS.map((variant) => ({ moment, variant }))).filter(({ moment, variant }) => !only || only.test(`${moment.id} ${variant}`));
  console.log(`${chosen.length} moments and variants, bot version ${BOT_VERSION}`);
  const calls = chosen.flatMap(({ moment, variant }) => {
    const { prompt, format } = promptOf(moment, variant);
    return models.flatMap((model) => Array.from({ length: repeats }, (_, repeat): LabCall<Omit<Result, keyof Answer>> => ({
      key: `${moment.id}|${variant}|${model}|${repeat}|${hashOf(prompt)}`,
      model,
      prompt,
      options: { format },
      label: `${moment.id} ${variant} ${model}`,
      fields: { id: moment.id, variant, bot: BOT_VERSION, repeat },
    })));
  });
  await askAll(RESULTS_FILE, calls, limits);
}

function report(moments: readonly Moment[], results: readonly Result[]): string {
  const byId = new Map(moments.map((m) => [m.id, m]));
  const read = results.flatMap((r) => {
    const moment = byId.get(r.id);
    return moment && r.action !== null && VARIANTS.includes(r.variant) ? [{ ...r, action: r.action, score: scoreOf(moment, r.variant, r.action) }] : [];
  });
  const count = (rows: typeof read, score: Score) => rows.filter((r) => r.score === score).length;
  const sorted = read.toSorted((a, b) => VARIANTS.indexOf(a.variant) - VARIANTS.indexOf(b.variant) || a.model.localeCompare(b.model));
  const groups = [...Map.groupBy(sorted, (r) => `${r.variant} | ${r.model}`)];
  const summary = groups.map(([group, rows]) => `| ${group} | ${rows.length} | ${count(rows, "reachable")} | ${count(rows, "unreachable")} | ${count(rows, "elsewhere")} | ${count(rows, "unread")} | ${Math.round(rows.reduce((sum, r) => sum + r.promptTokens, 0) / rows.length)} |`);
  const detail = moments.flatMap((m) => {
    const rows = read.filter((r) => r.id === m.id);
    if (rows.length === 0) return [];
    const lines = [...Map.groupBy(rows, (r) => `${r.variant} | ${r.model}`)].map(([group, same]) => `  - ${group}: ${same.map((r) => `${r.action.slice(0, 30)} [${r.score}]`).join("; ")}`);
    return [`- ${m.id}`, ...lines];
  });
  return ["# Map moments", "", "| Variant | Model | Answers | Reachable | Unreachable | Elsewhere | Unread | Mean prompt tokens |", "| --- | --- | --- | --- | --- | --- | --- | --- |", ...summary, "", "## Answers at each moment", "", ...detail, ""].join("\n");
}

async function main(args: string[]): Promise<void> {
  await mkdir(LAB_DIR, { recursive: true });
  const [command] = args;
  if (command === "extract") {
    const moments: Moment[] = [];
    for (const spot of SPOTS) moments.push(await snapshot(spot));
    await Bun.write(MOMENTS_FILE, JSON.stringify(moments));
    console.log(`${moments.length} moments: ${MOMENTS_FILE}`);
    return;
  }
  const moments = (await Bun.file(MOMENTS_FILE).json()) as Moment[];
  if (command === "show") {
    const moment = moments.find((m) => m.id === args[1]);
    const variant = VARIANTS.find((v) => v === args[2]);
    if (!moment || !variant) throw new Error(`write show <moment> <${VARIANTS.join(" | ")}>`);
    const { prompt } = promptOf(moment, variant);
    console.log(`${prompt.system}\n\n---\n\n${prompt.user}`);
    return;
  }
  if (command === "run") await play(moments, runOptions(args));
  else if (command !== "report") throw new Error("the commands are extract, show <moment> <variant>, run and report");
  const text = report(moments, await readResults<Result>(RESULTS_FILE));
  await Bun.write(REPORT_FILE, text);
  console.log(text);
}

if (import.meta.main) await main(process.argv.slice(2));
