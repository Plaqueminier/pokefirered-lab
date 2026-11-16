#include "global.h"
#include "arena_internal.h"
#include "battle.h"
#include "battle_main.h"
#include "pokedex.h"
#include "pokemon.h"
#include "random.h"
#include "string_util.h"
#include "characters.h"
#include "constants/trainers.h"
#include "battle_bg.h"
#include "battle_gfx_sfx_util.h"
#include "bg.h"
#include "dma3.h"
#include "palette.h"
#include "sprite.h"

#define ARENA_UNSUPPORTED_BATTLES (BATTLE_TYPE_DOUBLE | BATTLE_TYPE_LINK | BATTLE_TYPE_MULTI | BATTLE_TYPE_SAFARI | BATTLE_TYPE_FIRST_BATTLE \
                                 | BATTLE_TYPE_OLD_MAN_TUTORIAL | BATTLE_TYPE_POKEDUDE | BATTLE_TYPE_GHOST \
                                 | BATTLE_TYPE_BATTLE_TOWER | BATTLE_TYPE_EREADER_TRAINER | BATTLE_TYPE_TRAINER_TOWER)

#define HOLD_B_FRAMES 36
#define START_MESSAGE_FRAMES 40

static const u8 sCallbackRuns[ARENA_SPEED_COUNT] = {1, 2, 4, 8, 32};

static const u8 sText_StopNone[] = _("");
static const u8 sText_StopPlayer[] = _("AUTO OFF.");
static const u8 sText_StopLowHp[] = _("AUTO OFF: LOW HP!");
static const u8 sText_StopNeverSeen[] = _("AUTO OFF: NEVER SEEN!");
static const u8 sText_StopGymLeader[] = _("AUTO OFF: GYM LEADER!");
static const u8 sText_AutoOn[] = _("AUTO ON: ");
static const u8 sText_MaxPower[] = _("MAX POWER");
static const u8 sText_SavePp[] = _("SAVE PP");
static const u8 sText_Tactics[] = _("TACTICS");
static const u8 sText_TypeEdge[] = _("TYPE EDGE");
static const u8 sText_Random[] = _("RANDOM");
static const u8 sText_X1[] = _("x1");
static const u8 sText_X2[] = _("x2");
static const u8 sText_X4[] = _("x4");
static const u8 sText_X8[] = _("x8");
static const u8 sText_Instant[] = _("INSTANT");

const u8 *const gArenaStrategyNames[ARENA_STRATEGY_COUNT] =
{
    [ARENA_STRATEGY_POWER] = sText_MaxPower,
    [ARENA_STRATEGY_SAVE_PP] = sText_SavePp,
    [ARENA_STRATEGY_TACTICS] = sText_Tactics,
    [ARENA_STRATEGY_TYPE_EDGE] = sText_TypeEdge,
    [ARENA_STRATEGY_RANDOM] = sText_Random,
};

const u8 *const gArenaSpeedNames[ARENA_SPEED_COUNT] =
{
    [ARENA_SPEED_1X] = sText_X1,
    [ARENA_SPEED_2X] = sText_X2,
    [ARENA_SPEED_4X] = sText_X4,
    [ARENA_SPEED_8X] = sText_X8,
    [ARENA_SPEED_INSTANT] = sText_Instant,
};

static const u8 *const sStopMessages[] =
{
    [ARENA_STOP_NONE] = sText_StopNone,
    [ARENA_STOP_PLAYER] = sText_StopPlayer,
    [ARENA_STOP_LOW_HP] = sText_StopLowHp,
    [ARENA_STOP_NEVER_SEEN] = sText_StopNeverSeen,
    [ARENA_STOP_GYM_LEADER] = sText_StopGymLeader,
};

// The Harness reads this name (lab/src/battle.ts).
EWRAM_DATA struct ArenaBattle gArenaBattle = {0};

// The Vanilla build must load the same save, so the fields after the Arena settings keep their offsets.
STATIC_ASSERT(offsetof(struct SaveBlock2, localTimeOffset) == 0x98, ArenaSettingsKeepSaveLayout);

bool8 Arena_ShowsScreen(void)
{
    return gArenaBattle.active && !gArenaBattle.screenLeft;
}

bool8 Arena_AutoPlays(void)
{
    return gArenaBattle.active && gArenaBattle.autoOn;
}

static bool8 IsGymLeaderBattle(void)
{
    return (gBattleTypeFlags & BATTLE_TYPE_TRAINER) && gTrainers[gTrainerBattleOpponent_A].trainerClass == TRAINER_CLASS_LEADER;
}

// The battle intro sets the "seen" flag: call this before the intro.
static bool8 IsNeverSeenWildBattle(void)
{
    u16 species = GetMonData(&gEnemyParty[0], MON_DATA_SPECIES);

    return !(gBattleTypeFlags & BATTLE_TYPE_TRAINER) && !GetSetPokedexFlag(SpeciesToNationalPokedexNum(species), FLAG_GET_SEEN);
}

static void SanitizeSettings(struct ArenaSettings *settings)
{
    if (settings->strategy >= ARENA_STRATEGY_COUNT)
        settings->strategy = ARENA_STRATEGY_POWER;
    if (settings->speed >= ARENA_SPEED_COUNT)
        settings->speed = ARENA_SPEED_1X;
}

void Arena_OnBattleInit(void)
{
    SanitizeSettings(&gSaveBlock2Ptr->arenaSettings);
    memset(&gArenaBattle, 0, sizeof(gArenaBattle));
    ArenaScreen_Init();
    ArenaController_Init();
    gArenaBattle.active = gSaveBlock2Ptr->optionsBattleScreenArena && !(gBattleTypeFlags & ARENA_UNSUPPORTED_BATTLES);
#if LAB
    if (gArenaBattle.active)
        ArenaMoveFx_CheckSounds();
#endif
}

// Returns TRUE when the Arena builds its screen in place of the battle sprites of the engine.
bool8 Arena_InitSprites(void)
{
    if (!Arena_ShowsScreen())
        return FALSE;
    ArenaScreen_Build(FALSE);
    return TRUE;
}

void Arena_OnBattleStart(void)
{
    struct ArenaSettings *settings = &gSaveBlock2Ptr->arenaSettings;

    ArenaAuto_Init(gRngValue);
    gArenaBattle.presentationRng = ~gRngValue;
    if (!gArenaBattle.active)
        return;
    ArenaRecord_Start();
    if (!settings->autoStaysOn)
        return;
    if (settings->stopGymLeader && IsGymLeaderBattle())
        Arena_StopAuto(ARENA_STOP_GYM_LEADER);
    else if (!settings->noStopNeverSeen && IsNeverSeenWildBattle())
        Arena_StopAuto(ARENA_STOP_NEVER_SEEN);
    else
        Arena_StartAuto();
}

void Arena_OnBattleEnd(void)
{
    if (gArenaBattle.active)
        ArenaScreen_Free();
    gArenaBattle.active = FALSE;
    gArenaBattle.autoOn = FALSE;
}

// The engine calls Random() at each VBlank. The Arena stops this call, so the battle speed does not change the battle.
bool8 Arena_FreezesFrameRng(void)
{
    return gArenaBattle.active && gMain.inBattle;
}

// Some sprites and animation tasks call Random() at each frame of a wait. A separate RNG for them keeps the battle RNG the same at all speeds.
void Arena_SwapPresentationRng(void)
{
    u32 engineRng;

    if (!gArenaBattle.active)
        return;
    engineRng = gRngValue;
    gRngValue = gArenaBattle.presentationRng;
    gArenaBattle.presentationRng = engineRng;
}

// Count frames, not main-loop passes: one slow pass can take more than one frame.
static void PollAutoInput(void)
{
    if (!gArenaBattle.autoOn)
        return;
    if (!JOY_HELD(B_BUTTON))
        gArenaBattle.holdBStart = gMain.vblankCounter2;
    else if (gMain.vblankCounter2 - gArenaBattle.holdBStart >= HOLD_B_FRAMES)
        Arena_StopAuto(ARENA_STOP_PLAYER);
    if (JOY_NEW(A_BUTTON) && !gArenaBattle.playerAnswers)
        gArenaBattle.menuRequested = TRUE;
}

void Arena_RunExtraCallbacks(void)
{
    MainCallback callback1 = gMain.callback1;
    MainCallback callback2 = gMain.callback2;
    u16 newKeys = gMain.newKeys;
    u16 newAndRepeatedKeys = gMain.newAndRepeatedKeys;
    u16 newKeysRaw = gMain.newKeysRaw;
    u32 frame = gMain.vblankCounter2;
    u8 runs;

    if (!gArenaBattle.active || callback2 != BattleMainCB2)
        return;
    PollAutoInput();
    if (gArenaBattle.messageFrames != 0)
        gArenaBattle.messageFrames--;
    if (!Arena_AutoPlays())
        return;
    gMain.newKeys = 0;
    gMain.newAndRepeatedKeys = 0;
    gMain.newKeysRaw = 0;
    // Stop the extra passes at the end of the frame, so the game still reads the keys at each frame.
    for (runs = sCallbackRuns[gSaveBlock2Ptr->arenaSettings.speed]; runs > 1 && gMain.vblankCounter2 == frame && gMain.callback1 == callback1 && gMain.callback2 == callback2; runs--)
    {
        callback1();
        if (gMain.callback1 != callback1 || gMain.callback2 != callback2)
            break;
        callback2();
    }
    // The Harness reads newKeysRaw after the frame to know that the game read a press.
    gMain.newKeys = newKeys;
    gMain.newAndRepeatedKeys = newAndRepeatedKeys;
    gMain.newKeysRaw = newKeysRaw;
}

void Arena_StartAuto(void)
{
    gSaveBlock2Ptr->arenaSettings.autoStaysOn = TRUE;
    gArenaBattle.autoOn = TRUE;
    gArenaBattle.holdBStart = gMain.vblankCounter2;
    gArenaBattle.stopReason = ARENA_STOP_NONE;
    gArenaBattle.startMessagePending = TRUE;
}

void Arena_StopAuto(u8 stopReason)
{
    if (stopReason == ARENA_STOP_PLAYER)
        gSaveBlock2Ptr->arenaSettings.autoStaysOn = FALSE;
    gArenaBattle.autoOn = FALSE;
    gArenaBattle.holdBStart = gMain.vblankCounter2;
    gArenaBattle.stopReason = stopReason;
    gArenaBattle.startMessagePending = FALSE;
    gArenaBattle.menuRequested = FALSE;
}

u8 *Arena_FormatAutoMode(u8 *dst)
{
    dst = StringCopy(dst, gArenaStrategyNames[gSaveBlock2Ptr->arenaSettings.strategy]);
    *dst++ = CHAR_SPACE;
    return StringCopy(dst, gArenaSpeedNames[gSaveBlock2Ptr->arenaSettings.speed]);
}

// A pending start and a stop reason never come together: Arena_StartAuto clears the reason, Arena_StopAuto the start.
void Arena_ShowPendingNotice(void)
{
    u8 text[ARENA_NOTICE_LENGTH];

    if (gArenaBattle.startMessagePending)
    {
        gArenaBattle.startMessagePending = FALSE;
        gArenaBattle.messageFrames = START_MESSAGE_FRAMES;
        Arena_FormatAutoMode(StringCopy(text, sText_AutoOn));
        ArenaPanel_ShowNotice(text);
    }
    else if (gArenaBattle.stopReason != ARENA_STOP_NONE)
    {
        ArenaPanel_ShowNotice(sStopMessages[gArenaBattle.stopReason]);
        gArenaBattle.stopReason = ARENA_STOP_NONE;
    }
}

// At x4 and faster, the notice ends before START_MESSAGE_FRAMES: its frames count the passes of the screen task.
bool8 Arena_StartMessageDone(void)
{
    return gArenaBattle.messageFrames == 0 || !ArenaPanel_NoticeShows();
}

bool8 Arena_TakeMenuRequest(void)
{
    bool8 requested = gArenaBattle.active && gArenaBattle.menuRequested;

    gArenaBattle.menuRequested = FALSE;
    return requested;
}

void Arena_OnChooseAction(void)
{
    gArenaBattle.playerAnswers = FALSE;
}

static bool8 PlayerAnswersMoveToLearn(void)
{
    return !gSaveBlock2Ptr->arenaSettings.noStopMoveToLearn;
}

void Arena_OnLearnMoveQuestion(void)
{
    if (Arena_AutoPlays() && PlayerAnswersMoveToLearn())
        gArenaBattle.playerAnswers = TRUE;
}

u16 Arena_AutoKey(u8 question)
{
    if (!Arena_AutoPlays())
        return 0;
    if (question == ARENA_QUESTION_LEARN_MOVE)
        return PlayerAnswersMoveToLearn() ? 0 : B_BUTTON;
    if (question == ARENA_QUESTION_STOP_LEARNING)
        return PlayerAnswersMoveToLearn() ? 0 : A_BUTTON;
    // ARENA_QUESTION_YES_NO: a wild battle asks "Use next POKéMON?"; a trainer battle asks "Will you switch?".
    return (gBattleTypeFlags & BATTLE_TYPE_TRAINER) ? B_BUTTON : A_BUTTON;
}

static void CB2_ReshowScreen(void)
{
    if (!IsDma3ManagerBusyWithBgCopy())
    {
        ArenaScreen_Build(TRUE);
        ShowBg(0);
        BattleInterfaceSetWindowPals();
        SetVBlankCallback(VBlankCB_Battle);
        BeginNormalPaletteFade(PALETTES_ALL, 0, 16, 0, RGB_BLACK);
        SetMainCallback2(BattleMainCB2);
    }
}

bool8 Arena_ReshowScreen(void)
{
    if (!gArenaBattle.active)
        return FALSE;
    SetVBlankCallback(NULL);
    SetHBlankCallback(NULL);
    ResetSpriteData();
    FreeAllSpritePalettes();
    gReservedSpritePaletteCount = 4;
    gPaletteFade.bufferTransferDisabled = FALSE;
    CpuFill32(0, (void *)VRAM, VRAM_SIZE);
    InitBattleBgsVideo();
    LoadBattleTextboxAndBackground();
    SetMainCallback2(CB2_ReshowScreen);
    return TRUE;
}

// The Pokédex page of a caught Pokémon expects blank BG tiles where the Arena drew.
void Arena_LeaveScreen(void)
{
    if (!gArenaBattle.active)
        return;
    ArenaScreen_Free();
    gArenaBattle.screenLeft = TRUE;
    CpuFill32(0, (void *)BG_VRAM, BG_VRAM_SIZE);
}

bool8 Arena_SkipsLevelUpBox(void)
{
    return gArenaBattle.active;
}
