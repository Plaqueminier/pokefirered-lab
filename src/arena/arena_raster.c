// The Arena writes VRAM while the screen shows. It draws a region only where the scan is not, so no half-drawn
// region shows. The costs are in scanlines, a little above the measured times.
#include "global.h"
#include "arena_internal.h"
#include "main.h"

#define PASS_END (DISPLAY_HEIGHT - 4)
#define MAX_WAIT 3
#define MAX_DRAWS 4

// A draw lowers the cost of its region, and at most MAX_DRAWS draws bring it to 0.
struct ArenaRegion
{
    u8 top;
    u8 bottom;
    u8 visibleCost; // 0 when all of the draw shows on the screen.
    u32 (*cost)(void);
    void (*draw)(void);
};

static const struct ArenaRegion sRegions[ARENA_REGIONS] =
{
    [ARENA_REGION_TOP] = {0, ARENA_INFO_BOTTOM, 0, ArenaHud_TopCost, ArenaHud_DrawTop},
    [ARENA_REGION_OVERLAY] = {ARENA_OVERLAY_TOP, ARENA_OVERLAY_BOTTOM, 2, ArenaPanel_OverlayCost, ArenaPanel_DrawOverlay},
    [ARENA_REGION_TEAM] = {ARENA_TEAM_TOP, ARENA_FIELD_BOTTOM, 0, ArenaHud_TeamCost, ArenaHud_DrawTeam},
    [ARENA_REGION_FIELD] = {ARENA_FIELD_HALF_Y, ARENA_FIELD_BOTTOM, 0, ArenaScreen_FieldCost, ArenaScreen_DrawField},
    [ARENA_REGION_PANEL] = {ARENA_FIELD_BOTTOM, DISPLAY_HEIGHT, 0, ArenaPanel_Cost, ArenaPanel_Draw},
};

// The panel goes first: its messages tell the battle. The top region and the crowd above it have their own pass.
static const u8 sRegionOrder[] = {ARENA_REGION_PANEL, ARENA_REGION_OVERLAY, ARENA_REGION_TEAM, ARENA_REGION_FIELD};

// TRUE when the scan has passed the line bottom and a draw of cost scanlines ends before the pass ends.
bool32 ArenaRaster_FitsBehindScan(u32 bottom, u32 cost)
{
    u32 line = REG_VCOUNT;

    return line >= bottom && line + cost <= (line < DISPLAY_HEIGHT ? PASS_END : ARENA_SCAN_LINES);
}

static u32 RegionCost(u32 region)
{
    return sRegions[region].cost();
}

static void DrawRegion(u32 region)
{
    sRegions[region].draw();
    gArenaScreen.raster.regionWaits[region] = 0;
    gArenaScreen.raster.drawnThisFrame |= 1 << region;
}

// The main loop waits for the VBlank after each pass, so a pass that ends after the VBlank costs a frame.
bool32 ArenaRaster_EndsInTime(u32 cost)
{
    u32 line = REG_VCOUNT;

    return line + cost <= (line < DISPLAY_HEIGHT ? PASS_END : ARENA_SCAN_LINES + PASS_END);
}

static bool32 IsLate(u32 region, u16 passFrame)
{
    return gArenaScreen.raster.regionWaits[region] >= MAX_WAIT && gMain.vblankCounter2 == passFrame;
}

// On the last pass of a frame, a wait for the scan costs nothing: the main loop waits for the VBlank after it.
static bool32 IsLastPass(void)
{
    return !Arena_AutoPlays() || gSaveBlock2Ptr->arenaSettings.speed == ARENA_SPEED_1X;
}

static void TryDrawRegion(u32 region, u16 passFrame)
{
    const struct ArenaRegion *info = &sRegions[region];
    u32 cost = RegionCost(region);
    u32 visibleCost = info->visibleCost != 0 ? info->visibleCost : cost;
    u32 line = REG_VCOUNT;
    bool32 late = IsLate(region, passFrame);

    if (cost == 0 || (gArenaScreen.raster.drawnThisFrame & (1 << region)) || (!late && !ArenaRaster_EndsInTime(cost)))
        return;
    if (late && !ArenaRaster_EndsInTime(cost) && line < DISPLAY_HEIGHT && IsLastPass() && gMain.vblankCounter2 == passFrame)
    {
        while (REG_VCOUNT <= DISPLAY_HEIGHT)
            ;
        line = REG_VCOUNT;
    }
    if (line + visibleCost > info->top && line < info->bottom)
        return;
    if (!late && line >= info->bottom && line + visibleCost > ARENA_SCAN_LINES + info->top)
        return;
    DrawRegion(region);
}

static void WaitForScan(u32 line, u32 cost, u32 region, u16 passFrame)
{
    if (REG_VCOUNT >= line || !IsLastPass() || (line >= DISPLAY_HEIGHT && gMain.vblankCounter2 != passFrame))
        return;
    if (line + cost > PASS_END && !IsLate(region, passFrame))
        return;
    while (REG_VCOUNT < line)
        ;
}

// The crowd is above the info boxes: both draw once the scan has passed the top region. The crowd checks the scan
// before each of its rows.
static void DrawTopAndCrowd(u16 passFrame)
{
    u32 bottom = sRegions[ARENA_REGION_TOP].bottom;
    u32 topCost, crowdCost;

    if (gArenaScreen.raster.drawnThisFrame & (1 << ARENA_REGION_TOP))
        return;
    topCost = RegionCost(ARENA_REGION_TOP);
    crowdCost = ArenaCrowd_Cost();
    if (topCost != 0 || crowdCost != 0)
        WaitForScan(bottom, max(topCost, crowdCost), ARENA_REGION_TOP, passFrame);
    if (REG_VCOUNT >= bottom)
    {
        TryDrawRegion(ARENA_REGION_TOP, passFrame);
        ArenaCrowd_Draw();
        gArenaScreen.raster.drawnThisFrame |= 1 << ARENA_REGION_TOP;
    }
}

void ArenaRaster_Draw(void)
{
    struct ArenaRaster *raster = &gArenaScreen.raster;
    u16 passFrame = gMain.vblankCounter2;
    u32 i, region, cost;

    if (gMain.vblankCounter2 != raster->lastFrame)
    {
        raster->lastFrame = gMain.vblankCounter2;
        raster->drawnThisFrame = 0;
        ArenaCrowd_Update();
        for (region = 0; region < ARENA_REGIONS; region++)
        {
            if (RegionCost(region) != 0 && raster->regionWaits[region] < 0xFF)
                raster->regionWaits[region]++;
        }
    }
    for (i = 0; i < ARRAY_COUNT(sRegionOrder); i++)
        TryDrawRegion(sRegionOrder[i], passFrame);
    DrawTopAndCrowd(passFrame);
    for (i = 0; i < ARRAY_COUNT(sRegionOrder); i++)
    {
        region = sRegionOrder[i];
        cost = RegionCost(region);
        if (cost != 0 && !(raster->drawnThisFrame & (1 << region)))
        {
            WaitForScan(sRegions[region].bottom, cost, region, passFrame);
            TryDrawRegion(region, passFrame);
        }
    }
}

// The stadium draw of a build has drawn the crowd.
void ArenaRaster_DrawAll(void)
{
    u32 region, draws;

    gArenaScreen.dirty = ARENA_DIRTY_ALL;
    ArenaCrowd_MarkDrawn();
    for (region = 0; region < ARENA_REGIONS; region++)
    {
        for (draws = 0; draws < MAX_DRAWS && RegionCost(region) != 0; draws++)
            DrawRegion(region);
    }
}
