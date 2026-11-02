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
The thing that decides what to do in a **Run**, through the **Harness** only. A scripted bot is code. A model bot is code that asks an AI model what to do when the game waits for a walk, a choice, a battle action, a Pokémon to send out, the shop menu of a Poké Mart, the item PC, a name or a move to forget, and then calls the **Harness**. The code of a model bot reads the texts and waits while the game is busy, with no request to the AI model. The AI model sees text only, and it does not call the **Harness** itself.
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
A frame where the game waits for an input that a **Bot** must choose, for example walk, a text box, a choice, a battle action or a name. The naming screen is one **Decision point**: the **Bot** gives the whole text, and the **Harness** types it and selects OK. The learn-move question ("Delete a move to make room for …?") is one **Decision point**: the **Bot** gives the move to forget, or keeps the 4 moves, and the **Harness** does the yes/no boxes and the summary screen. The game is frozen until the **Bot** gives the next action. Frames where the game waits for nothing (animations, fades, walking) are not decision points.
_Avoid_: turn (in a battle, a turn is one round), pause, step

**Mission**:
A short sentence that a model bot sets itself: the story step that it works on, for example "talk to Professor Oak and get my first Pokémon". The AI model keeps it until the game shows that it reached it, over many **Objectives**. It is not the goal of the **Run**: that goal is a **Milestone**.
_Avoid_: goal (the **Milestone** that ends a **Run**), quest, long-term objective

**Objective**:
A short sentence that a model bot sets itself: what it does now for its **Mission**, for example "look for Professor Oak outside the lab". The AI model changes it as often as it needs.
_Avoid_: goal (the **Milestone** that ends a **Run**), quest

**Model call**:
One request of a model bot to its AI model, and its answer: one action, with a short reason. The code of the Bot plays this action with one or more **Macro-actions**, or with one **Raw input**. The actions `viewAtlas` and `zoom` play neither: the Bot makes a new model call at once, at the same **Decision point**. A model bot makes a model call only when the game waits for a walk, a choice, a battle action, a Pokémon to send out, the shop menu of a Poké Mart, the item PC, a name or a move to forget. Thus a **Run** usually has fewer model calls than **Decision points**.
_Avoid_: prompt, turn, step

**Unusual call**:
A **Model call** that the **Viewer** marks with one or more flags: an answer that the Bot cannot read, an `impossible` or `blocked` action, a **Reflection turn** or a **Review turn**, a cost, a latency or prompt tokens above 3 times the median of its **Run**, a conversation with more turns (`zoom`, `viewAtlas`), a change of the **Mission**, or the same action 3 times in a row with no progress. The **Viewer** calculates the flags from the **Run record**: they are not in it.
_Avoid_: bad call, error (an error is only one of the flags)

**Memory tree**:
The memory that a model bot writes itself. Each note is one short line that the AI model adds when it learns something. The program removes the sentences with an HP or PP number and a note with nearly the same words as a recent note, and it marks a hedged sentence as a guess. Nobody rewrites a note later. Two neighbour nodes of the same size get a parent node: a short summary of the two, with the newest facts first. A node of more notes has more characters. The AI model sees only the top nodes, and it can open a node to see its two halves, down to the notes. A **Review turn** can remove sentences from the top nodes: they then stay out of the top nodes and of the next summaries, but `zoom` can still show them in the lower nodes. It keeps the conclusions of the AI model; what the game showed is in the **Atlas** and in the history of the **Model calls**.
_Avoid_: notes (the old text that the AI model wrote again at each call), memory (too wide)

**Stuck counter**:
The number of **Decision points** of a **Run** since its last progress. Progress is a new map, a new **Milestone**, a new exit in the **Atlas**, a level up of a Pokémon of the party, a text of a person that the player did not hear before, a trainer that the player beats, an item that the player finds (an item ball or a hidden item), or a new species caught (the Pokédex marks it owned). A new cell is not progress.
_Avoid_: no-progress count, walk count (the two old counts that it replaces)

**Character turn**:
The first **Model call** of a **Run** of a model bot with no Pokémon. It starts from an idea that the program selects at random, for example a shy baker. The AI model invents the trainer that it plays, with its name, the name of the rival, the first Pokémon and the style of the nicknames. The **Run** then boots again from a copy of the **Starting save** with these names, at the same frame. A continued **Run** with an action in its parent keeps the names of its game, and the AI model gets them. The prompt of each later **Model call** shows this character. At a Poké Ball of Professor Oak, the program answers for the AI model: YES to this Pokémon, NO to another. It is not a separate request.
_Avoid_: persona call, personality turn

**Normal trainer**:
The character that the Viewer shows for a **Run** with no **Character turn**, for example a **Run** of an older version of the model bot. All these **Runs** have the same text. A **Race** also gives it to a **Run** with no readable character, so each **Ghost** has a text. The AI model never reads it, and no **Run record** holds it.
_Avoid_: default persona, neutral character

**Thinking**:
The reasoning level of the **Character turns**, **Reflection turns** and **Review turns** of a **Run** of a model bot. The other **Model calls** use the reasoning level of the **Run**, and also the next calls of such a turn after an empty answer.
_Avoid_: thinking mode, deep reasoning

**Reflection turn**:
A **Model call** of a model bot at each 20 more **Decision points** on the **Stuck counter**, at the first walk or battle action. Its prompt asks the AI model to write a lesson in its **Memory tree** and to set a new **Objective**. At a walk, it also adds the full **Atlas**. It is not a separate request.
_Avoid_: stuck message, reflection call

**Review turn**:
A **Model call** of a model bot at the first walk after 20 decisions since its last **Review turn** or **Reflection turn**, also with progress. A decision is a **Model call** after which the program played an action. Its prompt adds the full **Atlas** and a short check: the way to the next **Milestone**, the facts against the **Mission**, the guesses from the signs and the people, and the exits left to explore. The AI model writes the result in its **Mission**, its **Objective** and a note, and it can give the numbers of at most 5 sentences of the top nodes of its **Memory tree** to remove them. It is not a separate request. When a **Reflection turn** and a **Review turn** are both due at the same decision, only the **Reflection turn** shows.
_Avoid_: review call, check turn

**Summary call**:
One request of a model bot to its AI model that writes the summary of two nodes of its **Memory tree**. It gives no action, and it runs at the same **Decision point** as the **Model call** that added the note. Its cost and its tokens count in the cost and the tokens of the **Run**.
_Avoid_: Model call (a **Model call** gives an action)

**Model provider**:
The service that answers the **Model calls** and the **Summary calls** of a **Run**: `openrouter` (the default), `claude-code` or `codex`. A **Run** has one Model provider and one AI model.
_Avoid_: backend, mode, API

**Plan provider**:
A **Model provider** that a person's subscription pays for: `claude-code` or `codex`. The calls of a **Run** on a Plan provider use the quota of the subscription and cost no money, so the cost of this **Run** is 0 and a **Token limit** replaces its cost limit.
_Avoid_: free provider, subscription mode

**Token limit**:
The number of tokens that a **Run** on a **Plan provider** can use: all the input tokens with the cached tokens, and the output tokens, of its own **Model calls** and **Summary calls**. The default is 1,000,000.
_Avoid_: quota (the quota is the limit of the subscription, for all its uses)

**Knowledge level**:
The set of game facts that the **Harness** shows to a **Bot** in a **Run**. The `player` level shows what a careful human player can know; the `full` level shows more, for example hidden items and exact enemy stats.
_Avoid_: mode (used for overworld or battle), cheat mode

**Atlas**:
What a **Run** knows of the world: the maps that the player visited, the cells of these maps that the player saw on the screen, each exit that the player took, in one direction or in the other, with its destination and its arrival cell, the exits that the player saw but did not take (the neighbour cells of a wide exit that lead to the same map are one exit), the text of each sign that the player read, each person that the player saw, at the cell where the player last saw it on the screen, all the different texts that each person said when the player talked to them, and each **Fixed obstacle** that the player saw. A person keeps its texts when it moves. An edge that the player cannot cross now (water) has its reason in the **Atlas**. The **Atlas** also knows the person of the last talk. At the `player` **Knowledge level**, it grows only with what the player saw in the **Run**; at the `full` level, it has all the maps of the game, but it lists only the **Fixed obstacles** that the player saw. The **Atlas** keeps a **Fixed obstacle** that it saw. It also knows if each map is outdoor: the map type of the ROM is a town, a city or a route.
_Avoid_: map (one map of the game), Town Map (an item of the game)

**Part**:
The cells of a map that the player can walk to from one cell, on the cells that it saw and with no other map on the way. A floor of a cave can have many **Parts**: the only way between them goes through other maps. The code makes them from the **Atlas** only, so they show only what the player saw.
_Avoid_: zone, area (an **Area** is a place of the Town Map), region

**Lead**:
A target of a walk prompt of a model bot: unseen cells or an exit not taken in another **Part** or another map, by the number of exits to it. A walk through exits stops at an outdoor map, except the map of the player. It is not the **Known world**, which tells the outdoor maps.
_Avoid_: frontier (the unseen cells of the **Part** of the player), hint

**Thin wall**:
An open cell with a wall on one side: the player cannot step across that side, in either direction. Its metatile behaviour is `MB_IMPASSABLE_*`, with no collision bit. It is not a **Fixed obstacle**.
_Avoid_: one-way wall, directional collision

**Known world**:
A part of each walk prompt of a model bot: one line for each outdoor map of the **Atlas**, in the order of the first visit. Each line has the edges seen and their destinations, the passages through a gate, a forest or a cave to another outdoor map, the buildings entered, the number of doors not entered, the unseen cells left and the **Fixed obstacles**. The code makes it from the **Atlas** only, so it shows only what the player saw.
_Avoid_: world map, overview, Town Map (an item of the game)

**Fixed obstacle**:
An object of the game that never moves by itself and that only a move removes: the cut tree (CUT), the rock of ROCK SMASH and the boulder of STRENGTH. It is not a person and not a target. For a route, its cell is blocked, and the **Harness** never waits for it.
_Avoid_: person, tree (a tree of the map is a blocked metatile)

**Area**:
A town, a route or another place of the Town Map, with all its maps: the game gives each map one map section. For example, Viridian City has its streets, its Poké Mart and its Pokémon Center.
_Avoid_: zone, map section, region (Kanto is the region)

**Visit**:
The time that the player stays in one **Area**, in the panel Stats of the **Viewer**. A visit of less than 10 s is a step over a border: it joins the visit before it. A visit ends at the frame before the next visit. The Timeline groups its levels and wild battles by stay in an **Area** with no 10 s rule.
_Avoid_: stay (in the docs; the code says `stay`)

**Raw input**:
A button press that a **Bot** sends directly, when no **Macro-action** covers the case. The **Harness** counts each one, and then runs the game to the next **Decision point**.
_Avoid_: key press

**Starting save**:
The battery save that each run starts from. It stays valid after a rebuild while the saved data layout does not change. A **Run** with names plays from a copy of it, and the file does not change.
_Avoid_: savestate

**Savestate**:
A snapshot of the full emulator state at one frame. It becomes invalid after each rebuild, because code addresses move.

**Run**:
One emulator instance that plays the game from a **Starting save**. The **Harness** plays 10 emulators at most at the same time: the own **Run** of the **Viewer**, and 9 **Runs** of **Bots** or replays, enough for a **Grid** of 9. This is a choice: the machine can play about 12 at full speed.
_Avoid_: game, instance, session

**Milestone**:
A story step that the **Harness** reads from the game flags, for example "has a Pokémon", "the first rival battle is over", "has the Pokédex" or a badge. It is one kind of progress of a **Run** (see **Stuck counter**). The **Milestones** have an order, the order of the story. A scripted bot has a goal: one **Milestone** that ends its **Run**. A model bot has no goal: the code gives it the next **Milestone**, the first one in the order that it did not reach, and its **Run** continues after it.
_Avoid_: flag (a flag is one bit of the save), achievement

**Chapter**:
The part of a **Run** up to a **Milestone**, with the name of that **Milestone**: "Pokédex" is the time from the **Milestone** before it to the Pokédex. The last chapter is open, up to now: "After Pokédex", or "Start" before the first **Milestone**. The panel Stats of the **Viewer** selects a chapter as a range of frames.
_Avoid_: stage, level (a level is the level of a Pokémon)

**Run record**:
The file that keeps one **Run**: the version of its format, its build, seed, **Starting save**, names, **Bot** and **Knowledge level**, the buttons at each frame, the events, the track, the **State track** and the **Run result**. From the same build, seed, **Starting save** and names, its buttons alone replay the **Run**. The track is the place of the player at each change of cell, of map or of facing, apart from the events. A **Run record** from before format 1 has only the map, battle and **Milestone** events of the **Game events**, a **Run record** from before format 2 has no track, and a **Run record** from before format 3 has no **State track**: a command adds them from its buttons, and, on a **Run record** from before format 1, the **Game events** of the state.
_Avoid_: log, replay (a replay is what you watch from a run record), movie

**Game event**:
A change in the game that the **Harness** reads from the game state and writes in the **Run record**: a new map, a battle start or end, a **Milestone**, a heal, a purchase, an item found or received, a catch, a faint, a level (with a new move or an evolution), a change of money, a trainer beaten, a whiteout. Each one has typed fields (species, item, count, money before and after, the source of a heal, the side of a faint, the trainer, map), not only a text, so stats can count them over many **Runs**. The **Viewer** shows them; the prompt of the model bot does not use the new kinds yet.
_Avoid_: log line, fact (a fact is a line of the prompt)

**Continued Run**:
A **Run** that starts at the end of a stopped **Run**, its parent: the **Harness** boots with the names of the parent, replays the buttons of the parent **Run record** and keeps its events, so the **Bot** has the **Memory tree**, the **Mission** and the **Atlas** of the parent. Its **Run record** has the buttons and the events of the parent, then its own. Its cost limit or its **Token limit** counts its own **Model calls** only, and its model and its **Model provider** can be other ones.
_Avoid_: resumed run, restart, savestate

**Run result**:
What a **Run** gives at its end: the end reason, the frames, the **Milestones** and the number of **Raw inputs**. The end reason is `goal` (the goal **Milestone**, or the last **Milestone** for a model bot), `bot stopped`, `user stop` (a person stopped the **Run**), `cost limit` (the **Model calls** of the **Run** cost more than its cost limit), `token limit` (the **Run** used more tokens than its **Token limit**), `plan limit` (the **Plan provider** refused a call because the quota of the subscription is used; a **Continued Run** can play on later), `frame budget` (the **Run** used all the frames that it can run), `no progress` (the **Stuck counter** reached N; N is an option of the **Harness**, with no default), `whiteout` (all the Pokémon of the party fainted, and the model bot has the option `stopAtWhiteout`, on by default) or `unknown screen` (the model bot pressed B for 3 screens in a row that no action covers, with no **Model call** between them). The result of `whiteout` and of `unknown screen` also keeps the last text of the game. A model bot has no frame budget and no limit of **Decision points** with no progress.
_Avoid_: score, outcome

**Inventory**:
The Bag (its five pockets with their items and quantities) and the PC (its items, and the species of the Pokémon in its boxes) of a **Run** at one frame. The **Run record** does not keep it: the **Viewer** keeps a history of the changes of the **Inventory** of the shown **Run**, and its panel "Bag and PC" shows the **Inventory** at the cursor.
_Avoid_: items (an item is one entry of a pocket), storage

**Viewer**:
The web page that shows the **Runs**. Its **Grid** shows the screens of several **Runs**, and one **Run** at a time is the shown **Run**: the Viewer shows its screen and its state in detail. To focus a **Run** of the **Grid** is to make it the shown **Run**. The shown **Run** is the own **Run** of the Viewer, or a **Run** of a **Bot** that plays at the same time. The keyboard plays its own **Run**, or the buttons of a **Run record** replay it. A replay can jump to a frame, from a **Savestate** that the Viewer keeps at regular frames of the replay (256 at most). It does not emulate. It has five tabs: Lab (the screen and the panels of the shown **Run**), Grid, Race, Doc (what the lab can do) and Components (each component of the design system in all its states). All the panels follow one cursor (a frame of the shown **Run**) and one selection (a range of frames).
_Avoid_: emulator, web player

**Grid**:
The view of the **Viewer** that shows 2, 4 or 9 **Runs** at the same time, each in its own cell: a live **Run**, or a replay of a **Run record**. The replays of a **Grid** share one cursor of game frames: they start at frame 0 together, so they race on their game time. A replay that a person adds later goes to the frame of the cursor. A live **Run** has no shared cursor: its cell shows its own last frame, and it stops while its game waits for a **Model call**. The **Grid** shows the screen and a few facts of each **Run**; the panels are for the shown **Run** only. The **Grid** has no sound.
_Avoid_: wall, multiview, dashboard

**Race**:
A file that a command makes from a set of **Run records**: the track and the **State track** of each **Run** on one game time from frame 0, with its battles, its **Milestones**, its cost or its tokens and its **Run result**. Also the tab of the **Viewer** that plays it, on a map of Kanto with no emulator.
_Avoid_: ghost map, replay (a replay is what you watch from a Run record in an emulator)

**Ghost**:
One **Run** in a **Race**, drawn with its own sprite and the number of its **Run**. The number is the Run id at the start of the file name of its **Run record**. The sprite comes from this Run id alone, so a **Run** has the same face in every **Race**.
_Avoid_: player, avatar

**State track**:
The team and the battle of a **Run** at each change, in its **Run record**: the species, nickname, level, max HP and moves of the team; the HP and status of the team; and the two Pokémon of a battle, with the name of the trainer. A replay gives the same list.
_Avoid_: state stream, party log

**Leaderboard**:
The list of the **Runs** of a **Race** by rank at the cursor: most **Milestones**, then the first to reach them, then the highest sum of levels, then the lowest Run id. It is the first tab of the panel at the right of the Race tab.
_Avoid_: ranking table, scoreboard

**Timeline**:
The band at the bottom of the Lab tab of the **Viewer**: the **Game events** of the shown **Run** as icons, from frame 0 to the end, with a time that is linear. It shows the **Game events** only, not the **Model calls** or the cost. A click on it moves the cursor, or jumps a replay to that frame; a drag selects a range.
_Avoid_: slider, scrubber, Stats charts (the panel Stats has its own charts)

## Relationships

- The **Harness** runs a **Lab build** or a **Vanilla build**, and starts it from a **Starting save**.
- A **Bot** plays one **Run**. **Agents** write scripted **Bots**.
- A **Bot** gets control only at a **Decision point** or after an **Interruption**, and sees the game through the **Knowledge level** of its **Run**.
- A **Bot** uses **Macro-actions**, and **Raw inputs** only when no **Macro-action** fits.
- Each **Run** has one **Run record**. A **Run** ends when its **Bot** stops, a person stops it, or it reaches its goal. The **Run** of a scripted bot also ends when its frame budget is used. A **Run** also ends with `no progress` when the **Harness** has a limit for it. The **Run** of a model bot also ends at its cost limit or its **Token limit**, at a `plan limit`, at a whiteout (an option, on by default) and at an unknown screen.
- A **Continued Run** has one parent **Run record**, and its own **Run record** names the parent.
- The lab has one model bot. The scripted bot is a tool to test the **Harness**: it does not grow with the story.
- The **Viewer** shows several **Runs** in its **Grid**, and one **Run** in detail: the shown **Run**. The **Harness** owns all **Runs**.
- A **Race** holds many **Run records**. Each of its **Ghosts** is one **Run**. A **Run** that another **Run** of the **Race** continues has no **Ghost**: the **Continued Run** already holds its play. The **Viewer** plays a **Race** in the browser: no **Run** plays in the **Harness** for it.
- A **Savestate** is valid only for the build that made it. A **Starting save** is valid for all builds.

## Flagged ambiguities

- "Save" was used for both the battery save and the emulator snapshot. Resolved: **Starting save** is the battery save; **Savestate** is the snapshot.
