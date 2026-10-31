import { expect, test } from "bun:test";
import { join } from "node:path";
import { modelBot } from "../bots/model";
import { MACRO_ACTIONS, type RawInput } from "../src/harness/harness";
import { MACRO_DOC, RAW_INPUT_FORM } from "./doc-harness";

const README = join(import.meta.dir, "..", "README.md");

test("the Macro-action page of the Doc has one entry for each Macro-action of the Harness", () => {
  const names = MACRO_DOC.map(({ form }) => form.match(/^\w+/)?.[0]);
  expect(names.sort()).toEqual([...MACRO_ACTIONS].sort());
});

test("the Doc names the Raw input", () => {
  const raw: RawInput["name"] = "press";
  expect(RAW_INPUT_FORM).toStartWith(`${raw}(`);
});

test("the README gives the version of the model bot", async () => {
  expect(await Bun.file(README).text()).toContain(`(\`bots/model.ts\`, version ${modelBot().version}, no goal)`);
});
