# Lab harness

The harness runs the **Lab build** in libmgba from Bun. The **Viewer** shows one **Run** at a time in the browser. See `../CONTEXT.md` for the terms and `../docs/adr/` for the decisions.

## Run the Viewer

1. At the repo root: `make lab -j8`. This gives `pokefirered_modern_lab.gba` and its `.elf` with debug info.
2. In `lab/`: `bun install`, then `bun run viewer`.
3. Open http://localhost:8766. To use another port: `LAB_PORT=8767 bun run viewer`.

Requirements: Homebrew `mgba` (for `libmgba` and its headers), the macOS `dwarfdump`, and a C compiler. The harness compiles `shim/shim.c` into `.cache/` when the file changes.

## Run a Bot

In `lab/`: `bun run bot model`, or `bun run bot model full` for the `full` **Knowledge level** (the default is `player`). The command runs the **Bot** `bots/model.ts` headless from `saves/start.sav`, and prints each **Macro-action** with its result, its frame count and its texts. At the end, it prints the end reason of the **Run**, the **Milestones** and the party. The game is frozen at each **Decision point** (ADR 0002), so each start gives the same frames.

The lab has one **Bot**: `model`, the model bot (see "The model bot" below). Each new step of the story goes into the **Harness** and the model bot.

The scripted bot `starter` (`src/harness/scripted-bot.ts`) is a test tool, not a **Bot** of `bots/`: the **Viewer** and the Doc do not list it. The tests of the **Harness** use it because it is free and fast, and it always plays the same **Run**. It keeps its goal `first-rival-battle`, and it does not grow with the story. `bun run bot src/harness/scripted-bot.ts` runs it headless: the command also takes the path of a `.ts` file out of `bots/`.

A **Bot** is `{ name, version, goal?, play(harness) }`, and optionally `frameBudget` (its frame budget when the Run gives none) and `model` (a model bot: its AI model and the options). A **Bot** with no `goal` plays to the last **Milestone** (`badge-8`). A module in `bots/` exports a **Bot** by default, or it exports `modelBot(model)`, a function that makes a model bot. `loadBot(name, model)` loads the module `bots/<name>.ts`, or the module at `name` when `name` is an absolute path (the tests load the scripted bot so). It calls `modelBot` with the model and the options of the **Run** (the missing options take their defaults), and refuses a model for a module with no `modelBot`. A **Bot** calls the harness with `await`, for example `await harness.goTo(10, 2)`. `must(result)` stops the Bot with an error when a result is not `done`.

`harness.play(bot)` plays a **Run** and gives its result: the end reason, the frames and the **Raw inputs** from the start of `play`, and the **Milestones**. A `Harness` object plays one Run: a second `play` is an error. `harness.close()` closes its emulator. `Harness.open(options, run)` can also take a `Run` that the caller opened: the Harness then owns it, and closes it when the Run cannot start. The end reason is one of:

- `goal`: the game reaches the **Milestone** `goal` of the Bot, or `badge-8` for a Bot with no `goal`. The **Macro-action** that reaches it does not return to the Bot.
- `bot stopped`: `play` of the Bot returns, or throws an error. In the second case, `harness.play` keeps the result for the Run record, then throws the error again.
- `user stop`: a person stopped the Run (`Harness.open({ stopAsked })`: a function that gives `true` to stop). The Run ends after the **Macro-action**, the **Raw input** or the **Model call** that plays: that action or call does not return to the Bot, but it is in the Run record.
- `cost limit`: the **Model calls** of the Run cost more than the cost limit of its model bot (`bot.model.costLimit`). The Run ends after that **Model call**: the call does not return to the Bot, but it is in the Run record. It is a normal end, not an error.
- `frame budget`: the Run used its frame budget, from the start of `play`: the `frameBudget` of `Harness.open`, else the `frameBudget` of the Bot (`starter`: 30 000 frames). With neither, the Run has no frame budget. The Run stops at the last frame of the budget, also inside a **Macro-action**: that action does not return, and it is not in `harness.actions` or in the events of the Run record.
- `no progress`: the Bot made N **Decision points** in a row (`Harness.open({ noProgressLimit: N })`) with no new cell and no new **Milestone**. With no `noProgressLimit`, the Run has no such limit, but the Harness still counts. While a **Bot** plays, `harness.noProgress` gives the count now (`decisions`) and `since`, the number of events of the Run at the last progress. A new cell is a cell of a map where the player never was in this Run, also a cell that the player only walks through. For this rule, the end of each **Macro-action** and **Raw input** counts as one Decision point, also when it is `impossible` with no frames or when it stops at an **Interruption**. A battle has no cells: its Decision points are not progress.

For `goal`, `user stop`, `cost limit`, `frame budget` and `no progress`, the **Macro-action**, the **Raw input** or the **Model call** throws an error that ends the Run: the Bot must not catch the errors of the harness.

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

`observe()` gives what the game waits for, the party, the **Milestones** and the **Atlas** (see "The Atlas" below). On the overworld (`mode: "overworld"`), it also gives the map, the player, the grid of the map and `people`: each person of the map with its cell and its sprite (`graphics`, the name of `OBJ_EVENT_GFX_*` without the prefix, for example `PROF_OAK` or `ITEM_BALL` for a Poké Ball on a table). A person with the sprite of the rival (`BLUE`) also has `rival`: the name of the rival in the save, for example `BOB`. The game gives this name to the player at the start, and calls the rival by it. In a battle (`mode: "battle"`), it gives `battle` with the kind (`trainer` or `wild`) and two Pokémon. The player's Pokémon has its species, nickname, the types of its species, level, HP, status and moves. It also has its battle stats `attack`, `defense`, `speed`, `spAttack` and `spDefense`, and `statStages` from -6 to 6 for these stats, `accuracy` and `evasion`. The enemy Pokémon is as the player sees it: species, the types of its species, level, `hpPercent` (the HP bar, 48 pixels, as a percentage), status, `statStages` and `movesSeen`. `movesSeen` has the moves that the game announced for this enemy Pokémon in this battle, for example "Foe BULBASAUR used GROWL!". At the `full` **Knowledge level**, the enemy also has `exact`: its `hp`, `maxHp` and `stats`. The volatile states (for example confusion), the ability and the held item are not in the battle state yet. Open the harness with `Harness.open({ knowledge: "full" })`.

Each Pokémon of the party has what the Summary screen shows: its species, nickname, `types`, `ability` (the name and the description), `heldItem` (`null` for none), `nature`, level, `exp` and `expToNextLevel` (0 at level 100), HP, status (`none`, `sleep`, `poison` (also for toxic poison), `burn`, `freeze` or `paralysis`; a Pokémon with 0 HP keeps its status), `stats` (`attack`, `defense`, `speed`, `spAttack`, `spDefense`) and moves. Each move has its name, `type`, `power` and `accuracy` (`null` where the Summary screen shows "---": a power below 2, an accuracy of 0), its PP now and its maximum PP, and its `description` on one line. The IVs and the EVs are not in it: the Summary screen does not show them. The **Milestones** are the story steps reached, in story order: `has-pokemon`, `first-rival-battle` (the rival leaves the lab after the first battle, won or lost), `has-pokedex` and `badge-1` to `badge-8`.

### The Atlas

`observe().atlas` is the **Atlas** of the **Run**: `maps`, one entry for each map that the player visited, in the order of the first visit. The Harness makes it from the frames of the Run (`src/harness/atlas.ts`). Each map has its name, its `width` and `height`, and:

- `cells`: one character for each cell, row by row, as `MapGrid.kinds` (from the ROM), and `?` for a cell that the player did not see. The player sees the 15 × 10 cells of the screen: 7 cells to the left and to the right, 5 cells up and 4 cells down. The cells of a neighbour map that the screen shows past an edge are not in the Atlas.
- `warps`: the exits of the map (doors, stairs, exit mats) that the player saw or took, with their cell, their metatile `behavior` and `to`. `to` is the map where the exit goes when the **Run** went through it, else `null`. An exit goes in the two directions, so the Harness also knows the destination of the exit where the player arrives on a map: after the starter **Run**, the door of the player's house in Pallet Town has its destination, but the door of the rival's house has none.
- `edges`: the edges of the map with a neighbour map, when the player saw a cell of that edge or crossed it, with `side` and `to`, as for the warps.
- `signs`: the signs on the cells that the player saw, with `text`: the text of the `readText` just after an `interact` with the sign, else `null`.
- `entry`: a cell of the map where the player stood and can walk, for a `goTo` to this map.

At the `full` **Knowledge level**, the Atlas has all the maps of the game from the ROM: all the cells, all the exits and edges with their destination, and all the signs (with the texts that the player read). The `entry` of a map that the player did not visit is a walkable cell next to one of its warps, else a walkable cell on one of its edges with a neighbour map. Its first `observe()` reads the 425 maps (about 30 ms).

`harness.sight()` gives what the player really saw, also at the `full` level: for each visited map, one character for each cell, `1` seen and `0` not seen. The Viewer shows the other cells in grey.

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

The scripted bot (version 3, goal `first-rival-battle`) leaves the house and walks north in Pallet Town until Professor Oak stops the player (`goTo(12, 1)` returns `interrupted` with the reason `trigger`). Then it calls `readText()` until the game waits for the player to walk: four calls, and the player is in Oak's lab at (6, 4). Then it takes SQUIRTLE: `goTo(9, 5)`, `interact(9, 4)`, `readText()`, `choose("YES")`, `readText()`, `choose("NO")` for the nickname, and `readText()` while BOB takes BULBASAUR. Then it walks to the door: the rival stops it at (7, 8) (`goTo(6, 11)` returns `interrupted` with `trigger`), and `readText()` returns `interrupted` with `battle`. In the battle against BULBASAUR, it uses TAIL WHIP, then TACKLE, and `readText()` at each text. With TACKLE only, SQUIRTLE loses. SQUIRTLE wins and grows to level 6, the rival leaves the lab, and the **Run** ends with the reason `goal` at frame 15017, with no Raw input.

`bun test` runs the tests. The tests of `src/harness/harness.test.ts` (but not the tests of the list of the **Bots**), `src/harness/record.test.ts`, `src/harness/pool.test.ts` and `src/model/model-bot.test.ts` need the Lab build and `saves/start.sav`; without them, the tests skip.

## The model bot

The model bot (`bots/model.ts`, version 2, no goal) asks an AI model on OpenRouter what to do, and its code calls the harness (ADR 0003). One **Bot** plays all the models: the **Run** gives the model and its options.

1. Make an OpenRouter key for the lab only, with a credit limit in the OpenRouter dashboard. Put it in `lab/.env`: `OPENROUTER_API_KEY=sk-or-...`. Git ignores this file, and the key is not in the Run records or in the logs.
2. In `lab/`: `bun run bot model`, or `bun run bot model <id>` for another model, for example `bun run bot model deepseek/deepseek-v4-flash-0731`. The default model is `deepseek/deepseek-v4-flash`. The options are `--cost-limit <dollars>`, `--reasoning off|low|medium|high`, `--temperature <0 to 2>` and `--starter free|BULBASAUR|CHARMANDER|SQUIRTLE`. The Viewer also starts it (panel "Runs").

Only the models with structured outputs play: the request asks for a strict JSON schema and accepts only the providers that apply it (`provider.require_parameters`). The default reasoning is `low`: with `--reasoning off`, the request sends the effort `none`, so the model does not reason. It is cheaper, but a model with no reasoning makes more mistakes, for example a target number that is not the target of its reason. A model that always reasons (for example `z-ai/glm-5.3-flash` or `openai/gpt-oss-120b`) does not have the effort `none`: do not give it `--reasoning off`. With no `--temperature`, the model uses its own default.

The code reads the texts (`readText`) and waits while the game is busy, with no **Model call**. It makes a **Model call** only when the game waits for a walk, a choice, a battle action or a move, or a Pokémon in the party menu of a battle (there, only **Raw inputs**). When `readText` is `impossible` (a screen that no **Macro-action** covers), the code presses B 3 times, and the history of the model tells it.

The prompt is in English, and its size has a limit, also in a long **Run**:

- the rules of the program, the long-term goal ("Become the Champion: earn the 8 gym badges, then beat the Elite Four.") and the starter: the first Pokémon that the model must choose, or with `free` (the default), a sentence that tells it to choose the one that it likes. The rules have no goal of the **Run** and no step of the story. They give the advice of a good player: talk to the people, heal at a Pokémon Center, train before a Gym Leader, buy Poké Balls and Potions. One rule tells the model to answer NO to the nickname question: the harness cannot type names yet. One paragraph tells the model to try something new when its last decisions give nothing new: talk to the people, read the signs, take the exits that it did not take, go to the cells that it did not see. The rules also tell what the extract of the **Atlas** is, and the legend of its map.
- what the game waits for, the next **Milestone**: the first one, in the order of the story, that the **Run** did not reach, with a name and a place only (for example "Next Milestone: Earn the Boulder Badge from Brock, the Gym Leader of Pewter City."), the last **Mission** that the model gave and the number of decisions since it changed ("Mission: Get my first Pokémon (the same for 12 decisions)."), the last **Objective** that the model gave, the notes of the last answer that the Bot could read, and the number of **Decision points** with no progress (`harness.noProgress`);
- the tries since the last progress (a new cell or a new **Milestone**): each **Macro-action** or **Raw input** that the code played for an answer of the model, one time, with the number of times, its result and the texts that the code read after it, for example `interact(9, 4) ×3: "Those are POKé BALLS. They contain POKéMON!"`. The code makes this list from the events of the **Run**, not from the notes of the model. The `readText` and the B presses of the code are not tries. The list keeps the last 20 lines, after one line with the number of the older tries, and each result has 200 characters at most;
- the last 15 **Model calls**: each answer, then the **Macro-actions** and **Raw inputs** that the code played, their results, the texts and the map changes, until the next **Model call** (30 lines at most for each);
- the party with what the Summary screen shows (see `observe()`) and the **Milestones**;
- at a walk, the extract of the **Atlas** (`src/model/extract.ts`). First the map of the player in ASCII with its coordinates, and `?` for a cell that the player did not see. The grid shows only the rectangle from the first seen row and column to the last seen row and column. Then one line for each map one exit away, with its exits and their destinations. Then a numbered list of targets:
  - the exits and the edges of the map, with the destination when the **Run** went through them, else "not taken";
  - the edges of the seen area, for example "unseen cells north of (6, 3)". For each side, it is the nearest seen cell that the player can reach on foot, next to a cell that the player did not see;
  - the people on the seen cells with their sprite, and the rival with its name: "BOB (your rival) at (5, 4)";
  - the signs on the seen cells, with their text when the player read them;
  - the other maps of the **Atlas**, for example "go to PalletTown_RivalsHouse (2 exits away)".

  The extract has about 2 000 characters at most. Past that limit, the maps that are far (in number of exits that the **Run** knows) lose their line first. The map of the player and its own targets always stay, so a big map can make the extract longer. The actions are `go <n>`, `goTo <x> <y> [<map>]`, `viewAtlas` and `press <button>`. For `go <n>`, the code takes an exit, or walks next to a person or a sign and calls `interact`, or calls `goTo` to the cell of the target or to the `entry` of another map;
- `viewAtlas`: the code calls the model again at once. The new prompt has the full **Atlas** after the extract: the other maps in detail, the nearest first. Its history also has the `viewAtlas` call. Past 15 000 characters, the far maps keep one line (their exits and the signs that the player read), then lose it. No frames run. `viewAtlas` is not a **Macro-action**, and the model can use it one time at most at each **Decision point**, that is, at each frame of the game: an action that is `impossible` runs no frames. Until the next frame, the prompt keeps the full **Atlas** and has no `viewAtlas` action, and a second `viewAtlas` is an answer that the Bot cannot read;
- at a choice: the map of the player (the seen cells only), and `choose <option>`. In a battle: the player's Pokémon (HP, status, stats, stat stages), the enemy as the player sees it with its types, and `fight <n>` for each move with its type, power, accuracy and PP, and `run`. In the party menu of a battle: the battle, and `press <button>` only.

The answer is JSON: `reason`, `action`, `mission` and `objective` (200 characters at most each) and `notes` (500 characters at most, the model writes them again at each call). The rules tell the model to keep its **Mission** until the game shows that it reached it, and to change its **Objective** as often as it needs: a person that is not where the model expected changes the **Objective**, not the **Mission**. They also tell it to keep the facts about its **Mission** in its notes. An empty `mission` keeps the last one. An action that is `impossible` is not an error: the model sees it in its history.

The **Run** of the model bot goes on after each **Milestone**. It ends with `cost limit` (a normal end, with a Run record) when the cost of the **Run** (the sum of `usage.cost`) is more than the cost limit: 0.50 $ by default, and `LAB_COST_LIMIT` in `lab/.env` changes the default. It also ends with `user stop`, or with `goal` at `badge-8`. It has no frame budget and no no-progress limit. The model bot stops (`bot stopped`, with an error) after 3 answers in a row that it cannot read: an answer that is not JSON, a field that is missing, an action that is not in the list, or a request that failed.

Each **Model call** is a `model` event of the **Run record**: `model` (the id), `situation` (what the game waited for, and where), `prompt` (`system` and `user`), `answer` (the text, or `null` when the request failed), `decision` (`reason`, `action`, `mission`, `objective`, `notes`, or `null` when the Bot cannot read the answer; a record from before the **Mission** has no `mission`), `error` (why the Bot cannot read the answer, else `null`), `usage` (`promptTokens`, `completionTokens`, `reasoningTokens`, `cost` in $) and `latencyMs`. The header of the record has the model and its options in `bot.model`. A model bot asks its AI model through `harness.modelCall(ask)`: the Harness calls the option `onModelCallStart` of `Harness.open`, runs `ask`, measures the latency, adds the `model` event, calls the option `onModelCall`, and gives back the action of the answer. `modelTotals(events)` (in `src/harness/record.ts`) gives the totals. At the end, `bun run bot` prints the **Model calls**, the tokens and the cost.

In the tests, a fake model answers: `bun test` never calls the network.

## The Run record

After `play`, `harness.record()` gives the **Run record**: the whole Run from frame 0 to now, also the actions before `play`. The Harness keeps it in memory; `bun run bot` writes it, also when the Bot throws an error, to `runs/<bot>-<version>-<date>.json`. `runs/` is not in git. The record has:

- `header`: the origin of the Run (`rom`: the SHA-256 of the ROM file with the bytes of `BuildDateTime` at zero; `seed`: `gLabRngSeed` in the ROM; `startSave`: the SHA-256 of `saves/start.sav`, or `null` when there is no Starting save), the **Knowledge level**, and the name and version of the Bot (and `model` for a model bot: its AI model and the options). The record has no save data.
- `buttons`: the keys at each frame from frame 0 (the Starting save), compressed: `[keys, frames]` is a set of keys held for that number of frames. The keys are the bits of `Keys` in `src/protocol.ts`.
- `events`, in frame order: `action` (each **Macro-action** and **Raw input**, with its parameters, its result and the frame where the Bot asked for it), `map` (the player arrives on a map), `battle` (`start` or `end`), `milestone` (a new **Milestone**) and `model` (a **Model call** of a model bot: see below). The `frame` of a game event is the frame count after the frame where the Harness saw it. The Harness reads the map and the Milestones only on the overworld and in a battle: the first `map` event is the end of the boot.
- `result`: the result of `play`.

`replay(record)` (in `src/harness/record.ts`) starts a new Run, runs the buttons alone, and gives the `map`, `battle` and `milestone` events, the last frame and the screen hash. The `action` and `model` events come from the Bot, not from the buttons, so a replay does not give them. `replay` does not compare its events with the record: the caller does, as `src/harness/record.test.ts` does. It does not accept a record when the ROM hash, the seed or the Starting save hash is not the same. A rebuild of the same code at the same repo path keeps the ROM hash: the record of the scripted bot replays after `touch src/main.c && make lab` with the same events, frames and screen.

## Replay a Run record in the Viewer

The panel "Replay" of the Viewer lists the files of `runs/` (the list loads when the page opens). "Replay" starts the Run again from the Starting save and runs the buttons of the record at ×1, with sound after the first click or key press. The replay has no pauses: the record has no time for the thinking of the Bot (ADR 0002). The Viewer does not start a file that is not a Run record. It also does not start a record with another ROM hash, seed or Starting save hash: then the Run starts again from the Starting save and the keyboard plays it.

While the replay runs, the keyboard does not play, and "Load state (L)" does not load the savestate. Pause and the speeds work. The panel shows:

- the current **Macro-action** or **Raw input**, from the frame where the Bot asked for it. When its frames end, the panel adds its result and its texts.
- for a model Bot: the model, the reasoning and the starter of the record, the **Model calls** and the cost up to the frame of the replay, and the totals of the record with its cost limit. Then the last text of the model (`model` events).
- the events of the record (actions, maps, battles, **Milestones**, model texts), each one at its frame.

The server sends the events of a frame before the screen of that frame. A page that opens during a replay gets the events that it missed. At the end of the record, the game stops at its last frame: the replay of a record of the scripted bot ends at frame 15017 with the same screen as the Run. "Back to the keyboard" ends the replay: the keyboard plays the Run from that frame. "Restart" also ends it. Then the panel clears.

## Runs in parallel

`RunPool` (in `src/harness/pool.ts`) plays up to 4 **Runs** at the same time. Each **Run** plays in its own Bun worker (`src/harness/worker.ts`), with its **Harness** and its **Bot**: a **Macro-action** runs its frames in one synchronous block, so a **Run** in the Viewer process would stop the Viewer. Each **Run** is one emulator. The limit of 4 is a choice: the machine plays about 12 **Runs** at full speed. A pool counts only its own **Runs**: it does not know the emulators of other processes (another Viewer, `bun run bot`, the tests). Do not start them at the same time as a full pool.

- `pool.start({ bot: "model" })` starts the **Bot** `bots/model.ts` in a new worker (`bot` can also be the absolute path of a module, as for `loadBot`), with the options of `Harness.open` (`knowledge`, `frameBudget`, `noProgressLimit`). For a model bot, `model` gives its AI model and the options, all of them (the `model` of the Bot that `loadBot` gives); for another **Bot**, `model` is an error. It throws an error when `limit` **Runs** play (`new RunPool(limit)`, 4 by default). `pool.full` is true when the pool cannot start one more **Run**. A **Run** keeps its place until its worker stops, after the end of the **Run**.
- `run.stop()` asks the worker to end the **Run** with `user stop`, and `run.stopAsked` is then `true`. The worker reads a shared flag (`SharedArrayBuffer`) at each decision of the **Bot**, not a message: a scripted **Bot** gives the event loop of its worker no turn before the end of its **Run**.
- `run.done` gives the **Run record** and the error of the **Bot** (or `null`) when the worker stops; `run.end` has the same value then, and is `null` while the worker plays. When the **Run** cannot start (no such **Bot**, no ROM), the record is `null`.
- While the **Run** plays, `run.view` has its frame, its screen (at most 60 times a second) and its state, map grid, actors, camera and `sight` (`harness.sight()`), at most 10 times a second. `run.events` has the events of the **Run record** up to the end of the last **Macro-action**, **Raw input** or **Model call**, and all of them at the end. `run.modelCallsStarted` counts the **Model calls** that started: a **Model call** runs while its `model` event is not in `run.events`. At the start of each **Model call**, the worker sends the screen and the state of the frozen frame.

A **Run** in a worker gives the same **Run record** as the same **Run** alone: `src/harness/pool.test.ts` plays the scripted bot alone, then 4 times at the same time, and compares the records.

In the **Viewer**, the panel "Runs" starts a **Bot** ("Start the Bot") and lists the **Runs**: the **Run** of the Viewer (keyboard or replay) and the **Runs** of the **Bots**. Select one in the list to show it: the Viewer then shows its screen, its state and its events (in the panel "Replay"). The other **Runs** do not stop. The whole-map view of another map shows the people of the **Run** of the Viewer only: for a **Run** of a **Bot**, it shows none. The **Run** of the Viewer is one of the 4 emulators, so the Viewer starts 3 **Runs** of **Bots** at most at the same time. A **Run** of a **Bot** plays at full speed, with no sound. The keyboard, the speeds, pause and the savestate act only on the **Run** of the Viewer: while a **Run** of a **Bot** is shown, the server ignores them and the keyboard does not play. At the end of a **Run** of a **Bot**, the Viewer writes its **Run record** to `runs/`. "Replay" shows the **Run** of the Viewer again.

For the model bot, the panel "Runs" has a field for the OpenRouter model id, a field for the cost limit in $, a list for the reasoning (`low` by default) and a list for the starter (`free` by default). Empty fields take the defaults. "Stop the Run" stops the shown **Run** of a **Bot** (`user stop`, with a **Run record**): for a model bot, after the **Model call** that runs, so it can take some seconds. Until the end, the list shows "stops…". Under the list, the panel shows the model of the shown **Run**, its reasoning, its starter and its cost now, with its cost limit. In the panel "Replay", "the model thinks…" shows while a **Model call** runs. When the answer comes, the panel shows the **Mission**, the **Objective** and the reason with the action, before the action plays. A replay of a **Run record** shows them too, at the frame of each **Model call**.

The panel "Model", under the Lab, lists the **Model calls** of the shown **Run** (frame, situation, action) and shows one of them in full: the answer (action, reason, **Mission**, **Objective**, notes, or why the Bot cannot read it), the tokens, the cost and the latency, then the prompt in blocks (situation and tries, history, party, local view, **Atlas**, targets, full **Atlas**, battle, question, actions, the rules, and "Other" for a block with no known title). It follows the last call; a click on a call in the list shows that call, and "Follow the last call" follows again. It reads only the `model` events, so it works live and in a replay. In a replay, the call after a `viewAtlas` comes at the same frame as the `viewAtlas`, so the two show together.

The whole-map view shows in grey the cells that the player of the shown **Run** never saw (`harness.sight()`; for the **Run** of the Viewer, the server watches its frames from the Starting save). A load of the savestate keeps the cells that the player saw after the save: the player saw them. A map that the player never visited is all grey.

## The Doc tab

The Viewer has two tabs: "Lab" (the screen, the panels and the whole-map view) and "Doc". The Doc is one page that tells what the lab can do now: the principle, what the harness can do and cannot do yet, and the **Bots**. Its text is in `viewer/index.html`, and a person writes it by hand: this README stays the full reference. A tab only shows or hides a part of the page, so a change of tab does not stop the **Run** of the Viewer or the **Runs** of the **Bots**. In the Doc tab, the keyboard does not play: the arrow keys scroll the page.

The list of the **Bots** in the Doc and in the panel "Runs" comes from the server: `botInfos()` (in `src/harness/harness.ts`) loads each module of `bots/` and gives its name (the name of the module), the kind of its **Bot** (`model` for a **Bot** with `model`, else `scripted`), its version and its goal. When a module gives no **Bot** (it throws an error, or a model bot has a bad option), the Doc shows the error for that module, and the other **Bots** stay in the two lists. The scripted bot is not in `bots/`, so the two lists do not show it.

`viewer/doc.test.ts` fails when the table of the **Macro-actions** in the Doc does not have one line for each **Macro-action** of the harness, or when the Doc does not name the **Raw input** `press`. The harness gives its **Macro-actions** in `MACRO_ACTIONS`: the names in `ACCEPTS`, the map from each kind of `waitingFor` to the **Macro-actions** that it accepts. When you add a **Macro-action**, add its line to the table of the Doc.

## Make the Starting save

1. Start the Viewer with no `saves/start.sav`. The lab build then starts as the vanilla game: intro, title screen, new game.
2. Play to your room and set the text speed to "Fast" in the options.
3. Save in the game. Wait for the message that tells you the save is complete.
4. Click "Write the Starting save". The harness writes `saves/start.sav` and keeps the previous file next to it.

With `saves/start.sav`, the lab build skips the intro, the title screen and the "Previously on your quest" recap, and continues the game in a few frames.

## Files

- `shim/shim.c`: plain C functions over the libmgba core.
- `src/core.ts`: one emulator instance (bun:ffi).
- `src/symbols.ts`: reads the debug info of the `.elf` (addresses and types of all globals, function addresses). Cached in `.cache/`.
- `src/memory.ts`: typed memory reads, for example `mem.global("gSaveBlock1Ptr").deref().field("pos").field("x").int()`.
- `src/game.ts`: FireRed state (map, party, badges, money, context, **Milestones**), what the game waits for (walk, text, choice, the battle menus), the grid of the player's map or of any map from ROM, the actors on it (people, trainer sight, triggers), and the **Interruption** of each frame (battle, trigger, trainer, script).
- `src/prompts.ts`: the text decoder, the message boxes and their text, and the yes/no.
- `src/battle.ts`: the battle: the kind, the player's and the enemy's Pokémon from the battle data, the enemy as the player sees it, the battle menus and their cursors, the party menu of a battle, and the moves that the enemy used.
- `src/party.ts`: the party, as the Summary screen shows it: species, ability, held item, nature, EXP and moves from the encrypted Pokémon data, with the types, the move data and the texts from the ROM tables, and level, HP, stats and status from the party fields.
- `src/run.ts`: one **Run**: the emulator and the game reads, started from the **Starting save**, and `readState()`, the state that the Viewer shows.
- `src/server.ts`: the Viewer page and its WebSocket, the wall-clock pacing of the Run, the replay of a **Run record**, and the **Runs** of the pool that the Viewer starts and shows.
- `src/model/`: the parts of the model bot: `openrouter.ts` (the settings and the request), `decision.ts` (the answer and its action), `targets.ts` (the targets of a walk), `extract.ts` (the extract of the **Atlas** and the full **Atlas** in text) and `prompt.ts` (the text of the prompt, with the tries since the last progress).
- `src/harness/`: the API of the **Bot**: `harness.ts` (observation, **Macro-actions**, **Raw inputs**, the end of a **Run**, and the loading of a **Bot** from `bots/`), `path.ts` (A* over the maps: walk, ledges, warps and map edges), `atlas.ts` (the **Atlas** and the sight of a **Run**), `record.ts` (the **Run record**, `RecordPlayer` that gives its keys and its events frame by frame, and its replay), `pool.ts` (up to 4 **Runs** in workers) and `worker.ts` (one **Run** of the pool), `play.ts` (the `bot` command).
- `bots/`: the **Bots**: `model.ts` (the model bot). The scripted bot of the tests is `src/harness/scripted-bot.ts`.
- `viewer/`: the page. `viewer/mapdraw.ts` draws a map at any scale (screen overlay and whole-map view); `viewer/audio.ts` plays the sound; `viewer/replay.ts` is the replay panel; `viewer/runs.ts` is the panel of the **Runs**; `viewer/model-panel.ts` is the panel "Model"; `viewer/doc.ts` is the tabs and the list of the **Bots** in the Doc. All the texts of the Viewer are in English.

## Sound

The sound plays only at speed ×1. The browser starts it after the first click or key press; `M` turns it off and on. The page keeps about 60 ms of audio queued and sends the queue length to the harness, which makes the Run up to 1% faster or slower to hold it there (the emulator clock and the sound card clock drift apart).

## Notes

- The ROM bytes change on each build: the game stores the build date (`BuildDateTime`). To compare two builds, ignore those bytes.
- The vanilla build is compiled without `-g`, because `-g` changes the order of linker veneers in the ROM.
- `saves/`, `runs/` and `.cache/` are not in git. Never put a ROM in git or on a public URL.
