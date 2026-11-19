import { useEffect, useRef, useState } from "preact/hooks";
import { Button, Card, Slider } from "./components";
import { type GraveFacts, DeathCard, DeathRow, Epitaph, StarterRow } from "./components-race";
import { fitCanvas } from "./race-art";
import { type GraveLook, GraveMarks } from "./race-grave-marks";
import { RaceMarks, raceTheme } from "./race-marks";
import { FRAME_WIDTH, SHEET_HEIGHT } from "./race-sprite";

const DEMO_ICON = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 8 8"><rect x="2" y="2" width="4" height="4" fill="#6aa"/></svg>')}`;
const FACE = <span class="block h-6 w-4 rounded-sm bg-raised" />;
const BROCK_ONIX = { poison: false, trainer: "LEADER BROCK", species: "ONIX", level: 14 };
const POISON_WEEDLE = { poison: true, trainer: null, species: "WEEDLE", level: 4 };
const FALL_LOOP_MS = 2600;
const MARK_MODES = ["cemetery", "memorial", "tour"] as const;

const TRAINER_DEATH: GraveFacts = {
  face: FACE,
  icon: () => DEMO_ICON,
  run: "00072",
  cause: { kind: "whiteout", endedRun: true, killer: BROCK_ONIX },
  lead: { species: "CHARMANDER", nickname: "EMBER", level: 11 },
  epitaph: "A Potion cannot revive it.",
  team: [
    { species: "CHARMANDER", nickname: "EMBER", level: 11 },
    { species: "PIDGEY", nickname: "PIDGEY", level: 6 },
  ],
  model: "deepseek/deepseek-v4.1-flash",
  character: "A calm baker who names each Pokémon after a pastry.",
  place: "Pewter City · Gym",
  time: "0:41:07",
};

const POISON_DEATH: GraveFacts = {
  ...TRAINER_DEATH,
  run: "00015",
  cause: { kind: "whiteout", endedRun: false, killer: POISON_WEEDLE },
  lead: { species: "SQUIRTLE", nickname: "SQUIRTLE", level: 7 },
  epitaph: "Field poison does not faint a Pokémon.",
  team: [{ species: "SQUIRTLE", nickname: "SQUIRTLE", level: 7 }],
  model: "claude-haiku-5-5",
  place: "Viridian Forest",
};

const SILENT_DEATH: GraveFacts = { ...TRAINER_DEATH, run: "00003", lead: undefined, cause: { kind: "whiteout", endedRun: true, killer: null }, epitaph: "", team: [], model: "gpt-6.1-terra", place: "Route 1" };

const END_STONE: GraveFacts = { ...TRAINER_DEATH, run: "00041", cause: { kind: "end", result: "cost limit" }, epitaph: "", model: "grok-5-fast", place: "Mt. Moon · 1F", time: "1:12:30" };

const WHITEOUTS = [TRAINER_DEATH, POISON_DEATH, SILENT_DEATH];
const GRAVES = [...WHITEOUTS, END_STONE];

export function DeathCardDemo() {
  return (
    <div class="flex flex-wrap items-start gap-4">
      {GRAVES.map((death) => (
        <Card key={death.run} glass size="sm">
          <DeathCard death={death} />
        </Card>
      ))}
    </div>
  );
}

export function DeathRowDemo() {
  const [focused, setFocused] = useState<string | null>(TRAINER_DEATH.run);
  return (
    <div class="flex w-[440px] max-w-full flex-col gap-1">
      {WHITEOUTS.map((death) => (
        <DeathRow key={death.run} death={death} focused={focused === death.run} onFocus={() => setFocused(death.run)} onLeave={() => setFocused(null)} />
      ))}
    </div>
  );
}

export function EpitaphDemo() {
  const [typed, setTyped] = useState(1);
  return (
    <div class="flex flex-col gap-3">
      <div class="w-[320px] max-w-full">
        <Slider value={Math.round(typed * 100)} max={100} step={1} label="Typed" format={(value) => `${value} %`} live onSeek={(value) => setTyped(value / 100)} />
      </div>
      {GRAVES.map((death) => (
        <div key={death.run} class="overflow-hidden rounded-ctl bg-black p-6">
          <Epitaph death={death} typed={typed} />
        </div>
      ))}
    </div>
  );
}

export function StarterRowDemo() {
  return (
    <div class="flex w-[440px] max-w-full flex-col">
      <StarterRow src={DEMO_ICON} starter="SQUIRTLE" runs={28} whiteouts={10} badges={[{ badge: 1, runs: 11 }, { badge: 2, runs: 7 }]} />
      <StarterRow src={DEMO_ICON} starter="CHARMANDER" runs={19} whiteouts={7} badges={[{ badge: 1, runs: 4 }, { badge: 2, runs: 0 }]} />
    </div>
  );
}

function demoCanvas(width: number, height: number, color: string, inset: number): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    ctx.fillStyle = color;
    ctx.fillRect(inset, inset, width - inset * 2, height - inset * 2);
  }
  return canvas;
}

const DEMO_GRAVES: GraveLook[] = [
  { kind: "whiteout", x: 50, y: 0, s: 52, order: 0, starter: "BULBASAUR", killer: BROCK_ONIX },
  { kind: "whiteout", x: 110, y: 0, s: 52, order: 1, starter: "SQUIRTLE", killer: POISON_WEEDLE },
  { kind: "whiteout", x: 170, y: 0, s: 52, order: 2, starter: "CHARMANDER", killer: BROCK_ONIX },
  { kind: "whiteout", x: 230, y: 0, s: 52, order: 3, starter: null, killer: null },
  { kind: "end", x: 290, y: 0, s: 52, order: 4, starter: "SQUIRTLE", result: "cost limit" },
  { kind: "end", x: 350, y: 0, s: 52, order: 5, starter: "BULBASAUR", result: "user stop" },
  { kind: "whiteout", x: 410, y: 0, s: 52, order: 6, starter: "CHARMANDER", killer: BROCK_ONIX },
];
const TOUR_INDEX = DEMO_GRAVES.findIndex((grave) => grave.kind === "end");

export function GraveMarksDemo() {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [mode, setMode] = useState<(typeof MARK_MODES)[number]>("cemetery");
  const [start, setStart] = useState(() => performance.now());
  useEffect(() => {
    const element = canvas.current;
    if (!element) return;
    const theme = raceTheme(element);
    const icon = demoCanvas(8, 8, theme.info, 2);
    const marks = new GraveMarks(theme, new RaceMarks(theme), () => icon);
    const sheet = demoCanvas(FRAME_WIDTH, SHEET_HEIGHT, theme.fg, 4);
    let id = requestAnimationFrame(function draw(now) {
      const fitted = fitCanvas(element);
      if (fitted) {
        const { ctx, width, height } = fitted;
        const graves = DEMO_GRAVES.map((grave): GraveLook => ({ ...grave, y: height - 24 }));
        const falling = graves.at(-1);
        ctx.fillStyle = theme.typeColor("GRASS");
        ctx.fillRect(0, 0, width, height);
        const t = (now - start) % FALL_LOOP_MS;
        if (mode === "cemetery") marks.cemetery(ctx, graves, (grave) => (grave === falling ? t : Number.POSITIVE_INFINITY), () => sheet);
        else if (mode === "memorial") marks.memorial(ctx, graves, [{ name: "Viridian Forest", count: 3, x: 110, y: height - 30, top: height - 100, s: 52 }], graves[1], width, height);
        else marks.tour(ctx, graves, { index: TOUR_INDEX, since: start, now: start + t }, () => sheet, width, height);
      }
      id = requestAnimationFrame(draw);
    });
    return () => cancelAnimationFrame(id);
  }, [mode, start]);
  return (
    <div class="flex flex-col gap-3">
      <div class="flex gap-2">
        {MARK_MODES.map((id) => (
          <Button key={id} pressed={mode === id} onClick={() => setMode(id)}>
            {id}
          </Button>
        ))}
        <Button onClick={() => setStart(performance.now())}>Drop again</Button>
      </div>
      <canvas ref={canvas} class="block h-[180px] w-[440px] max-w-full rounded-ctl" />
    </div>
  );
}
