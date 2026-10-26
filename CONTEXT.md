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
The thing that decides what to do in a **Run**, through the **Harness** only. A scripted bot is code. A model bot is code that asks an AI model what to do when the game waits for a walk, a choice, a battle action, a Pokémon to send out or the buy list of a Poké Mart, and then calls the **Harness**. The code of a model bot reads the texts and waits while the game is busy, with no request to the AI model. The AI model sees text only, and it does not call the **Harness** itself.
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

**Mission**:
A short sentence that a model bot sets itself: the story step that it works on, for example "talk to Professor Oak and get my first Pokémon". The AI model keeps it until the game shows that it reached it, over many **Objectives**. It is not the goal of the **Run**: that goal is a **Milestone**.
_Avoid_: goal (the **Milestone** that ends a **Run**), quest, long-term objective

**Objective**:
A short sentence that a model bot sets itself: what it does now for its **Mission**, for example "look for Professor Oak outside the lab". The AI model changes it as often as it needs.
_Avoid_: goal (the **Milestone** that ends a **Run**), quest

**Model call**:
One request of a model bot to its AI model, and its answer: one action, with a short reason. The code of the Bot plays this action with one or more **Macro-actions**, or with one **Raw input**. The actions `viewAtlas` and `zoom` play neither: the Bot makes a new model call at once, at the same **Decision point**. A model bot makes a model call only when the game waits for a walk, a choice, a battle action, a Pokémon to send out or the buy list of a Poké Mart. Thus a **Run** usually has fewer model calls than **Decision points**.
_Avoid_: prompt, turn, step

**Memory tree**:
The memory that a model bot writes itself. Each note is one short line that the AI model adds when it learns something, and that nobody changes later. Two neighbour nodes of the same size get a parent node: a short summary of the two. The AI model sees only the top nodes, and it can open a node to see its two halves, down to the notes. It keeps the conclusions of the AI model; what the game showed is in the **Atlas** and in the history of the **Model calls**.
_Avoid_: notes (the old text that the AI model wrote again at each call), memory (too wide)

**Stuck counter**:
The number of **Decision points** of a **Run** since its last progress. Progress is a new map, a new **Milestone**, a new exit in the **Atlas**, a level up of a Pokémon of the party, or a text of a person that the player did not hear before. A new cell is not progress.
_Avoid_: no-progress count, walk count (the two old counts that it replaces)

**Reflection turn**:
A **Model call** of a model bot at each 30 more **Decision points** on the **Stuck counter**, at the first walk. Its prompt adds the full **Atlas** and asks the AI model to write a lesson in its **Memory tree** and to set a new **Objective**. It is not a separate request.
_Avoid_: stuck message, reflection call

**Summary call**:
One request of a model bot to its AI model that writes the summary of two nodes of its **Memory tree**. It gives no action, and it runs at the same **Decision point** as the **Model call** that added the note. Its cost counts in the cost of the **Run**.
_Avoid_: Model call (a **Model call** gives an action)

**Knowledge level**:
The set of game facts that the **Harness** shows to a **Bot** in a **Run**. The `player` level shows what a careful human player can know; the `full` level shows more, for example hidden items and exact enemy stats.
_Avoid_: mode (used for overworld or battle), cheat mode

**Atlas**:
What a **Run** knows of the world: the maps that the player visited, the cells of these maps that the player saw on the screen, each exit that the player took, in one direction or in the other, with its destination, the exits that the player saw but did not take, the text of each sign that the player read, each person that the player saw, at the cell where the player last saw it on the screen, and all the different texts that each person said when the player talked to them. A person keeps its texts when it moves. An edge that the player cannot cross now (water) has its reason in the **Atlas**. The **Atlas** also knows the person of the last talk. At the `player` **Knowledge level**, it grows only with what the player saw in the **Run**; at the `full` level, it has all the maps of the game.
_Avoid_: map (one map of the game), Town Map (an item of the game)

**Raw input**:
A button press that a **Bot** sends directly, when no **Macro-action** covers the case. The **Harness** counts each one, and then runs the game to the next **Decision point**.
_Avoid_: key press

**Starting save**:
The battery save that each run starts from. It stays valid after a rebuild while the saved data layout does not change.
_Avoid_: savestate

**Savestate**:
A snapshot of the full emulator state at one frame. It becomes invalid after each rebuild, because code addresses move.

**Run**:
One emulator instance that plays the game from a **Starting save**. The **Harness** plays 4 **Runs** at most at the same time. This is a choice: the machine can play about 12 at full speed.
_Avoid_: game, instance, session

**Milestone**:
A story step that the **Harness** reads from the game flags, for example "has a Pokémon", "the first rival battle is over" or a badge. It is one kind of progress of a **Run** (see **Stuck counter**). The **Milestones** have an order, the order of the story. A scripted bot has a goal: one **Milestone** that ends its **Run**. A model bot has no goal: the code gives it the next **Milestone**, the first one in the order that it did not reach, and its **Run** continues after it.
_Avoid_: flag (a flag is one bit of the save), achievement

**Run record**:
The file that keeps one **Run**: its build, seed, **Starting save**, **Bot** and **Knowledge level**, the buttons at each frame, the events and the **Run result**. Its buttons alone replay the **Run**.
_Avoid_: log, replay (a replay is what you watch from a run record), movie

**Continued Run**:
A **Run** that starts at the end of a stopped **Run**, its parent: the **Harness** replays the buttons of the parent **Run record** and keeps its events, so the **Bot** has the **Memory tree**, the **Mission** and the **Atlas** of the parent. Its **Run record** has the buttons and the events of the parent, then its own. Its cost limit counts its own **Model calls** only, and its model can be another one.
_Avoid_: resumed run, restart, savestate

**Run result**:
What a **Run** gives at its end: the end reason, the frames, the **Milestones** and the number of **Raw inputs**. The end reason is `goal` (the goal **Milestone**, or the last **Milestone** for a model bot), `bot stopped`, `user stop` (a person stopped the **Run**), `cost limit` (the **Model calls** of the **Run** cost more than its cost limit), `frame budget` (the **Run** used all the frames that it can run) or `no progress` (the **Stuck counter** reached N; N is an option of the **Harness**, with no default). A model bot has no frame budget and no limit of **Decision points** with no progress.
_Avoid_: score, outcome

**Viewer**:
The web page that shows one **Run** at a time (its screen and its state). It shows its own **Run**, or a **Run** of a **Bot** that plays at the same time. The keyboard plays its own **Run**, or the buttons of a **Run record** replay it. It does not emulate.
_Avoid_: emulator, web player

## Relationships

- The **Harness** runs a **Lab build** or a **Vanilla build**, and starts it from a **Starting save**.
- A **Bot** plays one **Run**. **Agents** write scripted **Bots**.
- A **Bot** gets control only at a **Decision point** or after an **Interruption**, and sees the game through the **Knowledge level** of its **Run**.
- A **Bot** uses **Macro-actions**, and **Raw inputs** only when no **Macro-action** fits.
- Each **Run** has one **Run record**. A **Run** ends when its **Bot** stops, a person stops it, or it reaches its goal. The **Run** of a scripted bot also ends when its frame budget is used. A **Run** also ends with `no progress` when the **Harness** has a limit for it. The **Run** of a model bot also ends at its cost limit.
- A **Continued Run** has one parent **Run record**, and its own **Run record** names the parent.
- The lab has one model bot. The scripted bot is a tool to test the **Harness**: it does not grow with the story.
- The **Viewer** shows one **Run** at a time. The **Harness** owns all **Runs**.
- A **Savestate** is valid only for the build that made it. A **Starting save** is valid for all builds.

## Flagged ambiguities

- "Save" was used for both the battery save and the emulator snapshot. Resolved: **Starting save** is the battery save; **Savestate** is the snapshot.
