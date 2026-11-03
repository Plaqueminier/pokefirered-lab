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
        ["model", "plays past the first rival battle, to the cost limit or the Token limit, a plan limit, a user stop, a whiteout, an unknown screen or `badge-8`. At each Decision point, it asks an AI model for the action (a Model call). The code reads the texts alone."],
        ["Model provider", "who answers the calls of a Run: `openrouter` (the default, it bills each call), or a Plan provider, `claude-code` or `codex`, which uses a subscription. The page “Model providers” tells how to use them."],
        ["starter", "the scripted bot is a tool for the tests of the Harness only: it is not in the list."],
        ["The list", "comes from the server: each module of `bots/`, with its kind, version and goal, or the error of a module that does not load."],
      ]}
    >
      <div class={GRID2}>
        <DocCard icon={Bot} title="model" lines={["asks an AI model for the action at each Decision point (a Model call)", "the code reads the texts alone", "plays to its limit, a user stop, a whiteout, an unknown screen or `badge-8`"]} />
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
      lead="A Run can use a subscription in place of OpenRouter: Claude Code or Codex then answer each Model call, and a Token limit replaces the cost limit."
      details={[
        ["Why", "OpenRouter bills each Model call, and the user already pays for the subscriptions (ADR 0005). OpenRouter stays the default: it has the widest choice of models and it gives a real cost."],
        ["Rules of the subscriptions", "the help of Claude tells that `claude -p`, with a login on a plan, uses the limits of the subscription (read in 2026-11). The docs of Codex tell that `codex exec` reuses the saved login, and they recommend an API key for automation. These rules changed during 2026: read them again before many Runs."],
        ["One Run, one provider", "all the Model calls and Summary calls of a Run use the same provider and the same model. A Continued Run can use another provider and another model, and it is a new Run. An Extended Run keeps its provider, its model and its id."],
        ["Each call", "one new process of `claude -p` or `codex exec`, in a new temporary directory, with no shared context. The Bot still calls the Harness, and the AI model never does (ADR 0003)."],
        ["No API key", "the tool does not get `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `CODEX_API_KEY` or `OPENROUTER_API_KEY`, because each tool bills a key when it finds one. A login with an API key is not accepted: the provider stays disabled."],
        ["No settings", "the tools do not read your settings or your MCP servers, and they keep no session."],
        ["One message", "a conversation of a Decision point (the answer of the program after an impossible action) goes in one user message, so each try is a new request."],
        ["Reasoning", "Claude Code has no level `off`: `off` plays as `low`, and the Run record keeps `low`. Codex plays `off` as `none`."],
        ["Temperature", "a Plan provider refuses `--temperature`, because the tools do not take one."],
        ["Codex tools", "three tools stay in Codex. A call that uses a tool stops at once and counts as a failed request. The Bot asks again, and 3 errors in a row end the Run."],
        ["Time limit", "a call with no answer ends with an error after 5 minutes (10 minutes on OpenRouter)."],
        ["User stop", "a user stop ends the process of the tool at once."],
        ["Codex version", "`bun install` in `lab/` gives Codex at a fixed version (0.166.0), and the Bot uses this one, not a global `codex`. Claude Code is the global `claude` command, so it can change when you update it."],
        ["Token limit", "you give it in millions of tokens, and the Run record keeps a number of tokens. It counts the prompt tokens (with the cached tokens) and the completion tokens of all the calls of the Run, also the Summary calls. The Run ends after the call that goes above the limit, so it can use one call more than the limit."],
        ["Quota", "the amount of the quota is not published, and your own work uses the same quota. The Token limit is not a part of this quota: it only stops the Run."],
        ["Measure of the overhead", "one recorded prompt of 5,112 input tokens on OpenRouter took 8,241 through Claude Code and 7,306 through Codex, about 4 s for each call."],
      ]}
    >
      <div class={GRID3}>
        <DocCard title="openrouter" lines={["the default model: `deepseek/deepseek-v4.1-flash`", "bills each call", "limit: a cost in dollars"]} />
        <DocCard title="claude-code" lines={["the default model: `haiku`", "uses your Claude subscription", "limit: a number of tokens"]} />
        <DocCard title="codex" lines={["the default model: `gpt-5.6-luna`", "uses your ChatGPT subscription", "limit: a number of tokens"]} />
      </div>
      <Block label="🔑 1. Log in" sub="In `lab/`. You do this one time. You do not need a global install of Codex.">
        <Terms
          rows={[
            ["Claude Code", "`claude auth login`. To check: `claude auth status` must give `\"authMethod\": \"claude.ai\"`."],
            ["Codex", "`bun install`, then `node_modules/.bin/codex login`. To check: `node_modules/.bin/codex login status` must give `Logged in using ChatGPT`."],
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
  ["Milestones", "the ones reached, and the next one: a name and a place"],
  ["Memory tree", "the top nodes; `zoom` opens a node"],
  ["Bag, money, party", "as the Summary screen and the Bag show them; at a walk, the Pokémon in the boxes when there are some, and one line when a REPEL is active"],
  ["The screen", "the part of the Decision point"],
  ["The game waits for", "a walk, a choice, a battle action…"],
  ["Mission", "the story step, kept until it is reached"],
  ["Objective", "what the model does now"],
  ["Stuck counter", "the Decision points since the last progress"],
  ["Tries", "the tries since the last progress, with their results"],
  ["Last decisions", "with the texts of the game"],
  ["Events", "the important events, which ask for a note"],
  ["Actions", "the actions of the screen"],
] as const;

const ANSWER = [
  ["character", '"Pastry and old map names. A shy baker…"', "only at the Character turn: the style of the nicknames, then the trainer"],
  ["starter", '"CHARMANDER"', "only at the Character turn: the first Pokémon"],
  ["name", '"Mira"', "only at the Character turn: the name of the trainer, 7 characters at most"],
  ["rival", '"Crumb"', "only at the Character turn: the name of the rival, 7 characters at most"],
  ["action", '"goTo 20 45"', "one action of the screen"],
  ["reason", '"The unseen area west…"', "why, in one or two sentences"],
  ["mission", '"Reach Pewter City…"', "the story step, kept until it is reached"],
  ["objective", '"Explore the unseen area…"', "what the model does now"],
  ["note", '""', "a new note of the Memory tree, or empty"],
  ["remove", "[3, 7]", "only at a Review turn: the numbers of sentences to remove from the top nodes"],
] as const;

// A copy of the actions of the model bot at each screen: change it with them.
const SCREENS = [
  { title: "🚶 Walk", adds: ["Known world: one line for each town, city or route visited", "the map as a grid: `?` an unseen cell that an open cell leads to, a blank any other unseen cell, `-` `_` `[` `]` a thin wall, `t` `r` `b` `w` an obstacle or water whose HM is in the Bag or whose move a Pokémon knows, a letter is a target"], actions: ["go", "goTo", "swap", "use", "viewAtlas", "zoom", "press"] },
  { title: "❓ Choice", adds: ["the question and the options: “Choose YES or NO.”", "for a nickname: no Model call, the program answers YES"], actions: ["choose", "zoom"] },
  { title: "⚔️ Battle action", adds: ["your Pokémon and the foe: types, status, states", "each fight: effect, STAB, damage % and hits to KO"], actions: ["fight", "switch", "run", "use", "zoom"] },
  { title: "🎯 Move menu", adds: ["the 4 moves, with the same facts as at a battle action", "`press` works here, not at a battle action"], actions: ["fight", "zoom", "press"] },
  { title: "🔁 Party menu", adds: ["the Pokémon that can go into the battle, with their places", "for example after a faint"], actions: ["send", "zoom", "press"] },
  { title: "🛒 Poké Mart", adds: ["the items for sale with their prices and descriptions", "the items of the Bag that the Mart buys, the money"], actions: ["buy", "sell", "leave", "zoom"] },
  { title: "💾 Item PC", adds: ["the items in the PC and in the ITEMS pocket, with quantities", "1 with no quantity; `leave` returns to the menu of the PC"], actions: ["withdraw", "deposit", "leave", "zoom"] },
  { title: "📦 Pokémon PC", adds: ["the Pokémon in the boxes, with a number: species, nickname, level, box", "`deposit` names a Pokémon of the party, `withdraw` a number or a name of the list; no `withdraw` with empty boxes"], actions: ["deposit", "withdraw", "leave", "zoom"] },
  { title: "✏️ Naming screen", adds: ["what the screen names, and the maximum length", "for a nickname, the text must be new; for another name, `name` alone keeps the name"], actions: ["name", "zoom"] },
  { title: "📖 Learn a move", adds: ["the new move and the 4 moves: type, power, accuracy, PP", "an important choice: count the damage moves and compare their PP", "an HM move cannot be forgotten"], actions: ["forget", "keep", "zoom"] },
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
        ["Model call", "at each walk, choice, battle action or move, in the party menu, at the shop menu of a Poké Mart, at the item PC, at the Pokémon PC, at the naming screen and when a Pokémon must forget a move to learn a new one."],
        ["Answer", "an action, its reason, the Mission (the story step, kept until it is reached) and the Objective (what the model does now) (ADR 0003)."],
        ["Stop and time limit", "a user stop ends a Model call at once, and a Model call with no answer after 10 minutes (5 minutes on a Plan provider) ends with an error. Its event then has the error and no cost: OpenRouter gives the cost with the answer only, so the cost limit does not count this call. After the time limit, the Bot asks again, and 3 errors in a row end the Run."],
        [
          "Each prompt",
          "the parts that change little come first, so that the provider caches more of the prompt: the Milestones and the next one (a name and a place only), the top nodes of the Memory tree, at a walk the Known world, the Bag, the money, the party, at a walk one line of the Pokémon in the boxes when there are some and one line when a REPEL is active, and the part of the Decision point (at a walk, the extract of the Atlas). Then what the game waits for, the Mission, the Objective, the stuck counter, the tries since the last progress, the last decisions with their texts, the important events and the actions. The rule of the first Pokémon stops when the party has a Pokémon.",
        ],
        [
          "Known world",
          "one line for each town, city or route that the player visited (the map type of the ROM), first visit first. The code makes it from the Atlas: the edges seen (with the destination, “not visited” or blocked), the passages through a gate, a forest or a cave to another outdoor map, the buildings entered, the exits not taken with their cells, the number of groups of open cells next to unseen cells (a blank cell does not count) and the fixed obstacles whose HM is in the Bag or whose move a Pokémon knows.",
        ],
        ["Walk", "an extract of the Atlas: the current map and the texts of its people in full, 1 500 characters for the other maps. The map is a grid of all its rows: `?` is an unseen cell that an open cell leads to, a blank is any other unseen cell, a letter is a target (`go B`)."],
        [
          "Targets",
          "in groups (exits, unseen cells, people and signs, leads, far maps), each with its distance and direction (a wide exit, with neighbour cells that lead to the same map, is one target), and the marks talked (with the last text of the person), read or taken. An ITEM BALL says that it is a free item that `go` takes, except the starter balls in the Lab of Professor Oak. An exit seen from a town, a city or a route shows the kind of place that a player sees: a Pokémon Center, a Poké Mart, a department store, a Gym, a house, a gate building, a cave entrance, a harbor, a path to another map, or a building for the others. The code reads it from the map where the exit leads, but the name of this map shows only after the player took the exit. From inside, only an entrance shows a place: the outside or a cave entrance. An exit that the player took shows its arrival cell when this cell is known. An exit to a cave or a building also shows what is beyond it: unseen cells, an exit not taken, or nothing new. A target in another part of the map shows the number of exits to it, not a direction: this count follows the exits that the player took, also through an outdoor map. With no known exits to it, it keeps its direction and says “no seen way there yet”. The unseen cells of the part of the player show one target for each group of touching open cells next to unseen cells, at the nearest cell of the group. The leads are at most 4: the nearest unseen cells and exits not taken in other parts and cave or building maps, and `go` walks to them across the maps. The unseen cells of a room that fits on the screen are no lead. A ? stands only where an open cell that the player saw leads to an unseen cell. Every other unseen cell is blank, so a wall that no open cell leads to adds no sign to the map. The column numbers come again every 10 rows, and the legend lists only the signs of the map. A fixed obstacle and water are # with no text while the Bag has no HM and no Pokémon knows the move; then they are t (cut tree), r (rock), b (boulder) or w (water), and the obstacle has its text. Under the map, a line says when the player saw all the cells of the map, or all the cells of its part: the player then takes an exit or a lead. A trainer that the player did not beat yet has the mark “a trainer that you did not beat yet: a talk starts a battle”. The extract also lists the edges to other maps. When a person moves during a `go`, the code finds the person and walks again (2 times at most).",
        ],
        [
          "Guide",
          "short generic advice in the rules, with no facts about the maps or the story. Read the signs and talk to the people. Buy Poké Balls, Potions and REPELS at a Poké Mart. A REPEL stops wild Pokémon with a level below the first healthy Pokémon for 100 steps, so use it to cross a cave when the team is ready: a battle that you avoid gives no experience. Take each ITEM BALL that you can reach: it costs only the walk. Write guesses in the notes and check them. Keep the POTIONS for when they are necessary. Use more than one Pokémon and make a balanced team. `run` from a wild battle that goes badly. Compare the levels before a trainer, and train when the trainers ahead are stronger. To train a weak Pokémon, put it first with `swap`, then `switch` to a strong one when the battle is difficult. Each Pokémon Center has a PC: it keeps the items and the Pokémon, and a Pokémon caught with 6 Pokémon in the party goes to a box. At the PC, put a weak Pokémon in a box to make a place before a catch, and take a Pokémon from a box when it suits the next battle. Give a nickname to each Pokémon, in the style of the character and different from the species: it costs nothing, and it tells two Pokémon of the same species apart.",
        ],
        ["`viewAtlas`", "the full Atlas, one time at most at each Decision point. No frames run."],
        [
          "Choice",
          "one line with the question and the options, for example `The game asks: \"Do you want to give a nickname to this BULBASAUR?\" Choose YES or NO.` At the question of a nickname, and at a Poké Ball of Professor Oak, the program answers with no Model call. A `zoom` or a `viewAtlas` does not hide the question. The actions are `choose <option>` and `zoom`, also in a battle. At the menu of the PC of a Pokémon Center, one more line tells that the PC with the name of the player has ITEM STORAGE, and that the first option (SOMEONE'S PC or BILL'S PC) opens the boxes, which keep the Pokémon.",
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
          "“SQUIRTLE wants to learn BUBBLE (WATER, power 20, accuracy 100, PP 30/30).” with the description of the move, then “It already knows 4 moves. To learn BUBBLE, it must forget one of them:” and the 4 moves, then “This is an important choice. Before you choose, count your damage moves and compare their PP.” The actions are `forget <move>` (a name, or the place 1 to 4) and `keep`. An HM move says that it cannot be forgotten. The code does all the menus.",
        ],
        [
          "`press`",
          "only at a walk, at the move menu of a battle and in the party menu, never at a battle action, a choice, the shop menu, the item PC, the Pokémon PC, the naming screen or a move to forget. It has no Start: the model bot does not know the Start menu. The reason of a `press Start` answer tells to `use <item>`, with the items that work now, or that the Bag is empty.",
        ],
        ["Forms of an action", "a call is read too: `press(Up)` is `press Up`, `use(POTION, SQUIRTLE)` is `use POTION on SQUIRTLE`. A comma between the arguments is a space: `goTo 9, 42` is `goTo 9 42`. The commas of `choose` and `name` stay in the text."],
        ["Impossible action", "the same conversation continues with the reason of the Harness and the exits of the map (3 times at most). For an answer that the Bot cannot read, the reason gives the form of the action and one example."],
        ["Word screen", "when the Harness left the word screen of a profile, the last decisions add one line: the program left it, a profile gives nothing in the game, and the model must choose NO when a person asks for its profile."],
        ["Blocked edge", "an edge with water between the two maps: only SURF crosses it. The extract and the full Atlas say “you cannot go there now” with the reason, the edge is not a target, and a `goTo` past it gives the same reason. A `goTo` past an edge cell that leads to a blocked cell of the next map is impossible too: it tells to cross at another cell."],
        ["Part", "the cells of a map that the player can walk to from one cell, on the cells that it saw and with no other map on the way. The code makes the parts from the Atlas only. The line of a map one exit away gives, for each part where its exits arrive, the exits of that part. The walk of the leads, of the “beyond it” marks and of these lines stops at an outdoor map, except the map of the player; only the count of exits to a target crosses outdoor maps."],
        ["Thin wall", "an open cell with a wall on one side (`-` north, `_` south, `[` west, `]` east in the grid): no step across that side, in both directions. It can make two parts on one floor, as on B2F of Mt Moon."],
        ["Fixed obstacle", "the cut tree, the rock of ROCK SMASH and the boulder of STRENGTH: not people. Their cell is blocked, and `goTo` never waits for them. A `goTo` that only a fixed obstacle stops is impossible at once, and the reason names the obstacle, its cell and the move. When the Bag has the HM or a Pokémon knows the move, the grid shows their sign and the extract and the full Atlas list them with the move, with no target letter. Before that, they are # with no text."],
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
        <DocCard title="📘 Guide in the rules" lines={["read the signs, talk to the people", "write guesses in the notes, and check them", "keep the POTIONS; make a balanced team", "run from a wild battle that goes badly", "compare the levels before a trainer"]} />
        <DocCard title="🌊 Blocked edge" lines={["water between two maps: only SURF crosses it", "not a target; a `goTo` past it is impossible, with the reason"]} />
        <DocCard title="🧩 Part" lines={["the cells that the player can walk to on one map", "another part shows the number of exits to it, or “no seen way there yet”", "the leads keep the unseen cells of the other parts"]} />
        <DocCard title="🧱 Thin wall" lines={["`-` `_` `[` `]`: a wall on the north, south, west or east side of an open cell", "no step across it, in both directions"]} />
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
        ["Progress", "a new map, a new Milestone, a new exit in the Atlas (a wide exit or a warp or an edge seen for the first time), a level up, a new text of a person, a trainer beaten, an item found (an item ball or a hidden item), or a new species caught (owned in the Pokédex). A text heard before from the same person and a new cell are not progress."],
        ["Reflection turn", "the first walk at 20 on the stuck counter, then at 40, 60… A normal Model call, with an instruction: read the Memory tree and the full Atlas (after the extract), zoom freely, write a lesson in `note` (what failed, why, what next) and set a new `objective`. No `viewAtlas` there."],
        [
          "Review turn",
          "the first walk after 20 decisions (Model calls that played an action) since the last Review or Reflection turn, also with progress. A normal Model call, with the full Atlas after the extract and a short check: the way to the next Milestone, the facts against the Mission, the guesses from the signs and the people, the exits left to explore, the team (levels, HP, status, PP). The top nodes of the Memory tree show a number before each sentence, and the first answer that the Bot can read can name 5 of them at most in `remove`, or none. The model writes the result in `mission`, `objective` and `note`. When a Reflection turn and a Review turn are both due at the same decision, only the Reflection turn shows. No `viewAtlas` there.",
        ],
        [
          "Events that ask for a note",
          "since the last Model call: a new map, a lost battle, a heal (all HP full again with no battle and no item use; the line names the map and the last person talked to), a new item, a battle that ended with a problem in the party (less than half of the HP, a status, a quarter of the PP or less; one line with each problem), 2 impossible actions or more in a row. One line “Something important happened: …” each, then “Write a note if it can help you later.” The model decides.",
        ],
        ["Loop warning", "when the last 3 decisions that played an action played the same actions with the same results, the prompt adds one line “Warning: …” after the tries since the last progress. A `zoom` or a `viewAtlas` does not count."],
        ["Notes", "a fact that the game proved, a lesson (what works, what fails and why), a guess that starts with “Guess:”, or the advice of a person that helps later (“A person said: you can never have too many Poké Balls”). When a note becomes false or ends (a guess disproved, a person that moved, a trainer beaten), the model writes a new note that says so. Never HP or PP values. The program removes a sentence with an HP or PP number and a note with nearly the same words as one of the last 32 notes (a number, a negation or “Guess:” in only one of them makes two facts), and it writes “Guess:” before a sentence with a word like “might” or “likely”."],
        ["Character turn", "the first Model call of a Run with no Pokémon. The program selects an idea at random from 100 jobs, 12 traits and 33 hobbies (a shy baker who collects old maps), and the model writes the first Pokémon in `starter`, a style of the nicknames (the request asks that it mixes the job and the hobby) and the trainer in `character` (400 characters at most, then cut), and the two names in `name` and `rival`. A name has 1 to 7 characters from the keyboard of the game, with no space at its start or its end; the program asks again after a bad name. Before the first action, the Run boots again with the names, at the same frame and with the same screen. A continued Run with an action in its parent keeps the names of its game, and the turn tells them to the model. Each later prompt has “Your character: …”, with the names. At a Poké Ball, the program answers with no Model call: YES to this Pokémon, NO to another. The panel “Model” shows the names and the character in a block on each Model call, and “Normal trainer” for a Run with no Character turn. There is no block while a Character turn has no readable answer."],
        ["Thinking", "the Character, Reflection and Review turns use the thinking level of the Run, the other Model calls its reasoning level. After an empty answer, when the reasoning took all the tokens, the next calls of the same turn use the reasoning level. The panel “Model” shows the text of the reasoning in a block."],
        ["Run record", "each Model call has `stuck`, `character`, `reflection`, `review`, `reasoning` (the text of the reasoning) and `removed` (the sentences that a Review turn removed, with their nodes). The panel “Model” shows `reflection` and `review` as flags, `stuck` as a chip of the shown call, and `removed` in a “Removed” line under the note."],
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
        <DocCard icon={Repeat} tone="warn" title="Reflection turn" lines={["when: the stuck counter at 20, 40, 60…, at the next walk", "reads the Memory tree and the full Atlas", "writes a lesson in `note` and a new `objective`"]} />
        <DocCard icon={Eye} title="Review turn" lines={["when: the first walk after 20 decisions since the last Review or Reflection", "the full Atlas and a short check: the way, the facts, the guesses, the exits, the team", "writes `mission`, `objective`, `note`, and `remove` for false sentences of the top nodes"]} />
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
        ["Removal", "at a Review turn, the top nodes show a number before each sentence, and the model can remove 5 sentences at most. It cannot rewrite them. A node with no sentence left is not in the prompt. The next summaries do not read a removed sentence, but `zoom` still shows it in the lower nodes."],
        ["Summary call", "merges two nodes of the same size. It drops a fact that a later note makes false or ends, and keeps the later fact. It keeps “Guess:” before each guess. A summary that is too long ends at its last full sentence."],
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
