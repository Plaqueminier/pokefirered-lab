import { useEffect, useRef, useState } from "preact/hooks";
import { Button, Card, Slider } from "./components";
import { type DeathFacts, DeathCard, DeathRow, Epitaph, StarterRow } from "./components-race";
import { fitCanvas } from "./race-art";
import { type GraveLook, GraveMarks } from "./race-grave-marks";
import { RaceMarks, raceTheme } from "./race-marks";
import { FRAME_WIDTH, SHEET_HEIGHT } from "./race-sprite";

const DEMO_ICON = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 8 8"><rect x="2" y="2" width="4" height="4" fill="#6aa"/></svg>')}`;
const FACE = <span class="block h-6 w-4 rounded-sm bg-raised" />;
const FALL_LOOP_MS = 2600;
const MARK_MODES = ["cemetery", "memorial", "tour"] as const;

const TRAINER_DEATH: DeathFacts = {
  face: FACE,
  icon: () => DEMO_ICON,
  run: "00072",
  endedRun: true,
  lead: { species: "CHARMANDER", nickname: "EMBER", level: 11 },
  killer: { poison: false, trainer: "LEADER BROCK", species: "ONIX", level: 14 },
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

const POISON_DEATH: DeathFacts = {
  ...TRAINER_DEATH,
  run: "00015",
  endedRun: false,
  lead: { species: "SQUIRTLE", nickname: "SQUIRTLE", level: 7 },
  killer: { poison: true, trainer: null, species: "WEEDLE", level: 4 },
  epitaph: "Field poison does not faint a Pokémon.",
  team: [{ species: "SQUIRTLE", nickname: "SQUIRTLE", level: 7 }],
  model: "claude-haiku-5-5",
  place: "Viridian Forest",
};

const SILENT_DEATH: DeathFacts = { ...TRAINER_DEATH, run: "00003", lead: undefined, killer: null, epitaph: "", team: [], model: "gpt-6.1-terra", place: "Route 1" };

const DEATHS = [TRAINER_DEATH, POISON_DEATH, SILENT_DEATH];

export function DeathCardDemo() {
  return (
    <div class="flex flex-wrap items-start gap-4">
      {DEATHS.map((death) => (
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
      {DEATHS.map((death) => (
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
      {DEATHS.map((death) => (
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

const DEMO_STONES = [
  { x: 50, starter: "BULBASAUR", killer: TRAINER_DEATH.killer },
  { x: 110, starter: "SQUIRTLE", killer: POISON_DEATH.killer },
  { x: 170, starter: "CHARMANDER", killer: TRAINER_DEATH.killer },
  { x: 230, starter: null, killer: null },
  { x: 370, starter: "CHARMANDER", killer: TRAINER_DEATH.killer },
] as const;
/** The Tour of the demo is at its third stone: the two before it stand, the two after it are faint. */
const TOUR_INDEX = 2;

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
        const graves: GraveLook[] = [
          ...DEMO_STONES.map(({ x, starter, killer }, order): GraveLook => ({ kind: "stone", x, y: height - 24, s: 52, death: { starter, killer, order } })),
          { kind: "end", result: "cost limit", x: 300, y: height - 24, s: 26 },
        ];
        const falling = graves[DEMO_STONES.length - 1];
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
