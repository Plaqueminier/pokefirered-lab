import { Backpack, Bot, ChartColumn, Cpu, Eye, Hand, ListTree, Map as MapIcon, Play, Shapes } from "lucide-preact";
import { Card, NumberBadge } from "./components";
import { LoopDiagram } from "./doc-diagrams";
import { RAW_INPUT_FORM } from "./doc-harness";
import { Block, BLOCKS2, DocCard, GRID3, Page, Terms } from "./doc-parts";
import viewerLab from "./doc/viewer-lab.png";

export function LoopPage() {
  return (
    <Page
      lead="A Bot plays the game through the Harness, and the game is frozen at each Decision point until the Bot gives the next action."
      details={[
        ["Frozen game", "in a Run of a Bot, the game runs only during an action (ADR 0002): the same Run at any speed of the Bot."],
        ["Viewer Run", "no Bot: the keyboard or a replay plays it, in real time."],
        ["`zoom`, `viewAtlas`", "no frames run: the model gets a new call at once, at the same Decision point."],
        ["Raw input", `\`${RAW_INPUT_FORM}\`: one press when no Macro-action fits. The Harness counts them.`],
      ]}
    >
      <Card>
        <div class="hidden @3xl:block">
          <LoopDiagram layout="row" />
        </div>
        <div class="overflow-x-auto @3xl:hidden">
          <div class="min-w-[420px]">
            <LoopDiagram layout="cycle" />
          </div>
        </div>
      </Card>
      <div class={BLOCKS2}>
        <Block label="🔁 One turn of the loop">
          <Terms
            numbered
            rows={[
              ["Harness", "runs the emulator to the next Decision point; it decides nothing"],
              ["Decision point", "the game waits for an input: walk, text, choice, battle…"],
              ["Model call", "the model bot asks its AI model for one action"],
              ["Macro-action", "the Harness plays the action in the game, or one Raw input"],
            ]}
          />
        </Block>
        <Block label="⏸️ Frozen game (ADR 0002)">
          <Terms
            rows={[
              ["Bot Run", "the game runs only during an action"],
              ["Same Run", "at any speed of the Bot, the same frames"],
              ["Viewer Run", "no Bot: the keyboard or a replay plays it, in real time"],
            ]}
          />
        </Block>
      </div>
    </Page>
  );
}

export function PrinciplePage() {
  return (
    <Page
      lead="The words of the lab, each with one meaning (CONTEXT.md)."
      details={[
        ["Run", "an emulator that plays from the Starting save."],
        ["Bot", "decides what to do, and acts only through the Harness."],
        ["Harness", "plays the actions of the Bot in the game; decides nothing."],
        ["Decision point", "the game waits for an input: walk, text, choice, battle action…"],
        ["Knowledge level", "`player`: what a careful player knows · `full`: also the exact HP and stats of the enemy, and all the maps in the Atlas."],
        [
          "Atlas",
          "what the Run knows of the world: the maps visited, the cells seen on the screen (15 × 10), the exits taken with their destination, the exits seen, the signs read, the people seen (at the cell where the player last saw them) and their texts, the person of the last talk, the edges blocked by water, and the fixed obstacles seen. At the `full` level: all the maps, but only the fixed obstacles seen.",
        ],
      ]}
    >
      <div class={GRID3}>
        <DocCard icon={Play} title="Run" lines={["an emulator that plays from the Starting save", "10 at most at the same time: the Viewer Run and 9 places"]} />
        <DocCard icon={Bot} title="Bot" lines={["decides what to do", "acts only through the Harness"]} />
        <DocCard icon={Cpu} title="Harness" lines={["plays the actions of the Bot in the game", "decides nothing"]} />
        <DocCard icon={Hand} title="Decision point" lines={["the game waits for an input", "walk, text, choice, battle action…"]} />
        <DocCard icon={Eye} title="Knowledge level" lines={["`player` what a careful player knows", "`full` also the exact HP and stats of the enemy, and all the maps"]} />
        <DocCard icon={MapIcon} title="Atlas" lines={["what the Run knows of the world", "maps visited, cells seen (15 × 10), exits, signs, people and their texts", "edges blocked by water, fixed obstacles"]} />
      </div>
    </Page>
  );
}

// x and y in percent of the screenshot.
const LAB_SPOTS = [
  { x: 40, y: 9, title: "Top bar", text: "the Run, Bots, the cost and its limit, the Stuck counter, the Model calls, the badges, the money, the map, the time" },
  { x: 6, y: 30, title: "Screen", text: "the game, and under it the controls: pause, the speeds ×1 to ×16 and Max, the overlay, the sound, the savestate, the keys" },
  { x: 6, y: 82, title: "Decision line and party", text: "a hover shows the answer of the call; the Pokémon cards" },
  { x: 47.7, y: 36, title: "Rail", text: "Whole map, Model, Stats, Memory tree, Bag and PC" },
  { x: 88, y: 60, title: "Panel", text: "one panel at a time; a click moves the cursor of all the panels" },
  { x: 12, y: 92, title: "Timeline", text: "the Game events as icons; a click goes to a frame, a drag selects a range" },
];

export function ViewerPage() {
  return (
    <Page
      lead="Five tabs: Lab, Grid, Race, Doc and Components; a change of tab stops no Run."
      details={[
        ["Keyboard", "in the Grid, Race, Doc and Components tabs, the keyboard does not play. In the Grid, Doc and Components tabs, the arrow keys scroll the page."],
        [
          "Grid",
          "the second tab: 2, 4 or 9 cells, each with the screen of a Run, its name, Bot, model, game time, last Milestone, cost and state (plays, waits for the model, in battle, ended). The live Runs fill the cells; a Run record can go in any cell. The replays share one cursor (play, pause, ×1, ×4, ×20, a slider) from frame 0. A click on a cell shows its Run in the Lab tab, with a bar “← Grid” to go back. No sound.",
        ],
        [
          "Race",
          "the third tab: it plays a file of `lab/races/` (`bun run race <name>`) on a map of Kanto in the tiles of the ROM, with no emulator. Each Run is a Ghost: the sprite of the player, with the number of its Run. The Ghosts start at frame 0: play, pause, ×1 to ×200, a slider of game time. A count at a door tells how many Ghosts are inside: a hover shows the interiors, a click opens the building on the map, and a drawer lists the interiors where a Run still plays. The gyms show their badge. The leader has a crown. A Run that ended stays see-through, with an icon of its result next to its number. The camera frames the Ghosts that still play until a wheel or a drag; the button “Frame the Ghosts” gives it back.",
        ],
        ["Top bar", "on one line: the Run (choose another Run, or a Run record to replay, in its list), a button “Bots” (start a Bot, stop the shown Run), the cost with its limit, the Stuck counter, the Model calls, the badges, the money, the map and the time."],
        ["Replay", "a hover on the button next to the Run shows the facts of the Run record, with the number of its Game events."],
        ["Screen controls", "pause, the speeds from ×1 to ×16 and Max, the overlay with its legend on a hover, the sound and its volume, the savestate, the Starting save, and the keys on a hover."],
        ["Decision line", "the last action of the Bot; a hover shows the answer of the call."],
        ["Whole map", "the canvas, with the Exits and “What can stop you” at its right (a click on an exit shows its map, a click on a trainer or a trigger centres the map on it), a search of the maps, and the data of a cell in a card at the pointer."],
        [
          "Model",
          "the Model calls with the flags of the Unusual calls (unreadable, impossible, Reflection, Review, expensive, more turns, new Mission, repeated) and a filter chip for each flag. One call in full: the answer, what it played, the cost, then the blocks of its prompt, in colors, that fold.",
        ],
        [
          "Stats",
          "the Run for a video, in large numbers: the time, the cost, the Stuck counter and the prompt tokens at the cursor, what happened since the last heal, the latest Game events, then the chapters (up to each Milestone), the Areas and the charts of the cost, the Stuck counter and the prompt tokens, and the counts of the selection (heals, purchases, money spent, catches, fainted Pokémon of the player, trainers beaten, whiteouts, Unusual calls).",
        ],
        ["Stats selection", "a click on a chapter or an Area selects it, and the stats and the charts follow it; a drag on a chart selects a range; “−2 h” shows the 2 hours before the cursor in the charts; “Whole Run” selects the whole Run again and returns the cursor to now. The Model calls of the selection and their actions fold under the stats."],
        ["Memory tree", "the tree at the cursor, one node at a time: the top nodes as the model sees them; a click opens a node, its two halves and the Summary call that made it (its prompt and answer). A tab lists the Summary calls of the selection."],
        ["Bag and PC", "the five pockets of the Bag with their items (quantity and description), the items of the PC and the Pokémon of the boxes at the cursor, and the changes of the Bag and the PC with their times; a click on a change goes to it."],
        [
          "Timeline",
          "the Game events of the Run as icons on one track (Milestones, fainted Pokémon, new Pokémon, evolutions, trainer battles, heals, new places, and as options the levels, wild battles, purchases and items got), with a chip for each kind. A hover shows the events, a click goes to a frame (in a replay, the screen jumps to it), a drag selects a range.",
        ],
        ["Cursor", "one cursor (a frame) and one selection (a range of frames) for all the panels: a click on a Model call or on the Timeline moves them, Esc returns them to now."],
        ["Toast", "at each notice and each new Milestone."],
        ["Doc", "the fourth tab: 12 short pages in 3 groups, in a side list; the page is in the URL (`?doc=<page>`), and each page ends with Details."],
        [
          "Components",
          "the fifth tab: the design system of the Viewer (ADR 0004), each component in all its states, in five groups (Base, Controls, Data, Surfaces, Lab). Also the type colors, the PP, EXP and stat bars, the Pokémon card and its hover card, the popover, the toast, the badges, the filter chip, the collapsible block, the list row, the prompt text with colors, the card at the pointer, the legend and the key list; the tooltip is in the top layer. A new part of the Viewer uses these components.",
        ],
      ]}
    >
      <div class="grid grid-cols-1 gap-6 @4xl:grid-cols-[1.4fr_1fr]">
        <div class="relative self-start overflow-hidden rounded-card border border-line">
          <img src={viewerLab} alt="The Lab tab of the Viewer" class="block h-auto w-full" />
          {LAB_SPOTS.map((spot, i) => (
            <span key={spot.title} class="absolute -translate-x-1/2 -translate-y-1/2" style={{ left: `${spot.x}%`, top: `${spot.y}%` }}>
              <NumberBadge n={i + 1} />
            </span>
          ))}
        </div>
        <Block label="🖥️ The Lab tab">
          <ol class="m-0 flex list-none flex-col gap-2.5 p-0 text-sm">
            {LAB_SPOTS.map((spot, i) => (
              <li key={spot.title} class="flex items-start gap-2.5">
                <NumberBadge n={i + 1} />
                <span class="min-w-0 pt-0.5">
                  <b class="font-semibold text-fg">{spot.title}</b> <span class="text-muted">{spot.text}</span>
                </span>
              </li>
            ))}
          </ol>
        </Block>
      </div>
      <Block label="🧭 The panels" sub="One cursor (a frame) and one selection (a range of frames) for all the panels. Esc returns them to now.">
        <div class={GRID3}>
          <DocCard icon={MapIcon} title="Whole map" lines={["the canvas, the Exits and “What can stop you”", "a search of the maps, a card at the pointer"]} />
          <DocCard icon={Bot} title="Model" lines={["the Model calls, with the flags of the Unusual calls", "one call in full: answer, result, cost, prompt"]} />
          <DocCard icon={ChartColumn} title="Stats" lines={["large numbers for a video: time, cost, Stuck counter", "chapters, Areas, charts, the counts of the selection"]} />
          <DocCard icon={ListTree} title="Memory tree" lines={["the top nodes at the cursor, as the model sees them", "a click opens a node and its Summary call"]} />
          <DocCard icon={Backpack} title="Bag and PC" lines={["the five pockets, the PC and its boxes at the cursor", "the changes, with their times"]} />
          <DocCard icon={Shapes} title="Components tab" lines={["the design system (ADR 0004)", "each component in all its states"]} />
        </div>
      </Block>
    </Page>
  );
}
