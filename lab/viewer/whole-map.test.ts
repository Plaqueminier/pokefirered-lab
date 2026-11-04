import { expect, test } from "bun:test";
import type { MapActors, MapGrid } from "../src/game";
import { Store } from "./cursor";
import type { CellTip } from "./mapdraw";
import { WholeMap } from "./whole-map";

const grid = (name: string) => ({ key: name, name, group: 0, num: 0, x0: 0, y0: 0, width: 1, height: 1, mapWidth: 1, mapHeight: 1, kinds: ".", warps: [], connections: [], signs: [], triggers: [] }) as unknown as MapGrid;
const actors = { player: { x: 0, y: 0, facing: 1 }, people: [], obstacles: [], triggers: [], signs: [] } as unknown as MapActors;

function wholeMap() {
  return new WholeMap(() => {}, new Store<CellTip | null>(null));
}

test("in a battle, the map keeps the last grid and player of the same Run, and it tells that this is the last map", () => {
  const map = wholeMap();
  map.onRun("bot 1");
  map.onMap(grid("Cave"));
  map.onActors(actors);
  map.onMap(null);
  map.onActors(null);
  expect(map.state.value).toMatchObject({ grid: { name: "Cave" }, actors, lastSeen: true });
  map.onMap(grid("Cave"));
  expect(map.state.value.lastSeen).toBe(false);
});

test("another Run does not keep the map of the Run before it", () => {
  const map = wholeMap();
  map.onRun("bot 1");
  map.onMap(grid("Cave"));
  map.onMap(null);
  map.onRun("bot 2");
  expect(map.state.value.grid).toBeNull();
});

test("another replay is another Run, also while the game shows no map", () => {
  const map = wholeMap();
  map.onRun("viewer a");
  map.onMap(grid("Cave"));
  map.onMap(null);
  map.onRun("viewer b");
  expect(map.state.value.grid).toBeNull();
});

test("the server sends the map of a new Run before its status, and this map stays", () => {
  const map = wholeMap();
  map.onRun("bot 1");
  map.onMap(grid("Cave"));
  map.onMap(grid("Town"));
  map.onRun("bot 2");
  expect(map.state.value.grid?.name).toBe("Town");
});

test("the map asks once for the other floors of its family, and for no floor on another map", () => {
  const sent: unknown[] = [];
  const map = new WholeMap((message) => sent.push(message), new Store<CellTip | null>(null));
  map.onNames([["MtMoon_1F", "MtMoon_B1F", "MtMoon_B2F", "Route4"]]);
  map.onMap(grid("MtMoon_B1F"));
  expect(sent).toEqual([{ type: "view-floors", names: ["MtMoon_B2F", "MtMoon_1F"] }]);
  map.onMap(grid("Route4"));
  expect(sent.length).toBe(1);
});
