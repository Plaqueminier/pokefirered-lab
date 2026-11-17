// RGBA images to PNG files, with no image library: the lab has none, and the machine has no PIL or ImageMagick.
import { deflateSync } from "node:zlib";

export type Image = { width: number; height: number; rgba: Uint8Array };

const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const COLOR_TYPE_RGBA = 6;
const BIT_DEPTH = 8;
const FILTER_NONE = 0;
const SHEET_GAP = 2;
const SHEET_BACKGROUND = [0x40, 0x40, 0x40, 0xff];
const LABEL_SCALE = 2;
const LABEL_PAD = 1;

// A 3 x 5 font for the frame numbers of a contact sheet: one string of 15 bits for each digit, row by row.
const DIGITS = ["111101101101111", "010110010010111", "111001111100111", "111001111001111", "101101111001001", "111100111001111", "111100111101111", "111001001001001", "111101111101111", "111101111001111"];
const DIGIT_WIDTH = 3;
const DIGIT_HEIGHT = 5;

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  out.set(new TextEncoder().encode(type), 4);
  out.set(data, 8);
  view.setUint32(8 + data.length, Bun.hash.crc32(out.subarray(4, 8 + data.length)));
  return out;
}

export function encodePng({ width, height, rgba }: Image): Uint8Array {
  const header = new Uint8Array(13);
  const view = new DataView(header.buffer);
  view.setUint32(0, width);
  view.setUint32(4, height);
  header.set([BIT_DEPTH, COLOR_TYPE_RGBA, 0, 0, 0], 8);
  const row = width * 4;
  const raw = new Uint8Array((row + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (row + 1)] = FILTER_NONE;
    raw.set(rgba.subarray(y * row, (y + 1) * row), y * (row + 1) + 1);
  }
  return Buffer.concat([Uint8Array.from(SIGNATURE), chunk("IHDR", header), chunk("IDAT", deflateSync(raw)), chunk("IEND", new Uint8Array(0))]);
}

/** Each pixel becomes `factor` x `factor` pixels. */
export function scaled(image: Image, factor: number): Image {
  if (factor === 1) return image;
  const width = image.width * factor;
  const height = image.height * factor;
  const rgba = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const from = (Math.floor(y / factor) * image.width + Math.floor(x / factor)) * 4;
      rgba.set(image.rgba.subarray(from, from + 4), (y * width + x) * 4);
    }
  return { width, height, rgba };
}

function fill(image: Image, x0: number, y0: number, width: number, height: number, color: readonly number[]): void {
  for (let y = Math.max(0, y0); y < Math.min(image.height, y0 + height); y++)
    for (let x = Math.max(0, x0); x < Math.min(image.width, x0 + width); x++) image.rgba.set(color, (y * image.width + x) * 4);
}

/** Writes the digits of `text` in white on a black box, at the top left corner (x0, y0). */
function label(image: Image, x0: number, y0: number, text: string): void {
  const digits = [...text].map(Number);
  const step = (DIGIT_WIDTH + 1) * LABEL_SCALE;
  fill(image, x0, y0, digits.length * step + LABEL_PAD * 2 * LABEL_SCALE, (DIGIT_HEIGHT + LABEL_PAD * 2) * LABEL_SCALE, [0, 0, 0, 0xff]);
  digits.forEach((digit, i) => {
    [...DIGITS[digit]].forEach((bit, at) => {
      if (bit !== "1") return;
      const x = x0 + (LABEL_PAD + i * (DIGIT_WIDTH + 1) + (at % DIGIT_WIDTH)) * LABEL_SCALE;
      const y = y0 + (LABEL_PAD + Math.floor(at / DIGIT_WIDTH)) * LABEL_SCALE;
      fill(image, x, y, LABEL_SCALE, LABEL_SCALE, [0xff, 0xff, 0xff, 0xff]);
    });
  });
}

/** The images in a grid of `columns`, row by row, each with its number (for example its frame) at its top left corner. All the images have the size of the first. */
export function contactSheet(images: readonly { image: Image; number: number }[], columns: number): Image {
  const first = images[0]?.image;
  if (!first) throw new Error("a contact sheet needs at least one image");
  const across = Math.min(columns, images.length);
  const down = Math.ceil(images.length / across);
  const sheet: Image = { width: across * first.width + (across + 1) * SHEET_GAP, height: down * first.height + (down + 1) * SHEET_GAP, rgba: new Uint8Array(0) };
  sheet.rgba = new Uint8Array(sheet.width * sheet.height * 4);
  fill(sheet, 0, 0, sheet.width, sheet.height, SHEET_BACKGROUND);
  images.forEach(({ image, number }, i) => {
    const x0 = SHEET_GAP + (i % across) * (first.width + SHEET_GAP);
    const y0 = SHEET_GAP + Math.floor(i / across) * (first.height + SHEET_GAP);
    for (let y = 0; y < image.height; y++) sheet.rgba.set(image.rgba.subarray(y * image.width * 4, (y + 1) * image.width * 4), ((y0 + y) * sheet.width + x0) * 4);
    label(sheet, x0, y0, String(number));
  });
  return sheet;
}
