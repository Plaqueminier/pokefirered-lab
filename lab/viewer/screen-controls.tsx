import { CircleHelp, FolderOpen, Layers, Pause, Play, RotateCcw, Save, SaveAll, Volume2, VolumeX } from "lucide-preact";
import type { ComponentChildren } from "preact";
import { useEffect, useState } from "preact/hooks";
import { type ClientMessage, SPEEDS, type Speed } from "../src/protocol";
import { Button, LABEL, Slider, Tabs, Tooltip, usePending } from "./components";
import { HoverCard } from "./components-layers";

export type ScreenSettings = { overlay: boolean; sound: boolean; soundStarted: boolean; volume: number };

export type ScreenSettingsActions = { setOverlay: (on: boolean) => void; setSound: (on: boolean) => void; setVolume: (volume: number) => void };

export type ScreenRun = { speed: Speed; paused: boolean; hasQuickState: boolean; botRun: boolean; jumping: boolean };

function speedLabel(speed: Speed): string {
  return speed === "max" ? "Max" : `×${speed}`;
}

export const SPEED_TABS = SPEEDS.map((speed) => ({ id: String(speed), label: speedLabel(speed) }));

const SPEED_OF_TAB = new Map(SPEEDS.map((speed) => [String(speed), speed]));

function useConfirmClick(action: () => void): [boolean, () => void] {
  const [asked, setAsked] = useState(false);
  useEffect(() => {
    if (!asked) return;
    const timer = setTimeout(() => setAsked(false), 3000);
    return () => clearTimeout(timer);
  }, [asked]);
  const click = () => {
    if (asked) action();
    setAsked(!asked);
  };
  return [asked, click];
}

// The rule of the server (LivePlay.audioActive), told to the user.
function noSoundReason({ sound, soundStarted }: ScreenSettings, { botRun, jumping, speed, paused }: Pick<ScreenRun, "botRun" | "jumping" | "speed" | "paused">): string | null {
  if (!sound) return null;
  if (botRun) return "No sound for a Run of a Bot";
  if (jumping) return "No sound during a jump";
  if (speed !== 1) return "The sound plays at ×1 only";
  if (paused) return "No sound while paused";
  if (!soundStarted) return "Click or press a key to start the sound";
  return null;
}

function IconButton({ tip, label = tip, ...rest }: { tip: string; label?: string; pressed?: boolean; disabled?: boolean; variant?: "ghost" | "danger"; onClick?: () => void; children: ComponentChildren }) {
  return (
    <Tooltip text={tip}>
      <Button size="icon" variant="ghost" aria-label={label} {...rest} />
    </Tooltip>
  );
}

export function ScreenControls({ run, settings, actions, send }: { run: ScreenRun | null; settings: ScreenSettings; actions: ScreenSettingsActions; send: (message: ClientMessage) => void }) {
  const [speed, showSpeed] = usePending<Speed>(run?.speed ?? 1, Object.is, 1000);
  const [paused, showPaused] = usePending(run?.paused ?? false, Object.is, 1000);
  const [askedWrite, write] = useConfirmClick(() => send({ type: "write-start-save" }));
  // The server ignores these messages while a Run of a Bot is shown.
  const off = !run || run.botRun;
  const noSound = noSoundReason(settings, { botRun: !!run?.botRun, jumping: !!run?.jumping, speed, paused });
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions lint/a11y/useKeyWithClickEvents: the bar only takes the focus from a clicked button, so Enter goes to the game.
    <div
      class="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-card border border-line bg-surface p-1.5"
      onClick={(event) => (event.target as Element).closest("button")?.blur()}
    >
      <div class="flex items-center gap-1.5">
        <IconButton
          tip={paused ? "Play" : "Pause"}
          pressed={paused}
          disabled={off}
          onClick={() => {
            showPaused(!paused);
            send({ type: "pause", paused: !paused });
          }}
        >
          {paused ? <Play size={16} /> : <Pause size={16} />}
        </IconButton>
        <Tabs
          kind="segmented"
          items={SPEED_TABS}
          value={String(speed)}
          disabled={off}
          onChange={(id) => {
            const next = SPEED_OF_TAB.get(id);
            if (next === undefined) return;
            showSpeed(next);
            send({ type: "speed", speed: next });
          }}
        />
      </div>
      <div class="flex items-center gap-1.5">
        <HoverCard control card={<Legend />}>
          <Button size="icon" variant="ghost" aria-label="Overlay (G)" pressed={settings.overlay} onClick={() => actions.setOverlay(!settings.overlay)}>
            <Layers size={16} />
          </Button>
        </HoverCard>
        <IconButton tip={noSound ?? (settings.sound ? "Sound off (M)" : "Sound on (M)")} label="Sound (M)" pressed={settings.sound} onClick={() => actions.setSound(!settings.sound)}>
          {settings.sound && !noSound ? <Volume2 size={16} /> : <VolumeX size={16} />}
        </IconButton>
        <span class="w-20">
          <Slider live label="Volume" value={Math.round(settings.volume * 100)} max={100} format={(n) => `${n} %`} onSeek={(n) => actions.setVolume(n / 100)} />
        </span>
      </div>
      <div class="ml-auto flex items-center gap-1">
        <IconButton tip="Save state (K)" disabled={off} onClick={() => send({ type: "quick-save" })}>
          <Save size={16} />
        </IconButton>
        <IconButton tip="Load state (L)" disabled={off || !run?.hasQuickState} onClick={() => send({ type: "quick-load" })}>
          <FolderOpen size={16} />
        </IconButton>
        <IconButton tip="Restart" disabled={off} onClick={() => send({ type: "reset" })}>
          <RotateCcw size={16} />
        </IconButton>
        <IconButton
          tip={askedWrite ? "Click again to write" : "Write the Starting save. Save in the game first. The old Starting save is kept."}
          label="Write the Starting save"
          variant={askedWrite ? "danger" : "ghost"}
          disabled={off}
          onClick={write}
        >
          <SaveAll size={16} />
        </IconButton>
        <HoverCard control card={<KeysHelp />}>
          <Button size="icon" variant="ghost" aria-label="Keys">
            <CircleHelp size={16} />
          </Button>
        </HoverCard>
      </div>
    </div>
  );
}

// Some colors have more alpha than on the overlay: a faint color is not visible on a 10 px swatch.
const SWATCHES: { label: string; style: string }[] = [
  { label: "blocked", style: "background: rgba(224, 70, 70, 0.55)" },
  { label: "water", style: "background: rgba(60, 130, 230, 0.55)" },
  { label: "tall grass", style: "background: rgba(80, 200, 110, 0.35)" },
  { label: "warp (outline: inactive)", style: "background: rgba(170, 90, 230, 0.75)" },
  { label: "person (hollow: off the screen)", style: "border-radius: 50%; background: rgba(240, 200, 40, 0.8)" },
  { label: "fixed obstacle (cut tree, rock, boulder)", style: "background: rgba(60, 170, 80, 0.85)" },
  { label: "trainer", style: "border-radius: 50%; border: 2px solid rgba(255, 60, 60, 0.95)" },
  { label: "trainer sight", style: "background: rgba(255, 60, 60, 0.35)" },
  { label: "active trigger (!)", style: "border: 2px solid rgba(255, 110, 30, 0.95)" },
  { label: "inactive trigger", style: "border: 2px dashed rgba(200, 200, 200, 0.6)" },
  { label: "sign", style: "border-radius: 50%; border: 2px solid rgba(255, 170, 60, 0.85)" },
  { label: "hidden item", style: "border-radius: 50%; border: 2px solid rgba(80, 230, 230, 0.9)" },
  { label: "never seen (whole map)", style: "background: rgba(150, 155, 165, 0.8)" },
];

function Legend() {
  return (
    <div class="flex w-[300px] flex-col gap-2">
      <span class={LABEL}>Overlay (G)</span>
      <ul class="m-0 grid list-none gap-1.5 p-0 text-sm">
        {SWATCHES.map(({ label, style }) => (
          <li key={label} class="flex items-center gap-2">
            <span class="size-2.5 shrink-0" style={style} />
            {label}
          </li>
        ))}
        <li class="flex items-center gap-2">
          <span class="w-2.5 shrink-0 text-center text-xs leading-none">➜</span>
          ledge
        </li>
      </ul>
      <p class="text-xs text-muted">With the overlay, point at a cell to see its data.</p>
    </div>
  );
}

const KEYS: [keys: string[], action: string][] = [
  [["←", "↑", "→", "↓"], "move"],
  [["X"], "A"],
  [["W", "Z"], "B"],
  [["Enter"], "Start"],
  [["⌫"], "Select"],
  [["Q"], "L"],
  [["S"], "R"],
  [["G"], "overlay"],
  [["M"], "sound"],
  [["K"], "save state"],
  [["L"], "load state"],
  [["Esc"], "back to now"],
];

function KeysHelp() {
  return (
    <div class="flex w-[260px] flex-col gap-2">
      <span class={LABEL}>Keys</span>
      <dl class="grid grid-cols-[max-content_1fr] items-center gap-x-3 gap-y-1.5 text-sm">
        {KEYS.map(([keys, action]) => (
          <div key={action} class="contents">
            <dt class="flex gap-1">
              {keys.map((key) => (
                <kbd key={key} class="inline-grid h-5 min-w-5 place-items-center rounded-sm border border-line-strong bg-raised px-1 font-mono text-xs text-fg">
                  {key}
                </kbd>
              ))}
            </dt>
            <dd class="text-muted">{action}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
