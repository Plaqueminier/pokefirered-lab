import { expect, test } from "bun:test";
import { join } from "node:path";
import { modelBot } from "../bots/model";
import { MACRO_ACTIONS, type RawInput } from "../src/harness/harness";

const PAGE = join(import.meta.dir, "index.html");
const README = join(import.meta.dir, "..", "README.md");

async function texts(selector: string): Promise<string[]> {
  const found: string[] = [];
  await new HTMLRewriter()
    .on(selector, {
      element: () => void found.push(""),
      text: (chunk) => void (found[found.length - 1] += chunk.text),
    })
    .transform(new Response(Bun.file(PAGE)))
    .text();
  return found;
}

test("the Macro-action table of the Doc has one line for each Macro-action of the Harness", async () => {
  const names = (await texts("#doc-macro-actions tbody td:first-child code")).map((text) => text.match(/^\w+/)?.[0]);
  expect(names.sort()).toEqual([...MACRO_ACTIONS].sort());
});

test("the Doc names the Raw input", async () => {
  const raw: RawInput["name"] = "press";
  expect(await texts("#doc code")).toContainEqual(expect.stringMatching(new RegExp(`^${raw}\\(`)));
});

test("the README gives the version of the model bot", async () => {
  expect(await Bun.file(README).text()).toContain(`(\`bots/model.ts\`, version ${modelBot().version}, no goal)`);
});
