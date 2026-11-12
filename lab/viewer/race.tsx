import { Eye, EyeOff, PanelRightClose, PanelRightOpen, Pause, Play, Scan } from "lucide-preact";
import { type ComponentChildren, render } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import { GBA_FPS } from "../src/protocol";
import { RACE_VERSION, type RaceFile } from "../src/race/file";
import type { World } from "../src/race/world";
import { Button, Card, Code, Cover, Pill, Slider, Tabs, Tooltip } from "./components";
import { PointerCard, Select } from "./components-layers";
import { Store, useStore } from "./cursor";
import { fitCanvas } from "./race-art";
import { Leaderboard } from "./race-board";
import { GhostsCard } from "./race-cards";
import type { GhostNow, RaceDoor } from "./race-ghosts";
import { type GhostHit, nearestGhost, type RaceHit, RaceView } from "./race-view";

const SPEEDS = [1, 4, 20, 60, 200].map((speed) => ({ id: String(speed), label: `×${speed}` }));
const BAR_REFRESH_MS = 100;
const PANEL_REFRESH_MS = 500;
const SEEK_STEP_FRAMES = 60;
const DRAG_MIN_PIXELS = 4;
const DOOR_CARD_INTERIORS = 3;
const PANEL_CARD_WIDTH = 450;
const PANEL_CARD_HEIGHT = 200;
const DOOR_CARD_WIDTH = 270;
const DOOR_CARD_HEIGHT = 170;

function raceTime(frames: number): string {
  const total = Math.floor(frames / GBA_FPS);
  const minutes = Math.floor(total / 60);
  return `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

type Pointer = { x: number; y: number; client: { x: number; y: number } };

function useRefresh(ms: number): void {
  const [, setTicks] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTicks((ticks) => ticks + 1), ms);
    return () => clearInterval(id);
  }, [ms]);
}

function Count({ n }: { n: number }) {
  return <span class="inline-block w-[3ch] text-right tabular-nums">{n}</span>;
}

function LiveInterior({ view, map, height, hits }: { view: RaceView; map: string; height: number; hits?: { current: GhostHit[] } }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const draw = () => {
      const fitted = ref.current && fitCanvas(ref.current);
      if (!fitted) return;
      const { ctx, width: w, height: h } = fitted;
      ctx.clearRect(0, 0, w, h);
      const drawn = view.drawInterior(ctx, map, { x: 0, y: 0, w, h });
      if (hits) hits.current = drawn;
    };
    view.live.add(draw);
    return () => {
      view.live.delete(draw);
    };
  }, [view, map, hits]);
  return <canvas ref={ref} class="block w-full rounded-ctl bg-bg" style={{ height: `${height}px` }} />;
}

function pointerIn(element: Element, event: MouseEvent): Pointer {
  const box = element.getBoundingClientRect();
  return { x: event.clientX - box.left, y: event.clientY - box.top, client: { x: event.clientX, y: event.clientY } };
}

function HoverInterior({ view, map, height }: { view: RaceView; map: string; height: number }) {
  const hits = useRef<GhostHit[]>([]);
  const [pointer, setPointer] = useState<Pointer | null>(null);
  const hit = pointer && nearestGhost(hits.current, pointer.x, pointer.y);
  return (
    <div onPointerMove={(event) => setPointer(pointerIn(event.currentTarget, event))} onPointerLeave={() => setPointer(null)}>
      <LiveInterior view={view} map={map} height={height} hits={hits} />
      <PointerCard at={hit && pointer ? pointer.client : null} glass>
        {hit && <GhostsCard view={view} ghosts={hit.group} />}
      </PointerCard>
    </div>
  );
}

function interiorHeight(view: RaceView, key: string, width: number, max: number): number {
  const map = view.mapOf(key);
  return map ? Math.min(max, Math.round((width * map.height) / map.width)) : max;
}

function Interiors({ view, interiors }: { view: RaceView; interiors: { map: string; playing: GhostNow[] }[] }) {
  return (
    <div class="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto">
      {interiors.map(({ map, playing }) => (
        <Card key={map} size="sm">
          <div class="mb-2 flex items-center justify-between gap-2">
            <span class="truncate text-sm font-semibold">{view.titleOf(map)}</span>
            <Pill tone={playing.some((ghost) => ghost.battle) ? "info" : undefined}>×{playing.length} in play</Pill>
          </div>
          <HoverInterior view={view} map={map} height={interiorHeight(view, map, PANEL_CARD_WIDTH, PANEL_CARD_HEIGHT)} />
        </Card>
      ))}
    </div>
  );
}

type PanelTab = "leaderboard" | "interiors";

function RacePanel({ view, tab, onTab }: { view: RaceView; tab: PanelTab; onTab: (tab: PanelTab) => void }) {
  useRefresh(PANEL_REFRESH_MS);
  const interiors = [...view.moment.inside.entries()]
    .map(([map, ghosts]) => ({ map, playing: ghosts.filter((ghost) => !ghost.result) }))
    .filter(({ playing }) => playing.length > 0)
    .sort((a, b) => b.playing.length - a.playing.length);
  return (
    <aside class="flex w-[min(500px,60%)] shrink-0 flex-col gap-3 border-l border-line p-3">
      <Tabs
        items={[
          { id: "leaderboard", label: "Leaderboard" },
          { id: "interiors", label: `Interiors in play · ${interiors.length}` },
        ]}
        value={tab}
        onChange={onTab}
      />
      {tab === "leaderboard" ? <Leaderboard view={view} /> : <Interiors view={view} interiors={interiors} />}
    </aside>
  );
}

function DoorCard({ view, door }: { view: RaceView; door: RaceDoor }) {
  return (
    <div class="flex w-[270px] flex-col gap-2">
      <span class="text-xs text-muted">{view.isOpen(door.key) ? "Click to close the building" : "Click to open the building on the map"}</span>
      {door.interiors.slice(0, DOOR_CARD_INTERIORS).map(({ map, ghosts }) => (
        <div key={map}>
          <div class="mb-1 flex items-center justify-between gap-2">
            <span class="truncate text-xs font-semibold">{view.titleOf(map)}</span>
            <Pill>×{ghosts.length}</Pill>
          </div>
          <LiveInterior view={view} map={map} height={interiorHeight(view, map, DOOR_CARD_WIDTH, DOOR_CARD_HEIGHT)} />
        </div>
      ))}
    </div>
  );
}

function HitCard({ view, hit }: { view: RaceView; hit: RaceHit }) {
  if (hit.kind === "open") return <span class="text-xs">Click to close the building</span>;
  return hit.kind === "door" ? <DoorCard view={view} door={hit.door} /> : <GhostsCard view={view} ghosts={hit.ghosts} />;
}

type RaceChoiceProps = { names: readonly string[]; name: string; onName: (name: string) => void };

// A Race of an Evolution is in its folder, `evolutions/<name>/<race>`: one group for each Evolution.
function raceOption(value: string): { value: string; label: string; group?: string } {
  const [, evolution, race] = /^evolutions\/([^/]+)\/(.+)$/.exec(value) ?? [];
  if (!evolution) return { value, label: value };
  const generation = /^generation-(\d+)$/.exec(race)?.[1];
  return { value, label: generation ? `Generation ${Number(generation)}` : race === "bests" ? "The bests" : race, group: `Races of the Evolution ${evolution}` };
}

function RaceChoice({ names, name, onName }: RaceChoiceProps) {
  return (
    <div class="w-24 min-[900px]:w-44">
      <Select options={names.map(raceOption)} value={name} title="Open a Race of the lab" placeholder="Choose a Race" onChange={onName} />
    </div>
  );
}

function IconTip({ tip, pressed, onClick, children }: { tip: string; pressed?: boolean; onClick: () => void; children: ComponentChildren }) {
  return (
    <Tooltip text={tip}>
      <Button size="icon" aria-label={tip} pressed={pressed} onClick={onClick}>
        {children}
      </Button>
    </Tooltip>
  );
}

const BAR = "flex h-14 shrink-0 flex-nowrap items-center gap-3 border-b border-line px-4 [&>*]:shrink-0";

type BarProps = RaceChoiceProps & { view: RaceView; panel: boolean; onPanel: () => void };

function Bar({ view, names, name, onName, panel, onPanel }: BarProps) {
  useRefresh(BAR_REFRESH_MS);
  const { ghosts } = view.moment;
  return (
    <div class={`${BAR} max-[660px]:overflow-x-auto`}>
      <RaceChoice names={names} name={name} onName={onName} />
      <IconTip tip={view.playing ? "Pause" : "Play"} onClick={() => view.togglePlay()}>
        {view.playing ? <Pause size={15} /> : <Play size={15} />}
      </IconTip>
      <Tabs kind="segmented" items={SPEEDS} value={String(view.speed)} onChange={(id) => (view.speed = Number(id))} />
      <div class="min-w-[60px] flex-1 !shrink min-[900px]:min-w-[120px]">
        <Slider value={Math.round(view.frame)} max={view.lastFrame} step={SEEK_STEP_FRAMES} label="Game time" format={raceTime} onSeek={(frame) => view.seek(frame)} />
      </div>
      <span class="w-[8ch] text-right font-mono text-sm tabular-nums">{raceTime(view.frame)}</span>
      <div class="hidden items-center gap-2 min-[1400px]:flex">
        <Pill>
          <Count n={ghosts.length} /> Ghosts
        </Pill>
        <Pill tone="info">
          <Count n={ghosts.filter((ghost) => ghost.battle && !ghost.result).length} /> in battle
        </Pill>
        <Pill>
          <Count n={ghosts.filter((ghost) => ghost.place.kind !== "world").length} /> inside
        </Pill>
        <Pill tone="bad">
          <Count n={ghosts.filter((ghost) => ghost.result).length} /> ended
        </Pill>
      </div>
      <Tooltip text="Frame the Ghosts">
        <Button pressed={view.camera.aim === "all"} aria-label="Frame the Ghosts" onClick={() => view.camera.frameAgain()}>
          <Scan size={15} />
          <span class="hidden min-[1100px]:inline">Frame the Ghosts</span>
        </Button>
      </Tooltip>
      <IconTip tip={view.showMarks ? "Hide the icons on the map" : "Show the icons on the map"} pressed={view.showMarks} onClick={() => (view.showMarks = !view.showMarks)}>
        {view.showMarks ? <Eye size={15} /> : <EyeOff size={15} />}
      </IconTip>
      <IconTip tip={panel ? "Close the panel" : "Open the panel"} pressed={panel} onClick={onPanel}>
        {panel ? <PanelRightClose size={15} /> : <PanelRightOpen size={15} />}
      </IconTip>
    </div>
  );
}

function RaceMap({ view, panel }: { view: RaceView; panel: boolean }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const drag = useRef<{ x: number; y: number; moved: boolean } | null>(null);
  const [pointer, setPointer] = useState<Pointer | null>(null);
  useRefresh(BAR_REFRESH_MS);

  useEffect(() => {
    view.attach(canvas.current);
    setPointer(null);
    return () => view.attach(null);
  }, [view]);
  useEffect(() => view.camera.snap(), [view, panel]);

  const point = (event: MouseEvent) => pointerIn(canvas.current as HTMLCanvasElement, event);
  const onMove = (event: PointerEvent) => {
    const at = point(event);
    const pressed = drag.current;
    if (pressed && (event.buttons & 1) === 1 && (pressed.moved || Math.hypot(at.x - pressed.x, at.y - pressed.y) > DRAG_MIN_PIXELS)) {
      view.camera.pan(at.x - pressed.x, at.y - pressed.y);
      drag.current = { x: at.x, y: at.y, moved: true };
      setPointer(null);
      return;
    }
    setPointer(at);
  };
  const onUp = (event: PointerEvent) => {
    if (event.button !== 0) return;
    const moved = drag.current?.moved;
    drag.current = null;
    if (moved) return;
    const at = point(event);
    const hit = view.hit(at.x, at.y);
    if (hit?.kind === "open") view.closeBuilding(hit.key);
    else if (hit?.kind === "door") {
      if (view.isOpen(hit.door.key)) view.closeBuilding(hit.door.key);
      else view.openBuilding(hit.door);
    } else view.select(hit ? hit.nearest.run : null);
  };
  const hit = pointer && view.hit(pointer.x, pointer.y);
  return (
    <div class="relative min-w-0 flex-1">
      <canvas
        ref={canvas}
        class="absolute inset-0 block size-full cursor-grab touch-none active:cursor-grabbing"
        onWheel={(event) => {
          event.preventDefault();
          const { x, y } = point(event);
          view.camera.zoomAt(x, y, event.deltaY);
        }}
        onPointerDown={(event) => {
          if (event.button !== 0) return;
          drag.current = { ...point(event), moved: false };
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerLeave={() => setPointer(null)}
      />
      <PointerCard at={hit && pointer ? pointer.client : null} glass>
        {hit && <HitCard view={view} hit={hit} />}
      </PointerCard>
    </div>
  );
}

async function fetched(url: string): Promise<Response> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url}: ${await response.text()}`);
  return response;
}

async function readRace(name: string): Promise<RaceFile> {
  const { body } = await fetched(`/race/file/${encodeURIComponent(name)}`);
  if (!body) throw new Error(`the Race ${name} is empty`);
  const race: RaceFile = await new Response(body.pipeThrough(new DecompressionStream("gzip"))).json();
  if (race.version !== RACE_VERSION) throw new Error(`the Race ${name} has the version ${race.version}: make it again with bun run race`);
  return race;
}

// The list of the Races, the Race file and the world.
const LOAD_STEPS = 3;

function RaceRoot({ shown, asked }: { shown: Store<boolean>; asked: Store<{ name: string } | null> }) {
  const visible = useStore(shown);
  const askedRace = useStore(asked);
  const [names, setNames] = useState<string[] | null>(null);
  const [name, setName] = useState("");
  const [view, setView] = useState<RaceView | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [raceError, setRaceError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(0);
  const [panel, setPanel] = useState(true);
  const [panelTab, setPanelTab] = useState<PanelTab>("leaderboard");
  const world = useRef<Promise<World> | null>(null);

  useEffect(() => {
    if (!visible) return;
    fetched("/race/list.json")
      .then((response) => response.json())
      .then((list: string[]) => {
        setListError(null);
        setNames(list);
        // The Races of the Evolutions come after the Races of the lab: the last Race of the lab opens first.
        setName((current) => current || (list.findLast((race) => !race.startsWith("evolutions/")) ?? list.at(-1) ?? ""));
      })
      .catch((failure) => setListError(String(failure)));
  }, [visible]);

  useEffect(() => {
    if (askedRace) setName(askedRace.name);
  }, [askedRace]);

  useEffect(() => {
    if (!name) return;
    setView(null);
    setRaceError(null);
    setLoaded(1);
    world.current ??= fetched("/race/world.json").then((response) => response.json());
    let cancelled = false;
    const step = <T,>(value: T) => {
      if (!cancelled) setLoaded((steps) => steps + 1);
      return value;
    };
    Promise.all([readRace(name).then(step), world.current.then(step)])
      .then(([race, kanto]) => {
        if (!cancelled) setView(new RaceView(race, kanto));
      })
      .catch((failure) => {
        world.current = null;
        if (!cancelled) setRaceError(String(failure));
      });
    return () => {
      cancelled = true;
    };
  }, [name]);

  useEffect(() => {
    if (!visible || !view) return;
    let id = requestAnimationFrame(function loop(time) {
      view.tick(time);
      id = requestAnimationFrame(loop);
    });
    return () => cancelAnimationFrame(id);
  }, [visible, view]);

  if (!visible) return null;
  if (listError) return <div class="p-6 text-bad">{listError}</div>;
  if (names?.length === 0)
    return (
      <div class="p-6 text-muted">
        No Race in the lab yet. Make one with <Code>bun run race &lt;name&gt;</Code>.
      </div>
    );
  if (!names || !view)
    return (
      <div class="flex h-full min-h-0 flex-col">
        <div class={BAR}>{names && <RaceChoice names={names} name={name} onName={setName} />}</div>
        {raceError ? (
          <div class="p-6 text-bad">{raceError}</div>
        ) : (
          <Cover busy title="Loading the Race and the world of Kanto" value={loaded} max={LOAD_STEPS}>
            <div class="min-h-[240px]" />
          </Cover>
        )}
      </div>
    );
  return (
    <div class="flex h-full min-h-0 flex-col">
      <Bar view={view} names={names} name={name} onName={setName} panel={panel} onPanel={() => setPanel((open) => !open)} />
      <div class="flex min-h-0 flex-1">
        <RaceMap view={view} panel={panel} />
        {panel && <RacePanel view={view} tab={panelTab} onTab={setPanelTab} />}
      </div>
    </div>
  );
}

export class RaceTab {
  readonly #shown = new Store(false);
  // A new object at each ask: the same Race asked again opens again after a change of the Select.
  readonly #asked = new Store<{ name: string } | null>(null);

  constructor(root: HTMLElement) {
    render(<RaceRoot shown={this.#shown} asked={this.#asked} />, root);
  }

  /** Opens this Race, for example a Race of an Evolution from the page of the Evolutions. */
  open(name: string): void {
    this.#asked.set({ name });
  }

  onTab(shown: boolean): void {
    this.#shown.set(shown);
  }
}
