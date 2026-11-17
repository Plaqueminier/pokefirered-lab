// The rules of CODING_STANDARDS.md that a program can check, on the lines that a diff adds.
// The old lines stay as they are: the rules apply to new text and new code only.
// `bun run rules` checks the work since master (commits, changes and new files).
// `bun run rules --staged` checks the staged changes (the pre-commit hook).

export type AddedLine = { file: string; line: number; text: string };
export type Finding = AddedLine & { rule: string; detail: string };

const MAX_WORDS = 25;
// A line of the Doc tab can hold a whole page, and a long line is hard to read and to edit.
const MAX_DOC_LINE = 500;

// Verb + particle pairs that ASD-STE100 does not allow. A pronoun can come between them ("puts it back").
// The match is in lower case, so "Runs out" (the term **Run**) is not a verb.
const PHRASAL_VERBS: Record<string, string[]> = {
  on: ["go", "carry", "hold"],
  off: ["turn", "switch", "take", "set", "shut", "cut"],
  up: ["set", "pick", "look", "give", "end", "show", "make", "speed", "clean", "wake", "come", "fill", "sum"],
  out: ["find", "carry", "point", "figure", "run", "sort", "work", "fill", "rule", "leave", "try", "check", "print"],
  back: ["put", "go", "come", "give", "bring", "get", "send", "fall"],
  down: ["slow", "shut", "write", "break", "narrow", "calm"],
  over: ["take", "hand"],
  away: ["go", "give", "throw", "put"],
};

function forms(verb: string): string[] {
  const irregular: Record<string, string[]> = {
    go: ["go", "goes", "went", "gone", "going"],
    come: ["come", "comes", "came", "coming"],
    give: ["give", "gives", "gave", "given", "giving"],
    take: ["take", "takes", "took", "taken", "taking"],
    make: ["make", "makes", "made", "making"],
    find: ["find", "finds", "found", "finding"],
    run: ["run", "runs", "ran", "running"],
    put: ["put", "puts", "putting"],
    set: ["set", "sets", "setting"],
    cut: ["cut", "cuts", "cutting"],
    shut: ["shut", "shuts", "shutting"],
    get: ["get", "gets", "got", "getting"],
    bring: ["bring", "brings", "brought", "bringing"],
    send: ["send", "sends", "sent", "sending"],
    hold: ["hold", "holds", "held", "holding"],
    keep: ["keep", "keeps", "kept", "keeping"],
    leave: ["leave", "leaves", "left", "leaving"],
    write: ["write", "writes", "wrote", "written", "writing"],
    break: ["break", "breaks", "broke", "broken", "breaking"],
    throw: ["throw", "throws", "threw", "thrown", "throwing"],
    fall: ["fall", "falls", "fell", "fallen", "falling"],
    wake: ["wake", "wakes", "woke", "waking"],
    show: ["show", "shows", "showed", "shown", "showing"],
  };
  if (irregular[verb]) return irregular[verb];
  const stem = verb.endsWith("e") ? verb.slice(0, -1) : verb;
  const s = /(s|sh|ch|x)$/.test(verb) ? `${verb}es` : verb.endsWith("y") && !/[aeiou]y$/.test(verb) ? `${verb.slice(0, -1)}ies` : `${verb}s`;
  const ed = verb.endsWith("y") && !/[aeiou]y$/.test(verb) ? `${verb.slice(0, -1)}ied` : `${stem}ed`;
  return [verb, s, ed, `${stem}ing`];
}

const PHRASAL = new RegExp(
  `\\b(${Object.entries(PHRASAL_VERBS)
    .flatMap(([particle, verbs]) => verbs.map((verb) => `(?:${forms(verb).join("|")})(?:\\s+(?:it|them|him|her|this|that))?\\s+${particle}`))
    .join("|")})\\b`,
  "u",
);

/** The text of a line of a doc, with no code, tags, JSX expressions or Markdown marks. */
function proseOf(file: string, text: string): string {
  let prose = text.replace(/`[^`]*`/g, "X");
  if (file.endsWith(".tsx")) prose = prose.replace(/<[^>]*>/g, " ").replace(/\{[^{}]*\}/g, " ");
  return prose.replace(/\*\*|__|^\s*(?:[-*]|\d+\.)\s+/g, "");
}

const sentencesOf = (prose: string) => prose.split(/(?<=[.!?:;])\s+/).filter((sentence) => /[a-z]/i.test(sentence));
const wordsOf = (sentence: string) => sentence.match(/[\p{L}\p{N}'’-]+/gu) ?? [];

const isDoc = (file: string) =>
  /^(CONTEXT|CODING_STANDARDS|AGENTS|CLAUDE)\.md$/.test(file) || /^docs\/(adr|agents)\/.*\.md$/.test(file) || /^lab\/(README|HISTORY)\.md$/.test(file) || /^lab\/viewer\/doc-[^/]*\.tsx$/.test(file);
const isViewer = (file: string) => /^lab\/viewer\/.*\.tsx?$/.test(file) && !file.endsWith(".test.ts");
// The test of these rules holds examples of each finding.
const isTest = (file: string) => /\.test\.tsx?$/.test(file) && !file.endsWith("checks/diff-rules.test.ts");

// Values that the theme gives as tokens: colors, font sizes, radius, fonts, motion, line height and letter spacing.
const OFF_THEME = /\b(?:(?:text|bg|border|ring|fill|stroke|outline|decoration|shadow|from|via|to)-\[(?:#|rgb|hsl|oklch|\d)|(?:rounded|font|duration|delay|ease|leading|tracking)-\[)/;

export function findings(lines: readonly AddedLine[]): Finding[] {
  const found: Finding[] = [];
  for (const added of lines) {
    const { file, text } = added;
    if (isDoc(file) && !/^\s*\|/.test(text)) {
      const prose = proseOf(file, text);
      for (const sentence of sentencesOf(prose)) {
        const count = wordsOf(sentence).length;
        if (count > MAX_WORDS) found.push({ ...added, rule: "STE: sentence of more than 25 words", detail: `${count} words: "${sentence.trim().slice(0, 90)}…"` });
      }
      const phrasal = prose.match(PHRASAL);
      if (phrasal) found.push({ ...added, rule: "STE: phrasal verb", detail: `"${phrasal[0]}"` });
    }
    if (/^lab\/viewer\/doc-[^/]*\.tsx$/.test(file) && text.length > MAX_DOC_LINE)
      found.push({ ...added, rule: "Doc tab: a line of more than 500 characters", detail: `${text.length} characters: put one sentence on each line, with the break between two sentences of text (JSX joins them with a space), not next to a tag or a {…}` });
    if (isViewer(file)) {
      const value = text.match(OFF_THEME);
      if (value) found.push({ ...added, rule: "Viewer: a value that a token of viewer/style.css gives", detail: `"${value[0]}…": use a token or a component, or ask the user` });
    }
    if (isTest(file) && /\bas unknown as\b/.test(text)) found.push({ ...added, rule: "Test: a cast that hides the missing members of a fake", detail: "use a typed fake (see src/harness/fakes.ts)" });
  }
  return found;
}

/** The added lines of a `git diff --unified=0` output. */
export function addedLines(diff: string): AddedLine[] {
  const lines: AddedLine[] = [];
  let file = "";
  let next = 0;
  for (const row of diff.split("\n")) {
    if (row.startsWith("+++ ")) file = row.slice(4).replace(/^b\//, "");
    else if (row.startsWith("@@")) next = Number(/\+(\d+)/.exec(row)?.[1] ?? 0);
    else if (row.startsWith("+") && file !== "/dev/null") lines.push({ file, line: next++, text: row.slice(1) });
  }
  return lines;
}

async function git(args: string[]): Promise<string> {
  const child = Bun.spawn(["git", ...args], { stdout: "pipe", stderr: "inherit" });
  const out = await new Response(child.stdout).text();
  if ((await child.exited) !== 0) throw new Error(`git ${args.join(" ")} failed`);
  return out;
}

async function changedLines(staged: boolean): Promise<AddedLine[]> {
  const root = (await git(["rev-parse", "--show-toplevel"])).trim();
  process.chdir(root);
  if (staged) return addedLines(await git(["diff", "--cached", "--unified=0", "--no-color", "--no-ext-diff"]));
  const base = (await git(["merge-base", "HEAD", "master"])).trim();
  const lines = addedLines(await git(["diff", base, "--unified=0", "--no-color", "--no-ext-diff"]));
  for (const file of (await git(["ls-files", "--others", "--exclude-standard"])).split("\n").filter(Boolean)) {
    const text = await Bun.file(file).text();
    text.split("\n").forEach((row, i) => lines.push({ file, line: i + 1, text: row }));
  }
  return lines;
}

if (import.meta.main) {
  const found = findings(await changedLines(process.argv.includes("--staged")));
  for (const f of found) console.log(`${f.file}:${f.line}: ${f.rule}: ${f.detail}`);
  if (found.length > 0) {
    console.log(`\n${found.length} findings on the new lines. The rules are in CODING_STANDARDS.md.`);
    process.exit(1);
  }
}
