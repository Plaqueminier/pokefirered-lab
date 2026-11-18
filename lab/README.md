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

The lab has two **Bots**: the model bot (`bots/model.ts`, version 49, no goal) and the **Genetic bot** (see "Run the Genetic bot"). The model bot asks an AI model for each decision, through its **Model provider** (ADR 0003, ADR 0005, ADR 0007). At the `player` **Knowledge level**, it sees 3 x 3 cells on a **Dark map** until a Pokémon of its party can use FLASH: the program then uses the move, with no **Model call**. A walk also uses CUT, ROCK SMASH and SURF by itself, when a Pokémon of the party knows the move. The player must also have the badge of the move. The model bot pushes a boulder with the action `push`, and the program starts STRENGTH for it. A walk to a far map also flies with FLY when the way is shorter. This needs badge 3 and a Pokémon of the party that knows FLY. At each **Decision point** in a battle, the model bot sends the **Battle prompt**. It has a system prompt and a prompt about the battle only, with no **Memory tree** and no **Atlas**.

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

`--seed <0 to 0xffff>` plays the **Run** of any **Bot** with another seed of the game (`gLabRngSeed`, `0x4c41` by default): the Harness writes it in the ROM image before the boot. The header of the **Run record** keeps the seed, and the replay and a Continued **Run** use the seed of the record.

The command writes the **Run record** to `runs/<id>-<bot>-<version>-<date>.json`: `<id>` is the number of the **Run**, on 5 digits (`00001`), so the files sort in the order of the **Runs**. The Viewer can start a **Bot** (button "Bots"), continue a **Run**, keep the same **Run** (the checkbox "Keep the same Run": an **Extended Run** replaces the file of its **Run record**, with the same name, so the version in the name can be older than the version in the header), and replay a **Run record** (the Select of the top bar).

## Run the Genetic bot

The **Genetic bot** (`bots/genetic.ts`, version 3, no goal) plays with a **Genome**, and asks no AI model (ADR 0008). The **Genome** is a JSON file of weights from -1 to 1, for example:

```
{"walk": {"notUsed": 1, "isExit": 1, "previousMap": -1, "isSign": -1, "unknownNeighbours": 1, "distance": -0.2},
 "choice": {"isYes": 1},
 "battle": {"noDamage": 0.5, "usedNoDamage": -1, "power": 1}}
```

At each walk **Decision point**, the **Bot** lists the seen exits, people and signs, and each seen cell that the player can reach. At a choice, it lists each option. At a battle, it lists each move, and `run` against a wild Pokémon. It gives each action the score Σ weight × criterion, and plays the action with the best score. A criterion with no weight has the weight 0, so a **Genome** of version 1 (the group `walk` only) has the weight 0 for the choices and the battles. At a name, a new move, a shop or a PC, a fixed rule plays. This **Genome** plays from the bedroom to `first-rival-battle`. The page "Genome and criteria" of the Doc tab gives each criterion.

In `lab/`:

```
bun run bot genetic --genome <Genome file>|<Evolution>:<Genome id> [player|full] [--seed <0 to 0xffff>]
```

The **Run** starts from the Starting save, and ends with `no progress` when the **Stuck counter** reaches 60. `<Evolution>:<Genome id>` plays a **Genome** of an **Evolution**, for example `first:104`, as the **Evolution** played it: on the training seed, with no goal and with the frame limit of the last **Generation** that holds this **Genome**. So it gives the same **Run** as the **Evolution**, and its **Run record** holds the id of the **Genome**. `--seed` plays the **Genome** on another seed of the game, for example a test seed of the **Evolution** (`--seed 0xbeef`), or a seed that the **Genome** does not know. The command writes the **Run record** to `runs/` as for the model bot, and the Viewer replays it. The form "Bots" of the Viewer cannot start the **Genetic bot** from the Starting save, because a start has no **Genome**: the form lists the **Genetic bot** only after "continue". There it continues a **Run record** of the **Genetic bot**, and the new **Run** plays the **Genome** of the header.

## Run an Evolution

In `lab/`:

```
bun run evolve <name> [--parallel <1 to 18>] [--from <other>]
```

The command starts the **Evolution** `<name>` (letters, digits, `-` and `_`), or continues it when its file `runs/evolutions/<name>/evolution.json` exists. Each **Run** plays on the training seed, the seed of the ROM (`0x4c41`). Every 10 **Generations**, the best **Genome** also plays on 3 test seeds (`0x0001`, `0x1234` and `0xbeef`), which the **Evolution** never uses to rank the **Genomes**. A **Run** has no goal: it ends when the **Stuck counter** reaches 60, or at its frame limit (the higher of 30 000 and 2 × the frames of the best **Genome** of the previous **Generation**), so a **Genome** goes as far as it can. The **Evolution** has no end: it plays until you stop it. The results of the test seeds stay in its file, but they do not stop it. To stop it, press Ctrl-C. To continue it, give the same command again: it plays again only the **Generation** that the stop interrupted, and the next **Generations** are the same as with no stop. The command plays 12 **Runs** at the same time, or the number of `--parallel`. These **Runs** do not use the places of the Viewer.

With `--from <other>`, a new **Evolution** starts from the **Evolution** `<other>`: its **Generation** 1 is the **Genomes** of the last **Generation** of `<other>`, in their order from the best **Fitness**, with their weights only, the new ids 1 to 50 and no parents. The file of `<other>` can have an older format, for example `runs/evolutions/version-4` (format 2, **Genetic bot** version 3). The frame limit of **Generation** 1 comes from the last **Generation** of `<other>`. Then the **Generations** play and breed as usual. The command refuses `--from` when `<name>` exists, because a continue plays from its own file, and it refuses an `<other>` that has no file. A stop in **Generation** 1 writes no file: give the same command, with `--from`, again.

The folder holds `evolution.json` (the settings, the seeds, the **Fitness** version, the **Evolution** and the **Generation** of `--from`, each **Genome** of each **Generation** with its id, the ids of its parents, its **Fitness** and the points of each term, and the results of the tests on the test seeds), and a **Run record** for each **Generation** that gives a new best **Fitness**. The header of this record holds the **Genome**, its id, the **Fitness** version and the **Fitness**. The folder also holds the **Races** of the **Evolution** (see "Make a Race"). The Select of the top bar of the Viewer replays these records, in a group for each **Evolution**. The page "Evolution" of the Doc tab gives the settings.

The Evolutions tab of the Viewer does the same as the command: it starts an **Evolution** or continues it, with the same name, the same number of **Runs** at the same time, and the same `--from` in its Select "Start from" (random weights, or an **Evolution** of the list). The server of the Viewer then plays `bun run evolve`, one **Evolution** at a time. The tab shows the **Generations** of each **Evolution** of `runs/evolutions/`: the best and the mean **Fitness** of each **Generation**, the best **Genome** and its weights, and a card of one **Generation**: a click on the chart selects the **Generation**. This card gives the **Genomes** by **Fitness**, each with a bar of the points of each term of the **Fitness**, and the mean points of each term over the **Generation**, so that you can tune the points of the **Fitness**. Its button opens the **Race** of the **Generation** in the Race tab. Its button "Stop after this Generation" stops the **Evolution** when the **Generation** that plays ends, so no **Generation** is lost. The page "Page of the Evolutions" of the Doc tab tells the tab.

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

## Test the battle prompt

`bun run battle-lab` asks models again at the **Battle moments** of the **Run records**. It uses the prompt that the current code of the model bot builds. No game runs after the extraction. The files go to `evals/battle/`, which Git ignores.

```
bun run battle-lab extract
bun run battle-lab show <moment>
bun run battle-lab run --models <provider>:<id>[@<reasoning>],... [--only <regex>] [--repeats <n>] [--cost-limit <dollars>] [--concurrency <n>]
bun run battle-lab report
```

- `extract` replays each **Run record** of the moments up to the frame of each moment. It writes to `moments.json` what `observe()` returns, the count of **Decision points** with no progress, and the events before each moment. The replay takes about 1 minute for each 100 000 frames. Do it again when `observe()` gets a new field. The moments are in `src/model/battle-lab.ts`. They are the 34 moments of the A/B of spec #100. Each has a kind (`toxic`, `levitate`, `two-turn` or `clear`), its good answers and its bad answers.
- `show` prints the system prompt and the user prompt of a moment, for example `00073@1634993`.
- `--only` selects the moments by their id and their kind. `run` adds each answer to `results.jsonl`, with the version of the model bot, the model and the repeat. A next `run` makes only the calls that it does not have: a new version or a new prompt makes new calls.
- `report` writes `report.md` and prints it. It gives, for each kind, version and model, the count of good, bad and other answers and the mean prompt tokens. Then it gives the answers at each moment. An answer is good or bad when its action starts with a good or a bad answer of the moment.

`report.md` has bot versions 46 and 48 on `claude-code:haiku@low` and `claude-code:sonnet@low`, 3 repeats for each moment. Version 46 is the code before the Battle prompt, and version 48 the code of the Battle prompt. The lab history gives the numbers (step 49). `moments-v46.json` keeps the snapshots of version 46, from before the extraction of version 48. To measure version 46 again, use them with the code of the battle lab before version 48 (commit `330e4a5eb`). `results-before-v48.jsonl` keeps the results from before the merge with FLY, when the code of the Battle prompt had the label 47.

## Test the elevations of a map

`bun run map-lab` asks models where they walk on a map where two elevations of land touch. The files go to `evals/map/`, which Git ignores.

```
bun run map-lab extract
bun run map-lab show <moment> <old | now>
bun run map-lab run --models <provider>:<id>[@<reasoning>],... [--only <regex>] [--repeats <n>] [--cost-limit <dollars>] [--concurrency <n>]
bun run map-lab report
```

- The **Run records** have no walk on the maps where the land at one elevation has no stairs to the other. So `extract` does not replay a Run. It loads `saves/test-party.sav`, warps the player to each cell of `src/model/map-lab.ts`, and keeps what `observe()` returns. These moments have no **Mission** and no **Memory tree**.
- `old` is the snapshot with no elevation, as the Parts of version 48 saw it. `now` is the prompt of the current code.
- `report` counts the answers of each variant and model in four groups. An answer goes to a cell where the player can walk, to a cell where the player cannot walk, or to another map. The last group is an answer that the Bot cannot read. The real grid of the moment, with its elevations, decides.

`report-ab.md` has the first A/B of version 49, with the variants that the code does not have now (step 103 of the lab history). Its score also accepted a cell next to the target, so its counts of bad answers are low.

## Test another prompt

To test a new prompt of the model bot, for example a walk with SURF, extend the labs. Use the parts that they share:

- `src/model/lab.ts` has the client of each provider (`askAll`), the options of `run` (`runOptions`), the results file (`readResults`) and the key of a prompt (`hashOf`). `askAll` makes only the calls that the results file does not have, and it stops at the cost limit.
- `battle-lab.ts` takes its moments from the **Run records**. A moment is a Run id and the frame of a **Model call**. `extract` replays the record to that frame, and the current code of the Bot builds the prompt from the snapshot. This works at each **Decision point**, not only in a battle. For a walk prompt, make `<name>-lab.ts` next to it, and export from `battle-lab.ts` the functions that you need (`extractRun`, `momentPrompt`, `scoreOf`). Do not copy them.
- `map-lab.ts` makes its moments with no **Run record**: it warps the player from a test save. Use it only when no **Run record** has the state that you want to test ("Test the elevations of a map").

Take the moments from a real **Run** that is at the state that you want to test. A save that you make for the test often has a bad state, for example a party with 1 HP or no **Mission**. Before you pay for calls, read the prompt with `show <moment>`: it costs nothing. Then start with `--repeats 1 --cost-limit 0.2`.

## Take screenshots of the game

`bun run shot` boots a ROM with a save, plays buttons at given frames, and writes the screen to PNG files. No Bot plays, and no **Run record** is written.

```
bun run shot [--keys "<frame>:<button>[+<button>][/<frames held>] ..."] [--frames <last frame>] [--every <n>] [--at <frame>,...]
  [--sheet] [--columns <n>] [--scale <n>] [--save <file>] [--rom <name>] [--seed <n>] [--out <folder>]
```

- `--keys` gives the presses, for example `"120:A 300:Start 360:Down+B/16"`. The buttons are A, B, Select, Start, Right, Left, Up, Down, R and L. A press holds its buttons 4 frames, or the frames after `/`. Frame 0 is the boot.
- The command plays to the frame `--frames`, or 120 frames after the last press. It writes the screen each `--every` frames, at each frame of `--at`, and at the last frame, to `<out>/frame-<frame>.png`. The default folder is `.cache/shots/`. The command prints the path of each file.
- `--sheet` also writes `sheet.png`: all the screens in one image, `--columns` across (4 by default), each with its frame number at its top left corner.
- `--scale 2` makes each pixel 2 x 2 pixels. `--save` is `saves/start.sav` by default. `--rom pokefirered_modern_lab_arena` boots the Arena build.

## Print a map

`bun run map` prints a map of the game as text. The legend is in the output. It gives:

- the cells, and the elevation of each cell (bits 12 to 15 of its block);
- the connections and the warps;
- the people, the **Fixed obstacles**, the **Things to check** and the triggers.

```
bun run map [<map name>] [--save <file>] [--rom <name>]
```

The map name is the name of the folder in `data/maps/`, for example `Route4` or `VictoryRoad_1F`. With no name, the command prints the map of the player. The command boots the save (`saves/start.sav` by default) to the first walk: the flags of the save tell which people and obstacles the map has. The map of the player has the cells of the game now, after its map scripts. Another map has the cells of the ROM. For a name that does not exist, the command gives the map names that contain it.

## Make a Race

A **Race** plays many **Run records** on a map of Kanto, in the Race tab of the Viewer. It needs the track and the State track of each record, and a record below format 3 does not have them.

1. Once, in `lab/`: `bun run migrate`. It replays each record of `runs/` below format 3, and writes its track and its State track in the file. A record whose replay does not end on the last frame of its buttons, or does not give its maps and battles, keeps its file.
2. In `lab/`: `bun run race <name> [records…]`. It writes `races/<name>.json.gz`. With no record named, it takes all the records of the model bots and of the **Genetic bot** in `runs/`. A record is a file name, the start of one file name (`00012`), or the path of a record of an **Evolution** in `runs/` (`evolutions/<name>/<file>`). The **Ghost** of a **Genetic bot** has the id of its **Genome** as its number and its face when its record holds this id (the record of a new best of an **Evolution**, or of `bun run bot genetic --genome <Evolution>:<Genome id>`), and the Run id when it does not. A record with an empty track stays out, a record with no Run id at the start of its name stays out, and a record that another record of the Race continues stays out: the command names them. A record of another Bot is refused, and a record below format 3 is refused with the name of the migration. A Race file of an older version does not open: make it again.

An **Evolution** makes its own **Races**, with no command: after each **Generation**, it writes `generation-<n>.json.gz` (the 50 **Ghosts** of the **Generation**) and `bests.json.gz` (the best **Genome** of each **Generation**) in `runs/evolutions/<name>/`. The number and the face of each **Ghost** come from the id of its **Genome**, and its dot is purple: "genetic". The list of the Race tab shows them in a group for each **Evolution**, after the **Races** of `races/`.

## Checks

In `lab/`: `bun run check && bun run test`. `bun run check` runs lint, knip, typecheck and `bun run rules` (the rules of `../CODING_STANDARDS.md` on the new lines since master).

`bun run test` runs the test files in parallel (`bun test --parallel`, one worker for each CPU core). Most of the time goes to the tests that play the game in the emulator. A plain `bun test` runs the files one after the other: it takes about three times longer.

The Arena tests need the ROM from `make lab ARENA=1` at the repo root (`pokefirered_modern_lab_arena.gba`). Without it, `bun test` skips them.

## Files

- `shim/`, `src/core.ts`, `src/symbols.ts`, `src/memory.ts`: the emulator and the typed reads of its memory.
- `src/game.ts` and the files next to it: the reads of the game state (battle, menus, Bag, PC, shop, party).
- `src/harness/`: the API of the **Bot**, the **Atlas**, the **Run record** and the pool of **Runs**.
- `src/model/`: the parts of the model bot (request, prompt, answer).
- `src/genetic/`: the parts of the **Genetic bot** (the **Genome**, the actions of a walk and their criteria), the **Fitness** of a **Run record**, and the **Evolution** with its command, which the Viewer can also start.
- `src/race/`: the file of a **Race**, the command that makes it, and the world of the Race tab, read from the ROM (the maps, the sprites of the Ghosts and the icons of the Pokémon).
- `src/tools/`: the commands for the work on the lab: `shot` (screenshots of the game, and a PNG writer with no library) and `map` (a map as text).
- `src/server.ts` and `viewer/`: the Viewer.
- `src/checks/`: `bun run rules`.
- `bots/`: the **Bots**.

`saves/`, `runs/`, `races/`, `evals/` and `.cache/` are not in git. Never put a ROM in git or on a public URL.

The walk prompt of the model bot comes from these files, in this order:

1. `src/game.ts` reads the grid of the map (`grid()`, `mapView()`).
2. `src/harness/atlas.ts` keeps what the player saw (the **Atlas**).
3. `src/model/targets.ts` writes the lines of the targets, and `src/model/extract.ts` draws the map and its legend.
4. `src/model/prompt.ts` puts the lines together.

Before you write a helper, look for it in these files:

- `src/state-track.ts`: the party and the team of a **Run** at a frame, from its **State track** (`partyOf`, `teamTimeline`, `FrameList`).
- `viewer/race-deaths.ts`: the **Starter** of a **Run**, the Pokémon of its line in a team (`starterOf`, `leadOf`), and the deaths.
- `viewer/race-art.ts`: the world and the sprites of the ROM (`loadWorld`, `loadArt`), and the size of a canvas (`fitCanvas`).
- `viewer/stats-format.ts`: a game time as text (`clock`, `raceTime`, `spanText`).
- `viewer/cursor.ts`: the data that the server sends (`useStore`, `fetched`, `EventChunks`).
- `viewer/mapdraw.ts`: the drawing of a map and the names of the places.

## Add a Field move

SURF, STRENGTH and FLY each changed the same files. In order:

1. `src/game.ts`: the type `FieldMove`, the obstacles of the move, and the read of the badge and of the Pokémon that knows the move.
2. `src/harness/game-events.ts`: the **Game event** of the move. Then its kind in `viewer/timeline-events.ts` and `viewer/timeline.tsx`, and the demo in `viewer/components-tab-lab.tsx`.
3. In `src/harness/`:
   - `path.ts`: the route and its cost;
   - `walk-driver.ts`: the walk that uses the move;
   - `menu-driver.ts`: the menu of the move;
   - `harness.ts`: the **Macro-action**;
   - `atlas.ts`: what the **Atlas** keeps.
4. `src/model/extract.ts` (the signs of the map), `src/model/targets.ts` and `src/model/prompt.ts` (the lines for the model).
5. The tests: `src/harness/field-move.test.ts` plays the move in the ROM. Also `path.test.ts`, `extract.test.ts` and `prompt.test.ts`.
6. The docs of the table of `../CODING_STANDARDS.md`, and `BOT_VERSION` in `src/model/opening.ts`.

`bun run map <map name>` shows the cells and the obstacles of a map, and `bun run shot` shows the screen of the move.
