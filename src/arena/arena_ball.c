// The Poké Ball of a send-out and of a capture.
#include "global.h"
#include "arena_internal.h"
#include "battle_anim.h"
#include "decompress.h"
#include "pokeball.h"
#include "sound.h"
#include "sprite.h"
#include "trig.h"
#include "constants/songs.h"

#define THROW_FRAMES 26
#define DROP_FRAMES 16
#define SHAKE_FRAMES 24
#define CAPTURE_END_FRAMES 20

enum
{
    BALL_IDLE,
    BALL_SEND_OUT,
    BALL_CAPTURE,
};

struct ArenaBall
{
    u8 mode;
    u8 side;
    u8 shakes;
    bool8 caught;
    u8 spriteId;
    u16 frame;
    u16 tag;
};

static EWRAM_DATA struct ArenaBall sBall = {0};

static const struct OamData sOamBall = {.shape = SPRITE_SHAPE(16x16), .size = SPRITE_SIZE(16x16), .priority = 1};

static u16 Length(void)
{
    if (sBall.mode == BALL_SEND_OUT)
        return Arena_Frames(THROW_FRAMES);
    return Arena_Frames(THROW_FRAMES + DROP_FRAMES + sBall.shakes * SHAKE_FRAMES + CAPTURE_END_FRAMES);
}

// The sprites of the last screen are gone.
void ArenaBall_Reset(void)
{
    sBall.spriteId = ARENA_NO_SPRITE;
}

static void Start(u8 mode, u8 side, u16 ball, u8 shakes, bool8 caught)
{
    struct SpriteTemplate template = {0};

    if (sBall.spriteId != ARENA_NO_SPRITE)
        DestroySprite(&gSprites[sBall.spriteId]);
    sBall.spriteId = ARENA_NO_SPRITE;
    sBall.mode = mode;
    sBall.side = side;
    sBall.shakes = shakes;
    sBall.caught = caught;
    sBall.frame = 0;
    if (Length() == 0)
    {
        sBall.mode = BALL_IDLE;
        return;
    }
    LoadCompressedSpriteSheetUsingHeap(&gBallSpriteSheets[ball]);
    LoadCompressedSpritePaletteUsingHeap(&gBallSpritePalettes[ball]);
    sBall.tag = gBallSpriteSheets[ball].tag;
    template.tileTag = gBallSpriteSheets[ball].tag;
    template.paletteTag = gBallSpritePalettes[ball].tag;
    template.oam = &sOamBall;
    template.anims = gDummySpriteAnimTable;
    template.affineAnims = gDummySpriteAffineAnimTable;
    template.callback = SpriteCallbackDummy;
    sBall.spriteId = CreateSprite(&template, -16, -16, 0);
    if (sBall.spriteId == MAX_SPRITES)
        sBall.spriteId = ARENA_NO_SPRITE;
    PlaySE(SE_BALL_THROW);
}

void ArenaBall_StartSendOut(u8 side, u16 ball)
{
    Start(BALL_SEND_OUT, side, ball, 0, FALSE);
}

void ArenaBall_StartCapture(u16 ball, u8 shakes, bool8 caught)
{
    Start(BALL_CAPTURE, B_SIDE_OPPONENT, ball, shakes, caught);
}

bool8 ArenaBall_Done(void)
{
    return sBall.mode == BALL_IDLE;
}

static void UpdateShakes(struct Sprite *sprite, s32 t, s32 toX, s32 toY)
{
    if (t < sBall.shakes * SHAKE_FRAMES)
    {
        s32 inShake = t % SHAKE_FRAMES;

        sprite->x2 = inShake < 12 ? (inShake < 6 ? -2 : 2) : 0;
        if (inShake == 0)
            PlaySE(SE_BALL);
        return;
    }
    sprite->x2 = 0;
    if (t != sBall.shakes * SHAKE_FRAMES)
        return;
    if (sBall.caught)
    {
        static const u8 sStars[] = {FX_GOLD, FX_WHITE};

        PlaySE(SE_BALL_CLICK);
        ArenaJuice_Burst(toX, toY + 12, 10, sStars, ARRAY_COUNT(sStars), 2, TRUE, 30);
    }
    else
    {
        PlaySE(SE_BALL_OPEN);
        sprite->invisible = TRUE;
        ArenaScreen_ShowMon(sBall.side, gArenaScreen.mons[sBall.side].partyIndex, ARENA_MON_ENTER);
    }
}

void ArenaBall_Update(void)
{
    struct Sprite *sprite;
    s32 t, fromX, toX, toY, k;

    if (sBall.mode == BALL_IDLE)
        return;
    t = ++sBall.frame;
    if (sBall.spriteId == ARENA_NO_SPRITE || t >= Length())
    {
        if (sBall.spriteId != ARENA_NO_SPRITE && !(sBall.mode == BALL_CAPTURE && sBall.caught))
        {
            DestroySprite(&gSprites[sBall.spriteId]);
            sBall.spriteId = ARENA_NO_SPRITE;
        }
        sBall.mode = BALL_IDLE;
        return;
    }
    sprite = &gSprites[sBall.spriteId];
    fromX = sBall.mode == BALL_SEND_OUT && sBall.side == B_SIDE_OPPONENT ? 250 : -10;
    toX = gArenaMonCenterX[sBall.side];
    toY = ArenaScreen_FeetY(sBall.side) - 8;
    if (t < THROW_FRAMES)
    {
        k = t * 256 / THROW_FRAMES;
        sprite->x = fromX + (toX - fromX) * k / 256;
        sprite->y = 64 + (toY - 64) * k / 256 - Sin2(k * 180 / 256) * 34 / 4096;
        sprite->oam.tileNum = GetSpriteTileStartByTag(sBall.tag) + ((t / 4) % 2) * 4;
        return;
    }
    if (t == THROW_FRAMES)
    {
        PlaySE(SE_BALL_OPEN);
        sprite->oam.tileNum = GetSpriteTileStartByTag(sBall.tag) + 8;
        if (sBall.mode == BALL_SEND_OUT)
            ArenaJuice_OnSendOut(sBall.side);
        else
            ArenaScreen_StartMonFx(sBall.side, ARENA_MON_CAUGHT, Arena_Frames(14));
        return;
    }
    if (sBall.mode == BALL_SEND_OUT)
    {
        sprite->invisible = TRUE;
        return;
    }
    t -= THROW_FRAMES;
    sprite->oam.tileNum = GetSpriteTileStartByTag(sBall.tag);
    if (t < DROP_FRAMES)
    {
        sprite->y = toY + t * 12 / DROP_FRAMES;
        return;
    }
    UpdateShakes(sprite, t - DROP_FRAMES, toX, toY);
}
