import { expect, test } from "bun:test";
import { addedLines, findings } from "./diff-rules";

const rules = (file: string, text: string) => findings([{ file, line: 1, text }]).map((f) => f.rule);

test("a sentence of a doc has 25 words at most", () => {
  const long = Array.from({ length: 26 }, (_, i) => `word${i}`).join(" ");
  expect(rules("CONTEXT.md", `${long}.`)).toEqual(["STE: sentence of more than 25 words"]);
  expect(rules("CONTEXT.md", "A short sentence. Another short one.")).toEqual([]);
  expect(rules("lab/src/game.ts", `// ${long}.`)).toEqual([]);
});

test("a table row and the code of a doc do not count as sentences", () => {
  const long = Array.from({ length: 30 }, () => "cell").join(" ");
  expect(rules("CODING_STANDARDS.md", `| ${long} |`)).toEqual([]);
  expect(rules("lab/README.md", `Run \`${long}\` in lab.`)).toEqual([]);
});

test("a doc has no phrasal verb, also with a pronoun between the verb and the particle", () => {
  expect(rules("lab/HISTORY.md", "The model goes back to the map.")).toEqual(["STE: phrasal verb"]);
  expect(rules("lab/HISTORY.md", "The Bot puts it back in the Bag.")).toEqual(["STE: phrasal verb"]);
  expect(rules("lab/viewer/doc-model.tsx", "<p>The program turns this off.</p>")).toEqual(["STE: phrasal verb"]);
  expect(rules("lab/HISTORY.md", "Each step rounds down.")).toEqual(["STE: phrasal verb"]);
  expect(rules("lab/HISTORY.md", "The model returns to the map.")).toEqual([]);
  expect(rules("CONTEXT.md", "An Evolution plays its own Runs out of this limit.")).toEqual([]);
});

test("a line of the Doc tab has 500 characters at most", () => {
  const sentences = Array.from({ length: 60 }, () => "A Run ends.").join(" ");
  expect(rules("lab/viewer/doc-model.tsx", `<p>${sentences}</p>`)).toEqual(["Doc tab: a line of more than 500 characters"]);
  expect(rules("lab/viewer/grid.tsx", `// ${sentences}`)).toEqual([]);
});

test("the Viewer takes colors, font sizes, radius and motion from the tokens", () => {
  expect(rules("lab/viewer/grid.tsx", `<span class="text-[10px] text-faint">`)).toHaveLength(1);
  expect(rules("lab/viewer/grid.tsx", `const LINE = "stroke-[#b07ae8]";`)).toHaveLength(1);
  expect(rules("lab/viewer/grid.tsx", `<div class="rounded-[3px]">`)).toHaveLength(1);
  expect(rules("lab/viewer/grid.tsx", `<div class="w-[240px] min-[900px]:flex text-xs rounded-sm">`)).toEqual([]);
});

test("a test makes no fake with `as unknown as`", () => {
  expect(rules("lab/src/harness/atlas.test.ts", "const game = {} as unknown as Game;")).toHaveLength(1);
  expect(rules("lab/src/harness/atlas.ts", "const game = {} as unknown as Game;")).toEqual([]);
});

test("the added lines of a diff keep their file and their line number", () => {
  const diff = ["diff --git a/CONTEXT.md b/CONTEXT.md", "--- a/CONTEXT.md", "+++ b/CONTEXT.md", "@@ -10,0 +11,2 @@", "+one", "+two", "+++ /dev/null", "@@ -1 +0,0 @@", "-gone"].join("\n");
  expect(addedLines(diff)).toEqual([
    { file: "CONTEXT.md", line: 11, text: "one" },
    { file: "CONTEXT.md", line: 12, text: "two" },
  ]);
});
