# Coding standards

The implementer reads these rules before the work, and the reviewer applies them to each diff. The checks cover the mechanical rules: `cd lab && bun run check && bun run test`. `bun run check` runs lint, knip, typecheck and `bun run rules`. `bun run rules` checks the new lines of the diff since master, and the pre-commit hook runs it on the staged lines. It finds:

- a sentence of a doc with more than 25 words, and a phrasal verb;
- a line of the Doc tab (`lab/viewer/doc-*.tsx`) with more than 500 characters;
- a value of the Viewer that a token gives;
- a cast of a test fake.
 The rules below need judgement.

## The docs follow the code

A change to one of these parts updates its docs in the same diff:

| Change | Docs to update |
| --- | --- |
| `observe()`, a Macro-action, a Raw input | the Doc tab (`lab/viewer/doc-harness.tsx`, the page "The loop" in `lab/viewer/doc-overview.tsx`, and the loop diagram in `lab/viewer/doc-diagrams.tsx`) |
| The Atlas | `CONTEXT.md` (term **Atlas**), the Doc tab (pages "Principle", "Macro-actions", "Run record", "Prompt and actions" and "Stuck, reflection and review") |
| A prompt of the model bot, its actions or its version | the Doc tab (`lab/viewer/doc-model.tsx`, pages "Bots", "Prompt and actions", "Stuck, reflection and review" and "Memory tree"; the pages "The loop", "Milestones" and "End of a Run"; the two diagrams in `lab/viewer/doc-diagrams.tsx`), `lab/HISTORY.md`, the version in `lab/README.md` |
| A command, an option, a setup step or a folder of `lab/` | `lab/README.md` |
| A term of the domain | `CONTEXT.md` |
| An export of `lab/src` that `lab/video` uses | `lab/video` (a separate repo: see `AGENTS.md`) |

Each sentence of these docs must stay true after the diff. A sentence that describes the old behaviour is a finding.

The version of the model bot is `BOT_VERSION` in `lab/src/model/opening.ts`. The tests read it, and a test checks the version in `lab/README.md`. A new version also gets its step in `lab/HISTORY.md`.

`lab/HISTORY.md` tells the steps of the model bot, and of the Harness and the Viewer that it uses. The **Genetic bot** and its **Evolutions** get no step there.

## The docs use Simplified Technical English

The docs, the comments and the commit messages use ASD-STE100: one meaning for each word, the terms of `CONTEXT.md`, active voice, and short sentences (25 words at most). A verb has no particle: `return`, not `go back`; `continue`, not `go on`; `stop`, not `turn off`. A list of more than 3 items goes in a Markdown list or a table, not in one long sentence. `bun run rules` finds the long sentences and the phrasal verbs of the new lines. The reviewer finds the rest: a word with two meanings, a passive verb, or a term that `CONTEXT.md` tells you to avoid.

## The Viewer uses its design system

A UI change in `lab/viewer` builds its parts from the components that the Components tab of the Viewer shows, with the tokens of the theme (ADR 0004). These are findings:

- a part with its own colors, sizes, radius or motion when a component or a token already gives them;
- a new component that the Components tab does not show in all its states;
- a new component that the user did not ask for or agree to;
- a copy of a helper that another file of `lab/viewer` or `lab/src` already has.

## Test fakes

A fake of a class takes the narrow type that the code under test reads (`AtlasGame`, `MenuGame`), with `fake<T>()` of `lab/src/harness/fakes.ts`. Then a new member that the code reads fails the typecheck at the fake.
