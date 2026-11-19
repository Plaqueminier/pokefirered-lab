// The info boxes with the move banner, and the team row with its buttons or the Auto badge.
#include "global.h"
#include "arena_internal.h"
#include "battle.h"
#include "battle_interface.h"
#include "characters.h"
#include "data.h"
#include "palette.h"
#include "pokemon.h"
#include "pokemon_icon.h"
#include "sprite.h"
#include "string_util.h"
#include "constants/moves.h"

#define TEAM_MARGIN 4
#define TEAM_GAP 3
#define ICON_W 16
// Each icon palette has the outline color at index 15.
#define ICON_OUTLINE 15
#define ICON_TILES (ICON_W / 8)
#define ICON_SOURCE_TILES (2 * ICON_TILES)
#define MAX_ICON_PITCH 18
#define MIN_ICON_PITCH 11
#define BUTTON_BAG_W 24
#define BUTTON_AUTO_W 31
#define BUTTON_RUN_W 24
#define BUTTON_GAP 2
#define BUTTONS_W (BUTTON_BAG_W + BUTTON_AUTO_W + BUTTON_RUN_W + 2 * BUTTON_GAP)
#define BOX_W 100
#define BOX_H 23
#define BOX_Y 3
#define STATUS_Y 28
#define BANNER_Y 30
#define BAR_X 19
#define BAR_W 28
#define NAME_GAP 4
#define TEXT_LEFT 4
#define TEXT_RIGHT (BOX_W - 4)
#define BADGE_Y (ARENA_TEAM_Y + 1)
#define BADGE_MAX_W 112
#define BADGE_H 14
#define BADGE_TALL_Y (ARENA_TEAM_Y - 4)
#define BADGE_TALL_H 22
#define BADGE_PAD 6
// The game uses only three icon palettes; the table has three more that it never uses.
#define ICON_PALETTES 3

static const s16 sBoxX[ARENA_SIDES] = {4, 136};

static const u8 sText_Lv[] = _("Lv");
static const u8 sText_Hp[] = _("HP");
static const u8 sText_Slash[] = _("/");
static const u8 sText_Bag[] = _("BAG");
static const u8 sText_Auto[] = _("AUTO");
static const u8 sText_Run[] = _("RUN");
static const u8 sText_AutoBadge[] = _("AUTO ");

static const u8 sText_Psn[] = _("PSN");
static const u8 sText_Brn[] = _("BRN");
static const u8 sText_Par[] = _("PAR");
static const u8 sText_Slp[] = _("SLP");
static const u8 sText_Frz[] = _("FRZ");

static const struct OamData sOamIcon =
{
    .shape = SPRITE_SHAPE(16x16),
    .size = SPRITE_SIZE(16x16),
    .priority = 2,
};

static const u8 *const sButtonTexts[] = {sText_Bag, sText_Auto, sText_Run};
static const u8 sButtonW[] = {BUTTON_BAG_W, BUTTON_AUTO_W, BUTTON_RUN_W};

static const u8 sBallColors[] = {UI_BLACK, UI_BLACK, UI_RED, UI_WHITE};

struct BadgeBox
{
    s32 x, y, w, h;
    bool32 twoLines;
};

static u8 HpColor(u32 hp, u32 maxHp)
{
    switch (GetHPBarLevel(hp, maxHp))
    {
    case HP_BAR_YELLOW:
        return UI_YELLOW;
    case HP_BAR_RED:
    case HP_BAR_EMPTY:
        return UI_RED;
    default:
        return UI_GREEN;
    }
}

static s32 BarX(u32 hp, u32 maxHp, s32 width)
{
    return maxHp == 0 ? 0 : (hp * width + maxHp - 1) / maxHp;
}

static void DrawHpBar(u8 side, s32 x, s32 y)
{
    struct ArenaMon *mon = &gArenaScreen.mons[side];
    u8 trailColor = mon->trailFrames > 12 ? UI_WHITE : UI_YELLOW;
    s32 hpX = BarX(mon->hp, mon->maxHp, BAR_W);

    ArenaCanvas_Fill(&gArenaTopCanvas, x - 1, y - 1, BAR_W + 2, 5, UI_BLACK);
    ArenaCanvas_Fill(&gArenaTopCanvas, x, y, BAR_W, 3, UI_BAR_BG);
    ArenaCanvas_Fill(&gArenaTopCanvas, x + hpX, y, BarX(mon->trailHp, mon->maxHp, BAR_W) - hpX, 3, trailColor);
    ArenaCanvas_Fill(&gArenaTopCanvas, x, y, hpX, 3, HpColor(mon->hp, mon->maxHp));
}

static void DrawEstimateOnBar(s32 x, s32 y)
{
    struct ArenaMon *foe = &gArenaScreen.mons[B_SIDE_OPPONENT];
    const struct ArenaEstimate *estimate;
    s32 hi, lo;

    if (gArenaScreen.panel.kind != ARENA_PANEL_CARDS || gArenaScreen.panel.cursor >= ARENA_CURSOR_ICON)
        return;
    estimate = ArenaAuto_Estimate(gArenaScreen.panel.cursor);
    if (estimate->max == 0 || estimate->typePercent == 0)
        return;
    lo = BarX(max(0, foe->hp - estimate->max), foe->maxHp, BAR_W);
    hi = BarX(max(0, foe->hp - estimate->min), foe->maxHp, BAR_W);
    ArenaCanvas_Fill(&gArenaTopCanvas, x + lo, y, hi - lo, 3, UI_GREY);
    ArenaCanvas_Fill(&gArenaTopCanvas, x + hi, y, BarX(foe->hp, foe->maxHp, BAR_W) - hi, 3, (gArenaScreen.time / 14) % 2 ? UI_WHITE : UI_RED);
}

static const u8 *StatusText(u32 status, u16 *color)
{
    if (status & STATUS1_SLEEP)
    {
        *color = ARENA_RGB(0xa8, 0xa8, 0x98);
        return sText_Slp;
    }
    if (status & STATUS1_PSN_ANY)
    {
        *color = ARENA_RGB(0xa0, 0x40, 0xa0);
        return sText_Psn;
    }
    if (status & STATUS1_BURN)
    {
        *color = ARENA_RGB(0xf0, 0x80, 0x30);
        return sText_Brn;
    }
    if (status & STATUS1_FREEZE)
    {
        *color = ARENA_RGB(0x70, 0xc8, 0xe0);
        return sText_Frz;
    }
    if (status & STATUS1_PARALYSIS)
    {
        *color = ARENA_RGB(0xd8, 0xb0, 0x20);
        return sText_Par;
    }
    return NULL;
}

static void DrawHp(u8 side, bool32 full)
{
    struct ArenaMon *mon = &gArenaScreen.mons[side];
    s32 x = sBoxX[side];
    u8 text[16];

    if (!mon->shown)
        return;
    ConvertIntToDecimalStringN(text, mon->hp, STR_CONV_MODE_LEFT_ALIGN, 3);
    StringAppend(text, sText_Slash);
    ConvertIntToDecimalStringN(text + StringLength(text), mon->maxHp, STR_CONV_MODE_LEFT_ALIGN, 3);
    full |= mon->hp != mon->hpShown || !Arena_TextFits(text, ARENA_FONT_SMALL, TEXT_RIGHT - BAR_X - BAR_W - 1);
    if (full)
        ArenaCanvas_Fill(&gArenaTopCanvas, x + BAR_X - 1, BOX_Y + 11, BOX_W - BAR_X - 2, 9, UI_BOX);
    DrawHpBar(side, x + BAR_X, BOX_Y + 14);
    if (side == B_SIDE_OPPONENT)
        DrawEstimateOnBar(x + BAR_X, BOX_Y + 14);
    if (full)
        ArenaCanvas_Text(&gArenaTopCanvas, x + TEXT_RIGHT, BOX_Y + 12, text, ARENA_FONT_SMALL, UI_WHITE, 0, ARENA_ALIGN_RIGHT);
    mon->hpShown = mon->hp;
}

static s32 NameRoom(const u8 *levelText)
{
    return TEXT_RIGHT - TEXT_LEFT - NAME_GAP - Arena_TextWidth(levelText, ARENA_FONT_SMALL);
}

static void DrawInfoBox(u8 side)
{
    struct ArenaMon *mon = &gArenaScreen.mons[side];
    s32 x = sBoxX[side];
    u8 level = GetMonData(Arena_PartyOf(side), MON_DATA_LEVEL);
    u8 name[16];
    u8 levelText[8];

    ArenaCanvas_Fill(&gArenaTopCanvas, x, 0, BOX_W, BOX_Y + BOX_H + 1, 0);
    if (!mon->shown)
        return;
    ArenaCanvas_Box(&gArenaTopCanvas, x, BOX_Y, BOX_W, BOX_H, UI_BOX, UI_GOLD);
    GetMonData(Arena_PartyOf(side), MON_DATA_NICKNAME, name);
    StringGet_Nickname(name);
    ConvertIntToDecimalStringN(StringCopy(levelText, sText_Lv), level, STR_CONV_MODE_LEFT_ALIGN, 3);
    if (!Arena_TextFits(name, ARENA_FONT_SMALL, NameRoom(levelText)))
        ConvertIntToDecimalStringN(levelText, level, STR_CONV_MODE_LEFT_ALIGN, 3);
    Arena_FitText(name, ARENA_FONT_SMALL, NameRoom(levelText));
    ArenaCanvas_Text(&gArenaTopCanvas, x + TEXT_LEFT, BOX_Y + 3, name, ARENA_FONT_SMALL, UI_WHITE, UI_SHADOW, ARENA_ALIGN_LEFT);
    ArenaCanvas_Text(&gArenaTopCanvas, x + TEXT_RIGHT, BOX_Y + 3, levelText, ARENA_FONT_SMALL, UI_GOLD, 0, ARENA_ALIGN_RIGHT);
    ArenaCanvas_Text(&gArenaTopCanvas, x + TEXT_LEFT, BOX_Y + 12, sText_Hp, ARENA_FONT_SMALL, UI_ORANGE, 0, ARENA_ALIGN_LEFT);
    DrawHp(side, TRUE);
}

static void DrawStatus(u8 side)
{
    s32 x = sBoxX[side];
    const u8 *status;
    u16 statusColor;
    u8 color = side == B_SIDE_PLAYER ? UI_STATUS_PLAYER : UI_STATUS_FOE;

    if (!gArenaScreen.mons[side].shown)
        return;
    status = StatusText(GetMonData(Arena_PartyOf(side), MON_DATA_STATUS), &statusColor);
    if (status == NULL)
        return;
    ArenaScreen_SetBgColor(ARENA_PAL_UI, color, statusColor);
    ArenaCanvas_Box(&gArenaTopCanvas, x + 4, STATUS_Y, Arena_TextWidth(status, ARENA_FONT_SMALL) + 5, 11, color, UI_BLACK);
    ArenaCanvas_Text(&gArenaTopCanvas, x + 7, STATUS_Y + 2, status, ARENA_FONT_SMALL, UI_WHITE, UI_SHADOW, ARENA_ALIGN_LEFT);
}

static void DrawBannerRow(void)
{
    u8 side = gArenaScreen.banner.side;
    s32 x = gArenaMonCenterX[side];
    s32 w;

    ArenaCanvas_Fill(&gArenaTopCanvas, 0, BOX_Y + BOX_H + 1, DISPLAY_WIDTH, ARENA_INFO_BOTTOM - BOX_Y - BOX_H - 1, 0);
    DrawStatus(B_SIDE_PLAYER);
    DrawStatus(B_SIDE_OPPONENT);
    if (gArenaScreen.banner.frames == 0)
        return;
    w = Arena_TextWidth(gMoveNames[gArenaScreen.banner.move], ARENA_FONT_SMALL) + 10;
    ArenaScreen_SetBgColor(ARENA_PAL_UI, UI_BANNER, Arena_TypeColor(gBattleMoves[gArenaScreen.banner.move].type));
    ArenaCanvas_Box(&gArenaTopCanvas, x - w / 2, BANNER_Y, w, 12, UI_BANNER, UI_WHITE);
    ArenaCanvas_Text(&gArenaTopCanvas, x, BANNER_Y + 3, gMoveNames[gArenaScreen.banner.move], ARENA_FONT_SMALL, UI_WHITE, UI_SHADOW, ARENA_ALIGN_CENTER);
}

void ArenaHud_ShowBanner(u8 side, u16 move)
{
    gArenaScreen.banner.side = side;
    gArenaScreen.banner.move = move;
    gArenaScreen.banner.frames = Arena_Frames(48);
    gArenaScreen.dirty |= ARENA_DIRTY_BANNER;
}

static u16 NextTopPart(u32 *cost)
{
    u16 dirty = gArenaScreen.dirty;
    u32 side;

    for (side = 0; side < ARENA_SIDES; side++)
    {
        if (dirty & ARENA_DIRTY_INFO(side))
        {
            *cost = 80;
            return ARENA_DIRTY_INFO(side);
        }
        if (dirty & ARENA_DIRTY_HP(side))
        {
            *cost = 25;
            return ARENA_DIRTY_HP(side);
        }
    }
    *cost = dirty & ARENA_DIRTY_BANNER ? 50 : 0;
    return dirty & ARENA_DIRTY_BANNER;
}

u32 ArenaHud_TopCost(void)
{
    u32 cost;

    NextTopPart(&cost);
    return cost;
}

// One part at a time, while the next part still ends before the scan comes back.
void ArenaHud_DrawTop(void)
{
    u32 cost, side;
    u16 part;

    do
    {
        part = NextTopPart(&cost);
        for (side = 0; side < ARENA_SIDES; side++)
        {
            if (part == ARENA_DIRTY_INFO(side))
            {
                DrawInfoBox(side);
                gArenaScreen.dirty = (gArenaScreen.dirty & ~ARENA_DIRTY_HP(side)) | ARENA_DIRTY_BANNER;
            }
            else if (part == ARENA_DIRTY_HP(side))
            {
                DrawHp(side, FALSE);
            }
        }
        if (part == ARENA_DIRTY_BANNER)
            DrawBannerRow();
        gArenaScreen.dirty &= ~part;
        NextTopPart(&cost);
    } while (cost != 0 && ArenaRaster_EndsInTime(cost) && REG_VCOUNT + cost <= ARENA_SCAN_LINES);
}

static u8 TeamCount(u8 side)
{
    return side == B_SIDE_PLAYER ? CalculatePlayerPartyCount() : CalculateEnemyPartyCount();
}

static void ComputeTeamLayout(void)
{
    struct ArenaTeam *team = &gArenaScreen.team;
    s32 gaps, room;

    team->counts[B_SIDE_PLAYER] = TeamCount(B_SIDE_PLAYER);
    team->counts[B_SIDE_OPPONENT] = TeamCount(B_SIDE_OPPONENT);
    gaps = team->counts[B_SIDE_PLAYER] + team->counts[B_SIDE_OPPONENT] - 2;
    room = DISPLAY_WIDTH - 2 * TEAM_MARGIN - 2 * TEAM_GAP - BUTTONS_W - 2 * ICON_W;
    team->iconPitch = gaps <= 0 ? MAX_ICON_PITCH : max(MIN_ICON_PITCH, min(MAX_ICON_PITCH, room / gaps));
}

static s32 TeamWidth(u8 side)
{
    u8 count = gArenaScreen.team.counts[side];

    return count == 0 ? 0 : (count - 1) * gArenaScreen.team.iconPitch + ICON_W;
}

static s32 IconX(u8 side, u8 slot)
{
    if (side == B_SIDE_PLAYER)
        return TEAM_MARGIN + slot * gArenaScreen.team.iconPitch;
    return DISPLAY_WIDTH - TEAM_MARGIN - ICON_W - (gArenaScreen.team.counts[side] - 1 - slot) * gArenaScreen.team.iconPitch;
}

static s32 MiddleLeft(void)
{
    return TEAM_MARGIN + TeamWidth(B_SIDE_PLAYER) + TEAM_GAP;
}

static s32 MiddleRight(void)
{
    return DISPLAY_WIDTH - TEAM_MARGIN - TeamWidth(B_SIDE_OPPONENT) - TEAM_GAP;
}

static s32 MiddleBoxX(s32 w)
{
    return max(MiddleLeft(), min(MiddleRight() - w, (DISPLAY_WIDTH - w) / 2));
}

static bool8 IsActiveSlot(u8 side, u8 slot)
{
    return gArenaScreen.mons[side].shown && gArenaScreen.mons[side].partyIndex == slot;
}

static void DrawMiniBar(s32 x, u32 hp, u32 maxHp)
{
    s32 w = min(ICON_W, gArenaScreen.team.iconPitch - 2);

    x += (ICON_W - w) / 2;
    ArenaCanvas_Fill(&gArenaBottomCanvas, x, ARENA_TEAM_Y + 16, w, 2, UI_BLACK);
    ArenaCanvas_Fill(&gArenaBottomCanvas, x, ARENA_TEAM_Y + 16, BarX(hp, maxHp, w), 2, HpColor(hp, maxHp));
}

static void DrawIconFrame(s32 x, s32 inset, u8 color)
{
    s32 w = min(ICON_W + 2, gArenaScreen.team.iconPitch + 1) + 2 * inset;
    s32 left = x + ICON_W / 2 - w / 2;

    ArenaCanvas_Fill(&gArenaBottomCanvas, left, ARENA_TEAM_Y - 1 - inset, w, 1, color);
    ArenaCanvas_Fill(&gArenaBottomCanvas, left, ARENA_TEAM_Y + 18 + inset, w, 1, color);
    ArenaCanvas_Fill(&gArenaBottomCanvas, left, ARENA_TEAM_Y - inset, 1, 18 + 2 * inset, color);
    ArenaCanvas_Fill(&gArenaBottomCanvas, left + w - 1, ARENA_TEAM_Y - inset, 1, 18 + 2 * inset, color);
}

static void DrawTeamSide(u8 side)
{
    struct Pokemon *party = Arena_Party(side);
    u8 slot;

    for (slot = 0; slot < gArenaScreen.team.counts[side]; slot++)
    {
        s32 x = IconX(side, slot);
        u32 hp = GetMonData(&party[slot], MON_DATA_HP);
        u32 maxHp = GetMonData(&party[slot], MON_DATA_MAX_HP);
        bool8 known = side == B_SIDE_PLAYER || gArenaScreen.team.foeSeen[slot];

        if (IsActiveSlot(side, slot))
        {
            hp = gArenaScreen.mons[side].hp;
            DrawIconFrame(x, 0, UI_GOLD);
        }
        if (side == B_SIDE_PLAYER && gArenaScreen.panel.kind != ARENA_PANEL_MESSAGE && gArenaScreen.panel.kind != ARENA_PANEL_EMPTY
         && gArenaScreen.panel.cursor == ARENA_CURSOR_ICON + slot)
            DrawIconFrame(x, 1, UI_WHITE);
        if (!known)
            ArenaCanvas_PixMap(&gArenaBottomCanvas, x + 4, ARENA_TEAM_Y + 5, gArenaBallPixels, ARRAY_COUNT(gArenaBallPixels), gArenaBallLegend, sBallColors);
        else
            DrawMiniBar(x, hp, maxHp);
    }
}

static void DrawTeamBars(void)
{
    u32 side;

    for (side = 0; side < ARENA_SIDES; side++)
    {
        struct ArenaMon *mon = &gArenaScreen.mons[side];

        if (mon->shown && (side == B_SIDE_PLAYER || gArenaScreen.team.foeSeen[mon->partyIndex]))
            DrawMiniBar(IconX(side, mon->partyIndex), mon->hp, GetMonData(Arena_PartyOf(side), MON_DATA_MAX_HP));
    }
}

static u8 BadgeBorderColor(void)
{
    return (gArenaScreen.time / 30) % 2 ? UI_GOLD : UI_ORANGE;
}

static u8 BadgeState(void)
{
    if (!Arena_AutoPlays())
        return 0;
    return 1 + gSaveBlock2Ptr->arenaSettings.strategy * ARENA_SPEED_COUNT + gSaveBlock2Ptr->arenaSettings.speed;
}

static void GetBadgeBox(struct BadgeBox *box, u8 *text)
{
    Arena_FormatAutoMode(StringCopy(text, sText_AutoBadge));
    box->w = min(BADGE_MAX_W, MiddleRight() - MiddleLeft());
    box->x = MiddleBoxX(box->w);
    box->twoLines = !Arena_TextFits(text, ARENA_FONT_SMALL, box->w - BADGE_PAD);
    box->y = box->twoLines ? BADGE_TALL_Y : BADGE_Y;
    box->h = box->twoLines ? BADGE_TALL_H : BADGE_H;
}

static void DrawBadgeBorder(void)
{
    struct BadgeBox box;
    u8 text[32];

    GetBadgeBox(&box, text);
    ArenaCanvas_Frame(&gArenaBottomCanvas, box.x, box.y, box.w, box.h, BadgeBorderColor());
}

static void DrawBadge(void)
{
    struct BadgeBox box;
    u8 text[32];
    s32 center;

    GetBadgeBox(&box, text);
    center = box.x + box.w / 2;
    ArenaCanvas_Box(&gArenaBottomCanvas, box.x, box.y, box.w, box.h, UI_BOX, BadgeBorderColor());
    if (!box.twoLines)
    {
        ArenaCanvas_Text(&gArenaBottomCanvas, center, ARENA_TEAM_Y + 5, text, ARENA_FONT_SMALL, UI_GOLD, UI_SHADOW, ARENA_ALIGN_CENTER);
        return;
    }
    StringCopy(StringCopy(text, sText_AutoBadge), gArenaSpeedNames[gSaveBlock2Ptr->arenaSettings.speed]);
    ArenaCanvas_Text(&gArenaBottomCanvas, center, box.y + 3, text, ARENA_FONT_SMALL, UI_GOLD, UI_SHADOW, ARENA_ALIGN_CENTER);
    ArenaCanvas_Text(&gArenaBottomCanvas, center, box.y + 12, gArenaStrategyNames[gSaveBlock2Ptr->arenaSettings.strategy], ARENA_FONT_SMALL,
                     UI_GOLD, UI_SHADOW, ARENA_ALIGN_CENTER);
}

static void DrawButtons(void)
{
    s32 x = MiddleBoxX(BUTTONS_W);
    u32 i;

    if (Arena_AutoPlays())
    {
        DrawBadge();
        return;
    }
    for (i = 0; i < ARRAY_COUNT(sButtonTexts); i++)
    {
        bool8 selected = gArenaScreen.panel.kind == ARENA_PANEL_CARDS && gArenaScreen.panel.cursor == ARENA_CURSOR_BAG + i;

        ArenaCanvas_Box(&gArenaBottomCanvas, x, ARENA_TEAM_Y + 2, sButtonW[i], 13, selected ? UI_BAR_BG : UI_BOX, selected ? UI_WHITE : UI_GREY);
        ArenaCanvas_Text(&gArenaBottomCanvas, x + sButtonW[i] / 2, ARENA_TEAM_Y + 5, sButtonTexts[i], ARENA_FONT_SMALL,
                         selected ? UI_WHITE : UI_GREY, 0, ARENA_ALIGN_CENTER);
        x += sButtonW[i] + BUTTON_GAP;
    }
}

static void DrawTeamRow(void)
{
    ArenaCanvas_Fill(&gArenaBottomCanvas, 0, ARENA_TEAM_TOP, DISPLAY_WIDTH, ARENA_FIELD_BOTTOM - ARENA_TEAM_TOP, 0);
    DrawTeamSide(B_SIDE_PLAYER);
    DrawTeamSide(B_SIDE_OPPONENT);
    DrawButtons();
    gArenaScreen.team.badgeShown = BadgeState();
}

#define TEAM_DIRTY (ARENA_DIRTY_TEAM | ARENA_DIRTY_TEAM_HP | ARENA_DIRTY_BADGE)

u32 ArenaHud_TeamCost(void)
{
    if (gArenaScreen.dirty & ARENA_DIRTY_TEAM)
        return 100;
    return gArenaScreen.dirty & TEAM_DIRTY ? 15 : 0;
}

void ArenaHud_DrawTeam(void)
{
    u16 dirty = gArenaScreen.dirty;

    if (dirty & ARENA_DIRTY_TEAM)
    {
        DrawTeamRow();
    }
    else
    {
        if (dirty & ARENA_DIRTY_TEAM_HP)
            DrawTeamBars();
        if (dirty & ARENA_DIRTY_BADGE)
            DrawBadgeBorder();
    }
    gArenaScreen.dirty &= ~TEAM_DIRTY;
}

void ArenaHud_LoadIconPalettes(void)
{
    u16 colors[16];
    u32 i, c;

    for (i = 0; i < ICON_PALETTES; i++)
    {
        struct SpritePalette palette = {colors, ARENA_TAG_GREY_ICON_PAL + i};

        for (c = 0; c < 16; c++)
        {
            u16 color = gMonIconPaletteTable[i].data[c];
            u16 grey = (GET_R(color) + GET_G(color) + GET_B(color)) / 6 + 3;

            colors[c] = RGB(grey, grey, grey);
        }
        LoadSpritePalette(&gMonIconPaletteTable[i]);
        LoadSpritePalette(&palette);
    }
}

static u32 PixelOffset4bpp(s32 x, s32 y, s32 tilesAcross)
{
    return ((y / 8) * tilesAcross + x / 8) * TILE_SIZE_4BPP + (y % 8) * 4 + (x % 8) / 2;
}

static u8 IconPixel(const u8 *icon, s32 x, s32 y)
{
    u8 byte = icon[PixelOffset4bpp(x, y, ICON_SOURCE_TILES)];

    return x & 1 ? byte >> 4 : byte & 0xF;
}

static u8 BlockColor(const u8 *icon, s32 x, s32 y)
{
    u8 colors[4];
    u8 best = 0;
    s32 i, j, count, bestCount = 0;

    for (i = 0; i < 4; i++)
        colors[i] = IconPixel(icon, x * 2 + (i & 1), y * 2 + (i >> 1));
    for (i = 0; i < 4; i++)
    {
        if (colors[i] == 0)
            continue;
        for (j = 0, count = 0; j < 4; j++)
            count += colors[j] == colors[i];
        if (count > bestCount || (count == bestCount && best == ICON_OUTLINE))
        {
            best = colors[i];
            bestCount = count;
        }
    }
    return best;
}

static bool32 IsShapeEdge(u8 colors[ICON_W][ICON_W], s32 x, s32 y)
{
    if (x == 0 || y == 0 || x == ICON_W - 1 || y == ICON_W - 1)
        return TRUE;
    return colors[y][x - 1] == 0 || colors[y][x + 1] == 0 || colors[y - 1][x] == 0 || colors[y + 1][x] == 0;
}

static void LoadMiniIcon(u8 side, u8 slot, u16 species, u32 personality)
{
    const u8 *icon = GetMonIconPtr(species, personality, FALSE);
    u8 tiles[4 * TILE_SIZE_4BPP];
    u8 colors[ICON_W][ICON_W];
    struct SpriteSheet sheet = {tiles, sizeof(tiles), ARENA_TAG_ICON(side, slot)};
    s32 x, y;

    for (y = 0; y < ICON_W; y++)
    {
        for (x = 0; x < ICON_W; x++)
            colors[y][x] = BlockColor(icon, x, y);
    }
    memset(tiles, 0, sizeof(tiles));
    for (y = 0; y < ICON_W; y++)
    {
        for (x = 0; x < ICON_W; x++)
        {
            u8 color = colors[y][x];

            if (color != 0 && IsShapeEdge(colors, x, y))
                color = ICON_OUTLINE;
            tiles[PixelOffset4bpp(x, y, ICON_TILES)] |= x & 1 ? color << 4 : color;
        }
    }
    FreeSpriteTilesByTag(ARENA_TAG_ICON(side, slot));
    LoadSpriteSheet(&sheet);
}

void ArenaHud_UpdateIcons(void)
{
    u8 side, slot;

    ComputeTeamLayout();
    for (side = 0; side < ARENA_SIDES; side++)
    {
        struct Pokemon *party = Arena_Party(side);
        u8 count = gArenaScreen.team.counts[side];

        for (slot = 0; slot < PARTY_SIZE; slot++)
        {
            u8 *spriteId = &gArenaScreen.team.iconSpriteIds[side][slot];
            u16 species = GetMonData(&party[slot], MON_DATA_SPECIES);
            bool8 visible = slot < count && (side == B_SIDE_PLAYER || gArenaScreen.team.foeSeen[slot]);

            if (!visible)
            {
                if (*spriteId != ARENA_NO_SPRITE)
                    gSprites[*spriteId].invisible = TRUE;
                continue;
            }
            if (*spriteId == ARENA_NO_SPRITE)
            {
                struct SpriteTemplate template = {ARENA_TAG_ICON(side, slot), gMonIconPaletteTable[gMonIconPaletteIndices[species]].tag,
                                                  &sOamIcon, gDummySpriteAnimTable, NULL, gDummySpriteAffineAnimTable, SpriteCallbackDummy};

                LoadMiniIcon(side, slot, species, GetMonData(&party[slot], MON_DATA_PERSONALITY));
                *spriteId = CreateSprite(&template, IconX(side, slot) + 8, ARENA_TEAM_Y + 8, 2);
            }
            gSprites[*spriteId].invisible = FALSE;
            gSprites[*spriteId].x = IconX(side, slot) + 8;
            gSprites[*spriteId].oam.paletteNum = IndexOfSpritePaletteTag(GetMonData(&party[slot], MON_DATA_HP) == 0
                ? ARENA_TAG_GREY_ICON_PAL + gMonIconPaletteIndices[species]
                : gMonIconPaletteTable[gMonIconPaletteIndices[species]].tag);
        }
    }
    gArenaScreen.dirty |= ARENA_DIRTY_TEAM;
}

void ArenaHud_Update(void)
{
    if (gArenaScreen.panel.kind == ARENA_PANEL_CARDS && gArenaScreen.time % 14 == 0)
        gArenaScreen.dirty |= ARENA_DIRTY_HP(B_SIDE_OPPONENT);
    if (BadgeState() != gArenaScreen.team.badgeShown)
        gArenaScreen.dirty |= ARENA_DIRTY_TEAM;
    else if (Arena_AutoPlays() && gArenaScreen.time % 30 == 0)
        gArenaScreen.dirty |= ARENA_DIRTY_BADGE;
    if (gArenaScreen.banner.frames != 0 && --gArenaScreen.banner.frames == 0)
        gArenaScreen.dirty |= ARENA_DIRTY_BANNER;
}
