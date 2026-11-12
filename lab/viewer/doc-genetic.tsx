import { ChartLine, Footprints, Gauge, Ghost, GitFork, LayoutDashboard, ListChecks, Repeat, Scale, Shuffle, Trophy, Users } from "lucide-preact";
import type { BattleCriterion, ChoiceCriterion, WalkCriterion } from "../src/genetic/genome";
import { FITNESS_VERSION } from "../src/genetic/fitness";
import { Block, BLOCKS2, DocCard, GRID3, Page, Terms } from "./doc-parts";

const WALK_DOC: Record<WalkCriterion, string> = {
  notUsed: "1 for an exit that the player did not take, a person that the player did not talk to, or a sign that the player did not read. For an exit, the Bot knows that the player did not take it when the Atlas does not know where it leads. This is exact at the `player` Knowledge level, the level of an Evolution and the default level of the command. At `full`, the Atlas knows where each exit leads, so `notUsed` is 0 for the exits.",
  distance: "the steps from the player to the target or the cell, divided by the width + the height of the map (1 at most). For an edge, the steps to the edge.",
  isExit: "1 for an exit: a warp or an edge.",
  isPerson: "1 for a person (a Poké Ball on the ground is a person).",
  isSign: "1 for a sign, or for something that the player can check.",
  isCell: "1 for a cell.",
  newMap: "1 for an exit to a map where the player did not go. At the `player` Knowledge level, the Bot knows where an exit leads only after it took the exit: an exit that the player did not take counts as an exit to a new map.",
  previousMap: "1 for an exit to the map where the player was before this map.",
  mapVisits: "the arrivals of the player on the map where the exit leads: n / (1 + n). 0 for an exit that the player did not take.",
  neverWalked: "1 for a cell where the Bot did not stand at a walk Decision point.",
  unknownNeighbours: "the share of the 4 neighbour cells that the player did not see (? in the Atlas).",
  mapEdge: "1 for a cell on the first or the last row or column of the map.",
  tallGrass: "1 for a cell of tall grass.",
};

const CHOICE_DOC: Record<ChoiceCriterion, string> = {
  isYes: "1 for the option YES.",
  isNo: "1 for the option NO.",
  rank: "the place of the option in the menu: 0 for the first option, 1 for the last option. A menu with one option gives 0.",
};

const BATTLE_DOC: Record<BattleCriterion, string> = {
  effectiveness: "the type multiplier of a damage move against the foe, divided by 4: 0.25 for a normal effect, 0.5 for a super effective move. 0 for a move with no damage.",
  power: "the power of the move, divided by 250 (EXPLOSION). 0 for a move with no damage or with its own damage rule.",
  accuracy: "the accuracy of the move, divided by 100. 1 for a move that never misses.",
  ppLeft: "the PP left of the move, divided by its maximum PP.",
  noDamage: "1 for a move with no damage, for example TAIL WHIP.",
  usedNoDamage: "1 for a move with no damage that the Pokémon already used in this battle. A walk Decision point ends the battle for the Bot.",
  run: "1 for `run`: only against a wild Pokémon.",
};

const groupRows = (doc: Record<string, string>) => Object.entries(doc).map(([criterion, text]) => [`\`${criterion}\``, text] as const);

export function GenomePage() {
  return (
    <Page
      lead="The Genetic bot plays with a Genome: weights from −1 to 1 over criteria. At each Decision point, its code lists the actions that it can play, gives each criterion of each action a number from 0 to 1, gives each action the score Σ weight × criterion, and plays the action with the best score (ADR 0008)."
      details={[
        ["Version", "the Genetic bot (`bots/genetic.ts`) has a version, as the model bot has: the page “Bots” gives it. A new criterion makes a new version, and an older Genome gets the weight 0 for it."],
        ["Version 2", "the groups `choice` and `battle` (criteria 14 to 23). A Genome of version 1 has the group `walk` only: it gets the weight 0 for each criterion of the choices and of the battles."],
        ["Genome file", 'JSON with a group of weights for each kind of Decision point (`walk`, `choice`, `battle`), for example `{"walk": {"notUsed": 1, "isExit": 1, "previousMap": -1}, "choice": {"isYes": 1}}`. A group or a criterion with no weight has the weight 0. An unknown group, an unknown criterion or a weight out of −1 to 1 is refused.'],
        ["Tie", "two actions with the same score: the first action of the list plays. At a walk, the list has the exits (the warps, then the edges), the people, the signs, then the cells. At a choice, the options in the order of the menu. At a battle, the moves in the order of the Pokémon, then `run`. So the Run of a Genome is always the same."],
        ["People", "a person that the Atlas keeps but that is not on the map now, for example a Poké Ball that a player took, is not a target."],
        ["Fixed rules", "the Genome has no criteria for the other Decision points. A name: none, the game keeps its name. A new move: `keep`. A Pokémon to send in a battle: the first Pokémon that can go. A shop or a PC: `leave`."],
        ["Impossible", "an action that the Harness answers as `impossible` leaves the list for this Decision point, and the next best action plays. When no action is left, the Bot stops."],
        ["Knowledge level", "the Bot takes its facts from the Atlas and `observe()`, as the model bot: it sees only the cells, the exits, the people and the signs that the player saw."],
        ["Texts", "the code reads the texts. When `readText` is impossible, it presses B 3 times. After 3 screens in a row that no action covers, the Run ends with `unknown screen`."],
        ["Memory", "the Bot keeps the cells where the player stood at each walk Decision point, for each map. The maps where the player arrived come from the `map` events of the Run."],
        ["End", "a Run of the Genetic bot ends with `no progress` when the Stuck counter reaches 60, unless the Run gives another limit. It has no goal."],
      ]}
    >
      <div class={GRID3}>
        <DocCard icon={Footprints} title="Walk" lines={["the seen exits, people and signs of the map", "every seen cell that the player can reach, from one search from the player", "a person or a sign: a walk next to it, then `interact`"]} />
        <DocCard icon={ListChecks} title="Choices and battles" lines={["each option of a YES/NO menu or of a `multichoice`", "each move that the Harness gives (`fight`)", "`run` against a wild Pokémon"]} />
        <DocCard icon={Scale} title="Score" lines={["Σ weight × criterion", "the best score plays", "a tie: the first action of the list"]} />
      </div>
      <div class={BLOCKS2}>
        <Block label="Walk criteria" sub="The group `walk` of the Genome. A criterion that does not apply to an action is 0: for example `tallGrass` for an exit.">
          <Terms numbered rows={groupRows(WALK_DOC)} />
        </Block>
        <Block label="Choice criteria" sub="The group `choice` of the Genome: the criteria 14 to 16 of the spec, in this order.">
          <Terms rows={groupRows(CHOICE_DOC)} />
        </Block>
        <Block label="Battle criteria" sub="The group `battle` of the Genome: the criteria 17 to 23 of the spec, in this order. A criterion of the moves is 0 for `run`.">
          <Terms rows={groupRows(BATTLE_DOC)} />
        </Block>
        <Block label="Play one Genome" sub="In `lab/`, from the Starting save. The Run record goes to `runs/`, and the Viewer replays it as the Run of any Bot. A “continue” of this record in the form “Bots” plays the Genome of its header.">
          <Terms rows={[["`bun run bot genetic --genome <Genome file>|<Evolution>:<Genome id> [player|full] [--seed <0 to 0xffff>]`", "plays the Genome of the file, or a Genome of an Evolution, at the `player` Knowledge level, or at `full`. `--seed`: another seed of the game, for example a seed that the Genome does not know."]]} />
        </Block>
      </div>
    </Page>
  );
}

export function FitnessPage() {
  return (
    <Page
      lead="The Fitness gives a note to a Run of the Genetic bot, from its Run record only: the Milestones first, then what the Run discovered, then the levels of the party, and fewer frames last."
      details={[
        ["Version", `the Fitness has a version, as a Bot has. Now: version ${FITNESS_VERSION}. A change of a weight or of a count is a new version, and it can rank old Run records again.`],
        ["Only distinct things", "a map, an exit and a text count one time each. A Run that walks between Pallet Town and Route 1 again and again gets no more points than a Run that walks there one time: it only has more frames."],
        ["Exits", "the record has no exit event. Each change of map is the exit from the old map to the new map, so the way back is another exit. Two doors between the same two maps count as one exit."],
        ["Texts", "the record has no event for the text of a person. A text is what the `readText` actions read after an `interact` that is `done`, as the Atlas joins it. The record does not tell a sign from a person, so the text of a sign counts too. A text that the game shows with no `interact` (a trigger, a battle) does not count."],
        ["Levels", "the sum of the levels of the party in the last `team` entry of the State track. The logarithm makes the first levels important, and many levels with no progress are not."],
        ["Frames", "the frames of the Run result. A Continued Run counts the whole Run."],
        ["Detail", "the Fitness gives the note and, for each term, its count and its points: they show why a Genome got its note."],
      ]}
    >
      <Block label={`The terms of version ${FITNESS_VERSION}`} sub="The note is the sum of the points of the terms.">
        <Terms
          numbered
          rows={[
            ["1000 × Milestones", "the Milestones of the Run result"],
            ["10 × new maps", "the different maps of the `map` events, the first map included"],
            ["3 × new exits", "the different changes of map, from one map to another"],
            ["2 × new texts of people", "the different texts after an `interact`"],
            ["20 × log2(1 + levels)", "the sum of the levels of the party at the end of the Run"],
            ["− frames / 100 000", "the frames of the Run"],
          ]}
        />
      </Block>
    </Page>
  );
}

export function EvolutionPage() {
  return (
    <Page
      lead="An Evolution makes Generations of Genomes. Each Genome of a Generation plays one Run from the Starting save, the Fitness ranks the Runs, and the best Genomes make the next Generation. The loop asks the Harness nothing itself: it receives a player, “play this Genome on this seed”, so the Runs can play in workers."
      details={[
        ["Ids", "each Genome gets an id when it is born, and the ids follow one another across the Evolution: 1 to 50 in the first Generation, then 51, 52… It keeps the ids of its two parents. A Genome that passes unchanged keeps its id and its parents."],
        ["Seeds", "the Evolution has its own seed for its random choices. The random choices of a Generation come from this seed and the number of the Generation only: a continued Evolution makes the same Generations as an Evolution that did not stop. The Runs of the Generations play on one seed of the game, the training seed: the seed of the ROM, `0x4c41`."],
        ["Test seeds", "every 10 Generations, the best Genome also plays one Run on each of 3 test seeds: `0x0001`, `0x1234` and `0xbeef`. The Evolution never ranks with them, so they show if the Genome is good on any seed, or only on the training seed. The tests play with the limits of the Generation, and their results go in the file with the Generation. They do not change the Fitness of the Genome or the next Generation."],
        ["Limits of a Run", "a Run ends with `goal` at `first-rival-battle`, and with `no progress` when the Stuck counter reaches 60. Its frame limit is the higher of 30 000 and 2 × the frames of the Run of the best Genome of the previous Generation: a safety only."],
        ["Parallel Runs", "`bun run evolve` plays 12 Runs at the same time, or the number of `--parallel` (18 at most), in its own workers. They do not use the places of the Viewer."],
        ["Stop and continue", "the Evolution writes its file after each Generation. A stop loses only the Generation that plays: the same command plays it again. The command refuses to continue an Evolution of another version of the Genetic bot or of the Fitness. The Evolutions tab stops an Evolution after the Generation that plays, so it loses no Generation (see Page of the Evolutions)."],
        ["End", "the best Genome of a Generation with tests reaches `first-rival-battle` on the training seed and on the 3 test seeds, or 100 Generations."],
      ]}
    >
      <div class={GRID3}>
        <DocCard icon={Repeat} title="The 5 best" lines={["they pass unchanged to the next Generation", "same id, same weights", "the best Genome is never lost"]} />
        <DocCard icon={GitFork} title="Parents" lines={["the 25 best Genomes", "drawn by pairs at random", "each pair gives one child: 45 children"]} />
        <DocCard icon={Shuffle} title="Child" lines={["uniform crossover: each weight from one parent or the other", "Gaussian mutation, σ = 0.1, on each weight with the probability 0.2", "a weight stays from −1 to 1"]} />
      </div>
      <div class={BLOCKS2}>
        <Block label="Commands" sub="In `lab/`. The first Generation has random weights from −1 to 1.">
          <Terms
            rows={[
              ["`bun run evolve <name> [--parallel <1 to 18>]`", "starts the Evolution `<name>`, or continues it from its file."],
              ["`bun run bot genetic --genome <name>:<Genome id> [--seed <0 to 0xffff>]`", "plays one Genome of the Evolution again, as the Evolution played it: the training seed, the goal and the frame limit of the last Generation that holds the Genome, so the same Run. `--seed` plays it on another seed, for example a test seed. Its Run record goes to `runs/`."],
            ]}
          />
        </Block>
        <Block label="The folder runs/evolutions/<name>/" sub="The Select of the top bar replays its Run records, in a group for each Evolution.">
          <Terms
            rows={[
              ["`evolution.json`", "the settings, the seeds, the Fitness version and, for each Generation, each Genome from the best Fitness to the worst, with its id, its parents, its Fitness, the points of each term, its frames and its Milestones; every 10 Generations, the same results for the best Genome on each test seed."],
              ["Run records", "one for each Generation that gives a new best Fitness. Its header holds the Genome, its id, the Fitness version and the Fitness. Any other Run comes back from its Genome and its seed."],
              ["Races", "the Race of each Generation and the Race of the bests (see Races of an Evolution)."],
            ]}
          />
        </Block>
      </div>
    </Page>
  );
}

export function EvolutionRacesPage() {
  return (
    <Page
      lead="An Evolution gives Races. After each Generation, it writes the Race of the Generation and the Race of the bests in its folder, from the Run records in memory: it keeps no Run record file for each Genome. The Race tab plays them."
      details={[
        ["Ghost", "the number of a Ghost is the id of its Genome, and its face comes from this number. A Genome that passes unchanged keeps its face from Race to Race. A Genome id and a Run id with the same number have the same face."],
        ["Dot", "purple: “genetic”, for each Ghost of the Genetic bot. Its card shows “Genetic bot” and its version in place of a model."],
        ["Race of the bests", "the best Genome of each Generation, in the order of the Generations. A Genome that stays the best for two Generations has two Ghosts with the same number and the same face."],
        ["Stop and continue", "a Generation that plays again after a stop writes its Race again and replaces its best in the Race of the bests."],
        ["Play again", "each Ghost names its Genome as `<Evolution>:<Genome id>`: `bun run bot genetic --genome <Evolution>:<Genome id>` plays it again."],
        ["Race command", "it also takes a Run record of the Genetic bot. The Run record of a new best of an Evolution holds the id of its Genome, so its Ghost has the number of the Genome. A Run record of `bun run bot genetic --genome <Evolution>:<Genome id>` also holds this id. A Run record of a Genome file holds no id: its Ghost has the Run id."],
      ]}
    >
      <div class={GRID3}>
        <DocCard icon={Users} title="Race of a Generation" lines={["the 50 Ghosts of one Generation", "they leave the same bedroom", "`generation-0001`, `generation-0002`…"]} />
        <DocCard icon={Trophy} title="Race of the bests" lines={["the best Genome of each Generation", "it grows at each Generation", "`bests`"]} />
        <DocCard icon={Ghost} title="Race tab" lines={["the list of the bar has a group for each Evolution", "“Generation 1”, “Generation 2”…, “The bests”", "the Races of the lab come first"]} />
      </div>
      <Block label="The folder runs/evolutions/<name>/" sub="Next to `evolution.json` and the Run records of the new bests.">
        <Terms
          rows={[
            ["`generation-<n>.json.gz`", "the Race of Generation n, with a Ghost for each Genome."],
            ["`bests.json.gz`", "the Race of the bests."],
          ]}
        />
      </Block>
    </Page>
  );
}

export function EvolutionsTabPage() {
  return (
    <Page
      lead="The Evolutions tab of the Viewer starts, continues and stops an Evolution, and shows its Generations on one page. The server of the Viewer plays `bun run evolve` for it: one Evolution at a time, out of the places of the Viewer."
      details={[
        ["One at a time", "the server plays one `bun run evolve` process. While it plays, the card “Start or continue” gives its place to the card of the running Evolution, and the server refuses a second start with a notice."],
        ["News", "the process started by the server sends its news over IPC: its start, the end of each Run and the end of each Generation. The server sends the state to the page over the WebSocket, and the page reads the files of the Evolution again after each Generation."],
        ["Stop", "“Stop after this Generation” asks the process to stop when the Generation that plays ends. The file then holds this Generation, and Continue plays the next one. Ctrl-C of `bun run evolve` in a terminal stops at once and loses the Generation that plays."],
        ["Error", "when the process ends with an error, for example another version of the Fitness, a toast gives the last line of its errors."],
        ["Refusals of the form", "a name with other characters than letters, digits, `-` and `_`; an Evolution that ended; an Evolution of another version of the Genetic bot or of the Fitness; a file of an older format. The server tells the reason in `/evolution/list.json`."],
        ["Older format", "the page also shows an Evolution file of format 1 (Genetic bot version 1): it has no Race, and it does not continue. A Genome of version 1 has the group `walk` only: its groups `choice` and `battle` show “not in the Genetic bot version 1”, with the weight 0."],
        ["Best Genome", "the best Genome of the Evolution is the best Genome of the last Generation with a new best: only a new best writes a Run record. “Born in Generation n” is the first Generation that holds its id: an elite keeps its id and its parents. An elite plays again in each Generation, and its Fitness can change when the frame limit grows."],
        ["Server routes", "`/evolution/list.json` lists the Evolutions of `runs/evolutions/`, each with its end or the reason why it does not continue; `/evolution/file/<name>` gives the file of one Evolution."],
      ]}
    >
      <div class={GRID3}>
        <DocCard icon={LayoutDashboard} title="Header" lines={["the Select of the Evolutions of `runs/evolutions/`", "its state: running, stops after, stopped after Generation n, ended, does not continue", "the button “Race of the bests”"]} />
        <DocCard icon={Gauge} title="Five numbers" lines={["the Generations, with the versions of the bot and of the Fitness", "the best Fitness and its Genome, the mean of the last Generation", "the Milestones of the best, the frame limit and the Runs that end at Stuck 60"]} />
        <DocCard icon={ChartLine} title="Fitness by Generation" lines={["the best Fitness (accent) and the mean Fitness (info) of each Generation", "a dot at each new best", "a click opens the Race of the Generation; the Select under the chart does the same with the keyboard"]} />
      </div>
      <div class={BLOCKS2}>
        <Block label="Start, continue, stop" sub="The card at the right of the chart.">
          <Terms
            rows={[
              ["Name", "the name of a new Evolution, or of an Evolution that exists: the field tells which. The page shows the Evolution of the Select."],
              ["Runs at the same time", "from 1 to 18, 12 by default: the `--parallel` of the command."],
              ["Start or Continue", "the same as the command under the button, for example `bun run evolve night-1`."],
              ["Running", "the Generation that plays and a bar of its Runs (n / 50), the Runs at the same time and the time of the last Generation."],
              ["Stop after this Generation", "the Evolution stops when its Generation ends, and loses nothing."],
            ]}
          />
        </Block>
        <Block label="Best Genome" sub="The card under the chart.">
          <Terms
            rows={[
              ["Facts", "its id, the Generation where it was born, its parents, its frames and the end of its Run."],
              ["Weights", "each weight from −1 to 1 on a bar from a centre line, in three columns: `walk`, `choice` and `battle`."],
              ["Fitness", "the points and the count of each term."],
              ["Replay its Run", "replays its Run record in the Lab tab."],
            ]}
          />
        </Block>
      </div>
    </Page>
  );
}
