#include "global.h"
#include "arena_internal.h"
#include "palette.h"

enum
{
    CROWD_SKY = 1,
    CROWD_ROW_A,
    CROWD_ROW_B,
    CROWD_ROW_HI,
    CROWD_ROW_LO,
    CROWD_LAMP,
    CROWD_LAMP_BASE,
    CROWD_SHIRT,
    CROWD_SKIN = CROWD_SHIRT + 4,
    CROWD_HAIR = CROWD_SKIN + 2,
};

enum
{
    FIELD_SAND_A = 1,
    FIELD_SAND_B,
    FIELD_EDGE,
    FIELD_LINE,
    FIELD_WALL,
    FIELD_WALL_HI,
    FIELD_WALL_LO,
    FIELD_BALL_DARK,
    FIELD_BALL_RED,
    FIELD_BALL_WHITE,
    FIELD_CENTER_RED,
    FIELD_CENTER_DARK,
    FIELD_CENTER_LIGHT,
    FIELD_SHADOW,
    FIELD_PANEL,
};

static const u16 sCrowdBasePalette[16] =
{
    [CROWD_SKY] = ARENA_RGB(0x16, 0x12, 0x2a),
    [CROWD_ROW_A] = ARENA_RGB(0x2e, 0x28, 0x50),
    [CROWD_ROW_B] = ARENA_RGB(0x34, 0x2c, 0x58),
    [CROWD_ROW_HI] = ARENA_RGB(0x4a, 0x42, 0x78),
    [CROWD_ROW_LO] = ARENA_RGB(0x1c, 0x18, 0x34),
    [CROWD_LAMP] = ARENA_RGB(0xf8, 0xe8, 0xa0),
    [CROWD_LAMP_BASE] = ARENA_RGB(0x6a, 0x5e, 0x48),
};

static const u16 sShirts[] =
{
    ARENA_RGB(0xd8, 0x48, 0x38), ARENA_RGB(0xf0, 0xa0, 0x28), ARENA_RGB(0x38, 0x68, 0xc8), ARENA_RGB(0xe8, 0xe8, 0xe0),
    ARENA_RGB(0x48, 0xa0, 0x40), ARENA_RGB(0x88, 0x48, 0xb8), ARENA_RGB(0xe0, 0x68, 0x98), ARENA_RGB(0x28, 0xa0, 0xa0),
};
static const u16 sSkins[] = {ARENA_RGB(0xf8, 0xd0, 0xa0), ARENA_RGB(0xe0, 0xa8, 0x70), ARENA_RGB(0xa8, 0x70, 0x48)};
static const u16 sHairs[] =
{
    ARENA_RGB(0x38, 0x30, 0x28), ARENA_RGB(0x78, 0x48, 0x28), ARENA_RGB(0xe8, 0xb8, 0x38),
    ARENA_RGB(0x20, 0x20, 0x28), ARENA_RGB(0xa8, 0x38, 0x20), ARENA_RGB(0xc8, 0xc8, 0xc8),
};

static const u16 sFieldPalette[16] =
{
    [FIELD_SAND_A] = ARENA_RGB(0xd8, 0xb8, 0x78),
    [FIELD_SAND_B] = ARENA_RGB(0xcf, 0xac, 0x6a),
    [FIELD_EDGE] = ARENA_RGB(0xa8, 0x84, 0x50),
    [FIELD_LINE] = ARENA_RGB(0xf8, 0xf0, 0xd8),
    [FIELD_WALL] = ARENA_RGB(0xc0, 0x38, 0x30),
    [FIELD_WALL_HI] = ARENA_RGB(0xe8, 0x60, 0x48),
    [FIELD_WALL_LO] = ARENA_RGB(0x80, 0x1c, 0x20),
    [FIELD_BALL_DARK] = ARENA_RGB(0x38, 0x18, 0x18),
    [FIELD_BALL_RED] = ARENA_RGB(0xf0, 0x58, 0x48),
    [FIELD_BALL_WHITE] = ARENA_RGB(0xf8, 0xf8, 0xf0),
    [FIELD_CENTER_RED] = ARENA_RGB(0xd8, 0x70, 0x60),
    [FIELD_CENTER_DARK] = ARENA_RGB(0x58, 0x40, 0x38),
    [FIELD_CENTER_LIGHT] = ARENA_RGB(0xf0, 0xe4, 0xc8),
    [FIELD_SHADOW] = ARENA_RGB(0x9c, 0x78, 0x4a),
    [FIELD_PANEL] = ARENA_RGB(0x1c, 0x1a, 0x24),
};

static const u8 sBallColors[] = {FIELD_BALL_DARK, FIELD_BALL_DARK, FIELD_BALL_RED, FIELD_BALL_WHITE};

#define ROW_Y(r) (4 + (r) * 6)
#define SPECTATOR_STEP 5
#define WALL_Y 40
#define FIELD_Y 49
#define CENTER_X 120
#define CENTER_Y 85
#define CROWD_ROW_COST 44
#define CROWD_ROWS_PER_FRAME 3
#define WAVE_BASE_COST 40
#define WAVE_MAX_STEP 32

static u32 Hash(u32 a, u32 b)
{
    u32 h = a * 374761393 + b * 668265263;

    h = (h ^ (h >> 13)) * 1274126177;
    return h ^ (h >> 16);
}

static bool32 IsAisle(s32 x)
{
    return (x > 52 && x < 64) || (x > 172 && x < 184);
}

static void DrawStandRow(const struct ArenaCanvas *canvas, u32 r, s32 x0, s32 x1)
{
    s32 y = ROW_Y(r);

    ArenaCanvas_Fill(canvas, x0, y, x1 - x0, 4, r % 2 ? CROWD_ROW_A : CROWD_ROW_B);
    ArenaCanvas_Fill(canvas, x0, y + 4, x1 - x0, 1, CROWD_ROW_HI);
    ArenaCanvas_Fill(canvas, x0, y + 5, x1 - x0, 1, CROWD_ROW_LO);
}

static void DrawAisles(const struct ArenaCanvas *canvas, s32 x0, s32 x1)
{
    static const s16 sAisleX[] = {57, 177};
    u32 i;
    s32 y;

    for (i = 0; i < ARRAY_COUNT(sAisleX); i++)
    {
        if (sAisleX[i] + 7 <= x0 || sAisleX[i] >= x1)
            continue;
        ArenaCanvas_Fill(canvas, sAisleX[i], 4, 7, 36, CROWD_ROW_LO);
        for (y = 6; y < WALL_Y; y += 3)
            ArenaCanvas_Fill(canvas, sAisleX[i], y, 7, 1, CROWD_ROW_HI);
    }
}

static inline void PutLine(u32 *word, u32 shift, u32 color, u32 mask)
{
    *word ^= (*word ^ color) & (mask << shift);
    if (shift > 16)
        word[8] ^= (word[8] ^ color) & (mask >> (32 - shift));
}

#define ROW_LINES 8

// A spectator never crosses the edge of the stands, so this draws with no clipping.
static void DrawSpectator(u32 *const *lines, s32 x, u32 h, s32 jump, bool32 armsUp, u32 armFrame)
{
    u32 column = (x >> 3) * 8, shift = (x & 7) * 4;
    u32 hair = 3 - jump;
    u32 skin = (CROWD_SKIN + ((h >> 4) & 1)) * 0x11111111;
    u32 shirt = (CROWD_SHIRT + (h & 3)) * 0x11111111;

    PutLine(lines[hair] + column, shift, (CROWD_HAIR + ((h >> 7) & 1)) * 0x11111111, 0x0FF0);
    PutLine(lines[hair + 1] + column, shift, skin, 0x0FF0);
    if (armsUp)
    {
        PutLine(lines[hair - armFrame] + column, shift, skin, 0x000F);
        PutLine(lines[hair - 1 + armFrame] + column, shift, skin, 0xF000);
    }
    PutLine(lines[hair + 2] + column, shift, shirt, 0xFFFF);
    PutLine(lines[hair + 3] + column, shift, shirt, 0xFFFF);
}

#define SEAT_EMPTY 7
#define SEAT_CALM 8

// Two seats in each byte, one in each nibble.
static EWRAM_DATA u8 sSeats[ARENA_CROWD_ROWS][ARENA_CROWD_SEATS / 2] = {0};

static s32 SeatX(u32 r, u32 i)
{
    return 1 + (r % 2) * 2 + i * SPECTATOR_STEP;
}

static u32 SeatAt(u32 r, u32 i)
{
    return (sSeats[r][i / 2] >> ((i & 1) * 4)) & 0xF;
}

// The GBA has no divide instruction, so the seats keep the parts of the hash that need a division.
static void ComputeSeats(u32 seed)
{
    u32 r, i;

    memset(sSeats, 0, sizeof(sSeats));
    for (r = 0; r < ARENA_CROWD_ROWS; r++)
    {
        for (i = 0; i < ARENA_CROWD_SEATS && SeatX(r, i) < DISPLAY_WIDTH - 3; i++)
        {
            s32 x = SeatX(r, i);
            u32 h = Hash(x + seed, r);
            u32 seat = h % 7;

            if (IsAisle(x) || h % 11 == 0)
                seat = SEAT_EMPTY;
            else if ((h >> 10) % 3 == 0)
                seat |= SEAT_CALM;
            sSeats[r][i / 2] |= seat << ((i & 1) * 4);
        }
    }
}

void ArenaStadium_LoadPalettes(u32 seed)
{
    u16 palette[16];
    u32 i;

    memcpy(palette, sCrowdBasePalette, sizeof(palette));
    for (i = 0; i < 4; i++)
        palette[CROWD_SHIRT + i] = sShirts[(Hash(seed, i) + i) % ARRAY_COUNT(sShirts)];
    for (i = 0; i < 2; i++)
    {
        palette[CROWD_SKIN + i] = sSkins[Hash(seed, 10 + i) % ARRAY_COUNT(sSkins)];
        palette[CROWD_HAIR + i] = sHairs[Hash(seed, 20 + i) % ARRAY_COUNT(sHairs)];
    }
    LoadPalette(palette, BG_PLTT_ID(ARENA_PAL_CROWD), PLTT_SIZE_4BPP);
    LoadPalette(sFieldPalette, BG_PLTT_ID(ARENA_PAL_FIELD), PLTT_SIZE_4BPP);
}

// cheer is 0 to 16; wave is the x of the wave front.
static void DrawCrowd(const struct ArenaCanvas *canvas, u32 seed, u32 time, u32 cheer, s32 wave, s32 x0, s32 x1, u32 rows)
{
    u32 r, i, calmCheer = cheer / 3, step = time / 5, armStep = time / 8;
    s32 x;

    x0 = max(0, x0) & ~3;
    x1 = min(DISPLAY_WIDTH, (x1 + 3) & ~3);
    if (x0 >= x1)
        return;
    for (r = 0; r < ARENA_CROWD_ROWS; r++)
    {
        u32 *lines[ROW_LINES];

        if (!(rows & (1 << r)))
            continue;
        DrawStandRow(canvas, r, x0, x1);
        for (i = 0; i < ROW_LINES; i++)
            lines[i] = ArenaCanvas_RowWord(canvas, 0, ROW_Y(r) - 2 + i);
        for (i = max(0, x0 - 8) / SPECTATOR_STEP; (x = SeatX(r, i)) < DISPLAY_WIDTH - 3 && x < x1; i++)
        {
            u32 seat = SeatAt(r, i), hype, h;
            s32 jump = 0;

            if (x + 4 <= x0 || seat == SEAT_EMPTY)
                continue;
            hype = seat & SEAT_CALM ? calmCheer : cheer;
            if (abs(x - wave - (s32)r * 5) < 5)
                hype = max(hype, 14);
            if (hype > 3)
                jump = (((step + (seat & 7)) & 3) < 2 ? 2 : 1) * hype / 16;
            h = Hash(x + seed, r);
            DrawSpectator(lines, x, h, jump, hype > 5, (armStep + h) & 1);
        }
    }
    DrawAisles(canvas, x0, x1);
}

void ArenaCrowd_SetCheer(u8 cheer)
{
    gArenaScreen.crowd.cheer = cheer;
}

void ArenaCrowd_Update(void)
{
    struct ArenaCrowd *crowd = &gArenaScreen.crowd;

    if (crowd->cheer != 0 && gArenaScreen.time % 6 == 0)
        crowd->cheer--;
    if (Arena_JuiceOn())
    {
        crowd->wave += 2;
        if (crowd->wave > 600)
            crowd->wave = -60 - Arena_FxRandom() % 200;
    }
    if (crowd->cheer != 0)
    {
        crowd->moved = TRUE;
        crowd->rows = ARENA_ALL_CROWD_ROWS;
    }
    else if (crowd->moved)
    {
        crowd->moved = FALSE;
        crowd->rows = ARENA_ALL_CROWD_ROWS;
    }
}

void ArenaCrowd_MarkDrawn(void)
{
    gArenaScreen.crowd.rows = 0;
}

static u32 WaveCost(void)
{
    return WAVE_BASE_COST + min(gArenaScreen.crowd.wave - gArenaScreen.crowd.waveShown, WAVE_MAX_STEP);
}

static void DrawCrowdRows(void)
{
    struct ArenaCrowd *crowd = &gArenaScreen.crowd;
    u32 count, row;

    for (count = 0; count < CROWD_ROWS_PER_FRAME && crowd->rows != 0 && ArenaRaster_FitsBehindScan(WALL_Y, CROWD_ROW_COST); count++)
    {
        row = crowd->nextRow;
        while (!(crowd->rows & (1 << row)))
            row = (row + 1) % ARENA_CROWD_ROWS;
        DrawCrowd(&gArenaStadiumCanvas, gArenaScreen.seed, gArenaScreen.time, crowd->cheer, crowd->wave, 0, DISPLAY_WIDTH, 1 << row);
        crowd->rows &= ~(1 << row);
        crowd->nextRow = (row + 1) % ARENA_CROWD_ROWS;
    }
}

static void DrawWave(void)
{
    struct ArenaCrowd *crowd = &gArenaScreen.crowd;
    s32 lo = min(crowd->waveShown, crowd->wave);
    s32 hi = max(crowd->waveShown, crowd->wave);
    u32 row;

    lo = max(lo, hi - WAVE_MAX_STEP);
    for (row = 0; row < ARENA_CROWD_ROWS; row++)
        DrawCrowd(&gArenaStadiumCanvas, gArenaScreen.seed, gArenaScreen.time, 0, crowd->wave, lo + 5 * row - 4, hi + 5 * row + 13, 1 << row);
    crowd->waveShown = crowd->wave;
}

static bool32 IsWaving(void)
{
    return gArenaScreen.crowd.wave > -40 && gArenaScreen.crowd.wave < DISPLAY_WIDTH + 40;
}

u32 ArenaCrowd_Cost(void)
{
    struct ArenaCrowd *crowd = &gArenaScreen.crowd;

    return crowd->rows != 0 || (IsWaving() && crowd->wave - crowd->waveShown >= 4) ? CROWD_ROW_COST : 0;
}

// Each row and the wave check the scan first, so the crowd draws only what fits.
void ArenaCrowd_Draw(void)
{
    struct ArenaCrowd *crowd = &gArenaScreen.crowd;

    DrawCrowdRows();
    if (!IsWaving())
        crowd->waveShown = crowd->wave;
    else if (crowd->rows == 0 && crowd->wave - crowd->waveShown >= 4 && ArenaRaster_FitsBehindScan(WALL_Y, WaveCost()))
        DrawWave();
}

static void DrawLamps(const struct ArenaCanvas *canvas)
{
    s32 x;

    ArenaCanvas_Fill(canvas, 0, 0, DISPLAY_WIDTH, 4, CROWD_SKY);
    for (x = 10; x < DISPLAY_WIDTH; x += 32)
    {
        ArenaCanvas_Fill(canvas, x, 1, 3, 1, CROWD_LAMP);
        ArenaCanvas_Fill(canvas, x - 1, 2, 5, 1, CROWD_LAMP_BASE);
    }
}

static void DrawWall(const struct ArenaCanvas *canvas)
{
    s32 x;

    ArenaCanvas_Fill(canvas, 0, WALL_Y, DISPLAY_WIDTH, 9, FIELD_WALL);
    ArenaCanvas_Fill(canvas, 0, WALL_Y, DISPLAY_WIDTH, 1, FIELD_WALL_HI);
    ArenaCanvas_Fill(canvas, 0, WALL_Y + 8, DISPLAY_WIDTH, 1, FIELD_WALL_LO);
    for (x = 14; x < DISPLAY_WIDTH; x += 36)
        ArenaCanvas_PixMap(canvas, x, WALL_Y + 1, gArenaBallPixels, ARRAY_COUNT(gArenaBallPixels), gArenaBallLegend, sBallColors);
}

static s32 SandRows(s32 y, u32 *pattern)
{
    u32 band = ((y - FIELD_Y) / 8) % 2 ? FIELD_SAND_B : FIELD_SAND_A;
    u32 other = band == FIELD_SAND_A ? FIELD_SAND_B : FIELD_SAND_A;

    if ((y - FIELD_Y) % 8 == 7)
    {
        *pattern = y % 2 == 0 ? other * 0x01010101 + band * 0x10101010 : band * 0x01010101 + other * 0x10101010;
        return y + 1;
    }
    *pattern = band * 0x11111111;
    return y + 7 - (y - FIELD_Y) % 8;
}

#define ELLIPSE_MAX_R 31

enum
{
    ELLIPSE_BALL,
    ELLIPSE_BUTTON,
    ELLIPSE_SHADOW,
};

// part must grow with dx. Returns -1 when no dx fits.
static s32 HalfWidth(const u8 *part, s32 start, s32 limit)
{
    s32 dx = start;

    while (dx >= 0 && part[dx] > limit)
        dx--;
    return dx;
}

static u8 InsideColor(u32 kind, s32 dy)
{
    if (kind == ELLIPSE_BUTTON)
        return FIELD_BALL_WHITE;
    if (kind == ELLIPSE_SHADOW)
        return FIELD_SHADOW;
    if (dy < 0)
        return FIELD_CENTER_RED;
    return dy == 0 ? FIELD_CENTER_DARK : FIELD_CENTER_LIGHT;
}

static void DrawRing(const struct ArenaCanvas *canvas, s32 cx, s32 y, s32 dy, s32 in, s32 out, u32 kind)
{
    if (kind != ELLIPSE_SHADOW)
    {
        u8 color = kind == ELLIPSE_BALL ? FIELD_LINE : FIELD_CENTER_DARK;

        ArenaCanvas_Fill(canvas, cx - out, y, out - in, 1, color);
        ArenaCanvas_Fill(canvas, cx + in + 1, y, out - in, 1, color);
        return;
    }
    ArenaCanvas_Dither(canvas, cx - out, y, out - in, FIELD_EDGE, (cx - dy) & 1);
    ArenaCanvas_Dither(canvas, cx + in + 1, y, out - in, FIELD_EDGE, (cx - dy) & 1);
}

// The limits are in 1/256 of dx^2 / rx^2 + dy^2 / ry^2, so the edge is at 256.
static void FillEllipse(const struct ArenaCanvas *canvas, s32 cx, s32 cy, s32 rx, s32 ry, u32 kind)
{
    static const u8 sInsideLimit[] = {[ELLIPSE_BALL] = 200, [ELLIPSE_BUTTON] = 115, [ELLIPSE_SHADOW] = 114};
    u8 dxPart[ELLIPSE_MAX_R + 1];
    s8 outs[ELLIPSE_MAX_R + 1], ins[ELLIPSE_MAX_R + 1];
    s32 dx, dy, out, in;

    rx = min(rx, ELLIPSE_MAX_R);
    ry = min(ry, ELLIPSE_MAX_R);
    for (dx = 0; dx <= rx; dx++)
        dxPart[dx] = dx * dx * 256 * 4 / ((2 * rx + 1) * (2 * rx + 1));
    out = in = rx;
    for (dy = 0; dy <= ry; dy++)
    {
        s32 rest = dy * dy * 256 * 4 / ((2 * ry + 1) * (2 * ry + 1));

        outs[dy] = out = HalfWidth(dxPart, out, 256 - rest);
        ins[dy] = in = HalfWidth(dxPart, in, sInsideLimit[kind] - rest);
    }
    for (dy = -ry; dy <= ry; dy++)
    {
        in = ins[abs(dy)];
        if (in >= 0)
            ArenaCanvas_Fill(canvas, cx - in, cy + dy, 2 * in + 1, 1, InsideColor(kind, dy));
        DrawRing(canvas, cx, cy + dy, dy, in, outs[abs(dy)], kind);
    }
}

void ArenaStadium_DrawField(const struct ArenaCanvas *canvas, s32 y0, s32 y1)
{
    s32 x, y, next;
    u32 pattern;

    y1 = min(y1, ARENA_FIELD_BOTTOM);
    for (y = max(y0, FIELD_Y); y < y1; y = next)
    {
        next = min(SandRows(y, &pattern), y1);
        ArenaCanvas_FillPattern(canvas, 0, y, DISPLAY_WIDTH, next - y, pattern);
    }
    if (y0 <= FIELD_Y + 2)
    {
        ArenaCanvas_Fill(canvas, 0, FIELD_Y, DISPLAY_WIDTH, 2, FIELD_EDGE);
        for (x = 0; x < DISPLAY_WIDTH; x += 2)
            ArenaCanvas_Pixel(canvas, x, FIELD_Y + 2, FIELD_EDGE);
    }
    ArenaCanvas_Fill(canvas, 10, 56, 220, 1, FIELD_LINE);
    ArenaCanvas_Fill(canvas, 10, ARENA_FIELD_BOTTOM - 5, 220, 1, FIELD_LINE);
    ArenaCanvas_Fill(canvas, 9, 57, 1, ARENA_FIELD_BOTTOM - 62, FIELD_LINE);
    ArenaCanvas_Fill(canvas, 230, 57, 1, ARENA_FIELD_BOTTOM - 62, FIELD_LINE);
    ArenaCanvas_Fill(canvas, CENTER_X, 57, 1, ARENA_FIELD_BOTTOM - 62, FIELD_LINE);
    FillEllipse(canvas, CENTER_X, CENTER_Y, 16, 9, ELLIPSE_BALL);
    FillEllipse(canvas, CENTER_X, CENTER_Y, 3, 2, ELLIPSE_BUTTON);
}

void ArenaStadium_DrawShadow(const struct ArenaCanvas *canvas, s32 cx, s32 cy, s32 rx)
{
    FillEllipse(canvas, cx, cy, rx, max(2, rx / 4), ELLIPSE_SHADOW);
}

// The tile after the canvas is the one tile of all the stadium rows under the field.
void ArenaStadium_Draw(const struct ArenaCanvas *canvas, u32 seed)
{
    struct ArenaCanvas panel = {canvas->tiles + canvas->height / 8 * canvas->tilesWide * TILE_SIZE_4BPP / 2, ARENA_FIELD_BOTTOM, 8, 1};

    ComputeSeats(seed);
    DrawLamps(canvas);
    DrawCrowd(canvas, seed, 0, 0, -100, 0, DISPLAY_WIDTH, ARENA_ALL_CROWD_ROWS);
    DrawWall(canvas);
    ArenaStadium_DrawField(canvas, FIELD_Y, ARENA_FIELD_BOTTOM);
    ArenaCanvas_Fill(&panel, 0, ARENA_FIELD_BOTTOM, 8, 8, FIELD_PANEL);
}
