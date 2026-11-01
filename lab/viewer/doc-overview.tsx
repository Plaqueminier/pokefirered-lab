import { Backpack, Bot, Camera, ChartColumn, Cpu, DoorOpen, Eye, Gauge, Hand, ListTree, Map as MapIcon, MonitorPlay, PanelRightOpen, Play, Shapes, SlidersHorizontal, Trophy } from "lucide-preact";
import { Card, NumberBadge } from "./components";
import { LoopDiagram } from "./doc-diagrams";
import { RAW_INPUT_FORM } from "./doc-harness";
import { Block, BLOCKS2, DocCard, GRID3, Page, Terms } from "./doc-parts";
import viewerGrid from "./doc/grid.png";
import viewerRace from "./doc/race.png";
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
      lead="Five tabs: Lab, Grid, Race, Doc and Components; a change of tab stops no Run. This page tells the Lab tab; the Grid and the Race have their own pages."
      details={[
        ["Keyboard", "in the Grid, Race, Doc and Components tabs, the keyboard does not play. In the Grid, Doc and Components tabs, the arrow keys scroll the page."],
        ["Top bar", "on one line: the Run (choose another Run, or a Run record to replay, in its list), a button “Bots” (start N Runs of a Bot with their maximum total cost, stop the shown Run), the cost with its limit, the Stuck counter, the Model calls, the badges, the money, the map and the time."],
        ["Replay", "a hover on the button next to the Run shows the facts of the Run record, with the number of its Game events."],
        ["Screen controls", "pause, the speeds from ×1 to ×16 and Max, the overlay with its legend on a hover, the sound and its volume, the savestate, the Starting save, and the keys on a hover."],
        ["Decision line", "the last action of the Bot; a hover shows the answer of the call."],
        ["Whole map", "the canvas, with the Exits and “What can stop you” at its right (a click on an exit shows its map, a click on a trainer or a trigger centres the map on it), a search of the maps, and the data of a cell in a card at the pointer."],
        [
          "Model",
          "the Model calls with the flags of the Unusual calls (unreadable, impossible, Reflection, Review, expensive, more turns, new Mission, repeated) and a filter chip for each flag. One call in full: the answer (with the sentences that a Review turn removed), what it played, the cost, then the blocks of its prompt, in colors, that fold.",
        ],
        [
          "Stats",
          "the Run for a video, in large numbers: the time, the cost, the Stuck counter and the prompt tokens at the cursor, what happened since the last heal, the latest Game events, then the chapters (up to each Milestone), the Areas and the charts of the cost, the Stuck counter and the prompt tokens, and the counts of the selection (heals, purchases, money spent, catches, fainted Pokémon of the player, trainers beaten, whiteouts, Unusual calls).",
        ],
        ["Stats selection", "a click on a chapter or an Area selects it, and the stats and the charts follow it; a drag on a chart selects a range; “−2 h” shows the 2 hours before the cursor in the charts; “Whole Run” selects the whole Run again and returns the cursor to now. The Model calls of the selection and their actions fold under the stats."],
        ["Memory tree", "the tree at the cursor, one node at a time: the top nodes as the model sees them, and “(removed)” on a node with no sentence left; a click opens a node, its two halves and the Summary call that made it (its prompt and answer). A tab lists the Summary calls of the selection."],
        ["Bag and PC", "the five pockets of the Bag with their items (quantity and description), the items of the PC and the Pokémon of the boxes at the cursor, and the changes of the Bag and the PC with their times; a click on a change goes to it."],
        [
          "Timeline",
          "the Game events of the Run as icons on one track (Milestones, fainted Pokémon, new Pokémon, evolutions, trainer battles, heals, new places, and as options the levels, wild battles, purchases and items got), with a chip for each kind. A hover shows the events, a click goes to a frame (in a replay, the screen jumps to it), a drag selects a range.",
        ],
        ["Cursor", "one cursor (a frame) and one selection (a range of frames) for all the panels: a click on a Model call or on the Timeline moves them, Esc returns them to now."],
        ["Toast", "at each notice and each new Milestone."],
        ["Doc", "the fourth tab: 14 short pages in 3 groups, in a side list; the page is in the URL (`?doc=<page>`), and each page ends with Details."],
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
          <DocCard icon={ListTree} title="Memory tree" lines={["the top nodes at the cursor, with a mark when the model sees them", "a click opens a node and its Summary call"]} />
          <DocCard icon={Backpack} title="Bag and PC" lines={["the five pockets, the PC and its boxes at the cursor", "the changes, with their times"]} />
          <DocCard icon={Shapes} title="Components tab" lines={["the design system (ADR 0004)", "each component in all its states"]} />
        </div>
      </Block>
    </Page>
  );
}

const SHOT = "block h-auto w-full rounded-card border border-line";

export function GridPage() {
  return (
    <Page
      lead="2, 4 or 9 Runs at the same time, each in its own cell: a live Run, or a replay of a Run record."
      details={[
        ["Game time", "the frames of the game as h:mm:ss, with the battles in it and the waits for the model out of it."],
        ["End of a replay", "a replay at its last frame stays on it and shows its Run result, and the others go on. The cursor stops at the end of the longest replay."],
        ["Click on a cell", "a live Run becomes the shown Run. A replay plays in the Lab tab, at the frame of the Grid cursor."],
        ["Places", "the 9 places are for the Runs of the Bots and the replays of the Grid together, and the bar gives the free places. A start past the free places gets a notice."],
        ["Cost", "the form “Bots” shows the maximum total cost of its N Runs. Each Run keeps its own cost limit."],
        ["Smaller Grid", "a replay in a cell that goes away leaves the Grid."],
        ["Reload", "the Grid does not keep its replays when the last page closes. The live Runs fill it again."],
        ["Errors", "a worker that fails, or a Run record of another origin, shows its error in its cell."],
        ["Lab tab only", "the panels, the Timeline, the keyboard, the speed and the savestate are for the shown Run. The Grid has no sound, and the arrow keys scroll the page."],
        ["Screens", "the page asks only for the Runs of its cells, and only while the tab shows. A screen goes out only when its frame changed. A Grid of 9 gets 30 screens a second, the others 60."],
      ]}
    >
      <img src={viewerGrid} alt="The Grid tab with 4 replays of Run records" class={SHOT} />
      <div class={BLOCKS2}>
        <Block label="🧩 One cell">
          <Terms
            rows={[
              ["Screen", "the game of the Run; dim when it waits for the model or when the Run ended"],
              ["Kind", "live or replay"],
              ["State", "plays, waits for the model, in battle, or ended with its Run result"],
              ["Facts", "the name, the Bot, the model, the game time, the last Milestone, the cost"],
              ["Click", "shows the Run in the Lab tab, with a bar “← Grid” to go back"],
            ]}
          />
        </Block>
        <Block label="📥 Fill the Grid">
          <Terms
            numbered
            rows={[
              ["Size", "choose 2, 4 or 9 cells"],
              ["Bots", "the form “Bots” starts N Runs of a Bot with one action"],
              ["Live Runs", "they fill the free cells: first those that play, then those that ended"],
              ["Run records", "an empty cell lists them, and the button “Record” replaces what a cell holds"],
              ["Replay", "a live Run that ended can replay its record in its cell"],
            ]}
          />
        </Block>
      </div>
      <Block label="⏱️ One cursor for the replays" sub="All the replays start at frame 0 together, so they race on their game time.">
        <div class={GRID3}>
          <DocCard icon={SlidersHorizontal} title="Controls" lines={["play and pause for all the replays", "×1, ×4 or ×20, and one slider"]} />
          <DocCard icon={MonitorPlay} title="A later replay" lines={["it goes to the frame of the cursor", "it replays in a worker, with no sound"]} />
          <DocCard icon={Play} title="A live Run" lines={["it has no shared cursor: its cell shows its own last frame", "it stops while its game waits for a Model call"]} />
        </div>
      </Block>
    </Page>
  );
}

export function RacePage() {
  return (
    <Page
      lead="Many Run records on a map of Kanto, with no emulator. Each Run is a Ghost, and all the Ghosts start at frame 0."
      details={[
        ["Race file", "the track of each Run on one game time, with its battles, its trainers, its Milestones and its Run result. A Race file of an older version must be made again."],
        ["Choice of records", "a record is a file name, or the start of one file name (`00012`). With no record named, the command takes all the records of the model bots. A record with an empty track stays out, and a record of another Bot is refused."],
        ["Continued Run", "a Continued Run replays all of its parent, so a Run that another Run of the Race continues has no Ghost. The command names the records that stay out."],
        ["Leader", "the Ghost with the most Milestones at this frame. On a tie, the first to reach them."],
        ["World", "the maps and the tiles come from the ROM, with no emulator. The ROM has no connections for the real Saffron City, so the map uses the place of its stand-in."],
        ["Hover on a door", "the first 3 interiors, each with its count of Ghosts."],
        ["Hover on Ghosts", "the Run, its map and its state (plays, wild battle, trainer battle and the name of the trainer, or its result), or the numbers of the Runs for a group."],
        ["Counts", "in a wide window, the bar gives the Ghosts, those in battle, those inside and those that ended."],
        ["Keyboard", "it does not play in this tab. The Race draws only while its tab shows."],
      ]}
    >
      <img src={viewerRace} alt="The Race tab: Ghosts on Route 2, Viridian Forest and Viridian City, and a drawer of the interiors" class={SHOT} />
      <div class={BLOCKS2}>
        <Block label="🏁 Make a Race">
          <Terms
            numbered
            rows={[
              ["`bun run migrate`", "once: it adds the track to the old Run records"],
              ["`bun run race <name> [records…]`", "it writes `races/<name>.json.gz`"],
              ["Race tab", "choose the Race in the list of the bar"],
            ]}
          />
        </Block>
        <Block label="👻 A Ghost">
          <Terms
            rows={[
              ["Sprite", "the player, with the number of its Run"],
              ["Crown", "on the leader of the Race"],
              ["Battle", "an icon next to its number while it fights"],
              ["End", "see-through, with an icon of its result next to its number"],
              ["Click", "selects it: a ring around it, and its name"],
            ]}
          />
        </Block>
      </div>
      <Block label="🗺️ On the map">
        <div class={GRID3}>
          <DocCard icon={Gauge} title="Time" lines={["play and pause, ×1 to ×200", "a slider of game time"]} />
          <DocCard icon={Camera} title="Camera" lines={["it frames the Ghosts that still play, until a wheel or a drag", "the button “Frame the Ghosts” gives it back"]} />
          <DocCard icon={DoorOpen} title="Doors" lines={["a count tells how many Ghosts are inside", "a hover shows the interiors, a click opens the building on the map"]} />
          <DocCard icon={PanelRightOpen} title="Drawer" lines={["“Interiors in play”: only those where a Run still plays", "the interiors with the most Ghosts come first"]} />
          <DocCard icon={Trophy} title="Gyms" lines={["each gym shows its badge"]} />
        </div>
      </Block>
    </Page>
  );
}
