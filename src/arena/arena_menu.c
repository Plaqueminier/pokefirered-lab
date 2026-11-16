#include "global.h"
#include "gflib.h"
#include "arena_internal.h"
#include "menu_helpers.h"
#include "menu.h"
#include "new_menu_helpers.h"
#include "scanline_effect.h"
#include "task.h"
#include "text_window.h"
#include "constants/songs.h"

enum
{
    ROW_STRATEGY,
    ROW_SPEED,
    ROW_STOP_LOW_HP,
    ROW_STOP_NEVER_SEEN,
    ROW_STOP_GYM_LEADER,
    ROW_STOP_MOVE_TO_LEARN,
    ROW_RUN,
    ROW_START_STOP,
    ROW_COUNT
};

enum
{
    WIN_TITLE,
    WIN_ROWS,
    WIN_HELP,
};

#define ROW_HEIGHT 12
#define VALUE_X 128

struct AutoMenu
{
    MainCallback exitCallback;
    u8 row;
    u8 state;
    bool8 closing;
};

static EWRAM_DATA struct AutoMenu *sAutoMenu = NULL;

static const struct BgTemplate sBgTemplates[] =
{
    {
        .bg = 0,
        .charBaseIndex = 0,
        .mapBaseIndex = 31,
        .screenSize = 0,
        .paletteMode = 0,
        .priority = 0,
        .baseTile = 0
    },
};

static const struct WindowTemplate sWindowTemplates[] =
{
    [WIN_TITLE] = {.bg = 0, .tilemapLeft = 1, .tilemapTop = 0, .width = 28, .height = 3, .paletteNum = 15, .baseBlock = 1},
    [WIN_ROWS] = {.bg = 0, .tilemapLeft = 1, .tilemapTop = 3, .width = 28, .height = 14, .paletteNum = 15, .baseBlock = 85},
    [WIN_HELP] = {.bg = 0, .tilemapLeft = 1, .tilemapTop = 17, .width = 28, .height = 3, .paletteNum = 15, .baseBlock = 477},
    DUMMY_WIN_TEMPLATE
};

static const u8 sTextColors[] = {TEXT_COLOR_WHITE, TEXT_COLOR_DARK_GRAY, TEXT_COLOR_LIGHT_GRAY};
static const u8 sSelectedColors[] = {TEXT_COLOR_WHITE, TEXT_COLOR_RED, TEXT_COLOR_LIGHT_RED};

static const u8 sText_Title[] = _("AUTO MODE");
static const u8 sText_Cursor[] = _("▶");
static const u8 sText_On[] = _("ON");
static const u8 sText_Off[] = _("OFF");
static const u8 sText_StartAuto[] = _("START AUTO");
static const u8 sText_StopAuto[] = _("STOP AUTO");
static const u8 sText_Keys[] = _("A: CHANGE  B: BACK");

static const u8 sText_Strategy[] = _("STRATEGY");
static const u8 sText_Speed[] = _("SPEED");
static const u8 sText_StopIfLowHp[] = _("STOP IF LOW HP");
static const u8 sText_StopIfNeverSeen[] = _("STOP IF NEVER SEEN");
static const u8 sText_StopVsGymLeader[] = _("STOP VS GYM LEADER");
static const u8 sText_StopIfMoveToLearn[] = _("STOP IF MOVE TO LEARN");
static const u8 sText_RunWild[] = _("RUN (WILD)");
static const u8 sText_HelpPower[] = _("The move with the most estimated damage.");
static const u8 sText_HelpSavePp[] = _("A sure knock-out with the most PP,\nelse a strong move with more PP.");
static const u8 sText_HelpTactics[] = _("A useful status move first,\nthen damage.");
static const u8 sText_HelpTypeEdge[] = _("Switches when a better duel waits.");
static const u8 sText_HelpRandom[] = _("A random move.");
static const u8 sText_Never[] = _("NEVER");
static const u8 sText_IfCaught[] = _("IF CAUGHT");

static const u8 *const sStrategyHelp[ARENA_STRATEGY_COUNT] =
{
    [ARENA_STRATEGY_POWER] = sText_HelpPower,
    [ARENA_STRATEGY_SAVE_PP] = sText_HelpSavePp,
    [ARENA_STRATEGY_TACTICS] = sText_HelpTactics,
    [ARENA_STRATEGY_TYPE_EDGE] = sText_HelpTypeEdge,
    [ARENA_STRATEGY_RANDOM] = sText_HelpRandom,
};

static const u8 *const sOffOnNames[] = {sText_Off, sText_On};
static const u8 *const sRunNames[] = {sText_Never, sText_IfCaught};

// A bit field has no address, so each setting has a getter and a setter.
#define SETTING_ACCESSORS(field)                                                                 \
    static u8 Get_##field(void) { return gSaveBlock2Ptr->arenaSettings.field; }                  \
    static void Set_##field(u8 value) { gSaveBlock2Ptr->arenaSettings.field = value; }
#define SETTING(field) Get_##field, Set_##field

SETTING_ACCESSORS(strategy)
SETTING_ACCESSORS(speed)
SETTING_ACCESSORS(noStopLowHp)
SETTING_ACCESSORS(noStopNeverSeen)
SETTING_ACCESSORS(stopGymLeader)
SETTING_ACCESSORS(noStopMoveToLearn)
SETTING_ACCESSORS(runIfCaught)

// inverted: the save stores the setting as a "no stop" bit, so that a zeroed save has the stop on.
struct AutoMenuRow
{
    const u8 *name;
    const u8 *const *valueNames;
    u8 valueCount;
    u8 (*get)(void);
    void (*set)(u8 value);
    bool8 inverted;
};

static const struct AutoMenuRow sRows[ROW_COUNT] =
{
    [ROW_STRATEGY] = {sText_Strategy, gArenaStrategyNames, ARENA_STRATEGY_COUNT, SETTING(strategy), FALSE},
    [ROW_SPEED] = {sText_Speed, gArenaSpeedNames, ARENA_SPEED_COUNT, SETTING(speed), FALSE},
    [ROW_STOP_LOW_HP] = {sText_StopIfLowHp, sOffOnNames, ARRAY_COUNT(sOffOnNames), SETTING(noStopLowHp), TRUE},
    [ROW_STOP_NEVER_SEEN] = {sText_StopIfNeverSeen, sOffOnNames, ARRAY_COUNT(sOffOnNames), SETTING(noStopNeverSeen), TRUE},
    [ROW_STOP_GYM_LEADER] = {sText_StopVsGymLeader, sOffOnNames, ARRAY_COUNT(sOffOnNames), SETTING(stopGymLeader), FALSE},
    [ROW_STOP_MOVE_TO_LEARN] = {sText_StopIfMoveToLearn, sOffOnNames, ARRAY_COUNT(sOffOnNames), SETTING(noStopMoveToLearn), TRUE},
    [ROW_RUN] = {sText_RunWild, sRunNames, ARRAY_COUNT(sRunNames), SETTING(runIfCaught), FALSE},
    [ROW_START_STOP] = {NULL, NULL, 0, NULL, NULL, FALSE},
};

static bool8 IsActionRow(u8 row)
{
    return sRows[row].valueCount == 0;
}

static void CB2_InitAutoMenu(void);
static void CB2_AutoMenu(void);
static void VBlankCB_AutoMenu(void);
static void Task_AutoMenu(u8 taskId);

void Arena_ShowAutoMenu(MainCallback exitCallback)
{
    sAutoMenu = AllocZeroed(sizeof(*sAutoMenu));
    sAutoMenu->exitCallback = exitCallback;
    sAutoMenu->row = ROW_START_STOP;
    SetMainCallback2(CB2_InitAutoMenu);
}

// Only a row with values has a getter and a setter.
static u8 GetValue(u8 row)
{
    u8 value = sRows[row].get();

    return sRows[row].inverted ? !value : value;
}

static void SetValue(u8 row, u8 value)
{
    sRows[row].set(sRows[row].inverted ? !value : value);
}

static void DrawRows(void)
{
    s32 row;
    const u8 *colors;

    FillWindowPixelBuffer(WIN_ROWS, PIXEL_FILL(TEXT_COLOR_WHITE));
    for (row = 0; row < ROW_COUNT; row++)
    {
        u8 y = row * ROW_HEIGHT + 1;

        colors = row == sAutoMenu->row ? sSelectedColors : sTextColors;
        if (row == sAutoMenu->row)
            AddTextPrinterParameterized3(WIN_ROWS, FONT_SMALL, 0, y, colors, TEXT_SKIP_DRAW, sText_Cursor);
        if (IsActionRow(row))
        {
            AddTextPrinterParameterized3(WIN_ROWS, FONT_SMALL, 8, y, colors, TEXT_SKIP_DRAW, gArenaBattle.autoOn ? sText_StopAuto : sText_StartAuto);
            continue;
        }
        AddTextPrinterParameterized3(WIN_ROWS, FONT_SMALL, 8, y, colors, TEXT_SKIP_DRAW, sRows[row].name);
        AddTextPrinterParameterized3(WIN_ROWS, FONT_SMALL, VALUE_X, y, colors, TEXT_SKIP_DRAW, sRows[row].valueNames[GetValue(row)]);
    }
    CopyWindowToVram(WIN_ROWS, COPYWIN_GFX);

    FillWindowPixelBuffer(WIN_HELP, PIXEL_FILL(TEXT_COLOR_WHITE));
    AddTextPrinterParameterized3(WIN_HELP, FONT_SMALL, 0, 0, sTextColors, TEXT_SKIP_DRAW, sStrategyHelp[GetValue(ROW_STRATEGY)]);
    CopyWindowToVram(WIN_HELP, COPYWIN_GFX);
}

static void DrawTitle(void)
{
    FillWindowPixelBuffer(WIN_TITLE, PIXEL_FILL(TEXT_COLOR_WHITE));
    AddTextPrinterParameterized3(WIN_TITLE, FONT_NORMAL, 0, 6, sTextColors, TEXT_SKIP_DRAW, sText_Title);
    AddTextPrinterParameterized3(WIN_TITLE, FONT_SMALL, 120, 8, sTextColors, TEXT_SKIP_DRAW, sText_Keys);
    CopyWindowToVram(WIN_TITLE, COPYWIN_GFX);
}

static void InitScreen(void)
{
    s32 i;

    DmaClearLarge16(3, (void *)VRAM, VRAM_SIZE, 0x1000);
    DmaClear32(3, (void *)OAM, OAM_SIZE);
    DmaClear16(3, (void *)PLTT, PLTT_SIZE);
    SetGpuReg(REG_OFFSET_DISPCNT, DISPCNT_MODE_0);
    ResetBgsAndClearDma3BusyFlags(0);
    InitBgsFromTemplates(0, sBgTemplates, NELEMS(sBgTemplates));
    for (i = 0; i < 4; i++)
    {
        ChangeBgX(i, 0, BG_COORD_SET);
        ChangeBgY(i, 0, BG_COORD_SET);
    }
    InitWindows(sWindowTemplates);
    DeactivateAllTextPrinters();
    SetGpuReg(REG_OFFSET_BLDCNT, 0);
    SetGpuReg(REG_OFFSET_DISPCNT, DISPCNT_OBJ_1D_MAP | DISPCNT_OBJ_ON);
    for (i = 0; i < (s32)NELEMS(sWindowTemplates) - 1; i++)
        PutWindowTilemap(i);
    CopyBgTilemapBufferToVram(0);
    ShowBg(0);
}

static void CB2_InitAutoMenu(void)
{
    switch (sAutoMenu->state)
    {
    case 0:
        SetVBlankHBlankCallbacksToNull();
        ClearScheduledBgCopiesToVram();
        ScanlineEffect_Stop();
        break;
    case 1:
        FreeAllSpritePalettes();
        ResetPaletteFade();
        ResetSpriteData();
        ResetTasks();
        break;
    case 2:
        InitScreen();
        break;
    case 3:
        LoadPalette(GetTextWindowPalette(2), BG_PLTT_ID(15), PLTT_SIZE_4BPP);
        FillPalette(RGB_WHITE, 0, PLTT_SIZEOF(1));
        break;
    case 4:
        DrawTitle();
        DrawRows();
        break;
    default:
        CreateTask(Task_AutoMenu, 0);
        BeginNormalPaletteFade(PALETTES_ALL, 0, 16, 0, RGB_BLACK);
        SetVBlankCallback(VBlankCB_AutoMenu);
        SetMainCallback2(CB2_AutoMenu);
        return;
    }
    sAutoMenu->state++;
}

static void CB2_AutoMenu(void)
{
    RunTasks();
    AnimateSprites();
    BuildOamBuffer();
    DoScheduledBgTilemapCopiesToVram();
    UpdatePaletteFade();
}

static void VBlankCB_AutoMenu(void)
{
    LoadOam();
    ProcessSpriteCopyRequests();
    TransferPlttBuffer();
}

static void Close(void)
{
    sAutoMenu->closing = TRUE;
    BeginNormalPaletteFade(PALETTES_ALL, 0, 0, 16, RGB_BLACK);
}

static void ChangeValue(s8 delta)
{
    u8 count = sRows[sAutoMenu->row].valueCount;

    SetValue(sAutoMenu->row, (GetValue(sAutoMenu->row) + count + delta) % count);
    PlaySE(SE_SELECT);
    DrawRows();
}

static void Task_AutoMenu(u8 taskId)
{
    if (gPaletteFade.active)
        return;
    if (sAutoMenu->closing)
    {
        SetMainCallback2(sAutoMenu->exitCallback);
        FreeAllWindowBuffers();
        FREE_AND_SET_NULL(sAutoMenu);
        DestroyTask(taskId);
        return;
    }
    if (JOY_REPT(DPAD_UP))
    {
        sAutoMenu->row = (sAutoMenu->row + ROW_COUNT - 1) % ROW_COUNT;
        PlaySE(SE_SELECT);
        DrawRows();
    }
    else if (JOY_REPT(DPAD_DOWN))
    {
        sAutoMenu->row = (sAutoMenu->row + 1) % ROW_COUNT;
        PlaySE(SE_SELECT);
        DrawRows();
    }
    else if (!IsActionRow(sAutoMenu->row) && JOY_REPT(DPAD_LEFT))
    {
        ChangeValue(-1);
    }
    else if (!IsActionRow(sAutoMenu->row) && (JOY_REPT(DPAD_RIGHT) || JOY_NEW(A_BUTTON)))
    {
        ChangeValue(1);
    }
    else if (JOY_NEW(A_BUTTON))
    {
        PlaySE(SE_SELECT);
        if (gArenaBattle.autoOn)
            Arena_StopAuto(ARENA_STOP_PLAYER);
        else
            Arena_StartAuto();
        Close();
    }
    else if (JOY_NEW(B_BUTTON))
    {
        PlaySE(SE_SELECT);
        Close();
    }
}
