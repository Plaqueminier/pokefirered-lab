import { describe, expect, test } from "bun:test";
import { inflateSync } from "node:zlib";
import { Keys } from "../protocol";
import { contactSheet, encodePng, type Image, scaled } from "./png";
import { keysAt, parsePresses, shotFrames } from "./shot";

function image(width: number, height: number, color: number[]): Image {
  const rgba = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i++) rgba.set(color, i * 4);
  return { width, height, rgba };
}

function pixel({ width, rgba }: Image, x: number, y: number): number[] {
  return [...rgba.subarray((y * width + x) * 4, (y * width + x) * 4 + 4)];
}

describe("the presses of a shot", () => {
  test("a press has a frame, buttons joined with +, and the frames held (4 when it has none)", () => {
    expect(parsePresses("120:A 300:start, 360:Down+B/16")).toEqual([
      { frame: 120, keys: Keys.A, hold: 4 },
      { frame: 300, keys: Keys.Start, hold: 4 },
      { frame: 360, keys: Keys.Down | Keys.B, hold: 16 },
    ]);
    expect(parsePresses("")).toEqual([]);
  });

  test("a press with no frame or with an unknown button is refused", () => {
    expect(() => parsePresses("A")).toThrow("<frame>:<button>");
    expect(() => parsePresses("10:X")).toThrow('no button "X"');
  });

  test("the game gets the keys of each press from its frame, for the frames held", () => {
    const presses = parsePresses("10:A/2 11:B");
    expect([9, 10, 11, 12, 14, 15].map((frame) => keysAt(presses, frame))).toEqual([0, Keys.A, Keys.A | Keys.B, Keys.B, Keys.B, 0]);
  });

  test("the shots are each `every` frames, the frames of --at and the last frame, in order and once", () => {
    expect(shotFrames(250, 100, [50, 100, 900])).toEqual([50, 100, 200, 250]);
    expect(shotFrames(30, null, [])).toEqual([30]);
  });
});

describe("the PNG file", () => {
  test("it has the signature, the size and the rows of the image with filter 0", () => {
    const png = encodePng(image(2, 1, [1, 2, 3, 255]));
    const view = new DataView(png.buffer, png.byteOffset);
    expect([...png.subarray(1, 4)]).toEqual([..."PNG"].map((c) => c.charCodeAt(0)));
    expect([view.getUint32(16), view.getUint32(20)]).toEqual([2, 1]);
    const idat = 8 + 25;
    const data = png.subarray(idat + 8, idat + 8 + view.getUint32(idat));
    expect([...inflateSync(data)]).toEqual([0, 1, 2, 3, 255, 1, 2, 3, 255]);
    expect(view.getUint32(idat + 8 + data.length)).toBe(Bun.hash.crc32(png.subarray(idat + 4, idat + 8 + data.length)));
  });

  test("a scale of 2 makes each pixel 2 x 2 pixels", () => {
    const big = scaled({ width: 2, height: 1, rgba: Uint8Array.from([1, 1, 1, 255, 9, 9, 9, 255]) }, 2);
    expect([big.width, big.height]).toEqual([4, 2]);
    expect([pixel(big, 1, 1), pixel(big, 2, 0)]).toEqual([[1, 1, 1, 255], [9, 9, 9, 255]]);
  });

  test("a contact sheet puts the images in rows, with a gap, and the number of each image at its top left corner", () => {
    const red = image(20, 12, [255, 0, 0, 255]);
    const sheet = contactSheet([0, 1, 2].map((number) => ({ image: red, number })), 2);
    expect([sheet.width, sheet.height]).toEqual([2 * 20 + 3 * 2, 2 * 12 + 3 * 2]);
    expect(pixel(sheet, 0, 0)).toEqual([0x40, 0x40, 0x40, 255]);
    expect(pixel(sheet, 2 + 19, 2 + 11)).toEqual([255, 0, 0, 255]);
    expect(pixel(sheet, 2, 2)).toEqual([0, 0, 0, 255]);
    expect(pixel(sheet, 4, 4)).toEqual([255, 255, 255, 255]);
    expect(pixel(sheet, 2 + 22 + 19, 2 + 14 + 11)).toEqual([0x40, 0x40, 0x40, 255]);
  });
});
