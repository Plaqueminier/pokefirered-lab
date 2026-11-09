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
        ["model", "plays past the first rival battle, to the cost limit or the Token limit, a plan limit, a user stop, a whiteout, an unknown screen or `badge-8`. At each Decision point, it asks an AI model for the action (a Model call), except when a walk continues after a wild battle. The code reads the texts alone."],
        ["Model provider", "who answers the calls of a Run: `openrouter` (the default, it bills each call), or a Plan provider, `claude-code` or `codex`, which uses a subscription. The page “Model providers” tells how to use them."],
        ["starter", "the scripted bot is a tool for the tests of the Harness only: it is not in the list."],
        ["The list", "comes from the server: each module of `bots/`, with its kind, version and goal, or the error of a module that does not load."],
      ]}
    >
      <div class={GRID2}>
        <DocCard icon={Bot} title="model" lines={["asks an AI model for the action at each Decision point (a Model call), except when a walk continues after a wild battle", "the code reads the texts alone", "plays to its limit, a user stop, a whiteout, an unknown screen or `badge-8`"]} />
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

export function ProvidersPage() {
  return (
    <Page
      lead="A Run can use a subscription in place of OpenRouter: Claude Code, Codex or Grok then answer each Model call, and a Token limit replaces the cost limit."
      details={[
        ["Why", "OpenRouter bills each Model call, and the user already pays for the subscriptions (ADR 0005). OpenRouter stays the default: it has the widest choice of models and it gives a real cost."],
        ["Rules of the subscriptions", "the help of Claude tells that `claude -p`, with a login on a plan, uses the limits of the subscription (read in 2026-11). The docs of Codex tell that `codex exec` reuses the saved login, and they recommend an API key for automation. These rules changed during 2026: read them again before many Runs."],
        ["One Run, one provider", "all the Model calls and Summary calls of a Run use the same provider, and the same model or the model and its Coach. A Continued Run can use another provider and another model, and it is a new Run. An Extended Run keeps its provider, its model, its Coach and its id."],
        ["Each call", "one new process of `claude -p`, `codex exec` or `grok --prompt-file`, in a new temporary directory, with no shared context. The Bot still calls the Harness, and the AI model never does (ADR 0003)."],
        ["No API key", "the tool does not get `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `CODEX_API_KEY`, `OPENROUTER_API_KEY` or `XAI_API_KEY`, because each tool bills a key when it finds one. A login with an API key is not accepted: the provider stays disabled."],
        ["No settings", "the tools do not read your settings or your MCP servers, and they keep no session."],
        ["Grok home", "Grok reads `~/.claude` also with its compat settings off. So each call has an empty `HOME`, and the lab has its own `GROK_HOME`, `~/.grok-lab`, with its own login and with no bundled skills. Each call removes its session (ADR 0007)."],
        ["Grok base prompt", "Grok 1.0.70 ignores `--system-prompt-override`. So the system prompt of the Bot goes in an agent file, and the model reads it after a base prompt of Grok of 3,456 characters for software engineering. A difference from a Run on another provider can come from this text."],
        ["One message", "a conversation of a Decision point (the answer of the program after an impossible action) goes in one user message, so each try is a new request."],
        ["Reasoning", "Claude Code and Grok have no level `off`: `off` plays as `low`, and the Run record keeps `low`. Codex plays `off` as `none`."],
        ["Temperature", "a Plan provider refuses `--temperature`, because the tools do not take one."],
        ["Codex tools", "three tools stay in Codex. A call that uses a tool stops at once and counts as a failed request. The Bot asks again, and 3 errors in a row end the Run."],
        ["Grok tools", "a Grok call has no tools, one turn, and a permission mode that refuses a tool."],
        ["Grok models", "`grok-4.5`, `grok-4.6` and `grok-4.7` have the same price for each token (measured in 2026-11), so the default is `grok-4.7`. Grok has no smaller model. `grok-4.7-build-fast` is the same price multiplied by 2."],
        ["Time limit", "a call with no answer ends with an error after 5 minutes (10 minutes on OpenRouter)."],
        ["User stop", "a user stop ends the process of the tool at once."],
        ["Codex version", "`bun install` in `lab/` gives Codex at a fixed version (0.166.0), and the Bot uses this one, not a global `codex`. Claude Code and Grok are the global `claude` and `grok` commands, so they can change when you update them."],
        ["Token limit", "you give it in millions of tokens, and the Run record keeps a number of tokens. It counts the prompt tokens (with the cached tokens) and the completion tokens of all the calls of the Run, also the Summary calls. The Run ends after the call that goes above the limit, so it can use one call more than the limit."],
        ["Quota", "the amount of the quota is not published, and your own work uses the same quota. The Token limit is not a part of this quota: it only stops the Run."],
        ["Measure of the overhead", "one recorded prompt of 5,112 input tokens on OpenRouter took 8,241 through Claude Code and 7,306 through Codex, about 4 s for each call. On Grok, we measured a very small prompt with the schema of a decision: 3,536 input tokens, about 4 s for each call."],
      ]}
    >
      <div class={GRID3}>
        <DocCard title="openrouter" lines={["the default model: `deepseek/deepseek-v4.1-flash`", "bills each call", "limit: a cost in dollars"]} />
        <DocCard title="claude-code" lines={["the default model: `claude-haiku-5-5`", "uses your Claude subscription", "limit: a number of tokens"]} />
        <DocCard title="codex" lines={["the default model: `gpt-5.6-luna`", "uses your ChatGPT subscription", "limit: a number of tokens"]} />
        <DocCard title="grok" lines={["the default model: `grok-4.7`", "uses your grok.com login", "limit: a number of tokens"]} />
      </div>
      <Block label="🔑 1. Log in" sub="In `lab/`. You do this one time. You do not need a global install of Codex.">
        <Terms
          rows={[
            ["Claude Code", "`claude auth login`. To check: `claude auth status` must give `\"authMethod\": \"claude.ai\"`."],
            ["Codex", "`bun install`, then `node_modules/.bin/codex login`. To check: `node_modules/.bin/codex login status` must give `Logged in using ChatGPT`."],
            ["Grok", "`GROK_HOME=~/.grok-lab grok login`. This login is for the lab only. To check: `GROK_HOME=~/.grok-lab grok models` must give `You are logged in with grok.com`."],
          ]}
        />
      </Block>
      <Block label="▶️ 2. Start a Run">
        <Terms
          rows={[
            ["In the Viewer", "button “Bots”, then select the Provider, and write the Token limit in millions of tokens: `0.5` is 500,000 tokens. Empty: 1 million. The Model field shows the default model. The form disables a provider that is not installed or not logged in, and it shows the reason."],
            ["In a terminal", "`bun run bot model --provider codex --token-limit 0.5`"],
            ["Another model", "`bun run bot model sonnet --provider claude-code --token-limit 0.5`"],
            ["Continue", "`bun run bot model --provider codex --continue <Run record>`, or “Start from” in the form. The Token limit counts the new calls only."],
          ]}
        />
      </Block>
      <Block label="📏 3. Choose a Token limit" sub="The measures come from the Runs of versions 13 and 14 on OpenRouter. The values for the Plan providers are estimates: each call adds about 3,100 tokens on Claude Code and 2,200 on Codex. Another model can use more or fewer calls.">
        <Terms
          rows={[
            ["`0.01` (10,000 tokens)", "1 or 2 calls: this checks that the provider works"],
            ["First Pokémon", "about 47 calls: 165k on OpenRouter, 310k on Claude Code, 270k on Codex"],
            ["First rival battle", "about 62 calls: 227k on OpenRouter, 420k on Claude Code, 360k on Codex"],
            ["Pokédex", "about 154 calls: 500k on OpenRouter, 980k on Claude Code, 840k on Codex"],
            ["Badge 1", "about 700 calls: 3.1M on OpenRouter, 5.3M on Claude Code, 4.7M on Codex"],
          ]}
        />
      </Block>
      <div class={BLOCKS2}>
        <Block label="👁️ What changes in the Viewer">
          <Terms
            rows={[
              ["Tokens", "the tokens replace the dollars: top bar, panels “Model” and “Stats”, Grid, Race"],
              ["Cost", "always 0 on a Plan provider, because it means real money"],
              ["Run record", "the provider and the Token limit are in the Bot of the record"],
            ]}
          />
        </Block>
        <Block label="🏁 How the Run ends">
          <Terms
            rows={[
              ["`token limit`", "the Run used its Token limit"],
              ["`plan limit`", "the subscription has no more quota. The Run does not wait: continue it later"],
              ["3 errors in a row", "the same end as on OpenRouter"],
            ]}
          />
        </Block>
      </div>
      <Block label="🛠️ When it does not start">
        <Terms
          rows={[
            ["`zsh: command not found: codex`", "normal: Codex is in `lab/node_modules/.bin/`. Use the full path of step 1."],
            ["`the command codex is not found`", "run `bun install` in `lab/`"],
            ["`the command claude is not found`", "install Claude Code"],
            ["`the command grok is not found`", "install Grok Build"],
            ["`Grok is not logged in for the lab`", "do step 1. Your usual Grok login is not used here."],
            ["`not logged in with a subscription`", "do step 1. The form reads the login at each new connection, so reload the page after you log in."],
            ["`has a token limit, not a cost limit`", "a Plan provider refuses `--cost-limit`; `openrouter` refuses `--token-limit`"],
          ]}
        />
      </Block>
    </Page>
  );
}

const PROMPT_PARTS = [
  ["Rules", "the goal, the rules, a short generic Guide"],
  ["Milestones", "the ones reached, and the next one: a short text, with a name and a place for most of them"],
  ["Memory tree", "the top nodes; `zoom` opens a node"],
  ["Bag, money, party", "as the Summary screen and the Bag show them, with the description of each held item; at a walk, the Pokémon in the boxes when there are some, and one line when a REPEL is active; on an underground map with a REPEL in the Bag and none active, what a REPEL does; after the text that a REPEL stopped, one line when the Bag has another; with a BICYCLE in the Bag, its frames for each cell, and whether the player rides or walks"],
  ["The screen", "the part of the Decision point"],
  ["The game waits for", "a walk, a choice, a battle action…"],
  ["Mission", "the story step, kept until it is reached"],
  ["Objective", "what the model does now"],
  ["Coach advice", "in a Run with a Coach: the last text of each part (Team, Shopping, Progress, Battles), its turn and the decisions since, then what happened since: the heals, the purchases, the items, each give, take and use of an item on a Pokémon or a move, the catches, the levels, the evolutions, the fainted Pokémon, the trainers beaten and the first visits of a map, with the same count of decisions"],
  ["Stuck counter", "the Decision points since the last progress"],
  ["Tries", "the tries since the last progress, with their results"],
  ["Last decisions", "with the texts of the game"],
  ["Events", "the important events, which ask for a note"],
  ["Actions", "the actions of the screen"],
] as const;

const ANSWER = [
  ["character", '"Pastry and old map names. A shy baker…"', "only at the Character turn: the style of the nicknames, then the trainer and its country"],
  ["starter", '"CHARMANDER"', "only at the Character turn: the first Pokémon"],
  ["name", '"Mira"', "only at the Character turn: the name of the trainer, 7 characters at most"],
  ["rival", '"Crumb"', "only at the Character turn: the name of the rival, 7 characters at most"],
  ["advice", '{"team": "Catch a PIDGEY on Route 1, then train it to level 10.", "shopping": "Buy 5 POTIONS.", "progress": "", "battles": "Use WATER GUN on rock types."}', "only at a turn of the Coach (Character, Reflection, Review): what the player must do until the next turn of the Coach, in 4 parts of one or two short sentences; after 200 characters, the program removes the sentences that do not fit; an empty part keeps the last text of this part"],
  ["action", '"goTo 20 45"', "one action of the screen"],
  ["reason", '"The unseen area west…"', "why, in one or two sentences"],
  ["mission", '"Reach Pewter City…"', "the story step, kept until it is reached"],
  ["objective", '"Explore the unseen area…"', "what the model does now"],
  ["note", '""', "a new note of the Memory tree, or empty"],
  ["remove", "[3, 7]", "only at a Review turn: the numbers of sentences to remove from the top nodes"],
] as const;

// A copy of the actions of the model bot at each screen: change it with them.
const SCREENS = [
  { title: "🚶 Walk", adds: ["Known world: one line for each town, city or route visited", "on a floor of a cave, a forest or a large building, What is left: the unseen places and the exits not taken, from the game", "the map as a grid: `?` an unseen cell that an open cell leads to, a blank any other unseen cell, `-` `_` `[` `]` a thin wall, `t` `r` `b` `w` an obstacle or water whose HM is in the Bag or whose move a Pokémon knows, a cut tree or a rock that the party can remove is an open cell, a letter is a target", "on a map where the player saw a spin tile: `→` `←` `↑` `↓` a spin tile, `o` a stop tile, a rule line under the legend, the block Parts of this map, and one more `goTo` line", "with a TM or an HM in the Bag: one line for `teach`, and one line when its Field move can help on this map", "with an item in the Bag that has an effect when a Pokémon holds it: one line for `give`, and with a Pokémon that holds an item: one line for `take`", "on a map that is dark for the model: one line for the dark, and `go` to unseen cells continues in the same direction, then along a wall"], actions: ["go", "goTo", "swap", "use", "teach", "give", "take", "viewAtlas", "zoom", "press"] },
  { title: "❓ Choice", adds: ["the question and the options: “Choose YES or NO.”", "for a nickname: no Model call, the program answers YES"], actions: ["choose", "zoom"] },
  { title: "⚔️ Battle action", adds: ["your Pokémon and the foe: types, status, states", "each fight: effect, STAB, damage % and hits to KO"], actions: ["fight", "switch", "run", "use", "zoom"] },
  { title: "🎯 Move menu", adds: ["the 4 moves, with the same facts as at a battle action", "`press` works here, not at a battle action"], actions: ["fight", "zoom", "press"] },
  { title: "🔁 Party menu", adds: ["the Pokémon that can go into the battle, with their places", "for example after a faint"], actions: ["send", "zoom", "press"] },
  { title: "🛒 Poké Mart", adds: ["the items for sale with their prices and descriptions", "the items of the Bag that the Mart buys, the money"], actions: ["buy", "sell", "leave", "zoom"] },
  { title: "💾 Item PC", adds: ["the items in the PC and in the ITEMS pocket, with quantities", "1 with no quantity; `leave` returns to the menu of the PC"], actions: ["withdraw", "deposit", "leave", "zoom"] },
  { title: "📦 Pokémon PC", adds: ["the Pokémon in the boxes, with a number: species, nickname, level, box", "`deposit` names a Pokémon of the party, `withdraw` a number or a name of the list; no `withdraw` with empty boxes"], actions: ["deposit", "withdraw", "leave", "zoom"] },
  { title: "✏️ Naming screen", adds: ["what the screen names, and the maximum length", "for a nickname, the text must be new; for another name, `name` alone keeps the name"], actions: ["name", "zoom"] },
  { title: "📖 Learn a move", adds: ["the species, the new move and the 4 moves: type, power, accuracy, maximum PP", "for each answer, the damage moves that it leaves", "keep at least 2 damage moves; an important choice: count the damage moves and compare their PP", "an HM move cannot be forgotten"], actions: ["forget", "keep", "zoom"] },
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
      lead="At each Decision point, except when a walk continues after a wild battle, the model bot sends one prompt to its AI model and reads one action in the answer."
      details={[
        ["Model call", "at each walk (except when a walk continues after a wild battle), choice, battle action or move, in the party menu, at the shop menu of a Poké Mart, at the item PC, at the Pokémon PC, at the naming screen and when a Pokémon must forget a move to learn a new one."],
        ["Answer", "an action, its reason, the Mission (the story step, kept until it is reached) and the Objective (what the model does now) (ADR 0003)."],
        ["Stop and time limit", "a user stop ends a Model call at once, and a Model call with no answer after 10 minutes (5 minutes on a Plan provider) ends with an error. Its event then has the error and no cost: OpenRouter gives the cost with the answer only, so the cost limit does not count this call. After the time limit, the Bot asks again, and 3 errors in a row end the Run."],
        [
          "Each prompt",
          "the parts that change little come first, so that the provider caches more of the prompt: the Milestones and the next one (a short text only), the top nodes of the Memory tree, at a walk the Known world, the Bag, the money, the party, at a walk one line of the Pokémon in the boxes when there are some (at a Reflection or Review turn, the items of the PC and the box Pokémon in detail, and at a Review turn the counts of the game), the lines of the REPEL and the line of the BICYCLE, and the part of the Decision point (at a walk, the list What is left on a floor, then the extract of the Atlas). Then what the game waits for, the Mission, the Objective, the Coach advice in a Run with a Coach, the stuck counter, the tries since the last progress, the last decisions with their texts, the important events and the actions. The rule of the first Pokémon stops when the party has a Pokémon.",
        ],
        [
          "Known world",
          "one line for each town, city or route that the player visited (the map type of the ROM), first visit first. The code makes it from the Atlas: the edges seen (with the destination, “not visited” or blocked), the passages through a gate, a forest or a cave to another outdoor map, the buildings entered, the exits not taken with their cells, the number of groups of open cells next to unseen cells (a blank cell does not count) and the fixed obstacles whose HM is in the Bag or whose move a Pokémon knows and that the party cannot remove yet.",
        ],
        ["What is left", "on a map with no edges that does not fit on the screen (a floor of a cave, a forest, a large building), just before the map: one line, when something is left there, for the part of the player, with its nearest unseen place and its letter, for the other parts of the map, for each floor that the exits reach, and for the unseen places of a map with no seen way yet. Each line gives the unseen places (a slide with an unknown end counts as one) and the exits not taken. With no line, one line says that nothing is left and tells the model to take an exit to another map. A last line gives the current map and the map that the player crossed to and from most, from 6 crossings. The program counts from the game, and the title says that this list is right when the Memory tree disagrees."],
        ["Walk", "an extract of the Atlas: the current map and the texts of its people in full, 1 500 characters for the other maps. The map is a grid of all its rows: `?` is an unseen cell that an open cell leads to, a blank is any other unseen cell, a letter is a target (`go B`)."],
        [
          "Targets",
          "in groups (leads, exits, unseen cells, people, objects and things to check, the 8 nearest far maps), each with its distance and direction (a wide exit, with neighbour cells that lead to the same map, is one target; on a map with no edges that does not fit on the screen, the exits, the unseen cells and the people follow the order of their cells so that a letter changes less often, and on the other maps they follow the distance; the leads follow the number of exits, and the far maps the distance), and the marks talked (with the last text of the person), read or taken. An ITEM BALL says that it is a free item that `go` takes, except the starter balls in the Lab of Professor Oak. An exit seen from a town, a city or a route shows the kind of place that a player sees: a Pokémon Center, a Poké Mart, a department store, a Gym, a house, a gate building, a cave entrance, a harbor, a path to another map, or a building for the others. The code reads it from the map where the exit leads, but the name of this map shows only after the player took the exit. From inside, only an entrance shows a place: the outside or a cave entrance. An exit that the player took shows its arrival cell when this cell is known. The exit of an Elevator is one target: “an Elevator, to the floor chosen at the panel”, with the floor where it leads now, read from the game, and the floors known with their arrival cells. It is also one exit in the lines of the other maps and in the full Atlas, and a lead never goes through it, because only a walk from inside it reaches the floor chosen now. An exit to a cave or a building also shows what is beyond it: unseen cells, an exit not taken, or nothing new. A target in another part of the map shows the number of exits to it, not a direction: this count follows the exits that the player took, also through an outdoor map. With no known exits to it, it keeps its direction and says “no seen way there yet”. On a map with spin tiles, the count also has the slides (“1 exit or slide away”), and a target or a lead in another part gives its Part number. The block Parts of this map lists the Part of the player and the Parts that slides reach from it, with numbers that the Atlas keeps while the player sees more cells (a new Part takes the next number, and two Parts that join keep the lower one): the cells and the box of each Part, the marks “(you)” and “(visited)”, and each spin tile next to the Part with the end of its slide and its Part, “taken” for a slide that the player took, or an unknown end when the way goes through an unseen cell. The block never gives a chain of slides to a target. The unseen cells of the part of the player show one target for each group of touching open cells next to unseen cells, at the nearest cell of the group. On a map that is dark for the model, each direction of a group has one target, at the cell nearest to the player. The leads are at most 4: the nearest unseen cells, exits not taken and spin tiles with an unknown end of their slide, in other parts and cave or building maps, and `go` walks to them across the maps. The unseen cells of a room that fits on the screen are no lead. A ? stands only where an open cell that the player saw leads to an unseen cell. Every other unseen cell is blank, so a wall that no open cell leads to adds no sign to the map. The column numbers come again every 10 rows, and the legend lists only the signs of the map. A fixed obstacle and water are # with no text while the Bag has no HM and no Pokémon knows the move; then they are t (cut tree), r (rock), b (boulder) or w (water), and the obstacle has its text. A cut tree or a rock that the party can remove is an open cell. Under the map, a line says when the player saw all the cells of the map, or all the cells of its part and no slide of its part has an unknown end: the player then takes an exit or a lead. A trainer that the player did not beat yet has the mark “a trainer that you did not beat yet: a talk starts a battle”. The extract also lists the edges to other maps. When a person moves during a `go`, the code finds the person and walks again (2 times at most).",
        ],
        [
          "Guide",
          "short generic advice in the rules, with no facts about the maps or the story. Check the signs and other things, and talk to the people. Buy Poké Balls and Potions at a Poké Mart. A REPEL stops wild battles with Pokémon of a lower level than the first Pokémon of the party that has not fainted, for 100 steps (SUPER REPEL 200, MAX REPEL 250): use it to explore without fights, not when the Pokémon need experience. The Poké Mart shows the same text after each REPEL. Take each ITEM BALL that you can reach: it costs only the walk. Write guesses in the notes and check them. Keep the POTIONS for when they are necessary. Use more than one Pokémon, and make a balanced team of 6 step by step. A TM works one time and an HM stays in the Bag; a Pokémon with 4 moves must forget a move to learn a new one, or keep its moves. `run` from a wild battle that goes badly. Compare the levels before a trainer, and train when the trainers ahead are stronger. To train a weak Pokémon, put it first with `swap`, then `switch` to a strong one at the first turn: each Pokémon that was in the battle against a foe, and did not faint, gets an equal part of its experience, also with no move, and the list starts again at each new foe. Each Pokémon Center has a PC: it keeps the items and the Pokémon, and a Pokémon caught with 6 Pokémon in the party goes to a box. At the PC, put a weak Pokémon in a box to make a place before a catch, and take a Pokémon from a box when it suits the next battle. Give a nickname to each Pokémon, in the style of the character and different from the species: it costs nothing, and it tells two Pokémon of the same species apart.",
        ],
        ["`viewAtlas`", "the full Atlas, one time at most at each Decision point. No frames run."],
        [
          "Choice",
          "one line with the question and the options, for example `The game asks: \"Do you want to give a nickname to this BULBASAUR?\" Choose YES or NO.` At the question of a nickname, and at a Poké Ball of Professor Oak, the program answers with no Model call. A `zoom` or a `viewAtlas` does not hide the question. The actions are `choose <option>` and `zoom`, also in a battle. At the menu of the PC of a Pokémon Center, one more line tells that the PC with the name of the player has ITEM STORAGE, and that the first option (SOMEONE'S PC or BILL'S PC) opens the boxes, which keep the Pokémon.",
        ],
        ["Battle: own", "in a wild battle, one line after the foe tells how many Pokémon of its species the player owns, in the party and in the PC: `You own 2 PIDGEY: 1 in the party, 1 in the PC.` or `You own no PIDGEY.`"],
        [
          "Battle: damage",
          "each `fight` shows its effect on the foe (×2, ×½, ×0), STAB and the damage estimate: the formula of the game with no critical hit and no held item, random factor 85% to 100%, in percent of the foe HP and in hits to KO. No estimate for a move with no power. A move with fixed damage (SEISMIC TOSS, DRAGON RAGE…) shows its effect only. Abilities, held items and weather are not in it.",
        ],
        ["Battle: double", "each `fight` also tells what it hits, and shows its effect on each foe (page “Double battle”)."],
        ["Battle: turns", "the line `Last turn: …` tells who moved first, the moves, their results (critical hit, miss) and the HP before and after. `Your moves on this foe: …` lists the moves already used on this foe, with their results. Both sides show their states after their status (`States: seeded, confused.`)."],
        [
          "Battle: no effect",
          "a move with no PP shows `No PP: you cannot use it.` and no estimate. A move that does no damage tells why it cannot have an effect on the foe now, only when the facts make it sure (`No effect: the foe is a POISON type.`, `No effect: the foe already has a status.`, `No effect: the foe is already seeded.`), from the `EFFECT_*` of the move: types, status, states and stat stages at -6 or +6.",
        ],
        [
          "Battle: PP",
          "when all the damage moves together have a quarter of their PP or less, one line tells that they have few PP. The rules tell that a move that does no damage can help when it has an effect on this foe, mostly when the PP of the damage moves are low. When no move has PP, one line tells that `fight 0` uses STRUGGLE (NORMAL, power 50), and the Pokémon loses 1/4 of the damage that it does.",
        ],
        ["`use`", "at a walk and in a battle: an ETHER, a MAX ETHER or a LEPPA BERRY on a move (`use ETHER on 1 CUT`, the Pokémon first and then the move, by its name or its place), and an ELIXIR or a MAX ELIXIR on a Pokémon. With no move or an unknown move, the Harness gives the moves. A Berry goes through the BERRY POUCH. The use line tags each item: `POTION (on a Pokémon)` or `ETHER (on a move of a Pokémon)`. With an item for a move, its form is `[on <Pokémon> [<move>]]`, and it gives one example. At a walk: PP UP and PP MAX on a move; a medicine, a RARE CANDY (one item for each action) or an evolution stone on a Pokémon; or REPEL, SUPER REPEL, MAX REPEL, ESCAPE ROPE and BICYCLE alone. Below the use line, one line for each stone gives what it does: `MOON STONE: 2 NIDORINA becomes NIDOQUEEN.` The rule of the game decides: an Egg and a Pokémon that holds an EVERSTONE are not in it, and with no National Pokédex no evolution goes past number 151. A stone that evolves no Pokémon is not in the use line. The prompt does not show the species of an evolution by level. When the game refuses an item, the action is impossible with the text of the game. B cannot stop an evolution: the Harness removes B during its animation. BICYCLE is a choice that stays: the player rides on each map that allows it, until the next `use BICYCLE`. The model does not choose to run: each walk runs when the player has the Running Shoes. The Bot also reads `use POTION 1 SQUIRTLE`, with no `on`. The Bot refuses `use` on a TM or an HM, and the reason tells to write `teach`."],
        [
          "`teach`",
          "`teach <TM or HM> on <Pokémon>`, at a walk with a TM or an HM in the Bag. Each walk shows one line with the TMs and the HMs of the Bag. The Harness refuses a Pokémon that cannot learn the move or that knows it, with the reason. With 4 moves, the next Decision point is the learn-move question of the game.",
        ],
        ["`give` and `take`", "`give <item> on <Pokémon>` and `take <Pokémon>`, at a walk. The line of `give` lists only the items of the Bag with an effect when a Pokémon holds them, for all species, and the line is not there when the Bag has none. The line of `take` lists each Pokémon that holds an item. The party shows the description of each held item, because it is not in the Bag after a give. The line of `take` does not list a Pokémon that holds Mail. The Harness refuses Mail, a `take` with a full Bag and a swap when the old item has no room, with the reason."],
        [
          "Field move hint",
          "one line for each TM or HM of the Bag whose Field move has its obstacle on the current map: FLASH a map that is dark for the model, CUT a cut tree, ROCK SMASH a rock, STRENGTH a boulder, SURF an edge with water. “Your Bag has HM05 (FLASH). It can help on this map: teach it.”, or “…, but no Pokémon of your party can learn it.” No line when a Pokémon knows the move. The prompt never tells where to find a TM or an HM.",
        ],
        [
          "<Pokémon>",
          "the party list gives the place of each Pokémon (`1. IVYSAUR`), and each line of `switch`, `send`, `use`, `give`, `take` and `swap` lists its Pokémon with their places (`2 CATERPIE, 3 CATERPIE`). The Bot reads a place, a name, or both (`CATERPIE (position 2)`, `CATERPIE 2`, `2 CATERPIE`). With both, the Pokémon at this place must have this name. A name that two Pokémon have needs the place.",
        ],
        ["Shop menu", "the items for sale with their prices and their descriptions from the game, the items of the Bag that the Mart buys, and the money. The actions are `buy <item> <quantity>`, `sell <item> <quantity>` and `leave`. The code does all the menus of the Mart."],
        [
          "Item PC",
          "the items in the PC and the items of the ITEMS pocket of the Bag, with their quantities. The actions are `withdraw <item> [quantity]`, `deposit <item> [quantity]` (1 with no quantity) and `leave` (back to the menu of the PC). The code does the lists and the quantity.",
        ],
        [
          "Pokémon PC",
          "the party, and the list of the Pokémon in the boxes, with a number, the species, the nickname, the level and the box. The actions are `deposit <Pokémon>` (a place or a name of the party), `withdraw <Pokémon>` (a number or a name of the list, and there is no `withdraw` with empty boxes) and `leave` (back to the menu of the PC). A name that two Pokémon have needs the number. A fixed rule of the Harness gives the box of a deposit, and the Harness does the screen of the boxes.",
        ],
        ["Naming screen", "what the screen names and the maximum length. The action is `name <text>`. For a nickname, the text must be new and different from the species. For another name, `name` alone keeps the name."],
        [
          "Learn a move",
          "“Hasp (SQUIRTLE) wants to learn BUBBLE (WATER, power 20, accuracy 100, max PP 30).” with the description of the move, then “It already knows 4 moves. To learn BUBBLE, it must forget one of them:” and the 4 moves with their maximum PP. After each move, “If you forget it: Hasp then has 2 damage moves: TACKLE (NORMAL, max PP 35), BUBBLE (WATER, STAB, max PP 30).”, which counts the new move. Then a line that a Pokémon Center gives back all the PP, the same sentence for `keep`, “Keep at least 2 damage moves when you can: with only one, a foe can resist it and its PP can run out.” and “This is an important choice. Before you choose, count your damage moves and compare their PP.” The Party above the question keeps the PP of the moment. The actions are `forget <move>` (a name, or the place 1 to 4) and `keep`. An HM move says that it cannot be forgotten, in place of the sentence on what it leaves. The code does all the menus.",
        ],
        [
          "`press`",
          "only at a walk, at the move menu of a battle and in the party menu, never at a battle action, a choice, the shop menu, the item PC, the Pokémon PC, the naming screen or a move to forget. It has no Start: the model bot does not know the Start menu. The reason of a `press Start` answer tells to `use <item>`, with the items that work now, or that the Bag is empty or has no item that works now. At a walk with a TM or an HM in the Bag, it also tells to `teach <TM or HM> on <Pokémon>`.",
        ],
        ["Forms of an action", "a call is read too: `press(Up)` is `press Up`, `use(POTION, SQUIRTLE)` is `use POTION on SQUIRTLE`, `use(ETHER, 1, CUT)` is `use ETHER on 1 CUT`, `teach(TM13, 1)` is `teach TM13 on 1`, and `give(ORAN BERRY, 1)` is `give ORAN BERRY on 1`. In the other actions, a comma between the arguments is a space: `goTo 9, 42` is `goTo 9 42`. The commas of `choose` and `name` stay in the text."],
        ["Impossible action", "the same conversation continues with the reason of the Harness and the exits of the map (3 times at most). For an answer that the Bot cannot read, the reason gives the form of the action and one example."],
        ["Word screen", "when the Harness left the word screen of a profile, the last decisions add one line: the program left it, a profile gives nothing in the game, and the model must choose NO when a person asks for its profile."],
        ["Blocked edge", "an edge with water between the two maps: only SURF crosses it. The extract and the full Atlas say “you cannot go there now” with the reason, the edge is not a target, and a `goTo` past it gives the same reason. A `goTo` past an edge cell that leads to a blocked cell of the next map is impossible too: it tells to cross at another cell."],
        ["Part", "the cells of a map that the player can walk to from one cell, on the cells that it saw, with no other map and no spin tile on the way. A slide goes from a Part to another Part of the same map, in one direction only, and the leads and the counts of exits also count the slides. The code makes the parts from the Atlas only. The line of a map one exit away gives, for each part where its exits arrive, the exits of that part. The walk of the leads, of the “beyond it” marks and of these lines stops at an outdoor map, except the map of the player; only the count of exits to a target crosses outdoor maps."],
        ["Thin wall", "an open cell with a wall on one side (`-` north, `_` south, `[` west, `]` east in the grid): no step across that side, in both directions. It can make two parts on one floor, as on B2F of Mt Moon."],
        ["Object", "a graphic of the map that is not a person: a fossil, an item ball, a clipboard, SNORLAX. Its target says “an object that you can interact with”, also when it closes no way; a free ITEM BALL says that `go` takes it. A rule of the prompt tells the model to interact with people, objects and things to check, that an object can be a thing to take, and to come back later when nothing changes."],
        ["Thing to check", "a sign event of the map: the target says “something you can check”, because the same event is a sign, a poster, a trash can, a statue, a door of Silph Co or an elevator panel."],
        ["In your way", "a person or an object whose movement type does not leave its cell, and whose cell closes a way: it joins two groups of seen cells, or it leads to unseen cells that no other seen cell touches. Its target says “in your way”, an unseen target on its cell says “past the …”, and the target, the reason of `blocked` and the rule of the prompt say that the way is closed on the cells that the player saw, and tell the model to interact with it or to look for another way. It comes first among the people of its part. A person behind a counter closes nothing. The rule works for each map, with no facts about the map."],
        ["Last line of a person", "a text that the program reads right after a battle belongs to the person that the player faces, also with no `interact` before it: a script can go on after its battle. The target shows this line."],
        ["Dark map", "the two floors of Rock Tunnel. All this applies at the `player` Knowledge level. In the dark, the Atlas marks only the 3 × 3 cells around the player, also for the people and the fixed obstacles. A Pokémon that knows FLASH and badge 1 make the map a lit map for the model: the program uses FLASH at the arrival and before each walk prompt, with the first Pokémon that knows it, also a Pokémon that fainted. The model gets no action and no text, and the record gets the event `flash`. The game keeps FLASH on the two floors and clears it outside. With no FLASH, the map is dark for the model: one line tells it what the dark means, with no place and no HM number, `goTo` uses only seen cells, each direction of a group of unseen cells has one target at the nearest cell, `go` to this target continues in the same direction, then along a wall while the side of the wall has unseen cells, and a new cell seen is progress."],
        ["Fixed obstacle", "the cut tree, the rock of ROCK SMASH and the boulder of STRENGTH: not people. Their cell is blocked, and `goTo` never waits for them. A `goTo` that only a fixed obstacle stops is impossible at once, and the reason names the obstacle, its cell and the move, or the badge when a Pokémon of the party knows the move. When the Bag has the HM or a Pokémon knows the move, the grid shows their sign and the extract and the full Atlas list them with the move, with no target letter. Before that, they are # with no text. A cut tree or a rock that the party can remove (a Pokémon of the party knows the move, and the player has badge 2 for CUT or badge 6 for ROCK SMASH) is an open cell, in the Parts too: a walk through it, or A in front of it, uses the move, with no question and no text for the model. It returns when the player leaves the map."],
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
      <Block label="🎮 Each screen" sub="Each prompt has the part of the screen, and it ends with the actions that work there.">
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
        <DocCard title="📘 Guide in the rules" lines={["check the signs and other things, talk to the people", "write guesses in the notes, and check them", "keep the POTIONS; make a balanced team", "run from a wild battle that goes badly", "compare the levels before a trainer"]} />
        <DocCard title="🌊 Blocked edge" lines={["water between two maps: only SURF crosses it", "not a target; a `goTo` past it is impossible, with the reason"]} />
        <DocCard title="🧩 Part" lines={["the cells that the player can walk to on one map", "another part shows the number of exits (or slides) to it, or “no seen way there yet”", "the leads keep the unseen cells of the other parts"]} />
        <DocCard title="🧱 Thin wall" lines={["`-` `_` `[` `]`: a wall on the north, south, west or east side of an open cell", "no step across it, in both directions"]} />
        <DocCard title="🔦 Dark map" lines={["3 × 3 cells seen until FLASH", "a Pokémon that knows FLASH and badge 1: the program uses the move, with no Model call", "no FLASH: `goTo` on seen cells only, `go` continues in the same direction, then along a wall, a new cell seen is progress"]} />
        <DocCard title="🪨 Fixed obstacle" lines={["a cut tree, a rock, a boulder: not people", "a `goTo` that only it stops is impossible at once, with the move", "a cut tree or a rock that the party can remove is an open cell: the walk uses the move"]} />
      </div>
    </Page>
  );
}

const PROGRESS = ["new map", "new Milestone", "new exit", "level up", "new text of a person", "trainer beaten", "item found", "new species caught", "new cell seen on a dark map"];
const NOTE_EVENTS = ["new map", "lost battle", "heal", "new item", "a battle with a problem in the party", "2 impossible actions in a row"];

export function ProgressPage() {
  return (
    <Page
      lead="The model bot counts the Decision points with no progress, and stops to think at fixed times."
      details={[
        ["Stuck counter", "the Decision points since the last progress (`harness.noProgress.stuck`). Each Macro-action or Raw input that ends at a Decision point adds 1, also when it is impossible, and also in a battle. Progress makes it 0 again. The prompt shows it at each call; `noProgressLimit` ends a Run on it."],
        ["Progress", "a new map, a new Milestone, a new exit in the Atlas (a wide exit or a warp or an edge seen for the first time, or a new floor of an Elevator), a level up, a new text of a person, a trainer beaten, an item found (an item ball or a hidden item), or a new species caught (owned in the Pokédex). A new cell seen is progress only on a map that is dark for the model. A text heard before from the same person is not progress."],
        ["Reflection turn", "the first walk with a Model call at 20 on the stuck counter, then at 40, 60… A normal Model call, with an instruction: read the Memory tree and the full Atlas (after the extract), zoom freely, write a lesson in `note` (what failed, why, what next) and set a new `objective`. With a TM or an HM in the Bag, it also shows each one, its move, who can learn it, and the question: does it help your Objective? No `viewAtlas` there."],
        [
          "Review turn",
          "the first walk with a Model call after 20 decisions (Model calls that played an action) since the last Review or Reflection turn, also with progress. A normal Model call, with the full Atlas after the extract and a short check: the way to the next Milestone, the facts against the Mission, the guesses from the things checked and the people, the exits left to explore, the team (levels, HP, status, PP), and one line that counts the Pokémon caught, the box Pokémon and the whiteouts so far in the game (a Continued Run counts those of its parent too). With a TM or an HM in the Bag, it also shows each one, its move, who can learn it, and the question: does it help your Objective? The top nodes of the Memory tree show a number before each sentence, and the first answer that the Bot can read can name 5 of them at most in `remove`, or none. The model writes the result in `mission`, `objective` and `note`. When a Reflection turn and a Review turn are both due at the same decision, only the Reflection turn shows. No `viewAtlas` there.",
        ],
        ["Team at the two turns", "a Reflection or Review turn also shows the items in the PC and the box Pokémon in place of the short line of the boxes: the 12 of the highest levels with their types, ability and moves, the others in one line, in groups by species, with their levels, and each description of a move or an ability one time, none that the party shows. The game keeps no HP for a box Pokémon."],
        [
          "Events that ask for a note",
          "since the last Model call: a new map, a lost battle, a heal (all HP full again with no battle and no item use; the line names the map and the last person talked to), a new item, a battle that ended with a problem in the party (less than half of the HP, a status, a quarter of the PP or less; one line with each problem), 2 impossible actions or more in a row. One line “Something important happened: …” each, then “Write a note if it can help you later.” The model decides.",
        ],
        ["Walk after a wild battle", "a `go` or a `goTo` that a wild battle stopped continues after the battle, with no Model call. The model chooses again if a Pokémon fainted in the battle, if a Pokémon has a status, if the first Pokémon that can fight has less than half of its HP or no damage move with PP, if the walk left the map of the decision (except a lead, a far map or a `goTo` with a map), after a `goTo` to a spin tile (a new walk would slide again from the end of the slide), or after a `walkOn` on a dark map. A trainer battle ends the walk."],
        ["Loop warning", "when the last 3 decisions that played an action played the same actions with the same results, the prompt adds one line “Warning: …” after the tries since the last progress. A `zoom` or a `viewAtlas` does not count."],
        ["Notes", "a fact that the game proved, a lesson (what works, what fails and why), a guess that starts with “Guess:”, or the advice of a person that helps later (“A person said: you can never have too many Poké Balls”). When a note becomes false or ends (a guess disproved, a person that moved, a trainer beaten), the model writes a new note that says so. Never HP or PP values. The program removes a sentence with an HP or PP number and a note with nearly the same words as one of the last 32 notes (a number, a negation or “Guess:” in only one of them makes two facts), and it writes “Guess:” before a sentence with a word like “might” or “likely”. It also removes a sentence that says that a place is explored, crossed, exhausted or a dead end, except one that starts with “Guess:” or “A person said:”, and a sentence with nearly the same words as one that a Review turn removed."],
        ["Character turn", "the first Model call of a Run with no Pokémon. The program selects an idea at random from 100 jobs, 12 traits, 33 hobbies and 31 countries with their language (a shy baker who collects old maps, from Japan), and the model writes the first Pokémon in `starter`, a style of the nicknames (the request asks that it mixes the job, the hobby and the language; the nicknames, and the names when the game has none yet, sound like the language, with no accents, and the other answers stay in English) and the trainer in `character` (400 characters at most, then cut), and the two names in `name` and `rival`. A name has 1 to 7 characters from the keyboard of the game, with no space at its start or its end; the program asks again after a bad name. Before the first action, the Run boots again with the names, at the same frame and with the same screen. A continued Run with an action in its parent keeps the names of its game, and the turn tells them to the model. Each later prompt has “Your character: …”, with the names. At a Poké Ball, the program answers with no Model call: YES to this Pokémon, NO to another. The panel “Model” shows the names and the character in a block on each Model call, and “Normal trainer” for a Run with no Character turn. There is no block while a Character turn has no readable answer."],
        ["Thinking", "the Character, Reflection and Review turns use the thinking level of the Run; the other Model calls use the reasoning level of the Run. In a Run with a Coach, all the calls of the Coach use the thinking level, also the summaries and the move to forget, and the player uses only the reasoning level. After an empty answer, when the reasoning took all the tokens, the next calls of the same turn use the reasoning level. The panel “Model” shows the text of the reasoning in a block."],
        [
          "Coach",
          "an option of the Run (`--coach <model id>`, or the Coach field of the form): a second model on the same provider. It plays the Character, Reflection and Review turns, the Summary calls and the choice of a move to forget, at the thinking level of the Run; the model of the Run plays the other decisions. After an empty answer, the next calls of the same turn use the reasoning level of the Run. A Coach with the model of the Run is no Coach. Its calls get their own rules: it is the Coach of a smaller model that follows its advice to the letter but does not plan the team, the shopping or the way. At its Character, Reflection and Review turns, it writes an `advice` in 4 parts: `team` (the most important: Pokémon to catch, to train and to switch with the PC, and the Pokémon that gets a RARE CANDY, an evolution stone or an item to hold), `shopping`, `progress` and `battles` (also when to use an item). Each later prompt shows the last text of each part, for example “- Team (review turn, 3 decisions ago): …”, then what happened since, for example “- 3 decisions ago: you healed at a Pokémon Center.”, and the player treats a step that these facts show as done as done. The panel “Model” shows the advice in force on each call, under the note. Its calls count toward the one limit of the Run, and its plan limit ends the Run. The labels of a Run name both models: `claude-haiku-5-5 + coach claude-opus-5-5`.",
        ],
        ["Run record", "each Model call has `stuck`, `character`, `reflection`, `review`, `reasoning` (the text of the reasoning) and `removed` (the sentences that a Review turn removed, with their nodes). In a Run with a Coach, `model` names the Coach on its calls and on the Summary calls, and the decision of a Coach turn has `advice`. The panel “Model” shows `reflection` and `review` as flags, `stuck` as a chip of the shown call, and `removed` in a “Removed” line under the note."],
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
          <span class="text-sm text-faint">Not progress: a text heard before, a new cell on a map that is not dark for the model.</span>
        </Block>
      </div>
      <div class={GRID2}>
        <DocCard icon={Repeat} tone="warn" title="Reflection turn" lines={["when: the stuck counter at 20, 40, 60…, at the next walk with a Model call", "reads the Memory tree and the full Atlas", "writes a lesson in `note` and a new `objective`"]} />
        <DocCard icon={Eye} title="Review turn" lines={["when: the first walk with a Model call after 20 decisions since the last Review or Reflection", "the full Atlas and a short check: the way, the facts, the guesses, the exits, the team", "writes `mission`, `objective`, `note`, and `remove` for false sentences of the top nodes"]} />
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
              ["Never", "HP or PP values"],
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
        ["Note", "the model adds a note after an important event or a lesson. The program cleans it before the Run record keeps it (page “Stuck, reflection and review”, Notes)."],
        ["Removal", "at a Review turn, the top nodes show a number before each sentence, and the model can remove 5 sentences at most. It cannot rewrite them. A node with no sentence left is not in the prompt. The next summaries do not read a removed sentence, but `zoom` still shows it in the lower nodes. A new note or a new summary loses a sentence with nearly the same words as a removed one."],
        ["Place claims", "a sentence that says that a place is explored, seen or searched in full, crossed, exhausted, a dead end, a loop back or with no way out, except one that starts with “Guess:” or “A person said:”, leaves each note and each summary, because the list What is left tells this from the game. The prompts and the zoom also hide such a sentence in the older nodes of a Continued Run. The Run record and the Viewer keep them."],
        ["Summary call", "merges two nodes of the same size; in a Run with a Coach, the Coach writes it, and it also writes the lessons of the Reflection turns and the removals of the Review turns. It drops a fact that a later note makes false or ends, and keeps the later fact. It keeps “Guess:” before each guess. A summary that is too long ends at its last full sentence. A merge whose two halves have only place claims makes no request, and its parent node stays empty. A summary with only place claims or removed sentences counts as a failed call, and the merge stays due."],
        ["Size", "a node of 2^k notes has 200 × (k + 1) characters at most, with the newest facts first."],
        ["`zoom <a-b>`", "opens a node: its two halves, down to the notes."],
        ["Cost", "a Summary call counts in the cost of the Run, or in its tokens on a Plan provider."],
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
              ["Cost", "a Summary call counts in the cost of the Run, or in its tokens on a Plan provider"],
            ]}
          />
        </Block>
      </div>
    </Page>
  );
}

export function DoubleBattlePage() {
  return (
    <Page
      lead="A trainer battle with 2 Pokémon on each side. The model chooses for one Pokémon at a time, and the program answers the target screen of the game."
      details={[
        ["Trainers", "the ROM has 33 trainers with a double battle, and a double battle needs 2 Pokémon that can fight in the party. The game has no wild double battle."],
        ["Target screen", "after a move that hits one foe, the game opens a target screen (`HandleInputChooseTarget`). It is not a Decision point: the `fight` action answers it. With one foe left and the other Pokémon alive, the game still opens it, and the action confirms this foe. With only 2 Pokémon left in the battle, the game does not open it."],
        ["`press` on the move menu", "a `press A` can open the target screen. No action covers it, so the Bot presses B 3 times, as on each unknown screen."],
        ["Foes", "foe 1 is the left foe and foe 2 is the right foe. With one foe left, the prompt does not number the foes, and `on` is impossible: the game plays nothing."],
        ["`on` with another move", "a move that hits both foes ignores `on`, as the game opens no target screen for it."],
        ["Switch and send", "the other Pokémon in the battle is not in the list. The game refuses a Pokémon that the first choice of the turn already sends, and the action is impossible with its text."],
        ["Last turn", "the first choice has no text, so it is not a turn. `Last turn: …` starts at this choice and ends after the turn. It gives the HP of the Pokémon that chose first and of foe 1."],
        ["Moves on this foe", "`Your moves on this foe: …` does not show, because the text of a double battle does not tell the foe of a move. `Moves seen` comes from both foes."],
        ["Not yet", "a move cannot aim at the other Pokémon of the player. The `battle` state events and the Viewer show only the left Pokémon and the left foe."],
      ]}
    >
      <div class={BLOCKS2}>
        <Block label="🔁 One turn">
          <Terms
            numbered
            rows={[
              ["First choice", "the game asks for the action of the left Pokémon. The answer gives no text"],
              ["Second choice", "the game asks for the action of the right Pokémon"],
              ["Turn", "the game plays the turn, and the last action gives all its text"],
              ["Faint", "the party menu asks for one Pokémon for each empty place"],
            ]}
          />
        </Block>
        <Block label="🎯 What the model writes">
          <Terms
            rows={[
              ["`fight 0`", "the move 0. A move that hits one foe hits foe 1"],
              ["`fight 0 on 2`", "the move 0 on foe 2"],
              ["`switch`, `use`", "the same actions as in a single battle, for the Pokémon that chooses now"],
            ]}
          />
        </Block>
      </div>
      <Block label="👁️ What the prompt adds" sub="Only in a double battle.">
        <div class={GRID2}>
          <DocCard icon={Eye} title="The battle" lines={["“You choose now for …”", "the other Pokémon: level, HP, status", "`Foe 1` and `Foe 2`, each with the facts of a foe"]} />
          <DocCard icon={Eye} title="Each fight" lines={["what it hits: one foe, both foes, both foes and your other Pokémon, the game chooses, or no foe", "for one foe: the exact action for each foe", "the effect and the damage on each foe"]} />
        </div>
      </Block>
    </Page>
  );
}
