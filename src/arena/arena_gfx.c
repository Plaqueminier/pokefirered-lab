#include "global.h"
#include "arena_internal.h"
#include "string_util.h"
#include "characters.h"

// The big font is Jersey 10, under the SIL Open Font License (graphics/arena/OFL.txt).
// The small font has the shapes of Jersey 10 at a smaller size. Its glyphs are text in graphics/arena/font_small.txt:
// `bun run arena-font` in lab/ writes its PNG and sFontSmallWidths.
// Each width includes the space after the glyph.
static const u8 sFontBigGlyphs[] = INCBIN_U8("graphics/arena/font_big.1bpp");
static const u8 sFontSmallGlyphs[] = INCBIN_U8("graphics/arena/font_small.1bpp");

static const u8 sFontBigWidths[256] =
{
     4,  8,  8,  8,  8,  7,  7,  7,  7,  3,  0,  4,  4,  8,  8,  8,
    11,  8,  8,  8,  9,  8,  8,  8,  0,  8,  8,  8,  8,  8,  3,  0,
     4,  4,  8,  8,  8, 12,  8,  8,  8,  8,  8,  8,  0, 11,  7,  0,
     0,  0,  0,  0,  0,  7,  3,  0,  0,  0,  0,  0,  0,  0,  0,  0,
     0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,
     0,  7,  3,  0,  0,  0,  0,  0,  0,  0,  3, 12,  5,  5,  0,  0,
     0,  0,  0,  0,  0,  0,  0,  0,  8,  0,  0,  0,  0,  0,  0,  3,
     0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,
     0,  0,  0,  0,  0,  9,  9,  0,  0,  0,  0,  0,  0,  0,  0,  0,
     0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,
     0,  7,  4,  8,  8,  7,  7,  8,  7,  8,  8,  3,  7,  3,  7,  3,
     9,  6,  6,  3,  3,  0,  0,  9,  3,  8,  6,  8,  8,  8,  8,  7,
     7,  8,  8,  3,  7,  7,  6, 10,  9,  8,  8,  8,  8,  8,  7,  8,
     8, 11,  8,  9,  9,  8,  8,  8,  8,  8,  6,  8,  8,  3,  4,  7,
     3, 11,  8,  8,  8,  8,  7,  7,  6,  8,  8, 11,  8,  7,  8,  7,
     3,  8,  8,  8,  8,  8,  8,  0,  0,  0,  0,  0,  0,  0,  0,  8,
};

static const u8 sFontSmallWidths[256] =
{
     3,  7,  7,  7,  7,  6,  6,  6,  6,  4,  0,  5,  5,  7,  7,  7,
     8,  7,  7,  7,  7,  7,  7,  7,  0,  7,  7,  7,  7,  7,  4,  0,
     5,  5,  7,  7,  7,  9,  7,  7,  7,  7,  5,  5,  0,  7,  7,  0,
     0,  0,  0,  0,  0,  6,  4,  0,  0,  0,  0,  0,  0,  0,  0,  0,
     0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,
     0,  7,  3,  0,  0,  0,  0,  0,  0,  0,  4,  7,  4,  4,  0,  0,
     0,  0,  0,  0,  0,  0,  0,  0,  7,  0,  0,  0,  0,  0,  0,  4,
     0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,
     0,  0,  0,  0,  0,  5,  5,  0,  0,  0,  0,  0,  0,  0,  0,  0,
     0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,
     0,  7,  4,  7,  7,  7,  7,  7,  6,  7,  7,  3,  7,  3,  5,  3,
     9,  6,  6,  3,  3,  0,  0,  7,  4,  6,  5,  7,  7,  7,  7,  6,
     6,  7,  7,  3,  6,  7,  6,  8,  7,  7,  7,  7,  7,  7,  7,  7,
     7,  9,  7,  7,  7,  7,  7,  7,  7,  7,  6,  7,  7,  3,  4,  7,
     3,  9,  7,  7,  7,  7,  6,  7,  5,  7,  7,  9,  7,  7,  7,  6,
     3,  7,  7,  7,  7,  7,  7,  0,  0,  0,  0,  0,  0,  0,  0,  0,
};

struct ArenaFont
{
    const u8 *glyphs;
    const u8 *widths;
    u8 cellTilesWide;
    u8 baseline;
    u8 capHeight;
    u8 rows;
};

static const struct ArenaFont sFonts[] =
{
    [ARENA_FONT_SMALL] = {sFontSmallGlyphs, sFontSmallWidths, 1, 10, 7, 13},
    [ARENA_FONT_BIG] = {sFontBigGlyphs, sFontBigWidths, 2, 13, 10, 16},
};

static inline void WriteMasked(u32 *word, u32 pixels, u32 mask)
{
    *word = (*word & ~mask) | (pixels & mask);
}

void ArenaCanvas_Pixel(const struct ArenaCanvas *canvas, s32 x, s32 y, u8 color)
{
    if (x >= 0 && x < canvas->tilesWide * 8 && y >= canvas->top && y < canvas->top + canvas->height)
        WriteMasked(ArenaCanvas_RowWord(canvas, x, y), color * 0x11111111, 0xF << ((x & 7) * 4));
}

// The caller clips the rectangle to the canvas first.
static void FillRows(const struct ArenaCanvas *canvas, s32 x, s32 y, s32 x1, s32 y1, u32 pattern)
{
    u32 maskLeft = 0xFFFFFFFF << ((x & 7) * 4);
    u32 maskRight = 0xFFFFFFFF >> ((7 - ((x1 - 1) & 7)) * 4);
    u32 middle = ((x1 - 1) >> 3) - (x >> 3);
    u32 line = (y - canvas->top) & 7;
    u32 *word, *row;
    s32 i;

    if (x >= x1 || y >= y1)
        return;
    if (middle == 0)
        maskLeft &= maskRight;
    row = ArenaCanvas_RowWord(canvas, x, y);
    for (; y < y1; y++)
    {
        word = row;
        WriteMasked(word, pattern, maskLeft);
        if (middle != 0)
        {
            for (i = middle - 1; i > 0; i--)
            {
                word += 8;
                *word = pattern;
            }
            WriteMasked(word + 8, pattern, maskRight);
        }
        if (++line == 8)
        {
            line = 0;
            row += canvas->tilesWide * 8 - 7;
        }
        else
        {
            row++;
        }
    }
}

// pattern is one 4bpp tile row. CpuFastSet fills blocks of 32 bytes, one tile, so it fills only the whole tiles;
// the edges use masks.
void ArenaCanvas_FillPattern(const struct ArenaCanvas *canvas, s32 x, s32 y, s32 w, s32 h, u32 pattern)
{
    s32 x1 = min(x + w, canvas->tilesWide * 8);
    s32 y1 = min(y + h, canvas->top + canvas->height);
    s32 tileX0, tileX1, tileY0, tileY1, ty;

    x = max(x, 0);
    y = max(y, canvas->top);
    tileX0 = (x + 7) & ~7;
    tileX1 = x1 & ~7;
    tileY0 = canvas->top + ((y - canvas->top + 7) & ~7);
    tileY1 = canvas->top + ((y1 - canvas->top) & ~7);
    if (tileX0 >= tileX1 || tileY0 >= tileY1)
    {
        FillRows(canvas, x, y, x1, y1, pattern);
        return;
    }
    FillRows(canvas, x, y, x1, tileY0, pattern);
    FillRows(canvas, x, tileY1, x1, y1, pattern);
    FillRows(canvas, x, tileY0, tileX0, tileY1, pattern);
    FillRows(canvas, tileX1, tileY0, x1, tileY1, pattern);
    if (tileX0 == 0 && tileX1 == canvas->tilesWide * 8)
    {
        CpuFastFill(pattern, ArenaCanvas_RowWord(canvas, 0, tileY0), (tileY1 - tileY0) * canvas->tilesWide * 4);
        return;
    }
    for (ty = tileY0; ty < tileY1; ty += 8)
        CpuFastFill(pattern, ArenaCanvas_RowWord(canvas, tileX0, ty), (tileX1 - tileX0) * 4);
}

void ArenaCanvas_Fill(const struct ArenaCanvas *canvas, s32 x, s32 y, s32 w, s32 h, u8 color)
{
    ArenaCanvas_FillPattern(canvas, x, y, w, h, color * 0x11111111);
}

void ArenaCanvas_Dither(const struct ArenaCanvas *canvas, s32 x, s32 y, s32 w, u8 color, bool32 odd)
{
    s32 x1 = min(x + w, canvas->tilesWide * 8);
    u32 select = odd ? 0xF0F0F0F0 : 0x0F0F0F0F;
    u32 *word;

    x = max(x, 0);
    if (x >= x1 || y < canvas->top || y >= canvas->top + canvas->height)
        return;
    word = ArenaCanvas_RowWord(canvas, x, y);
    for (; x < x1; x = (x | 7) + 1, word += 8)
    {
        u32 mask = 0xFFFFFFFF << ((x & 7) * 4);

        if (x1 - (x & ~7) < 8)
            mask &= 0xFFFFFFFF >> ((8 - (x1 & 7)) * 4);
        WriteMasked(word, color * 0x11111111, mask & select);
    }
}

void ArenaCanvas_Box(const struct ArenaCanvas *canvas, s32 x, s32 y, s32 w, s32 h, u8 fill, u8 border)
{
    ArenaCanvas_Fill(canvas, x + 1, y, w - 2, h, border);
    ArenaCanvas_Fill(canvas, x, y + 1, w, h - 2, border);
    ArenaCanvas_Fill(canvas, x + 1, y + 1, w - 2, h - 2, fill);
}

// The border of ArenaCanvas_Box, with no fill.
void ArenaCanvas_Frame(const struct ArenaCanvas *canvas, s32 x, s32 y, s32 w, s32 h, u8 color)
{
    ArenaCanvas_Fill(canvas, x + 1, y, w - 2, 1, color);
    ArenaCanvas_Fill(canvas, x + 1, y + h - 1, w - 2, 1, color);
    ArenaCanvas_Fill(canvas, x, y + 1, 1, h - 2, color);
    ArenaCanvas_Fill(canvas, x + w - 1, y + 1, 1, h - 2, color);
}

const u8 gArenaBallPixels[7][8] =
{
    "..###..", ".#rrr#.", "#rrrrr#", "#kkwkk#", "#wwwww#", ".#www#.", "..###..",
};

// The outline, the band, the red top and the white bottom of gArenaBallPixels.
const u8 gArenaBallLegend[] = "#krw";

// Each row is a string. A character at index i of legend draws colors[i]; the other characters are transparent.
void ArenaCanvas_PixMap(const struct ArenaCanvas *canvas, s32 x, s32 y, const u8 (*rows)[8], u32 count, const u8 *legend, const u8 *colors)
{
    u32 i, j, k;

    for (j = 0; j < count; j++)
    {
        for (i = 0; rows[j][i] != '\0'; i++)
        {
            for (k = 0; legend[k] != '\0' && legend[k] != rows[j][i]; k++)
                ;
            if (legend[k] != '\0')
                ArenaCanvas_Pixel(canvas, x + i, y + j, colors[k]);
        }
    }
}

const u8 *Arena_SkipControlCode(const u8 *str)
{
    if (*str == EXT_CTRL_CODE_BEGIN)
        return str + 1 + GetExtCtrlCodeLength(str[1]);
    if (*str == PLACEHOLDER_BEGIN)
        return str + 2;
    return str + 1;
}

static bool32 IsTextChar(u8 c)
{
    return c != EXT_CTRL_CODE_BEGIN && c != PLACEHOLDER_BEGIN && c < CHAR_PROMPT_SCROLL;
}

s32 Arena_TextWidth(const u8 *str, u8 font)
{
    s32 width = 0;

    while (!Arena_IsLineEnd(*str))
    {
        if (IsTextChar(*str))
            width += sFonts[font].widths[*str];
        str = Arena_SkipControlCode(str);
    }
    return width;
}

bool32 Arena_TextFits(const u8 *str, u8 font, s32 width)
{
    return Arena_TextWidth(str, font) <= width;
}

const u8 *Arena_FirstFit(const u8 *const *texts, u32 count, u8 font, s32 width)
{
    u32 i;

    for (i = 0; i < count && texts[i] != NULL; i++)
    {
        if (Arena_TextFits(texts[i], font, width))
            return texts[i];
    }
    return NULL;
}

// A width includes the space after the last glyph, so the ink is 1 pixel narrower.
s32 Arena_CenterLeft(s32 center, s32 width)
{
    return center - (width - 1) / 2;
}

void Arena_FitText(u8 *str, u8 font, s32 width)
{
    u32 length = StringLength(str);

    while (length > 1 && !Arena_TextFits(str, font, width))
        str[--length] = EOS;
}

#define SPREAD(b) (((b) & 1) * 0xF + ((b) >> 1 & 1) * 0xF0 + ((b) >> 2 & 1) * 0xF00 + ((b) >> 3 & 1) * 0xF000 \
                 + ((b) >> 4 & 1) * 0xF0000 + ((b) >> 5 & 1) * 0xF00000 + ((b) >> 6 & 1) * 0xF000000 + ((b) >> 7 & 1) * 0xF0000000u)
#define SPREAD4(b) SPREAD(b), SPREAD((b) + 1), SPREAD((b) + 2), SPREAD((b) + 3)
#define SPREAD16(b) SPREAD4(b), SPREAD4((b) + 4), SPREAD4((b) + 8), SPREAD4((b) + 12)
#define SPREAD64(b) SPREAD16(b), SPREAD16((b) + 16), SPREAD16((b) + 32), SPREAD16((b) + 48)

static const u32 sSpread[256] = {SPREAD64(0), SPREAD64(64), SPREAD64(128), SPREAD64(192)};

// gbagfx stores a cell as the tiles of its top row, then the tiles of its bottom row.
#define GLYPH_BITS(bits, row, tilesWide) ((bits)[(row) + ((row) >> 3) * ((tilesWide) - 1) * 8])

static void DrawGlyphClipped(const struct ArenaCanvas *canvas, s32 x, s32 y, const u8 *cell, const struct ArenaFont *f, u8 color)
{
    u32 row, half, bits;
    s32 col;

    for (row = 0; row < f->rows; row++)
    {
        for (half = 0; half < f->cellTilesWide; half++)
        {
            bits = GLYPH_BITS(cell + half * 8, row, f->cellTilesWide);
            for (col = half * 8; bits != 0; bits >>= 1, col++)
            {
                if (bits & 1)
                    ArenaCanvas_Pixel(canvas, x + col, y + row, color);
            }
        }
    }
}

static inline void DrawGlyphRow(u32 *word, u32 mask, u32 above, u32 shift, u32 colorQuad, u32 shadowQuad)
{
    u32 shadowShift = shift + 4;
    u32 w = word[0];

    if (shadowShift < 32)
        w ^= (w ^ shadowQuad) & (above << shadowShift);
    w ^= (w ^ colorQuad) & (mask << shift);
    word[0] = w;
    if (shift != 0 || above != 0)
    {
        w = word[8];
        w ^= (w ^ shadowQuad) & (above >> (32 - shadowShift));
        if (shift != 0)
            w ^= (w ^ colorQuad) & (mask >> (32 - shift));
        word[8] = w;
    }
}

static void DrawGlyphInside(const struct ArenaCanvas *canvas, s32 x, s32 y, const u8 *cell, const struct ArenaFont *f, u32 color, u32 shadow)
{
    u32 tilesWide = f->cellTilesWide, rows = f->rows;
    u32 nextTileRow = canvas->tilesWide * 8 - 7;
    u32 colorQuad = color * 0x11111111, shadowQuad = shadow * 0x11111111;
    u32 half, row, line, mask, above, shift;
    u32 *word;
    const u8 *bits;

    for (half = 0; half < tilesWide; half++, x += 8)
    {
        word = ArenaCanvas_RowWord(canvas, x, y);
        line = (y - canvas->top) & 7;
        bits = cell + half * 8;
        shift = (x & 7) * 4;
        above = 0;
        for (row = 0; row < rows + (shadow != 0); row++)
        {
            mask = row < rows ? sSpread[GLYPH_BITS(bits, row, tilesWide)] : 0;
            if (shadow != 0)
            {
                if ((mask | above) != 0)
                    DrawGlyphRow(word, mask, above, shift, colorQuad, shadowQuad);
                above = mask;
            }
            else if (mask != 0)
            {
                *word ^= (*word ^ colorQuad) & (mask << shift);
                if (shift != 0)
                    word[8] ^= (word[8] ^ colorQuad) & (mask >> (32 - shift));
            }
            if (++line == 8)
            {
                line = 0;
                word += nextTileRow;
            }
            else
            {
                word++;
            }
        }
    }
}

static void DrawTextGlyph(const struct ArenaCanvas *canvas, s32 x, s32 y, u8 c, u8 font, u8 color, u8 shadow)
{
    const struct ArenaFont *f = &sFonts[font];
    const u8 *cell = f->glyphs + c * f->cellTilesWide * 2 * 8;
    s32 extra = shadow != 0;

    if (x >= 0 && x + f->cellTilesWide * 8 + extra <= canvas->tilesWide * 8
     && y >= canvas->top && y + f->rows + extra <= canvas->top + canvas->height)
    {
        DrawGlyphInside(canvas, x, y, cell, f, color, shadow);
        return;
    }
    if (shadow != 0)
        DrawGlyphClipped(canvas, x + 1, y + 1, cell, f, shadow);
    DrawGlyphClipped(canvas, x, y, cell, f, color);
}

// y is the top of the capital letters. A shadow color of 0 draws no shadow.
const u8 *ArenaCanvas_TextLine(const struct ArenaCanvas *canvas, s32 x, s32 y, const u8 *str, u8 font, u8 color, u8 shadow)
{
    s32 top = y - (sFonts[font].baseline - sFonts[font].capHeight);

    while (!Arena_IsLineEnd(*str))
    {
        if (IsTextChar(*str))
        {
            DrawTextGlyph(canvas, x, top, *str, font, color, shadow);
            x += sFonts[font].widths[*str];
        }
        str = Arena_SkipControlCode(str);
    }
    return str;
}

void ArenaCanvas_Text(const struct ArenaCanvas *canvas, s32 x, s32 y, const u8 *str, u8 font, u8 color, u8 shadow, u8 align)
{
    s32 width = Arena_TextWidth(str, font);

    if (align == ARENA_ALIGN_RIGHT)
        x -= width;
    else if (align == ARENA_ALIGN_CENTER)
        x = Arena_CenterLeft(x, width);
    ArenaCanvas_TextLine(canvas, x, y, str, font, color, shadow);
}
