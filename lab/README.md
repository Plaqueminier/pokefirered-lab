# Lab harness

The harness runs the **Lab build** in libmgba from Bun. The **Viewer** shows one **Run** at a time in the browser. See `../CONTEXT.md` for the terms and `../docs/adr/` for the decisions.

## Run the Viewer

1. At the repo root: `make lab -j8`. This gives `pokefirered_modern_lab.gba` and its `.elf` with debug info.
2. In `lab/`: `bun install`, then `bun run viewer`.
3. Open http://localhost:8766. To use another port: `LAB_PORT=8767 bun run viewer`.

Requirements: Homebrew `mgba` (for `libmgba` and its headers), the macOS `dwarfdump`, and a C compiler. The harness compiles `shim/shim.c` into `.cache/` when the file changes.

## Run a Bot

In `lab/`: `bun run bot starter`, or `bun run bot starter full` for the `full` **Knowledge level** (the default is `player`). The command runs the **Bot** `bots/starter.ts` headless from `saves/start.sav`, and prints each **Macro-action** with its result, its frame count and its texts. At the end, it prints the end reason of the **Run**, the **Milestones** and the party. The game is frozen at each **Decision point** (ADR 0002), so each start gives the same frames.

There are two **Bots**: `starter`, the scripted bot, and `model`, the model bot (see "The model bot" below). Each new step of the story goes into `starter`, not into a new scripted **Bot**. A **Bot** is `{ name, version, goal?, play(harness) }`, and optionally `frameBudget` (its frame budget when the Run gives none) and `model` (a model bot: its AI model and the options). A module in `bots/` exports a **Bot** by default, or it exports `modelBot(model)`, a function that makes a model bot. `loadBot(name, model)` calls `modelBot` with the model and the options of the **Run** (the missing options take their defaults), and refuses a model for a module with no `modelBot`. A **Bot** calls the harness with `await`, for example `await harness.goTo(10, 2)`. `must(result)` stops the Bot with an error when a result is not `done`.

`harness.play(bot)` plays a **Run** and gives its result: the end reason, the frames and the **Raw inputs** from the start of `play`, and the **Milestones**. A `Harness` object plays one Run: a second `play` is an error. `harness.close()` closes its emulator. `Harness.open(options, run)` can also take a `Run` that the caller opened: the Harness then owns it, and closes it when the Run cannot start. The end reason is one of:

- `goal`: the game reaches the **Milestone** `goal` of the Bot. The **Macro-action** that reaches it does not return to the Bot.
- `bot stopped`: `play` of the Bot returns, or throws an error. In the second case, `harness.play` keeps the result for the Run record, then throws the error again.
- `user stop`: a person stopped the Run (`Harness.open({ stopAsked })`: a function that gives `true` to stop). The Run ends after the **Macro-action**, the **Raw input** or the **Model call** that plays: that action or call does not return to the Bot, but it is in the Run record.
- `frame budget`: the Run used its frame budget, from the start of `play`: the `frameBudget` of `Harness.open`, else the `frameBudget` of the Bot, else 30 000 frames. The Run stops at the last frame of the budget, also inside a **Macro-action**: that action does not return, and it is not in `harness.actions` or in the events of the Run record.
- `no progress`: the Bot made 200 **Decision points** in a row (`Harness.open({ noProgressLimit })`) with no new cell and no new **Milestone**. A new cell is a cell of a map where the player never was in this Run, also a cell that the player only walks through. For this rule, the end of each **Macro-action** and **Raw input** counts as one Decision point, also when it is `impossible` with no frames or when it stops at an **Interruption**. A battle has no cells: its Decision points are not progress.

For `goal`, `user stop`, `frame budget` and `no progress`, the **Macro-action** or the **Raw input** throws an error that ends the Run: the Bot must not catch the errors of the harness.

`goTo(x, y, map?)` walks to a cell of the player's map, or of the map with the name `map`, for example `goTo(12, 3, "PalletTown")`. The route goes through warps, map edges and ledges (only in their jump direction). People are obstacles. The player takes a stair or arrow warp when it stands on the cell and pushes toward its direction, and a door when it pushes north from the cell below. With no `map`, the cell can also be an exit of the player's map: a warp that the player can take (a door, stairs, an arrow warp), or the cell just past an edge with a neighbour map, for example `goTo(12, -1)` for the north edge. Then `goTo` takes that exit, and it is `done` when the player arrives on the other map. The result is one of:

- `done`: the player is on the cell.
- `impossible`: there is no route, even with no people on the maps; or the player cannot walk now; or the player does not move and no person is in the way; or a warp does not start. When `goTo` finds this before the first move, no frames run.
- `blocked`: a person stays in the way. `goTo` waits and computes the route again; it stops when a person stops the player three times on the same cell.
- `interrupted`: the game stopped the walk, with the reason `trigger` (coord trigger), `trainer` (a trainer sees the player), `script` (another script), `battle` (a wild battle starts) or `map` (the player arrived on a map that is not on the route). `goTo` stops at the first frame of the interruption and does nothing more. For `map`, that frame is when the warp ends.

`interact(x, y)` turns the player to the cell next to it and presses A, for example on a person, a sign or the Poké Ball on a table. Then it runs the game to the next Decision point. It is `impossible` when the game does not wait for the player to walk or when the cell is not next to the player (in these two cases, no frames run), when the player does not turn or walks when it turns, or when nothing on the cell starts a script. While the player turns, the game can interrupt `interact` as it interrupts `goTo`.

`availableActions()` gives the **Macro-actions** that the game accepts now:

- When the game waits for the player to walk: `{ name: "goTo" }` (the Bot chooses the cell), and `{ name: "interact", x, y }` for each cell next to the player with a person or a sign. A sign that is read from one side only is in the list only when the player is on that side. Bookshelves, PCs on a metatile, water and the people behind a counter are not in the list yet, but `interact` works on them.
- At a choice: `{ name: "choose", option }` for each option.
- At the battle action menu: `{ name: "fight", move }` for each move with PP, and `{ name: "run" }` in a wild battle. At the move menu: the same `fight` entries.
- In the party menu of a battle: nothing. No **Macro-action** picks a Pokémon yet; use **Raw inputs**.
- At a text, or when the game is busy: `{ name: "readText" }`. The harness cannot tell a busy game from a menu that it does not know (multichoice, the PC): there, `readText` is `impossible` after 3600 frames.

A **Macro-action** that the game does not accept now (for the kind of `waitingFor`) returns `impossible`, and no frames run. `interact` runs at each walk Decision point, also when the list has no `interact` entry. The list does not check the elevation of a person or a sign, or a person who is invisible or has no script; no such case is on the path to the starter.

`observe()` gives what the game waits for, the party and the **Milestones**. On the overworld (`mode: "overworld"`), it also gives the map, the player, the grid of the map and `people`: each person of the map with its cell and its sprite (`graphics`, the name of `OBJ_EVENT_GFX_*` without the prefix, for example `PROF_OAK` or `ITEM_BALL` for a Poké Ball on a table). In a battle (`mode: "battle"`), it gives `battle`: the kind (`trainer` or `wild`), the player's Pokémon in full (as in the party, with its battle stats `attack`, `defense`, `speed`, `spAttack` and `spDefense`, and `statStages` from -6 to 6 for these stats, `accuracy` and `evasion`), and the enemy Pokémon as the player sees it: species, level, `hpPercent` (the HP bar, 48 pixels, as a percentage), status, `statStages` and `movesSeen` (the moves that the game announced for this enemy Pokémon in this battle, for example "Foe BULBASAUR used GROWL!"). At the `full` **Knowledge level**, the enemy also has `exact`: its `hp`, `maxHp` and `stats`. The volatile states (for example confusion), the types, the ability and the held item are not in the battle state yet. Open the harness with `Harness.open({ knowledge: "full" })`. Each Pokémon of the party has its species, nickname, level, HP, status (`none`, `sleep`, `poison` (also for toxic poison), `burn`, `freeze` or `paralysis`; a Pokémon with 0 HP keeps its status) and moves with their PP. The **Milestones** are the story steps reached, in story order: `has-pokemon`, `first-rival-battle` (the rival leaves the lab after the first battle, won or lost), `has-pokedex` and `badge-1` to `badge-8`.

`observe().waitingFor` tells what the game waits for now. `harness.waitingFor()` gives the same value, also when `observe()` cannot read the game (for example in a fade between two maps, where `observe()` throws an error):

- `{ kind: "walk" }`: the player can walk.
- `{ kind: "text" }`: a text box waits for A.
- `{ kind: "choice", options, cursor }`: a yes/no, for example `["YES", "NO"]` with the cursor on 0.
- `{ kind: "battleAction" }`: the battle menu FIGHT, BAG, POKéMON, RUN.
- `{ kind: "battleMove" }`: the move menu of the battle.
- `{ kind: "partyPick" }`: the party menu of a battle waits for a Pokémon.
- `{ kind: "busy" }`: the game waits for no input. For example, a text prints, people walk or the screen fades.

In a battle, `text` is also the level-up stats box, and the texts of Oak in the party menu of the first battle.

A text box that closes by itself is not a `text` Decision point. On the frame of a map arrival, the game can show `busy` while a frame script of the map starts, for example in Oak's lab.

`readText()` reads the texts of the game. It runs the game until a text waits for A. Then it presses A at each `text` Decision point, until the text box closes or a choice shows. Then it runs the game to the next Decision point. Its result has `text`: one plain string for each message. Line and page breaks become spaces. The result also has the messages that closed by themselves. A text that waits for A after the box closed is not in the result: the next `readText()` reads it. The result is `impossible` when the game waits for the player to walk, shows a choice or a battle menu, and `interrupted` with `battle` when a battle starts. In a battle, `readText` reads the battle messages and the texts of Oak (the first battle is a tutorial), and stops at the next battle menu. At the end of a battle, it stops at the first text of the overworld: the next `readText` reads it. In the party menu of a battle, it presses A at the texts of Oak but does not read them.

`fight(move)` uses the move `move` (0 to 3, the order of `battle.player.moves`): from the battle action menu it moves the cursor to FIGHT and presses A, then it moves the cursor to the move and presses A, and runs the game to the next Decision point. Its result has `text`: the messages of the turn, for example "SQUIRTLE used TACKLE!". A message that waits for A at the end is not in it: the next `readText()` reads it. `fight` is `impossible`, with no frames, when the Pokémon has no such move or the move has no PP. When no move has PP, the game uses Struggle from FIGHT, but no Macro-action selects it yet: use **Raw inputs**.

`run()` selects RUN in a wild battle, with the messages of the turn as `fight`. Against a trainer, it is `impossible`, with no frames.

`choose(option)` moves the cursor of the choice to the option (for example `"NO"`), presses A, and runs the game to the next Decision point. It is `impossible` when the game shows no choice or when the choice has no such option.

`press(button)` is a **Raw input**: one press of a button (`"A"`, `"Up"`...), then the game runs to the next Decision point. The harness counts them in `rawInputs`, and `bun run bot` prints the count at the end.

After its A press, `interact` stops only for a battle (`interrupted` with `battle`), as `readText`, `choose` and `press` do, because a script runs during them. These four are `impossible` when the game waits for no known input for 3600 frames. `choose` is also `impossible` when the cursor does not move.

Only the yes/no of the scripts (`yesnobox`, `msgbox` with `MSGBOX_YESNO`) is a `choice` now. Other menus (multichoice, the PC, the bag) and the texts outside the overworld and the battles show `busy`.

`bun run bot starter` (Bot version 3, goal `first-rival-battle`) leaves the house and walks north in Pallet Town until Professor Oak stops the player (`goTo(12, 1)` returns `interrupted` with the reason `trigger`). Then it calls `readText()` until the game waits for the player to walk: four calls, and the player is in Oak's lab at (6, 4). Then it takes SQUIRTLE: `goTo(9, 5)`, `interact(9, 4)`, `readText()`, `choose("YES")`, `readText()`, `choose("NO")` for the nickname, and `readText()` while BOB takes BULBASAUR. Then it walks to the door: the rival stops it at (7, 8) (`goTo(6, 11)` returns `interrupted` with `trigger`), and `readText()` returns `interrupted` with `battle`. In the battle against BULBASAUR, it uses TAIL WHIP, then TACKLE, and `readText()` at each text. With TACKLE only, SQUIRTLE loses. SQUIRTLE wins and grows to level 6, the rival leaves the lab, and the **Run** ends with the reason `goal` at frame 15017, with no Raw input.

`bun test` runs the tests. The tests of `src/harness/harness.test.ts`, `src/harness/record.test.ts`, `src/harness/pool.test.ts` and `src/model/model-bot.test.ts` need the Lab build and `saves/start.sav`; without them, the tests skip.

## The model bot

The model bot (`bots/model.ts`, goal `first-rival-battle`) asks an AI model on OpenRouter what to do, and its code calls the harness (ADR 0003). One **Bot** plays all the models: the **Run** gives the model and its options.

1. Make an OpenRouter key for the lab only, with a credit limit in the OpenRouter dashboard. Put it in `lab/.env`: `OPENROUTER_API_KEY=sk-or-...`. Git ignores this file, and the key is not in the Run records or in the logs.
2. In `lab/`: `bun run bot model`, or `bun run bot model <id>` for another model, for example `bun run bot model deepseek/deepseek-v4-flash-0731`. The default model is `deepseek/deepseek-v4-flash`. The options are `--cost-limit <dollars>`, `--reasoning off|low|medium|high` and `--temperature <0 to 2>`. The Viewer also starts it (panel "Runs").

Only the models with structured outputs play: the request asks for a strict JSON schema and accepts only the providers that apply it (`provider.require_parameters`). With `--reasoning off` (the default), the request sends the effort `none`, so the model does not reason. A model that always reasons (for example `z-ai/glm-5.3-flash` or `openai/gpt-oss-120b`) does not have the effort `none`: give it `--reasoning low` or another level. With no `--temperature`, the model uses its own default.

The code reads the texts (`readText`) and waits while the game is busy, with no **Model call**. It makes a **Model call** only when the game waits for a walk, a choice, a battle action or a move, or a Pokémon in the party menu of a battle (there, only **Raw inputs**). When `readText` is `impossible` (a screen that no **Macro-action** covers), the code presses B 3 times, and the history of the model tells it.

The prompt is in English, and its size does not grow with the **Run**:

- the rules of the program, the long-term goal ("Become the Champion: earn the 8 gym badges, then beat the Elite Four.") and the goal of the **Run** in one sentence. One rule tells the model to answer NO to the nickname question: the harness cannot type names yet. One paragraph tells the model to try something new when its last decisions give nothing new: talk to the people, read the signs, take the exits to a map that it has not visited.
- what the game waits for, the last **Objective** that the model gave, the notes of the last answer that the Bot could read, the party and the **Milestones**;
- the last 15 **Model calls**: each answer, then the **Macro-actions** and **Raw inputs** that the code played, their results, the texts and the map changes, until the next **Model call** (30 lines at most for each);
- at a walk: the map in ASCII with its coordinates and a numbered list of targets: the exits (doors, stairs, exit mats, map edges), the people with their sprite, and the signs. The actions are `go <n>` (a target: the code takes an exit, or walks next to a person or a sign and calls `interact`), `goTo <x> <y> [<map>]` and `press <button>`. An exit shows its destination only when the player has been on that map in this **Run** (from the `map` events), else "to a map that you have not visited";
- at a choice: the map, and `choose <option>`. In a battle: the player's Pokémon (HP, status, stats, stat stages), the enemy as the player sees it, and `fight <n>` for each move with its PP, and `run`. In the party menu of a battle: the battle, and `press <button>` only.

The answer is JSON: `reason`, `action`, `objective` (200 characters at most) and `notes` (500 characters at most, the model writes them again at each call). An action that is `impossible` is not an error: the model sees it in its history.

The model bot stops (`bot stopped`, with an error) when the cost of the **Run** (the sum of `usage.cost`) is more than the cost limit: 0.50 $ by default, and `LAB_COST_LIMIT` in `lab/.env` changes the default. It also stops after 3 answers in a row that it cannot read: an answer that is not JSON, a field that is missing, an action that is not in the list, or a request that failed. Its frame budget is 200 000 frames; the no-progress limit stays at 200.

Each **Model call** is a `model` event of the **Run record**: `model` (the id), `situation` (what the game waited for, and where), `prompt` (`system` and `user`), `answer` (the text, or `null` when the request failed), `decision` (`reason`, `action`, `objective`, `notes`, or `null` when the Bot cannot read the answer), `error` (why the Bot cannot read the answer, else `null`), `usage` (`promptTokens`, `completionTokens`, `reasoningTokens`, `cost` in $) and `latencyMs`. The header of the record has the model and its options in `bot.model`. A model bot asks its AI model through `harness.modelCall(ask)`: the Harness calls the option `onModelCallStart` of `Harness.open`, runs `ask`, measures the latency, adds the `model` event, calls the option `onModelCall`, and gives back the action of the answer. `modelTotals(events)` (in `src/harness/record.ts`) gives the totals. At the end, `bun run bot` prints the **Model calls**, the tokens and the cost.

In the tests, a fake model answers: `bun test` never calls the network.

## The Run record

After `play`, `harness.record()` gives the **Run record**: the whole Run from frame 0 to now, also the actions before `play`. The Harness keeps it in memory; `bun run bot` writes it, also when the Bot throws an error, to `runs/<bot>-<version>-<date>.json`. `runs/` is not in git. The record has:

- `header`: the origin of the Run (`rom`: the SHA-256 of the ROM file with the bytes of `BuildDateTime` at zero; `seed`: `gLabRngSeed` in the ROM; `startSave`: the SHA-256 of `saves/start.sav`, or `null` when there is no Starting save), the **Knowledge level**, and the name and version of the Bot (and `model` for a model bot: its AI model and the options). The record has no save data.
- `buttons`: the keys at each frame from frame 0 (the Starting save), compressed: `[keys, frames]` is a set of keys held for that number of frames. The keys are the bits of `Keys` in `src/protocol.ts`.
- `events`, in frame order: `action` (each **Macro-action** and **Raw input**, with its parameters, its result and the frame where the Bot asked for it), `map` (the player arrives on a map), `battle` (`start` or `end`), `milestone` (a new **Milestone**) and `model` (a **Model call** of a model bot: see below). The `frame` of a game event is the frame count after the frame where the Harness saw it. The Harness reads the map and the Milestones only on the overworld and in a battle: the first `map` event is the end of the boot.
- `result`: the result of `play`.

`replay(record)` (in `src/harness/record.ts`) starts a new Run, runs the buttons alone, and gives the `map`, `battle` and `milestone` events, the last frame and the screen hash. The `action` and `model` events come from the Bot, not from the buttons, so a replay does not give them. `replay` does not compare its events with the record: the caller does, as `src/harness/record.test.ts` does. It does not accept a record when the ROM hash, the seed or the Starting save hash is not the same. A rebuild of the same code at the same repo path keeps the ROM hash: the record of the starter Bot replays after `touch src/main.c && make lab` with the same events, frames and screen.

## Replay a Run record in the Viewer

The panel "Replay" of the Viewer lists the files of `runs/` (the list loads when the page opens). "Rejouer" starts the Run again from the Starting save and runs the buttons of the record at ×1, with sound after the first click or key press. The replay has no pauses: the record has no time for the thinking of the Bot (ADR 0002). The Viewer does not start a file that is not a Run record. It also does not start a record with another ROM hash, seed or Starting save hash: then the Run starts again from the Starting save and the keyboard plays it.

While the replay runs, the keyboard does not play, and "Revenir (L)" does not load the savestate. Pause and the speeds work. The panel shows:

- the current **Macro-action** or **Raw input**, from the frame where the Bot asked for it. When its frames end, the panel adds its result and its texts.
- the last text of a model Bot (`model` events).
- the events of the record (actions, maps, battles, **Milestones**, model texts), each one at its frame.

The server sends the events of a frame before the screen of that frame. A page that opens during a replay gets the events that it missed. At the end of the record, the game stops at its last frame: the replay of the starter record ends at frame 15017 with the same screen as the Run. "Reprendre au clavier" ends the replay: the keyboard plays the Run from that frame. "Relancer" also ends it. Then the panel clears.

## Runs in parallel

`RunPool` (in `src/harness/pool.ts`) plays up to 4 **Runs** at the same time. Each **Run** plays in its own Bun worker (`src/harness/worker.ts`), with its **Harness** and its **Bot**: a **Macro-action** runs its frames in one synchronous block, so a **Run** in the Viewer process would stop the Viewer. Each **Run** is one emulator. The limit of 4 is a choice: the machine plays about 12 **Runs** at full speed. A pool counts only its own **Runs**: it does not know the emulators of other processes (another Viewer, `bun run bot`, the tests). Do not start them at the same time as a full pool.

- `pool.start({ bot: "starter" })` starts the **Bot** `bots/starter.ts` in a new worker, with the options of `Harness.open` (`knowledge`, `frameBudget`, `noProgressLimit`). For a model bot, `model` gives its AI model and the options, all of them (the `model` of the Bot that `loadBot` gives); for another **Bot**, `model` is an error. It throws an error when `limit` **Runs** play (`new RunPool(limit)`, 4 by default). `pool.full` is true when the pool cannot start one more **Run**. A **Run** keeps its place until its worker stops, after the end of the **Run**.
- `run.stop()` asks the worker to end the **Run** with `user stop`, and `run.stopAsked` is then `true`. The worker reads a shared flag (`SharedArrayBuffer`) at each decision of the **Bot**, not a message: a scripted **Bot** gives the event loop of its worker no turn before the end of its **Run**.
- `run.done` gives the **Run record** and the error of the **Bot** (or `null`) when the worker stops; `run.end` has the same value then, and is `null` while the worker plays. When the **Run** cannot start (no such **Bot**, no ROM), the record is `null`.
- While the **Run** plays, `run.view` has its frame, its screen (at most 60 times a second) and its state, map grid, actors and camera (at most 10 times a second). `run.events` has the events of the **Run record** up to the end of the last **Macro-action**, **Raw input** or **Model call**, and all of them at the end. `run.modelCallsStarted` counts the **Model calls** that started: a **Model call** runs while its `model` event is not in `run.events`. At the start of each **Model call**, the worker sends the screen and the state of the frozen frame.

A **Run** in a worker gives the same **Run record** as the same **Run** alone: `src/harness/pool.test.ts` plays the starter **Bot** alone, then 4 times at the same time, and compares the records.

In the **Viewer**, the panel "Runs" starts a **Bot** ("Lancer le Bot") and lists the **Runs**: the **Run** of the Viewer (keyboard or replay) and the **Runs** of the **Bots**. Select one in the list to show it: the Viewer then shows its screen, its state and its events (in the panel "Replay"). The other **Runs** do not stop. The whole-map view of another map shows the people of the **Run** of the Viewer only: for a **Run** of a **Bot**, it shows none. The **Run** of the Viewer is one of the 4 emulators, so the Viewer starts 3 **Runs** of **Bots** at most at the same time. A **Run** of a **Bot** plays at full speed, with no sound: the starter **Bot** plays to its goal in about 10 s. The keyboard, the speeds, pause and the savestate act only on the **Run** of the Viewer: while a **Run** of a **Bot** is shown, the server ignores them and the keyboard does not play. At the end of a **Run** of a **Bot**, the Viewer writes its **Run record** to `runs/`. "Rejouer" shows the **Run** of the Viewer again.

For the model bot, the panel "Runs" has a field for the OpenRouter model id and a field for the cost limit in $. Empty fields take the defaults. For a scripted **Bot**, leave them empty: the Viewer does not start a scripted **Bot** with a model. "Arrêter le Run" stops the shown **Run** of a **Bot** (`user stop`, with a **Run record**): for a model bot, after the **Model call** that runs, so it can take some seconds. Until the end, the list shows "s'arrête…". Under the list, the panel shows the model of the shown **Run** and its cost now, with its cost limit. In the panel "Replay", "le modèle réfléchit…" shows while a **Model call** runs. When the answer comes, the panel shows the **Objective** and the reason with the action, before the action plays. A replay of a **Run record** shows them too, at the frame of each **Model call**.

## Make the Starting save

1. Start the Viewer with no `saves/start.sav`. The lab build then starts as the vanilla game: intro, title screen, new game.
2. Play to your room and set the text speed to "Fast" in the options.
3. Save in the game. Wait for the message that tells you the save is complete.
4. Click "Écrire la sauvegarde de départ". The harness writes `saves/start.sav` and keeps the previous file next to it.

With `saves/start.sav`, the lab build skips the intro, the title screen and the "Previously on your quest" recap, and continues the game in a few frames.

## Files

- `shim/shim.c`: plain C functions over the libmgba core.
- `src/core.ts`: one emulator instance (bun:ffi).
- `src/symbols.ts`: reads the debug info of the `.elf` (addresses and types of all globals, function addresses). Cached in `.cache/`.
- `src/memory.ts`: typed memory reads, for example `mem.global("gSaveBlock1Ptr").deref().field("pos").field("x").int()`.
- `src/game.ts`: FireRed state (map, party, badges, money, context, **Milestones**), what the game waits for (walk, text, choice, the battle menus), the grid of the player's map or of any map from ROM, the actors on it (people, trainer sight, triggers), and the **Interruption** of each frame (battle, trigger, trainer, script).
- `src/prompts.ts`: the text decoder, the message boxes and their text, and the yes/no.
- `src/battle.ts`: the battle: the kind, the player's and the enemy's Pokémon from the battle data, the enemy as the player sees it, the battle menus and their cursors, the party menu of a battle, and the moves that the enemy used.
- `src/party.ts`: the party: species, moves and PP from the encrypted Pokémon data, and level, HP and status from the party fields.
- `src/run.ts`: one **Run**: the emulator and the game reads, started from the **Starting save**, and `readState()`, the state that the Viewer shows.
- `src/server.ts`: the Viewer page and its WebSocket, the wall-clock pacing of the Run, the replay of a **Run record**, and the **Runs** of the pool that the Viewer starts and shows.
- `src/model/`: the parts of the model bot: `openrouter.ts` (the settings and the request), `decision.ts` (the answer and its action), `targets.ts` (the targets of a walk) and `prompt.ts` (the text of the prompt).
- `src/harness/`: the API of the **Bot**: `harness.ts` (observation, **Macro-actions**, **Raw inputs**, the end of a **Run**, and the loading of a **Bot** from `bots/`), `path.ts` (A* over the maps: walk, ledges, warps and map edges), `record.ts` (the **Run record**, `RecordPlayer` that gives its keys and its events frame by frame, and its replay), `pool.ts` (up to 4 **Runs** in workers) and `worker.ts` (one **Run** of the pool), `play.ts` (the `bot` command).
- `bots/`: the **Bots**: `starter.ts` (scripted) and `model.ts` (the model bot).
- `viewer/`: the page. `viewer/mapdraw.ts` draws a map at any scale (screen overlay and whole-map view); `viewer/audio.ts` plays the sound; `viewer/replay.ts` is the replay panel; `viewer/runs.ts` is the panel of the **Runs**.

## Sound

The sound plays only at speed ×1. The browser starts it after the first click or key press; `M` turns it off and on. The page keeps about 60 ms of audio queued and sends the queue length to the harness, which makes the Run up to 1% faster or slower to hold it there (the emulator clock and the sound card clock drift apart).

## Notes

- The ROM bytes change on each build: the game stores the build date (`BuildDateTime`). To compare two builds, ignore those bytes.
- The vanilla build is compiled without `-g`, because `-g` changes the order of linker veneers in the ROM.
- `saves/`, `runs/` and `.cache/` are not in git. Never put a ROM in git or on a public URL.
