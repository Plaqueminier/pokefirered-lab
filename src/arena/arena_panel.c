// The panel under the field (the move cards, the messages, the send-out choice) and the overlay band across the
// field (the turn number, the slam texts, the notices).
#include "global.h"
#include "arena_internal.h"
#include "battle.h"
#include "characters.h"
#include "data.h"
#include "pokemon.h"
#include "string_util.h"
#include "constants/moves.h"

#define CARD_W 117
#define CARD_H 19
#define CARD_SLIDE_FRAMES 8
#define NOTICE_FRAMES 90
#define SLAM_FRAMES 50
#define TURN_FRAMES 50
#define OVERLAY_HIDDEN 0x7F

static const u8 sText_Slash[] = _("/");
static const u8 sText_Pp[] = _("PP ");
static const u8 sText_Status[] = _("STATUS");
static const u8 sText_NoEffect[] = _("NO EFFECT");
static const u8 sText_Unknown[] = _("?");
static const u8 sText_Ko[] = _("KO");
static const u8 sText_PercentKo[] = _("%-KO");
static const u8 sText_Percent[] = _("%");
static const u8 sText_Dash[] = _("-");
static const u8 sText_SendOut[] = _("SEND OUT WHICH POKéMON?");
static const u8 sText_Prompt[] = _("▶");
static const u8 sText_Turn[] = _("TURN ");

enum
{
    OVERLAY_NONE,
    OVERLAY_TURN,
    OVERLAY_SLAM,
    OVERLAY_NOTICE,
};

static void EstimateText(u8 index, u8 *text, u8 *color)
{
    const struct ArenaEstimate *estimate = ArenaAuto_Estimate(index);
    const struct BattlePokemon *foe = &gBattleMons[Arena_BattlerOf(B_SIDE_OPPONENT)];
    u16 move = gBattleMons[Arena_BattlerOf(B_SIDE_PLAYER)].moves[index];
    u32 foeHp = foe->hp, foeMaxHp = max(1, foe->maxHP);
    u8 *end;

    if (gBattleMoves[move].power == 0)
    {
        *color = CARDS_MUTED;
        StringCopy(text, sText_Status);
        return;
    }
    if (estimate->typePercent == 0)
    {
        *color = CARDS_MUTED;
        StringCopy(text, sText_NoEffect);
        return;
    }
    if (estimate->unknown)
    {
        *color = CARDS_WHITE;
        StringCopy(text, sText_Unknown);
        return;
    }
    if (estimate->min >= foeHp)
    {
        *color = CARDS_GOLD;
        StringCopy(text, sText_Ko);
        return;
    }
    *color = estimate->typePercent > 100 ? CARDS_ORANGE : estimate->typePercent < 100 ? CARDS_BLUE : CARDS_WHITE;
    end = ConvertIntToDecimalStringN(text, (estimate->min * 100 + foeMaxHp / 2) / foeMaxHp, STR_CONV_MODE_LEFT_ALIGN, 3);
    if (estimate->max >= foeHp)
    {
        StringCopy(end, sText_PercentKo);
        return;
    }
    end = StringCopy(end, sText_Dash);
    end = ConvertIntToDecimalStringN(end, (min(foeHp, estimate->max) * 100 + foeMaxHp / 2) / foeMaxHp, STR_CONV_MODE_LEFT_ALIGN, 3);
    StringCopy(end, sText_Percent);
}

static void DrawCard(u8 index)
{
    struct BattlePokemon *mon = &gBattleMons[Arena_BattlerOf(B_SIDE_PLAYER)];
    u16 move = mon->moves[index];
    bool8 selected = gArenaScreen.panel.cursor == ARENA_CURSOR_CARD + index;
    s32 x = 2 + (index % 2) * (CARD_W + 2);
    s32 y = 121 + (index / 2) * CARD_H - (selected ? 1 : 0);
    u8 text[24];
    u8 color;
    u8 *end;
    u8 pp = mon->pp[index];

    if (move == MOVE_NONE)
        return;
    ArenaScreen_SetBgColor(ARENA_PAL_CARDS, CARDS_TYPE + index, Arena_TypeColor(gBattleMoves[move].type));
    ArenaCanvas_Box(&gArenaBottomCanvas, x, y, CARD_W, CARD_H, selected ? CARDS_FILL_ON : CARDS_FILL, CARDS_TYPE + index);
    ArenaCanvas_Text(&gArenaBottomCanvas, x + 4, y + 3, gMoveNames[move], ARENA_FONT_SMALL, pp != 0 ? CARDS_WHITE : CARDS_DIM, 0, ARENA_ALIGN_LEFT);
    end = StringCopy(text, sText_Pp);
    end = ConvertIntToDecimalStringN(end, pp, STR_CONV_MODE_LEFT_ALIGN, 2);
    end = StringCopy(end, sText_Slash);
    ConvertIntToDecimalStringN(end, CalculatePPWithBonus(move, mon->ppBonuses, index), STR_CONV_MODE_LEFT_ALIGN, 2);
    ArenaCanvas_Text(&gArenaBottomCanvas, x + 4, y + 11, text, ARENA_FONT_SMALL, CARDS_GREY, 0, ARENA_ALIGN_LEFT);
    EstimateText(index, text, &color);
    ArenaCanvas_Text(&gArenaBottomCanvas, x + CARD_W - 4, y + 11, text, ARENA_FONT_SMALL, color, 0, ARENA_ALIGN_RIGHT);
}

static void DrawMessage(void)
{
    const u8 *line = gArenaScreen.panel.message;
    const u8 *next;
    u32 lines = 1, i;
    s32 y;

    for (next = line; *next != EOS; next++)
    {
        if (Arena_IsLineEnd(*next) && next[1] != EOS)
            lines++;
    }
    lines = min(lines, 3);
    y = 137 - lines * 6;
    for (i = 0; i < lines && *line != EOS; i++, y += 12)
    {
        u32 width = Arena_TextWidth(line, ARENA_FONT_SMALL);

        next = ArenaCanvas_TextLine(&gArenaBottomCanvas, (DISPLAY_WIDTH - width) / 2, y, line, ARENA_FONT_SMALL, CARDS_WHITE, 0);
        line = *next == EOS ? next : next + 1;
    }
    if (gArenaScreen.panel.waitsForA && (gArenaScreen.time / 16) % 2)
        ArenaCanvas_Text(&gArenaBottomCanvas, DISPLAY_WIDTH - 10, 150, sText_Prompt, ARENA_FONT_SMALL, CARDS_GOLD, 0, ARENA_ALIGN_LEFT);
}

u32 ArenaPanel_Cost(void)
{
    if (!(gArenaScreen.dirty & ARENA_DIRTY_PANEL))
        return 0;
    switch (gArenaScreen.panel.kind)
    {
    case ARENA_PANEL_CARDS:
        return 200;
    case ARENA_PANEL_MESSAGE:
        return 16 + 2 * StringLength(gArenaScreen.panel.message);
    case ARENA_PANEL_SEND_OUT:
        return 60;
    }
    return 10;
}

void ArenaPanel_Draw(void)
{
    u32 i;

    ArenaCanvas_Fill(&gArenaBottomCanvas, 0, ARENA_FIELD_BOTTOM, DISPLAY_WIDTH, DISPLAY_HEIGHT - ARENA_FIELD_BOTTOM, CARDS_PANEL);
    ArenaCanvas_Fill(&gArenaBottomCanvas, 0, ARENA_FIELD_BOTTOM, DISPLAY_WIDTH, 1, CARDS_LINE);
    switch (gArenaScreen.panel.kind)
    {
    case ARENA_PANEL_CARDS:
        for (i = 0; i < MAX_MON_MOVES; i++)
            DrawCard(i);
        break;
    case ARENA_PANEL_SEND_OUT:
        ArenaCanvas_Text(&gArenaBottomCanvas, DISPLAY_WIDTH / 2, 136, sText_SendOut, ARENA_FONT_SMALL, CARDS_WHITE, 0, ARENA_ALIGN_CENTER);
        break;
    case ARENA_PANEL_MESSAGE:
        DrawMessage();
        break;
    }
    gArenaScreen.dirty &= ~ARENA_DIRTY_PANEL;
}

void ArenaPanel_ShowMessage(const u8 *message, bool8 waitsForA)
{
    u32 i;

    for (i = 0; i < ARENA_MESSAGE_LENGTH - 1 && message[i] != EOS; i++)
        gArenaScreen.panel.message[i] = message[i];
    gArenaScreen.panel.message[i] = EOS;
    gArenaScreen.panel.waitsForA = waitsForA;
    ArenaPanel_Show(ARENA_PANEL_MESSAGE);
}

// The redraw takes the blinking ▶ away.
void ArenaPanel_AnswerPrompt(void)
{
    if (!gArenaScreen.panel.waitsForA)
        return;
    gArenaScreen.panel.waitsForA = FALSE;
    gArenaScreen.dirty |= ARENA_DIRTY_PANEL;
}

void ArenaPanel_UpdateCardSlide(void)
{
    struct ArenaPanel *panel = &gArenaScreen.panel;

    if (panel->cardSlide == 0)
        return;
    if (!(gArenaScreen.dirty & ARENA_DIRTY_PANEL))
        panel->cardSlide--;
    ArenaScreen_WritePanelTilemap(panel->cardSlide >= CARD_SLIDE_FRAMES ? ARENA_PANEL_ROWS : (panel->cardSlide + 1) / 2);
}

static void StartCardSlide(u8 kind)
{
    struct ArenaPanel *panel = &gArenaScreen.panel;

    if (kind == ARENA_PANEL_CARDS && panel->kind != ARENA_PANEL_CARDS && !Arena_AutoPlays() && Arena_JuiceOn())
    {
        panel->cardSlide = CARD_SLIDE_FRAMES;
    }
    else if (kind != ARENA_PANEL_CARDS && panel->cardSlide != 0)
    {
        panel->cardSlide = 0;
        ArenaScreen_WritePanelTilemap(0);
    }
}

static bool32 ShowsChoice(u8 kind)
{
    return kind == ARENA_PANEL_CARDS || kind == ARENA_PANEL_SEND_OUT;
}

void ArenaPanel_Show(u8 kind)
{
    StartCardSlide(kind);
    gArenaScreen.dirty |= ARENA_DIRTY_PANEL | ARENA_DIRTY_TEAM_HP;
    if (ShowsChoice(kind) || ShowsChoice(gArenaScreen.panel.kind))
        gArenaScreen.dirty |= ARENA_DIRTY_TEAM | ARENA_DIRTY_HP(B_SIDE_OPPONENT);
    gArenaScreen.panel.kind = kind;
}

void ArenaPanel_SetCursor(u8 cursor)
{
    gArenaScreen.panel.cursor = cursor;
    gArenaScreen.dirty |= ARENA_DIRTY_PANEL | ARENA_DIRTY_TEAM | ARENA_DIRTY_HP(B_SIDE_OPPONENT);
}

void ArenaPanel_ShowNotice(const u8 *text)
{
    StringCopyN(gArenaScreen.overlay.notice, text, ARENA_NOTICE_LENGTH - 1);
    gArenaScreen.overlay.notice[ARENA_NOTICE_LENGTH - 1] = EOS;
    gArenaScreen.overlay.noticeFrames = NOTICE_FRAMES;
    gArenaScreen.dirty |= ARENA_DIRTY_OVERLAY;
}

bool8 ArenaPanel_NoticeShows(void)
{
    return gArenaScreen.overlay.noticeFrames != 0;
}

void ArenaPanel_ShowSlam(const u8 *text, u8 color)
{
    gArenaScreen.overlay.slamText = text;
    gArenaScreen.overlay.slamColor = color;
    gArenaScreen.overlay.slamFrames = SLAM_FRAMES;
    gArenaScreen.dirty |= ARENA_DIRTY_OVERLAY;
}

// A turn shows once, also when the engine asks for the action of the turn again.
void ArenaPanel_ShowTurn(u16 turn)
{
    if (gArenaScreen.overlay.turnNumber == turn)
        return;
    gArenaScreen.overlay.turnNumber = turn;
    gArenaScreen.overlay.turnFrames = TURN_FRAMES;
}

static u8 OverlayKind(void)
{
    struct ArenaOverlay *overlay = &gArenaScreen.overlay;

    if (overlay->turnFrames != 0)
        return OVERLAY_TURN;
    if (overlay->slamFrames != 0)
        return OVERLAY_SLAM;
    return overlay->noticeFrames != 0 ? OVERLAY_NOTICE : OVERLAY_NONE;
}

static s32 OverlayShift(void)
{
    s32 k = gArenaScreen.overlay.turnFrames;

    if (gArenaScreen.overlay.shown != OVERLAY_TURN || k == 0)
        return 0;
    return k > 40 ? (k - 40) * 3 : k < 10 ? -(10 - k) * 3 : 0;
}

static bool32 OverlayChanged(void)
{
    struct ArenaOverlay *overlay = &gArenaScreen.overlay;
    u8 kind = OverlayKind();

    return (gArenaScreen.dirty & ARENA_DIRTY_OVERLAY) || kind != overlay->shown
        || (kind == OVERLAY_TURN && overlay->turnNumber != overlay->turnShown);
}

static void DrawOverlay(void)
{
    struct ArenaOverlay *overlay = &gArenaScreen.overlay;
    u8 text[16];
    u8 kind = OverlayKind();

    ArenaCanvas_Fill(&gArenaOverlayCanvas, 0, ARENA_OVERLAY_TOP, DISPLAY_WIDTH, ARENA_OVERLAY_BOTTOM - ARENA_OVERLAY_TOP, 0);
    if (kind == OVERLAY_TURN)
    {
        ArenaCanvas_Fill(&gArenaOverlayCanvas, 0, 66, DISPLAY_WIDTH, 18, UI_BOX);
        ArenaCanvas_Fill(&gArenaOverlayCanvas, 0, 66, DISPLAY_WIDTH, 1, UI_GOLD);
        ArenaCanvas_Fill(&gArenaOverlayCanvas, 0, 83, DISPLAY_WIDTH, 1, UI_GOLD);
        ConvertIntToDecimalStringN(StringCopy(text, sText_Turn), overlay->turnNumber, STR_CONV_MODE_LEFT_ALIGN, 3);
        ArenaCanvas_Text(&gArenaOverlayCanvas, DISPLAY_WIDTH / 2, 70, text, ARENA_FONT_BIG, UI_YELLOW, UI_SHADOW, ARENA_ALIGN_CENTER);
    }
    else if (kind == OVERLAY_SLAM)
    {
        ArenaCanvas_Text(&gArenaOverlayCanvas, DISPLAY_WIDTH / 2, 70, overlay->slamText, ARENA_FONT_BIG, overlay->slamColor, UI_SHADOW, ARENA_ALIGN_CENTER);
    }
    else if (kind == OVERLAY_NOTICE)
    {
        ArenaCanvas_Box(&gArenaOverlayCanvas, 20, 67, DISPLAY_WIDTH - 40, 17, UI_BOX, UI_GOLD);
        ArenaCanvas_Text(&gArenaOverlayCanvas, DISPLAY_WIDTH / 2, 72, overlay->notice, ARENA_FONT_SMALL, UI_WHITE, UI_SHADOW, ARENA_ALIGN_CENTER);
    }
    overlay->shown = kind;
    overlay->turnShown = overlay->turnNumber;
}

static bool32 ScanIsInOverlay(void)
{
    return REG_VCOUNT >= ARENA_OVERLAY_TOP - 2 && REG_VCOUNT < ARENA_OVERLAY_BOTTOM;
}

u32 ArenaPanel_OverlayCost(void)
{
    static const u8 sCosts[] = {[OVERLAY_NONE] = 14, [OVERLAY_TURN] = 75, [OVERLAY_SLAM] = 80, [OVERLAY_NOTICE] = 85};

    if (OverlayChanged())
        return sCosts[OverlayKind()];
    return gArenaScreen.overlay.shift != OverlayShift() ? 4 : 0;
}

// The band hides while it redraws, so only the tilemap write must miss the scan.
static void UpdateOverlay(void)
{
    if (OverlayChanged())
    {
        ArenaScreen_WriteOverlayTilemap(OVERLAY_HIDDEN);
        DrawOverlay();
        if (ScanIsInOverlay())
            return;
    }
    ArenaScreen_WriteOverlayTilemap(OverlayShift());
}

void ArenaPanel_DrawOverlay(void)
{
    UpdateOverlay();
    gArenaScreen.dirty &= ~ARENA_DIRTY_OVERLAY;
}

static void CountDown(u8 *frames, u16 dirty)
{
    if (*frames != 0)
    {
        (*frames)--;
        gArenaScreen.dirty |= dirty;
    }
}

void ArenaPanel_Update(void)
{
    struct ArenaOverlay *overlay = &gArenaScreen.overlay;

    if (gArenaScreen.panel.kind == ARENA_PANEL_MESSAGE && gArenaScreen.panel.waitsForA && gArenaScreen.time % 16 == 0)
        gArenaScreen.dirty |= ARENA_DIRTY_PANEL;
    CountDown(&overlay->turnFrames, 0);
    CountDown(&overlay->slamFrames, overlay->slamFrames == 1 ? ARENA_DIRTY_OVERLAY : 0);
    CountDown(&overlay->noticeFrames, overlay->noticeFrames == 1 ? ARENA_DIRTY_OVERLAY : 0);
}
