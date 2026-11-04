# Lab harness

The harness runs the **Lab build** in libmgba from Bun. A **Bot** plays the game through **Macro-actions**. The **Viewer** shows the **Runs** in the browser: several in its **Grid**, and one in detail.

- Terms: `../CONTEXT.md`. Decisions: `../docs/adr/`. Steps of the lab: `HISTORY.md`.
- What the harness can do now: the Doc tab of the Viewer.

## Requirements

Homebrew `mgba` (for `libmgba` and its headers), the macOS `dwarfdump`, and a C compiler. The harness compiles `shim/shim.c` into `.cache/` when the file changes.

## Run the Viewer

1. At the repo root: `make lab -j8`. This gives `pokefirered_modern_lab.gba` and its `.elf` with debug info.
2. In `lab/`: `bun install`, then `bun run viewer`.
3. Open http://localhost:8766. For another port: `LAB_PORT=8767 bun run viewer`.

## Make the Starting save

1. Start the Viewer with no `saves/start.sav`. The game then starts as the vanilla game.
2. Play to your room and set the text speed to "Fast".
3. Save in the game, and wait for the end of the save.
4. Click "Write the Starting save" (the icon at the right of the screen controls), then click it again in the next 3 s. The harness writes `saves/start.sav` and keeps the previous file next to it. After a replay with names, it refuses until you reset the game, because the save of the emulator holds these names. The savestate also refuses during that time.

## Run a Bot

The lab has one **Bot**: the model bot (`bots/model.ts`, version 22, no goal). It asks an AI model for each decision, through its **Model provider** (ADR 0003, ADR 0005, ADR 0007).

1. Prepare the provider:
   - `openrouter` (the default): put a key with a credit limit in `lab/.env`: `OPENROUTER_API_KEY=sk-or-...`. Git ignores this file. OpenRouter bills each call.
   - `claude-code`: install Claude Code, and log in with your subscription (`claude auth login`).
   - `codex`: `bun install` in `lab/` gives Codex at a fixed version. Log in with your ChatGPT subscription (`node_modules/.bin/codex login`).
   - `grok`: install Grok Build, and log in one time for the lab, in its own folder (`GROK_HOME=~/.grok-lab grok login`).
2. In `lab/`:

```
bun run bot model [<model id>] [player|full] [--provider openrouter|claude-code|codex|grok] [--cost-limit <dollars>] [--token-limit <millions of tokens>] [--reasoning off|low|medium|high]
  [--thinking off|low|medium|high] [--temperature <0 to 2>] [--starter free|BULBASAUR|CHARMANDER|SQUIRTLE] [--no-stop-at-whiteout] [--continue <Run record>]
```

The default models are `deepseek/deepseek-v4.1-flash`, `haiku`, `gpt-5.6-luna` and `grok-4.7`. A **Plan provider** (`claude-code`, `codex`, `grok`) uses the quota of the subscription, and your own work uses the same quota. It takes `--token-limit` in millions of tokens (`0.5` is 500,000 tokens, and the default is 1) and refuses `--cost-limit` and `--temperature`; `openrouter` refuses `--token-limit`. At the end of the quota, the **Run** ends with `plan limit`, and you continue it later with `--continue`. The page "Model providers" of the Doc tab tells how to log in, which Token limit to choose and what to do when a provider does not start.

The command writes the **Run record** to `runs/<id>-<bot>-<version>-<date>.json`: `<id>` is the number of the **Run**, on 5 digits (`00001`), so the files sort in the order of the **Runs**. The Viewer can start a **Bot** (button "Bots"), continue a **Run**, keep the same **Run** (the checkbox "Keep the same Run": an **Extended Run** replaces the file of its **Run record**, with the same name, so the version in the name can be older than the version in the header), and replay a **Run record** (the Select of the top bar).

## Make a Race

A **Race** plays many **Run records** on a map of Kanto, in the Race tab of the Viewer. It needs the track and the State track of each record, and a record below format 3 does not have them.

1. Once, in `lab/`: `bun run migrate`. It replays each record of `runs/` below format 3, and writes its track and its State track in the file. A record whose replay does not end on the last frame of its buttons, or does not give its maps and battles, keeps its file.
2. In `lab/`: `bun run race <name> [records…]`. It writes `races/<name>.json.gz`. With no record named, it takes all the records of the model bots. A record is a file name, or the start of one file name (`00012`). A record with an empty track stays out, a record with no Run id at the start of its name stays out, and a record that another record of the Race continues stays out: the command names them. A record of another Bot is refused, and a record below format 3 is refused with the name of the migration. A Race file of an older version does not open: make it again.

## Checks

In `lab/`: `bun run lint && bun run knip && bun run typecheck && bun test`.

## Files

- `shim/`, `src/core.ts`, `src/symbols.ts`, `src/memory.ts`: the emulator and the typed reads of its memory.
- `src/game.ts` and the files next to it: the reads of the game state (battle, menus, Bag, PC, shop, party).
- `src/harness/`: the API of the **Bot**, the **Atlas**, the **Run record** and the pool of **Runs**.
- `src/model/`: the parts of the model bot (request, prompt, answer).
- `src/race/`: the file of a **Race**, the command that makes it, and the world of the Race tab, read from the ROM (the maps, the sprites of the Ghosts and the icons of the Pokémon).
- `src/server.ts` and `viewer/`: the Viewer.
- `bots/`: the **Bots**.

`saves/`, `runs/`, `races/` and `.cache/` are not in git. Never put a ROM in git or on a public URL.
