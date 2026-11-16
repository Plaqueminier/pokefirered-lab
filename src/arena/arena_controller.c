// The Arena answers the commands that draw or animate, and for the player the choices and the EXP update. The data
// commands, the foe AI and the Bag stay with the controllers of the game, so the battle does not change.
#include "global.h"
#include "arena_internal.h"
#include "battle.h"
#include "battle_anim.h"
#include "battle_controllers.h"
#include "battle_gfx_sfx_util.h"
#include "battle_main.h"
#include "battle_message.h"
#include "characters.h"
#include "item.h"
#include "palette.h"
#include "party_menu.h"
#include "pokeball.h"
#include "pokemon.h"
#include "reshow_battle_screen.h"
#include "sound.h"
#include "string_util.h"
#include "util.h"
#include "window.h"
#include "constants/battle_string_ids.h"
#include "constants/moves.h"
#include "constants/party_menu.h"
#include "constants/songs.h"

#define MESSAGE_FRAMES 30
#define PROMPT_FRAMES 120

// The arrays have the battler as index.
struct ArenaController
{
    MainCallback resume[ARENA_SIDES];
    u16 wait[ARENA_SIDES];
    u8 chosenMove;
    u8 chosenPartyIndex;
    u8 lastCursor;
};

static EWRAM_DATA struct ArenaController sController = {0};

static const u8 sText_CantSwitch[] = _("It can't be switched out!");

void ArenaController_Init(void)
{
    memset(&sController, 0, sizeof(sController));
    sController.chosenMove = ARENA_NO_CHOICE;
    sController.chosenPartyIndex = ARENA_NO_CHOICE;
    sController.lastCursor = ARENA_CURSOR_CARD;
}

static void Complete(void)
{
    gBattlerControllerFuncs[gActiveBattler] = sController.resume[gActiveBattler];
    gBattleControllerExecFlags &= ~gBitTable[gActiveBattler];
}

static bool8 WaitDone(void)
{
    if (gArenaScreen.camera.hitstop != 0)
        return FALSE;
    if (sController.wait[gActiveBattler] == 0)
        return TRUE;
    sController.wait[gActiveBattler]--;
    return FALSE;
}

static void WaitFrames(void)
{
    if (WaitDone())
        Complete();
}

static void CompleteAfter(u16 frames)
{
    sController.wait[gActiveBattler] = Arena_Frames(frames);
    gBattlerControllerFuncs[gActiveBattler] = WaitFrames;
}

static u8 SideOfActive(void)
{
    return GetBattlerSide(gActiveBattler);
}

static void WaitMonFx(void)
{
    if (ArenaScreen_MonFxDone(SideOfActive()) && ArenaBall_Done())
        CompleteAfter(4);
}

static struct Pokemon *ActiveMon(void)
{
    return &Arena_Party(SideOfActive())[gBattlerPartyIndexes[gActiveBattler]];
}

static void WaitCryAfterSendOut(void)
{
    if (ArenaScreen_MonFxDone(SideOfActive()) && ArenaBall_Done())
    {
        PlayCry_Normal(GetMonData(ActiveMon(), MON_DATA_SPECIES), Arena_Pan(SideOfActive()));
        CompleteAfter(12);
    }
}

static void SendOut(void)
{
    u8 side = SideOfActive();

    ArenaScreen_ShowMon(side, gBattlerPartyIndexes[gActiveBattler], ARENA_MON_ENTER);
    ArenaBall_StartSendOut(side, ItemIdToBallId(GetMonData(ActiveMon(), MON_DATA_POKEBALL)));
    ArenaHud_UpdateIcons();
    gBattlerControllerFuncs[gActiveBattler] = WaitCryAfterSendOut;
}

static void HandleLoadMonSprite(void)
{
    u8 side = SideOfActive();

    ArenaScreen_ShowMon(side, gBattlerPartyIndexes[gActiveBattler], side == B_SIDE_OPPONENT ? ARENA_MON_APPEAR : ARENA_MON_IDLE);
    ArenaHud_UpdateIcons();
    gBattlerControllerFuncs[gActiveBattler] = WaitCryAfterSendOut;
}

// From PlayerHandleSwitchInAnim and OpponentHandleSwitchInAnim.
static void HandleSwitchInAnim(void)
{
    ClearTemporarySpeciesSpriteData(gActiveBattler, gBattleBufferA[gActiveBattler][2]);
    gBattlerPartyIndexes[gActiveBattler] = gBattleBufferA[gActiveBattler][1];
    if (SideOfActive() == B_SIDE_OPPONENT)
    {
        gBattleStruct->monToSwitchIntoId[gActiveBattler] = PARTY_SIZE;
    }
    else
    {
        gActionSelectionCursor[gActiveBattler] = 0;
        gMoveSelectionCursor[gActiveBattler] = 0;
    }
    SendOut();
}

// From StartSendOutAnim of the controllers of the game.
static void HandleIntroTrainerBallThrow(void)
{
    ClearTemporarySpeciesSpriteData(gActiveBattler, FALSE);
    if (SideOfActive() == B_SIDE_OPPONENT)
        ArenaScreen_ShowTrainer(FALSE);
    SendOut();
}

static void HandleReturnMonToBall(void)
{
    u8 side = SideOfActive();

    if (gBattleBufferA[gActiveBattler][1] != 0)
    {
        ArenaScreen_HideMon(side);
        Complete();
        return;
    }
    ArenaScreen_StartMonFx(side, ARENA_MON_RETURN, Arena_Frames(16));
    ArenaScreen_SetTint(side, 16);
    PlaySE12WithPanning(SE_BALL_OPEN, Arena_Pan(side));
    gBattlerControllerFuncs[gActiveBattler] = WaitMonFx;
}

static void HandleDrawTrainerPic(void)
{
    if (SideOfActive() == B_SIDE_OPPONENT)
        ArenaScreen_ShowTrainer(TRUE);
    CompleteAfter(8);
}

static void HandleTrainerSlideBack(void)
{
    if (SideOfActive() == B_SIDE_OPPONENT)
        ArenaScreen_ShowTrainer(FALSE);
    Complete();
}

static void HandleFaintAnimation(void)
{
    u8 side = SideOfActive();

    ArenaRecord_OnFaint(gActiveBattler);
    ArenaJuice_OnFaint(side);
    ArenaScreen_StartMonFx(side, ARENA_MON_FAINT, Arena_Frames(28));
    ArenaHud_UpdateIcons();
    gBattlerControllerFuncs[gActiveBattler] = WaitMonFx;
}

// The case id as in PlayerHandleBallThrowAnim and PlayerHandleSuccessBallThrowAnim.
static void HandleBallThrowAnim(void)
{
    u8 caseId = gBattleBufferA[gActiveBattler][0] == CONTROLLER_SUCCESSBALLTHROWANIM ? BALL_3_SHAKES_SUCCESS : gBattleBufferA[gActiveBattler][1];

    gBattleSpritesDataPtr->animationData->ballThrowCaseId = caseId;
    if (caseId > BALL_3_SHAKES_SUCCESS)
    {
        CompleteAfter(20);
        return;
    }
    ArenaBall_StartCapture(ItemIdToBallId(gLastUsedItem), caseId == BALL_3_SHAKES_SUCCESS ? 3 : caseId, caseId == BALL_3_SHAKES_SUCCESS);
    gBattlerControllerFuncs[gActiveBattler] = WaitMonFx;
}

// The flag as in CopyBattleSpriteInvisibility.
static void HandleSpriteInvisibility(void)
{
    ArenaScreen_SetHidden(SideOfActive(), gBattleBufferA[gActiveBattler][1]);
    gBattleSpritesDataPtr->battlerData[gActiveBattler].invisible = gBattleBufferA[gActiveBattler][1];
    Complete();
}

// gTransformedPersonalities as in PlayerHandleMoveAnimation; transformSpecies as in HandleSpeciesGfxDataChange.
static void HandleMoveAnimation(void)
{
    u16 move = gBattleBufferA[gActiveBattler][1] | (gBattleBufferA[gActiveBattler][2] << 8);
    struct DisableStruct *disableStruct = (struct DisableStruct *)&gBattleBufferA[gActiveBattler][16];
    u8 side = SideOfActive();

    gTransformedPersonalities[gActiveBattler] = disableStruct->transformedMonPersonality;
    ArenaRecord_OnMove(gActiveBattler);
    if (move == MOVE_TRANSFORM)
    {
        gBattleSpritesDataPtr->battlerData[gActiveBattler].transformSpecies = gBattleMons[gBattlerTarget].species;
        ArenaScreen_ShowMon(side, gBattlerPartyIndexes[gActiveBattler], ARENA_MON_IDLE);
    }
    if (gArenaScreen.mons[side].hidden)
    {
        CompleteAfter(8);
        return;
    }
    ArenaJuice_OnMove(side, move);
    CompleteAfter(28);
}

static void HandleHitAnimation(void)
{
    u8 side = SideOfActive();
    u8 effectiveness = 100;

    if (gArenaScreen.mons[side].hidden || !gArenaScreen.mons[side].shown)
    {
        Complete();
        return;
    }
    if (gMoveResultFlags & MOVE_RESULT_SUPER_EFFECTIVE)
        effectiveness = 200;
    else if (gMoveResultFlags & MOVE_RESULT_NOT_VERY_EFFECTIVE)
        effectiveness = 50;
    ArenaJuice_OnHit(side, gCritMultiplier > 1, effectiveness, gBattleMoveDamage);
    CompleteAfter(14);
}

static void HandleHealthBarUpdate(void)
{
    u8 side = SideOfActive();
    s16 hpChange = gBattleBufferA[gActiveBattler][2] | (gBattleBufferA[gActiveBattler][3] << 8);
    s32 hp = GetMonData(ActiveMon(), MON_DATA_HP);
    s32 newHp = hpChange == INSTANT_HP_BAR_DROP ? 0 : hp - hpChange;
    u8 number = ARENA_NUMBER_DAMAGE;

    newHp = max(0, min(newHp, (s32)GetMonData(ActiveMon(), MON_DATA_MAX_HP)));
    ArenaRecord_OnDamage(gActiveBattler, hp - newHp);
    if (newHp > hp)
        number = ARENA_NUMBER_HEAL;
    else if (gMoveResultFlags & MOVE_RESULT_SUPER_EFFECTIVE)
        number = ARENA_NUMBER_SUPER_EFFECTIVE;
    else if (gMoveResultFlags & MOVE_RESULT_NOT_VERY_EFFECTIVE)
        number = ARENA_NUMBER_NOT_VERY_EFFECTIVE;
    if (newHp != hp)
        ArenaJuice_DamageNumber(side, newHp - hp, number);
    ArenaScreen_SetHp(side, newHp);
    CompleteAfter(18);
}

// From Task_GiveExpToMon of the player controller: one level for each command, but with no EXP bar.
static void HandleExpUpdate(void)
{
    u8 monId = gBattleBufferA[gActiveBattler][1];
    s16 gainedExp = gBattleBufferA[gActiveBattler][2] | (gBattleBufferA[gActiveBattler][3] << 8);
    struct Pokemon *mon = &gPlayerParty[monId];
    u16 species;
    u32 currExp, nextLvlExp;
    u8 level;

    if (GetMonData(mon, MON_DATA_LEVEL) >= MAX_LEVEL)
    {
        Complete();
        return;
    }
    species = GetMonData(mon, MON_DATA_SPECIES);
    level = GetMonData(mon, MON_DATA_LEVEL);
    currExp = GetMonData(mon, MON_DATA_EXP);
    nextLvlExp = gExperienceTables[gSpeciesInfo[species].growthRate][level + 1];
    if (currExp + gainedExp >= nextLvlExp)
    {
        SetMonData(mon, MON_DATA_EXP, &nextLvlExp);
        CalculateMonStats(mon);
        gainedExp -= nextLvlExp - currExp;
        BtlController_EmitTwoReturnValues(1, RET_VALUE_LEVELED_UP, gainedExp);
        if (monId == gBattlerPartyIndexes[gActiveBattler])
        {
            ArenaScreen_SetMaxHp(B_SIDE_PLAYER, GetMonData(mon, MON_DATA_MAX_HP));
            ArenaScreen_SetHp(B_SIDE_PLAYER, GetMonData(mon, MON_DATA_HP));
            ArenaJuice_OnLevelUp();
        }
    }
    else
    {
        currExp += gainedExp;
        SetMonData(mon, MON_DATA_EXP, &currExp);
        if (monId == gBattlerPartyIndexes[gActiveBattler])
            PlaySE(SE_EXP);
    }
    ArenaScreen_MarkDirty(ARENA_DIRTY_INFO(B_SIDE_PLAYER));
    CompleteAfter(20);
}

static void HandleStatusIconUpdate(void)
{
    ArenaScreen_MarkDirty(ARENA_DIRTY_INFO(SideOfActive()) | ARENA_DIRTY_TEAM);
    Complete();
}

static void HandleStatusAnimation(void)
{
    ArenaScreen_Flash(SideOfActive(), 8);
    ArenaScreen_MarkDirty(ARENA_DIRTY_INFO(SideOfActive()));
    CompleteAfter(20);
}

static bool8 StatGoesDown(u16 argument)
{
    return (argument >= STAT_ANIM_MINUS1 && argument < STAT_ANIM_PLUS2) || (argument >= STAT_ANIM_MINUS2 && argument < STAT_ANIM_MULTIPLE_PLUS1)
        || argument == STAT_ANIM_MULTIPLE_MINUS1 || argument == STAT_ANIM_MULTIPLE_MINUS2;
}

// The Castform form change as in TryHandleLaunchBattleTableAnimation.
static void HandleBattleAnimation(void)
{
    u8 animationId = gBattleBufferA[gActiveBattler][1];
    u16 argument = gBattleBufferA[gActiveBattler][2] | (gBattleBufferA[gActiveBattler][3] << 8);
    u8 side = SideOfActive();

    if (animationId == B_ANIM_CASTFORM_CHANGE && (argument & 0x80))
    {
        gBattleMonForms[gActiveBattler] = argument & ~0x80;
        Complete();
        return;
    }
    if (animationId == B_ANIM_CASTFORM_CHANGE)
        ArenaScreen_ShowMon(side, gBattlerPartyIndexes[gActiveBattler], ARENA_MON_IDLE);
    if (animationId == B_ANIM_STATS_CHANGE)
        ArenaJuice_OnStatChange(side, !StatGoesDown(argument));
    else
        ArenaScreen_Flash(side, 6);
    CompleteAfter(20);
}

static void HandleArenaIntroSlide(void)
{
    gIntroSlideFlags |= 1;
    BeginNormalPaletteFade(PALETTES_ALL, 0, 16, 0, RGB_BLACK);
    Complete();
}

static void PlayMessageSounds(const u8 *str)
{
    for (; *str != EOS; str = Arena_SkipControlCode(str))
    {
        if (*str != EXT_CTRL_CODE_BEGIN)
            continue;
        if (str[1] == EXT_CTRL_CODE_PLAY_BGM)
            PlayBGM(str[2] | (str[3] << 8));
        else if (str[1] == EXT_CTRL_CODE_PLAY_SE)
            PlaySE(str[2] | (str[3] << 8));
    }
}

static bool8 HasPrompt(const u8 *str)
{
    for (; *str != EOS; str = Arena_SkipControlCode(str))
    {
        if (*str == CHAR_PROMPT_CLEAR || *str == CHAR_PROMPT_SCROLL)
            return TRUE;
    }
    return FALSE;
}

// A prompt ends with A, B or the time-out.
static void WaitMessage(void)
{
    if ((gArenaScreen.panel.waitsForA && JOY_NEW(A_BUTTON | B_BUTTON)) || WaitDone())
    {
        ArenaPanel_AnswerPrompt();
        Complete();
    }
}

static void HandlePrintString(void)
{
    u16 stringId = gBattleBufferA[gActiveBattler][2] | (gBattleBufferA[gActiveBattler][3] << 8);
    bool8 prompt;

    BufferStringBattle(stringId);
    if (stringId == STRINGID_ATTACKMISSED && (gMoveResultFlags & MOVE_RESULT_MISSED))
        ArenaRecord_OnMiss(gBattlerAttacker);
    PlayMessageSounds(gDisplayedStringBattle);
    prompt = HasPrompt(gDisplayedStringBattle) && !Arena_AutoPlays();
    ArenaPanel_ShowMessage(gDisplayedStringBattle, prompt);
    sController.wait[gActiveBattler] = Arena_Frames(prompt ? PROMPT_FRAMES : MESSAGE_FRAMES);
    gBattlerControllerFuncs[gActiveBattler] = WaitMessage;
}

// The engine sends this command when it refuses a choice: a move with no PP, a disabled move, RUN in a trainer battle.
static void HandlePrintSelectionString(void)
{
    Arena_ShowPendingNotice();
    if (SideOfActive() == B_SIDE_PLAYER)
        HandlePrintString();
    else
        Complete();
}

static void MoveCursor(u8 cursor)
{
    if (cursor == gArenaScreen.panel.cursor)
        return;
    PlaySE(SE_SELECT);
    ArenaPanel_SetCursor(cursor);
}

static u8 RowStep(u8 cursor, s8 step)
{
    u8 count = CalculatePlayerPartyCount();
    u8 index = cursor >= ARENA_CURSOR_BAG ? count + cursor - ARENA_CURSOR_BAG : cursor - ARENA_CURSOR_ICON;
    s32 next = (s32)index + step;

    if (next < 0 || next >= count + 3)
        return cursor;
    return next < count ? ARENA_CURSOR_ICON + next : ARENA_CURSOR_BAG + next - count;
}

static u8 NavigateCards(u8 cursor)
{
    if (cursor < ARENA_CURSOR_ICON)
    {
        if (JOY_NEW(DPAD_LEFT) && cursor % 2 == 1)
            return cursor - 1;
        if (JOY_NEW(DPAD_RIGHT) && cursor % 2 == 0 && gBattleMons[gActiveBattler].moves[cursor + 1] != MOVE_NONE)
            return cursor + 1;
        if (JOY_NEW(DPAD_DOWN) && cursor < 2 && gBattleMons[gActiveBattler].moves[cursor + 2] != MOVE_NONE)
            return cursor + 2;
        if (JOY_NEW(DPAD_UP))
            return cursor >= 2 ? cursor - 2 : ARENA_CURSOR_AUTO;
        return cursor;
    }
    if (JOY_NEW(DPAD_LEFT))
        return RowStep(cursor, -1);
    if (JOY_NEW(DPAD_RIGHT))
        return RowStep(cursor, 1);
    if (JOY_NEW(DPAD_DOWN))
        return ARENA_CURSOR_CARD;
    return cursor;
}

static void Emit(u8 action)
{
    PlaySE(SE_SELECT);
    sController.lastCursor = gArenaScreen.panel.cursor;
    ArenaPanel_Show(ARENA_PANEL_EMPTY);
    BtlController_EmitTwoReturnValues(1, action, 0);
    Complete();
}

static void OpenAutoMenu(void);

static void HandleInputChooseAction(void)
{
    u8 cursor = gArenaScreen.panel.cursor;

    if (Arena_TakeMenuRequest())
    {
        OpenAutoMenu();
        return;
    }
    MoveCursor(NavigateCards(cursor));
    if (!JOY_NEW(A_BUTTON))
        return;
    if (cursor < ARENA_CURSOR_ICON)
    {
        sController.chosenMove = cursor;
        Emit(B_ACTION_USE_MOVE);
    }
    else if (cursor < ARENA_CURSOR_BAG)
    {
        if (!Arena_CanSendOut(cursor - ARENA_CURSOR_ICON, gActiveBattler))
        {
            PlaySE(SE_FAILURE);
            return;
        }
        sController.chosenPartyIndex = cursor - ARENA_CURSOR_ICON;
        Emit(B_ACTION_SWITCH);
    }
    else if (cursor == ARENA_CURSOR_BAG)
    {
        Emit(B_ACTION_USE_ITEM);
    }
    else if (cursor == ARENA_CURSOR_RUN)
    {
        Emit(B_ACTION_RUN);
    }
    else
    {
        PlaySE(SE_SELECT);
        OpenAutoMenu();
    }
}

static void HandleChooseAction(void);

static void WaitForAutoMenu(void)
{
    if (gMain.callback2 == BattleMainCB2 && !gPaletteFade.active)
        HandleChooseAction();
}

static void ShowAutoMenu(void)
{
    if (!gPaletteFade.active)
    {
        gBattlerControllerFuncs[gActiveBattler] = WaitForAutoMenu;
        FreeAllWindowBuffers();
        Arena_ShowAutoMenu(ReshowBattleScreenAfterMenu);
    }
}

static void OpenAutoMenu(void)
{
    gBattlerInMenuId = gActiveBattler;
    BeginNormalPaletteFade(PALETTES_ALL, 0, 0, 16, RGB_BLACK);
    gBattlerControllerFuncs[gActiveBattler] = ShowAutoMenu;
}

// The plan stays the choice of the turn, also when Auto mode stops before the engine asks for the move or the
// Pokémon. The Harness reads this name (lab/src/harness/arena.test.ts).
static void EmitPlan(void)
{
    const struct ArenaPlan *plan = ArenaAuto_Plan();

    if (!Arena_StartMessageDone())
        return;
    sController.chosenMove = plan->moveIndex;
    if (plan->action == B_ACTION_SWITCH)
        sController.chosenPartyIndex = plan->partyIndex;
    BtlController_EmitTwoReturnValues(1, plan->action, 0);
    Complete();
}

static void HandleChooseAction(void)
{
    u8 cursor;

    ArenaJuice_OnTurn(gBattleResults.battleTurnCounter + 1);
    sController.chosenMove = ARENA_NO_CHOICE;
    sController.chosenPartyIndex = ARENA_NO_CHOICE;
    if (Arena_TakeMenuRequest())
    {
        OpenAutoMenu();
        return;
    }
    if (Arena_PrepareTurn())
    {
        ArenaPanel_Show(ARENA_PANEL_EMPTY);
        Arena_ShowPendingNotice();
        gBattlerControllerFuncs[gActiveBattler] = EmitPlan;
        return;
    }
    Arena_ShowPendingNotice();
    cursor = sController.lastCursor;
    if (cursor < ARENA_CURSOR_ICON && gBattleMons[gActiveBattler].moves[cursor] == MOVE_NONE)
        cursor = ARENA_CURSOR_CARD;
    ArenaPanel_SetCursor(cursor);
    ArenaPanel_Show(ARENA_PANEL_CARDS);
    gBattlerControllerFuncs[gActiveBattler] = HandleInputChooseAction;
}

// The Curse rule as in HandleInputChooseMove: only a Ghost type aims Curse at the foe.
static u8 TargetOf(u8 moveIndex)
{
    u16 move = gBattleMons[gActiveBattler].moves[moveIndex];
    u8 moveTarget = gBattleMoves[move].target;

    if (move == MOVE_CURSE)
        moveTarget = IS_BATTLER_OF_TYPE(gActiveBattler, TYPE_GHOST) ? MOVE_TARGET_SELECTED : MOVE_TARGET_USER;
    return (moveTarget & MOVE_TARGET_USER) ? gActiveBattler : GetBattlerAtPosition(B_POSITION_OPPONENT_LEFT);
}

static void HandleChooseMove(void)
{
    u8 moveIndex = sController.chosenMove;

    if (moveIndex == ARENA_NO_CHOICE)
        moveIndex = 0;
    // 10 as in HandleInputChooseMove.
    BtlController_EmitTwoReturnValues(1, 10, moveIndex | (TargetOf(moveIndex) << 8));
    Complete();
}

// The order of the battle party as in PlayerHandleChoosePokemon; the swap as in TrySwitchInPokemon of the party menu.
static void EmitPartyChoice(u8 partyIndex)
{
    s32 i;

    for (i = 0; i < 3; i++)
        gBattlePartyCurrentOrder[i] = gBattleBufferA[gActiveBattler][4 + i];
    if (partyIndex == ARENA_CANCEL_SWITCH)
    {
        BtlController_EmitChosenMonReturnValue(1, PARTY_SIZE, NULL);
    }
    else
    {
        SwitchPartyMonSlots(GetPartyIdFromBattlePartyId(gBattlerPartyIndexes[gActiveBattler]), GetPartyIdFromBattlePartyId(partyIndex));
        BtlController_EmitChosenMonReturnValue(1, partyIndex, gBattlePartyCurrentOrder);
    }
    ArenaPanel_Show(ARENA_PANEL_EMPTY);
    Complete();
}

static void HandleInputSendOut(void)
{
    u8 cursor = gArenaScreen.panel.cursor;

    if (JOY_NEW(DPAD_LEFT) && cursor > ARENA_CURSOR_ICON)
        MoveCursor(cursor - 1);
    else if (JOY_NEW(DPAD_RIGHT) && cursor + 1 < ARENA_CURSOR_ICON + CalculatePlayerPartyCount())
        MoveCursor(cursor + 1);
    else if (JOY_NEW(A_BUTTON))
    {
        if (!Arena_CanSendOut(cursor - ARENA_CURSOR_ICON, gActiveBattler))
        {
            PlaySE(SE_FAILURE);
            return;
        }
        PlaySE(SE_SELECT);
        EmitPartyChoice(cursor - ARENA_CURSOR_ICON);
    }
}

static void HandleChoosePokemon(void)
{
    u8 partyAction = gBattleBufferA[gActiveBattler][1] & 0xF;
    u8 partyIndex = Arena_AutoPartyIndex(partyAction);
    u8 slot;

    if (partyIndex != ARENA_NO_CHOICE)
    {
        EmitPartyChoice(partyIndex);
        return;
    }
    if (partyAction == PARTY_ACTION_CANT_SWITCH)
    {
        ArenaPanel_ShowNotice(sText_CantSwitch);
        EmitPartyChoice(ARENA_CANCEL_SWITCH);
        return;
    }
    if (sController.chosenPartyIndex != ARENA_NO_CHOICE)
    {
        partyIndex = sController.chosenPartyIndex;
        sController.chosenPartyIndex = ARENA_NO_CHOICE;
        EmitPartyChoice(partyIndex);
        return;
    }
    Arena_ShowPendingNotice();
    for (slot = 0; slot < CalculatePlayerPartyCount() && !Arena_CanSendOut(slot, gActiveBattler); slot++)
        ;
    ArenaPanel_SetCursor(ARENA_CURSOR_ICON + min(slot, CalculatePlayerPartyCount() - 1));
    ArenaPanel_Show(ARENA_PANEL_SEND_OUT);
    gBattlerControllerFuncs[gActiveBattler] = HandleInputSendOut;
}

static void HandleComplete(void)
{
    Complete();
}

static void (*const sHandlers[CONTROLLER_CMDS_COUNT])(void) =
{
    [CONTROLLER_LOADMONSPRITE] = HandleLoadMonSprite,
    [CONTROLLER_SWITCHINANIM] = HandleSwitchInAnim,
    [CONTROLLER_RETURNMONTOBALL] = HandleReturnMonToBall,
    [CONTROLLER_DRAWTRAINERPIC] = HandleDrawTrainerPic,
    [CONTROLLER_TRAINERSLIDE] = HandleDrawTrainerPic,
    [CONTROLLER_TRAINERSLIDEBACK] = HandleTrainerSlideBack,
    [CONTROLLER_FAINTANIMATION] = HandleFaintAnimation,
    [CONTROLLER_PALETTEFADE] = HandleComplete,
    [CONTROLLER_SUCCESSBALLTHROWANIM] = HandleBallThrowAnim,
    [CONTROLLER_BALLTHROWANIM] = HandleBallThrowAnim,
    [CONTROLLER_PAUSE] = HandleComplete,
    [CONTROLLER_MOVEANIMATION] = HandleMoveAnimation,
    [CONTROLLER_PRINTSTRING] = HandlePrintString,
    [CONTROLLER_PRINTSTRINGPLAYERONLY] = HandlePrintSelectionString,
    [CONTROLLER_HEALTHBARUPDATE] = HandleHealthBarUpdate,
    [CONTROLLER_STATUSICONUPDATE] = HandleStatusIconUpdate,
    [CONTROLLER_STATUSANIMATION] = HandleStatusAnimation,
    [CONTROLLER_HITANIMATION] = HandleHitAnimation,
    [CONTROLLER_INTROSLIDE] = HandleArenaIntroSlide,
    [CONTROLLER_INTROTRAINERBALLTHROW] = HandleIntroTrainerBallThrow,
    [CONTROLLER_DRAWPARTYSTATUSSUMMARY] = HandleComplete,
    [CONTROLLER_HIDEPARTYSTATUSSUMMARY] = HandleComplete,
    [CONTROLLER_ENDBOUNCE] = HandleComplete,
    [CONTROLLER_SPRITEINVISIBILITY] = HandleSpriteInvisibility,
    [CONTROLLER_BATTLEANIMATION] = HandleBattleAnimation,
};

static void (*const sPlayerChoiceHandlers[CONTROLLER_CMDS_COUNT])(void) =
{
    [CONTROLLER_CHOOSEACTION] = HandleChooseAction,
    [CONTROLLER_CHOOSEMOVE] = HandleChooseMove,
    [CONTROLLER_CHOOSEPOKEMON] = HandleChoosePokemon,
    [CONTROLLER_EXPUPDATE] = HandleExpUpdate,
};

bool8 Arena_RunCommand(u8 battler)
{
    u8 command = gBattleBufferA[battler][0];
    void (*handler)(void);

    if (!gArenaBattle.active || gArenaBattle.screenLeft || command >= CONTROLLER_CMDS_COUNT)
        return FALSE;
    handler = sHandlers[command];
    if (handler == NULL && GetBattlerSide(battler) == B_SIDE_PLAYER)
        handler = sPlayerChoiceHandlers[command];
    if (handler == NULL)
        return FALSE;
    sController.resume[battler] = gBattlerControllerFuncs[battler];
    handler();
    return TRUE;
}
