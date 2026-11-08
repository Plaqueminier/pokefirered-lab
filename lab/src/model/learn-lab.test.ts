import { describe, expect, test } from "bun:test";
import { type Moment, outcomeOf, readBlock, variantPrompt } from "./learn-lab";

const USER = [
  "Party:",
  "1. Sage (IVYSAUR): level 16, HP 40/40, status none. Type GRASS, POISON. Ability OVERGROW: x. Held item none.",
  "  - TACKLE: NORMAL, power 35, accuracy 95, PP 35/35. A hit.",
  "  - MAGNITUDE: GROUND, power ---, accuracy 100, PP 30/30. A quake.",
  "",
  "Sage wants to learn SLEEP POWDER (GRASS, power ---, accuracy 75, PP 15/15). Sleep.",
  "It already knows 4 moves. To learn SLEEP POWDER, it must forget one of them:",
  "- 1. TACKLE: NORMAL, power 35, accuracy 95, PP 35/35. A hit.",
  "- 2. POISONPOWDER: POISON, power ---, accuracy 75, PP 35/35. Poison.",
  "- 3. LEECH SEED: GRASS, power ---, accuracy 90, PP 10/10. Seed.",
  "- 4. VINE WHIP: GRASS, power 35, accuracy 100, PP 6/10. A whip.",
  "This is an important choice. Before you choose, count your damage moves and compare their PP.",
  "",
  "Mission: Beat Brock.",
].join("\n");

const block = readBlock(USER);
if (!block) throw new Error("the prompt of the test is not read");
const moment: Moment = { ...block, id: "x", run: "x", version: "28", model: "m", action: "keep", reason: "", prompt: { system: "", user: USER } };

describe("readBlock", () => {
  test("reads the Pokémon, the new move and the known moves with their maximum PP", () => {
    expect([block.mon, block.species, block.level, block.types]).toEqual(["Sage", "IVYSAUR", 16, ["GRASS", "POISON"]]);
    expect(block.newMove).toEqual({ name: "SLEEP POWDER", type: "GRASS", power: "none", maxPp: 15 });
    expect(block.known[3]).toEqual({ name: "VINE WHIP", type: "GRASS", power: 35, maxPp: 10 });
  });
});

describe("readBlock with two Pokémon of the same nickname", () => {
  test("the moves of the question tell which Pokémon learns", () => {
    const twin = ["1. Sage (METAPOD): level 10, HP 9/9, status none. Type BUG. Ability SHED SKIN: x. Held item none.", "  - HARDEN: NORMAL, power ---, accuracy ---, PP 30/30. Hard."];
    const lines = USER.split("\n");
    const learner = [lines[1].replace("1. ", "2. "), ...["TACKLE", "POISONPOWDER", "LEECH SEED", "VINE WHIP"].map((name) => `  - ${name}: NORMAL, power 35, accuracy 95, PP 35/35. A hit.`)];
    const read = readBlock([lines[0], ...twin, ...learner, ...lines.slice(4)].join("\n"));
    expect(read?.species).toBe("IVYSAUR");
    expect(read?.level).toBe(16);
  });
});

describe("readBlock with the question of bot version 29", () => {
  test("reads the species after the nickname and the maximum PP", () => {
    const user = USER.replace("Sage wants to learn SLEEP POWDER (GRASS, power ---, accuracy 75, PP 15/15)", "Sage (IVYSAUR) wants to learn SLEEP POWDER (GRASS, power ---, accuracy 75, max PP 15)").replace("- 4. VINE WHIP: GRASS, power 35, accuracy 100, PP 6/10.", "- 4. VINE WHIP: GRASS, power 35, accuracy 100, max PP 10.");
    const read = readBlock(user);
    expect([read?.mon, read?.species, read?.newMove.maxPp, read?.known[3].maxPp]).toEqual(["Sage", "IVYSAUR", 15, 10]);
  });
});

describe("outcomeOf", () => {
  test("a forget by name or by place leaves the same moves", () => {
    expect(outcomeOf(moment, "forget TACKLE")).toEqual(outcomeOf(moment, "forget 1"));
  });

  test("forgetting a damage move for a status move, with status moves left, is flagged and leaves one damage move", () => {
    expect(outcomeOf(moment, "forget TACKLE")).toMatchObject({ forgets: "TACKLE", oneDamage: true, noStab: false, statusOverDamage: true });
  });

  test("forgetting the only STAB damage move is flagged", () => {
    expect(outcomeOf(moment, "forget VINE WHIP")?.noStab).toBe(true);
  });

  test("keep forgets nothing, and another answer is not read", () => {
    expect(outcomeOf(moment, "keep")?.forgets).toBeNull();
    expect(outcomeOf(moment, "go A")).toBeNull();
    expect(outcomeOf(moment, "forget SURF")).toBeNull();
  });
});

describe("variantPrompt", () => {
  test("base is the recorded prompt", () => {
    expect(variantPrompt(moment, "base").user).toBe(USER);
  });

  test("zero gives power 0 to a status move and power varies to a move with varying damage", () => {
    const { user } = variantPrompt(moment, "zero");
    expect(user).toContain("POISONPOWDER: POISON, power 0,");
    expect(user).toContain("SLEEP POWDER (GRASS, power 0,");
    expect(user).toContain("MAGNITUDE: GROUND, power varies,");
    expect(user).not.toContain("power ---");
  });

  test("maxpp hides the PP of the moment in the list only", () => {
    const { user } = variantPrompt(moment, "maxpp");
    expect(user).toContain("- 4. VINE WHIP: GRASS, power 35, accuracy 100, max PP 10.");
    expect(user).toContain("SLEEP POWDER (GRASS, power ---, accuracy 75, max PP 15)");
    expect(user).toContain("  - TACKLE: NORMAL, power 35, accuracy 95, PP 35/35.");
    expect(user).toContain("A Pokémon Center gives back all the PP");
  });

  test("after tells what each answer leaves, also with maxpp", () => {
    const { user } = variantPrompt(moment, "after+maxpp");
    expect(user).toContain("max PP 35. A hit. If you forget it: Sage then has 1 damage move: VINE WHIP (GRASS, STAB, max PP 10).");
    expect(user).toContain("If you keep your moves: Sage then has 2 damage moves:");
  });

  test("nohint removes the hint, and guide replaces it", () => {
    expect(variantPrompt(moment, "nohint").user).not.toContain("compare their PP");
    const { user } = variantPrompt(moment, "guide");
    expect(user).not.toContain("compare their PP");
    expect(user).toContain("Keep damage moves of two types");
  });

  test("two adds its line after the list, and it stays after the lines of after and maxpp", () => {
    const lines = variantPrompt(moment, "two+after+maxpp").user.split("\n");
    const two = lines.findIndex((line) => line.startsWith("Keep at least 2 damage moves"));
    expect(two).toBeGreaterThan(lines.findIndex((line) => line.startsWith("If you keep your moves")));
    expect(two).toBeGreaterThan(lines.findIndex((line) => line.startsWith("A Pokémon Center gives back")));
    expect(lines[two + 1]).toStartWith("This is an important choice.");
  });

  test("types tells when a move is the only damage move of its type, and the new move can keep the type", () => {
    const { user } = variantPrompt(moment, "types");
    expect(user).toContain("A hit. You lose your only NORMAL damage move.");
    expect(user).toContain("A whip. You lose your only GRASS damage move.");
    expect(user).not.toContain("Poison. You lose");
    const grass = { ...moment, newMove: { name: "RAZOR LEAF", type: "GRASS", power: 55, maxPp: 25 } };
    expect(variantPrompt(grass, "types").user).not.toContain("A whip. You lose");
  });

  test("refuse tells in the question that the Pokémon can refuse the move", () => {
    expect(variantPrompt(moment, "refuse").user).toContain("To learn SLEEP POWDER, it must forget one of them, or you can refuse it with keep");
  });

  test("an unknown edit is refused", () => {
    expect(() => variantPrompt(moment, "nope")).toThrow("nope");
  });
});
