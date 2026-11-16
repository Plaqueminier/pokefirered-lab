#include "global.h"
#include "arena_internal.h"
#include "battle.h"
#include "battle_anim.h"
#include "battle_main.h"
#include "bg.h"
#include "data.h"
#include "decompress.h"
#include "gpu_regs.h"
#include "palette.h"
#include "pokemon.h"
#include "scanline_effect.h"
#include "sprite.h"
#include "task.h"
#include "trainer_pokemon_sprites.h"
#include "util.h"

// BG0 keeps the text windows of the engine, so the Arena layers must not use its VRAM.
#define CHAR_BASE 1
#define MAP_STADIUM 26
#define MAP_UI 27
#define MAP_OVERLAY 28
#define STADIUM_TILE 0
#define PANEL_TILE (STADIUM_TILE + 30 * 15)
#define UI_TOP_TILE (PANEL_TILE + 1)
#define UI_BOTTOM_TILE (UI_TOP_TILE + 30 * 6)
#define OVERLAY_TILE (UI_BOTTOM_TILE + 30 * 8)
#define BLANK_TILE (OVERLAY_TILE + 30 * 3)
#define TILE_ADDR(n) ((u16 *)(VRAM + BG_CHAR_SIZE * CHAR_BASE + (n) * TILE_SIZE_4BPP))
#define PANEL_ROW 15
#define OVERLAY_ROW 8

const struct ArenaCanvas gArenaStadiumCanvas = {TILE_ADDR(STADIUM_TILE), 0, ARENA_FIELD_BOTTOM, 30};
const struct ArenaCanvas gArenaTopCanvas = {TILE_ADDR(UI_TOP_TILE), 0, ARENA_INFO_BOTTOM, 30};
const struct ArenaCanvas gArenaBottomCanvas = {TILE_ADDR(UI_BOTTOM_TILE), ARENA_TEAM_TOP, 64, 30};
const struct ArenaCanvas gArenaOverlayCanvas = {TILE_ADDR(OVERLAY_TILE), ARENA_OVERLAY_TOP, 24, 30};

const s16 gArenaMonCenterX[ARENA_SIDES] = {64, 176};

// The Harness reads this name (lab/src/battle.ts).
EWRAM_DATA struct ArenaScreen gArenaScreen = {0};

static const u16 sUiPalette[16] =
{
    [UI_BOX] = ARENA_RGB(0x20, 0x1c, 0x30),
    [UI_GOLD] = ARENA_RGB(0xf0, 0xc0, 0x40),
    [UI_WHITE] = ARENA_RGB(0xff, 0xff, 0xff),
    [UI_GREY] = ARENA_RGB(0xa8, 0xa0, 0xb8),
    [UI_BAR_BG] = ARENA_RGB(0x3a, 0x34, 0x48),
    [UI_BLACK] = ARENA_RGB(0x12, 0x10, 0x18),
    [UI_GREEN] = ARENA_RGB(0x58, 0xd0, 0x68),
    [UI_YELLOW] = ARENA_RGB(0xf8, 0xc8, 0x38),
    [UI_RED] = ARENA_RGB(0xe8, 0x50, 0x40),
    [UI_ORANGE] = ARENA_RGB(0xf8, 0xa0, 0x30),
    [UI_BLUE] = ARENA_RGB(0xa8, 0xc0, 0xe0),
    [UI_SHADOW] = ARENA_RGB(0x10, 0x10, 0x18),
};

static const u16 sCardsPalette[16] =
{
    [CARDS_PANEL] = ARENA_RGB(0x1c, 0x1a, 0x24),
    [CARDS_LINE] = ARENA_RGB(0x3a, 0x34, 0x48),
    [CARDS_WHITE] = ARENA_RGB(0xff, 0xff, 0xff),
    [CARDS_GREY] = ARENA_RGB(0xa8, 0xa0, 0xb8),
    [CARDS_FILL] = ARENA_RGB(0x2a, 0x26, 0x34),
    [CARDS_FILL_ON] = ARENA_RGB(0x4a, 0x44, 0x60),
    [CARDS_ORANGE] = ARENA_RGB(0xf8, 0xa0, 0x30),
    [CARDS_BLUE] = ARENA_RGB(0xa8, 0xc0, 0xe0),
    [CARDS_GOLD] = ARENA_RGB(0xf8, 0xd0, 0x48),
    [CARDS_MUTED] = ARENA_RGB(0x98, 0x90, 0xa8),
    [CARDS_DIM] = ARENA_RGB(0x80, 0x80, 0x80),
};

static const u16 sTypeColors[NUMBER_OF_MON_TYPES] =
{
    [TYPE_NORMAL] = ARENA_RGB(0xa8, 0xa8, 0x78),
    [TYPE_FIGHTING] = ARENA_RGB(0xc0, 0x30, 0x28),
    [TYPE_FLYING] = ARENA_RGB(0xa8, 0x90, 0xf0),
    [TYPE_POISON] = ARENA_RGB(0xa0, 0x40, 0xa0),
    [TYPE_GROUND] = ARENA_RGB(0xe0, 0xc0, 0x68),
    [TYPE_ROCK] = ARENA_RGB(0xb8, 0xa0, 0x38),
    [TYPE_BUG] = ARENA_RGB(0xa8, 0xb8, 0x20),
    [TYPE_GHOST] = ARENA_RGB(0x70, 0x58, 0x98),
    [TYPE_STEEL] = ARENA_RGB(0xb8, 0xb8, 0xd0),
    [TYPE_MYSTERY] = ARENA_RGB(0x68, 0xa0, 0x90),
    [TYPE_FIRE] = ARENA_RGB(0xf0, 0x80, 0x30),
    [TYPE_WATER] = ARENA_RGB(0x68, 0x90, 0xf0),
    [TYPE_GRASS] = ARENA_RGB(0x78, 0xc8, 0x50),
    [TYPE_ELECTRIC] = ARENA_RGB(0xf8, 0xd0, 0x30),
    [TYPE_PSYCHIC] = ARENA_RGB(0xf8, 0x58, 0x88),
    [TYPE_ICE] = ARENA_RGB(0x98, 0xd8, 0xd8),
    [TYPE_DRAGON] = ARENA_RGB(0x70, 0x38, 0xf8),
    [TYPE_DARK] = ARENA_RGB(0x70, 0x58, 0x48),
};

static const struct OamData sOamMon =
{
    .affineMode = ST_OAM_AFFINE_DOUBLE,
    .shape = SPRITE_SHAPE(64x64),
    .size = SPRITE_SIZE(64x64),
    .priority = 3,
};

static void SpriteCB_ArenaMon(struct Sprite *sprite);

static const struct SpriteTemplate sMonTemplates[ARENA_SIDES] =
{
    {ARENA_TAG_MON(B_SIDE_PLAYER), TAG_NONE, &sOamMon, gDummySpriteAnimTable, NULL, gDummySpriteAffineAnimTable, SpriteCB_ArenaMon},
    {ARENA_TAG_MON(B_SIDE_OPPONENT), TAG_NONE, &sOamMon, gDummySpriteAnimTable, NULL, gDummySpriteAffineAnimTable, SpriteCB_ArenaMon},
};

struct Pokemon *Arena_Party(u8 side)
{
    return side == B_SIDE_PLAYER ? gPlayerParty : gEnemyParty;
}

struct Pokemon *Arena_PartyOf(u8 side)
{
    return &Arena_Party(side)[gArenaScreen.mons[side].partyIndex];
}

// TRUE when the party slot holds a Pokémon: not empty and not an egg.
bool8 Arena_IsTeamMon(struct Pokemon *mon)
{
    return GetMonData(mon, MON_DATA_SPECIES) != SPECIES_NONE && !GetMonData(mon, MON_DATA_IS_EGG);
}

u16 Arena_TypeColor(u8 type)
{
    return type < NUMBER_OF_MON_TYPES ? sTypeColors[type] : sTypeColors[TYPE_MYSTERY];
}

// A separate RNG: the crowd and the juice must not move the battle RNG.
u32 Arena_FxRandom(void)
{
    return Arena_Lcg(&gArenaScreen.fxRng);
}

u16 Arena_Frames(u16 frames)
{
    return gSaveBlock2Ptr->arenaSettings.speed == ARENA_SPEED_INSTANT ? 0 : frames;
}

bool8 Arena_JuiceOn(void)
{
    return gSaveBlock2Ptr->arenaSettings.speed != ARENA_SPEED_INSTANT;
}

void ArenaScreen_Init(void)
{
    memset(&gArenaScreen, 0, sizeof(gArenaScreen));
    // Not from Random(): the battle RNG must stay the same as in a classic battle.
    gArenaScreen.seed = gMain.vblankCounter2 * 2654435761u ^ (gSaveBlock2Ptr->playTimeMinutes << 8 | gSaveBlock2Ptr->playTimeSeconds);
    gArenaScreen.fxRng = gArenaScreen.seed;
}

void ArenaScreen_MarkDirty(u16 flags)
{
    gArenaScreen.dirty |= flags;
}

static void SetColor(u16 offset, u16 color)
{
    gPlttBufferUnfaded[offset] = color;
    gPlttBufferFaded[offset] = color;
}

void ArenaScreen_SetBgColor(u8 palette, u8 index, u16 color)
{
    SetColor(BG_PLTT_ID(palette) + index, color);
}

void ArenaScreen_SetObjColor(u16 paletteTag, u8 index, u16 color)
{
    SetColor(OBJ_PLTT_ID(IndexOfSpritePaletteTag(paletteTag)) + index, color);
}

static void WriteTilemaps(void)
{
    u16 *stadium = BG_SCREEN_ADDR(MAP_STADIUM);
    u16 *ui = BG_SCREEN_ADDR(MAP_UI);
    u16 *overlay = BG_SCREEN_ADDR(MAP_OVERLAY);
    s32 row, col;

    for (row = 0; row < 32; row++)
    {
        for (col = 0; col < 32; col++)
        {
            u16 at = row * 32 + col;
            bool32 onScreen = col < 30 && row < 20;
            u16 cell = row * 30 + col;

            if (!onScreen)
                stadium[at] = PANEL_TILE | (ARENA_PAL_FIELD << 12);
            else if (row < 15)
                stadium[at] = (STADIUM_TILE + cell) | ((row < 5 ? ARENA_PAL_CROWD : ARENA_PAL_FIELD) << 12);
            else
                stadium[at] = PANEL_TILE | (ARENA_PAL_FIELD << 12);

            if (onScreen && row < 6)
                ui[at] = (UI_TOP_TILE + cell) | (ARENA_PAL_UI << 12);
            else if (onScreen && row >= 12)
                ui[at] = (UI_BOTTOM_TILE + cell - 12 * 30) | ((row < 15 ? ARENA_PAL_UI : ARENA_PAL_CARDS) << 12);
            else
                ui[at] = BLANK_TILE;

            if (onScreen && row >= OVERLAY_ROW && row < OVERLAY_ROW + 3)
                overlay[at] = (OVERLAY_TILE + cell - OVERLAY_ROW * 30) | (ARENA_PAL_UI << 12);
            else
                overlay[at] = BLANK_TILE;
        }
    }
}

// The rows above the shift show the panel color of the stadium layer.
void ArenaScreen_WritePanelTilemap(s32 shift)
{
    u16 *map = (u16 *)BG_SCREEN_ADDR(MAP_UI) + PANEL_ROW * 32;
    s32 row, col;

    for (row = 0; row < ARENA_PANEL_ROWS; row++)
    {
        for (col = 0; col < 30; col++)
            map[row * 32 + col] = row < shift ? BLANK_TILE : (UI_BOTTOM_TILE + (PANEL_ROW - 12 + row - shift) * 30 + col) | (ARENA_PAL_CARDS << 12);
    }
}

void ArenaScreen_WriteOverlayTilemap(s32 shift)
{
    u16 *map = (u16 *)BG_SCREEN_ADDR(MAP_OVERLAY) + OVERLAY_ROW * 32;
    s32 row, col;

    for (row = 0; row < ARENA_OVERLAY_ROWS; row++)
    {
        for (col = 0; col < 30; col++)
        {
            s32 cell = col - shift;

            map[row * 32 + col] = cell >= 0 && cell < 30 ? (OVERLAY_TILE + row * 30 + cell) | (ARENA_PAL_UI << 12) : BLANK_TILE;
        }
    }
    gArenaScreen.overlay.shift = shift;
}

static void SetLayer(u8 bg, u8 map, u8 priority)
{
    SetBgAttribute(bg, BG_ATTR_CHARBASEINDEX, CHAR_BASE);
    SetBgAttribute(bg, BG_ATTR_MAPBASEINDEX, map);
    SetBgAttribute(bg, BG_ATTR_SCREENSIZE, 0);
    SetBgAttribute(bg, BG_ATTR_PRIORITY, priority);
}

// Call this after the engine sets up the battle backgrounds.
static void SetupVideo(void)
{
    FillBgTilemapBufferRect_Palette0(0, 0, 0, 0, 32, 64);
    CopyBgTilemapBufferToVram(0);
    SetLayer(1, MAP_UI, 2);
    SetLayer(2, MAP_OVERLAY, 1);
    SetLayer(3, MAP_STADIUM, 3);
    CpuFill32(0, TILE_ADDR(UI_TOP_TILE), (BLANK_TILE + 1 - UI_TOP_TILE) * TILE_SIZE_4BPP);
    WriteTilemaps();
    ScanlineEffect_Stop();
    ClearGpuRegBits(REG_OFFSET_DISPCNT, DISPCNT_WIN0_ON | DISPCNT_WIN1_ON | DISPCNT_OBJWIN_ON);
    SetGpuReg(REG_OFFSET_BLDCNT, 0);
    gBattle_BG1_X = gBattle_BG1_Y = 0;
    gBattle_BG2_X = gBattle_BG2_Y = 0;
    gBattle_BG3_X = gBattle_BG3_Y = 0;
    ArenaStadium_LoadPalettes(gArenaScreen.seed);
    LoadPalette(sUiPalette, BG_PLTT_ID(ARENA_PAL_UI), PLTT_SIZE_4BPP);
    LoadPalette(sCardsPalette, BG_PLTT_ID(ARENA_PAL_CARDS), PLTT_SIZE_4BPP);
    ArenaStadium_Draw(&gArenaStadiumCanvas, gArenaScreen.seed);
    ShowBg(1);
    ShowBg(2);
    ShowBg(3);
}

static void ComputeBounds(struct ArenaMon *mon, const u8 *pic)
{
    s32 x, y, x0 = 64, x1 = -1, y1 = -1;

    for (y = 0; y < 64; y++)
    {
        for (x = 0; x < 64; x++)
        {
            u8 byte = pic[((y / 8) * 8 + x / 8) * TILE_SIZE_4BPP + (y % 8) * 4 + (x % 8) / 2];

            if ((x & 1 ? byte >> 4 : byte & 0xF) != 0)
            {
                x0 = min(x0, x);
                x1 = max(x1, x);
                y1 = y;
            }
        }
    }
    if (x1 < 0)
    {
        x0 = 16;
        x1 = 48;
        y1 = 60;
    }
    mon->boundsX0 = x0;
    mon->boundsX1 = x1;
    mon->boundsY1 = y1;
    mon->shadowRx = max(8, min(26, (x1 - x0) * 42 / 100));
}

s32 ArenaScreen_FeetY(u8 side)
{
    return ARENA_MON_TOP + gArenaScreen.mons[side].boundsY1;
}

static s32 ShadowCenterX(u8 side)
{
    struct ArenaMon *mon = &gArenaScreen.mons[side];
    s32 middle = (mon->boundsX0 + mon->boundsX1) / 2;

    return side == B_SIDE_PLAYER ? gArenaMonCenterX[side] + 32 - middle : gArenaMonCenterX[side] - 32 + middle;
}

static void DrawShadows(s32 y0, s32 y1)
{
    struct ArenaCanvas rows = {gArenaStadiumCanvas.tiles + y0 / 8 * 30 * TILE_SIZE_4BPP / 2, y0, y1 - y0, 30};
    u32 side;

    ArenaStadium_DrawField(&rows, y0, y1);
    for (side = 0; side < ARENA_SIDES; side++)
    {
        struct ArenaMon *mon = &gArenaScreen.mons[side];

        if (mon->shown && !mon->hidden)
            ArenaStadium_DrawShadow(&rows, ShadowCenterX(side), ArenaScreen_FeetY(side), mon->shadowRx);
    }
}

u32 ArenaScreen_FieldCost(void)
{
    return gArenaScreen.dirty & ARENA_DIRTY_FIELD ? 95 : 0;
}

void ArenaScreen_DrawField(void)
{
    if (gArenaScreen.dirty & ARENA_DIRTY_FIELD_TOP)
        DrawShadows(ARENA_FIELD_HALF_Y, ARENA_FIELD_HALF_Y + ARENA_FIELD_HALF_H);
    else
        DrawShadows(ARENA_FIELD_HALF_Y + ARENA_FIELD_HALF_H, ARENA_FIELD_BOTTOM);
    gArenaScreen.dirty &= ~(gArenaScreen.dirty & ARENA_DIRTY_FIELD_TOP ? ARENA_DIRTY_FIELD_TOP : ARENA_DIRTY_FIELD);
}

static void LoadMonPic(u8 side, u16 species, u32 personality, const u32 *palette)
{
    struct ArenaMon *mon = &gArenaScreen.mons[side];
    u8 *buffer = gMonSpritesGfxPtr->sprites[side];
    u16 tileStart;

    LoadSpecialPokePic(&gMonFrontPicTable[species], buffer, species, personality, TRUE);
    buffer += gBattleMonForms[Arena_BattlerOf(side)] * MON_PIC_SIZE;
    tileStart = GetSpriteTileStartByTag(ARENA_TAG_MON(side));
    if (tileStart == 0xFFFF)
    {
        struct SpriteSheet sheet = {buffer, MON_PIC_SIZE, ARENA_TAG_MON(side)};

        LoadSpriteSheet(&sheet);
    }
    else
    {
        CpuCopy32(buffer, (u8 *)OBJ_VRAM0 + tileStart * TILE_SIZE_4BPP, MON_PIC_SIZE);
    }
    LoadCompressedPalette(palette, OBJ_PLTT_ID(side), PLTT_SIZE_4BPP);
    ComputeBounds(mon, buffer);
    mon->species = species;
}

static void CreateMonSprite(u8 side)
{
    struct ArenaMon *mon = &gArenaScreen.mons[side];
    struct Sprite *sprite;

    if (mon->spriteId != ARENA_NO_SPRITE)
        return;
    mon->spriteId = CreateSprite(&sMonTemplates[side], gArenaMonCenterX[side], ARENA_MON_CENTER_Y, side == B_SIDE_PLAYER ? 30 : 31);
    sprite = &gSprites[mon->spriteId];
    sprite->oam.paletteNum = side;
    sprite->affineAnimPaused = TRUE;
    sprite->data[0] = side;
    gBattlerSpriteIds[Arena_BattlerOf(side)] = mon->spriteId;
}

// The pic, the sprite and the bounds of the Pokémon at mons[side].partyIndex.
static void LoadMonGfx(u8 side)
{
    struct Pokemon *party = Arena_PartyOf(side);
    u8 battler = Arena_BattlerOf(side);
    u16 species = GetMonData(party, MON_DATA_SPECIES);

    if (gBattleSpritesDataPtr->battlerData[battler].transformSpecies != SPECIES_NONE)
        species = gBattleSpritesDataPtr->battlerData[battler].transformSpecies;
    LoadMonPic(side, species, GetMonData(party, MON_DATA_PERSONALITY), GetMonFrontSpritePal(party));
    CreateMonSprite(side);
}

void ArenaScreen_ShowMon(u8 side, u8 partyIndex, u8 fx)
{
    struct ArenaMon *mon = &gArenaScreen.mons[side];
    struct Pokemon *party = &Arena_Party(side)[partyIndex];

    mon->partyIndex = partyIndex;
    LoadMonGfx(side);
    mon->shown = TRUE;
    mon->hidden = FALSE;
    mon->hp = mon->trailHp = GetMonData(party, MON_DATA_HP);
    mon->maxHp = GetMonData(party, MON_DATA_MAX_HP);
    mon->trailFrames = 0;
    mon->tint = 0;
    mon->flashFrames = 0;
    if (side == B_SIDE_OPPONENT)
        gArenaScreen.team.foeSeen[partyIndex] = TRUE;
    ArenaScreen_StartMonFx(side, fx, fx == ARENA_MON_IDLE ? 0 : Arena_Frames(32));
    gSprites[mon->spriteId].invisible = FALSE;
    gArenaScreen.dirty |= ARENA_DIRTY_INFO(side) | ARENA_DIRTY_TEAM | ARENA_DIRTY_FIELD;
}

void ArenaScreen_HideMon(u8 side)
{
    struct ArenaMon *mon = &gArenaScreen.mons[side];

    mon->shown = FALSE;
    mon->fx = ARENA_MON_IDLE;
    if (mon->spriteId != ARENA_NO_SPRITE)
        gSprites[mon->spriteId].invisible = TRUE;
    gArenaScreen.dirty |= ARENA_DIRTY_INFO(side) | ARENA_DIRTY_TEAM | ARENA_DIRTY_FIELD;
}

void ArenaScreen_ShowTrainer(bool8 show)
{
    if (show && gArenaScreen.trainerSpriteId == ARENA_NO_SPRITE)
    {
        gArenaScreen.trainerSpriteId = CreateTrainerPicSprite(gTrainers[gTrainerBattleOpponent_A].trainerPic, TRUE,
                                                              gArenaMonCenterX[B_SIDE_OPPONENT], ARENA_MON_CENTER_Y, 0, ARENA_TAG_TRAINER_PAL);
        gSprites[gArenaScreen.trainerSpriteId].oam.priority = 3;
    }
    else if (!show && gArenaScreen.trainerSpriteId != ARENA_NO_SPRITE)
    {
        FreeAndDestroyTrainerPicSprite(gArenaScreen.trainerSpriteId);
        gArenaScreen.trainerSpriteId = ARENA_NO_SPRITE;
    }
}

void ArenaScreen_StartMonFx(u8 side, u8 fx, u16 length)
{
    struct ArenaMon *mon = &gArenaScreen.mons[side];

    mon->fx = length == 0 ? ARENA_MON_IDLE : fx;
    mon->fxFrame = 0;
    mon->fxLength = length;
    if (fx == ARENA_MON_HIT && length != 0)
        mon->flashFrames = 6;
}

bool8 ArenaScreen_MonFxDone(u8 side)
{
    return gArenaScreen.mons[side].fx == ARENA_MON_IDLE;
}

void ArenaScreen_SetHidden(u8 side, bool8 hidden)
{
    gArenaScreen.mons[side].hidden = hidden;
}

// A positive tint blends the sprite to red, a negative one to blue; it fades by one step for each frame.
void ArenaScreen_SetTint(u8 side, s8 tint)
{
    gArenaScreen.mons[side].tint = tint;
}

void ArenaScreen_Flash(u8 side, u8 frames)
{
    gArenaScreen.mons[side].flashFrames = frames;
}

// scaleX and scaleY are in 1/256.
static void SetMonMatrix(struct Sprite *sprite, u8 side, s32 scaleX, s32 scaleY)
{
    struct ArenaMon *mon = &gArenaScreen.mons[side];
    s32 a = 0x10000 / max(scaleX, 8);
    s32 d = 0x10000 / max(scaleY, 8);

    if (side == B_SIDE_PLAYER)
        a = -a;
    SetOamMatrix(sprite->oam.matrixNum, a, 0, 0, d);
    sprite->y2 += (mon->boundsY1 - 32) * (256 - scaleY) / 256;
}

static void SpriteCB_ArenaMon(struct Sprite *sprite)
{
    u8 side = sprite->data[0];
    struct ArenaMon *mon = &gArenaScreen.mons[side];
    s32 dir = side == B_SIDE_PLAYER ? 1 : -1;
    s32 t = mon->fxLength == 0 ? 256 : mon->fxFrame * 256 / mon->fxLength;
    s32 scaleX = 256, scaleY = 256;

    sprite->x2 = ArenaJuice_ShakeX();
    sprite->y2 = ArenaJuice_ShakeY();
    sprite->invisible = !mon->shown || mon->hidden;
    switch (mon->fx)
    {
    case ARENA_MON_IDLE:
        if (Arena_JuiceOn())
            sprite->y2 += ((gArenaScreen.time + side * 20) / 20) % 2;
        break;
    case ARENA_MON_ENTER:
        if (t < 128)
        {
            sprite->invisible = TRUE;
        }
        else
        {
            scaleX = scaleY = (t - 128) * 2;
            if (t > 220)
                scaleY = 256 + (256 - t) * 2;
        }
        break;
    case ARENA_MON_APPEAR:
        sprite->x2 += -dir * (256 - t) * 80 / 256;
        break;
    case ARENA_MON_FAINT:
        scaleY = 256 - t;
        scaleX = 256 + t / 4;
        sprite->y2 += t / 16;
        break;
    case ARENA_MON_LUNGE:
        sprite->x2 += dir * (t < 128 ? t : 256 - t) * 14 / 128;
        scaleX = 256 + (t < 128 ? t : 256 - t) / 6;
        scaleY = 256 - (t < 128 ? t : 256 - t) / 8;
        break;
    case ARENA_MON_HIT:
        sprite->x2 += (mon->fxFrame / 2) % 2 ? 2 * dir : -2 * dir;
        scaleY = 256 - (256 - t) / 8;
        scaleX = 256 + (256 - t) / 10;
        break;
    case ARENA_MON_RETURN:
    case ARENA_MON_CAUGHT:
        scaleX = scaleY = 256 - t;
        break;
    }
    if (gArenaScreen.camera.zoomFrames != 0 && gArenaScreen.camera.zoomSide == side)
    {
        scaleX = scaleX * 9 / 8;
        scaleY = scaleY * 9 / 8;
    }
    SetMonMatrix(sprite, side, scaleX, scaleY);
}

static void UpdateMonFx(u8 side)
{
    struct ArenaMon *mon = &gArenaScreen.mons[side];

    if (mon->fx != ARENA_MON_IDLE && ++mon->fxFrame >= mon->fxLength)
    {
        if (mon->fx == ARENA_MON_FAINT || mon->fx == ARENA_MON_RETURN || mon->fx == ARENA_MON_CAUGHT)
            ArenaScreen_HideMon(side);
        mon->fx = ARENA_MON_IDLE;
    }
    if (mon->spriteId == ARENA_NO_SPRITE)
        return;
    if (mon->flashFrames != 0)
    {
        mon->flashFrames--;
        BlendPalette(OBJ_PLTT_ID(side), 16, mon->flashFrames != 0 ? 14 : 0, RGB_WHITE);
    }
    else if (mon->tint != 0)
    {
        u8 coeff = min(abs(mon->tint), 8);

        BlendPalette(OBJ_PLTT_ID(side), 16, coeff, mon->tint > 0 ? RGB(31, 8, 6) : RGB(8, 12, 31));
        mon->tint += mon->tint > 0 ? -1 : 1;
    }
}

void ArenaScreen_SetHp(u8 side, s32 hp)
{
    struct ArenaMon *mon = &gArenaScreen.mons[side];

    hp = max(0, min(hp, mon->maxHp));
    if (hp < mon->hp)
    {
        mon->trailHp = max(mon->trailHp, mon->hp);
        mon->trailFrames = Arena_Frames(24);
    }
    else
    {
        mon->trailHp = hp;
    }
    mon->hp = hp;
    gArenaScreen.dirty |= ARENA_DIRTY_HP(side) | ARENA_DIRTY_TEAM_HP;
}

void ArenaScreen_SetMaxHp(u8 side, u16 maxHp)
{
    gArenaScreen.mons[side].maxHp = maxHp;
}

static void UpdateTrail(u8 side)
{
    struct ArenaMon *mon = &gArenaScreen.mons[side];

    if (mon->trailHp <= mon->hp)
        return;
    if (mon->trailFrames != 0)
        mon->trailFrames--;
    else
        mon->trailHp = max(mon->hp, mon->trailHp - max(1, mon->maxHp / 48));
    gArenaScreen.dirty |= ARENA_DIRTY_HP(side);
}

static void Task_ArenaScreen(u8 taskId)
{
    u32 side;

    if (!gArenaBattle.active || !gArenaScreen.built || gMain.callback2 != BattleMainCB2)
        return;
    if (ArenaJuice_SkipsFrame())
        return;
    gArenaScreen.time++;
    for (side = 0; side < ARENA_SIDES; side++)
    {
        UpdateMonFx(side);
        UpdateTrail(side);
    }
    ArenaHud_Update();
    ArenaPanel_Update();
    ArenaJuice_Update();
    ArenaRaster_Draw();
    ArenaPanel_UpdateCardSlide();
    ArenaJuice_UpdateLowHp();
    gBattle_BG3_X = gBattle_BG1_X = -ArenaJuice_ShakeX();
    gBattle_BG3_Y = gBattle_BG1_Y = -ArenaJuice_ShakeY();
}

// The palettes stay black: the caller fades them in.
void ArenaScreen_Build(bool8 withMons)
{
    u32 side;

    SetupVideo();
    ArenaHud_LoadIconPalettes();
    ArenaJuice_LoadGfx();
    for (side = 0; side < ARENA_SIDES; side++)
    {
        struct ArenaMon *mon = &gArenaScreen.mons[side];

        mon->spriteId = ARENA_NO_SPRITE;
        memset(gArenaScreen.team.iconSpriteIds[side], ARENA_NO_SPRITE, PARTY_SIZE);
        if (withMons && mon->shown)
            LoadMonGfx(side);
        else
            mon->shown = FALSE;
    }
    gArenaScreen.trainerSpriteId = ARENA_NO_SPRITE;
    ArenaHud_UpdateIcons();
    ArenaRaster_DrawAll();
    CpuFill16(RGB_BLACK, gPlttBufferFaded, PLTT_SIZE);
    gArenaScreen.built = TRUE;
    if (!FuncIsActiveTask(Task_ArenaScreen))
        CreateTask(Task_ArenaScreen, 80);
}

// The sprites stay: the next screen resets all the sprite data.
void ArenaScreen_Free(void)
{
    gArenaScreen.built = FALSE;
    ArenaJuice_Free();
}
