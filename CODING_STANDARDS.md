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
