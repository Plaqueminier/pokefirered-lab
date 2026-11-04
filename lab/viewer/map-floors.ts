import type { MapGrid } from "../src/game";

// The map of the player has a border of 7 cells.
const FLOOR_GAP = 9;

const FLOOR = /^(.+)_(B?\d+F|Roof)$/;

export function mapFamily(name: string, names: readonly string[]): string[] {
  const stem = FLOOR.exec(name)?.[1];
  if (!stem) return [name];
  const rank = (floor: string) => (floor === "Roof" ? 1000 : floor.startsWith("B") ? -Number.parseInt(floor.slice(1), 10) : Number.parseInt(floor, 10));
  const floors = names.flatMap((other) => {
    const match = FLOOR.exec(other);
    return match?.[1] === stem ? [{ other, rank: rank(match[2]) }] : [];
  });
  return floors.toSorted((a, b) => a.rank - b.rank).map(({ other }) => other);
}

/** The floors in the order of the family. `dx`: the cell of the view where x 0 of the floor stands. The floor `here` keeps dx 0, so it does not move when another floor loads. */
export function floorLayout(here: MapGrid, family: readonly string[], others: ReadonlyMap<string, MapGrid>): { grid: MapGrid; dx: number }[] {
  const grids = family.flatMap((name) => (name === here.name ? here : (others.get(name) ?? [])));
  if (!grids.includes(here)) return [{ grid: here, dx: 0 }];
  let x = 0;
  const placed = grids.map((grid) => {
    const floor = { grid, dx: x };
    x += grid.mapWidth + FLOOR_GAP;
    return floor;
  });
  const origin = placed.find(({ grid }) => grid === here)?.dx ?? 0;
  return placed.map(({ grid, dx }) => ({ grid, dx: dx - origin }));
}
