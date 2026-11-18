import { describe, expect, setDefaultTimeout, test } from "bun:test";
import { existsSync } from "node:fs";
import { KIND } from "./cells";
import { mapScriptCells } from "./game";
import { Harness } from "./harness/harness";
import { kindAt } from "./harness/path";
import { ROM_FILE, Run, START_SAVE } from "./run";

setDefaultTimeout(60_000);

describe.skipIf(!existsSync(ROM_FILE) || !existsSync(START_SAVE))("the view of another map", () => {
  test("it takes the cells of the last step on the map, and the rest of the ROM grid", async () => {
    const run = await Run.open();
    try {
      await Harness.open({}, run);
      const rom = run.game.mapView("PalletTown");
      if (!rom) throw new Error("no PalletTown");
      const lastStepCells = { ...mapScriptCells(rom.grid), kinds: "#".repeat(rom.grid.kinds.length) };
      const view = run.game.mapView("PalletTown", lastStepCells);
      expect(view?.grid.kinds).toBe(lastStepCells.kinds);
      expect(view?.grid.warps).toEqual(rom.grid.warps);
    } finally {
      run.core.close();
    }
  });

  test("water at the elevation of the shore (3) is open: the player walks on it with no SURF", async () => {
    const run = await Run.open();
    try {
      await Harness.open({}, run);
      const grid = run.game.mapView("Route14")?.grid;
      if (!grid) throw new Error("no Route14");
      expect([kindAt(grid, { x: 22, y: 56 }), kindAt(grid, { x: 23, y: 56 }), kindAt(grid, { x: 22, y: 50 })]).toEqual([KIND.open, KIND.open, KIND.water]);
    } finally {
      run.core.close();
    }
  });
});
