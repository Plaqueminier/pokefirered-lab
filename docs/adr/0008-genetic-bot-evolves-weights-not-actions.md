# The Genetic bot evolves weights over criteria, not a list of actions

The Genome of the Genetic bot is a set of weights. At each Decision point, its code lists the actions that the Bot can play, gives each action a score (the sum of each weight × a criterion that the code computes, for example "an exit that the player did not take"), and plays the action with the best score. We did not choose a Genome that is a list of actions or of buttons, as in the known genetic algorithms that play Mario. A list of actions learns one route by heart, as a TAS: it is good for one seed only, each child must replay the route of its parent, and the result is not a player. With weights, the same Genome plays on any seed and always from the Starting save, and the Viewer shows a player with preferences.

## Consequences

The Bot can play only the actions of its list and see only the criteria that we write. When a Run shows that the Bot is blocked, we add actions or criteria, and each new criterion is a new version of the Genetic bot. A Bot whose criteria a network learns itself is the Neural bot, not the Genetic bot.
