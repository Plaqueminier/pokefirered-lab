import { Bot, ChevronRight, Cpu, Eye, Repeat } from "lucide-preact";
import { createContext } from "preact";
import { useContext } from "preact/hooks";
import type { BotInfo } from "../src/protocol";
import { Card, LABEL, Pill } from "./components";
import { type Readable, useStore } from "./cursor";
import { MemoryDiagram } from "./doc-diagrams";
import { Block, BLOCKS2, DocCard, GRID2, GRID3, Page, Pills, Terms } from "./doc-parts";

/** The Bots of the server, from its message `bots`. */
export const BotsContext = createContext<Readable<BotInfo[] | null> | null>(null);

function useBots(): BotInfo[] | null {
  const store = useContext(BotsContext);
  if (!store) throw new Error("BotsPage needs a BotsContext");
  return useStore(store);
}

export function BotsPage() {
  const bots = useBots();
  return (
    <Page
      lead="A Bot decides what to do, and acts only through the Harness."
      details={[
        ["model", "plays past the first rival battle, to the cost limit, a user stop, a whiteout, an unknown screen or `badge-8`. At each Decision point, it asks an AI model for the action (a Model call). The code reads the texts alone."],
        ["starter", "the scripted bot is a tool for the tests of the Harness only: it is not in the list."],
        ["The list", "comes from the server: each module of `bots/`, with its kind, version and goal, or the error of a module that does not load."],
      ]}
    >
      <div class={GRID2}>
        <DocCard icon={Bot} title="model" lines={["asks an AI model for the action at each Decision point (a Model call)", "the code reads the texts alone", "plays to the cost limit, a user stop, a whiteout, an unknown screen or `badge-8`"]} />
        <DocCard icon={Cpu} title="starter (scripted)" lines={["a tool for the tests of the Harness only", "not in the list"]} />
      </div>
      <Block label="🤖 The Bots of the server">
        {bots === null ? (
          <span class="text-sm text-faint">loading…</span>
        ) : (
          <div class="flex flex-wrap gap-2">
            {bots.map((bot) => (
              <Card key={bot.name} size="sm">
                <div class="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                  <b class="font-semibold text-fg">{bot.name}</b>
                  {"kind" in bot ? (
                    <>
                      <Pill>{bot.kind}</Pill>
                      <span class="text-muted">version {bot.version}</span>
                      <span class="text-muted">goal {bot.goal ?? "none"}</span>
                    </>
                  ) : (
                    <span class="text-bad">does not load: {bot.error}</span>
                  )}
                </div>
              </Card>
            ))}
          </div>
        )}
      </Block>
    </Page>
  );
}

const PROMPT_PARTS = [
  ["Rules", "the goal, the rules, a short generic Guide"],
  ["Milestones", "the ones reached, and the next one: a name and a place"],
  ["Mission", "the story step, kept until it is reached"],
  ["Memory tree", "the top nodes; `zoom` opens a node"],
  ["The game waits for", "a walk, a choice, a battle action…"],
  ["Objective", "what the model does now"],
  ["Stuck counter", "the Decision points since the last progress"],
  ["Tries", "the tries since the last progress, with their results"],
  ["Last decisions", "with the texts of the game"],
  ["Events", "the important events, which ask for a note"],
  ["Party, money, Bag", "as the Summary screen and the Bag show them"],
  ["The screen", "the part of the Decision point, and its actions"],
] as const;

const ANSWER = [
  ["action", '"goTo 20 45"', "one action of the screen"],
  ["reason", '"The unseen area west…"', "why, in one or two sentences"],
  ["mission", '"Reach Pewter City…"', "the story step, kept until it is reached"],
  ["objective", '"Explore the unseen area…"', "what the model does now"],
  ["note", '""', "a new note of the Memory tree, or empty"],
] as const;

// A copy of the actions of the model bot at each screen: change it with them.
const SCREENS = [
  { title: "🚶 Walk", adds: ["Known world: one line for each town, city or route visited", "the map as a grid: `?` not seen, a letter is a target"], actions: ["go", "goTo", "swap", "use", "viewAtlas", "zoom", "press"] },
  { title: "❓ Choice", adds: ["the question and the options: “Choose YES or NO.”", "for a nickname: “be creative, there is nothing to optimize”"], actions: ["choose", "zoom"] },
  { title: "⚔️ Battle action", adds: ["your Pokémon and the foe: types, status, states", "each fight: effect, STAB, damage % and hits to KO"], actions: ["fight", "switch", "run", "use", "zoom"] },
  { title: "🎯 Move menu", adds: ["the 4 moves, with the same facts as at a battle action", "`press` works here, not at a battle action"], actions: ["fight", "zoom", "press"] },
  { title: "🔁 Party menu", adds: ["the Pokémon that can go into the battle, with their places", "for example after a faint"], actions: ["send", "zoom", "press"] },
  { title: "🛒 Poké Mart", adds: ["the items for sale with their prices", "the items of the Bag that the Mart buys, the money"], actions: ["buy", "sell", "leave", "zoom"] },
  { title: "💾 Item PC", adds: ["the items in the PC and in the ITEMS pocket, with quantities", "1 with no quantity; `leave` returns to the menu of the PC"], actions: ["withdraw", "deposit", "leave", "zoom"] },
  { title: "✏️ Naming screen", adds: ["what the screen names, and the maximum length", "`name` alone keeps the name"], actions: ["name", "zoom"] },
  { title: "📖 Learn a move", adds: ["the new move and the 4 moves: type, power, accuracy, PP", "an HM move cannot be forgotten"], actions: ["forget", "keep", "zoom"] },
];

function AnswerCard() {
  return (
    <Card size="sm">
      <div class="flex flex-col gap-2.5">
        {ANSWER.map(([key, value, text]) => (
          <div key={key} class="flex min-w-0 flex-col">
            <span class="flex min-w-0 gap-2 font-mono text-sm">
              <span class="w-[10ch] shrink-0 text-info">{key}</span>
              <span class="min-w-0 truncate text-warn">{value}</span>
            </span>
            <span class="pl-[calc(10ch+0.5rem)] text-xs text-muted">{text}</span>
          </div>
        ))}
      </div>
    </Card>
  );
}

export function PromptPage() {
  return (
    <Page
      lead="At each Decision point, the model bot sends one prompt to its AI model and reads one action in the answer."
      details={[
        ["Model call", "at each walk, choice, battle action or move, in the party menu, at the shop menu of a Poké Mart, at the item PC, at the naming screen and when a Pokémon must forget a move to learn a new one."],
        ["Answer", "an action, its reason, the Mission (the story step, kept until it is reached) and the Objective (what the model does now) (ADR 0003)."],
        [
          "Each prompt",
          "the Milestones and the next one (a name and a place only), the Mission, the top nodes of the Memory tree, what the game waits for, the Objective, the stuck counter, the tries since the last progress, the last decisions with their texts, the important events, the party, the money and the Bag. Then the part of the Decision point: at a walk, the Known world and the extract of the Atlas.",
        ],
        [
          "Known world",
          "one line for each town, city or route that the player visited (the map type of the ROM), first visit first. The code makes it from the Atlas: the edges seen (with the destination, “not visited” or blocked), the passages through a gate, a forest or a cave to another outdoor map, the buildings entered, the doors not entered, the unseen cells left and the fixed obstacles.",
        ],
        ["Walk", "an extract of the Atlas: the current map and the texts of its people in full, 1 500 characters for the other maps. The map is a grid of all its rows: `?` is a cell not seen, a letter is a target (`go B`)."],
        [
          "Targets",
          "in groups (exits, unseen cells, people and signs, far maps), each with its distance and direction, and the marks talked (with the last text of the person), read or taken. A trainer that the player did not beat yet has the mark “a trainer that you did not beat yet: a talk starts a battle”. The extract also lists the edges to other maps. When a person moves during a `go`, the code finds the person and walks again (2 times at most).",
        ],
        [
          "Guide",
          "short generic advice in the rules, with no facts about the maps or the story. Read the signs and talk to the people. Write guesses in the notes and check them. Keep the POTIONS for when they are necessary. Use more than one Pokémon and make a balanced team. `run` from a wild battle that goes badly. Compare the levels before a trainer, and train when the trainers ahead are stronger. To train a weak Pokémon, put it first with `swap`, then `switch` to a strong one when the battle is difficult. Each Pokémon Center has a PC: it keeps the items, and the Pokémon caught with 6 Pokémon in the party; the model cannot take a Pokémon from it yet. For a name or a nickname, choose freely: keep the name of the game, or give a serious or funny name.",
        ],
        ["`viewAtlas`", "the full Atlas, one time at most at each Decision point. No frames run."],
        [
          "Choice",
          "one line with the question and the options, for example `The game asks: \"Do you want to give a nickname to this BULBASAUR?\" Choose YES or NO.` For a nickname, the line adds `A nickname has no effect on the game: be creative, there is nothing to optimize.` A `zoom` or a `viewAtlas` does not hide the question. The actions are `choose <option>` and `zoom`, also in a battle. At the menu of the PC of a Pokémon Center, one more line tells that the PC with the name of the player has ITEM STORAGE, and that the Pokémon storage is not possible yet.",
        ],
        ["Battle: own", "in a wild battle, one line after the foe tells how many Pokémon of its species the player owns, in the party and in the PC: `You own 2 PIDGEY: 1 in the party, 1 in the PC.` or `You own no PIDGEY.`"],
        [
          "Battle: damage",
          "each `fight` shows its effect on the foe (×2, ×½, ×0), STAB and the damage estimate: the formula of the game with no critical hit, random factor 85% to 100%, in percent of the foe HP and in hits to KO. No estimate for a move with no power. A move with fixed damage (SEISMIC TOSS, DRAGON RAGE…) shows its effect only. Abilities, held items and weather are not in it.",
        ],
        ["Battle: turns", "the line `Last turn: …` tells who moved first, the moves, their results (critical hit, miss) and the HP before and after. `Your moves on this foe: …` lists the moves already used on this foe, with their results. Both sides show their states after their status (`States: seeded, confused.`)."],
        [
          "Battle: no effect",
          "a move with no PP shows `No PP: you cannot use it.` and no estimate. A move that does no damage tells why it cannot have an effect on the foe now, only when the facts make it sure (`No effect: the foe is a POISON type.`, `No effect: the foe already has a status.`, `No effect: the foe is already seeded.`), from the `EFFECT_*` of the move: types, status, states and stat stages at -6 or +6.",
        ],
        [
          "Battle: PP",
          "when all the damage moves together have a quarter of their PP or less, one line tells that they have few PP. The rules tell that a move that does no damage can help when it has an effect on this foe, mostly when the PP of the damage moves are low. When no move has PP, one line tells that `fight 0` uses STRUGGLE (NORMAL, power 50), and the Pokémon loses 1/4 of the damage that it does.",
        ],
        ["`use`", "at a walk: a medicine on a Pokémon, or REPEL, SUPER REPEL, MAX REPEL and ESCAPE ROPE alone. The Bot also reads `use POTION 1 SQUIRTLE`, with no `on`."],
        [
          "<Pokémon>",
          "the party list gives the place of each Pokémon (`1. IVYSAUR`), and each line of `switch`, `send`, `use` and `swap` lists its Pokémon with their places (`2 CATERPIE, 3 CATERPIE`). The Bot reads a place, a name, or both (`CATERPIE (position 2)`, `CATERPIE 2`, `2 CATERPIE`). With both, the Pokémon at this place must have this name. A name that two Pokémon have needs the place.",
        ],
        ["Shop menu", "the items for sale with their prices, the items of the Bag that the Mart buys, and the money. The actions are `buy <item> <quantity>`, `sell <item> <quantity>` and `leave`. The code does all the menus of the Mart."],
        [
          "Item PC",
          "the items in the PC and the items of the ITEMS pocket of the Bag, with their quantities. The actions are `withdraw <item> [quantity]`, `deposit <item> [quantity]` (1 with no quantity) and `leave` (back to the menu of the PC). The code does the lists and the quantity.",
        ],
        ["Naming screen", "what the screen names and the maximum length. The actions are `name <text>`, and `name` alone to keep the name. The model is free to give a nickname."],
        [
          "Learn a move",
          "“SQUIRTLE wants to learn BUBBLE (WATER, power 20, accuracy 100, PP 30/30).” with the description of the move, then “It already knows 4 moves. To learn BUBBLE, it must forget one of them:” and the 4 moves. The actions are `forget <move>` (a name, or the place 1 to 4) and `keep`. An HM move says that it cannot be forgotten. The code does all the menus.",
        ],
        [
          "`press`",
          "only at a walk, at the move menu of a battle and in the party menu, never at a battle action, a choice, the shop menu, the item PC, the naming screen or a move to forget. It has no Start: the model bot does not know the Start menu. The reason of a `press Start` answer tells to `use <item>`, with the items that work now, or that the Bag is empty.",
        ],
        ["Forms of an action", "a call is read too: `press(Up)` is `press Up`, `use(POTION, SQUIRTLE)` is `use POTION on SQUIRTLE`. A comma between the arguments is a space: `goTo 9, 42` is `goTo 9 42`. The commas of `choose` and `name` stay in the text."],
        ["Impossible action", "the same conversation continues with the reason of the Harness and the exits of the map (3 times at most). For an answer that the Bot cannot read, the reason gives the form of the action and one example."],
        ["Word screen", "when the Harness left the word screen of a profile, the last decisions add one line: the program left it, a profile gives nothing in the game, and the model must choose NO when a person asks for its profile."],
        ["Blocked edge", "an edge with water between the two maps: only SURF crosses it. The extract and the full Atlas say “you cannot go there now” with the reason, the edge is not a target, and a `goTo` past it gives the same reason. A `goTo` past an edge cell that leads to a blocked cell of the next map is impossible too: it tells to cross at another cell."],
        ["Fixed obstacle", "the cut tree, the rock of ROCK SMASH and the boulder of STRENGTH: not people. Their cell is blocked, and `goTo` never waits for them. A `goTo` that only a fixed obstacle stops is impossible at once, and the reason names the obstacle, its cell and the move. The extract and the full Atlas list them with the move and no letter."],
      ]}
    >
      <div class="grid grid-cols-1 gap-4 @4xl:grid-cols-[1fr_auto_1fr] @4xl:items-center @4xl:gap-5">
        <div class="flex min-w-0 flex-col gap-2">
          <span class={LABEL}>📥 The prompt</span>
          <Card size="sm">
            <Terms numbered rows={PROMPT_PARTS} />
          </Card>
        </div>
        <div class="flex flex-col items-center gap-1 text-faint">
          <Bot size={28} class="text-accent" />
          <span class="text-xs">AI model</span>
          <ChevronRight size={20} class="rotate-90 @4xl:rotate-0" />
        </div>
        <div class="flex min-w-0 flex-col gap-2">
          <span class={LABEL}>📤 The answer (ADR 0003)</span>
          <AnswerCard />
        </div>
      </div>
      <Block label="🎮 Each screen" sub="The prompt ends with the part of the screen and the actions that work there.">
        <div class={GRID3}>
          {SCREENS.map((screen) => (
            <DocCard key={screen.title} title={screen.title} lines={screen.adds} chips={screen.actions} />
          ))}
        </div>
      </Block>
      <Block label="⚠️ When the answer is wrong">
        <Terms
          rows={[
            ["Unreadable answer", "the same conversation continues: the reason gives the form of the action and one example."],
            ["Impossible action", "the same conversation continues with the reason of the Harness and the exits of the map, 3 times at most; then a new prompt."],
            ["Other forms", "`press(Up)` is `press Up` · `use(POTION, SQUIRTLE)` is `use POTION on SQUIRTLE` · `goTo 9, 42` is `goTo 9 42`"],
            ["<Pokémon>", "a place, a name, or both: `2`, `CATERPIE`, `2 CATERPIE`. A name that two Pokémon have needs the place."],
          ]}
        />
      </Block>
      <div class={GRID3}>
        <DocCard title="📘 Guide in the rules" lines={["read the signs, talk to the people", "write guesses in the notes, and check them", "keep the POTIONS; make a balanced team", "run from a wild battle that goes badly", "compare the levels before a trainer"]} />
        <DocCard title="🌊 Blocked edge" lines={["water between two maps: only SURF crosses it", "not a target; a `goTo` past it is impossible, with the reason"]} />
        <DocCard title="🪨 Fixed obstacle" lines={["a cut tree, a rock, a boulder: not people", "a `goTo` that only it stops is impossible at once, with the move"]} />
      </div>
    </Page>
  );
}

const PROGRESS = ["new map", "new Milestone", "new exit", "level up", "new text of a person", "trainer beaten", "item found", "new species caught"];
const NOTE_EVENTS = ["new map", "lost battle", "heal", "new item", "a battle with a problem in the party", "2 impossible actions in a row"];

export function ProgressPage() {
  return (
    <Page
      lead="The model bot counts the Decision points with no progress, and stops to think at fixed times."
      details={[
        ["Stuck counter", "the Decision points since the last progress (`harness.noProgress.stuck`). Each Macro-action or Raw input that ends at a Decision point adds 1, also when it is impossible, and also in a battle. Progress makes it 0 again. The prompt shows it at each call; `noProgressLimit` ends a Run on it."],
        ["Progress", "a new map, a new Milestone, a new exit in the Atlas (a warp or an edge seen for the first time), a level up, a new text of a person, a trainer beaten, an item found (an item ball or a hidden item), or a new species caught (owned in the Pokédex). A text heard before from the same person and a new cell are not progress."],
        ["Reflection turn", "the first walk or battle action at 20 on the stuck counter, then at 40, 60… A normal Model call, with an instruction: read the Memory tree (and at a walk the full Atlas, after the extract), zoom freely, write a lesson in `note` (what failed, why, what next) and set a new `objective`. No `viewAtlas` there."],
        [
          "Review turn",
          "the first walk after 20 decisions (Model calls that played an action) since the last Review or Reflection turn, also with progress. A normal Model call, with the full Atlas after the extract and a short check: the way to the next Milestone, the facts against the Mission, the guesses from the signs and the people, the exits left to explore, the team (levels, HP, status, PP). The model writes the result in `mission`, `objective` and `note`. When a Reflection turn and a Review turn are both due at the same decision, only the Reflection turn shows. No `viewAtlas` there.",
        ],
        [
          "Events that ask for a note",
          "since the last Model call: a new map, a lost battle, a heal (all HP full again with no battle and no item use; the line names the map and the last person talked to), a new item, a battle that ended with a problem in the party (less than half of the HP, a status, a quarter of the PP or less; one line with each problem), 2 impossible actions or more in a row. One line “Something important happened: …” each, then “Write a note if it can help you later.” The model decides.",
        ],
        ["Loop warning", "when the last 3 decisions that played an action played the same actions with the same results, the prompt adds one line “Warning: …” after the tries since the last progress. A `zoom` or a `viewAtlas` does not count."],
        ["Notes", "a fact that the game proved, a lesson (what works, what fails and why), a guess that starts with “Guess:”, or the advice of a person that helps later (“A person said: you can never have too many Poké Balls”). When a note becomes false or ends (a guess disproved, a person that moved, a trainer beaten), the model writes a new note that says so. Never HP values."],
        ["Run record", "each Model call has `stuck`, `reflection` and `review`. The panel “Model” shows `reflection` and `review` as flags, and `stuck` as a chip of the shown call."],
      ]}
    >
      <div class={BLOCKS2}>
        <Block label="📈 Stuck counter">
          <Terms
            rows={[
              ["+1", "at each action that ends at a Decision point, also impossible, also in a battle"],
              ["0", "at progress"],
              ["Prompt", "shows it at each call; `noProgressLimit` ends a Run on it"],
            ]}
          />
        </Block>
        <Block label="✅ Progress">
          <Pills>
            {PROGRESS.map((kind) => (
              <Pill key={kind} tone="ok">
                {kind}
              </Pill>
            ))}
          </Pills>
          <span class="text-sm text-faint">Not progress: a text heard before, a new cell.</span>
        </Block>
      </div>
      <div class={GRID2}>
        <DocCard icon={Repeat} tone="warn" title="Reflection turn" lines={["when: the stuck counter at 20, 40, 60…, at a walk or a battle action", "reads the Memory tree (and the full Atlas at a walk)", "writes a lesson in `note` and a new `objective`"]} />
        <DocCard icon={Eye} title="Review turn" lines={["when: the first walk after 20 decisions since the last Review or Reflection", "the full Atlas and a short check: the way, the facts, the guesses, the exits, the team", "writes `mission`, `objective`, `note`"]} />
      </div>
      <div class={BLOCKS2}>
        <Block label="📝 Events that ask for a note" sub="One line “Something important happened: …”. The model decides.">
          <Pills>
            {NOTE_EVENTS.map((kind) => (
              <Pill key={kind}>{kind}</Pill>
            ))}
          </Pills>
        </Block>
        <Block label="🗒️ A good note">
          <Terms
            rows={[
              ["Fact", "the game proved it"],
              ["Lesson", "what works, what fails, and why"],
              ["Guess", "starts with “Guess:”"],
              ["Advice", "of a person, when it helps later"],
              ["Never", "HP values"],
            ]}
          />
        </Block>
      </div>
      <Block label="🔁 Loop warning">
        <p class="m-0 text-sm text-muted">The last 3 decisions played the same actions with the same results: the prompt adds one line “Warning: …”.</p>
      </Block>
    </Page>
  );
}

export function MemoryPage() {
  return (
    <Page
      lead="The memory that the model writes itself: one short note at a time, merged in summaries."
      details={[
        ["Note", "the model adds a note after an important event or a lesson."],
        ["Summary call", "merges two nodes of the same size. It drops a fact that a later note makes false or ends, and keeps the later fact. A summary that is too long ends at its last full sentence."],
        ["Size", "a node of 2^k notes has 200 × (k + 1) characters at most, with the newest facts first."],
        ["`zoom <a-b>`", "opens a node: its two halves, down to the notes."],
        ["Cost", "a Summary call counts in the cost of the Run."],
      ]}
    >
      <Card>
        <div class="overflow-x-auto">
          <div class="min-w-[560px]">
            <MemoryDiagram />
          </div>
        </div>
      </Card>
      <div class={BLOCKS2}>
        <Block label="🌱 How it grows">
          <Terms
            numbered
            rows={[
              ["Note", "the model adds one after an important event or a lesson"],
              ["Summary call", "two neighbour nodes of the same size get a parent"],
              ["Size", "a node of 2^k notes: 200 × (k + 1) characters at most"],
              ["Order", "the newest facts first; a fact that a later note ends is dropped"],
            ]}
          />
        </Block>
        <Block label="👁️ What the model sees">
          <Terms
            rows={[
              ["Top nodes", "in each prompt"],
              ["`zoom a-b`", "opens the two halves of a node, down to the notes"],
              ["Cost", "a Summary call counts in the cost of the Run"],
            ]}
          />
        </Block>
      </div>
    </Page>
  );
}
