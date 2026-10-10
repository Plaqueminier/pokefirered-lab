// The Viewer: shows one Run and sends keyboard input to the harness.
import type { Cell, GameState, Overlay } from "../src/game";
import { AudioOut } from "./audio";
import { BinaryKind, Keys, type ClientMessage, type ServerMessage, type Speed } from "../src/protocol";

const SCALE = 3;
const CELL = 16 * SCALE;

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
let lastOverlay: Overlay | null = null;
let soundOn = true;
let audioLevel = 0;
const audio = new AudioOut((ms) => (audioLevel = ms));

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
    $("status").textContent = "déconnecté, nouvelle tentative…";
    setTimeout(connect, 1000);
  };
}

function onMessage(message: ServerMessage): void {
  switch (message.type) {
    case "status": {
      paused = message.paused;
      $("pause").classList.toggle("on", paused);
      for (const b of document.querySelectorAll<HTMLButtonElement>("[data-speed]")) {
        b.classList.toggle("on", String(message.speed) === b.dataset.speed);
      }
      $<HTMLButtonElement>("quick-load").disabled = !message.hasQuickState;
      $("sound").classList.toggle("on", soundOn);
      $("status").textContent =
        `${message.rom} · image ${message.frame} · ${message.fps} img/s` +
        (!soundOn ? " · son coupé" : !audio.running ? " · son : cliquez ou appuyez sur une touche" : message.audio ? ` · son ${Math.round(audioLevel)} ms` : " · son seulement à ×1") +
        (message.hasStartSave ? "" : " · pas encore de sauvegarde de départ");
      break;
    }
    case "state":
      renderState(message.state);
      break;
    case "overlay":
      lastOverlay = message.overlay;
      drawOverlay();
      break;
    case "notice":
      $("notice").textContent = message.text;
      break;
  }
}

const MODE_LABEL = { overworld: "Sur la carte", battle: "En combat", other: "Menu / transition" };

function renderState(state: GameState): void {
  // Before the player is on a map, the location fields are not set yet.
  $("map-name").textContent = state.player ? state.map.name : "–";
  $("map-pos").textContent = state.player
    ? `groupe ${state.map.group}, carte ${state.map.num} · x ${state.player.x}, y ${state.player.y}`
    : "";
  $("mode").textContent = MODE_LABEL[state.context.mode];
  $("callbacks").textContent = `callback2 ${state.context.callback2}\ncallback1 ${state.context.callback1}`;
  $("callbacks").style.whiteSpace = "pre";
  const party = $("party");
  party.classList.toggle("muted", state.party.length === 0);
  party.innerHTML = state.party.length === 0 ? "aucun Pokémon" : "";
  for (const mon of state.party) {
    const row = document.createElement("div");
    row.className = "mon";
    const pct = mon.maxHp > 0 ? Math.round((100 * mon.hp) / mon.maxHp) : 0;
    row.innerHTML = `<span></span><span class="mono"></span><div class="hp"><div style="width:${pct}%"></div></div>`;
    row.children[0].textContent = mon.nickname === mon.species ? mon.species : `${mon.nickname} (${mon.species})`;
    row.children[1].textContent = `N.${mon.level}  ${mon.hp}/${mon.maxHp} PV`;
    party.append(row);
  }
  $("badges").innerHTML = state.badges.map((got) => `<div class="badge${got ? " got" : ""}"></div>`).join("");
  $("money").textContent = `${state.money} ₽`;
}

const KIND_FILL: Record<Cell["kind"], string | null> = {
  blocked: "rgba(224, 70, 70, 0.45)",
  water: "rgba(60, 130, 230, 0.45)",
  grass: "rgba(80, 200, 110, 0.3)",
  ledge: null,
  open: null,
};
const ARROW: Record<string, string> = { north: "↑", south: "↓", east: "→", west: "←" };

function cellRect(overlay: Overlay, x: number, y: number): [number, number] {
  const first = overlay.cells[0];
  return [(overlay.originX + (x - first.x) * 16) * SCALE, (overlay.originY + (y - first.y) * 16) * SCALE];
}

function drawOverlay(): void {
  overlayCtx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
  const overlay = lastOverlay;
  if (!overlayOn || !overlay) return;
  overlayCtx.font = `bold ${CELL * 0.6}px ui-sans-serif, system-ui`;
  overlayCtx.textAlign = "center";
  overlayCtx.textBaseline = "middle";
  for (const cell of overlay.cells) {
    const [px, py] = cellRect(overlay, cell.x, cell.y);
    const fill = KIND_FILL[cell.kind];
    if (fill) {
      overlayCtx.fillStyle = fill;
      overlayCtx.fillRect(px, py, CELL, CELL);
    }
    overlayCtx.strokeStyle = "rgba(255, 255, 255, 0.12)";
    overlayCtx.strokeRect(px + 0.5, py + 0.5, CELL - 1, CELL - 1);
    if (cell.ledge) {
      overlayCtx.fillStyle = "rgba(255, 255, 255, 0.95)";
      overlayCtx.fillText(ARROW[cell.ledge], px + CELL / 2, py + CELL / 2);
    }
  }
  for (const warp of overlay.warps) {
    const [px, py] = cellRect(overlay, warp.x, warp.y);
    overlayCtx.fillStyle = "rgba(170, 90, 230, 0.6)";
    overlayCtx.fillRect(px + 4, py + 4, CELL - 8, CELL - 8);
  }
  for (const event of overlay.events) {
    const [px, py] = cellRect(overlay, event.x, event.y);
    overlayCtx.strokeStyle = "rgba(255, 150, 40, 0.9)";
    overlayCtx.lineWidth = 3;
    overlayCtx.strokeRect(px + 6, py + 6, CELL - 12, CELL - 12);
    overlayCtx.lineWidth = 1;
  }
  for (const npc of overlay.npcs) {
    const [px, py] = cellRect(overlay, npc.x, npc.y);
    overlayCtx.fillStyle = "rgba(240, 200, 40, 0.7)";
    overlayCtx.beginPath();
    overlayCtx.arc(px + CELL / 2, py + CELL / 2, CELL / 3, 0, Math.PI * 2);
    overlayCtx.fill();
  }
}

function describeCell(overlay: Overlay, x: number, y: number): string | null {
  const cell = overlay.cells.find((c) => c.x === x && c.y === y);
  if (!cell) return null;
  const lines = [
    `case (${cell.x}, ${cell.y})`,
    `metatile  ${cell.metatile} (0x${cell.metatile.toString(16)})`,
    `collision ${cell.collision}${cell.collision ? " (bloqué)" : ""}`,
    `hauteur   ${cell.elevation}`,
    `${cell.behavior}`,
  ];
  for (const w of overlay.warps) if (w.x === x && w.y === y) lines.push(`warp → ${w.to}`);
  for (const e of overlay.events) if (e.x === x && e.y === y) lines.push(e.kind === "sign" ? "panneau / objet caché" : "déclencheur (script)");
  if (overlay.npcs.some((n) => n.x === x && n.y === y)) lines.push("PNJ");
  return lines.join("\n");
}

$("screen").addEventListener("mousemove", (event) => {
  const overlay = lastOverlay;
  if (!overlayOn || !overlay) {
    tooltip.style.display = "none";
    return;
  }
  const rect = overlayCanvas.getBoundingClientRect();
  const sx = ((event.clientX - rect.left) / rect.width) * 240;
  const sy = ((event.clientY - rect.top) / rect.height) * 160;
  const first = overlay.cells[0];
  const x = first.x + Math.floor((sx - overlay.originX) / 16);
  const y = first.y + Math.floor((sy - overlay.originY) / 16);
  const text = describeCell(overlay, x, y);
  tooltip.style.display = text ? "block" : "none";
  if (text) {
    tooltip.textContent = text;
    tooltip.style.left = `${Math.min(event.clientX - rect.left + 14, rect.width - 220)}px`;
    tooltip.style.top = `${event.clientY - rect.top + 14}px`;
  }
});
$("screen").addEventListener("mouseleave", () => (tooltip.style.display = "none"));

function setOverlay(on: boolean): void {
  overlayOn = on;
  $("overlay-toggle").classList.toggle("on", on);
  send({ type: "overlay", enabled: on });
  if (!on) {
    lastOverlay = null;
    drawOverlay();
    tooltip.style.display = "none";
  }
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
  if (event.metaKey || event.ctrlKey) return;
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
  const bit = keyOf(event);
  if (bit !== undefined && keys & bit) {
    keys &= ~bit;
    send({ type: "keys", keys });
  }
});

window.addEventListener("blur", () => {
  keys = 0;
  send({ type: "keys", keys });
});

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
  if (confirm("Écrire l'état de la sauvegarde du jeu comme sauvegarde de départ ?\n(Sauvegardez d'abord dans le jeu. L'ancienne est gardée.)")) {
    send({ type: "write-start-save" });
  }
});

// Buttons keep the focus after a click; give it back so Enter goes to the game.
for (const b of document.querySelectorAll("button")) b.addEventListener("click", () => b.blur());

connect();
