import { expect, test } from "bun:test";
import { runIdText } from "../src/protocol";
import { GHOST_PEOPLE } from "../src/race/world";
import { FRAME_WIDTH, type GhostPart, ghostSheet, SHEET_HEIGHT, SHEET_WIDTH } from "./race-sprite";

const WHITE = [255, 255, 255];
const BLACK = [0, 0, 0];
const SKIN = [[255, 213, 180], [246, 189, 148], [222, 148, 115], [123, 65, 65]];
const RAMP = [[255, 0, 1], [200, 0, 2], [100, 0, 3]];
const PALETTE = [0, 0, 0, ...SKIN.flat(), ...RAMP.flat(), ...RAMP.flat(), ...RAMP.flat(), ...WHITE, ...BLACK];

function part(name: string, layout: GhostPart["layout"], row = (y: number) => y % 16): GhostPart {
  const indices = new Uint8Array(SHEET_WIDTH * SHEET_HEIGHT);
  for (let y = 0; y < SHEET_HEIGHT; y++) indices.fill(row(y), y * SHEET_WIDTH, (y + 1) * SHEET_WIDTH);
  return { name, layout, indices, palette: PALETTE };
}

const PEOPLE = GHOST_PEOPLE.map((name) => part(name, "people"));

function pixel(rgba: Uint8ClampedArray, x: number, y: number): number[] {
  return [...rgba.subarray((y * SHEET_WIDTH + x) * 4, (y * SHEET_WIDTH + x) * 4 + 4)];
}

function hashOf(rgba: Uint8ClampedArray): string {
  return Bun.hash.crc32(rgba).toString(16);
}

test("the same id gives the same bytes, and 1000 ids give 1000 sheets", () => {
  expect(ghostSheet("00017", PEOPLE).rgba).toEqual(ghostSheet("00017", PEOPLE).rgba);
  const hashes = new Set(Array.from({ length: 1000 }, (_, i) => hashOf(ghostSheet(runIdText(i + 1), PEOPLE).rgba)));
  expect(hashes.size).toBe(1000);
});

test("pinned faces: an id keeps its head, its body and its colours", () => {
  const faces = ["00001", "00017", "00032", "01000"].map((id) => {
    const { head, body, rgba } = ghostSheet(id, PEOPLE);
    return [id, head, body, hashOf(rgba)];
  });
  expect(faces).toEqual([
    ["00001", "rs_brendan", "woman_2", "afef19fa"],
    ["00017", "youngster", "picnicker", "fa6ec72d"],
    ["00032", "rich_boy", "crush_girl", "b8956e80"],
    ["01000", "worker_m", "bill", "f39c3b8f"],
  ]);
});

test("the people: a skin index gets a skin tone, black and white stay, index 0 stays clear, and a ramp gets a new colour", () => {
  for (let n = 1; n <= 50; n++) {
    const { rgba } = ghostSheet(runIdText(n), PEOPLE);
    expect(pixel(rgba, 0, 0)[3]).toBe(0);
    expect(pixel(rgba, 0, 14)).toEqual([...WHITE, 255]);
    expect(pixel(rgba, 0, 15)).toEqual([...BLACK, 255]);
    const [red, green, blue] = pixel(rgba, 0, 1);
    expect(red).toBeGreaterThanOrEqual(green);
    expect(green).toBeGreaterThanOrEqual(blue);
    expect(pixel(rgba, 0, 5).slice(0, 3)).not.toEqual(RAMP[0]);
  }
});

test("the player sprites have their own layout of the palette: indices 9 and 10 stay, and 5 gets a new colour", () => {
  const { rgba } = ghostSheet("00017", GHOST_PEOPLE.map((name) => part(name, "player")));
  expect(pixel(rgba, 0, 9).slice(0, 3)).toEqual(RAMP[1]);
  expect(pixel(rgba, 0, 10).slice(0, 3)).toEqual(RAMP[2]);
  expect(pixel(rgba, 0, 5).slice(0, 3)).not.toEqual(RAMP[0]);
});

test("the head is the rows above row 23, and 1 row more on a walk frame", () => {
  const id = Array.from({ length: 50 }, (_, i) => runIdText(i + 1)).find((other) => ghostSheet(other, PEOPLE).head !== ghostSheet(other, PEOPLE).body) as string;
  const { head } = ghostSheet(id, PEOPLE);
  const WHITE_INDEX = 14;
  const BLACK_INDEX = 15;
  const { rgba } = ghostSheet(id, GHOST_PEOPLE.map((name) => part(name, "people", () => (name === head ? WHITE_INDEX : BLACK_INDEX))));
  const standFrame = 0;
  const walkFrame = 3;
  expect(pixel(rgba, standFrame * FRAME_WIDTH, 22).slice(0, 3)).toEqual(WHITE);
  expect(pixel(rgba, standFrame * FRAME_WIDTH, 23).slice(0, 3)).toEqual(BLACK);
  expect(pixel(rgba, walkFrame * FRAME_WIDTH, 23).slice(0, 3)).toEqual(WHITE);
  expect(pixel(rgba, walkFrame * FRAME_WIDTH, 24).slice(0, 3)).toEqual(BLACK);
});
