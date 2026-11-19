# Pokémon FireRed lab

This fork of the FireRed decompilation is a lab. In it, programs play the game, and we record the play for videos.

## Language

**Vanilla build**:
The ROM built with neither the lab flag nor the Arena flag. Its gameplay and behaviour are the same as the original game.
_Avoid_: normal ROM, release build, Arena build

**Lab build**:
The ROM built with the lab flag. It has the same gameplay as the vanilla build. It adds aids for tests and observation, for example: skip the intro, load the save automatically, set the RNG seed. With the Arena flag too, it is an **Arena build**, not a **Lab build**.
_Avoid_: debug build, mod, hack

**Arena build**:
The ROM built with the Arena flag (`make arena`, or `make lab ARENA=1` for the tests of the **Harness**). It adds the line BATTLE SCREEN to the Options menu. With the value ARENA, a single battle shows the **Arena**, with **Auto mode** and a speed. In these battles, the RNG of the game does not move at each frame, so the speed does not change the battle. The battle engine does not change.
_Avoid_: mod, hack, Lab build

**Arena**:
The battle screen of an **Arena build**: the two Pokémon face each other in a stadium with a crowd, with the info boxes, both teams, the move cards (each with a damage estimate), the buttons BAG, AUTO and RUN, and the juice (hit-stop, shake, sparks, damage numbers, sounds). Double, link, Safari, ghost, tower and e-Reader battles, the first rival battle and the tutorial battles (old man, Pokédude) keep the classic screen. After the Pokédex page of a caught Pokémon, the battle ends on the classic screen.
_Avoid_: battle view, mod

**End screen**:
The screen after a battle in the **Arena**: one card for each Pokémon of the party, with its EXP bar, its level-up and stat gains, its numbers in the battle (knock-outs, damage dealt and taken, moves, misses), and the prize money. While the cards move, A or B shows all of them at once; the next press closes the screen. In **Auto mode**, it closes by itself.
_Avoid_: results screen, summary screen (the Summary screen is the screen of one Pokémon)

**Auto mode**:
In a battle of an **Arena build**, the game chooses the moves, the switches and the send-outs of the player with an **Auto strategy**. With the run rule, it runs from a wild battle against a species already caught. It stops and gives the control to the player for low HP, a wild species never seen or a Gym Leader, as the player sets in the Auto menu. Such a stop is for this battle only: Auto mode starts again at the next battle, until the player stops it. For a move to learn, it can let the player answer the question, then it plays on.
_Avoid_: autopilot, bot (a **Bot** plays through the **Harness**)

**Auto strategy**:
The rule that **Auto mode** uses to choose: MAX POWER, SAVE PP, TACTICS, TYPE EDGE or RANDOM. All of them use an estimate of the damage with the formula of the engine, except RANDOM, which uses only the type multiplier to skip the moves with no effect.
_Avoid_: AI, Bot

**Harness**:
The program that runs the emulator and gives a **Bot** one interface to the game: the game state and the **Macro-actions**. It does not decide what to do. The exceptions are FLASH on a **Dark map** (see **Field move**), the speed of a walk (see **Running** and **Ride choice**) and B during the animation of an evolution, which the **Harness** removes so that B stops no evolution.
_Avoid_: emulator, AI

**Bot**:
The thing that decides what to do in a **Run**, through the **Harness** only. A scripted bot is code. A model bot is code that asks an AI model what to do when the game waits for a walk, a choice, a battle action, a Pokémon to send out, the shop menu of a Poké Mart, the item PC, the **Pokémon PC**, a name or a move to forget, and then calls the **Harness**. The code of a model bot reads the texts and waits while the game is busy, with no request to the AI model, and it continues a walk that a wild battle stopped when the party is healthy, or that a trigger stopped when the game showed no text. The AI model sees text only, and it does not call the **Harness** itself.
_Avoid_: player, agent, AI

**Genetic bot**:
A **Bot** that plays with a **Genome**: at each **Decision point**, its code gives a score to each action that it can play, with the weights of the **Genome**, and plays the action with the best score. It asks no AI model. It is one **Bot**: the **Genomes** change from **Run** to **Run**, its code does not.
_Avoid_: GA bot, evolved bot, case B

**Genome**:
The weights of a **Genetic bot**: how much it likes each property of an action, for example "an exit that the player did not take". The same **Genome** plays on any seed. It is not a list of actions to play in order.
_Avoid_: chromosome, plan, individual

**Fitness**:
The number that tells how far a **Run** of a **Genetic bot** went in the game: its **Milestones**, what it discovered and the levels of its party. It has a version, as a **Bot** has.
_Avoid_: score, reward

**Population**:
The **Genomes** of one **Generation**. Each one plays one **Run** and gets its **Fitness**.
_Avoid_: swarm, batch

**Generation**:
One step of an **Evolution**: its **Population** plays, then the best **Genomes** make the **Population** of the next **Generation**.
_Avoid_: epoch, iteration

**Evolution**:
The whole search of a **Genetic bot** for better **Genomes**: its **Generations** in order, with one version of the **Fitness**. All its **Runs** play on the **training seed**, and it tests the best **Genome** of some **Generations** on the **test seeds**. It can stop and continue later.
_Avoid_: training, learning

**Training seed**:
The seed of the game on which all the **Runs** of an **Evolution** play: the seed of the **Lab build** (`gLabRngSeed`).

**Test seed**:
A seed of the game, other than the **training seed**, that an **Evolution** does not use to rank the **Genomes**. Every 10 **Generations**, the best **Genome** plays one **Run** on each test seed, to show if it plays well on any seed.

**Neural bot**:
A **Bot** that a neural network controls. The lab does not have it yet.
_Avoid_: case C, RL bot

**Agent**:
An AI coding assistant that writes or changes the code of a **Bot**. It does not play.
_Avoid_: bot

**Macro-action**:
One game action that a **Bot** asks the **Harness** to do, for example go to a cell, talk to a person or use a move. It runs until it is complete or until the game interrupts it, and it never makes a game decision. Its result is `done`, `impossible` (it cannot start or continue), `blocked` (a person or an object stays in the way) or `interrupted`, with an **Interruption** as the reason.
_Avoid_: command, move (a move is a Pokémon attack)

**Interruption**:
An event of the game that stops a **Macro-action**: a coord trigger, a trainer who sees the player, another script, a battle, or an arrival on a map that is not on the route. The **Macro-action** returns at the first frame of the interruption. That frame is not always a **Decision point**, but the game is also frozen there. A text, a choice, an interaction after its A press, or a **Raw input** stops only for a battle, because a script runs during them.
_Avoid_: event (a map event is a warp, a person, a sign or a trigger), stop

**Double battle**:
A trainer battle with 2 Pokémon on each side. The game asks for one action for each Pokémon of the player, one after the other, and it plays the turn after the last choice, so each choice is one **Decision point**. Each fight in the prompt tells what it hits. The model chooses the foe of a move in its `fight` action, and the **Harness** answers the target screen of the game: the model never sees this screen. A move cannot aim at the other Pokémon of the player. The game has no wild **Double battle**.
_Avoid_: 2v2, multi battle (the game gives this name to a battle with a partner, which is another thing)

**Decision point**:
A frame where the game waits for an input that a **Bot** must choose, for example walk, a text box, a choice, a battle action or a name. The naming screen is one **Decision point**: the **Bot** gives the whole text, and the **Harness** types it and selects OK. The learn-move question ("Delete a move to make room for …?") is one **Decision point**, after a level up in a battle, a RARE CANDY, an evolution, or a TM or an HM: the **Bot** gives the move to forget, or keeps the 4 moves, and the **Harness** does the yes/no boxes and the summary screen. The game is frozen until the **Bot** gives the next action. Frames where the game waits for nothing (animations, fades, walking) are not decision points.
_Avoid_: turn (in a battle, a turn is one round), pause, step

**Mission**:
A short sentence that a model bot sets itself: the story step that it works on, for example "talk to Professor Oak and get my first Pokémon". The AI model keeps it until the game shows that it reached it, over many **Objectives**. A battle does not change it. The **Battle prompt** shows it, and its answer has no Mission. So the Mission of the last walk stays in force. It is not the goal of the **Run**: that goal is a **Milestone**.
_Avoid_: goal (the **Milestone** that ends a **Run**), quest, long-term objective

**Objective**:
A short sentence that a model bot sets itself: what it does now for its **Mission**, for example "look for Professor Oak outside the lab". The AI model changes it as often as it needs. A battle does not change it. The **Battle prompt** shows it, and its answer has no Objective. So the Objective of the last walk stays in force.
_Avoid_: goal (the **Milestone** that ends a **Run**), quest

**Model call**:
One request of a model bot to its AI model, or to its **Coach** for the turns that the **Coach** plays, and its answer: one action, with a short reason. The code of the Bot plays this action with one or more **Macro-actions**, or with one **Raw input**. The actions `viewAtlas` and `zoom` play neither: the Bot makes a new model call at once, at the same **Decision point**. A model bot makes a model call only when the game waits for a walk, a choice, a battle action, a Pokémon to send out, the shop menu of a Poké Mart, the item PC, the **Pokémon PC**, a name or a move to forget. Thus a **Run** usually has fewer model calls than **Decision points**.
_Avoid_: prompt, turn, step

**Battle prompt**:
The prompt of a model bot at each **Decision point** in a battle. These are a battle action, the move menu, the party menu of a battle and a choice in a battle. Since bot version 48, it has its own system prompt. This prompt has only the rules of a battle, and no rule of the **Atlas** or of the **Memory tree**. Its user prompt has the Milestones, the count of whiteouts (see **Whiteout limit**), the character, the money and the party. Its Bag has the pockets that work in a battle, and the items of the other pockets that work in a battle. It shows the **Mission** and the **Objective** to read, and the Battles part of the **Coach advice**. It ends with the important events, the decisions from the one that started the battle, and the actions with no `zoom`. It has no **Memory tree**, no **Known world**, no tries and no **Stuck counter**. Its answer has a reason, an action, a note and a `say`. It has no **Mission** and no **Objective**. Each other **Decision point** gets the walk prompt, and so do the **Coach** turns.
Since bot version 52, the line of the Pokémon of the player gives its speed now. The rules are the rules of the game for the order of a turn: the stat stage, the badge boost and the paralysis. At the `full` **Knowledge level**, it also tells who moves first when both moves have priority 0.
On a map whose name starts with `PokemonLeague_`, this prompt and the walk prompt have the League line: a whiteout makes the player battle the Elite Four again, from the first member.
_Avoid_: fight prompt, combat prompt

**Item estimate**:
Since bot version 48, the lines under the `use` line of a **Battle prompt**. There is one line for each item of the Bag that works now on the Pokémon in the battle. It gives the HP from → to (up to the max HP) and the status that it cures. When the Pokémon has poison or bad poison, and the item does not cure it, the line says that the poison stays. It also gives the poison damage of the next turns. A REVIVE gives the HP of each fainted Pokémon. An X item gives its stat and "+1 stage". The data comes from the effect data of the items in the game. It is to the items what the damage estimate is to the moves.
_Avoid_: item preview, heal estimate

**Unusual call**:
A **Model call** that the **Viewer** marks with one or more flags: an answer that the Bot cannot read, an `impossible` or `blocked` action, a **Reflection turn** or a **Review turn**, a cost, a latency or prompt tokens above 3 times the median of its **Run**, a conversation with more turns (`zoom`, `viewAtlas`), a change of the **Mission**, or the same action 3 times in a row with no progress. The **Viewer** calculates the flags from the **Run record**: they are not in it.
_Avoid_: bad call, error (an error is only one of the flags)

**Battle moment**:
A **Decision point** in a battle of a **Run record** that the battle lab asks a model again. It has the **Run record** and the frame, a kind (for example `toxic`, `levitate`, `two-turn` or `clear`), its good answers and its bad answers. It also has a snapshot of what the prompt of the model bot reads there. The snapshot has what `observe()` returns, what the game waits for, the count of **Decision points** with no progress, and the events before it. A replay of the **Run record** makes the snapshot one time. Then the lab builds the prompt with the current code of the **Bot**. So it measures a change of the prompt with no game and no **Run**. Each answer is good, bad or other, from the first words of its action.
_Avoid_: test case, sample, scenario (a scenario plays a whole battle)

**Memory tree**:
The memory that a model bot writes itself. Each note is one short line that the AI model adds when it learns something. The program removes the sentences with an HP or PP number, the sentences that say that a place is explored, crossed, exhausted or a dead end (except one that starts with “Guess:” or “A person said:”), the sentences with nearly the same words as one that a **Review turn** removed, and a note with nearly the same words as a recent note, and it marks a hedged sentence as a guess. The prompts and `zoom` also hide such claims about a place in the older nodes of a **Continued Run**; the **Run record** and the Viewer keep them. Nobody rewrites a note later. Two neighbour nodes of the same size get a parent node: a short summary of the two, with the newest facts first. A node of more notes has more characters. At a walk, the AI model sees only the top nodes. It can open a node to see its two halves, down to the notes. A **Battle prompt** has no Memory tree. A **Review turn** can remove sentences from the top nodes: they then stay out of the top nodes and of the next summaries, but `zoom` can still show them in the lower nodes. It keeps the conclusions of the AI model; what the game showed is in the **Atlas** and in the history of the **Model calls**.
_Avoid_: notes (the old text that the AI model wrote again at each call), memory (too wide)

**Stuck counter**:
The number of **Decision points** of a **Run** since its last progress. Progress is a new map, a new **Milestone**, a new exit in the **Atlas**, a level up of a Pokémon of the party, a text of a person that the player did not hear before, a trainer that the player beats, an item that the player finds (an item ball or a hidden item), or a new species caught (the Pokédex marks it owned). A new cell is progress only on a map that is dark for the model (see **Dark map**).
_Avoid_: no-progress count, walk count (the two old counts that it replaces)

**Character turn**:
The first **Model call** of a **Run** of a model bot with no Pokémon. It starts from an idea that the program selects at random, for example a shy baker who collects old maps, from Japan. The AI model invents the trainer that it plays, with its name, the name of the rival, the first Pokémon and a style of the nicknames; the request asks that this style mixes the job, the hobby and the language of the **Trainer origin**. Since bot version 43, it also writes a voice: how the trainer talks in English, clear but natural, with no catchphrase. Each later answer can give one line in this voice, `say`, which only the people who watch the **Run** read; the `reason` stays plain. The **Run** then boots again from a copy of the **Starting save** with these names, at the same frame. A continued **Run** with an action in its parent keeps the names of its game, and the AI model gets them. The prompt of each later **Model call** shows this character. At a Poké Ball of Professor Oak, the program answers for the AI model: YES to this Pokémon, NO to another. It is not a separate request.
_Avoid_: persona call, personality turn

**Trainer origin**:
The country and its language that a **Character turn** picks at random from 31, for example Kenya and Swahili. The nicknames sound like this language, and also the names of the trainer and of the rival when the game has no names yet. They use only the letters that the game allows. The other answers of the AI model stay in English.
_Avoid_: nationality, language mode

**Normal trainer**:
The character that the Viewer shows for a **Run** with no **Character turn**, for example a **Run** of an older version of the model bot. All these **Runs** have the same text. A **Race** also gives it to a **Run** with no readable character, so each **Ghost** has a text. The AI model never reads it, and no **Run record** holds it.
_Avoid_: default persona, neutral character

**Thinking**:
The reasoning level of the **Character turns**, **Reflection turns** and **Review turns** of a **Run** of a model bot. The other **Model calls** use the reasoning level of the **Run**, and also the next calls of such a turn after an empty answer. In a **Run** with a **Coach**, the **Coach** plays these turns, its summaries and its moves to forget at this level, and the player never uses it.
_Avoid_: thinking mode, deep reasoning

**Reflection turn**:
A **Model call** of a model bot at each 20 more **Decision points** on the **Stuck counter**, at the first walk with a **Model call**. Its prompt adds the full **Atlas** and asks the AI model to write a lesson in its **Memory tree** and to set a new **Objective**. It is not a separate request.
_Avoid_: stuck message, reflection call

**Review turn**:
A **Model call** of a model bot at the first walk with a **Model call** after 20 decisions since its last **Review turn** or **Reflection turn**, also with progress. A decision is a **Model call** after which the program played an action. Its prompt adds the full **Atlas** and a short check: the way to the next **Milestone**, the facts against the **Mission**, the guesses from the things checked and the people, and the exits left to explore. The AI model writes the result in its **Mission**, its **Objective** and a note, and it can give the numbers of at most 5 sentences of the top nodes of its **Memory tree** to remove them. It is not a separate request. When a **Reflection turn** and a **Review turn** are both due at the same decision, only the **Reflection turn** shows.
A **Check map** also gives a **Review turn**: the first walk with a **Model call** after each entry into it, also after a Pokémon Center.
On a **Check map**, the check also asks if the team is ready for the Gym Leader or the Pokémon League. If not, it asks what to buy or to train first.
_Avoid_: review call, check turn

**Check map**:
A map before a hard series of battles: each map whose name ends with `_Gym`, and IndigoPlateau_PokemonCenter_1F. At IndigoPlateau_PokemonCenter_1F, the **Review turn** also tells that several battles follow with no Pokémon Center between them. No prompt gives a level of a Gym Leader, of the Elite Four or of the Champion.
On a **Check map**, the **Team line** also gives the levels of the trainers beaten in this Gym, or on Victory Road. It skips each trainer whose name starts with "LEADER ", "ELITE FOUR " or "CHAMPION ".
_Avoid_: gym map, league map

**Team line**:
A line of each walk prompt of a model bot, after the money. It gives the levels of the party. It also counts the items of the Bag that restore HP, and the items that cure a status. On a **Check map**, it also gives the lowest and the highest level of the Pokémon of the trainers that the player beat there.
_Avoid_: team check (a **Review turn** on a **Check map** does the check), team summary

**Summary call**:
One request of a model bot to its AI model, or to its **Coach** when the **Run** has one, that writes the summary of two nodes of its **Memory tree**. It gives no action, and it runs at the same **Decision point** as the **Model call** that added the note. Its cost and its tokens count in the cost and the tokens of the **Run**.
_Avoid_: Model call (a **Model call** gives an action)

**Model provider**:
The service that answers the **Model calls** and the **Summary calls** of a **Run**: `openrouter` (the default), `claude-code`, `codex` or `grok`. A **Run** has one Model provider and one AI model, and also a **Coach** on the same Model provider when it has one. On `claude-code`, a **Run** always holds the full id of its AI model, for example `claude-sonnet-5-5`, because the model of an alias such as `sonnet` changes at a new release of the claude command.
_Avoid_: backend, mode, API

**Coach**:
A second AI model of a **Run** of a model bot, on the **Model provider** of the **Run**. It plays the **Character turn**, the **Reflection turns**, the **Review turns**, the **Summary calls** and the choice of a move to forget; the AI model of the **Run** plays the other **Model calls**. Its calls count toward the one limit of the **Run**. A **Coach** with the AI model of the **Run** is no **Coach**. A **Run** with a **Coach** is another player than its AI model alone, so its label names both, for example `claude-haiku-5-5 + coach claude-opus-5-5`. In such a **Run**, "the AI model" of the **Character turn**, the **Reflection turn** and the **Review turn** is the **Coach**.
_Avoid_: mentor, teacher, big model, thinker

**Coach advice**:
What the **Coach** writes at its **Character turn**, **Reflection turns** and **Review turns** for the next decisions. It has 4 parts: the team (Pokémon to catch, to train, to switch with the PC, and the Pokémon that gets a RARE CANDY, an evolution stone or a **Held item**), the shopping, the way to the next **Milestone**, and the battles. Each prompt of a **Run** with a **Coach** shows the last text of each part, with its turn and the number of decisions since, and under them what happened in the game since then; an empty part keeps the last text of this part. A **Battle prompt** shows only the Battles part, with no facts since. Since bot version 42, it also has two fields that the program checks: `catchNew` (the **Coach** wants a new species now) and `train` (at most 3 Pokémon of the party, each with a level to reach). Each turn of the **Coach** writes them again. At the battle menu, the program tells the player that the **Coach** wants this foe caught when the battle is wild, the species is not in the party or the PC, and the Bag has a Poké Ball. It tells that the **Coach** wants a Pokémon trained while this Pokémon is under its level, can fight, and did not fight the foe of the moment. Before bot version 34, it was one text, which the first advice in parts of a later Run ends. It is not the **Mission**, not the **Objective** and not a note of the **Memory tree**.
Since bot version 49, the program adds no line of the **Coach** at the battle menu against a GHOST that the game does not identify: no catch line and no train line.
_Avoid_: tip, hint, coach note

**Plan provider**:
A **Model provider** that a person's subscription pays for: `claude-code`, `codex` or `grok`. The calls of a **Run** on a Plan provider use the quota of the subscription and cost no money, so the cost of this **Run** is 0 and a **Token limit** replaces its cost limit.
_Avoid_: free provider, subscription mode

**Token limit**:
The number of tokens that a **Run** on a **Plan provider** can use: all the input tokens with the cached tokens, and the output tokens, of its own **Model calls** and **Summary calls**. The default is 1,000,000.
_Avoid_: quota (the quota is the limit of the subscription, for all its uses)

**Whiteout limit**:
The number of whiteouts at which a **Run** of a model bot ends: 3 by default, or no limit. A person sets it at the start of the **Run**, and an **Extended Run** keeps it. The count has the whiteouts of all the parts of the **Run**, but not those of the parent of a **Continued Run**. With a limit of 2 or more, the prompts of the walk and of the battle count the whiteouts after the first one. Before bot version 51, the option "stop at a whiteout" was a Whiteout limit of 1, and no stop was no limit.
_Avoid_: lives

**Time limit**:
The game time, in hours, at which a **Run** of a model bot ends: a multiple of 0.5, or no limit (the default). The game time counts from frame 0 of the **Run record**, also through the replay of a parent, at 59.7275 frames each second. A battle at the limit plays to its end, and the **Run** ends at the next walk, or at the start of another battle. So the **Milestone** of this battle counts, also when a script gives it after the battle. A person sets it at the start of the **Run**, and an **Extended Run** keeps it. The walk prompt shows the game time and the limit; the **Battle prompt** does not.
_Avoid_: frame budget (the frame limit of the **Genetic bot** and the scripted bots), timeout (the wait for the answer of a **Model call**)

**Knowledge level**:
The set of game facts that the **Harness** shows to a **Bot** in a **Run**. The `player` level shows what a careful human player can know; the `full` level shows more: all the maps of the game and exact enemy stats.
_Avoid_: mode (used for overworld or battle), cheat mode

**Atlas**:
What a **Run** knows of the world. It knows the maps that the player visited, and the cells of these maps that the player saw on the screen.
It knows each exit that the player took, in one direction or in the other, with its destination and its arrival cell. A flight with FLY is not an exit.
The exit of an **Elevator** has one destination for each floor that the player reached by it or came from. At the `full` level, it has one destination for each map with a warp to the **Elevator** that the player can take.
It knows the exits that the player saw but did not take. The neighbour cells of a wide exit that lead to the same map are one exit.
For each exit of an outdoor map and for an entrance from inside, it knows the kind of place that a player sees: a Pokémon Center, a house, a cave entrance. It knows the name of the destination map only after the player took the exit.
It knows the text of each **Thing to check** that the player read. It knows each **Slide** that the player took with a `goTo`, from its **Spin tile** to the cell where the player stopped.
It has a number for each **Part** of a map where the player saw a **Spin tile**. The numbers stay the same while the player sees more cells.
It knows each person that the player saw, at the cell where the player last saw it on the screen. It knows all the different texts that each person said when the player talked to them, or right after a battle with them. A person keeps its texts when it moves. The **Atlas** also knows the person of the last talk.
It knows each **Fixed obstacle** that the player saw. On the map of the player, the obstacle is at its cell now; on the other maps, at its first cell.
An edge with water has its reason in the **Atlas** while the party cannot use SURF.
It also knows if each map is outdoor: the map type of the ROM is a town, a city or a route. It also knows if each map is dark for the model (see **Dark map**).
On the map of the player, the cells are the cells of the game now, also the cells that a map script changed. On another map, they are the cells of that map at the last step of the player on it, after its map scripts. The reason: the ROM has the Card Key doors of Silph Co. open, and the map scripts close them. The cells of the ROM stay only for a map with no step of the player on it. The route of a `goTo` uses the same cells. Some map scripts read a flag or a var that the scripts of another map change. A fixed table names them: the switch flag of the 4 floors of Pokémon Mansion, and the vars of the floor switches of Victory Road. The script of Route 23 resets these vars at each entry. For these maps, the Atlas keeps the cells of the last step for each set of values. Such a map has the cells of the last step with the values now. With no such step, it has the cells of the ROM.
The exits of another map stay the exits of the ROM, because the game sets the destination of an **Elevator** exit again at each entry. The reason of an edge with water also comes from the cells of the ROM.
At the `player` **Knowledge level**, the **Atlas** grows only with what the player saw in the **Run**. At the `full` level, it has all the maps of the game, but it lists only the **Fixed obstacles** that the player saw.
The **Atlas** keeps a **Fixed obstacle** that it saw while the obstacle closes a way. An obstacle that the party can remove does not close a way. So a removed one returns to the **Atlas** when the player leaves the map, but only if the party cannot remove it now.
On a map in the dark, the player sees only the 3 x 3 cells around the player.
On a map where two **Elevations** of land touch, the **Atlas** keeps the **Elevation** of each seen cell.
_Avoid_: map (one map of the game), Town Map (an item of the game)

**Part**:
The cells of a map that the player can walk to from one cell, on the cells that it saw. The way crosses no other map, no **Spin tile** and no step that the **Elevation** rule refuses. A floor of a cave can have many **Parts**: the only way between them goes through other maps. A map with **Spin tiles** also has many **Parts**: a **Slide** goes from one **Part** to another **Part** of the same map, in one direction only. The code makes them from the **Atlas** only, so they show only what the player saw.
_Avoid_: zone, area (an **Area** is a place of the Town Map), region

**What is left**:
The list that the program gives at a walk on a floor of a cave, a forest or a large building: what the player did not explore in its **Part**, in the other **Parts** of the map and on the floors that the exits reach. It comes from the **Atlas**, so it is right when a note of the **Memory tree** disagrees.
_Avoid_: todo list, frontier list

**Lead**:
A target of a walk prompt of a model bot: unseen cells, an exit not taken, or a **Spin tile** whose **Slide** has an unknown end, in another **Part** or another map, by the number of exits and **Slides** to it. A walk through exits stops at an outdoor map, except the map of the player. It is not the **Known world**, which tells the outdoor maps.
_Avoid_: frontier (the unseen cells of the **Part** of the player), hint

**Thin wall**:
An open cell with a wall on one side: the player cannot step across that side, in either direction. Its metatile behaviour is `MB_IMPASSABLE_*`, with no collision bit. It is not a **Fixed obstacle**.
_Avoid_: one-way wall, directional collision

**Elevation**:
A number of each cell of a map, from 0 to 15, in the map data of the game. On land, the player cannot step between two cells at two different **Elevations** (`IsElevationMismatchAt`). A cell at **Elevation** 0, for example stairs, joins all the **Elevations**. SURF starts and stops only on land at **Elevation** 3, the shore. Water at **Elevation** 3 is land for the game: the player walks on it with no SURF. On 13 maps of FireRed, for example the Safari Zone and Seafoam Islands, two **Elevations** of land touch with no wall between them. On 5 of them, the land at one **Elevation** has no stairs to the other. The walk prompt calls the cells at one **Elevation** a "level".
_Avoid_: level (a level is the level of a Pokémon), height, layer, floor (a map of a building or a cave)

**Spin tile**:
A cell with an arrow on the floor. When the player steps on it, the player slides in the direction of the arrow, and cannot stop, until a **Stop tile** or a cell that the player cannot enter. A **Spin tile** on the way changes the direction. Its metatile behaviour is `MB_SPIN_*`. The Rocket Hideout and the Viridian City Gym have them.
_Avoid_: arrow tile, spinner, ledge (a ledge is a jump of one cell)

**Stop tile**:
A cell that ends the **Slide** of a **Spin tile**. Its metatile behaviour is `MB_STOP_SPINNING`.

**Slide**:
The forced walk of the player from a **Spin tile** to the cell where it stops. It goes from one **Part** to another **Part** of the same map, in one direction only. Before the player takes it, the code can tell its end from the cells that the player saw, or it cannot when the way crosses an unseen cell. After the player takes it with a `goTo`, the **Atlas** keeps its real end.
_Avoid_: spin, glide, push

**Same-map pad**:
A teleport pad that leads to another cell of its own map: a warp of the kind "step" whose destination is its map. SilphCo_3F, SilphCo_8F and SaffronCity_Gym (30 pads) have them. A route to another cell takes them on its way. A `goTo` to a **Same-map pad** takes it: the route ends with a step onto the pad, also when the player stands on it. The walk ends at the arrival cell of the pad, and the result names this cell.
_Avoid_: teleporter, plain warp (a warp to another map)

**Running**:
The walk of a player with the Running Shoes: 8 frames for each cell, not 16. A **Bot** does not choose it: the **Harness** holds B on each step. The game does not run on a map that does not allow it, for example a house or a gym.
_Avoid_: dash, sprint

**Ride choice**:
The choice of a **Bot** to ride the BICYCLE or to walk. It stays until the **Bot** changes it. The **Harness** puts the player in the state of this choice before each walk, where the game allows it. Riding takes 6 frames for each cell. The game puts a rider on foot on a map that does not allow the BICYCLE, and the next walk on a map that allows it rides again.
_Avoid_: bike mode

**Cycling Road**:
The Routes 16, 17 and 18 between their two gates. A gate stops a person with no BICYCLE, and the game puts each other person on the BICYCLE. The player must ride until a gate. The story does not need it.
_Avoid_: Route 17 (only one part of it), bike path

**Slope**:
A cell of the **Cycling Road** that pulls a rider to the south, 4 frames for each cell, unless the rider holds B. A rider who holds B stays on the cell and faces south.
_Avoid_: pull-down tile, hill

**Known world**:
A part of each walk prompt of a model bot: one line for each outdoor map of the **Atlas**, in the order of the first visit. Each line has the edges seen and their destinations, the passages through a gate, a forest or a cave to another outdoor map, the buildings entered, the exits not taken with their cells, the number of groups of open cells next to unseen cells and the **Fixed obstacles** whose HM is in the Bag or whose move a Pokémon knows and that the party cannot remove yet. The code makes it from the **Atlas** only, so it shows only what the player saw.
_Avoid_: world map, overview, Town Map (an item of the game)

**Dark map**:
A map where the player sees only a small area around the player until a Pokémon uses FLASH. The two floors of Rock Tunnel are the only **Dark maps** of the game. FLASH lights the two floors until the player goes outside or all the party faints. A lit map stays a **Dark map**, and it is dark again when the player enters it from outside. At the `player` **Knowledge level**, a **Dark map** is dark for the model when it is not lit and the party cannot use FLASH.
_Avoid_: cave (Mt. Moon is a cave but it is not dark, and the game code gives the name `cave` to this property of a map)

**Field move**:
A move that a Pokémon uses outside a battle, for example FLASH, CUT or FLY. CUT and ROCK SMASH remove a **Fixed obstacle**, STRENGTH pushes one, and SURF crosses water. A walk prompt shows the obstacle or the water only when the Bag has the HM of the move or a Pokémon knows the move. Below, the party can use a move when a Pokémon of the party knows it and the player has its badge. For CUT, ROCK SMASH and SURF, the model does not use the move. When the party can use it, the obstacle or the water is an open cell, and a walk through it uses the move. A walk starts SURF on the shore: the land next to the water where the game lets SURF start and end. The step of the walk to the land ends SURF. For FLASH, the model also does not use the move. When the party can use it, a **Dark map** is a lit map for the model. For STRENGTH, the model chooses each push of a boulder. When the party can use it, the **Harness** starts STRENGTH with no question to the model. A route never pushes a boulder, because a push can close a way. For FLY, the model does not use the move. When the party can use it, a walk flies to a **Fly destination** when the flight takes fewer frames than the walk.
_Avoid_: HM move (DIG and TELEPORT are **Field moves**, but they are not HM moves)

**Fly destination**:
A town or a Pokémon Center that FLY can reach: the player entered it, and it is in the region of the player.
_Avoid_: fly spot, heal location

**Object**:
A graphic of a map that is not a person and that the player can interact with, for example a fossil, an item ball or a clipboard. A cut tree, a rock and a boulder are **Fixed obstacles**, not objects.
_Avoid_: item

**Thing to check**:
A sign event of a map: a sign, a poster, a trash can, a statue, a door or an elevator panel. The player reads it with an interaction.
_Avoid_: sign, for all of them

**Elevator**:
A map whose exit leads to the floor that the player chose at its panel. The **Atlas** knows one destination of this exit for each floor that the player reached by it or came from; at the `full` level, for each map with a warp to the **Elevator** that the player can take. The player chooses the floor; a walk takes the exit only to the floor chosen now.
_Avoid_: lift

**In your way**:
What the prompt says of a person or an **Object** whose movement type does not leave its cell and whose cell closes a way, on the cells that the player saw.
After the player talked to the person, the reason of `blocked` tells that the person does not leave after a talk. It tells the player to explore other places, and to return later. It names no event of the story.
_Avoid_: blocker

**Map part**:
A tint of the Whole map of the Viewer: the cells of the full map that a walk connects, with a ledge that links both sides, and the people who stay and all the **Fixed obstacles** as walls. It does not read what the player saw, so it is not a **Part**.
_Avoid_: part, zone, region

**Fixed obstacle**:
An object of the game that never moves by itself and that only a field move removes or pushes: the cut tree (CUT), the rock of ROCK SMASH and the boulder of STRENGTH. A push moves a boulder one cell, and a map load returns it to its first cell. A boulder on a switch opens a way, and a boulder pushed into a hole falls to the floor below. It is not a person and not a target. For a route, its cell is blocked, and the **Harness** never waits for it. A walk prompt shows it as a blocked cell with no text until the Bag has its HM or a Pokémon knows its move; the **Atlas** keeps it while it closes a way. The exception: a cut tree or a rock that the party can remove is an open cell for the model, a walk removes it, and it returns when the player leaves the map.
_Avoid_: person, tree (a tree of the map is a blocked metatile)

**Switch**:
A floor cell of a boulder puzzle. A boulder on it opens a way, for example a rock barrier of Victory Road. A step of the player on it does nothing.
_Avoid_: button, the battle action `switch`

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
One emulator instance that plays the game from a **Starting save**. The **Harness** plays 10 emulators at most at the same time: the own **Run** of the **Viewer**, and 9 **Runs** of **Bots** or replays, enough for a **Grid** of 9. This is a choice: the machine can play about 12 at full speed. The worker of an ended **Run** stays idle for an **Extended Run**, out of the limit of 10: 4 at most. An **Evolution** plays its own **Runs** out of this limit, 12 at the same time by default. A **Run** plays on one seed of the game: the seed of the **Lab build** unless a person gives another one, and its **Run record** keeps it.
_Avoid_: game, instance, session

**Run id**:
The number of a **Run**, on 5 digits at the start of the file name of its **Run record** (`00073`). It never changes, also for an **Extended Run**. The place of a **Run** in a **Grid** (1 to 9) is not its Run id.
_Avoid_: Run number, index, slot

**Starter**:
The first Pokémon of a **Run**, the one that the player chooses in the lab of Professor Oak: one of BULBASAUR, CHARMANDER or SQUIRTLE, or a later form of its line. The **Viewer** shows its nickname, the name that the **Bot** gave it, and its species only next to that name.
_Avoid_: first Pokémon, lead (a **Lead** is a target of a walk)

**Milestone**:
A story step that the **Harness** reads from the game flags. Examples are "has a Pokémon", "the first rival battle is over", "has the Pokédex" or a badge. It is one kind of progress of a **Run** (see **Stuck counter**). The **Milestones** have an order, the order of the story. After `badge-8` come `victory-road`, `indigo-plateau`, `elite-four-1` to `elite-four-4` and `champion` (the Hall of Fame). The **Milestones** of a **Run** are the **Milestones** of its flags and of its **Run record**. A whiteout clears the flags of the Elite Four, but their **Milestones** stay. The event of a **Milestone** comes only once. A scripted bot has a goal: one **Milestone** that ends its **Run**. A model bot has no goal: the code gives it the next **Milestone**, the first one in the order that it did not reach, and its **Run** continues after it. With no goal, a **Run** ends at the last **Milestone**, `champion`. A **Run record** of an older version keeps its **Run result**: a `goal` at `badge-8` stays.
_Avoid_: flag (a flag is one bit of the save), achievement

**Chapter**:
The part of a **Run** up to a **Milestone**, with the name of that **Milestone**: "Pokédex" is the time from the **Milestone** before it to the Pokédex. The last chapter is open, up to now: "After Pokédex", or "Start" before the first **Milestone**. The panel Stats of the **Viewer** selects a chapter as a range of frames.
_Avoid_: stage, level (a level is the level of a Pokémon)

**Run record**:
The file that keeps one **Run**: the version of its format, its build, seed, **Starting save**, names, **Bot** and **Knowledge level**, the buttons at each frame, the events, the track, the **State track**, the **Run result** and, for an **Extended Run**, its earlier parts. From the same build, seed, **Starting save** and names, its buttons alone replay the **Run**. The track is the place of the player at each change of cell, of map or of facing, apart from the events. A **Run record** from before format 1 has only the map, battle and **Milestone** events of the **Game events**, a **Run record** from before format 2 has no track, and a **Run record** from before format 3 has no **State track**: a command adds them from its buttons, and, on a **Run record** from before format 1, the **Game events** of the state.
_Avoid_: log, replay (a replay is what you watch from a run record), movie

**Game event**:
A change in the game that the **Harness** reads from the game state and writes in the **Run record**. Some kinds are a new map, a battle start or end, a **Milestone**, a heal, a purchase and an item found or received. Others are a catch, a faint, a level (with a new move or an evolution), a change of money and a trainer beaten. The last kinds are a **Fixed obstacle** removed, a use of FLASH, a start of SURF or of STRENGTH, a flight and a whiteout. Each one has typed fields, not only a text, so stats can count them over many **Runs**. Some fields are the species, the item, the count, and the money before and after. Others are the source of a heal, the side of a faint, the trainer, the foe of a battle and the map. The **Viewer** shows them. The prompts of the model bot use some of them. The line after a battle reads the faints, the catch, the trainer beaten and the whiteout. A **Review turn** counts the catches and the whiteouts. The **Coach advice** tells what happened since.
Since bot version 52, the event of a trainer beaten also has the levels of the Pokémon of the trainer. The **Team line** of a **Check map** reads them.
_Avoid_: log line, fact (a fact is a line of the prompt)

**Continued Run**:
A **Run** that starts at the end of a stopped **Run**, its parent. The **Harness** boots with the names of the parent, loads the **Checkpoint** of the parent **Run record** or replays its buttons, and keeps its events. So the **Bot** has the **Memory tree**, the **Mission** and the **Atlas** of the parent. In a battle, it also has the last turn and the turns against the foe. A replay must give the maps, the battles and the **Milestones** of the parent, or the **Harness** refuses to start. With a replay, the other **Game events** come from the replay, so a better read of the game replaces those of the parent. With a **Checkpoint**, they stay those of the parent. Its **Run record** has the buttons and the events of the parent, then its own. Its cost limit or its **Token limit** counts its own **Model calls** only, and its model and its **Model provider** can be other ones. Its **Whiteout limit** counts its own whiteouts only, and its **Time limit** counts the game time from frame 0 of the parent.
_Avoid_: resumed run, restart, savestate

**Extended Run**:
A **Run** that continues from the end of its own **Run record**, for example after a `plan limit`, when the quota of the subscription is new. It stays the same **Run**: the same id, the same **Ghost**, the same character. The **Harness** loads the **Checkpoint** or replays the buttons, and keeps the events, as for a **Continued Run**. But a new **Run record** replaces the file under the same name, with no new parent. When the worker of the last part is still idle in the **Viewer**, the new part continues in this worker, with its **Harness**: no replay and no **Checkpoint**. A worker keeps the code that it loaded, so a change of a file of `lab/src` or `lab/bots` since its start needs a new worker. The header takes the Bot and the limit of the new part. Its `parts` keep the Bot, the **Run result** and the end of each earlier part. The model, the **Model provider** and the other settings of the model stay those of the **Run record**. The version of the Bot can be newer. Its cost limit or its **Token limit** counts from 0 at each new part. A **Run record** that another one names as its parent cannot extend. This is because the **Viewer** finds the start of a **Continued Run** from the end of its parent.
The limit of a new part is its cost limit or its **Token limit**. Its **Whiteout limit** and its **Time limit** stay those of the start, and they count all the parts. So a **Run** that ended at `whiteout` or at `time limit` cannot extend. The goal of a new part is the last **Milestone**, `champion`. So a **Run** that ended with `goal` at an older goal can extend, for example at `badge-8` before bot version 52. A **Run** that ended with `goal` at `champion` cannot extend.
_Avoid_: resumed run, paused run, Continued Run (a **Continued Run** is a new **Run** with a new id)

**Checkpoint**:
The state at the end of a **Run record**, in a file next to it: `<name>.json.checkpoint`. It has the **Savestate**, the save data of the emulator and the state of the watches of the **Harness**, for example the **Atlas**. A **Continued Run** or an **Extended Run** of the **Viewer** loads it in place of the replay of its parent. `--continue` of `bun run bot` replays the buttons. The **Harness** loads only a **Checkpoint** of the same **Run record**, of the same format and with the same fields. Else it replays the buttons, and the **Viewer** tells why. A **Checkpoint** keeps the state of the **Run** itself. A replay does not see the people at each `observe()`, so its **Atlas** can be different. The buttons of the **Run record** still replay the **Run** from frame 0. A **Run** of the **Viewer** writes it at its end, unless the **Run** ends with an error.
_Avoid_: savestate (a **Savestate** is the state of the emulator only), snapshot

**Run result**:
What a **Run** gives at its end: the end reason, the frames, the **Milestones** and the number of **Raw inputs**. The end reasons are:
- `goal`: the goal **Milestone**, or the last **Milestone** for a model bot.
- `bot stopped`.
- `user stop`: a person stopped the **Run**.
- `cost limit`: the **Model calls** of the **Run** cost more than its cost limit.
- `token limit`: the **Run** used more tokens than its **Token limit**.
- `plan limit`: the **Plan provider** refused a call because the quota of the subscription is used. A **Continued Run** or an **Extended Run** can continue later.
- `frame budget`: the **Run** used all the frames that it can run.
- `time limit`: the game time reached the **Time limit**.
- `no progress`: the **Stuck counter** reached N. N is an option of the **Harness** or of the **Bot**, with no default, and the **Genetic bot** gives 200.
- `whiteout`: all the Pokémon of the party fainted, and this whiteout reached the **Whiteout limit**.
- `unknown screen`: the model bot pressed B for 3 screens in a row that no action covers, with no **Model call** between them. Or the **Genetic bot** pressed B for 3 screens in a row with no **Decision point** between them.

The result of `whiteout` and of `unknown screen` also keeps the last text of the game. A model bot has no frame budget and no limit of **Decision points** with no progress.
_Avoid_: score, outcome

**Held item**:
The item that a Pokémon of the party holds. A **Bot** gives an item of the Bag to a Pokémon with `give`, and puts it back in the Bag with `take`. `give` offers only the items with an effect when a Pokémon holds them. The damage estimate of a `fight` does not count a **Held item**. The **Harness** does not take Mail, which has no effect in a battle.
_Avoid_: equipped item

**Inventory**:
The Bag (its five pockets with their items and quantities) and the PC (its items, and the species of the Pokémon in its boxes) of a **Run** at one frame. The **Run record** does not keep it: the **Viewer** keeps a history of the changes of the **Inventory** of the shown **Run**, and its panel "Bag and PC" shows the **Inventory** at the cursor.
_Avoid_: items (an item is one entry of a pocket), storage

**Pokémon PC**:
The **Decision point** where a model bot puts a Pokémon of its party in a box of the PC, or takes a Pokémon from a box. It opens with the first option of the menu of a PC, which has the name SOMEONE'S PC or BILL'S PC. One action moves one Pokémon. The **Bot** does not choose the box of a deposit: by a fixed rule, the **Harness** puts the Pokémon in the current box, or in the next box with a free place. At a walk, the PC is in the list of the things to check, as "a PC at (x, y)". Before bot version 46, the walk did not list the PC, so the model did not find it.
_Avoid_: storage, boxes screen

**Viewer**:
The web page that shows the **Runs**. Its **Grid** shows the screens of several **Runs**, and one **Run** at a time is the shown **Run**: the Viewer shows its screen and its state in detail. To focus a **Run** of the **Grid** is to make it the shown **Run**. The shown **Run** is the own **Run** of the Viewer, or a **Run** of a **Bot** that plays at the same time. The keyboard plays its own **Run**, or the buttons of a **Run record** replay it. A replay can jump to a frame, from a **Savestate** that the Viewer keeps at regular frames of the replay (256 at most). It does not emulate. It has six tabs: Lab (the screen and the panels of the shown **Run**), Grid, Race, Evolutions (start, continue and stop an **Evolution**, and see its **Generations**), Doc (what the lab can do) and Components (each component of the design system in all its states). All the panels follow one cursor (a frame of the shown **Run**) and one selection (a range of frames).
_Avoid_: emulator, web player

**Grid**:
The view of the **Viewer** that shows 2, 4 or 9 **Runs** at the same time, each in its own cell: a live **Run**, or a replay of a **Run record**. The replays of a **Grid** share one cursor of game frames: they start at frame 0 together, so they race on their game time. A replay that a person adds later goes to the frame of the cursor. A live **Run** has no shared cursor: its cell shows its own last frame, and it stops while its game waits for a **Model call**. An ended live **Run** keeps its cell until a person removes it; its **Run record** stays. The **Grid** shows the screen and a few facts of each **Run**; the panels are for the shown **Run** only. The **Grid** has no sound.
_Avoid_: wall, multiview, dashboard

**Race**:
A file that a command makes from a set of **Run records**, or that an **Evolution** writes for each **Generation** and for the best **Genome** of each **Generation**: the track and the **State track** of each **Run** on one game time from frame 0, with its battles, its **Milestones**, its cost or its tokens, its **Run result** and its whiteouts: for each one, the last faint, the foe that knocked out the last Pokémon and the last 3 answers of the model. Also the tab of the **Viewer** that plays it, on a map of Kanto with no emulator.
_Avoid_: ghost map, replay (a replay is what you watch from a Run record in an emulator)

**Ghost**:
One **Run** in a **Race**, drawn with its own sprite and the number of its **Run**. The number is the Run id at the start of the file name of its **Run record**. The sprite comes from this Run id alone, so a **Run** has the same face in every **Race**. A dot shows the family of its model: DeepSeek, Claude, GPT or Grok; for a **Run** with a **Coach**, the family of the AI model of the **Run**, and the name shows both models. A **Run record** of an older date holds an alias of the claude command, and the **Race** shows the full id of that alias. A **Ghost** whose **Run** ends with a whiteout stays on the cell where it lost: it does not go to the Pokémon Center. A **Ghost** of another model and a group of **Ghosts** have no dot. A **Ghost** of a **Genetic bot** has the number of its **Genome**, which each **Genome** gets when it is born, and the dot of the **Genetic bot**: a **Genome** that passes unchanged to the next **Generation** keeps its face.
_Avoid_: player, avatar

**State track**:
The team and the battle of a **Run** at each change, in its **Run record**: the species, nickname, level, max HP and moves of the team; the HP and status of the team; and the two Pokémon of a battle, with the name of the trainer. A replay gives the same list.
_Avoid_: state stream, party log

**Leaderboard**:
The list of the **Runs** of a **Race** by rank at the cursor: most **Milestones**, then the first to reach them, then the highest sum of levels, then the lowest Run id. Each row also shows the model of its **Run**, with its dot and with no prefix. It is the first tab of the panel at the right of the Race tab.
_Avoid_: ranking table, scoreboard

**Graveyard**:
A mode of the Race tab: a tombstone at the cell of each whiteout of a **Ghost**, also a whiteout that its **Run** played on after, with the foe that knocked out the last Pokémon and the last answers of the model before it. A filter also shows the end of each **Run** that stopped with no whiteout. While the Deaths tab of the panel shows, the map is the memorial: grey, with the places that kill. The Tour shows the whiteouts one after the other, in the order of the **Runs**, for a video. The **Race** file holds each whiteout. In the Viewer, a death is a whiteout with its **Run**, its starter and its epitaph: the line that the model said in its last answer, else the first sentence of the reason of that answer.
_Avoid_: death map, cemetery mode (the cemetery is the Graveyard while the Race plays)

**Timeline**:
The band at the bottom of the Lab tab of the **Viewer**: the **Game events** of the shown **Run** as icons, from frame 0 to the end, with a time that is linear. It shows the **Game events** only, not the **Model calls** or the cost. A click on it moves the cursor, or jumps a replay to that frame; a drag selects a range.
_Avoid_: slider, scrubber, Stats charts (the panel Stats has its own charts)

## Relationships

- The **Harness** runs a **Lab build**, a **Vanilla build** or an **Arena build**, and starts it from a **Starting save**. Only the Arena tests run an **Arena build**.
- A **Bot** plays one **Run**. **Agents** write scripted **Bots**.
- A **Bot** gets control only at a **Decision point** or after an **Interruption**, and sees the game through the **Knowledge level** of its **Run**.
- A **Bot** uses **Macro-actions**, and **Raw inputs** only when no **Macro-action** fits.
- Each **Run** has one **Run record**. A **Run** ends when its **Bot** stops, a person stops it, or it reaches its goal. The **Run** of a scripted bot also ends when its frame budget is used. A **Run** also ends with `no progress` when the **Harness** or its **Bot** has a limit for it. The **Run** of a model bot also ends at its cost limit or its **Token limit**, or at a `plan limit`. It also ends at its **Whiteout limit**, at its **Time limit** and at an unknown screen.
- A **Run** of a model bot has one AI model, and at most one **Coach** on the same **Model provider**. Only the **Coach** writes a **Coach advice**.
- A **Continued Run** has one parent **Run record**, and its own **Run record** names the parent.
- A **Checkpoint** belongs to one **Run record**: the end of each new part writes a new one.
- An **Extended Run** has one **Run record**: each new part replaces the file, and only an **Extended Run** changes a **Run record** after its **Run** ended (`bun run migrate` adds only data from the replay).
- The lab has two kinds of **Bot** that grow with the story: the model bot and the **Genetic bot**. A **Neural bot** is planned: the lab does not have it yet. The scripted bot is a tool to test the **Harness**: it does not grow with the story.
- A **Genetic bot** plays one **Genome** in each **Run**.
- The **Viewer** shows several **Runs** in its **Grid**, and one **Run** in detail: the shown **Run**. The **Harness** owns all **Runs**.
- A **Race** holds many **Run records**. Each of its **Ghosts** is one **Run**. A **Run** that another **Run** of the **Race** continues has no **Ghost**: the **Continued Run** already holds its play. The **Viewer** plays a **Race** in the browser: no **Run** plays in the **Harness** for it.
- A **Savestate** is valid only for the build that made it. A **Starting save** is valid for all builds.

## Flagged ambiguities

- "Save" was used for both the battery save and the emulator snapshot. Resolved: **Starting save** is the battery save; **Savestate** is the snapshot.
