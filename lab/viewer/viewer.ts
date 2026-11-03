import type { Camera, MapActors, MapGrid } from "../src/game";
import { AudioOut } from "./audio";
import { mountComponentsTab } from "./components-tab";
import { mountDocTab } from "./doc";
import { ScreenFeed, SharedCursor, Store } from "./cursor";
import { GridTab } from "./grid";
import { LabTab } from "./lab";
import type { ScreenSettings } from "./screen-controls";
import { type CellTip, describe, draw } from "./mapdraw";
import { RaceTab } from "./race";
import { ViewerTabs } from "./tabs";
import { WholeMap } from "./whole-map";
import { BinaryKind, type BotInfo, Keys, type ClientMessage, replayOf, SCREEN_HEADER, type ServerMessage, VIEWER_RUN_ID } from "../src/protocol";

const SCALE = 3;
const VOLUME_KEY = "lab.volume";
const DEFAULT_VOLUME = 0.8;

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const gameCanvas = $<HTMLCanvasElement>("game");
const gameCtx = gameCanvas.getContext("2d")!;
const overlayCanvas = $<HTMLCanvasElement>("overlay");
const overlayCtx = overlayCanvas.getContext("2d")!;
const image = gameCtx.createImageData(240, 160);

const KEY_MAP: Record<string, number> = {
  ArrowUp: Keys.Up,
  ArrowDown: Keys.Down,
  ArrowLeft: Keys.Left,
  ArrowRight: Keys.Right,
  x: Keys.A,
  w: Keys.B,
  z: Keys.B,
  Enter: Keys.Start,
  Backspace: Keys.Select,
  q: Keys.L,
  s: Keys.R,
};

let ws: WebSocket;
let keys = 0;
let settings: ScreenSettings = { overlay: false, sound: false, soundStarted: false, volume: storedVolume() };
let grid: MapGrid | null = null;
let actors: MapActors | null = null;
let camera: Camera | null = null;
let audioLevel = 0;
const audio = new AudioOut((ms) => (audioLevel = ms));
audio.setVolume(settings.volume);

const shared = new SharedCursor();
const screens = new ScreenFeed();
let shownRunId = VIEWER_RUN_ID;
let stopDrawing = screens.subscribe(shownRunId, drawGame);
let gridShown = false;
const fromGrid = new Store<string | null>(null);
const gridTab = new GridTab($("grid"), { send, screens, fromGrid, openLab: () => tabs.show("lab") });
const raceTab = new RaceTab($("race"));
const tabs = new ViewerTabs(
  {
    nav: $("nav"),
    tabs: { lab: $("lab"), grid: $("grid"), race: $("race"), doc: $("doc"), components: $("components") },
  },
  (tab) => {
    if (tab !== "lab") releaseKeys();
    gridShown = tab === "grid";
    gridTab.onTab(gridShown);
    raceTab.onTab(tab === "race");
    syncAudio();
  },
);
mountComponentsTab($("components"));
const bots = new Store<BotInfo[] | null>(null);
mountDocTab($("doc"), bots);
const cellTip = new Store<CellTip | null>(null);
const map = new WholeMap(send, cellTip);
const lab = new LabTab($("lab"), $("toasts"), { shared, send, map, cellTip, fromGrid, backToGrid: () => tabs.show("grid"), settings, settingsActions: { setOverlay, setSound, setVolume } });

function drawGame(screen: Uint8Array): void {
  image.data.set(screen);
  gameCtx.putImageData(image, 0, 0);
}

function send(message: ClientMessage): void {
  if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(message));
}

function connect(): void {
  ws = new WebSocket(`ws://${location.host}/ws`);
  ws.binaryType = "arraybuffer";
  ws.onmessage = (event) => {
    if (event.data instanceof ArrayBuffer) {
      const bytes = new Uint8Array(event.data);
      if (bytes[0] === BinaryKind.Screen) {
        const runId = new DataView(event.data).getUint32(1, true);
        const screen = bytes.subarray(SCREEN_HEADER);
        screens.put(runId, screen);
      } else if (bytes[0] === BinaryKind.Audio) {
        audio.push(event.data.slice(2));
      }
      return;
    }
    onMessage(JSON.parse(event.data) as ServerMessage);
  };
  ws.onopen = () => {
    gridTab.onOpen();
    if (settings.overlay) send({ type: "overlay", enabled: true });
    syncAudio();
  };
  ws.onclose = () => {
    lab.onStatusLine("disconnected, trying again…");
    setTimeout(connect, 1000);
  };
}

function onMessage(message: ServerMessage): void {
  switch (message.type) {
    case "status": {
      const run = message.shown.kind === "bot" ? message.shown.run : null;
      map.onRun(run?.id ?? null);
      const runId = run?.id ?? VIEWER_RUN_ID;
      if (runId !== shownRunId) {
        shownRunId = runId;
        stopDrawing();
        stopDrawing = screens.subscribe(runId, drawGame);
      }
      gridTab.onStatus(message);
      const frame = replayOf(message.shown)?.seeking?.to ?? message.frame;
      const statusLine =
        `${message.rom} · frame ${frame} · ` +
        (run ? `Run ${run.id} of the Bot ${run.bot}, no sound` : `${message.fps} frames/s · ${soundText(message.audio)}`) +
        (message.hasStartSave ? "" : " · no Starting save yet");
      const runChanged = shared.onStatus(message.shown);
      lab.onStatus(message, statusLine, runChanged);
      break;
    }
    case "state":
      lab.onState(message.state);
      break;
    case "inventory":
      lab.onInventory(message.from, message.entries);
      break;
    case "map":
      grid = message.grid;
      map.onMap(grid);
      drawOverlay();
      break;
    case "actors":
      actors = message.actors;
      map.onActors(actors);
      drawOverlay();
      break;
    case "sight":
      map.onSight(message.maps);
      break;
    case "camera":
      camera = message.camera;
      drawOverlay();
      map.onCamera(camera);
      break;
    case "maps":
      map.onNames(message.names);
      break;
    case "areas":
      lab.onAreas(message.areas);
      break;
    case "replay-events":
      lab.onReplayEvents(message.name, message.events);
      break;
    case "preview":
      map.onPreview(message.grid, message.actors);
      break;
    case "notice":
      lab.notice(message.text);
      break;
    case "records":
      lab.onRecords(message.names, message.facts);
      gridTab.onRecords(message.names);
      break;
    case "bots":
      lab.onBots(message.bots, message.providers);
      bots.set(message.bots);
      break;
    case "events": {
      const added = shared.onEvents(message.events);
      lab.onEvents(message.events, message.quiet ? null : added);
      break;
    }
  }
}

// No reason here: the tooltip of the sound button tells why no sound plays.
function soundText(playing: boolean): string {
  if (!settings.sound) return "sound off";
  return playing ? `sound ${Math.round(audioLevel)} ms` : "no sound";
}

// ---- Overlay on the game screen

function drawOverlay(): void {
  overlayCtx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
  if (!settings.overlay || !grid || !camera) return;
  draw(overlayCtx, grid, actors, { x: camera.x * SCALE, y: camera.y * SCALE, cell: 16 * SCALE }, "overlay");
}

$("screen").addEventListener("mousemove", (event) => {
  if (!settings.overlay || !grid || !camera) return cellTip.set(null);
  const rect = overlayCanvas.getBoundingClientRect();
  const sx = ((event.clientX - rect.left) / rect.width) * 240;
  const sy = ((event.clientY - rect.top) / rect.height) * 160;
  const facts = describe(grid, actors, Math.floor((sx - camera.x) / 16), Math.floor((sy - camera.y) / 16));
  cellTip.set(facts && { at: { x: event.clientX, y: event.clientY }, facts, link: null });
});
$("screen").addEventListener("mouseleave", () => cellTip.set(null));

function changeSettings(next: Partial<ScreenSettings>): void {
  settings = { ...settings, ...next };
  lab.onSettings(settings);
}

function setOverlay(on: boolean): void {
  changeSettings({ overlay: on });
  send({ type: "overlay", enabled: on });
  drawOverlay();
  if (!on) cellTip.set(null);
}

/** Browsers allow sound only after a click or a key press. */
function startSound(): void {
  if (!settings.sound || audio.running) return;
  void audio.start().then(() => {
    changeSettings({ soundStarted: audio.running });
    syncAudio();
  });
}

function setSound(on: boolean): void {
  changeSettings({ sound: on });
  if (on) startSound();
  syncAudio();
}

// The Grid has no sound (#72).
function syncAudio(): void {
  const on = settings.sound && audio.running && !gridShown;
  send({ type: "audio", enabled: on });
  if (!on) audio.clear();
}

// localStorage throws when the browser blocks the storage (for example in a private window).
function storedVolume(): number {
  try {
    const volume = Number(localStorage.getItem(VOLUME_KEY) ?? DEFAULT_VOLUME);
    return Number.isFinite(volume) ? Math.max(0, Math.min(1, volume)) : DEFAULT_VOLUME;
  } catch {
    return DEFAULT_VOLUME;
  }
}

function setVolume(volume: number): void {
  audio.setVolume(volume);
  changeSettings({ volume });
  try {
    localStorage.setItem(VOLUME_KEY, String(volume));
  } catch {}
}

window.addEventListener("pointerdown", startSound);

// The harness trims the Run speed from the queue length (the two clocks drift apart).
setInterval(() => {
  if (settings.sound && audio.running) send({ type: "audio-level", ms: audioLevel });
}, 250);

function keyOf(event: KeyboardEvent): number | undefined {
  return KEY_MAP[event.key.length === 1 ? event.key.toLowerCase() : event.key];
}

window.addEventListener("keydown", (event) => {
  if (event.metaKey || event.ctrlKey || event.target instanceof HTMLInputElement || !tabs.labShown) return;
  startSound();
  const bit = keyOf(event);
  if (bit !== undefined) {
    event.preventDefault();
    if (!(keys & bit)) {
      keys |= bit;
      send({ type: "keys", keys });
    }
    return;
  }
  if (event.repeat) return;
  const key = event.key.toLowerCase();
  if (key === "escape" && !document.querySelector("[popover]:not([popover=manual]):popover-open")) shared.clear();
  else if (key === "g") setOverlay(!settings.overlay);
  else if (key === "m") setSound(!settings.sound);
  else if (key === "k") send({ type: "quick-save" });
  else if (key === "l") send({ type: "quick-load" });
});

window.addEventListener("keyup", (event) => {
  if (event.target instanceof HTMLInputElement) return;
  const bit = keyOf(event);
  if (bit !== undefined && keys & bit) {
    keys &= ~bit;
    send({ type: "keys", keys });
  }
});

function releaseKeys(): void {
  keys = 0;
  send({ type: "keys", keys });
}

window.addEventListener("blur", releaseKeys);

// Buttons keep the focus after a click; give it back so Enter goes to the game.
for (const b of document.querySelectorAll("button")) b.addEventListener("click", () => b.blur());

connect();
