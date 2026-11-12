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

The lab has two **Bots**: the model bot (`bots/model.ts`, version 41, no goal) and the **Genetic bot** (see "Run the Genetic bot"). The model bot asks an AI model for each decision, through its **Model provider** (ADR 0003, ADR 0005, ADR 0007). At the `player` **Knowledge level**, it sees 3 x 3 cells on a **Dark map** until a Pokémon of its party can use FLASH: the program then uses the move, with no **Model call**.

1. Prepare the provider:
   - `openrouter` (the default): put a key with a credit limit in `lab/.env`: `OPENROUTER_API_KEY=sk-or-...`. Git ignores this file. OpenRouter bills each call.
   - `claude-code`: install Claude Code, and log in with your subscription (`claude auth login`).
   - `codex`: `bun install` in `lab/` gives Codex at a fixed version. Log in with your ChatGPT subscription (`node_modules/.bin/codex login`).
   - `grok`: install Grok Build, and log in one time for the lab, in its own folder (`GROK_HOME=~/.grok-lab grok login`).
2. In `lab/`:

```
bun run bot model [<model id>] [player|full] [--provider openrouter|claude-code|codex|grok] [--cost-limit <dollars>] [--token-limit <millions of tokens>] [--reasoning off|low|medium|high]
  [--thinking off|low|medium|high] [--coach <model id>] [--temperature <0 to 2>] [--starter free|BULBASAUR|CHARMANDER|SQUIRTLE] [--no-stop-at-whiteout] [--continue <Run record>]
```

The default models are `deepseek/deepseek-v4.1-flash`, `claude-haiku-5-5`, `gpt-5.6-luna` and `grok-4.7`. On `claude-code`, the aliases `haiku`, `sonnet`, `opus` and `fable` become the full ids `claude-haiku-5-5`, `claude-sonnet-5-5`, `claude-opus-5-5` and `claude-fable-5-1`. To use a later version, give its full id. A **Plan provider** (`claude-code`, `codex`, `grok`) uses the quota of the subscription, and your own work uses the same quota. It takes `--token-limit` in millions of tokens (`0.5` is 500,000 tokens, and the default is 1) and refuses `--cost-limit` and `--temperature`; `openrouter` refuses `--token-limit`. At the end of the quota, the **Run** ends with `plan limit`, and you continue it later with `--continue`. `--coach` gives the **Run** a **Coach** on the same provider: it plays the Character, Reflection and Review turns, the Summary calls and the move to forget, at the `--thinking` level, which the player then never uses. A Coach with the model of the Run is no Coach. The page "Model providers" of the Doc tab tells how to log in, which Token limit to choose and what to do when a provider does not start.

The command writes the **Run record** to `runs/<id>-<bot>-<version>-<date>.json`: `<id>` is the number of the **Run**, on 5 digits (`00001`), so the files sort in the order of the **Runs**. The Viewer can start a **Bot** (button "Bots"), continue a **Run**, keep the same **Run** (the checkbox "Keep the same Run": an **Extended Run** replaces the file of its **Run record**, with the same name, so the version in the name can be older than the version in the header), and replay a **Run record** (the Select of the top bar).

## Run the Genetic bot

The **Genetic bot** (`bots/genetic.ts`, version 1, no goal) plays with a **Genome**, and asks no AI model (ADR 0008). The **Genome** is a JSON file of weights from -1 to 1, for example:

```
{"walk": {"notUsed": 1, "isExit": 1, "previousMap": -1, "isPerson": -1, "isSign": -1, "unknownNeighbours": 1, "distance": -0.2}}
```

At each walk **Decision point**, the **Bot** lists the seen exits, people and signs, and each seen cell that the player can reach. It gives each action the score Σ weight × criterion, and plays the action with the best score. A criterion with no weight has the weight 0. Version 1 has the criteria of the walk only: at a choice, a battle or another menu, it plays the first action of the **Harness**, after `leave` and `keep`. The page "Genome and criteria" of the Doc tab gives each criterion.

In `lab/`:

```
bun run bot genetic --genome <Genome file> [player|full]
```

The **Run** starts from the Starting save, and ends with `no progress` when the **Stuck counter** reaches 60. The command writes the **Run record** to `runs/` as for the model bot, and the Viewer replays it. The Viewer cannot start the **Genetic bot**.

## Test the learn-move prompt

`bun run learn-lab` asks models again at the learn-move questions of the **Run records**, with the recorded prompt or with a changed prompt. No game runs. The files go to `evals/learn-move/`, which Git ignores.

```
bun run learn-lab extract
bun run learn-lab show <moment> [--variants <variant>]
bun run learn-lab run --models <provider>:<id>[@<reasoning>],... [--variants <variant>,...] [--only <regex>] [--repeats <n>] [--cost-limit <dollars>] [--concurrency <n>]
bun run learn-lab report [--variants <variant>,...]
```

- `extract` reads `runs/` and writes each question to `moments.json`, and a table of the moves, the answer and the reason to `moments.md`.
- A variant is `base`, the recorded prompt, or edits with `+` between them: `two` asks to keep at least 2 damage moves, `types` tells when a move is the only damage move of its type, `refuse` tells in the question that `keep` can refuse the move, `zero` writes power 0 for a move with no damage and power varies for a move with no fixed power, `maxpp` shows the maximum PP in the list, `after` tells the damage moves that each answer leaves, `nohint` removes the last line of the question, and `guide` replaces it with advice.
- `--only` selects the moments by their id, species and new move. `run` adds each answer to `results.jsonl`. A next `run` does not make a call again when the prompt is the same, so you can add a variant or a model and pay only for the new calls.
- `report` gives, for each model and variant, the share of answers that keep the moves, leave one damage move, lose the last damage move with the type of the Pokémon, or forget a damage move for a move with no damage while a move with no damage stays. Then it gives the answers at each moment.

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
- `src/genetic/`: the parts of the **Genetic bot** (the **Genome**, the actions of a walk and their criteria).
- `src/race/`: the file of a **Race**, the command that makes it, and the world of the Race tab, read from the ROM (the maps, the sprites of the Ghosts and the icons of the Pokémon).
- `src/server.ts` and `viewer/`: the Viewer.
- `bots/`: the **Bots**.

`saves/`, `runs/`, `races/`, `evals/` and `.cache/` are not in git. Never put a ROM in git or on a public URL.
