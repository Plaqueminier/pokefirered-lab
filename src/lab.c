#include "global.h"
#include "gflib.h"
#include "lab.h"

#if LAB
#include "intro.h"
#include "load_save.h"
#include "m4a.h"
#include "new_game.h"
#include "overworld.h"
#include "quest_log.h"
#include "random.h"
#include "save.h"

// The harness can patch this value in ROM before the first frame.
const volatile u16 gLabRngSeed = 0x4C41;

// Replaces the copyright screen, intro, title screen and main menu.
// With a valid save, does what the title screen and the main menu "Continue"
// do, without the "Previously on your quest" recap. With no save, falls back
// to the vanilla boot so a new game can be started.
void CB2_LabBoot(void)
{
    ResetMenuAndMonGlobals();
    Save_ResetSaveCounters();
    LoadGameSave(SAVE_NORMAL);
    if (gSaveFileStatus == SAVE_STATUS_EMPTY || gSaveFileStatus == SAVE_STATUS_INVALID)
    {
        SetMainCallback2(CB2_InitCopyrightScreenAfterBootup);
        return;
    }

    // Title screen, on Start
    SeedRng(gLabRngSeed);
    SetSaveBlocksPointers();
    ResetMenuAndMonGlobals();
    Save_ResetSaveCounters();
    LoadGameSave(SAVE_NORMAL);
    SetPokemonCryStereo(gSaveBlock2Ptr->optionsSound);
    InitHeap(gHeap, HEAP_SIZE);

    // Main menu, "Continue"
    gPlttBufferUnfaded[0] = RGB_BLACK;
    gPlttBufferFaded[0] = RGB_BLACK;
    QL_EnableRecordingSteps();
    gExitStairsMovementDisabled = FALSE;
    SetMainCallback2(CB2_ContinueSavedGame);
}
#endif
