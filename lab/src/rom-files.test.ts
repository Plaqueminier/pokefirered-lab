import { expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { ROM_FILE, START_SAVE } from "./run";

// The tests that need the ROM or a save skip when the file is missing, so a
// suite with no ROM passes. This test makes that case fail. LAB_NO_ROM=1 accepts it.
test.skipIf(process.env.LAB_NO_ROM === "1")("the ROM, its .elf and the Starting save are present", () => {
  const missing = [ROM_FILE, ROM_FILE.replace(/\.gba$/, ".elf"), START_SAVE].filter((file) => !existsSync(file));
  expect(missing, "In a worktree, run ./worktree_setup.sh at its root. Else run 'make lab' and make the Starting save (lab/README.md).").toEqual([]);
});
