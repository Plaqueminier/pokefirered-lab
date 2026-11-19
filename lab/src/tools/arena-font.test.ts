import { describe, expect, test } from "bun:test";
import { FONT_PNG, FONT_TEXT, fontPng, GFX_SOURCE, parseFont, withWidths } from "./arena-font";

describe("the small font of the Arena", () => {
  test("font_small.png and the widths of arena_gfx.c are the ones of font_small.txt: run bun run arena-font after a change", async () => {
    const font = parseFont(await Bun.file(FONT_TEXT).text());
    expect(new Uint8Array(await Bun.file(FONT_PNG).arrayBuffer())).toEqual(new Uint8Array(fontPng(font)));
    const source = await Bun.file(GFX_SOURCE).text();
    expect(withWidths(source, font)).toBe(source);
  });

  test("a glyph is as wide as its pixels plus 1, or as its header says, and an accent goes at the center of its base", () => {
    const { glyphs } = parseFont(["BB A 3", "###", "#.#", "", "00 space 0 3", "", "dot - 0", "#", "", "01 À = BB + dot 1"].join("\n"));
    expect(glyphs[0xbb]?.width).toBe(4);
    expect(glyphs[0x00]?.width).toBe(3);
    expect(glyphs[0x01]?.rows.slice(0, 5)).toEqual([0, 0b010, 0, 0b111, 0b101]);
  });

  test("a line that is not a glyph, or an accent with no base, is refused", () => {
    expect(() => parseFont("BB A")).toThrow("not a glyph header");
    expect(() => parseFont("01 À = BB + dot 1")).toThrow("draw BB and dot");
  });

  test("a code drawn two times, or a glyph that is not a code and that no accent uses, is refused", () => {
    expect(() => parseFont(["BB A 3", "#", "", "BB A 3", "##"].join("\n"))).toThrow("line 4: BB is already drawn at line 1");
    expect(() => parseFont(["bb A 3", "#"].join("\n"))).toThrow("line 1: bb is not a code, and no accented glyph uses it");
  });
});
