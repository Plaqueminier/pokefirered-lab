// The sprite and the first sound of a move, read from the animation script of the move.
#include "global.h"
#include "arena_internal.h"
#include "battle.h"
#include "battle_anim.h"
#include "decompress.h"
#include "pokemon.h"
#include "sound.h"
#include "sprite.h"
#include "task.h"
#include "trig.h"
#include "constants/moves.h"
#include "constants/songs.h"

#define MOVE_FX_FRAMES 28
#define SOUND_CRY 0xFFFF
#define SOUND_NONE 0
// sound/song_table.inc has one song for each id up to MUS_TEACHY_TV_MENU.
#define SONG_COUNT (MUS_TEACHY_TV_MENU + 1)

enum
{
    MOVE_FX_NONE,
    MOVE_FX_PROJECTILE,
    MOVE_FX_ON_TARGET,
    MOVE_FX_FALL,
    MOVE_FX_SPRAY,
};

struct MoveEffect
{
    u16 tag;
    u8 size;
    u8 frames;
    u8 kind;
};

static const struct OamData sOamEffect16 = {.shape = SPRITE_SHAPE(16x16), .size = SPRITE_SIZE(16x16), .priority = 1};
static const struct OamData sOamEffect32 = {.shape = SPRITE_SHAPE(32x32), .size = SPRITE_SIZE(32x32), .priority = 1};

static const struct MoveEffect sEmber = {ANIM_TAG_SMALL_EMBER, 32, 5, MOVE_FX_PROJECTILE};
static const struct MoveEffect sBubble = {ANIM_TAG_BUBBLE, 16, 3, MOVE_FX_SPRAY};
static const struct MoveEffect sLeaf = {ANIM_TAG_LEAF, 16, 9, MOVE_FX_PROJECTILE};
static const struct MoveEffect sElectricity = {ANIM_TAG_ELECTRICITY, 32, 4, MOVE_FX_ON_TARGET};
static const struct MoveEffect sRocks = {ANIM_TAG_ROCKS, 32, 6, MOVE_FX_FALL};
static const struct MoveEffect sGust = {ANIM_TAG_GUST, 32, 2, MOVE_FX_ON_TARGET};
static const struct MoveEffect sNeedle = {ANIM_TAG_NEEDLE, 16, 1, MOVE_FX_PROJECTILE};
static const struct MoveEffect sImpact = {ANIM_TAG_IMPACT, 32, 1, MOVE_FX_ON_TARGET};
static const struct MoveEffect sScratch = {ANIM_TAG_SCRATCH, 32, 5, MOVE_FX_ON_TARGET};
static const struct MoveEffect sSeed = {ANIM_TAG_SEED, 16, 3, MOVE_FX_PROJECTILE};
static const struct MoveEffect sSand = {ANIM_TAG_MUD_SAND, 16, 1, MOVE_FX_SPRAY};

void SoundTask_PlayDoubleCry(u8 taskId);
void SoundTask_PlayCryHighPitch(u8 taskId);
void SoundTask_PlayCryWithEcho(u8 taskId);

// The commands of asm/macros/battle_anim_script.inc.
enum
{
    ANIM_CMD_LOADSPRITEGFX,
    ANIM_CMD_UNLOADSPRITEGFX,
    ANIM_CMD_CREATESPRITE,
    ANIM_CMD_CREATEVISUALTASK,
    ANIM_CMD_DELAY,
    ANIM_CMD_WAITFORVISUALFINISH,
    ANIM_CMD_NOP,
    ANIM_CMD_NOP2,
    ANIM_CMD_END,
    ANIM_CMD_PLAYSE,
    ANIM_CMD_MONBG,
    ANIM_CMD_CLEARMONBG,
    ANIM_CMD_SETALPHA,
    ANIM_CMD_BLENDOFF,
    ANIM_CMD_CALL,
    ANIM_CMD_RETURN,
    ANIM_CMD_SETARG,
    ANIM_CMD_CHOOSETWOTURNANIM,
    ANIM_CMD_JUMPIFMOVETURN,
    ANIM_CMD_GOTO,
    ANIM_CMD_FADETOBG,
    ANIM_CMD_RESTOREBG,
    ANIM_CMD_WAITBGFADEOUT,
    ANIM_CMD_WAITBGFADEIN,
    ANIM_CMD_CHANGEBG,
    ANIM_CMD_PLAYSEWITHPAN,
    ANIM_CMD_SETPAN,
    ANIM_CMD_PANSE,
    ANIM_CMD_LOOPSEWITHPAN,
    ANIM_CMD_WAITPLAYSEWITHPAN,
    ANIM_CMD_SETBLDCNT,
    ANIM_CMD_CREATESOUNDTASK,
    ANIM_CMD_WAITSOUND,
    ANIM_CMD_JUMPARGEQ,
    ANIM_CMD_MONBG_STATIC,
    ANIM_CMD_CLEARMONBG_STATIC,
    ANIM_CMD_JUMPIFCONTEST,
    ANIM_CMD_FADETOBGFROMSET,
    ANIM_CMD_PANSE_ADJUSTNONE,
    ANIM_CMD_PANSE_ADJUSTALL,
    ANIM_CMD_SPLITBGPRIO,
    ANIM_CMD_SPLITBGPRIO_ALL,
    ANIM_CMD_SPLITBGPRIO_FOES,
    ANIM_CMD_INVISIBLE,
    ANIM_CMD_VISIBLE,
    ANIM_CMD_TEAMATTACK_MOVEBACK,
    ANIM_CMD_TEAMATTACK_MOVEFWD,
    ANIM_CMD_STOPSOUND,
    ANIM_CMD_COUNT
};

// The length in bytes of each command with its arguments. A command that is not here has no argument, and
// createsprite and createvisualtask have a variable length. FirstSoundOf does not take the conditional jumps.
static const u8 sAnimCmdLengths[ANIM_CMD_COUNT] =
{
    [ANIM_CMD_LOADSPRITEGFX] = 3,
    [ANIM_CMD_UNLOADSPRITEGFX] = 3,
    [ANIM_CMD_DELAY] = 2,
    [ANIM_CMD_MONBG] = 2,
    [ANIM_CMD_CLEARMONBG] = 2,
    [ANIM_CMD_SETALPHA] = 3,
    [ANIM_CMD_SETARG] = 4,
    [ANIM_CMD_JUMPIFMOVETURN] = 6,
    [ANIM_CMD_FADETOBG] = 2,
    [ANIM_CMD_CHANGEBG] = 2,
    [ANIM_CMD_SETPAN] = 2,
    [ANIM_CMD_SETBLDCNT] = 3,
    [ANIM_CMD_JUMPARGEQ] = 8,
    [ANIM_CMD_MONBG_STATIC] = 2,
    [ANIM_CMD_CLEARMONBG_STATIC] = 2,
    [ANIM_CMD_JUMPIFCONTEST] = 5,
    [ANIM_CMD_FADETOBGFROMSET] = 4,
    [ANIM_CMD_SPLITBGPRIO] = 2,
    [ANIM_CMD_SPLITBGPRIO_FOES] = 2,
    [ANIM_CMD_INVISIBLE] = 2,
    [ANIM_CMD_VISIBLE] = 2,
    [ANIM_CMD_TEAMATTACK_MOVEBACK] = 2,
    [ANIM_CMD_TEAMATTACK_MOVEFWD] = 2,
};

static const struct MoveEffect *EffectOf(u16 move)
{
    switch (move)
    {
    case MOVE_SCRATCH:
    case MOVE_SLASH:
    case MOVE_CUT:
    case MOVE_FURY_SWIPES:
    case MOVE_CRUSH_CLAW:
        return &sScratch;
    case MOVE_LEECH_SEED:
        return &sSeed;
    case MOVE_SAND_ATTACK:
        return &sSand;
    }
    if (gBattleMoves[move].power == 0)
        return NULL;
    switch (gBattleMoves[move].type)
    {
    case TYPE_FIRE:
    case TYPE_DRAGON:
        return &sEmber;
    case TYPE_WATER:
    case TYPE_ICE:
        return &sBubble;
    case TYPE_GRASS:
        return &sLeaf;
    case TYPE_ELECTRIC:
    case TYPE_PSYCHIC:
        return &sElectricity;
    case TYPE_ROCK:
        return &sRocks;
    case TYPE_GROUND:
        return &sSand;
    case TYPE_FLYING:
    case TYPE_GHOST:
        return &sGust;
    case TYPE_BUG:
    case TYPE_POISON:
        return &sNeedle;
    case TYPE_DARK:
        return &sScratch;
    default:
        return &sImpact;
    }
}

// The sprites of the last screen are gone.
void ArenaMoveFx_Reset(void)
{
    gArenaScreen.moveFx.spriteId = ARENA_NO_SPRITE;
}

static void FreeEffect(void)
{
    struct ArenaMoveEffect *fx = &gArenaScreen.moveFx;

    if (fx->spriteId != ARENA_NO_SPRITE)
    {
        DestroySprite(&gSprites[fx->spriteId]);
        fx->spriteId = ARENA_NO_SPRITE;
    }
    if (fx->tag != 0)
    {
        FreeSpriteTilesByTag(fx->tag);
        FreeSpritePaletteByTag(fx->tag);
        fx->tag = 0;
    }
}

static void StartEffect(u8 side, u16 move)
{
    struct ArenaMoveEffect *fx = &gArenaScreen.moveFx;
    const struct MoveEffect *effect = EffectOf(move);
    struct SpriteTemplate template = {0};
    struct Sprite *sprite;
    u32 index;

    FreeEffect();
    if (effect == NULL || !Arena_JuiceOn())
        return;
    index = effect->tag - ANIM_SPRITES_START;
    LoadCompressedSpriteSheetUsingHeap(&gBattleAnimPicTable[index]);
    LoadCompressedSpritePaletteUsingHeap(&gBattleAnimPaletteTable[index]);
    fx->tag = effect->tag;
    template.tileTag = effect->tag;
    template.paletteTag = effect->tag;
    template.oam = effect->size == 16 ? &sOamEffect16 : &sOamEffect32;
    template.anims = gDummySpriteAnimTable;
    template.affineAnims = gDummySpriteAffineAnimTable;
    template.callback = SpriteCallbackDummy;
    fx->spriteId = CreateSprite(&template, gArenaMonCenterX[side], ARENA_MON_CENTER_Y, 0);
    if (fx->spriteId == MAX_SPRITES)
    {
        fx->spriteId = ARENA_NO_SPRITE;
        return;
    }
    sprite = &gSprites[fx->spriteId];
    sprite->hFlip = side == B_SIDE_OPPONENT;
    sprite->invisible = TRUE;
    fx->kind = effect->kind;
    fx->from = side;
    fx->frames = 0;
    fx->length = MOVE_FX_FRAMES;
    sprite->data[0] = effect->frames;
    sprite->data[1] = effect->size == 16 ? 4 : 16;
    sprite->data[2] = sprite->oam.tileNum;
}

void ArenaMoveFx_Update(void)
{
    struct ArenaMoveEffect *fx = &gArenaScreen.moveFx;
    struct Sprite *sprite;
    u8 from = fx->from, to = from == B_SIDE_PLAYER ? B_SIDE_OPPONENT : B_SIDE_PLAYER;
    s32 t, x0, x1;

    if (fx->spriteId == ARENA_NO_SPRITE)
        return;
    sprite = &gSprites[fx->spriteId];
    t = ++fx->frames;
    if (t >= fx->length)
    {
        FreeEffect();
        return;
    }
    sprite->oam.tileNum = sprite->data[2] + ((t / 4) % sprite->data[0]) * sprite->data[1];
    sprite->invisible = FALSE;
    x0 = gArenaMonCenterX[from];
    x1 = gArenaMonCenterX[to];
    switch (fx->kind)
    {
    case MOVE_FX_PROJECTILE:
        sprite->x = x0 + (x1 - x0) * t / fx->length;
        sprite->y = ARENA_MON_CENTER_Y - Sin2(t * 180 / fx->length) * 12 / 4096;
        break;
    case MOVE_FX_SPRAY:
        sprite->x = x0 + (x1 - x0) * t / fx->length + (t % 3) * 3;
        sprite->y = ARENA_MON_CENTER_Y + ((t * 5) % 9) - 4;
        break;
    case MOVE_FX_FALL:
        sprite->x = x1 + ((t / 3) % 3 - 1) * 6;
        sprite->y = 20 + t * (ARENA_MON_CENTER_Y - 20) / fx->length;
        break;
    default:
        sprite->x = x1;
        sprite->y = ARENA_MON_CENTER_Y;
        sprite->invisible = t < 6;
        break;
    }
}

static u32 ReadU32(const u8 *p)
{
    return p[0] | (p[1] << 8) | (p[2] << 16) | (p[3] << 24);
}

static bool8 IsCryTask(TaskFunc func)
{
    return func == SoundTask_PlayDoubleCry || func == SoundTask_PlayCryHighPitch || func == SoundTask_PlayCryWithEcho;
}

static const u8 *NextCommand(const u8 *script)
{
    u8 command = script[0];

    if (command == ANIM_CMD_CREATESPRITE || command == ANIM_CMD_CREATEVISUALTASK)
        return script + 7 + script[6] * 2;
    if (command < ANIM_CMD_COUNT && sAnimCmdLengths[command] != 0)
        return script + sAnimCmdLengths[command];
    return script + 1;
}

// Some move scripts (GROWL) play the cry of the user with a task, not with a sound command. createsoundtask has
// its argument count at byte 5 and its first argument at bytes 6 and 7.
static u16 FirstSoundOf(u16 move)
{
    const u8 *script = gBattleAnims_Moves[move];
    const u8 *returnTo = NULL;
    u32 steps;

    for (steps = 0; steps < 300 && script != NULL; steps++)
    {
        switch (script[0])
        {
        case ANIM_CMD_PLAYSE:
        case ANIM_CMD_PLAYSEWITHPAN:
        case ANIM_CMD_PANSE:
        case ANIM_CMD_LOOPSEWITHPAN:
        case ANIM_CMD_WAITPLAYSEWITHPAN:
        case ANIM_CMD_PANSE_ADJUSTNONE:
        case ANIM_CMD_PANSE_ADJUSTALL:
            return script[1] | (script[2] << 8);
        case ANIM_CMD_CREATESOUNDTASK:
            return script[5] != 0 ? script[6] | (script[7] << 8) : SOUND_NONE;
        case ANIM_CMD_END:
            return SOUND_NONE;
        case ANIM_CMD_CALL:
            returnTo = script + 5;
            script = (const u8 *)ReadU32(script + 1);
            break;
        case ANIM_CMD_RETURN:
            script = returnTo;
            returnTo = NULL;
            break;
        case ANIM_CMD_CHOOSETWOTURNANIM:
        case ANIM_CMD_GOTO:
            script = (const u8 *)ReadU32(script + 1);
            break;
        case ANIM_CMD_CREATEVISUALTASK:
            if (IsCryTask((TaskFunc)ReadU32(script + 1)))
                return SOUND_CRY;
            script = NextCommand(script);
            break;
        default:
            script = NextCommand(script);
            break;
        }
    }
    return SOUND_NONE;
}

static bool8 IsSong(u16 sound)
{
    return sound != SOUND_NONE && sound < SONG_COUNT;
}

static void PlayMoveSound(u8 side, u16 move)
{
    u16 sound = FirstSoundOf(move);

    if (sound == SOUND_CRY)
        PlayCry_Normal(gArenaScreen.mons[side].species, Arena_Pan(side));
    else if (IsSong(sound))
        PlaySE12WithPanning(sound, Arena_Pan(side));
}

void ArenaMoveFx_Start(u8 side, u16 move)
{
    StartEffect(side, move);
    PlayMoveSound(side, move);
}

#if LAB
// badMove: the first move whose first sound is not a song, a cry or no sound; MOVE_NONE when there is none.
struct SoundCheck
{
    u16 badMove;
    u16 probeMove;
    u16 probeSound;
};

// The Harness reads this name (lab/src/harness/arena.test.ts): it sets probeMove and reads the results.
static EWRAM_DATA struct SoundCheck sSoundCheck = {0};

// The check runs only when the Harness asks for it: its time could move a frame, and so the RNG, of the other tests.
void ArenaMoveFx_CheckSounds(void)
{
    u16 move, sound;

    if (sSoundCheck.probeMove == MOVE_NONE)
        return;
    sSoundCheck.badMove = MOVE_NONE;
    for (move = MOVE_NONE + 1; move < MOVES_COUNT && sSoundCheck.badMove == MOVE_NONE; move++)
    {
        sound = FirstSoundOf(move);
        if (sound != SOUND_NONE && sound != SOUND_CRY && !IsSong(sound))
            sSoundCheck.badMove = move;
    }
    sSoundCheck.probeSound = FirstSoundOf(sSoundCheck.probeMove);
}
#endif
