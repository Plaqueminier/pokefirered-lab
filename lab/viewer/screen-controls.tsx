import { CircleHelp, FolderOpen, Layers, Pause, Play, RotateCcw, Save, SaveAll, Volume2, VolumeX } from "lucide-preact";
import type { ComponentChildren } from "preact";
import { useEffect, useState } from "preact/hooks";
import { type ClientMessage, SPEEDS, type Speed } from "../src/protocol";
import { Button, blurClickedButton, KeyList, type KeyRow, Legend, Slider, Tabs, Tooltip, usePending } from "./components";
import { HoverCard } from "./components-layers";
import { OVERLAY_SWATCHES } from "./mapdraw";

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
      onClick={blurClickedButton}
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
        <HoverCard control card={<OverlayLegend />}>
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

function OverlayLegend() {
  return (
    <div class="w-[300px]">
      <Legend title="Overlay (G)" items={OVERLAY_SWATCHES} note="With the overlay, point at a cell to see its data." />
    </div>
  );
}

const KEYS: KeyRow[] = [
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
    <div class="w-[260px]">
      <KeyList title="Keys" rows={KEYS} />
    </div>
  );
}
