import { expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

// The files of the design system (ADR 0004). Each component that they export shows in the Components tab.
const DIR = import.meta.dir;
const files = readdirSync(DIR);
const designSystem = files.filter((file) => /^components(-(?!tab)[a-z]+)?\.tsx$/.test(file) || file === "pokemon.tsx");
const tab = files
  .filter((file) => /^components-tab[a-z-]*\.tsx$/.test(file))
  .map((file) => readFileSync(join(DIR, file), "utf8"))
  .join("\n");

test("the Components tab shows each component of the design system", () => {
  const missing = designSystem.flatMap((file) =>
    [...readFileSync(join(DIR, file), "utf8").matchAll(/^export function ([A-Z]\w*)/gm)].map((m) => m[1]).filter((name) => !new RegExp(`\\b${name}\\b`).test(tab)).map((name) => `${file}: ${name}`),
  );
  expect(missing, "Add each new component to a components-tab*.tsx file, in all its states").toEqual([]);
});

test("the design system has its files", () => {
  expect(designSystem).toContain("components.tsx");
  expect(designSystem).toContain("pokemon.tsx");
});
