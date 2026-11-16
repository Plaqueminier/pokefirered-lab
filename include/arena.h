#ifndef GUARD_ARENA_H
#define GUARD_ARENA_H

// Issue #99: the Arena battle screen, Auto mode and the battle speed. The engine files use only this header.
#if ARENA

enum
{
    ARENA_QUESTION_LEARN_MOVE,
    ARENA_QUESTION_STOP_LEARNING,
    ARENA_QUESTION_YES_NO,
};

bool8 Arena_ShowsScreen(void);
void Arena_OnBattleInit(void);
void Arena_OnBattleStart(void);
void Arena_OnBattleEnd(void);
bool8 Arena_FreezesFrameRng(void);
void Arena_SwapPresentationRng(void);
void Arena_RunExtraCallbacks(void);
void Arena_OnLearnMoveQuestion(void);
u16 Arena_AutoKey(u8 question);
bool8 Arena_InitSprites(void);
bool8 Arena_RunCommand(u8 battler);
bool8 Arena_ReshowScreen(void);
void Arena_LeaveScreen(void);
bool8 Arena_SkipsLevelUpBox(void);
bool8 Arena_StartEndScreen(void);

#define ARENA_AUTO_PRESSES(question, key) (Arena_AutoKey(question) == (key))

#else

#define ARENA_AUTO_PRESSES(question, key) FALSE

#endif

#endif
