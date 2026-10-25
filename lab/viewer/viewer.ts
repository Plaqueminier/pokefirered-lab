// The Viewer: shows one Run and sends keyboard input to the harness.
import type { Camera, GameState, MapActors, MapGrid } from "../src/game";
import type { Sight } from "../src/harness/atlas";
import { AudioOut } from "./audio";
import { DocTab } from "./doc";
import { describe, draw, howLabel } from "./mapdraw";
import { ModelPanel } from "./model-panel";
import { ReplayPanel } from "./replay";
import { RunsPanel } from "./runs";
import { BinaryKind, Keys, type ClientMessage, type ServerMessage, type Speed } from "../src/protocol";

const SCALE = 3;

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const gameCanvas = $<HTMLCanvasElement>("game");
const gameCtx = gameCanvas.getContext("2d")!;
const overlayCanvas = $<HTMLCanvasElement>("overlay");
const overlayCtx = overlayCanvas.getContext("2d")!;
const tooltip = $("tooltip");
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
let overlayOn = false;
let paused = false;
let grid: MapGrid | null = null;
let actors: MapActors | null = null;
let camera: Camera | null = null;
let sight: Sight = {};
let soundOn = true;
let audioLevel = 0;
const audio = new AudioOut((ms) => (audioLevel = ms));
const replayPanel = new ReplayPanel(
  {
    records: $<HTMLSelectElement>("records"),
    start: $<HTMLButtonElement>("replay-start"),
    end: $<HTMLButtonElement>("replay-end"),
    status: $("replay-status"),
    action: $("action"),
    detail: $("action-detail"),
    model: $("model"),
    events: $("events"),
  },
  send,
);

const runsPanel = new RunsPanel(
  {
    runs: $<HTMLSelectElement>("runs"),
    bots: $<HTMLSelectElement>("bots"),
    model: $<HTMLInputElement>("model-id"),
    costLimit: $<HTMLInputElement>("cost-limit"),
    reasoning: $<HTMLSelectElement>("reasoning"),
    starter: $<HTMLSelectElement>("starter"),
    start: $<HTMLButtonElement>("bot-start"),
    stop: $<HTMLButtonElement>("run-stop"),
    shownModel: $("shown-model"),
  },
  send,
);
let shownRunId: number | null = null;
const modelPanel = new ModelPanel({
  title: $("model-title"),
  follow: $<HTMLButtonElement>("model-follow"),
  calls: $("model-calls"),
  answer: $("model-answer"),
  blocks: $("model-blocks"),
});
const docTab = new DocTab(
  {
    labButton: $<HTMLButtonElement>("tab-lab"),
    docButton: $<HTMLButtonElement>("tab-doc"),
    lab: $("lab"),
    doc: $("doc"),
    bots: $<HTMLTableElement>("doc-bots").tBodies[0],
  },
  releaseKeys,
);

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
        image.data.set(bytes.subarray(1));
        gameCtx.putImageData(image, 0, 0);
      } else if (bytes[0] === BinaryKind.Audio) {
        audio.push(event.data.slice(2));
      }
      return;
    }
    onMessage(JSON.parse(event.data) as ServerMessage);
  };
  ws.onopen = () => {
    if (overlayOn) send({ type: "overlay", enabled: true });
    if (soundOn && audio.running) send({ type: "audio", enabled: true });
  };
  ws.onclose = () => {
    $("status").textContent = "disconnected, trying again…";
    setTimeout(connect, 1000);
  };
}

function onMessage(message: ServerMessage): void {
  switch (message.type) {
    case "status": {
      paused = message.paused;
      const run = message.shown.kind === "bot" ? message.shown.run : null;
      // A preview shows the actors of one Run only.
      if ((run?.id ?? null) !== shownRunId && preview) backToPlayer();
      shownRunId = run?.id ?? null;
      $("pause").classList.toggle("on", paused);
      for (const b of document.querySelectorAll<HTMLButtonElement>("[data-speed]")) b.classList.toggle("on", String(message.speed) === b.dataset.speed);
      for (const b of document.querySelectorAll<HTMLButtonElement>("[data-viewer-run]")) b.disabled = run !== null;
      if (!message.hasQuickState) $<HTMLButtonElement>("quick-load").disabled = true;
      $("sound").classList.toggle("on", soundOn);
      $("status").textContent =
        `${message.rom} · frame ${message.frame} · ` +
        (run ? `Run ${run.id} of the Bot ${run.bot}, no sound` : `${message.fps} frames/s · ${soundText(message.audio)}`) +
        (message.hasStartSave ? "" : " · no Starting save yet");
      replayPanel.onStatus(message.frame, message.shown);
      modelPanel.onStatus(message.shown);
      runsPanel.onStatus(message.runs, message.shown);
      break;
    }
    case "state":
      renderState(message.state);
      break;
    case "map":
      if (message.grid && message.grid.key !== grid?.key && !preview) fitMap(message.grid);
      grid = message.grid;
      renderMapLists();
      if (grid && follow) centerOnPlayer();
      redraw();
      break;
    case "actors":
      actors = message.actors;
      renderMapLists();
      if (follow) centerOnPlayer();
      redraw();
      break;
    case "sight":
      sight = message.maps;
      drawMap();
      break;
    case "camera":
      camera = message.camera;
      drawOverlay();
      drawMap();
      break;
    case "maps":
      setMapNames(message.names);
      break;
    case "preview":
      showPreview(message.grid, message.actors);
      break;
    case "notice":
      $("notice").textContent = message.text;
      break;
    case "records":
      replayPanel.setRecords(message.names);
      break;
    case "bots":
      runsPanel.setBots(message.bots.map((bot) => bot.name));
      docTab.setBots(message.bots);
      break;
    case "events":
      replayPanel.onEvents(message.events);
      modelPanel.onEvents(message.events);
      break;
  }
}

function soundText(playing: boolean): string {
  if (!soundOn) return "sound off";
  if (!audio.running) return "sound: click or press a key";
  if (playing) return `sound ${Math.round(audioLevel)} ms`;
  return "sound only at ×1";
}

const MODE_LABEL = { overworld: "On the map", battle: "In a battle", other: "Menu / transition" };

function renderState(state: GameState): void {
  // Before the player is on a map, the location fields are not set yet.
  $("map-name").textContent = state.player ? state.map.name : "–";
  $("map-pos").textContent = state.player
    ? `group ${state.map.group}, map ${state.map.num} · x ${state.player.x}, y ${state.player.y}`
    : "";
  $("mode").textContent = MODE_LABEL[state.context.mode];
  $("callbacks").textContent = `callback2 ${state.context.callback2}\ncallback1 ${state.context.callback1}`;
  $("callbacks").style.whiteSpace = "pre";
  const party = $("party");
  party.classList.toggle("muted", state.party.length === 0);
  party.innerHTML = state.party.length === 0 ? "no Pokémon" : "";
  for (const mon of state.party) {
    const row = document.createElement("div");
    row.className = "mon";
    const pct = mon.maxHp > 0 ? Math.round((100 * mon.hp) / mon.maxHp) : 0;
    row.innerHTML = `<span></span><span class="mono"></span><div class="hp"><div style="width:${pct}%"></div></div>`;
    row.children[0].textContent = mon.nickname === mon.species ? mon.species : `${mon.nickname} (${mon.species})`;
    row.children[1].textContent = `Lv.${mon.level}  ${mon.hp}/${mon.maxHp} HP`;
    party.append(row);
  }
  $("badges").innerHTML = state.badges.map((got) => `<div class="badge${got ? " got" : ""}"></div>`).join("");
  $("money").textContent = `${state.money} ₽`;
}

// ---- Overlay on the game screen

function drawOverlay(): void {
  overlayCtx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
  if (!overlayOn || !grid || !camera) return;
  draw(overlayCtx, grid, actors, { x: camera.x * SCALE, y: camera.y * SCALE, cell: 16 * SCALE }, "overlay");
}

function showTooltip(text: string | null, clientX: number, clientY: number): void {
  tooltip.style.display = text ? "block" : "none";
  if (!text) return;
  tooltip.textContent = text;
  const width = tooltip.offsetWidth;
  const left = clientX + 14 + width > window.innerWidth - 8 ? clientX - 14 - width : clientX + 14;
  tooltip.style.left = `${left}px`;
  tooltip.style.top = `${Math.min(clientY + 14, window.innerHeight - tooltip.offsetHeight - 8)}px`;
}

$("screen").addEventListener("mousemove", (event) => {
  if (!overlayOn || !grid || !camera) return showTooltip(null, 0, 0);
  const rect = overlayCanvas.getBoundingClientRect();
  const sx = ((event.clientX - rect.left) / rect.width) * 240;
  const sy = ((event.clientY - rect.top) / rect.height) * 160;
  showTooltip(describe(grid, actors, Math.floor((sx - camera.x) / 16), Math.floor((sy - camera.y) / 16)), event.clientX, event.clientY);
});
$("screen").addEventListener("mouseleave", () => showTooltip(null, 0, 0));

// ---- Whole-map view: wheel to zoom, drag to move, double-click to follow the player.
// A click on a warp or on a neighbor map opens that map (read from ROM); the player does not move.

const mapCanvas = $<HTMLCanvasElement>("map");
const mapCtx = mapCanvas.getContext("2d")!;
let mapView = { x: 0, y: 0, cell: 12 };
let follow = true;
let drag: { x: number; y: number; viewX: number; viewY: number; moved: boolean } | null = null;
let mapNames: string[][] = [];
/** Another map shown instead of the player's map. */
let preview: { grid: MapGrid; actors: MapActors | null } | null = null;
let previewHistory: { group: number; num: number }[] = [];

/** The map that the whole-map view shows now. */
function shown(): { grid: MapGrid | null; actors: MapActors | null } {
  return preview ?? { grid, actors };
}

function resizeMap(): void {
  const rect = mapCanvas.getBoundingClientRect();
  const ratio = window.devicePixelRatio || 1;
  const width = Math.round(rect.width * ratio);
  const height = Math.round(rect.height * ratio);
  // The Doc tab hides the canvas (size 0). When the Lab tab shows again, the size is the same, and fitMap resets the zoom.
  if (width === 0 || (width === mapCanvas.width && height === mapCanvas.height)) return;
  mapCanvas.width = width;
  mapCanvas.height = height;
  const current = shown().grid;
  if (current) fitMap(current);
  if (follow) centerOnPlayer();
  drawMap();
}

/** Zoom so that the whole map (without its border) fits in the view. */
function fitMap(next: MapGrid): void {
  const cell = Math.max(4, Math.min(64, Math.min(mapCanvas.width / (next.mapWidth + 4), mapCanvas.height / (next.mapHeight + 4))));
  mapView = { cell, x: (mapCanvas.width - next.mapWidth * cell) / 2, y: (mapCanvas.height - next.mapHeight * cell) / 2 };
}

function centerOnPlayer(): void {
  const p = actors?.player;
  if (!p || preview) return;
  mapView.x = mapCanvas.width / 2 - (p.x + 0.5) * mapView.cell;
  mapView.y = mapCanvas.height / 2 - (p.y + 0.5) * mapView.cell;
}

function drawMap(): void {
  mapCtx.fillStyle = "#101216";
  mapCtx.fillRect(0, 0, mapCanvas.width, mapCanvas.height);
  const { grid: g, actors: a } = shown();
  if (!g) {
    mapCtx.fillStyle = "#8b929c";
    mapCtx.font = `${14 * (window.devicePixelRatio || 1)}px ui-sans-serif, system-ui`;
    mapCtx.fillText("No map (menu, battle or transition).", 16, 28);
    return;
  }
  draw(mapCtx, g, a, mapView, "map", sight[g.name]);
  // The part of the map that the game screen shows now.
  if (camera && !preview) {
    mapCtx.strokeStyle = "rgba(255, 255, 255, 0.8)";
    mapCtx.lineWidth = 2;
    mapCtx.strokeRect(mapView.x - (camera.x / 16) * mapView.cell, mapView.y - (camera.y / 16) * mapView.cell, 15 * mapView.cell, 10 * mapView.cell);
  }
}

function redraw(): void {
  drawOverlay();
  drawMap();
}

function mapCellAt(event: MouseEvent): [number, number] {
  const rect = mapCanvas.getBoundingClientRect();
  const ratio = mapCanvas.width / rect.width;
  const cx = (event.clientX - rect.left) * ratio;
  const cy = (event.clientY - rect.top) * ratio;
  return [Math.floor((cx - mapView.x) / mapView.cell), Math.floor((cy - mapView.y) / mapView.cell)];
}

function setFollow(on: boolean): void {
  follow = on;
  $("follow").classList.toggle("on", on);
  if (on) {
    centerOnPlayer();
    drawMap();
  }
}

function viewMap(group: number, num: number): void {
  const current = shown().grid;
  if (current) previewHistory.push({ group: current.group, num: current.num });
  send({ type: "view-map", group, num });
}

function backToPlayer(): void {
  preview = null;
  previewHistory = [];
  if (grid) fitMap(grid);
  setFollow(true);
  renderMapLists();
  drawMap();
}

/** The map that a click on this cell opens: a warp destination, or the neighbor map past an edge. */
function linkAt(g: MapGrid, x: number, y: number): { group: number; num: number; name: string } | null {
  const warp = g.warps.find((w) => w.x === x && w.y === y);
  if (warp) return { group: warp.group, num: warp.num, name: warp.to };
  const side = y < 0 ? "north" : y >= g.mapHeight ? "south" : x < 0 ? "west" : x >= g.mapWidth ? "east" : null;
  const conn = side ? g.connections.find((c) => c.direction === side) : undefined;
  return conn ? { group: conn.group, num: conn.num, name: conn.map } : null;
}

mapCanvas.addEventListener("wheel", (event) => {
  event.preventDefault();
  const rect = mapCanvas.getBoundingClientRect();
  const ratio = mapCanvas.width / rect.width;
  const cx = (event.clientX - rect.left) * ratio;
  const cy = (event.clientY - rect.top) * ratio;
  const next = Math.min(64, Math.max(2, mapView.cell * Math.exp(-event.deltaY * 0.002)));
  // Keep the point under the cursor in place.
  mapView = { x: cx - ((cx - mapView.x) * next) / mapView.cell, y: cy - ((cy - mapView.y) * next) / mapView.cell, cell: next };
  if (follow) centerOnPlayer();
  drawMap();
}, { passive: false });

mapCanvas.addEventListener("pointerdown", (event) => {
  drag = { x: event.clientX, y: event.clientY, viewX: mapView.x, viewY: mapView.y, moved: false };
  mapCanvas.setPointerCapture(event.pointerId);
});
mapCanvas.addEventListener("pointermove", (event) => {
  if (drag) {
    const ratio = mapCanvas.width / mapCanvas.getBoundingClientRect().width;
    const dx = (event.clientX - drag.x) * ratio;
    const dy = (event.clientY - drag.y) * ratio;
    if (Math.hypot(dx, dy) > 4) drag.moved = true;
    if (follow && drag.moved) setFollow(false);
    if (!follow) {
      mapView.x = drag.viewX + dx;
      mapView.y = drag.viewY + dy;
      drawMap();
    }
    return showTooltip(null, 0, 0);
  }
  const { grid: g, actors: a } = shown();
  if (!g) return;
  const [x, y] = mapCellAt(event);
  const link = linkAt(g, x, y);
  mapCanvas.style.cursor = link ? "pointer" : "";
  const text = describe(g, a, x, y) ?? (link ? `edge of the map` : null);
  showTooltip(text && link ? `${text}\nclick: see ${link.name}` : text, event.clientX, event.clientY);
});
mapCanvas.addEventListener("pointerup", (event) => {
  const clicked = drag && !drag.moved;
  drag = null;
  const g = shown().grid;
  if (!clicked || !g) return;
  const [x, y] = mapCellAt(event);
  const link = linkAt(g, x, y);
  if (link) viewMap(link.group, link.num);
});
mapCanvas.addEventListener("pointerleave", () => showTooltip(null, 0, 0));
mapCanvas.addEventListener("dblclick", () => (preview ? backToPlayer() : setFollow(true)));
$("follow").addEventListener("click", () => (preview ? backToPlayer() : setFollow(!follow)));
$("map-back").addEventListener("click", () => {
  const previous = previewHistory.pop();
  if (!previous) return;
  if (grid && previous.group === grid.group && previous.num === grid.num && previewHistory.length === 0) return backToPlayer();
  send({ type: "view-map", group: previous.group, num: previous.num });
});
$("map-search").addEventListener("change", (event) => {
  const input = event.target as HTMLInputElement;
  const name = input.value.trim();
  for (let group = 0; group < mapNames.length; group++) {
    const num = mapNames[group].indexOf(name);
    if (num >= 0) {
      viewMap(group, num);
      input.value = "";
      input.blur();
      return;
    }
  }
});
new ResizeObserver(resizeMap).observe(mapCanvas);

function setMapNames(names: string[][]): void {
  mapNames = names;
  $("map-names").innerHTML = names.flat().map((n) => `<option value="${n}"></option>`).join("");
}

function showPreview(next: MapGrid | null, nextActors: MapActors | null): void {
  if (!next) return;
  if (grid && next.key === grid.key) return backToPlayer();
  preview = { grid: next, actors: nextActors };
  setFollow(false);
  fitMap(next);
  renderMapLists();
  drawMap();
}

function linkButton(label: string, group: number, num: number): HTMLButtonElement {
  const b = document.createElement("button");
  b.className = "link";
  b.textContent = label;
  b.addEventListener("click", () => viewMap(group, num));
  return b;
}

function renderMapLists(): void {
  const exits = $("exits");
  const stops = $("stops");
  const { grid: g, actors: a } = shown();
  $("follow").textContent = preview ? "Back to the player" : "Follow the player";
  $("follow").classList.toggle("on", follow && !preview);
  $<HTMLButtonElement>("map-back").hidden = !preview;
  if (!g) {
    exits.textContent = "–";
    stops.textContent = "–";
    $("map-title").textContent = "Whole map";
    return;
  }
  $("map-title").textContent = `${preview ? "Preview" : "Map of the player"} · ${g.name} (${g.mapWidth}×${g.mapHeight})`;
  exits.replaceChildren(
    ...g.connections.map((c) => linkButton(`${c.direction} edge → ${c.map}`, c.group, c.num)),
    ...g.warps.map((w) => linkButton(`warp (${w.x}, ${w.y}) → ${w.to} · ${howLabel(w)}`, w.group, w.num)),
  );
  if (!exits.childElementCount) exits.textContent = "none";
  const stopLines: string[] = [];
  g.triggers.forEach((t, i) => {
    if (t.weather) return;
    const state = a?.triggers[i];
    stopLines.push(`trigger (${t.x}, ${t.y}) · ${state === null ? "state unknown" : state ? "ACTIVE" : "inactive"}`);
  });
  for (const p of a?.people ?? []) {
    if (p.trainer) stopLines.push(`trainer ${p.trainer.id} at (${p.x}, ${p.y}) · sight ${p.trainer.range} · ${p.trainer.defeated ? "defeated" : "not defeated"}`);
  }
  stops.textContent = stopLines.length ? stopLines.join("\n") : "none";
}

function setOverlay(on: boolean): void {
  overlayOn = on;
  $("overlay-toggle").classList.toggle("on", on);
  send({ type: "overlay", enabled: on });
  drawOverlay();
  if (!on) showTooltip(null, 0, 0);
}

/** Browsers allow sound only after a click or a key press. */
function startSound(): void {
  if (!soundOn || audio.running) return;
  void audio.start().then(() => send({ type: "audio", enabled: true }));
}

function setSound(on: boolean): void {
  soundOn = on;
  $("sound").classList.toggle("on", on);
  if (on) {
    startSound();
    if (audio.running) send({ type: "audio", enabled: true });
  } else {
    send({ type: "audio", enabled: false });
    audio.clear();
  }
}

window.addEventListener("pointerdown", startSound);

// The harness trims the Run speed from the queue length (the two clocks drift apart).
setInterval(() => {
  if (soundOn && audio.running) send({ type: "audio-level", ms: audioLevel });
}, 250);

function keyOf(event: KeyboardEvent): number | undefined {
  return KEY_MAP[event.key.length === 1 ? event.key.toLowerCase() : event.key];
}

window.addEventListener("keydown", (event) => {
  if (event.metaKey || event.ctrlKey || event.target instanceof HTMLInputElement || docTab.open) return;
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
  if (key === "g") setOverlay(!overlayOn);
  else if (key === "m") setSound(!soundOn);
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

$("pause").addEventListener("click", () => send({ type: "pause", paused: !paused }));
for (const b of document.querySelectorAll<HTMLButtonElement>("[data-speed]")) {
  b.addEventListener("click", () => {
    const value = b.dataset.speed!;
    send({ type: "speed", speed: (value === "max" ? "max" : Number(value)) as Speed });
  });
}
$("overlay-toggle").addEventListener("click", () => setOverlay(!overlayOn));
$("sound").addEventListener("click", () => setSound(!soundOn));
$("quick-save").addEventListener("click", () => send({ type: "quick-save" }));
$("quick-load").addEventListener("click", () => send({ type: "quick-load" }));
$("reset").addEventListener("click", () => send({ type: "reset" }));
$("start-save").addEventListener("click", () => {
  if (confirm("Write the save of the game as the Starting save?\n(Save in the game first. The old Starting save is kept.)")) {
    send({ type: "write-start-save" });
  }
});

// Buttons keep the focus after a click; give it back so Enter goes to the game.
for (const b of document.querySelectorAll("button")) b.addEventListener("click", () => b.blur());

connect();
