# Coding standards

The reviewer applies these rules to each diff. The checks (`cd lab && bun run lint && bun run knip && bun run typecheck && bun test`) cover the mechanical rules; these rules need judgement.

## The docs follow the code

A change to one of these parts updates its docs in the same diff:

| Change | Docs to update |
| --- | --- |
| `observe()`, a Macro-action, a Raw input | `lab/README.md` (section "Run a Bot"), the Doc tab (`lab/viewer/index.html`) |
| The Atlas | `CONTEXT.md` (term **Atlas**), `lab/README.md` (section "The Atlas"), the Doc tab |
| A prompt of the model bot, its actions or its version | `lab/README.md` (section "The model bot"), the Doc tab (section "Bots"), `lab/HISTORY.md` |
| A term of the domain | `CONTEXT.md` |

Each sentence of these docs must stay true after the diff. A sentence that describes the old behaviour is a finding.

## The Viewer uses its design system

A UI change in `lab/viewer` builds its parts from the components that the Components tab of the Viewer shows, with the tokens of the theme (ADR 0004). These are findings:

- a part with its own colors, sizes, radius or motion when a component or a token already gives them;
- a new component that the Components tab does not show in all its states;
- a new component that the user did not ask for or agree to.
