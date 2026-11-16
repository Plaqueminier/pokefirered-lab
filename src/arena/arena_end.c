#include "global.h"
#include "arena_internal.h"
#include "battle.h"
#include "battle_anim.h"
#include "characters.h"
#include "battle_main.h"
#include "bg.h"
#include "data.h"
#include "decompress.h"
#include "gpu_regs.h"
#include "m4a.h"
#include "main.h"
#include "malloc.h"
#include "money.h"
#include "palette.h"
#include "pokemon.h"
#include "scanline_effect.h"
#include "sound.h"
#include "sprite.h"
#include "string_util.h"
#include "task.h"
#include "constants/songs.h"

static struct ArenaMonRecord *RecordOf(u8 partyIndex)
{
    u32 personality = GetMonData(&gPlayerParty[partyIndex], MON_DATA_PERSONALITY);
    u32 i;

    for (i = 0; i < PARTY_SIZE; i++)
    {
        if (gArenaBattle.record.mons[i].personality == personality)
            return &gArenaBattle.record.mons[i];
    }
    return NULL;
}

void ArenaRecord_Start(void)
{
    struct ArenaRecord *record = &gArenaBattle.record;
    u32 i, stat;

    for (i = 0; i < PARTY_SIZE; i++)
    {
        struct Pokemon *mon = &gPlayerParty[i];

        record->mons[i].personality = GetMonData(mon, MON_DATA_PERSONALITY);
        record->mons[i].expStart = GetMonData(mon, MON_DATA_EXP);
        record->mons[i].levelStart = GetMonData(mon, MON_DATA_LEVEL);
        for (stat = 0; stat < NUM_STATS; stat++)
            record->mons[i].statsStart[stat] = GetMonData(mon, MON_DATA_MAX_HP + stat);
    }
    record->moneyStart = GetMoney(&gSaveBlock1Ptr->money);
    record->frameStart = gMain.vblankCounter2;
}

void ArenaRecord_OnDamage(u8 targetBattler, s32 damage)
{
    struct ArenaMonRecord *record;

    if (damage <= 0)
        return;
    if (GetBattlerSide(targetBattler) == B_SIDE_PLAYER)
    {
        record = RecordOf(gBattlerPartyIndexes[targetBattler]);
        if (record != NULL)
            record->damageTaken = min(record->damageTaken + damage, 0xFFFF);
    }
    else if (GetBattlerSide(gBattlerAttacker) == B_SIDE_PLAYER)
    {
        record = RecordOf(gBattlerPartyIndexes[gBattlerAttacker]);
        if (record != NULL)
            record->damageDealt = min(record->damageDealt + damage, 0xFFFF);
    }
}

static struct ArenaMonRecord *PlayerRecordOf(u8 battler)
{
    return GetBattlerSide(battler) == B_SIDE_PLAYER ? RecordOf(gBattlerPartyIndexes[battler]) : NULL;
}

static void CountUp(u8 *count)
{
    if (*count < 0xFF)
        (*count)++;
}

void ArenaRecord_OnMove(u8 battler)
{
    struct ArenaMonRecord *record = PlayerRecordOf(battler);

    if (record != NULL)
        CountUp(&record->movesUsed);
}

// The engine plays no move animation for a miss, so OnMove does not count it.
void ArenaRecord_OnMiss(u8 battler)
{
    struct ArenaMonRecord *record = PlayerRecordOf(battler);

    if (record == NULL)
        return;
    CountUp(&record->movesUsed);
    CountUp(&record->misses);
}

void ArenaRecord_OnFaint(u8 battler)
{
    struct ArenaMonRecord *record;

    if (GetBattlerSide(battler) == B_SIDE_PLAYER)
        return;
    record = PlayerRecordOf(GetBattlerAtPosition(B_POSITION_PLAYER_LEFT));
    if (record != NULL)
        CountUp(&record->knockOuts);
}

#define END_TILES 600
#define CARD_Y 26
#define CARD_H 124
#define GAINS_TWO_COLUMNS_W 64
#define GAINS_ROWS 3
#define SPARKLE_EVERY 3
#define PROMPT_Y 152
#define FLIP_START 12
#define FLIP_STEP 14
#define FLIP_FRAMES 12
#define EXP_START 50
#define EXP_FRAMES 70
#define AUTO_EXIT_FRAMES 90
#define MONEY_START 30
#define MONEY_FRAMES 60

enum
{
    END_BG = 1,
    END_BG_STRIPE,
    END_CARD,
    END_BORDER,
    END_GOLD,
    END_RED,
    END_WHITE,
    END_GREY,
    END_DARK,
    END_PURPLE,
    END_GREEN,
    END_LIGHT,
    END_TYPE,
    END_SHADOW,
    END_ORANGE,
};

static const u16 sEndPalette[16] =
{
    [END_BG] = ARENA_RGB(0x0e, 0x14, 0x24),
    [END_BG_STRIPE] = ARENA_RGB(0x12, 0x1a, 0x2e),
    [END_CARD] = ARENA_RGB(0x1a, 0x22, 0x36),
    [END_BORDER] = ARENA_RGB(0x3a, 0x44, 0x60),
    [END_GOLD] = ARENA_RGB(0xf8, 0xd0, 0x48),
    [END_RED] = ARENA_RGB(0xff, 0x6a, 0x5a),
    [END_WHITE] = ARENA_RGB(0xff, 0xff, 0xff),
    [END_GREY] = ARENA_RGB(0x88, 0x90, 0xa8),
    [END_DARK] = ARENA_RGB(0x0c, 0x10, 0x20),
    [END_PURPLE] = ARENA_RGB(0x90, 0x68, 0xe8),
    [END_GREEN] = ARENA_RGB(0xb8, 0xf0, 0xa0),
    [END_LIGHT] = ARENA_RGB(0xc0, 0xc4, 0xd0),
    [END_SHADOW] = ARENA_RGB(0x00, 0x00, 0x00),
    [END_ORANGE] = ARENA_RGB(0xb0, 0x78, 0x18),
};

static const struct ArenaCanvas sEndCanvas = {(u16 *)(VRAM + 0x20), 0, DISPLAY_HEIGHT, 30};

static const struct BgTemplate sEndBgTemplates[] =
{
    {.bg = 0, .charBaseIndex = 0, .mapBaseIndex = 31, .screenSize = 0, .paletteMode = 0, .priority = 1, .baseTile = 0},
};

// The cards only shrink the sprite. A double-size sprite costs twice the sprite time of a scanline, and the GBA
// skips the sprites after this time: six double-size cards on the same lines are too many.
static const struct OamData sOamEndMon =
{
    .affineMode = ST_OAM_AFFINE_NORMAL,
    .shape = SPRITE_SHAPE(64x64),
    .size = SPRITE_SIZE(64x64),
    .priority = 0,
};

static const u8 sText_Victory[] = _("VICTORY!");
static const u8 sText_Defeat[] = _("DEFEAT");
static const u8 sText_Caught[] = _("CAUGHT!");
static const u8 sText_GotAway[] = _("GOT AWAY");
static const u8 sText_Vs[] = _("vs ");
static const u8 sText_Turn[] = _(" TURN · ");
static const u8 sText_Turns[] = _(" TURNS · ");
static const u8 sText_Dot[] = _(" · ");
static const u8 sText_Colon[] = _(":");
static const u8 sText_Ko[] = _("K.O.");
static const u8 sText_Lv[] = _("Lv");
static const u8 sText_LvArrow[] = _("▶");
static const u8 sText_PlusExp[] = _(" EXP");
static const u8 sText_PressA[] = _("PRESS A");
static const u8 sText_Plus[] = _("+");
static const u8 sText_Minus[] = _("-");
static const u8 sText_Yen[] = _("¥");

static const u8 sText_KoRow[] = _("KO");
static const u8 sText_DmgRow[] = _("DMG");
static const u8 sText_TakenRow[] = _("TAKEN");
static const u8 sText_TakenShort[] = _("TKN");
static const u8 sText_MovesRow[] = _("MOVES");
static const u8 sText_MovesShort[] = _("MV");
static const u8 sText_MissesRow[] = _("MISSES");
static const u8 sText_MissesShort[] = _("MISS");
static const u8 sText_StatHp[] = _("HP");
static const u8 sText_StatAtk[] = _("ATK");
static const u8 sText_StatDef[] = _("DEF");
static const u8 sText_StatSpe[] = _("SPE");
static const u8 sText_StatSpa[] = _("SPA");
static const u8 sText_StatSpd[] = _("SPD");

// The same order as MON_DATA_MAX_HP and the stats after it.
static const u8 *const sStatNames[NUM_STATS] = {sText_StatHp, sText_StatAtk, sText_StatDef, sText_StatSpe, sText_StatSpa, sText_StatSpd};

static const u8 sCoin[7][8] = {".ooooo.", "oyyyyyo", "oyhyyyo", "oyyyyyo", "oyyyyyo", "oyyyyyo", ".ooooo."};
static const u8 sCrown[5][8] = {"y..y..y", "yy.y.yy", "yyyyyyy", "yryyyby", "ooooooo"};
static const u8 sPixLegend[] = "oyhrb";
static const u8 sPixColors[] = {END_ORANGE, END_GOLD, END_WHITE, END_RED, END_PURPLE};

struct EndCard
{
    struct ArenaMonRecord *record;
    u8 partyIndex;
    u8 spriteId;
    u8 levelEnd;
    bool8 fainted;
    u8 stage;
    bool8 glowShown;
    u16 shownProgress;
    u32 expEnd;
};

enum
{
    CARD_HIDDEN,
    CARD_FLIPPING,
    CARD_SHOWN,
    CARD_GAINS,
};

// The Harness reads END_SHOWN (lab/src/battle.ts).
enum
{
    END_FADE_FROM_BATTLE,
    END_INIT,
    END_SHOWN,
    END_LEAVE,
};

struct EndScreen
{
    void (*returnMainFunc)(void);
    struct EndCard cards[PARTY_SIZE];
    u8 count;
    u8 mvp;
    u8 state;
    u16 time;
    bool8 fanfarePlayed;
    bool8 expSound;
    bool8 headerDrawn;
    bool8 promptShown;
    s32 money;
    s32 shownMoney;
};

// The Harness reads this name (lab/src/battle.ts).
static EWRAM_DATA struct EndScreen *sEndScreen = NULL;

static s32 CardWidth(void)
{
    return min(72, (232 - (sEndScreen->count - 1) * 4) / sEndScreen->count);
}

static s32 CardX(u32 i)
{
    s32 w = CardWidth();

    return DISPLAY_WIDTH / 2 - (sEndScreen->count * w + (sEndScreen->count - 1) * 4) / 2 + i * (w + 4);
}

static u32 ExpOfLevel(u16 species, u8 level)
{
    return gExperienceTables[gSpeciesInfo[species].growthRate][level];
}

static void DrawExpBar(struct EndCard *card, s32 x, s32 y, s32 w, u32 progress256)
{
    struct Pokemon *mon = &gPlayerParty[card->partyIndex];
    u16 species = GetMonData(mon, MON_DATA_SPECIES);
    u32 gained = card->expEnd - card->record->expStart;
    u32 exp = card->record->expStart + gained * progress256 / 256;
    u8 level = card->record->levelStart;
    s32 barW = w - 10, startX = 0, nowX;
    u32 low, high;

    while (level < MAX_LEVEL && exp >= ExpOfLevel(species, level + 1))
        level++;
    low = ExpOfLevel(species, level);
    high = level < MAX_LEVEL ? ExpOfLevel(species, level + 1) : low + 1;
    nowX = barW * (exp - low) / max(1, high - low);
    if (level == card->record->levelStart)
        startX = barW * (card->record->expStart - low) / max(1, high - low);
    ArenaCanvas_Fill(&sEndCanvas, x + 4, y, w - 8, 4, END_DARK);
    ArenaCanvas_Fill(&sEndCanvas, x + 5, y + 1, startX, 2, END_PURPLE);
    ArenaCanvas_Fill(&sEndCanvas, x + 5 + startX, y + 1, max(0, nowX - startX), 2, END_GREEN);
    if (level == card->record->levelStart)
        ArenaCanvas_Fill(&sEndCanvas, x + 5 + startX, y, 1, 4, END_WHITE);
}

static void FitText(u8 *text, s32 width)
{
    u32 length = StringLength(text);

    while (length > 1 && (s32)Arena_TextWidth(text, ARENA_FONT_SMALL) > width)
        text[--length] = EOS;
}

static void DrawRow(s32 x, s32 y, s32 w, const u8 *label, s32 value, u8 color, bool8 plus)
{
    u8 text[8];
    u8 *end = text;

    if (plus)
        end = StringCopy(text, sText_Plus);
    ConvertIntToDecimalStringN(end, value, STR_CONV_MODE_LEFT_ALIGN, 5);
    ArenaCanvas_Text(&sEndCanvas, x + 4, y, label, ARENA_FONT_SMALL, END_GREY, 0, ARENA_ALIGN_LEFT);
    ArenaCanvas_Text(&sEndCanvas, x + w - 4, y, text, ARENA_FONT_SMALL, color, 0, ARENA_ALIGN_RIGHT);
}

static void DrawCardFace(u32 i)
{
    struct EndCard *card = &sEndScreen->cards[i];
    struct Pokemon *mon = &gPlayerParty[card->partyIndex];
    s32 w = CardWidth(), x = CardX(i), y = CARD_Y;
    bool8 leveled = card->levelEnd > card->record->levelStart;
    u8 text[24];
    u8 *end;

    ArenaCanvas_Box(&sEndCanvas, x, y, w, CARD_H, END_CARD, END_BORDER);
    ArenaCanvas_Fill(&sEndCanvas, x + 1, y + 1, w - 2, 11, END_TYPE);
    GetMonData(mon, MON_DATA_NICKNAME, text);
    StringGet_Nickname(text);
    FitText(text, w - 4);
    ArenaCanvas_Text(&sEndCanvas, x + w / 2, y + 3, text, ARENA_FONT_SMALL, END_WHITE, END_SHADOW, ARENA_ALIGN_CENTER);
    if (i == sEndScreen->mvp)
        ArenaCanvas_PixMap(&sEndCanvas, x + w - 9, y - 3, sCrown, ARRAY_COUNT(sCrown), sPixLegend, sPixColors);
    if (card->fainted)
        ArenaCanvas_Text(&sEndCanvas, x + w / 2, y + 30, sText_Ko, ARENA_FONT_SMALL, END_RED, END_SHADOW, ARENA_ALIGN_CENTER);
    end = StringCopy(text, sText_Lv);
    end = ConvertIntToDecimalStringN(end, card->record->levelStart, STR_CONV_MODE_LEFT_ALIGN, 3);
    if (leveled)
    {
        end = StringCopy(end, sText_LvArrow);
        ConvertIntToDecimalStringN(end, card->levelEnd, STR_CONV_MODE_LEFT_ALIGN, 3);
    }
    ArenaCanvas_Text(&sEndCanvas, x + w / 2, y + 55, text, ARENA_FONT_SMALL, leveled ? END_GOLD : END_LIGHT, 0, ARENA_ALIGN_CENTER);
    ArenaCanvas_Fill(&sEndCanvas, x + 4, y + 81, w - 8, 1, END_BORDER);
    DrawRow(x, y + 84, w, sText_KoRow, card->record->knockOuts, END_WHITE, FALSE);
    DrawRow(x, y + 92, w, sText_DmgRow, card->record->damageDealt, END_WHITE, FALSE);
    DrawRow(x, y + 100, w, w < 50 ? sText_TakenShort : sText_TakenRow, card->record->damageTaken, END_WHITE, FALSE);
    DrawRow(x, y + 108, w, w < 50 ? sText_MovesShort : sText_MovesRow, card->record->movesUsed, END_WHITE, FALSE);
    DrawRow(x, y + 116, w, w < 50 ? sText_MissesShort : sText_MissesRow, card->record->misses, END_WHITE, FALSE);
}

static void DrawCardExp(u32 i, u32 progress)
{
    struct EndCard *card = &sEndScreen->cards[i];
    s32 w = CardWidth(), x = CardX(i), y = CARD_Y;
    u8 text[24];
    u8 *end;

    DrawExpBar(card, x, y + 65, w, progress);
    end = StringCopy(text, sText_Plus);
    end = ConvertIntToDecimalStringN(end, (card->expEnd - card->record->expStart) * progress / 256, STR_CONV_MODE_LEFT_ALIGN, 6);
    StringCopy(end, sText_PlusExp);
    FitText(text, w - 2);
    ArenaCanvas_Fill(&sEndCanvas, x + 1, y + 70, w - 2, 10, END_CARD);
    ArenaCanvas_Text(&sEndCanvas, x + w / 2, y + 71, text, ARENA_FONT_SMALL, card->expEnd > card->record->expStart ? END_GREEN : END_GREY, 0, ARENA_ALIGN_CENTER);
}

static void DrawCardGains(u32 i)
{
    struct EndCard *card = &sEndScreen->cards[i];
    struct Pokemon *mon = &gPlayerParty[card->partyIndex];
    s32 w = CardWidth(), x = CardX(i), y = CARD_Y;
    bool32 twoColumns = w >= GAINS_TWO_COLUMNS_W;
    s32 columnW = twoColumns ? w / 2 + 2 : w;
    s32 top = twoColumns ? y + 84 : y + 76;
    s32 clear = twoColumns ? top - 1 : y + 70;
    s32 stat, shown = 0;

    ArenaCanvas_Fill(&sEndCanvas, x + 1, clear, w - 2, y + CARD_H - 1 - clear, END_CARD);
    for (stat = 0; stat < NUM_STATS; stat++)
    {
        s32 gain = (s32)GetMonData(mon, MON_DATA_MAX_HP + stat) - card->record->statsStart[stat];
        s32 column = twoColumns ? shown / GAINS_ROWS : 0;
        s32 row = twoColumns ? shown % GAINS_ROWS : shown;

        if (gain <= 0)
            continue;
        DrawRow(x + column * (w - columnW), top + 8 * row, columnW, sStatNames[stat], gain, END_GOLD, TRUE);
        shown++;
    }
}

static void UpdateCard(u32 i)
{
    struct EndCard *card = &sEndScreen->cards[i];
    s32 w = CardWidth(), x = CardX(i);
    s32 flip = (s32)sEndScreen->time - FLIP_START - (s32)i * FLIP_STEP;
    s32 expTime = (s32)sEndScreen->time - EXP_START - (s32)i * FLIP_STEP;
    u32 progress = expTime <= 0 ? 0 : min(256, expTime * 256 / EXP_FRAMES);
    bool8 leveled = card->levelEnd > card->record->levelStart;
    bool8 glow = leveled && progress >= 256 && (sEndScreen->time / 15) % 2;

    if (flip <= 0)
        return;
    if (flip < FLIP_FRAMES)
    {
        s32 shownW = max(2, w * flip / FLIP_FRAMES);

        ArenaCanvas_Fill(&sEndCanvas, x, CARD_Y, w, CARD_H, END_BG);
        ArenaCanvas_Box(&sEndCanvas, x + (w - shownW) / 2, CARD_Y, shownW, CARD_H, END_CARD, END_BORDER);
        gSprites[card->spriteId].invisible = FALSE;
        SetOamMatrix(gSprites[card->spriteId].oam.matrixNum, 0x180 * w / shownW, 0, 0, 0x180);
        card->stage = CARD_FLIPPING;
        return;
    }
    if (card->stage < CARD_SHOWN)
    {
        SetOamMatrix(gSprites[card->spriteId].oam.matrixNum, 0x180, 0, 0, 0x180);
        gSprites[card->spriteId].invisible = FALSE;
        DrawCardFace(i);
        DrawCardExp(i, progress);
        card->shownProgress = progress;
        card->stage = CARD_SHOWN;
    }
    if (progress != card->shownProgress)
    {
        DrawCardExp(i, progress);
        card->shownProgress = progress;
    }
    if (leveled && progress >= 256 && card->stage < CARD_GAINS)
    {
        DrawCardGains(i);
        card->stage = CARD_GAINS;
    }
    if (leveled && progress >= 256 && sEndScreen->time % SPARKLE_EVERY == 0)
        ArenaJuice_Sparkle(x, CARD_Y, w, CARD_H);
    if (glow != card->glowShown)
    {
        ArenaCanvas_Frame(&sEndCanvas, x, CARD_Y, w, CARD_H, glow ? END_GOLD : END_BORDER);
        gSprites[card->spriteId].y2 = glow ? -2 : 0;
        card->glowShown = glow;
    }
}

static const u8 *Title(void)
{
    switch (gBattleOutcome)
    {
    case B_OUTCOME_LOST:
    case B_OUTCOME_DREW:
        return sText_Defeat;
    case B_OUTCOME_CAUGHT:
        return sText_Caught;
    case B_OUTCOME_RAN:
    case B_OUTCOME_PLAYER_TELEPORTED:
    case B_OUTCOME_MON_FLED:
    case B_OUTCOME_MON_TELEPORTED:
        return sText_GotAway;
    default:
        return sText_Victory;
    }
}

static void DrawHeader(void)
{
    const u8 *title = Title();
    u8 text[48];
    u8 *end;
    u32 seconds = (u16)(gMain.vblankCounter2 - gArenaBattle.record.frameStart) / 60;
    u32 turns;

    ArenaCanvas_Text(&sEndCanvas, 6, 4, title, ARENA_FONT_BIG, title == sText_Defeat ? END_RED : END_GOLD, END_SHADOW, ARENA_ALIGN_LEFT);
    end = StringCopy(text, sText_Vs);
    if (gBattleTypeFlags & BATTLE_TYPE_TRAINER)
        end = StringCopy(end, gTrainers[gTrainerBattleOpponent_A].trainerName);
    else
        end = StringCopy(end, gSpeciesNames[GetMonData(&gEnemyParty[0], MON_DATA_SPECIES)]);
    end = StringCopy(end, sText_Dot);
    // The engine counts only the finished turns, and the battle ended in the next turn.
    turns = gBattleResults.battleTurnCounter + 1;
    end = ConvertIntToDecimalStringN(end, turns, STR_CONV_MODE_LEFT_ALIGN, 3);
    end = StringCopy(end, turns == 1 ? sText_Turn : sText_Turns);
    end = ConvertIntToDecimalStringN(end, seconds / 60, STR_CONV_MODE_LEFT_ALIGN, 2);
    end = StringCopy(end, sText_Colon);
    ConvertIntToDecimalStringN(end, seconds % 60, STR_CONV_MODE_LEADING_ZEROS, 2);
    ArenaCanvas_Text(&sEndCanvas, 6, 16, text, ARENA_FONT_SMALL, END_GREY, 0, ARENA_ALIGN_LEFT);
}

static void DrawMoney(s32 money)
{
    u8 text[16];
    u8 *end = StringCopy(text, money < 0 ? sText_Minus : sText_Plus);
    s32 width;

    end = StringCopy(end, sText_Yen);
    ConvertIntToDecimalStringN(end, abs(money), STR_CONV_MODE_LEFT_ALIGN, 7);
    width = Arena_TextWidth(text, ARENA_FONT_BIG);
    ArenaCanvas_Fill(&sEndCanvas, 130, 0, DISPLAY_WIDTH - 130, CARD_Y - 4, END_BG);
    ArenaCanvas_PixMap(&sEndCanvas, DISPLAY_WIDTH - 6 - width - 10, 7, sCoin, ARRAY_COUNT(sCoin), sPixLegend, sPixColors);
    ArenaCanvas_Text(&sEndCanvas, DISPLAY_WIDTH - 6, 4, text, ARENA_FONT_BIG, money < 0 ? END_RED : END_GOLD, END_SHADOW, ARENA_ALIGN_RIGHT);
}

static u16 AllShownTime(void)
{
    return EXP_START + (sEndScreen->count - 1) * FLIP_STEP + EXP_FRAMES;
}

static bool8 AllShown(void)
{
    return sEndScreen->time >= AllShownTime();
}

static void DrawEndScreen(void)
{
    s32 progress = sEndScreen->time < MONEY_START ? 0 : min(MONEY_FRAMES, sEndScreen->time - MONEY_START);
    s32 money = sEndScreen->money * progress / MONEY_FRAMES;
    bool8 prompt = AllShown() && (sEndScreen->time / 30) % 2;
    u32 i;

    if (!sEndScreen->headerDrawn)
    {
        DrawHeader();
        DrawMoney(0);
        sEndScreen->headerDrawn = TRUE;
    }
    if (money != sEndScreen->shownMoney)
    {
        DrawMoney(money);
        sEndScreen->shownMoney = money;
    }
    for (i = 0; i < sEndScreen->count; i++)
        UpdateCard(i);
    if (prompt != sEndScreen->promptShown)
    {
        ArenaCanvas_Fill(&sEndCanvas, 80, PROMPT_Y - 2, 80, DISPLAY_HEIGHT - PROMPT_Y + 2, END_BG);
        if (prompt)
            ArenaCanvas_Text(&sEndCanvas, DISPLAY_WIDTH / 2, PROMPT_Y, sText_PressA, ARENA_FONT_SMALL, END_WHITE, 0, ARENA_ALIGN_CENTER);
        sEndScreen->promptShown = prompt;
    }
}

static void PlayEndSounds(void)
{
    u32 i;
    s32 t = sEndScreen->time;

    for (i = 0; i < sEndScreen->count; i++)
    {
        struct EndCard *card = &sEndScreen->cards[i];
        s32 expTime = t - EXP_START - (s32)i * FLIP_STEP;

        if (t == FLIP_START + (s32)i * FLIP_STEP)
            PlaySE(SE_CARD_FLIP);
        if (expTime == 0 && card->expEnd > card->record->expStart && !sEndScreen->expSound)
        {
            PlaySE(SE_EXP);
            sEndScreen->expSound = TRUE;
        }
        if (expTime == EXP_FRAMES && card->levelEnd > card->record->levelStart && !sEndScreen->fanfarePlayed)
        {
            PlayFanfare(MUS_LEVEL_UP);
            sEndScreen->fanfarePlayed = TRUE;
        }
    }
    if (sEndScreen->expSound && AllShown())
    {
        m4aSongNumStop(SE_EXP);
        sEndScreen->expSound = FALSE;
    }
    if (t == MONEY_START + MONEY_FRAMES && sEndScreen->money != 0)
        PlaySE(SE_SHOP);
}

static void CreateCardSprites(void)
{
    u32 i;

    for (i = 0; i < sEndScreen->count; i++)
    {
        struct EndCard *card = &sEndScreen->cards[i];
        struct Pokemon *mon = &gPlayerParty[card->partyIndex];
        u16 species = GetMonData(mon, MON_DATA_SPECIES);
        struct SpriteSheet sheet = {gMonSpritesGfxPtr->sprites[0], MON_PIC_SIZE, ARENA_TAG_END_MON(i)};
        struct SpriteTemplate template = {ARENA_TAG_END_MON(i), TAG_NONE, &sOamEndMon, gDummySpriteAnimTable, NULL, gDummySpriteAffineAnimTable, SpriteCallbackDummy};

        LoadSpecialPokePic(&gMonFrontPicTable[species], gMonSpritesGfxPtr->sprites[0], species, GetMonData(mon, MON_DATA_PERSONALITY), TRUE);
        LoadSpriteSheet(&sheet);
        LoadCompressedPalette(GetMonFrontSpritePal(mon), OBJ_PLTT_ID(i), PLTT_SIZE_4BPP);
        if (card->fainted)
            BlendPalettesUnfaded(1 << (16 + i), 10, RGB(8, 8, 10));
        card->spriteId = CreateSprite(&template, CardX(i) + CardWidth() / 2, CARD_Y + 13 + 21, 0);
        gSprites[card->spriteId].oam.paletteNum = i;
        gSprites[card->spriteId].invisible = TRUE;
        gSprites[card->spriteId].affineAnimPaused = TRUE;
    }
}

static void InitCards(void)
{
    u32 i, best = 0;

    sEndScreen->count = 0;
    sEndScreen->mvp = PARTY_SIZE;
    for (i = 0; i < PARTY_SIZE; i++)
    {
        struct Pokemon *mon = &gPlayerParty[i];
        struct EndCard *card = &sEndScreen->cards[sEndScreen->count];

        if (!Arena_IsTeamMon(mon))
            continue;
        card->record = RecordOf(i);
        if (card->record == NULL)
            continue;
        card->partyIndex = i;
        card->expEnd = GetMonData(mon, MON_DATA_EXP);
        card->levelEnd = GetMonData(mon, MON_DATA_LEVEL);
        card->fainted = GetMonData(mon, MON_DATA_HP) == 0;
        card->spriteId = ARENA_NO_SPRITE;
        if (card->record->damageDealt > best)
        {
            best = card->record->damageDealt;
            sEndScreen->mvp = sEndScreen->count;
        }
        sEndScreen->count++;
    }
    sEndScreen->money = (s32)GetMoney(&gSaveBlock1Ptr->money) - (s32)gArenaBattle.record.moneyStart;
}

static void LoadTypeBands(void)
{
    u16 *map = BG_SCREEN_ADDR(31);
    u16 palette[16];
    u32 i, row, col;

    for (i = 0; i < sEndScreen->count; i++)
    {
        u16 species = GetMonData(&gPlayerParty[sEndScreen->cards[i].partyIndex], MON_DATA_SPECIES);

        memcpy(palette, sEndPalette, sizeof(palette));
        palette[END_TYPE] = Arena_TypeColor(gSpeciesInfo[species].types[0]);
        LoadPalette(palette, BG_PLTT_ID(1 + i), PLTT_SIZE_4BPP);
    }
    for (row = CARD_Y / 8; row <= (CARD_Y + 12) / 8; row++)
    {
        for (col = 0; col < 30; col++)
        {
            s32 center = col * 8 + 4;

            for (i = 0; i < sEndScreen->count; i++)
            {
                if (center >= CardX(i) - 2 && center < CardX(i) + CardWidth() + 2)
                    map[row * 32 + col] = (map[row * 32 + col] & 0x3FF) | ((1 + i) << 12);
            }
        }
    }
}

static void VBlankCB_EndScreen(void)
{
    LoadOam();
    ProcessSpriteCopyRequests();
    TransferPlttBuffer();
}

static void DrawBackground(void)
{
    s32 x, y;

    ArenaCanvas_Fill(&sEndCanvas, 0, 0, DISPLAY_WIDTH, DISPLAY_HEIGHT, END_BG);
    for (y = 0; y < DISPLAY_HEIGHT; y++)
        for (x = (y * 2) % 16 - 16; x < DISPLAY_WIDTH; x += 16)
            ArenaCanvas_Fill(&sEndCanvas, x, y, 6, 1, END_BG_STRIPE);
}

static void InitEndVideo(void)
{
    u16 *map = BG_SCREEN_ADDR(31);
    u32 i;

    SetVBlankCallback(NULL);
    SetHBlankCallback(NULL);
    ScanlineEffect_Stop();
    ResetSpriteData();
    FreeAllSpritePalettes();
    ResetPaletteFade();
    CpuFill32(0, (void *)VRAM, VRAM_SIZE);
    ResetBgsAndClearDma3BusyFlags(FALSE);
    InitBgsFromTemplates(0, sEndBgTemplates, ARRAY_COUNT(sEndBgTemplates));
    for (i = 0; i < 32 * 32; i++)
        map[i] = (i % 32 < 30 && i / 32 < 20) ? 1 + (i / 32) * 30 + i % 32 : 0;
    LoadPalette(sEndPalette, BG_PLTT_ID(0), PLTT_SIZE_4BPP);
    SetGpuReg(REG_OFFSET_DISPCNT, DISPCNT_MODE_0 | DISPCNT_OBJ_1D_MAP | DISPCNT_OBJ_ON);
    SetGpuReg(REG_OFFSET_BLDCNT, 0);
    SetGpuReg(REG_OFFSET_BG0HOFS, 0);
    SetGpuReg(REG_OFFSET_BG0VOFS, 0);
    ShowBg(0);
    DrawBackground();
}

static void CB2_EndScreen(void)
{
    switch (sEndScreen->state)
    {
    case END_INIT:
        InitEndVideo();
        InitCards();
        LoadTypeBands();
        CreateCardSprites();
        gReservedSpritePaletteCount = PARTY_SIZE;
        ArenaJuice_LoadGfx();
        BeginNormalPaletteFade(PALETTES_ALL, 0, 16, 0, RGB_BLACK);
        SetVBlankCallback(VBlankCB_EndScreen);
        sEndScreen->state = END_SHOWN;
        break;
    case END_SHOWN:
        if (Arena_AutoPlays() && sEndScreen->time >= AllShownTime() + AUTO_EXIT_FRAMES)
        {
            BeginNormalPaletteFade(PALETTES_ALL, 0, 0, 16, RGB_BLACK);
            sEndScreen->state = END_LEAVE;
        }
        else if (JOY_NEW(A_BUTTON | B_BUTTON) && !gPaletteFade.active)
        {
            if (!AllShown())
            {
                sEndScreen->time = AllShownTime();
            }
            else
            {
                PlaySE(SE_SELECT);
                BeginNormalPaletteFade(PALETTES_ALL, 0, 0, 16, RGB_BLACK);
                sEndScreen->state = END_LEAVE;
            }
        }
        else if (sEndScreen->time < 0xF000)
        {
            sEndScreen->time++;
        }
        PlayEndSounds();
        DrawEndScreen();
        ArenaJuice_UpdateParticles();
        break;
    case END_LEAVE:
        if (!gPaletteFade.active)
        {
            m4aSongNumStop(SE_EXP);
            ResetSpriteData();
            FreeAllSpritePalettes();
            SetVBlankCallback(VBlankCB_Battle);
            SetMainCallback2(BattleMainCB2);
        }
        break;
    }
    AnimateSprites();
    BuildOamBuffer();
    UpdatePaletteFade();
}

static void WaitForEndScreen(void)
{
    if (sEndScreen->state == END_FADE_FROM_BATTLE)
    {
        if (!gPaletteFade.active)
        {
            sEndScreen->state = END_INIT;
            SetMainCallback2(CB2_EndScreen);
        }
    }
    else if (gMain.callback2 == BattleMainCB2 && sEndScreen->state == END_LEAVE)
    {
        gBattleMainFunc = sEndScreen->returnMainFunc;
        Free(sEndScreen);
        sEndScreen = NULL;
    }
}

// The engine calls this after the EXP, the prize money and the victory music.
bool8 Arena_StartEndScreen(void)
{
    if (!gArenaBattle.active || gArenaBattle.record.endScreenShown)
        return FALSE;
    gArenaBattle.record.endScreenShown = TRUE;
    sEndScreen = AllocZeroed(sizeof(*sEndScreen));
    if (sEndScreen == NULL)
        return FALSE;
    sEndScreen->returnMainFunc = gBattleMainFunc;
    sEndScreen->state = END_FADE_FROM_BATTLE;
    ArenaScreen_Free();
    BeginNormalPaletteFade(PALETTES_ALL, 0, 0, 16, RGB_BLACK);
    gBattleMainFunc = WaitForEndScreen;
    return TRUE;
}
