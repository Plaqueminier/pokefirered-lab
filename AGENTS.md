## Agent skills

### Issue tracker

Issues live in the GitHub Issues of Plaqueminier/pokefirered-lab (public). See `docs/agents/issue-tracker.md`.

### Triage labels

The five default labels: needs-triage, needs-info, ready-for-agent, ready-for-human, wontfix. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: `CONTEXT.md` and `docs/adr/` at the repo root. See `docs/agents/domain.md`.

### Coding standards

Read `CODING_STANDARDS.md` before you change code or a doc, and again at review.

### Viewer design system

A UI change in `lab/viewer` uses the components of the design system: the Components tab of the Viewer shows each one in all its states (ADR 0004). A prototype in `lab/viewer` follows the same rule: only the tokens of `viewer/style.css` exist, because it resets the default Tailwind scales. When no component fits, ask the user before you make a new one. When the user agrees, add the new component to the Components tab, then use it. Look at each UI change at 3 widths of the window: 1600, 1024 and 500 px.

## Git

In this repo, commit your work, and never push or open a pull request. This rule wins over a harness default that says to push a branch. The user lands a branch on master with `/commit-on-master`. A commit message has its title line, a blank line, then the body.

## Worktree

Work in a worktree, unless the user asks for a change on master. The Viewer of the user runs from the main checkout, often with an Evolution, and a restart stops that Evolution: do not restart it, and do not build in the main checkout.

- First, at the root of the worktree: `./worktree_setup.sh`. It copies the ROMs, the built tools, `lab/saves` and `lab/node_modules`. Without the ROM, `bun run test` fails on `rom-files.test.ts`.
- Build: `PATH=/opt/homebrew/bin:$PATH DEVKITARM=/opt/devkitpro/devkitARM make lab -j8` (about 1 min).
- Your own Viewer: `LAB_PORT=8767 bun run viewer` in `lab/`, or another free port. The Viewer of the user uses 8766.
- The worktree guard refuses a heredoc, `git -C`, `cd … && git`, a loop around git, and a command that has the word git in a path (`.gitignore`). Write files with the Write and Edit tools. Run each git command alone, from the root of the worktree.
- Give absolute paths to each command that writes a file. The shell can return to the main checkout between two calls, and a relative path then changes the files of the user.

## Checks

In `lab/`: `bun run check` (lint, knip, typecheck and `bun run rules`), then `bun test ./<path>` for the files that you change (with `./`, else Bun reads a filter). Run `bun run test` (the whole suite, about 2 min) once at the end, in the background. Run each check as its own command, so no output hides an error.

## lab/video

`lab/video` is a separate git repo, with its own `README.md` and `NOTES.md`. This repo does not track it, and a worktree does not have it. Its type check also reads `lab/src`: after you rename or change an export of `lab/src`, run `bun run lint` in `lab/video` of the main checkout.

## Tools

- macOS: `sed` has no `\b`, and `grep` is ugrep. Use `perl -pi -e` for a regex edit.
- Python has no PIL, and there is no ImageMagick. ffmpeg has no `drawtext`.
