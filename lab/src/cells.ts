export type Direction = "south" | "north" | "west" | "east";

export const KIND = { blocked: "#", water: "~", surf: "≈", grass: '"', open: "." } as const;
export const LEDGE: Record<Direction, string> = { north: "^", south: "v", west: "<", east: ">" };
export const SPIN: Record<Direction, string> = { north: "↑", south: "↓", west: "←", east: "→" };
export const STOP = "o";
export const WALL: Record<Direction, string> = { north: "-", south: "_", west: "[", east: "]" };
/** The elevation of a cell is in bits 12-15 of its grid value. */
export const ELEVATION_SHIFT = 12;
export const DIRECTION_STEP: Record<Direction, [number, number]> = { north: [0, -1], south: [0, 1], west: [-1, 0], east: [1, 0] };
export const DIRECTION_STEPS = Object.entries(DIRECTION_STEP) as [Direction, [number, number]][];
export const OPPOSITE: Record<Direction, Direction> = { north: "south", south: "north", west: "east", east: "west" };

export function withSurf(kinds: string, surf: boolean): string {
  return surf ? kinds.replaceAll(KIND.water, KIND.surf) : kinds;
}
