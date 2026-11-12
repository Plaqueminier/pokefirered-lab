import { Footprints, ListChecks, Scale } from "lucide-preact";
import type { WalkCriterion } from "../src/genetic/genome";
import { Block, BLOCKS2, DocCard, GRID3, Page, Terms } from "./doc-parts";

// In the order of the spec (#88): the numbers of the list are the numbers of the criteria.
const WALK_DOC: Record<WalkCriterion, string> = {
  notUsed: "1 for an exit that the player did not take, a person that the player did not talk to, or a sign that the player did not read.",
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

export function GenomePage() {
  return (
    <Page
      lead="The Genetic bot plays with a Genome: weights from −1 to 1 over criteria. At each Decision point, its code lists the actions that it can play, gives each criterion of each action a number from 0 to 1, gives each action the score Σ weight × criterion, and plays the action with the best score (ADR 0008)."
      details={[
        ["Version", "the Genetic bot (`bots/genetic.ts`) has a version, as the model bot has: the page “Bots” gives it. A new criterion makes a new version, and an older Genome gets the weight 0 for it."],
        ["Genome file", 'JSON with a group of weights for each kind of Decision point, for example `{"walk": {"notUsed": 1, "isExit": 1, "previousMap": -1}}`. A criterion with no weight has the weight 0. An unknown group, an unknown criterion or a weight out of −1 to 1 is refused.'],
        ["Tie", "two actions with the same score: the first action of the list plays. The list has the exits (the warps, then the edges), the people, the signs, then the cells. So the Run of a Genome is always the same."],
        ["Impossible", "an action that the Harness answers as `impossible` leaves the list for this Decision point, and the next best action plays. When no action is left, the Bot stops."],
        ["Knowledge level", "the Bot takes its facts from the Atlas and `observe()`, as the model bot: it sees only the cells, the exits, the people and the signs that the player saw."],
        ["Texts", "the code reads the texts. When `readText` is impossible, it presses B 3 times. After 3 screens in a row that no action covers, the Run ends with `unknown screen`."],
        ["Memory", "the Bot keeps the cells where the player stood at each walk Decision point, for each map. The maps where the player arrived come from the `map` events of the Run."],
        ["End", "a Run of the Genetic bot ends with `no progress` when the Stuck counter reaches 60, unless the Run gives another limit. It has no goal."],
      ]}
    >
      <div class={GRID3}>
        <DocCard icon={Footprints} title="Walk" lines={["the seen exits, people and signs of the map", "every seen cell that the player can reach, from one search from the player", "a person or a sign: a walk next to it, then `interact`"]} />
        <DocCard icon={ListChecks} title="Choices and battles" lines={["no criteria yet", "the first action of the Harness, after `leave` and `keep`", "a name: none, the game keeps its name"]} />
        <DocCard icon={Scale} title="Score" lines={["Σ weight × criterion", "the best score plays", "a tie: the first action of the list"]} />
      </div>
      <div class={BLOCKS2}>
        <Block label="Walk criteria" sub="The group `walk` of the Genome. A criterion that does not apply to an action is 0: for example `tallGrass` for an exit.">
          <Terms numbered rows={Object.entries(WALK_DOC).map(([criterion, text]) => [`\`${criterion}\``, text] as const)} />
        </Block>
        <Block label="Play one Genome" sub="In `lab/`, from the Starting save. The Run record goes to `runs/`, and the Viewer replays it as the Run of any Bot.">
          <Terms rows={[["`bun run bot genetic --genome <Genome file> [player|full]`", "plays the Genome at the `player` Knowledge level, or at `full`."]]} />
        </Block>
      </div>
    </Page>
  );
}
