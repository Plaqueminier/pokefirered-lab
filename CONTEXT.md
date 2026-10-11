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
The program that runs the emulator and gives a **Bot** one interface to the game: the game state and the **Macro-actions**. It does not decide what to do.
_Avoid_: emulator, AI

**Bot**:
The thing that decides what to do in a **Run**, through the **Harness** only. A scripted bot is code; a model bot is an AI model that calls the **Harness**.
_Avoid_: player, agent, AI

**Agent**:
An AI coding assistant that writes or changes the code of a **Bot**. It does not play.
_Avoid_: bot

**Macro-action**:
One game action that a **Bot** asks the **Harness** to do, for example go to a cell, talk to a person or use a move. It runs until it is complete or until the game interrupts it, and it never makes a game decision. Its result is `done`, `impossible` (it cannot start or continue), `blocked` (a person stays in the way) or `interrupted`, with an **Interruption** as the reason.
_Avoid_: command, move (a move is a Pokémon attack)

**Interruption**:
An event of the game that stops a **Macro-action**: a coord trigger, a trainer who sees the player, another script, a battle, or an arrival on a map that is not on the route. The **Macro-action** returns at the first frame of the interruption. That frame is not always a **Decision point**, but the game is also frozen there. A text, a choice, an interaction after its A press, or a **Raw input** stops only for a battle, because a script runs during them.
_Avoid_: event (a map event is a warp, a person, a sign or a trigger), stop

**Decision point**:
A frame where the game waits for an input that a **Bot** must choose, for example walk, a text box, a choice, a battle action or a name. The game is frozen until the **Bot** gives the next action. Frames where the game waits for nothing (animations, fades, walking) are not decision points.
_Avoid_: turn (in a battle, a turn is one round), pause, step

**Knowledge level**:
The set of game facts that the **Harness** shows to a **Bot** in a **Run**. The `player` level shows what a careful human player can know; the `full` level shows more, for example hidden items and exact enemy stats.
_Avoid_: mode (used for overworld or battle), cheat mode

**Raw input**:
A button press that a **Bot** sends directly, when no **Macro-action** covers the case. The **Harness** counts each one, and then runs the game to the next **Decision point**.
_Avoid_: key press

**Starting save**:
The battery save that each run starts from. It stays valid after a rebuild while the saved data layout does not change.
_Avoid_: savestate

**Savestate**:
A snapshot of the full emulator state at one frame. It becomes invalid after each rebuild, because code addresses move.

**Run**:
One emulator instance that plays the game from a **Starting save**. The **Harness** can have several runs at the same time.
_Avoid_: game, instance, session

**Milestone**:
A story step that the **Harness** reads from the game flags, for example "has a Pokémon", "the first rival battle is over", "has the Pokédex" or a badge. It is the unit of progress of a **Run**, and the goal of a **Run** is a **Milestone**.
_Avoid_: flag (a flag is one bit of the save), achievement

**Run record**:
The file that keeps one **Run**: its build, seed, **Starting save**, **Bot** and **Knowledge level**, the buttons at each frame, the events and the **Run result**. Its buttons alone replay the **Run**.
_Avoid_: log, replay (a replay is what you watch from a run record), movie

**Run result**:
What a **Run** gives at its end: the end reason, the frames, the **Milestones** and the number of **Raw inputs**. The end reason is `goal`, `bot stopped`, `frame budget` (the **Run** used all the frames that it can run) or `no progress` (the **Bot** made N **Decision points** in a row with no new cell and no new **Milestone**).
_Avoid_: score, outcome

**Viewer**:
The web page that shows one **Run** (its screen and its state) and sends keyboard input to it, or replays a **Run record**: then the buttons of the record play the **Run**, not the keyboard. It does not emulate.
_Avoid_: emulator, web player

## Relationships

- The **Harness** runs a **Lab build** or a **Vanilla build**, and starts it from a **Starting save**.
- A **Bot** plays one **Run**. **Agents** write scripted **Bots**.
- A **Bot** gets control only at a **Decision point** or after an **Interruption**, and sees the game through the **Knowledge level** of its **Run**.
- A **Bot** uses **Macro-actions**, and **Raw inputs** only when no **Macro-action** fits.
- Each **Run** has one **Run record**. A **Run** ends when its **Bot** stops, its goal is reached, its frame budget is used, or its **Bot** makes no progress.
- The **Viewer** shows one **Run** at a time. The **Harness** owns all **Runs**.
- A **Savestate** is valid only for the build that made it. A **Starting save** is valid for all builds.

## Flagged ambiguities

- "Save" was used for both the battery save and the emulator snapshot. Resolved: **Starting save** is the battery save; **Savestate** is the snapshot.
