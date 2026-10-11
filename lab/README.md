# Lab harness

The harness runs the **Lab build** in libmgba from Bun. The **Viewer** shows one **Run** in the browser. See `../CONTEXT.md` for the terms and `../docs/adr/` for the decisions.

## Run the Viewer

1. At the repo root: `make lab -j8`. This gives `pokefirered_modern_lab.gba` and its `.elf` with debug info.
2. In `lab/`: `bun install`, then `bun run viewer`.
3. Open http://localhost:8766.

Requirements: Homebrew `mgba` (for `libmgba` and its headers), the macOS `dwarfdump`, and a C compiler. The harness compiles `shim/shim.c` into `.cache/` when the file changes.

## Run a Bot

In `lab/`: `bun run bot stairs`. The command runs the **Bot** `bots/stairs.ts` headless from `saves/start.sav`, and prints each **Macro-action** with its result and its frame count. The game is frozen at each **Decision point** (ADR 0002), so each start gives the same frames.

A **Bot** is a module in `bots/` that exports `{ name, version, play(harness) }`. It calls the harness with `await`, for example `await harness.goTo(10, 2)`.

`bun test` runs the tests. The tests of `src/harness/harness.test.ts` need the Lab build and `saves/start.sav`; without them, the tests skip.

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
- `src/game.ts`: FireRed state (map, party, badges, money, context), the grid of the player's map or of any map from ROM, and the actors on it (people, trainer sight, triggers).
- `src/run.ts`: one **Run**: the emulator and the game reads, started from the **Starting save**.
- `src/server.ts`: the Viewer page and its WebSocket, and the wall-clock pacing of the Run.
- `src/harness/`: the API of the **Bot**: `harness.ts` (observation and **Macro-actions**), `path.ts` (A* on the map grid), `play.ts` (the `bot` command).
- `bots/`: the **Bots**.
- `viewer/`: the page. `viewer/mapdraw.ts` draws a map at any scale (screen overlay and whole-map view); `viewer/audio.ts` plays the sound.

## Sound

The sound plays only at speed ×1. The browser starts it after the first click or key press; `M` turns it off and on. The page keeps about 60 ms of audio queued and sends the queue length to the harness, which makes the Run up to 1% faster or slower to hold it there (the emulator clock and the sound card clock drift apart).

## Notes

- The ROM bytes change on each build: the game stores the build date (`BuildDateTime`). To compare two builds, ignore those bytes.
- The vanilla build is compiled without `-g`, because `-g` changes the order of linker veneers in the ROM.
- `saves/` and `.cache/` are not in git. Never put a ROM in git or on a public URL.
