# History of the lab

The steps of the lab, in order. Each step gives what we added, and what a Run taught us when a Run caused the step. Use it as the plan of a video. Add a step at the end of each piece of work.

## 1. The emulator and the Viewer (2026-10-09 to 10-10)

1. A lab build of FireRed (`make lab`): the same game, plus a direct boot to "Continue" and a fixed RNG seed. The emulator (libmgba) runs in Bun; the browser only shows the game (ADR 0001). `11ebe5b9d`
2. The Viewer: the screen, the keyboard, the speeds, the savestates, and an overlay of the cells (collision, water, ledges, warps, people). `11ebe5b9d`
3. Sound in the Viewer, at ×1 only. `a23150e06`
4. The whole-map view: any map, with its warps, signs, hidden items, triggers and trainer sight lines. `01ebd3a68`

## 2. The Harness and the scripted bot (2026-10-11)

5. The Harness: a Bot calls Macro-actions, and `goTo` finds a path with A*. The first Bot walks to the stairs. `a8eb9af60`
6. `goTo` across maps: doors, stairs, map edges, ledges. The Bot leaves the house. `642647487`
7. Texts and choices: the game freezes at each Decision point (ADR 0002). The Bot follows Oak to his lab. `51cbe9fdb`
8. `interact`, the party and the Milestones: the Bot takes SQUIRTLE. `9d0f47996`
9. The battle Macro-actions: the Bot wins the first rival battle. `a63acf485`
10. The Run record and its replay, the frame budget and the no-progress end. `b8c439379`, `e283d1fbe`
11. Up to 4 Runs at the same time, one shown in the Viewer. `4d3babe25`

## 3. The model bot (2026-10-24 to 10-25)

12. The model bot: an AI model on OpenRouter chooses each action from a text prompt, up to the first rival battle (ADR 0003). `eb17ae3ff`
13. The Doc tab of the Viewer. `469a3c787`
14. What a player knows: the Atlas (the maps that the player saw), the data of the Summary screen, and the tries since the last progress. `362de58f8`
15. The cost and the model in a replay, and the choice of the starter (`free` or one of the three). `26c43fb72`

## 4. Past the first rival battle: spec #12 (2026-10-25)

16. The scripted bot becomes a test tool; the model bot is the one Bot. `1550190c5`
17. The Atlas keeps all the texts of each person, and the extract has budgets. `bc2783f61`
18. The next Milestone in each prompt; the Run ends at the cost limit, not at the first rival battle. `352f21a8b`
19. One conversation at a Decision point, and the prompt order for the cache of the providers. `fcd3f3a03`
20. The panel "Stats". `78e0cccb2`
21. The party: `switch`, `send`, `swap`. `3d8d88014`
22. The Memory tree (from OptMem): one note for each answer, Summary calls that merge the nodes, and `zoom`. `764323476`
23. The Bag in a battle and catching Pokémon. `7b222fb74`
24. The Bag on a walk. `b2ea6c4d7`
25. The panel "Memory tree" (variant B of a prototype of 3 layouts). `3bffb797c`
26. The Poké Mart: `buy` and `sell`. `e6ec2f735`
27. A review of the whole spec: the menu navigation leaves the Harness, and one list of the model actions. `35e422cda`, `f9cee21af`, `ddf6aeefb`

## 5. What the first long Runs taught us (2026-10-26)

28. A model wrote a stray "{" line before its JSON answer, then copied its error two times: the Run stopped after 3 answers that the Bot could not read. Now the Bot reads the first JSON object of an answer. `bc6f328a8`
29. The Milestone "Get the Pokédex from Professor Oak" was a trap: Oak gives the Pokédex only after the player brings Oak's Parcel from Viridian City. The model talked to Oak for about 140 calls. We removed this Milestone: the model must find the parcel itself. `bc6f328a8`
30. The old no-progress count went back to 0 at each new cell, so it did not show that the model was stuck. A new count: the walk Decision points since a new map, a new Milestone, a level up or a new text of a person. From 50, the prompt tells the model that it is stuck, and the rules tell it to explore. `bc6f328a8`
31. The Nurse of a Pokémon Center stands behind a counter: `go` looked for a free cell next to her and found none, so the model could not heal. Now `go` walks to the front of the counter and talks across it. `bc6f328a8`
32. The Viewer starts with no sound. `bc6f328a8`
33. A Run can continue a stopped Run, also with another model: the Harness replays the buttons of the Run record, keeps its events (the Memory tree, the Mission, the texts of the people), and the model plays on. The cost limit counts the new Model calls only. So a long Run is not lost when it stops, and a cheap model can play the easy parts before a better one. `8de9db896`
34. The Nurse of a Pokémon Center asks YES or NO with a `multichoice` menu, which the Harness did not read: it saw a busy game, and the B presses of the code answered NO. The model could never heal. Now each `multichoice` menu is a choice, and `choose YES` heals.
35. The model asked `goTo 6 10` three times in a house of 10 rows, and `goTo 6 -1 PalletTown` to leave by the north: the reason "no route" did not tell it why. Now the Harness tells when a cell is outside the map, with the cells of the map. After an impossible action, the model bot keeps the conversation and sends the reason and the exits of the map; after 3 in a row, it starts a new prompt.
