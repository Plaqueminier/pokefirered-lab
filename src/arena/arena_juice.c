#include "global.h"
#include "malloc.h"
#include "arena_internal.h"
#include "battle.h"
#include "battle_interface.h"
#include "characters.h"
#include "trig.h"
#include "gpu_regs.h"
#include "m4a.h"
#include "palette.h"
#include "pokemon.h"
#include "sound.h"
#include "sprite.h"
#include "string_util.h"
#include "constants/songs.h"

#define TILE_DOT(color) (color)
#define TILE_BIG_DOT(color) (16 + (color))
#define TILE_LINE 32
#define TILE_BAR_H (TILE_LINE + 4)
#define TILE_BAR_V (TILE_BAR_H + 4)
#define FX_TILES (TILE_BAR_V + 4)

static const u16 sFxPalette[16] =
{
    [FX_WHITE] = ARENA_RGB(0xff, 0xff, 0xff),
    [FX_PALE_YELLOW] = ARENA_RGB(0xf8, 0xf0, 0xa0),
    [FX_LIGHT_BLUE] = ARENA_RGB(0xa8, 0xd8, 0xff),
    [FX_DUST] = ARENA_RGB(0xc8, 0xa8, 0x78),
    [FX_DUST + 1] = ARENA_RGB(0xe0, 0xc8, 0x98),
    [FX_DUST + 2] = ARENA_RGB(0xa8, 0x84, 0x50),
    [FX_DUST + 3] = ARENA_RGB(0xf0, 0xe0, 0xb8),
    [FX_GOLD] = ARENA_RGB(0xf8, 0xd0, 0x48),
    [FX_RED] = ARENA_RGB(0xf0, 0x58, 0x48),
    [FX_BLUE] = ARENA_RGB(0x58, 0xa8, 0xf0),
    [FX_GREEN] = ARENA_RGB(0x78, 0xd0, 0x70),
    [FX_PURPLE] = ARENA_RGB(0xd0, 0x70, 0xe0),
    [FX_STAT_BLUE] = ARENA_RGB(0x78, 0x98, 0xf8),
    [FX_ALARM] = ARENA_RGB(0xe8, 0x30, 0x20),
};

enum
{
    NUM_WHITE = 1,
    NUM_SHADOW,
    NUM_ORANGE,
    NUM_BLUE,
    NUM_GREEN,
};

static const u16 sFloatPalette[16] =
{
    [NUM_WHITE] = ARENA_RGB(0xff, 0xff, 0xff),
    [NUM_SHADOW] = ARENA_RGB(0x10, 0x10, 0x18),
    [NUM_ORANGE] = ARENA_RGB(0xf8, 0xa0, 0x30),
    [NUM_BLUE] = ARENA_RGB(0xa8, 0xc0, 0xe0),
    [NUM_GREEN] = ARENA_RGB(0x78, 0xe8, 0x90),
};

static const struct OamData sOamDot = {.shape = SPRITE_SHAPE(8x8), .size = SPRITE_SIZE(8x8), .priority = 1};
static const struct OamData sOamLine = {.shape = SPRITE_SHAPE(32x8), .size = SPRITE_SIZE(32x8), .priority = 1};
static const struct OamData sOamFloat = {.shape = SPRITE_SHAPE(32x16), .size = SPRITE_SIZE(32x16), .priority = 1};
static const struct OamData sOamBarH = {.shape = SPRITE_SHAPE(32x8), .size = SPRITE_SIZE(32x8), .priority = 1, .objMode = ST_OAM_OBJ_BLEND};
static const struct OamData sOamBarV = {.shape = SPRITE_SHAPE(8x32), .size = SPRITE_SIZE(8x32), .priority = 1, .objMode = ST_OAM_OBJ_BLEND};

static const struct SpriteTemplate sDotTemplate = {ARENA_TAG_FX, ARENA_TAG_FX_PAL, &sOamDot, gDummySpriteAnimTable, NULL, gDummySpriteAffineAnimTable, SpriteCallbackDummy};
static const struct SpriteTemplate sLineTemplate = {ARENA_TAG_FX, ARENA_TAG_FX_PAL, &sOamLine, gDummySpriteAnimTable, NULL, gDummySpriteAffineAnimTable, SpriteCallbackDummy};
static const struct SpriteTemplate sBarHTemplate = {ARENA_TAG_FX, ARENA_TAG_FX_PAL, &sOamBarH, gDummySpriteAnimTable, NULL, gDummySpriteAffineAnimTable, SpriteCallbackDummy};
static const struct SpriteTemplate sBarVTemplate = {ARENA_TAG_FX, ARENA_TAG_FX_PAL, &sOamBarV, gDummySpriteAnimTable, NULL, gDummySpriteAffineAnimTable, SpriteCallbackDummy};

static const u8 sText_Critical[] = _("CRITICAL!");
static const u8 sText_SuperEffective[] = _("SUPER EFFECTIVE!");
static const u8 sText_NotVeryEffective[] = _("NOT VERY EFFECTIVE…");

static void PutPixel(u8 *tile, s32 x, s32 y, u8 color)
{
    tile[y * 4 + x / 2] |= x & 1 ? color << 4 : color;
}

void ArenaJuice_LoadGfx(void)
{
    u8 *tiles = AllocZeroed(FX_TILES * TILE_SIZE_4BPP);
    struct SpriteSheet sheet = {tiles, FX_TILES * TILE_SIZE_4BPP, ARENA_TAG_FX};
    struct SpritePalette palette = {sFxPalette, ARENA_TAG_FX_PAL};
    struct SpritePalette floatPalette = {sFloatPalette, ARENA_TAG_FLOAT_PAL};
    s32 color, x, y, i;

    if (tiles != NULL)
    {
        for (color = 0; color < 16; color++)
        {
            PutPixel(&tiles[TILE_DOT(color) * TILE_SIZE_4BPP], 3, 3, color);
            for (y = 3; y < 5; y++)
                for (x = 3; x < 5; x++)
                    PutPixel(&tiles[TILE_BIG_DOT(color) * TILE_SIZE_4BPP], x, y, color);
        }
        for (i = 0; i < 4; i++)
            for (x = 0; x < 8; x++)
                PutPixel(&tiles[(TILE_LINE + i) * TILE_SIZE_4BPP], x, 3, FX_PALE_YELLOW);
        for (i = 0; i < 4; i++)
        {
            for (x = 0; x < 8; x++)
            {
                for (y = 0; y < 3; y++)
                {
                    PutPixel(&tiles[(TILE_BAR_H + i) * TILE_SIZE_4BPP], x, y, FX_ALARM);
                    PutPixel(&tiles[(TILE_BAR_V + i) * TILE_SIZE_4BPP], y, x, FX_ALARM);
                }
            }
        }
        FreeSpriteTilesByTag(ARENA_TAG_FX);
        LoadSpriteSheet(&sheet);
        Free(tiles);
    }
    LoadSpritePalette(&palette);
    LoadSpritePalette(&floatPalette);
    memset(gArenaScreen.juice.particles, 0, sizeof(gArenaScreen.juice.particles));
    for (i = 0; i < ARENA_MAX_PARTICLES; i++)
        gArenaScreen.juice.particles[i].spriteId = ARENA_NO_SPRITE;
    for (i = 0; i < ARENA_MAX_FLOATS; i++)
        gArenaScreen.juice.floats[i].spriteId = ARENA_NO_SPRITE;
    for (i = 0; i < ARENA_LOW_HP_BARS; i++)
        gArenaScreen.juice.lowHpSpriteIds[i] = ARENA_NO_SPRITE;
    ArenaMoveFx_Reset();
    gArenaScreen.juice.lowHpSound = FALSE;
    ArenaBall_Reset();
}

static struct ArenaParticle *NewParticle(const struct SpriteTemplate *template, u16 tile)
{
    u32 i;

    for (i = 0; i < ARENA_MAX_PARTICLES; i++)
    {
        struct ArenaParticle *p = &gArenaScreen.juice.particles[i];

        if (p->spriteId == ARENA_NO_SPRITE)
        {
            p->spriteId = CreateSprite(template, -16, -16, 0);
            if (p->spriteId == MAX_SPRITES)
            {
                p->spriteId = ARENA_NO_SPRITE;
                return NULL;
            }
            gSprites[p->spriteId].oam.tileNum += tile;
            p->age = 0;
            p->wobble = 0;
            return p;
        }
    }
    return NULL;
}

static void KillParticle(struct ArenaParticle *p)
{
    DestroySprite(&gSprites[p->spriteId]);
    p->spriteId = ARENA_NO_SPRITE;
}

// Speeds are in 1/256 pixel for each frame.
static struct ArenaParticle *Spawn(s32 x, s32 y, u8 color, bool8 big, s16 vx, s16 vy, s16 gravity, u16 life)
{
    struct ArenaParticle *p;

    if (!Arena_JuiceOn())
        return NULL;
    p = NewParticle(&sDotTemplate, big ? TILE_BIG_DOT(color) : TILE_DOT(color));
    if (p == NULL)
        return NULL;
    p->x = x << 8;
    p->y = y << 8;
    p->vx = vx;
    p->vy = vy;
    p->gravity = gravity;
    p->life = life;
    return p;
}

void ArenaJuice_Burst(s32 x, s32 y, u8 count, const u8 *colors, u8 colorCount, u8 speed, bool8 up, u16 life)
{
    u32 i;

    for (i = 0; i < count; i++)
    {
        u16 angle = up ? 195 + Arena_FxRandom() % 150 : Arena_FxRandom() % 360;
        s32 speed256 = speed * (128 + Arena_FxRandom() % 256);

        Spawn(x, y, colors[i % colorCount], Arena_FxRandom() % 3 == 0, Cos2(angle) * speed256 / 4096,
              Sin2(angle) * speed256 / 4096 - (up ? 0 : 64), 12, life / 2 + Arena_FxRandom() % life);
    }
}

static void Confetti(u8 count)
{
    static const u8 sColors[] = {FX_GOLD, FX_RED, FX_BLUE, FX_GREEN, FX_WHITE, FX_PURPLE};
    u32 i;

    for (i = 0; i < count; i++)
    {
        struct ArenaParticle *p = Spawn(Arena_FxRandom() % DISPLAY_WIDTH, -4 - (s32)(Arena_FxRandom() % 40), sColors[i % ARRAY_COUNT(sColors)],
                                        TRUE, (s32)(Arena_FxRandom() % 128) - 64, 160 + Arena_FxRandom() % 160, 1, 150);

        if (p != NULL)
            p->wobble = 1 + Arena_FxRandom() % 6;
    }
}

void ArenaJuice_Sparkle(s32 x, s32 y, s32 w, s32 h)
{
    static const u8 sColors[] = {FX_GOLD, FX_WHITE, FX_PALE_YELLOW};

    Spawn(x + Arena_FxRandom() % w, y + Arena_FxRandom() % h, sColors[Arena_FxRandom() % ARRAY_COUNT(sColors)], Arena_FxRandom() % 2, 0, -64, 0,
          8 + Arena_FxRandom() % 8);
}

static void CameraFlashes(u8 count)
{
    u32 i;

    for (i = 0; i < count; i++)
        Spawn(2 + Arena_FxRandom() % 236, 5 + Arena_FxRandom() % 34, FX_WHITE, Arena_FxRandom() % 2, 0, 0, 0, 3 + Arena_FxRandom() % 4);
}

static void StartSpeedLines(s8 direction)
{
    u32 i;

    if (!Arena_JuiceOn())
        return;
    for (i = 0; i < 10; i++)
    {
        struct ArenaParticle *p = NewParticle(&sLineTemplate, TILE_LINE);

        if (p == NULL)
            return;
        p->x = (s32)(Arena_FxRandom() % DISPLAY_WIDTH) << 8;
        p->y = (54 + (s32)(Arena_FxRandom() % 52)) << 8;
        p->vx = direction * (768 + Arena_FxRandom() % 512);
        p->vy = 0;
        p->gravity = 0;
        p->life = 24;
    }
}

void ArenaJuice_UpdateParticles(void)
{
    u32 i;

    for (i = 0; i < ARENA_MAX_PARTICLES; i++)
    {
        struct ArenaParticle *p = &gArenaScreen.juice.particles[i];
        struct Sprite *sprite;

        if (p->spriteId == ARENA_NO_SPRITE)
            continue;
        if (++p->age >= p->life)
        {
            KillParticle(p);
            continue;
        }
        p->x += p->vx;
        p->y += p->vy;
        p->vy += p->gravity;
        sprite = &gSprites[p->spriteId];
        sprite->x = (p->x >> 8) + 4;
        sprite->y = (p->y >> 8) + 4;
        if (p->wobble != 0)
            sprite->x += Sin2((p->age * 8 + p->wobble * 60) % 360) * 2 / 4096;
    }
}

void ArenaJuice_DamageNumber(u8 side, s32 value, u8 kind)
{
    static const u8 sColors[] =
    {
        [ARENA_NUMBER_DAMAGE] = NUM_WHITE,
        [ARENA_NUMBER_SUPER_EFFECTIVE] = NUM_ORANGE,
        [ARENA_NUMBER_NOT_VERY_EFFECTIVE] = NUM_BLUE,
        [ARENA_NUMBER_HEAL] = NUM_GREEN,
    };
    u32 tiles[8 * TILE_SIZE_4BPP / 4];
    struct ArenaCanvas canvas = {(u16 *)tiles, 0, 16, 4};
    u8 text[8];
    u32 i;
    struct ArenaFloat *f = NULL;

    if (!Arena_JuiceOn())
        return;
    for (i = 0; i < ARENA_MAX_FLOATS; i++)
    {
        if (gArenaScreen.juice.floats[i].spriteId == ARENA_NO_SPRITE)
        {
            f = &gArenaScreen.juice.floats[i];
            break;
        }
    }
    if (f == NULL)
        return;
    memset(tiles, 0, sizeof(tiles));
    if (value > 0)
    {
        text[0] = CHAR_PLUS;
        ConvertIntToDecimalStringN(text + 1, value, STR_CONV_MODE_LEFT_ALIGN, 3);
    }
    else
    {
        text[0] = CHAR_HYPHEN;
        ConvertIntToDecimalStringN(text + 1, -value, STR_CONV_MODE_LEFT_ALIGN, 3);
    }
    ArenaCanvas_Text(&canvas, 16, 3, text, ARENA_FONT_BIG, sColors[kind], NUM_SHADOW, ARENA_ALIGN_CENTER);
    {
        struct SpriteSheet sheet = {tiles, sizeof(tiles), ARENA_TAG_FLOAT(i)};
        struct SpriteTemplate template = {ARENA_TAG_FLOAT(i), ARENA_TAG_FLOAT_PAL, &sOamFloat, gDummySpriteAnimTable, NULL, gDummySpriteAffineAnimTable, SpriteCallbackDummy};

        FreeSpriteTilesByTag(ARENA_TAG_FLOAT(i));
        LoadSpriteSheet(&sheet);
        f->spriteId = CreateSprite(&template, gArenaMonCenterX[side], ARENA_MON_CENTER_Y - 24, 0);
        if (f->spriteId == MAX_SPRITES)
        {
            f->spriteId = ARENA_NO_SPRITE;
            return;
        }
    }
    f->side = side;
    f->age = 0;
    f->vx = (s32)(Arena_FxRandom() % 5) - 2;
}

static void UpdateFloats(void)
{
    u32 i;

    for (i = 0; i < ARENA_MAX_FLOATS; i++)
    {
        struct ArenaFloat *f = &gArenaScreen.juice.floats[i];
        s32 t;

        if (f->spriteId == ARENA_NO_SPRITE)
            continue;
        t = ++f->age;
        if (t > 50)
        {
            DestroySprite(&gSprites[f->spriteId]);
            FreeSpriteTilesByTag(ARENA_TAG_FLOAT(i));
            f->spriteId = ARENA_NO_SPRITE;
            continue;
        }
        gSprites[f->spriteId].x = gArenaMonCenterX[f->side] + f->vx * t / 3;
        gSprites[f->spriteId].y = ARENA_MON_CENTER_Y - 24 - t * 22 / 50 + t * t * 18 / 2500 - (t < 6 ? 6 - t : 0);
    }
}

s32 ArenaJuice_ShakeX(void)
{
    if (gArenaScreen.camera.shakeFrames == 0)
        return 0;
    return ((s32)((gArenaScreen.time * 7 + gArenaScreen.camera.shakeFrames * 13) % 5) - 2) * gArenaScreen.camera.shakeMagnitude * gArenaScreen.camera.shakeFrames / 32;
}

s32 ArenaJuice_ShakeY(void)
{
    if (gArenaScreen.camera.shakeFrames == 0)
        return 0;
    return ((s32)((gArenaScreen.time * 3 + gArenaScreen.camera.shakeFrames * 5) % 3) - 1) * gArenaScreen.camera.shakeMagnitude * gArenaScreen.camera.shakeFrames / 40;
}

static void Shake(u8 frames, u8 magnitude)
{
    if (!Arena_JuiceOn())
        return;
    gArenaScreen.camera.shakeFrames = frames;
    gArenaScreen.camera.shakeMagnitude = magnitude;
}

static void HitStop(u8 frames)
{
    if (gSaveBlock2Ptr->arenaSettings.speed <= ARENA_SPEED_2X)
        gArenaScreen.camera.hitstop = frames;
}

static void Slam(const u8 *text, u8 color)
{
    if (Arena_JuiceOn())
        ArenaPanel_ShowSlam(text, color);
}

void ArenaJuice_OnMove(u8 side, u16 move)
{
    ArenaHud_ShowBanner(side, move);
    ArenaScreen_StartMonFx(side, ARENA_MON_LUNGE, Arena_Frames(20));
    ArenaMoveFx_Start(side, move);
    if (gBattleMoves[move].flags & FLAG_MAKES_CONTACT)
        StartSpeedLines(side == B_SIDE_PLAYER ? 1 : -1);
}

void ArenaJuice_OnHit(u8 side, bool8 critical, u8 effectiveness, u16 damage)
{
    static const u8 sSparks[] = {FX_TYPE, FX_WHITE, FX_PALE_YELLOW};
    struct ArenaMon *mon = &gArenaScreen.mons[side];
    u32 ratio = min(16, damage * 16 / max(1, mon->maxHp));
    bool8 big = critical || effectiveness > 100;

    ArenaScreen_StartMonFx(side, ARENA_MON_HIT, Arena_Frames(16));
    HitStop(big ? 8 : 5);
    Shake(18, 1 + ratio * 5 / 16 + (big ? 2 : 0));
    ArenaScreen_SetObjColor(ARENA_TAG_FX_PAL, FX_TYPE, Arena_TypeColor(gBattleMoves[gCurrentMove].type));
    ArenaJuice_Burst(gArenaMonCenterX[side], ARENA_MON_CENTER_Y, 8 + ratio, sSparks, ARRAY_COUNT(sSparks), 3, FALSE, 30);
    ArenaCrowd_SetCheer(16);
    CameraFlashes(4 + ratio / 2);
    if (big && Arena_JuiceOn())
    {
        gArenaScreen.camera.zoomSide = side;
        gArenaScreen.camera.zoomFrames = 24;
        PlaySE(SE_APPLAUSE);
    }
    if (critical)
        Slam(sText_Critical, UI_GOLD);
    else if (effectiveness > 100)
        Slam(sText_SuperEffective, UI_ORANGE);
    else if (effectiveness != 0 && effectiveness < 100)
        Slam(sText_NotVeryEffective, UI_BLUE);
}

static bool8 FoeTeamFainted(void)
{
    u32 i;

    for (i = 0; i < PARTY_SIZE; i++)
    {
        if (Arena_IsTeamMon(&gEnemyParty[i]) && GetMonData(&gEnemyParty[i], MON_DATA_HP) != 0)
            return FALSE;
    }
    return TRUE;
}

static void OnVictory(void)
{
    ArenaCrowd_SetCheer(16);
    Confetti(36);
}

void ArenaJuice_OnFaint(u8 side)
{
    static const u8 sDust[] = {FX_DUST, FX_DUST + 1, FX_DUST + 2, FX_DUST + 3};

    ArenaJuice_Burst(gArenaMonCenterX[side], ArenaScreen_FeetY(side), 20, sDust, ARRAY_COUNT(sDust), 2, TRUE, 40);
    Shake(24, 4);
    if (Arena_JuiceOn())
    {
        gArenaScreen.camera.slowFrames = 40;
        gArenaScreen.camera.zoomSide = side;
        gArenaScreen.camera.zoomFrames = 40;
    }
    PlaySE12WithPanning(SE_FAINT, Arena_Pan(side));
    if (side != B_SIDE_OPPONENT)
        return;
    if (Arena_JuiceOn())
        PlaySE(SE_APPLAUSE);
    ArenaCrowd_SetCheer(16);
    if (FoeTeamFainted())
        OnVictory();
}

void ArenaJuice_OnSendOut(u8 side)
{
    static const u8 sFlash[] = {FX_WHITE, FX_PALE_YELLOW, FX_LIGHT_BLUE};
    static const u8 sDust[] = {FX_DUST, FX_DUST + 1, FX_DUST + 3};

    ArenaJuice_Burst(gArenaMonCenterX[side], ArenaScreen_FeetY(side) - 12, 12, sFlash, ARRAY_COUNT(sFlash), 3, FALSE, 24);
    ArenaJuice_Burst(gArenaMonCenterX[side], ArenaScreen_FeetY(side), 10, sDust, ARRAY_COUNT(sDust), 2, TRUE, 30);
}

void ArenaJuice_OnStatChange(u8 side, bool8 up)
{
    static const u8 sUp[] = {FX_RED, FX_PALE_YELLOW};
    static const u8 sDown[] = {FX_STAT_BLUE, FX_LIGHT_BLUE};

    ArenaScreen_SetTint(side, up ? 16 : -16);
    ArenaJuice_Burst(gArenaMonCenterX[side], up ? ArenaScreen_FeetY(side) : ARENA_MON_CENTER_Y - 20, 8, up ? sUp : sDown, 2, 1, up, 36);
    PlaySE12WithPanning(up ? SE_M_STAT_INCREASE : SE_M_STAT_DECREASE, Arena_Pan(side));
}

void ArenaJuice_OnLevelUp(void)
{
    static const u8 sColors[] = {FX_GOLD, FX_WHITE, FX_PALE_YELLOW};

    ArenaJuice_Burst(gArenaMonCenterX[B_SIDE_PLAYER], ARENA_MON_CENTER_Y, 20, sColors, ARRAY_COUNT(sColors), 3, FALSE, 40);
}

void ArenaJuice_OnTurn(u16 turn)
{
    if (Arena_JuiceOn())
        ArenaPanel_ShowTurn(turn);
}

static void SetLowHpBars(bool8 on)
{
    static const struct {s16 x, y; bool8 vertical; bool8 flip;} sBars[ARENA_LOW_HP_BARS] =
    {
        {16, 53, FALSE, FALSE}, {48, 53, FALSE, FALSE}, {80, 53, FALSE, FALSE}, {112, 53, FALSE, FALSE},
        {144, 53, FALSE, FALSE}, {176, 53, FALSE, FALSE}, {208, 53, FALSE, FALSE}, {240, 53, FALSE, FALSE},
        {16, 116, FALSE, TRUE}, {48, 116, FALSE, TRUE}, {80, 116, FALSE, TRUE}, {112, 116, FALSE, TRUE},
        {144, 116, FALSE, TRUE}, {176, 116, FALSE, TRUE}, {208, 116, FALSE, TRUE}, {240, 116, FALSE, TRUE},
        {4, 65, TRUE, FALSE}, {4, 97, TRUE, FALSE}, {236, 65, TRUE, TRUE}, {236, 97, TRUE, TRUE},
    };
    u32 i;

    for (i = 0; i < ARENA_LOW_HP_BARS; i++)
    {
        u8 *id = &gArenaScreen.juice.lowHpSpriteIds[i];

        if (on && *id == ARENA_NO_SPRITE)
        {
            *id = CreateSprite(sBars[i].vertical ? &sBarVTemplate : &sBarHTemplate, sBars[i].x, sBars[i].y, 0);
            if (*id == MAX_SPRITES)
            {
                *id = ARENA_NO_SPRITE;
                continue;
            }
            gSprites[*id].oam.tileNum += sBars[i].vertical ? TILE_BAR_V : TILE_BAR_H;
            if (sBars[i].vertical)
                gSprites[*id].hFlip = sBars[i].flip;
            else
                gSprites[*id].vFlip = sBars[i].flip;
        }
        else if (!on && *id != ARENA_NO_SPRITE)
        {
            DestroySprite(&gSprites[*id]);
            *id = ARENA_NO_SPRITE;
        }
    }
}

void ArenaJuice_UpdateLowHp(void)
{
    struct ArenaMon *mon = &gArenaScreen.mons[B_SIDE_PLAYER];
    bool8 red = mon->shown && GetHPBarLevel(mon->hp, mon->maxHp) == HP_BAR_RED;
    s32 eva;

    SetLowHpBars(red && Arena_JuiceOn());
    if (red)
    {
        // BLDCNT has no first target, so only the sprites in semi-transparent mode blend.
        eva = 5 + (Sin2((gArenaScreen.time * 6) % 360) * 4 / 4096);
        SetGpuReg(REG_OFFSET_BLDCNT, BLDCNT_TGT2_ALL);
        SetGpuReg(REG_OFFSET_BLDALPHA, BLDALPHA_BLEND(eva, 16 - eva));
    }
    if (red && !gArenaScreen.juice.lowHpSound)
    {
        gArenaScreen.juice.lowHpSound = TRUE;
        PlaySE(SE_LOW_HEALTH);
    }
    else if (!red && gArenaScreen.juice.lowHpSound)
    {
        gArenaScreen.juice.lowHpSound = FALSE;
        m4aSongNumStop(SE_LOW_HEALTH);
    }
}

// The hit stop and the slow motion skip frames of the screen task.
bool8 ArenaJuice_SkipsFrame(void)
{
    struct ArenaCamera *camera = &gArenaScreen.camera;

    if (camera->hitstop != 0)
    {
        camera->hitstop--;
        return TRUE;
    }
    return camera->slowFrames != 0 && (camera->slowFrames-- % 2) == 0;
}

void ArenaJuice_Update(void)
{
    struct ArenaCamera *camera = &gArenaScreen.camera;

    if (camera->zoomFrames != 0)
        camera->zoomFrames--;
    if (camera->shakeFrames != 0)
        camera->shakeFrames--;
    ArenaJuice_UpdateParticles();
    UpdateFloats();
    ArenaMoveFx_Update();
    ArenaBall_Update();
    if (gArenaScreen.crowd.cheer > 8 && gArenaScreen.time % 8 == 0)
        CameraFlashes(1);
    else if (gArenaScreen.time % 40 == 0)
        CameraFlashes(1);
}

void ArenaJuice_Free(void)
{
    if (gArenaScreen.juice.lowHpSound)
        m4aSongNumStop(SE_LOW_HEALTH);
    gArenaScreen.juice.lowHpSound = FALSE;
}
