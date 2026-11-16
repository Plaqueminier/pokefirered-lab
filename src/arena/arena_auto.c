// Issue #99: Auto mode only reads the battle state. The player controller gives its choice to the engine.
#include "global.h"
#include "arena_internal.h"
#include "battle.h"
#include "battle_anim.h"
#include "battle_interface.h"
#include "battle_main.h"
#include "battle_util.h"
#include "pokedex.h"
#include "pokemon.h"
#include "util.h"
#include "constants/abilities.h"
#include "constants/battle_move_effects.h"
#include "constants/moves.h"
#include "constants/party_menu.h"

#define DUEL_SCORE_CAP 150
#define DUEL_FASTER_BONUS_TENTHS 12
#define SWITCH_SCORE_GAIN 50
#define SAVE_PP_NEAR_BEST_PERCENT 80
#define TACTICS_TURNS 2
#define LOW_ROLL_PERCENT 85
#define FLAIL_HP_SCALE 48
#define LOW_KICK_MAX_POWER 120
#define MAGNITUDE_MIN_POWER 10
#define MAGNITUDE_MAX_POWER 150
#define TRIPLE_KICK_HITS 3
#define ROLLOUT_HITS 5
#define FURY_CUTTER_MAX_COUNT 5

struct ArenaAuto
{
    u32 rng;
    struct ArenaPlan plan;
    struct ArenaEstimate estimates[MAX_MON_MOVES];
    u8 lowHpStopped;
    bool8 runTried;
    bool8 switchRefused;
    u8 turnsOutPartyIndex;
    u8 outSinceTurn;
    u8 turnsOut;
};

// The Harness reads this name (lab/src/harness/arena.test.ts).
static EWRAM_DATA struct ArenaAuto sArenaAuto = {0};

struct MoveChoice
{
    u8 index;
    u16 move;
    struct ArenaEstimate estimate;
    u32 score;
};

// attackerIsOut: attacker is the battler on the field, so the counters of the battler (ROLLOUT, FURY CUTTER,
// STOCKPILE) are its counters. A reserve has none.
struct Matchup
{
    struct BattlePokemon *attacker;
    struct BattlePokemon *defender;
    u8 attackerBattler;
    u8 defenderBattler;
    bool8 attackerIsOut;
    bool8 foresight;
};

// powerGrows: the hit n has n times the power of the first hit (TRIPLE KICK).
struct MovePower
{
    u16 minPower;
    u16 maxPower;
    u8 type;
    u8 typeOverride;
    u8 minHits;
    u8 maxHits;
    u8 damageMultiplier;
    bool8 powerGrows;
    bool8 noRoll;
    bool8 fails;
};

struct EngineScratch
{
    u16 movePower;
    u8 critMultiplier;
    u8 itemEffectBattler;
    u8 scriptingBattler;
    u8 lastUsedAbility;
    u8 multistringChooser;
};

static const u8 sFlailPowers[][2] = {{1, 200}, {4, 150}, {9, 100}, {16, 80}, {32, 40}, {48, 20}};
// The same ratios as sAccuracyStageRatios of the engine, from -6 to +6.
static const u8 sAccuracyStageRatios[][2] = {{33, 100}, {36, 100}, {43, 100}, {50, 100}, {60, 100}, {75, 100}, {1, 1}, {133, 100}, {166, 100}, {2, 1}, {233, 100}, {133, 50}, {3, 1}};
// The same table as sWeightToDamageTable of the engine: below each weight in hectograms, the power of LOW KICK.
static const u16 sLowKickPowers[][2] = {{100, 20}, {250, 40}, {500, 60}, {1000, 80}, {2000, 100}};

void ArenaAuto_Init(u32 seed)
{
    memset(&sArenaAuto, 0, sizeof(sArenaAuto));
    sArenaAuto.rng = seed;
    sArenaAuto.turnsOutPartyIndex = ARENA_NO_CHOICE;
}

const struct ArenaPlan *ArenaAuto_Plan(void)
{
    return &sArenaAuto.plan;
}

const struct ArenaEstimate *ArenaAuto_Estimate(u8 moveIndex)
{
    return &sArenaAuto.estimates[moveIndex];
}

static void SaveEngineScratch(struct EngineScratch *scratch)
{
    scratch->movePower = gBattleMovePower;
    scratch->critMultiplier = gCritMultiplier;
    scratch->itemEffectBattler = gPotentialItemEffectBattler;
    scratch->scriptingBattler = gBattleScripting.battler;
    scratch->lastUsedAbility = gLastUsedAbility;
    scratch->multistringChooser = gBattleCommunication[MULTISTRING_CHOOSER];
}

static void RestoreEngineScratch(const struct EngineScratch *scratch)
{
    gBattleMovePower = scratch->movePower;
    gCritMultiplier = scratch->critMultiplier;
    gPotentialItemEffectBattler = scratch->itemEffectBattler;
    gBattleScripting.battler = scratch->scriptingBattler;
    gLastUsedAbility = scratch->lastUsedAbility;
    gBattleCommunication[MULTISTRING_CHOOSER] = scratch->multistringChooser;
}

static u16 HiddenPower(const struct BattlePokemon *mon, struct MovePower *out)
{
    s32 powerBits = ((mon->hpIV & 2) >> 1) | (mon->attackIV & 2) | ((mon->defenseIV & 2) << 1)
                  | ((mon->speedIV & 2) << 2) | ((mon->spAttackIV & 2) << 3) | ((mon->spDefenseIV & 2) << 4);
    s32 typeBits = (mon->hpIV & 1) | ((mon->attackIV & 1) << 1) | ((mon->defenseIV & 1) << 2)
                 | ((mon->speedIV & 1) << 3) | ((mon->spAttackIV & 1) << 4) | ((mon->spDefenseIV & 1) << 5);

    out->type = ((NUMBER_OF_MON_TYPES - 3) * typeBits) / 63 + 1;
    if (out->type >= TYPE_MYSTERY)
        out->type++;
    out->typeOverride = out->type | F_DYNAMIC_TYPE_1 | F_DYNAMIC_TYPE_2;
    return (40 * powerBits) / 63 + 30;
}

static void WeatherBall(struct MovePower *out)
{
    if (!WEATHER_HAS_EFFECT || !(gBattleWeather & B_WEATHER_ANY))
        return;
    out->damageMultiplier = 2;
    if (gBattleWeather & B_WEATHER_RAIN)
        out->type = TYPE_WATER;
    else if (gBattleWeather & B_WEATHER_SANDSTORM)
        out->type = TYPE_ROCK;
    else if (gBattleWeather & B_WEATHER_SUN)
        out->type = TYPE_FIRE;
    else if (gBattleWeather & B_WEATHER_HAIL)
        out->type = TYPE_ICE;
    out->typeOverride = out->type | F_DYNAMIC_TYPE_2;
}

// As in Cmd_weightdamagecalculation.
static u16 LowKickPower(u16 species)
{
    u32 weight = GetPokedexHeightWeight(SpeciesToNationalPokedexNum(species), 1);
    u32 i;

    for (i = 0; i < ARRAY_COUNT(sLowKickPowers) && sLowKickPowers[i][0] <= weight; i++)
        ;
    return i < ARRAY_COUNT(sLowKickPowers) ? sLowKickPowers[i][1] : LOW_KICK_MAX_POWER;
}

// As in Cmd_rolloutdamagecalculation: the hit n of 5 has 2^(n-1) times the power. A first hit starts at 5.
static u16 RolloutPower(const struct Matchup *m, u16 move, u16 power)
{
    u8 timer = ROLLOUT_HITS;

    if (m->attackerIsOut && (m->attacker->status2 & STATUS2_MULTIPLETURNS) && gLockedMoves[m->attackerBattler] == move
     && gDisableStructs[m->attackerBattler].rolloutTimer != 0)
        timer = gDisableStructs[m->attackerBattler].rolloutTimer;
    power <<= ROLLOUT_HITS - timer;
    if (m->attacker->status2 & STATUS2_DEFENSE_CURL)
        power *= 2;
    return power;
}

// As in Cmd_furycuttercalc: the counter goes up before the hit, to 5 at most, and each step doubles the power.
static u16 FuryCutterPower(const struct Matchup *m, u16 power)
{
    u8 count = m->attackerIsOut ? gDisableStructs[m->attackerBattler].furyCutterCounter : 0;

    if (count != FURY_CUTTER_MAX_COUNT)
        count++;
    return power << (count - 1);
}

// The power formulas of the engine, but without a call to Random(). MAGNITUDE gives the range of its powers.
static void PowerOf(const struct Matchup *m, u16 move, struct MovePower *out)
{
    const struct BattlePokemon *attacker = m->attacker;
    u16 power = gBattleMoves[move].power;
    u8 hpFraction;
    s32 i;

    memset(out, 0, sizeof(*out));
    out->type = gBattleMoves[move].type;
    out->minHits = out->maxHits = 1;
    out->damageMultiplier = 1;
    switch (gBattleMoves[move].effect)
    {
    case EFFECT_RETURN:
        power = 10 * attacker->friendship / 25;
        break;
    case EFFECT_FRUSTRATION:
        power = 10 * (255 - attacker->friendship) / 25;
        break;
    case EFFECT_HIDDEN_POWER:
        power = HiddenPower(attacker, out);
        break;
    case EFFECT_FLAIL:
        hpFraction = GetScaledHPFraction(attacker->hp, attacker->maxHP, FLAIL_HP_SCALE);
        for (i = 0; i < (s32)NELEMS(sFlailPowers) - 1 && hpFraction > sFlailPowers[i][0]; i++)
            ;
        power = sFlailPowers[i][1];
        break;
    case EFFECT_MULTI_HIT:
        out->minHits = 2;
        out->maxHits = 5;
        break;
    case EFFECT_DOUBLE_HIT:
    case EFFECT_TWINEEDLE:
        out->minHits = out->maxHits = 2;
        break;
    case EFFECT_TRIPLE_KICK:
        out->maxHits = TRIPLE_KICK_HITS;
        out->powerGrows = TRUE;
        break;
    case EFFECT_ERUPTION:
        power = attacker->hp * power / attacker->maxHP;
        if (power == 0)
            power = 1;
        break;
    case EFFECT_FACADE:
        if (attacker->status1 & (STATUS1_PSN_ANY | STATUS1_BURN | STATUS1_PARALYSIS))
            out->damageMultiplier = 2;
        break;
    case EFFECT_SMELLINGSALT:
        if ((m->defender->status1 & STATUS1_PARALYSIS) && !(m->defender->status2 & STATUS2_SUBSTITUTE))
            out->damageMultiplier = 2;
        break;
    case EFFECT_WEATHER_BALL:
        WeatherBall(out);
        break;
    case EFFECT_LOW_KICK:
        power = LowKickPower(m->defender->species);
        break;
    case EFFECT_MAGNITUDE:
        out->minPower = MAGNITUDE_MIN_POWER;
        power = MAGNITUDE_MAX_POWER;
        break;
    case EFFECT_ROLLOUT:
        power = RolloutPower(m, move, power);
        break;
    case EFFECT_FURY_CUTTER:
        power = FuryCutterPower(m, power);
        break;
    // As in Cmd_stockpiletobasedamage: the damage of one stockpile for each stockpile, with no random factor.
    case EFFECT_SPIT_UP:
        out->damageMultiplier = m->attackerIsOut ? gDisableStructs[m->attackerBattler].stockpileCounter : 0;
        out->fails = out->damageMultiplier == 0;
        out->noRoll = TRUE;
        break;
    }
    out->maxPower = power;
    if (out->minPower == 0)
        out->minPower = power;
}

// One factor at a time, to get the same rounding as the engine.
static s32 ApplyTypes(s32 damage, u8 moveType, const struct BattlePokemon *defender, bool8 foresight, u16 *percent)
{
    s32 i;

    *percent = 100;
    if (defender->ability == ABILITY_LEVITATE && moveType == TYPE_GROUND)
    {
        *percent = 0;
        return 0;
    }
    for (i = 0; TYPE_EFFECT_ATK_TYPE(i) != TYPE_ENDTABLE; i += 3)
    {
        if (TYPE_EFFECT_ATK_TYPE(i) == TYPE_FORESIGHT)
        {
            if (foresight)
                break;
            continue;
        }
        if (TYPE_EFFECT_ATK_TYPE(i) != moveType)
            continue;
        if (TYPE_EFFECT_DEF_TYPE(i) == defender->type1
         || (TYPE_EFFECT_DEF_TYPE(i) == defender->type2 && defender->type1 != defender->type2))
        {
            *percent = *percent * TYPE_EFFECT_MULTIPLIER(i) / TYPE_MUL_NORMAL;
            damage = damage * TYPE_EFFECT_MULTIPLIER(i) / TYPE_MUL_NORMAL;
            if (damage == 0 && TYPE_EFFECT_MULTIPLIER(i) != TYPE_MUL_NO_EFFECT)
                damage = 1;
        }
    }
    if (defender->ability == ABILITY_WONDER_GUARD && *percent <= 100)
        *percent = 0;
    return *percent == 0 ? 0 : damage;
}

static u16 TypePercent(u8 moveType, const struct BattlePokemon *defender, bool8 foresight)
{
    u16 percent;

    ApplyTypes(0, moveType, defender, foresight, &percent);
    return percent;
}

// In Gen 3, fixed-damage moves ignore the stats and the type multiplier, but not an immunity.
static bool8 FixedDamage(const struct Matchup *m, u16 move, struct ArenaEstimate *estimate)
{
    const struct BattlePokemon *attacker = m->attacker;
    const struct BattlePokemon *defender = m->defender;

    switch (gBattleMoves[move].effect)
    {
    case EFFECT_LEVEL_DAMAGE:
        estimate->min = estimate->max = attacker->level;
        break;
    case EFFECT_DRAGON_RAGE:
        estimate->min = estimate->max = 40;
        break;
    case EFFECT_SONICBOOM:
        estimate->min = estimate->max = 20;
        break;
    case EFFECT_SUPER_FANG:
        estimate->min = estimate->max = defender->hp / 2 ? defender->hp / 2 : 1;
        break;
    case EFFECT_PSYWAVE:
        estimate->min = attacker->level / 2 ? attacker->level / 2 : 1;
        estimate->max = attacker->level * 15 / 10;
        break;
    case EFFECT_OHKO:
        if (attacker->level < defender->level)
        {
            estimate->typePercent = 0;
            return TRUE;
        }
        estimate->min = estimate->max = defender->hp;
        break;
    // As in Cmd_setdamagetohealthdifference: it fails when the user has as many HP as the foe, or more.
    case EFFECT_ENDEAVOR:
        if (defender->hp <= attacker->hp)
        {
            estimate->typePercent = 0;
            return TRUE;
        }
        estimate->min = estimate->max = defender->hp - attacker->hp;
        break;
    case EFFECT_COUNTER:
    case EFFECT_MIRROR_COAT:
    case EFFECT_BIDE:
    case EFFECT_PRESENT:
        estimate->unknown = TRUE;
        return TRUE;
    default:
        return FALSE;
    }
    estimate->typePercent = 100;
    return TRUE;
}

// One hit as damagecalc and typecalc of the engine compute it, with no critical hit and no random factor.
static s32 HitDamage(const struct Matchup *m, u16 move, u16 power, const struct MovePower *movePower, u16 *typePercent)
{
    s32 damage = CalculateBaseDamage(m->attacker, m->defender, move, gSideStatuses[GET_BATTLER_SIDE(m->defenderBattler)], power,
                                     movePower->typeOverride, m->attackerBattler, m->defenderBattler);

    damage *= movePower->damageMultiplier;
    if (m->attacker->type1 == movePower->type || m->attacker->type2 == movePower->type)
        damage = damage * 15 / 10;
    return ApplyTypes(damage, movePower->type, m->defender, m->foresight, typePercent);
}

static s32 LowRoll(s32 damage, const struct MovePower *movePower)
{
    s32 low = movePower->noRoll ? damage : damage * LOW_ROLL_PERCENT / 100;

    return damage != 0 && low == 0 ? 1 : low;
}

static void EstimateDamage(struct BattlePokemon *attacker, u8 attackerBattler, struct BattlePokemon *defender, u8 defenderBattler, u16 move, struct ArenaEstimate *estimate)
{
    struct Matchup m = {attacker, defender, attackerBattler, defenderBattler, attacker == &gBattleMons[attackerBattler],
                        (defender->status2 & STATUS2_FORESIGHT) != 0};
    struct EngineScratch scratch;
    struct MovePower power;
    s32 first, max;
    u32 hit;

    memset(estimate, 0, sizeof(*estimate));
    PowerOf(&m, move, &power);
    estimate->typePercent = power.fails ? 0 : TypePercent(power.type, defender, m.foresight);
    if (power.maxPower == 0 || estimate->typePercent == 0 || FixedDamage(&m, move, estimate))
        return;
    SaveEngineScratch(&scratch);
    gCritMultiplier = 1;
    first = HitDamage(&m, move, power.minPower, &power, &estimate->typePercent);
    estimate->min = LowRoll(first, &power) * power.minHits;
    if (power.powerGrows)
    {
        for (max = first, hit = 2; hit <= power.maxHits; hit++)
            max += HitDamage(&m, move, power.minPower * hit, &power, &estimate->typePercent);
    }
    else
    {
        max = power.maxPower == power.minPower ? first : HitDamage(&m, move, power.maxPower, &power, &estimate->typePercent);
        max *= power.maxHits;
    }
    estimate->max = max;
    RestoreEngineScratch(&scratch);
}

static u32 HitPercent(const struct BattlePokemon *attacker, const struct BattlePokemon *defender, u16 move)
{
    u32 accuracy = gBattleMoves[move].accuracy;
    s32 stage = attacker->statStages[STAT_ACC];

    if (accuracy == 0)
        return 100;
    if (!(defender->status2 & STATUS2_FORESIGHT))
        stage += DEFAULT_STAT_STAGE - defender->statStages[STAT_EVASION];
    stage = max(MIN_STAT_STAGE, min(MAX_STAT_STAGE, stage));
    return min(100, accuracy * sAccuracyStageRatios[stage][0] / sAccuracyStageRatios[stage][1]);
}

static u32 ScoreOf(const struct BattlePokemon *attacker, const struct BattlePokemon *defender, u16 move, const struct ArenaEstimate *estimate)
{
    return (estimate->min + estimate->max) * HitPercent(attacker, defender, move);
}

static void PartyMonToBattleMon(struct Pokemon *mon, struct BattlePokemon *out)
{
    s32 i;

    memset(out, 0, sizeof(*out));
    out->species = GetMonData(mon, MON_DATA_SPECIES);
    for (i = 0; i < MAX_MON_MOVES; i++)
    {
        out->moves[i] = GetMonData(mon, MON_DATA_MOVE1 + i);
        out->pp[i] = GetMonData(mon, MON_DATA_PP1 + i);
    }
    for (i = 0; i < NUM_BATTLE_STATS; i++)
        out->statStages[i] = DEFAULT_STAT_STAGE;
    out->attack = GetMonData(mon, MON_DATA_ATK);
    out->defense = GetMonData(mon, MON_DATA_DEF);
    out->speed = GetMonData(mon, MON_DATA_SPEED);
    out->spAttack = GetMonData(mon, MON_DATA_SPATK);
    out->spDefense = GetMonData(mon, MON_DATA_SPDEF);
    out->hp = GetMonData(mon, MON_DATA_HP);
    out->maxHP = GetMonData(mon, MON_DATA_MAX_HP);
    out->level = GetMonData(mon, MON_DATA_LEVEL);
    out->friendship = GetMonData(mon, MON_DATA_FRIENDSHIP);
    out->hpIV = GetMonData(mon, MON_DATA_HP_IV);
    out->attackIV = GetMonData(mon, MON_DATA_ATK_IV);
    out->defenseIV = GetMonData(mon, MON_DATA_DEF_IV);
    out->speedIV = GetMonData(mon, MON_DATA_SPEED_IV);
    out->spAttackIV = GetMonData(mon, MON_DATA_SPATK_IV);
    out->spDefenseIV = GetMonData(mon, MON_DATA_SPDEF_IV);
    out->item = GetMonData(mon, MON_DATA_HELD_ITEM);
    out->status1 = GetMonData(mon, MON_DATA_STATUS);
    out->abilityNum = GetMonData(mon, MON_DATA_ABILITY_NUM);
    out->ability = GetAbilityBySpecies(out->species, out->abilityNum);
    out->type1 = gSpeciesInfo[out->species].types[0];
    out->type2 = gSpeciesInfo[out->species].types[1];
}

static u32 EffectiveSpeed(const struct BattlePokemon *mon)
{
    u32 speed = mon->speed * gStatStageRatios[mon->statStages[STAT_SPEED]][0] / gStatStageRatios[mon->statStages[STAT_SPEED]][1];

    if (mon->status1 & STATUS1_PARALYSIS)
        speed /= 4;
    return speed;
}

static u32 BestScore(struct BattlePokemon *user, u8 userBattler, struct BattlePokemon *target, u8 targetBattler, bool8 onlyWithPp)
{
    struct ArenaEstimate estimate;
    u32 best = 0, score;
    s32 i;

    for (i = 0; i < MAX_MON_MOVES; i++)
    {
        if (user->moves[i] == MOVE_NONE || (onlyWithPp && user->pp[i] == 0))
            continue;
        EstimateDamage(user, userBattler, target, targetBattler, user->moves[i], &estimate);
        score = ScoreOf(user, target, user->moves[i], &estimate);
        if (score > best)
            best = score;
    }
    return best;
}

static s32 ShareOfHp(u32 score, u16 hp)
{
    s32 share = score / 200 * 100 / (hp ? hp : 1);

    return share > DUEL_SCORE_CAP ? DUEL_SCORE_CAP : share;
}

static s32 DuelScore(struct BattlePokemon *mon, struct BattlePokemon *foe)
{
    u8 battler = GetBattlerAtPosition(B_POSITION_PLAYER_LEFT);
    u8 foeBattler = GetBattlerAtPosition(B_POSITION_OPPONENT_LEFT);
    s32 give = ShareOfHp(BestScore(mon, battler, foe, foeBattler, TRUE), foe->hp);
    s32 take = ShareOfHp(BestScore(foe, foeBattler, mon, battler, FALSE), mon->hp);

    if (EffectiveSpeed(mon) > EffectiveSpeed(foe))
        give = give * DUEL_FASTER_BONUS_TENTHS / 10;
    return give - take;
}

bool8 Arena_CanSendOut(u8 partyIndex, u8 battler)
{
    struct Pokemon *mon = &gPlayerParty[partyIndex];

    return Arena_IsTeamMon(mon) && GetMonData(mon, MON_DATA_HP) != 0 && partyIndex != gBattlerPartyIndexes[battler];
}

static u8 BestReserve(u8 battler, s32 *score)
{
    struct BattlePokemon mon;
    struct BattlePokemon *foe = &gBattleMons[GetBattlerAtPosition(B_POSITION_OPPONENT_LEFT)];
    u8 best = ARENA_NO_CHOICE;
    s32 i, duel;

    for (i = 0; i < PARTY_SIZE; i++)
    {
        if (!Arena_CanSendOut(i, battler))
            continue;
        PartyMonToBattleMon(&gPlayerParty[i], &mon);
        duel = DuelScore(&mon, foe);
        if (best == ARENA_NO_CHOICE || duel > *score)
        {
            best = i;
            *score = duel;
        }
    }
    return best;
}

static u8 RandomReserve(u8 battler)
{
    u8 options[PARTY_SIZE];
    u8 count = 0;
    s32 i;

    for (i = 0; i < PARTY_SIZE; i++)
        if (Arena_CanSendOut(i, battler))
            options[count++] = i;
    return count ? options[Arena_Lcg(&sArenaAuto.rng) % count] : ARENA_NO_CHOICE;
}

static u8 UsableMoves(u8 battler, u8 foeBattler, struct MoveChoice *moves)
{
    struct EngineScratch scratch;
    u8 unusable;
    u8 count = 0;
    s32 i;

    SaveEngineScratch(&scratch);
    unusable = CheckMoveLimitations(battler, 0, MOVE_LIMITATIONS_ALL);
    RestoreEngineScratch(&scratch);

    for (i = 0; i < MAX_MON_MOVES; i++)
    {
        if (unusable & gBitTable[i])
            continue;
        moves[count].index = i;
        moves[count].move = gBattleMons[battler].moves[i];
        moves[count].estimate = sArenaAuto.estimates[i];
        moves[count].score = ScoreOf(&gBattleMons[battler], &gBattleMons[foeBattler], moves[count].move, &moves[count].estimate);
        count++;
    }
    return count;
}

static bool8 IsStatusMove(const struct MoveChoice *choice)
{
    return gBattleMoves[choice->move].power == 0;
}

static bool8 DealsDamage(const struct MoveChoice *choice)
{
    return gBattleMoves[choice->move].power != 0 && choice->estimate.typePercent != 0 && !choice->estimate.unknown;
}

// In Gen 3, the only status moves that check the type match are the ones of EFFECT_PARALYZE.
static bool8 HasNoEffect(const struct MoveChoice *choice)
{
    return choice->estimate.typePercent == 0 && (!IsStatusMove(choice) || gBattleMoves[choice->move].effect == EFFECT_PARALYZE);
}

static bool8 SureKnockOut(const struct MoveChoice *choice, const struct BattlePokemon *foe)
{
    return DealsDamage(choice) && choice->estimate.min >= foe->hp;
}

static bool8 AnySureKnockOut(const struct MoveChoice *moves, u8 count, const struct BattlePokemon *foe)
{
    s32 i;

    for (i = 0; i < count; i++)
        if (SureKnockOut(&moves[i], foe))
            return TRUE;
    return FALSE;
}

static u8 PpOf(u8 battler, const struct MoveChoice *choice)
{
    return gBattleMons[battler].pp[choice->index];
}

static const struct MoveChoice *MostPp(u8 battler, const struct MoveChoice *moves, u8 count)
{
    const struct MoveChoice *best = &moves[0];
    s32 i;

    for (i = 1; i < count; i++)
        if (PpOf(battler, &moves[i]) > PpOf(battler, best))
            best = &moves[i];
    return best;
}

static const struct MoveChoice *MaxPower(u8 battler, const struct MoveChoice *moves, u8 count)
{
    const struct MoveChoice *best = NULL;
    s32 i;

    for (i = 0; i < count; i++)
        if (DealsDamage(&moves[i]) && (best == NULL || moves[i].score > best->score))
            best = &moves[i];
    if (best != NULL)
        return best;
    for (i = 0; i < count; i++)
        if (moves[i].estimate.unknown)
            return &moves[i];
    for (i = 0; i < count; i++)
        if (IsStatusMove(&moves[i]) && !HasNoEffect(&moves[i]))
            return &moves[i];
    return MostPp(battler, moves, count);
}

static const struct MoveChoice *SavePp(u8 battler, const struct MoveChoice *moves, u8 count, const struct BattlePokemon *foe)
{
    const struct MoveChoice *best = NULL, *top;
    s32 i;

    for (i = 0; i < count; i++)
    {
        if (!SureKnockOut(&moves[i], foe))
            continue;
        if (best == NULL || PpOf(battler, &moves[i]) > PpOf(battler, best)
         || (PpOf(battler, &moves[i]) == PpOf(battler, best) && moves[i].score > best->score))
            best = &moves[i];
    }
    if (best != NULL)
        return best;
    top = best = MaxPower(battler, moves, count);
    for (i = 0; i < count; i++)
        if (DealsDamage(&moves[i]) && moves[i].score * 100 >= top->score * SAVE_PP_NEAR_BEST_PERCENT && PpOf(battler, &moves[i]) > PpOf(battler, best))
            best = &moves[i];
    return best;
}

enum
{
    TACTIC_SEED,
    TACTIC_SPEED_DOWN,
    TACTIC_DEFENSE_DOWN,
    TACTIC_ATTACK_DOWN,
    TACTIC_ACCURACY_DOWN,
    TACTIC_DEFENSE_UP,
    TACTIC_COUNT,
    TACTIC_NONE = TACTIC_COUNT,
};

static u8 TacticOf(u16 move)
{
    switch (gBattleMoves[move].effect)
    {
    case EFFECT_LEECH_SEED: return TACTIC_SEED;
    case EFFECT_SPEED_DOWN: return TACTIC_SPEED_DOWN;
    case EFFECT_DEFENSE_DOWN: return TACTIC_DEFENSE_DOWN;
    case EFFECT_ATTACK_DOWN: return TACTIC_ATTACK_DOWN;
    case EFFECT_ACCURACY_DOWN: return TACTIC_ACCURACY_DOWN;
    case EFFECT_DEFENSE_UP: return TACTIC_DEFENSE_UP;
    default: return TACTIC_NONE;
    }
}

#define CAN_FALL(mon, stat) ((mon)->statStages[stat] > DEFAULT_STAT_STAGE - 2)
#define CAN_RISE(mon, stat) ((mon)->statStages[stat] < DEFAULT_STAT_STAGE + 2)

static bool8 AttackIsBest(const struct BattlePokemon *mon)
{
    return mon->attack >= mon->defense && mon->attack >= mon->speed && mon->attack >= mon->spAttack && mon->attack >= mon->spDefense;
}

static bool8 TacticIsUseful(u8 tactic, u8 foeBattler, const struct BattlePokemon *user, const struct BattlePokemon *foe, bool8 bestIsPhysical)
{
    switch (tactic)
    {
    case TACTIC_SEED:
        return !(gStatuses3[foeBattler] & STATUS3_LEECHSEED) && foe->type1 != TYPE_GRASS && foe->type2 != TYPE_GRASS;
    case TACTIC_SPEED_DOWN:
        return CAN_FALL(foe, STAT_SPEED) && EffectiveSpeed(foe) > EffectiveSpeed(user);
    case TACTIC_DEFENSE_DOWN:
        return CAN_FALL(foe, STAT_DEF) && bestIsPhysical;
    case TACTIC_ATTACK_DOWN:
        return CAN_FALL(foe, STAT_ATK) && AttackIsBest(foe);
    case TACTIC_ACCURACY_DOWN:
        return CAN_FALL(foe, STAT_ACC);
    case TACTIC_DEFENSE_UP:
        return CAN_RISE(user, STAT_DEF);
    default:
        return FALSE;
    }
}

static const struct MoveChoice *Tactics(u8 battler, u8 foeBattler, const struct MoveChoice *moves, u8 count)
{
    const struct BattlePokemon *user = &gBattleMons[battler];
    const struct BattlePokemon *foe = &gBattleMons[foeBattler];
    const struct MoveChoice *best = MaxPower(battler, moves, count);
    bool8 bestIsPhysical = DealsDamage(best) && IS_TYPE_PHYSICAL(gBattleMoves[best->move].type);
    u8 tactic;
    s32 i;

    if (sArenaAuto.turnsOut >= TACTICS_TURNS || user->hp <= user->maxHP / 2 || AnySureKnockOut(moves, count, foe))
        return best;
    for (tactic = 0; tactic < TACTIC_COUNT; tactic++)
    {
        if (!TacticIsUseful(tactic, foeBattler, user, foe, bestIsPhysical))
            continue;
        for (i = 0; i < count; i++)
            if (IsStatusMove(&moves[i]) && TacticOf(moves[i].move) == tactic)
                return &moves[i];
    }
    return best;
}

static const struct MoveChoice *RandomMove(const struct MoveChoice *moves, u8 count)
{
    u8 options[MAX_MON_MOVES];
    u8 optionCount = 0;
    s32 i;

    for (i = 0; i < count; i++)
        if (!HasNoEffect(&moves[i]))
            options[optionCount++] = i;
    if (optionCount == 0)
        return &moves[Arena_Lcg(&sArenaAuto.rng) % count];
    return &moves[options[Arena_Lcg(&sArenaAuto.rng) % optionCount]];
}

static const struct MoveChoice *ChooseMove(u8 battler, u8 foeBattler, const struct MoveChoice *moves, u8 count)
{
    switch (gSaveBlock2Ptr->arenaSettings.strategy)
    {
    case ARENA_STRATEGY_SAVE_PP:
        return SavePp(battler, moves, count, &gBattleMons[foeBattler]);
    case ARENA_STRATEGY_TACTICS:
        return Tactics(battler, foeBattler, moves, count);
    case ARENA_STRATEGY_RANDOM:
        return RandomMove(moves, count);
    default:
        return MaxPower(battler, moves, count);
    }
}

static void EstimateAllMoves(u8 battler, u8 foeBattler)
{
    s32 i;

    for (i = 0; i < MAX_MON_MOVES; i++)
        EstimateDamage(&gBattleMons[battler], battler, &gBattleMons[foeBattler], foeBattler, gBattleMons[battler].moves[i], &sArenaAuto.estimates[i]);
}

static void CountTurnsOut(u8 partyIndex)
{
    if (partyIndex != sArenaAuto.turnsOutPartyIndex)
    {
        sArenaAuto.turnsOutPartyIndex = partyIndex;
        sArenaAuto.outSinceTurn = gBattleResults.battleTurnCounter;
    }
    sArenaAuto.turnsOut = gBattleResults.battleTurnCounter - sArenaAuto.outSinceTurn;
}

static bool8 CanRun(void)
{
    struct EngineScratch scratch;
    bool8 canRun;

    SaveEngineScratch(&scratch);
    canRun = !IsRunningFromBattleImpossible();
    RestoreEngineScratch(&scratch);
    return canRun;
}

static bool8 ShouldRun(void)
{
    u16 species;

    if (sArenaAuto.runTried || !gSaveBlock2Ptr->arenaSettings.runIfCaught || (gBattleTypeFlags & BATTLE_TYPE_TRAINER))
        return FALSE;
    species = gBattleMons[GetBattlerAtPosition(B_POSITION_OPPONENT_LEFT)].species;
    return GetSetPokedexFlag(SpeciesToNationalPokedexNum(species), FLAG_GET_CAUGHT) && CanRun();
}

static u8 TypeEdgeSwitch(u8 battler, u8 foeBattler, const struct MoveChoice *moves, u8 count)
{
    s32 here = DuelScore(&gBattleMons[battler], &gBattleMons[foeBattler]);
    s32 reserveScore = 0;
    u8 reserve;

    if (here >= 0 || AnySureKnockOut(moves, count, &gBattleMons[foeBattler]))
        return ARENA_CANCEL_SWITCH;
    reserve = BestReserve(battler, &reserveScore);
    if (reserve == ARENA_NO_CHOICE || reserveScore - here <= SWITCH_SCORE_GAIN)
        return ARENA_CANCEL_SWITCH;
    return reserve;
}

static bool8 StopsForLowHp(u8 battler)
{
    u8 bit = gBitTable[gBattlerPartyIndexes[battler]];

    if (gSaveBlock2Ptr->arenaSettings.noStopLowHp || (sArenaAuto.lowHpStopped & bit)
     || GetHPBarLevel(gBattleMons[battler].hp, gBattleMons[battler].maxHP) != HP_BAR_RED)
        return FALSE;
    sArenaAuto.lowHpStopped |= bit;
    Arena_StopAuto(ARENA_STOP_LOW_HP);
    return TRUE;
}

// The move cards and the plan use the same estimates. Returns TRUE when Auto mode planned the turn.
bool8 Arena_PrepareTurn(void)
{
    struct ArenaPlan *plan = &sArenaAuto.plan;
    u8 battler = gActiveBattler;
    u8 foeBattler = GetBattlerAtPosition(B_POSITION_OPPONENT_LEFT);
    struct MoveChoice moves[MAX_MON_MOVES];
    u8 count;

    CountTurnsOut(gBattlerPartyIndexes[battler]);
    Arena_OnChooseAction();
    EstimateAllMoves(battler, foeBattler);
    if (!Arena_AutoPlays() || StopsForLowHp(battler))
        return FALSE;
    plan->moveIndex = 0;
    plan->partyIndex = ARENA_CANCEL_SWITCH;
    if (ShouldRun())
    {
        sArenaAuto.runTried = TRUE;
        plan->action = B_ACTION_RUN;
        return TRUE;
    }
    plan->action = B_ACTION_USE_MOVE;
    count = UsableMoves(battler, foeBattler, moves);
    if (count == 0)
        return TRUE; // The engine uses Struggle and asks for no move.
    if (sArenaAuto.switchRefused)
        sArenaAuto.switchRefused = FALSE;
    else if (gSaveBlock2Ptr->arenaSettings.strategy == ARENA_STRATEGY_TYPE_EDGE)
        plan->partyIndex = TypeEdgeSwitch(battler, foeBattler, moves, count);
    if (plan->partyIndex != ARENA_CANCEL_SWITCH)
        plan->action = B_ACTION_SWITCH;
    else
        plan->moveIndex = ChooseMove(battler, foeBattler, moves, count)->index;
    return TRUE;
}

u8 Arena_AutoPartyIndex(u8 partyAction)
{
    u8 battler = gActiveBattler;
    s32 score = 0;

    if (!Arena_AutoPlays())
        return ARENA_NO_CHOICE;
    switch (partyAction)
    {
    case PARTY_ACTION_CHOOSE_MON:
        return ARENA_NO_CHOICE; // The controller keeps the party index of the plan.
    case PARTY_ACTION_SEND_OUT:
        return gSaveBlock2Ptr->arenaSettings.strategy == ARENA_STRATEGY_RANDOM ? RandomReserve(battler) : BestReserve(battler, &score);
    default:
        sArenaAuto.switchRefused = TRUE;
        return ARENA_CANCEL_SWITCH;
    }
}
