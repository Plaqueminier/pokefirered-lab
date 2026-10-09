# Pokémon FireRed lab

This fork of the FireRed decompilation is a lab. In it, programs play the game, and we record the play for videos.

## Language

**Vanilla build**:
The ROM built without the lab flag. Its gameplay and behaviour are the same as the original game.
_Avoid_: normal ROM, release build

**Lab build**:
The ROM built with the lab flag. It has the same gameplay as the vanilla build. It adds aids for tests and observation, for example: skip the intro, load the save automatically, set the RNG seed.
_Avoid_: debug build, mod, hack

**Harness**:
The program that runs the emulator, sends the button inputs and reads the game state from memory.
_Avoid_: bot, emulator, AI

**Starting save**:
The battery save that each run starts from. It stays valid after a rebuild while the saved data layout does not change.
_Avoid_: savestate

**Savestate**:
A snapshot of the full emulator state at one frame. It becomes invalid after each rebuild, because code addresses move.

**Run**:
One emulator instance that plays the game from a **Starting save**. The **Harness** can have several runs at the same time.
_Avoid_: game, instance, session

**Viewer**:
The web page that shows one **Run** (its screen and its state) and sends keyboard input to it. It does not emulate.
_Avoid_: emulator, web player

## Relationships

- The **Harness** runs a **Lab build** or a **Vanilla build**, and starts it from a **Starting save**.
- The **Viewer** shows one **Run** at a time. The **Harness** owns all **Runs**.
- A **Savestate** is valid only for the build that made it. A **Starting save** is valid for all builds.

## Flagged ambiguities

- "Save" was used for both the battery save and the emulator snapshot. Resolved: **Starting save** is the battery save; **Savestate** is the snapshot.
