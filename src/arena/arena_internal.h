#ifndef GUARD_ARENA_INTERNAL_H
#define GUARD_ARENA_INTERNAL_H

#include "arena.h"
#include "main.h"
#include "characters.h"
#include "constants/battle.h"
#include "constants/battle_anim.h"
#include "constants/pokemon.h"

enum
{
    ARENA_STRATEGY_POWER,
    ARENA_STRATEGY_SAVE_PP,
    ARENA_STRATEGY_TACTICS,
    ARENA_STRATEGY_TYPE_EDGE,
    ARENA_STRATEGY_RANDOM,
    ARENA_STRATEGY_COUNT
};

enum
{
    ARENA_SPEED_1X,
    ARENA_SPEED_2X,
    ARENA_SPEED_4X,
    ARENA_SPEED_8X,
    ARENA_SPEED_INSTANT,
    ARENA_SPEED_COUNT
};

enum
{
    ARENA_STOP_NONE,
    ARENA_STOP_PLAYER,
    ARENA_STOP_LOW_HP,
    ARENA_STOP_NEVER_SEEN,
    ARENA_STOP_GYM_LEADER,
};

// The Arena shows only single battles: the battler of a side has the id of the side.
#define ARENA_SIDES 2
#define ARENA_NO_CHOICE 0xFF
#define ARENA_CANCEL_SWITCH PARTY_SIZE
#define ARENA_NO_SPRITE 0xFF
#define ARENA_MESSAGE_LENGTH 160
#define ARENA_NOTICE_LENGTH 40
#define ARENA_MAX_PARTICLES 40
#define ARENA_MAX_FLOATS 3
#define ARENA_LOW_HP_BARS 20

#define ARENA_TAG_MON(side) (0x7A00 + (side))
#define ARENA_TAG_ICON(side, slot) (0x7A10 + (side) * PARTY_SIZE + (slot))
#define ARENA_TAG_GREY_ICON_PAL 0x7A20
#define ARENA_TAG_TRAINER_PAL 0x7A30
#define ARENA_TAG_FX 0x7A40
#define ARENA_TAG_FX_PAL 0x7A41
#define ARENA_TAG_FLOAT(i) (0x7A42 + (i))
#define ARENA_TAG_FLOAT_PAL 0x7A46
#define ARENA_TAG_END_MON(i) (0x7A50 + (i))

// The layout of the screen, in pixels.
#define ARENA_INFO_BOTTOM 48
#define ARENA_MON_TOP 38
#define ARENA_MON_CENTER_Y (ARENA_MON_TOP + 32)
#define ARENA_OVERLAY_TOP 64
#define ARENA_OVERLAY_BOTTOM 88
#define ARENA_FIELD_HALF_Y 72
#define ARENA_FIELD_HALF_H 24
#define ARENA_TEAM_TOP 96
#define ARENA_TEAM_Y 100
#define ARENA_FIELD_BOTTOM 120
#define ARENA_SCAN_LINES 228
#define ARENA_PANEL_ROWS 5
#define ARENA_OVERLAY_ROWS 3

#define ARENA_RGB(r, g, b) RGB((r) >> 3, (g) >> 3, (b) >> 3)

enum
{
    ARENA_FONT_SMALL,
    ARENA_FONT_BIG,
};

enum
{
    ARENA_ALIGN_LEFT,
    ARENA_ALIGN_CENTER,
    ARENA_ALIGN_RIGHT,
};

#define ARENA_PAL_CROWD 8
#define ARENA_PAL_FIELD 9
#define ARENA_PAL_UI 10
#define ARENA_PAL_CARDS 11

enum
{
    UI_BOX = 1,
    UI_GOLD,
    UI_WHITE,
    UI_GREY,
    UI_BAR_BG,
    UI_BLACK,
    UI_GREEN,
    UI_YELLOW,
    UI_RED,
    UI_ORANGE,
    UI_BLUE,
    UI_BANNER,
    UI_STATUS_PLAYER,
    UI_STATUS_FOE,
    UI_SHADOW,
};

enum
{
    CARDS_PANEL = 1,
    CARDS_LINE,
    CARDS_WHITE,
    CARDS_GREY,
    CARDS_FILL,
    CARDS_FILL_ON,
    CARDS_TYPE,
    CARDS_ORANGE = CARDS_TYPE + MAX_MON_MOVES,
    CARDS_BLUE,
    CARDS_GOLD,
    CARDS_MUTED,
    CARDS_DIM,
};

// The colors of the particle sprites.
enum
{
    FX_WHITE = 1,
    FX_PALE_YELLOW,
    FX_LIGHT_BLUE,
    FX_DUST,
    FX_GOLD = FX_DUST + 4,
    FX_RED,
    FX_BLUE,
    FX_GREEN,
    FX_PURPLE,
    FX_STAT_BLUE,
    FX_TYPE,
    FX_ALARM,
};

enum
{
    ARENA_NUMBER_DAMAGE,
    ARENA_NUMBER_SUPER_EFFECTIVE,
    ARENA_NUMBER_NOT_VERY_EFFECTIVE,
    ARENA_NUMBER_HEAL,
};

// unknown: the damage depends on the move of the foe or on chance (COUNTER, PRESENT), so min and max are 0.
struct ArenaEstimate
{
    u16 min;
    u16 max;
    u16 typePercent;
    bool8 unknown;
};

struct ArenaPlan
{
    u8 action;
    u8 moveIndex;
    u8 partyIndex;
};

// The index is the party slot at the start of the battle.
struct ArenaMonRecord
{
    u32 personality;
    u32 expStart;
    u16 statsStart[NUM_STATS];
    u16 damageDealt;
    u16 damageTaken;
    u8 levelStart;
    u8 knockOuts;
    u8 movesUsed;
    u8 misses;
};

struct ArenaRecord
{
    struct ArenaMonRecord mons[PARTY_SIZE];
    u32 moneyStart;
    u16 frameStart;
    bool8 endScreenShown;
};

struct ArenaBattle
{
    bool8 active;
    bool8 autoOn;
    bool8 menuRequested;
    bool8 playerAnswers;
    u8 stopReason;
    bool8 startMessagePending;
    u8 messageFrames;
    bool8 screenLeft;
    u32 holdBStart;
    u32 presentationRng;
    struct ArenaRecord record;
};

extern struct ArenaBattle gArenaBattle;
extern const u8 *const gArenaStrategyNames[ARENA_STRATEGY_COUNT];
extern const u8 *const gArenaSpeedNames[ARENA_SPEED_COUNT];

// Each 8x8 cell of the layer has its own tile, so a pixel write goes straight to VRAM. The tiles must be word aligned.
struct ArenaCanvas
{
    u16 *tiles;
    s16 top;
    u16 height;
    u8 tilesWide;
};

extern const struct ArenaCanvas gArenaStadiumCanvas;
extern const struct ArenaCanvas gArenaTopCanvas;
extern const struct ArenaCanvas gArenaBottomCanvas;
extern const struct ArenaCanvas gArenaOverlayCanvas;
extern const s16 gArenaMonCenterX[ARENA_SIDES];
extern const u8 gArenaBallPixels[7][8];
extern const u8 gArenaBallLegend[];

enum
{
    ARENA_MON_IDLE,
    ARENA_MON_ENTER,
    ARENA_MON_APPEAR,
    ARENA_MON_FAINT,
    ARENA_MON_LUNGE,
    ARENA_MON_HIT,
    ARENA_MON_RETURN,
    ARENA_MON_CAUGHT,
};

struct ArenaMon
{
    u8 spriteId;
    bool8 shown;
    bool8 hidden;
    u8 fx;
    u16 fxFrame;
    u16 fxLength;
    u16 species;
    u16 hp;
    u16 maxHp;
    u16 hpShown;
    u16 trailHp;
    u8 trailFrames;
    u8 flashFrames;
    s8 tint;
    u8 partyIndex;
    u8 boundsX0;
    u8 boundsX1;
    u8 boundsY1;
    u8 shadowRx;
};

enum
{
    ARENA_PANEL_EMPTY,
    ARENA_PANEL_MESSAGE,
    ARENA_PANEL_CARDS,
    ARENA_PANEL_SEND_OUT,
};

enum
{
    ARENA_CURSOR_CARD,
    ARENA_CURSOR_ICON = ARENA_CURSOR_CARD + MAX_MON_MOVES,
    ARENA_CURSOR_BAG = ARENA_CURSOR_ICON + PARTY_SIZE,
    ARENA_CURSOR_AUTO,
    ARENA_CURSOR_RUN,
};

enum
{
    ARENA_REGION_TOP,
    ARENA_REGION_OVERLAY,
    ARENA_REGION_TEAM,
    ARENA_REGION_FIELD,
    ARENA_REGION_PANEL,
    ARENA_REGIONS,
};

#define ARENA_CROWD_ROWS 6
#define ARENA_ALL_CROWD_ROWS ((1 << ARENA_CROWD_ROWS) - 1)
#define ARENA_CROWD_SEATS 48

struct ArenaTeam
{
    u8 iconSpriteIds[ARENA_SIDES][PARTY_SIZE];
    u8 counts[ARENA_SIDES];
    u8 iconPitch;
    bool8 foeSeen[PARTY_SIZE];
    u8 badgeShown;
};

struct ArenaPanel
{
    u8 kind;
    u8 cardSlide;
    u8 cursor;
    bool8 waitsForA;
    u8 message[ARENA_MESSAGE_LENGTH];
};

struct ArenaOverlay
{
    u8 shown;
    s8 shift;
    u16 turnShown;
    u16 turnNumber;
    u8 turnFrames;
    u8 slamColor;
    u8 slamFrames;
    u8 noticeFrames;
    const u8 *slamText;
    u8 notice[ARENA_NOTICE_LENGTH];
};

struct ArenaBanner
{
    u8 side;
    u8 frames;
    u16 move;
};

struct ArenaCrowd
{
    u8 cheer;
    bool8 moved;
    u8 rows;
    u8 nextRow;
    s16 wave;
    s16 waveShown;
};

struct ArenaRaster
{
    u16 lastFrame;
    u8 drawnThisFrame;
    u8 regionWaits[ARENA_REGIONS];
};

struct ArenaCamera
{
    u8 hitstop;
    u8 slowFrames;
    u8 shakeFrames;
    u8 shakeMagnitude;
    u8 zoomSide;
    u8 zoomFrames;
};

struct ArenaParticle
{
    s32 x;
    s32 y;
    s16 vx;
    s16 vy;
    s16 gravity;
    u16 age;
    u16 life;
    u8 spriteId;
    u8 wobble;
};

struct ArenaFloat
{
    u8 spriteId;
    u8 side;
    s8 vx;
    u16 age;
};

struct ArenaMoveEffect
{
    u8 spriteId;
    u8 kind;
    u8 frames;
    u8 from;
    u8 length;
    u16 tag;
};

struct ArenaJuice
{
    struct ArenaParticle particles[ARENA_MAX_PARTICLES];
    struct ArenaFloat floats[ARENA_MAX_FLOATS];
    u8 lowHpSpriteIds[ARENA_LOW_HP_BARS];
    bool8 lowHpSound;
};

// The files of the screen (arena_screen.c, arena_hud.c, arena_panel.c, arena_raster.c, arena_stadium.c for the
// crowd) write it directly; the other files use the setters. arena_juice.c owns camera and juice, arena_move_fx.c
// owns moveFx.
struct ArenaScreen
{
    bool8 built;
    u8 trainerSpriteId;
    u16 time;
    u16 dirty;
    u32 seed;
    u32 fxRng;
    struct ArenaMon mons[ARENA_SIDES];
    struct ArenaTeam team;
    struct ArenaPanel panel;
    struct ArenaOverlay overlay;
    struct ArenaBanner banner;
    struct ArenaCrowd crowd;
    struct ArenaRaster raster;
    struct ArenaCamera camera;
    struct ArenaJuice juice;
    struct ArenaMoveEffect moveFx;
};

extern struct ArenaScreen gArenaScreen;

#define ARENA_DIRTY_INFO(side) (1 << (side))
#define ARENA_DIRTY_TEAM (1 << 2)
#define ARENA_DIRTY_PANEL (1 << 3)
#define ARENA_DIRTY_OVERLAY (1 << 4)
#define ARENA_DIRTY_BANNER (1 << 5)
#define ARENA_DIRTY_HP(side) (1 << (6 + (side)))
#define ARENA_DIRTY_TEAM_HP (1 << 8)
#define ARENA_DIRTY_BADGE (1 << 9)
#define ARENA_DIRTY_FIELD_TOP (1 << 10)
#define ARENA_DIRTY_FIELD (ARENA_DIRTY_FIELD_TOP | (1 << 11))
#define ARENA_DIRTY_ALL ((1 << 12) - 1)

static inline u8 Arena_BattlerOf(u8 side)
{
    return side == B_SIDE_PLAYER ? B_POSITION_PLAYER_LEFT : B_POSITION_OPPONENT_LEFT;
}

static inline s8 Arena_Pan(u8 side)
{
    return side == B_SIDE_PLAYER ? SOUND_PAN_ATTACKER : SOUND_PAN_TARGET;
}

static inline bool32 Arena_IsLineEnd(u8 c)
{
    return c == EOS || c == CHAR_NEWLINE || c == CHAR_PROMPT_SCROLL || c == CHAR_PROMPT_CLEAR;
}

static inline u32 Arena_Lcg(u32 *state)
{
    *state = *state * 1103515245 + 24691;
    return *state >> 16;
}

// In a 4bpp tile, a row of 8 pixels is one word, and the pixel x is the nibble x % 8.
static inline u32 *ArenaCanvas_RowWord(const struct ArenaCanvas *canvas, s32 x, s32 y)
{
    y -= canvas->top;
    return (u32 *)canvas->tiles + ((y >> 3) * canvas->tilesWide + (x >> 3)) * 8 + (y & 7);
}

// arena.c
bool8 Arena_AutoPlays(void);
void Arena_StartAuto(void);
void Arena_StopAuto(u8 stopReason);
u8 *Arena_FormatAutoMode(u8 *dst);
void Arena_ShowPendingNotice(void);
bool8 Arena_StartMessageDone(void);
bool8 Arena_TakeMenuRequest(void);
void Arena_OnChooseAction(void);

// arena_auto.c
void ArenaAuto_Init(u32 seed);
const struct ArenaPlan *ArenaAuto_Plan(void);
const struct ArenaEstimate *ArenaAuto_Estimate(u8 moveIndex);
bool8 Arena_PrepareTurn(void);
u8 Arena_AutoPartyIndex(u8 partyAction);
bool8 Arena_CanSendOut(u8 partyIndex, u8 battler);

// arena_controller.c
void ArenaController_Init(void);

// arena_menu.c
void Arena_ShowAutoMenu(MainCallback exitCallback);

// arena_gfx.c
void ArenaCanvas_Pixel(const struct ArenaCanvas *canvas, s32 x, s32 y, u8 color);
void ArenaCanvas_Fill(const struct ArenaCanvas *canvas, s32 x, s32 y, s32 w, s32 h, u8 color);
void ArenaCanvas_FillPattern(const struct ArenaCanvas *canvas, s32 x, s32 y, s32 w, s32 h, u32 pattern);
void ArenaCanvas_Dither(const struct ArenaCanvas *canvas, s32 x, s32 y, s32 w, u8 color, bool32 odd);
void ArenaCanvas_Box(const struct ArenaCanvas *canvas, s32 x, s32 y, s32 w, s32 h, u8 fill, u8 border);
void ArenaCanvas_Frame(const struct ArenaCanvas *canvas, s32 x, s32 y, s32 w, s32 h, u8 color);
void ArenaCanvas_PixMap(const struct ArenaCanvas *canvas, s32 x, s32 y, const u8 (*rows)[8], u32 count, const u8 *legend, const u8 *colors);
const u8 *Arena_SkipControlCode(const u8 *str);
const u8 *ArenaCanvas_TextLine(const struct ArenaCanvas *canvas, s32 x, s32 y, const u8 *str, u8 font, u8 color, u8 shadow);
void ArenaCanvas_Text(const struct ArenaCanvas *canvas, s32 x, s32 y, const u8 *str, u8 font, u8 color, u8 shadow, u8 align);
u32 Arena_TextWidth(const u8 *str, u8 font);

// arena_stadium.c
void ArenaStadium_LoadPalettes(u32 seed);
void ArenaStadium_Draw(const struct ArenaCanvas *canvas, u32 seed);
void ArenaStadium_DrawField(const struct ArenaCanvas *canvas, s32 y0, s32 y1);
void ArenaStadium_DrawShadow(const struct ArenaCanvas *canvas, s32 cx, s32 cy, s32 rx);
void ArenaCrowd_SetCheer(u8 cheer);
void ArenaCrowd_Update(void);
void ArenaCrowd_MarkDrawn(void);
u32 ArenaCrowd_Cost(void);
void ArenaCrowd_Draw(void);

// arena_screen.c
struct Pokemon *Arena_Party(u8 side);
struct Pokemon *Arena_PartyOf(u8 side);
bool8 Arena_IsTeamMon(struct Pokemon *mon);
u16 Arena_TypeColor(u8 type);
u32 Arena_FxRandom(void);
u16 Arena_Frames(u16 frames);
bool8 Arena_JuiceOn(void);
void ArenaScreen_Init(void);
void ArenaScreen_SetBgColor(u8 palette, u8 index, u16 color);
void ArenaScreen_SetObjColor(u16 paletteTag, u8 index, u16 color);
void ArenaScreen_MarkDirty(u16 flags);
void ArenaScreen_WritePanelTilemap(s32 shift);
void ArenaScreen_WriteOverlayTilemap(s32 shift);
void ArenaScreen_Build(bool8 withMons);
void ArenaScreen_Free(void);
s32 ArenaScreen_FeetY(u8 side);
void ArenaScreen_ShowMon(u8 side, u8 partyIndex, u8 fx);
void ArenaScreen_HideMon(u8 side);
void ArenaScreen_ShowTrainer(bool8 show);
void ArenaScreen_StartMonFx(u8 side, u8 fx, u16 length);
bool8 ArenaScreen_MonFxDone(u8 side);
void ArenaScreen_SetHp(u8 side, s32 hp);
void ArenaScreen_SetMaxHp(u8 side, u16 maxHp);
void ArenaScreen_SetHidden(u8 side, bool8 hidden);
void ArenaScreen_SetTint(u8 side, s8 tint);
void ArenaScreen_Flash(u8 side, u8 frames);
u32 ArenaScreen_FieldCost(void);
void ArenaScreen_DrawField(void);

// arena_hud.c
void ArenaHud_LoadIconPalettes(void);
void ArenaHud_UpdateIcons(void);
void ArenaHud_ShowBanner(u8 side, u16 move);
void ArenaHud_Update(void);
u32 ArenaHud_TopCost(void);
void ArenaHud_DrawTop(void);
u32 ArenaHud_TeamCost(void);
void ArenaHud_DrawTeam(void);

// arena_panel.c
void ArenaPanel_ShowMessage(const u8 *message, bool8 waitsForA);
void ArenaPanel_AnswerPrompt(void);
void ArenaPanel_Show(u8 kind);
void ArenaPanel_SetCursor(u8 cursor);
void ArenaPanel_ShowNotice(const u8 *text);
bool8 ArenaPanel_NoticeShows(void);
void ArenaPanel_ShowSlam(const u8 *text, u8 color);
void ArenaPanel_ShowTurn(u16 turn);
void ArenaPanel_Update(void);
void ArenaPanel_UpdateCardSlide(void);
u32 ArenaPanel_Cost(void);
void ArenaPanel_Draw(void);
u32 ArenaPanel_OverlayCost(void);
void ArenaPanel_DrawOverlay(void);

// arena_raster.c
bool32 ArenaRaster_EndsInTime(u32 cost);
bool32 ArenaRaster_FitsBehindScan(u32 bottom, u32 cost);
void ArenaRaster_Draw(void);
void ArenaRaster_DrawAll(void);

// arena_juice.c
void ArenaJuice_LoadGfx(void);
void ArenaJuice_Update(void);
bool8 ArenaJuice_SkipsFrame(void);
void ArenaJuice_Burst(s32 x, s32 y, u8 count, const u8 *colors, u8 colorCount, u8 speed, bool8 up, u16 life);
void ArenaJuice_Sparkle(s32 x, s32 y, s32 w, s32 h);
void ArenaJuice_UpdateParticles(void);
void ArenaJuice_DamageNumber(u8 side, s32 value, u8 kind);
void ArenaJuice_OnMove(u8 side, u16 move);
void ArenaJuice_OnHit(u8 side, bool8 critical, u8 effectiveness, u16 damage);
void ArenaJuice_OnFaint(u8 side);
void ArenaJuice_OnSendOut(u8 side);
void ArenaJuice_OnStatChange(u8 side, bool8 up);
void ArenaJuice_OnLevelUp(void);
void ArenaJuice_OnTurn(u16 turn);
void ArenaJuice_UpdateLowHp(void);
void ArenaJuice_Free(void);
s32 ArenaJuice_ShakeX(void);
s32 ArenaJuice_ShakeY(void);

// arena_move_fx.c
void ArenaMoveFx_Reset(void);
void ArenaMoveFx_Start(u8 side, u16 move);
void ArenaMoveFx_Update(void);
#if LAB
void ArenaMoveFx_CheckSounds(void);
#endif

// arena_ball.c
void ArenaBall_Reset(void);
void ArenaBall_StartSendOut(u8 side, u16 ball);
void ArenaBall_StartCapture(u16 ball, u8 shakes, bool8 caught);
bool8 ArenaBall_Done(void);
void ArenaBall_Update(void);

// arena_end.c
void ArenaRecord_Start(void);
void ArenaRecord_OnDamage(u8 targetBattler, s32 damage);
void ArenaRecord_OnMove(u8 battler);
void ArenaRecord_OnMiss(u8 battler);
void ArenaRecord_OnFaint(u8 battler);

#endif
