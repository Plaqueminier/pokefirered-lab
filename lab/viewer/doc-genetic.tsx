import { FITNESS_VERSION } from "../src/genetic/fitness";
import { Block, Page, Terms } from "./doc-parts";

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
