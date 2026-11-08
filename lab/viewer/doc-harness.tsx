import { Bike, ChevronRight, CircleHelp, Coins, Footprints, Hand, Layers, OctagonX, Play, Rabbit, Repeat, Skull, Timer, TriangleAlert, Trophy } from "lucide-preact";
import type { Milestone } from "../src/game";
import type { EndReason } from "../src/harness/harness";
import type { Outcome } from "../src/harness/menu-driver";
import type { GameEvent } from "../src/harness/record";
import { Code, type InfoTone, Pill, type Tone } from "./components";
import { Block, BLOCKS2, DocCard, GRID2, GRID3, Page, Pills, Terms } from "./doc-parts";

const MACRO_SCREENS = [
  { id: "walk", title: "🚶 Walk" },
  { id: "text", title: "💬 Text" },
  { id: "choice", title: "❓ Choice" },
  { id: "battle", title: "⚔️ Battle" },
  { id: "mart", title: "🛒 Poké Mart" },
  { id: "pc", title: "💾 Item PC" },
  { id: "boxes", title: "📦 Pokémon PC" },
  { id: "naming", title: "✏️ Naming screen" },
  { id: "learn", title: "📖 Learn a move" },
] as const;

type MacroScreen = (typeof MACRO_SCREENS)[number]["id"];

// Exactly one entry for each Macro-action of the Harness (doc.test.ts).
export const MACRO_DOC: { form: string; when: string; effect: string; cards: Partial<Record<MacroScreen, string>> }[] = [
  { form: "goTo(x, y, map?)", when: "walk", effect: "Goes to a cell, also on another map: doors, stairs, edges, ledges. With an exit as the cell and no map, it takes the exit. With a map, a door is the cell next to it, because the game moves the player off the door. The route does not cross a thin wall. A blocked or water cell that the player saw gets its own reason, not “no route”. When only a person or an object that does not move closes all the ways, it returns `blocked` at once and names it, if the player saw it; for a person who walks, it waits and tries again. It also crosses a cut tree or a rock that the party can remove: it faces the obstacle, presses A, answers YES, reads the texts and steps. The result has no text of this. A cut tree or a rock that a Pokémon can remove with a badge that the player does not have gives a reason that names the badge. On a map that is dark for the model, it refuses an unseen cell, and its route uses only seen cells. A route never steps on a spin tile. A goTo to a spin tile walks to a cell next to it, steps on it and waits for the end of the slide; the result then has `slidTo`, the cell where the player stopped. A goTo to a cell of another Part with no way on foot names the two Parts and says that only a slide leaves the Part of the player. The walk runs when the player has the Running Shoes and the map allows it, and it rides when the Bot chose the BICYCLE (page “Running and the BICYCLE”).", cards: { walk: "go to a cell, also on another map; at an exit, take it" } },
  { form: "walkOn(x, y, direction)", when: "walk", effect: "Goes to a seen cell, then continues in one direction while the map is dark for the model. When a wall closes that direction, it goes along the wall to the side that the walk to the seen cell took, while that side of the wall has unseen cells near it. When the seen cell is straight in that direction from the start, it does not go along a wall. It stops at a wall in front, before an exit, before a ledge, at a new person and at a battle. Only the code of a Bot asks for it: the model writes `go` to an unseen cells target.", cards: { walk: "in the dark, continue in one direction" } },
  { form: "interact(x, y)", when: "walk", effect: "Turns to the next cell and presses A: a person, a sign, an item. A rider on a slope does not turn (page “Running and the BICYCLE”).", cards: { walk: "turn to the next cell and press A" } },
  {
    form: "readText()",
    when: "text, busy game",
    effect:
      "Reads the texts to the end of the box or to a choice. After a whiteout, it reads to the walk in the Pokémon Center or the house. The word screen of a profile (Easy Chat) has no action: while an action waits, the Harness leaves it (B, then YES), and the result has `leftWordScreen`.",
    cards: { text: "read to the end of the box or to a choice" },
  },
  {
    form: "choose(option)",
    when: "yes/no, nickname after a catch, script menu, grid menu of the school blackboard, menus of the PC",
    effect: "Moves the cursor to the option and presses A. SOMEONE'S PC or BILL'S PC opens the Pokémon PC.",
    cards: { choice: "yes/no, a script menu, the menus of the PC" },
  },
  { form: "fight(move, foe?)", when: "battle", effect: "Uses the move 0 to 3, and gives the messages of the turn. With no PP in all the moves, selects FIGHT: the game uses STRUGGLE. Under an ENCORE, FIGHT plays the encored move, and another move is impossible. In a double battle, it is the choice for one Pokémon: the choice for the first Pokémon gives no messages, and the game then waits for the action of the second one. `foe` is 1 or 2, and it is impossible with one foe to choose. With no foe, a move that hits one foe hits foe 1.", cards: { battle: "use the move 0 to 3; no PP: STRUGGLE" } },
  { form: "switch(slot)", when: "battle", effect: "Sends another Pokémon of the party into the battle.", cards: { battle: "send another Pokémon" } },
  { form: "send(slot)", when: "party menu of a battle", effect: "Sends a Pokémon, for example after a faint.", cards: { battle: "send a Pokémon after a faint" } },
  { form: "swap(first, second)", when: "walk", effect: "Changes the order of two Pokémon of the party.", cards: { walk: "change the order of two Pokémon" } },
  { form: "run()", when: "wild battle", effect: "Escapes. Impossible against a trainer.", cards: { battle: "escape a wild battle" } },
  {
    form: "use(item, on?)",
    when: "battle, walk",
    effect:
      "Uses an item of the Bag, on a Pokémon for a Potion. A Poké Ball catches in a wild battle. On a walk, the medicines work on a Pokémon, and REPEL, SUPER REPEL, MAX REPEL and ESCAPE ROPE work alone (ESCAPE ROPE goes to another map). BICYCLE changes the choice of the Bot to ride or to walk, with no Bag after the first time. Impossible, with the reason of the game, when the item does nothing.",
    cards: { walk: "a medicine, REPEL, ESCAPE ROPE, BICYCLE", battle: "a Potion, a Poké Ball" },
  },
  {
    form: "teach(item, on)",
    when: "walk",
    effect: "Teaches the move of a TM or an HM of the Bag to a Pokémon, through the TM Case and the party menu of the game, and returns to the walk. A TM leaves the Bag, and an HM stays. With 4 moves, it stops at the learn-move question of the game. Impossible for a Pokémon that cannot learn the move or that knows it.",
    cards: { walk: "the move of a TM or an HM" },
  },
  {
    form: "buy(item, quantity)",
    when: "shop menu of a Poké Mart",
    effect: "Selects BUY, the item, the quantity and YES, then returns to the shop menu. Impossible when the money does not pay the items.",
    cards: { mart: "the money must pay all" },
  },
  { form: "sell(item, quantity)", when: "shop menu of a Poké Mart", effect: "Sells items of the Bag for half of their price, then returns to the shop menu.", cards: { mart: "for half of the price" } },
  {
    form: "withdraw(item, quantity)",
    when: "item PC",
    effect: "Takes items from the PC and puts them in the Bag, then returns to the item PC. Impossible for an item that is not in the PC.",
    cards: { pc: "PC → Bag" },
  },
  { form: "deposit(item, quantity)", when: "item PC", effect: "Puts items of the ITEMS pocket of the Bag into the PC, then returns to the item PC.", cards: { pc: "Bag → PC" } },
  {
    form: "depositPokemon(slot)",
    when: "Pokémon PC",
    effect: "Puts a Pokémon of the party in the current box, or in the next box with a free place, then returns to the Pokémon PC. Impossible with 1 Pokémon in the party, for the last Pokémon that can fight, and when all the boxes are full. If the game refuses on its screen, the result is impossible, and the Harness closes the screen and returns to the Pokémon PC.",
    cards: { boxes: "party → box" },
  },
  {
    form: "withdrawPokemon(box, position)",
    when: "Pokémon PC",
    effect: "Puts the Pokémon at this place of the boxes in the party, then returns to the Pokémon PC. Impossible with 6 Pokémon in the party, and for an empty place.",
    cards: { boxes: "box → party" },
  },
  {
    form: "leave()",
    when: "shop menu of a Poké Mart, item PC, Pokémon PC",
    effect: "At the shop menu: selects SEE YA! and reads the texts of the clerk until the walk. At the item PC and at the Pokémon PC: presses B and returns to the menu of the PC.",
    cards: { mart: "SEE YA!, then the walk", pc: "back to the menu of the PC", boxes: "back to the menu of the PC" },
  },
  {
    form: "name(text)",
    when: "naming screen",
    effect: "Types the text on the pages of the keyboard, selects OK and reads the texts, also the message that a Pokémon caught with 6 Pokémon in the party goes to the PC. An empty text keeps the name. Impossible for a character that is not on the keyboard or a text that is too long.",
    cards: { naming: "type, then OK; empty keeps the name" },
  },
  {
    form: "forget(move)",
    when: "learn a move: “Delete a move to make room for …?”, after a level up in a battle, an evolution, or a TM or an HM",
    effect: "Selects YES and the move on the summary screen: the Pokémon forgets it and learns the new move. After a TM or an HM, it also returns to the walk. Impossible for a move or a place that the Pokémon does not know, or an HM move.",
    cards: { learn: "forget it and learn the new move" },
  },
  { form: "keep()", when: "learn a move", effect: "Selects NO, then YES at “Stop learning …?”: the Pokémon keeps its 4 moves. After a TM or an HM, the item stays in the Bag, and the action returns to the walk.", cards: { learn: "keep the 4 moves" } },
];

export const RAW_INPUT_FORM = "press(button)";

const RESULTS: Record<Outcome["status"], { tone: Tone; text: string }> = {
  done: { tone: "ok", text: "complete" },
  impossible: { tone: "bad", text: "cannot start or continue" },
  blocked: { tone: "warn", text: "a person or an object stays in the way; the reason names it when it does not move and the player saw it" },
  interrupted: { tone: "info", text: "trigger, trainer, script, battle or a map off the route" },
};
const RESULT_ROWS = Object.entries(RESULTS);

export function MacroPage() {
  return (
    <Page
      lead="One game action that the Harness plays until it ends or the game interrupts it, with no game decision."
      details={[
        ...MACRO_DOC.map(({ form, when, effect }) => [`\`${form}\``, `${when} · ${effect}`] as const),
        ["Results", RESULT_ROWS.map(([status, { text }]) => `\`${status}\` ${text}`).join(" · ")],
        [
          "`observe()`",
          "what the game waits for, the Milestones, the Atlas, the Bag (items, quantities, effect, price) and the money, and the party as the Summary screen shows it (types, ability, held item, nature, stats, EXP now, at the start of the level and to the next level; for each move its type, power, accuracy, PP and description). On the map: the kind of the map (outdoor, underground or indoor), the grid, the people, the fixed obstacles, the Pokémon in the boxes (species, nickname, level, box and place, types, ability, and the moves as for the party), the items of the PC, whether a REPEL is active, whether the player rides and whether the Bot chose to ride, and each TM and HM of the Bag with its move and the Pokémon that can learn it or know it. The Atlas gives the rival with its name from the save. At the learn-move question after a `teach`, the mode is `menu`, with no facts of the map.",
        ],
        [
          "Battle facts",
          "the player's Pokémon, and the enemy as the player sees it, with its types. Both have `states`: the volatile states that a text of the game tells (seeded, confused, infatuated…). In a wild battle: `inPc`, the number of Pokémon of the enemy species in the boxes of the PC (the party is in `party`). For each move, its effect on the enemy (type chart of the game), STAB and the damage estimate in percent of the enemy HP and in hits to KO; the last turn and the turns against the current enemy.",
        ],
        ["`availableActions()`", "the Macro-actions accepted now."],
      ]}
    >
      <Block label="🎮 At each screen">
        <div class={GRID3}>
          {MACRO_SCREENS.map((screen) => (
            <DocCard key={screen.id} title={screen.title} lines={MACRO_DOC.filter((macro) => macro.cards[screen.id]).map((macro) => `\`${macro.form}\` ${macro.cards[screen.id]}`)} />
          ))}
        </div>
      </Block>
      <div class={BLOCKS2}>
        <Block label="🏁 Each result">
          <ul class="m-0 flex list-none flex-col gap-1.5 p-0 text-sm">
            {RESULT_ROWS.map(([status, { tone, text }]) => (
              <li key={status} class="flex items-baseline gap-2">
                <Pill tone={tone}>{status}</Pill>
                <span class="text-muted">{text}</span>
              </li>
            ))}
          </ul>
        </Block>
        <Block label="⌨️ Raw input">
          <p class="m-0 text-sm text-muted">
            <Code>{RAW_INPUT_FORM}</Code> one press when no Macro-action fits. The Harness counts them. A in front of a cut tree or a rock that the party can remove uses the move, with no question and no text.
          </p>
        </Block>
      </div>
      <Block label="👁️ observe()" sub="What the game waits for, and the state of the game.">
        <div class={GRID3}>
          <DocCard title="World" lines={["the Milestones, the Atlas", "on the map: the kind of the map, the grid, the people, the fixed obstacles, the Pokémon in the boxes with their moves, the items of the PC, whether a REPEL is active, each TM and HM of the Bag with who can learn it"]} />
          <DocCard title="Party and Bag" lines={["the party as the Summary screen shows it", "the Bag (quantity, effect, price) and the money"]} />
          <DocCard title="Battle" lines={["the enemy as the player sees it, with its types and states", "each move: effect, STAB, damage estimate"]} />
        </div>
      </Block>
    </Page>
  );
}

const STEPS: (Milestone | "…")[] = ["has-pokemon", "first-rival-battle", "pokedex", "badge-1", "badge-2", "…", "badge-8"];

export function MilestonesPage() {
  return (
    <Page
      lead="The steps of the story, read from the game flags."
      details={[
        ["Order", "`has-pokemon` → `first-rival-battle` → `pokedex` → `badge-1` … `badge-8`."],
        ["Goal", "the goal of a scripted Bot is a Milestone. The model bot has no goal: the code gives it the next Milestone in the prompt, and its Run continues after it."],
      ]}
    >
      <div class="flex flex-wrap items-center gap-2">
        {STEPS.map((step, i) => (
          <span key={step} class="flex items-center gap-2">
            {i > 0 && <ChevronRight size={16} class="text-faint" />}
            <Code>{step}</Code>
          </span>
        ))}
      </div>
      <Terms
        rows={[
          ["`pokedex`", "Oak gives the Pokédex for OAK'S PARCEL"],
          ["Scripted Bot", "its goal is a Milestone"],
          ["Model bot", "no goal: the code gives it the next Milestone in the prompt, and its Run continues after it"],
        ]}
      />
    </Page>
  );
}

const END: Record<EndReason, { icon: typeof Trophy; tone?: InfoTone; lines: string[]; detail: string }> = {
  goal: { icon: Trophy, tone: "ok", lines: ["the goal Milestone is reached", "with no goal: `badge-8`"], detail: "the goal Milestone is reached (with no goal: `badge-8`)." },
  "bot stopped": { icon: OctagonX, lines: ["the Bot stops or throws an error"], detail: "the Bot stops or throws an error." },
  "user stop": { icon: Hand, lines: ["“Stop the Run”, after the current action", "at once in a Model call"], detail: "“Stop the Run”, after the current action, or at once in a Model call." },
  "cost limit": { icon: Coins, tone: "warn", lines: ["the Model calls cost more than the limit"], detail: "the Model calls cost more than the cost limit (model bot on OpenRouter)." },
  "token limit": { icon: Coins, tone: "warn", lines: ["the Model calls used more tokens than the limit"], detail: "the Model calls used more tokens than the Token limit (model bot on a Plan provider)." },
  "plan limit": { icon: Coins, tone: "warn", lines: ["the subscription has no more quota", "a Continued Run or an Extended Run can play on later"], detail: "the Plan provider refused a call because the quota of the subscription is used. The result keeps its text, and a Continued Run or an Extended Run can play on later: the Run does not wait or start again by itself." },
  "frame budget": {
    icon: Timer,
    lines: ["no more frames, when a budget is given", "the scripted test bot: 30 000"],
    detail: "no more frames, when the Bot or the Run gives a budget (the scripted test bot: 30 000).",
  },
  "no progress": { icon: Repeat, tone: "warn", lines: ["the stuck counter reaches N, when the Run gives N"], detail: "the stuck counter reaches N, when the Run gives N." },
  whiteout: {
    icon: Skull,
    tone: "bad",
    lines: ["all the Pokémon of the party faint", "with “stop at a whiteout”"],
    detail:
      "all the Pokémon of the party faint, in or out of a battle (model bot with “stop at a whiteout”), after the action that reads the whiteout. The rules of the prompt tell the model that the Run ends, and also not to play too safe. The result keeps the last text of the game.",
  },
  "unknown screen": {
    icon: CircleHelp,
    tone: "bad",
    lines: ["B on 3 screens in a row that no action covers"],
    detail: "the model bot pressed B for 3 screens in a row that no action covers, with no Model call between them. The result keeps the last text of the game.",
  },
};
const END_ROWS = Object.entries(END);

export function EndPage() {
  return (
    <Page lead={`A Run ends for one of these ${END_ROWS.length} reasons.`} details={END_ROWS.map(([reason, end]) => [`\`${reason}\``, end.detail] as const)}>
      <div class={GRID3}>
        {END_ROWS.map(([reason, end]) => (
          <DocCard key={reason} icon={end.icon} tone={end.tone} title={reason} lines={end.lines} />
        ))}
      </div>
    </Page>
  );
}

const EVENT_KINDS: Record<GameEvent["type"], string> = {
  map: "map",
  battle: "battle",
  milestone: "Milestone",
  heal: "heal",
  purchase: "purchase",
  item: "item",
  catch: "catch",
  faint: "faint",
  level: "level",
  money: "money",
  trainer: "trainer",
  obstacle: "obstacle removed",
  flash: "FLASH used",
  whiteout: "whiteout",
};

export function RecordPage() {
  return (
    <Page
      lead="A Run of a Bot writes a Run record to `lab/runs/` at its end, and from its origin, its keys alone replay the Run."
      details={[
        ["Fields", "format version, origin (ROM, seed, save, names), Bot (with its Model provider, its Coach if it has one, and its cost limit or Token limit; a record with no provider played on `openrouter`), keys at each frame, events, track, State track and result."],
        ["Track", "the place of the player at each change of cell, map or facing: 6 numbers (frame, map group, map number, x, y, facing), apart from the events. The Race tab draws it."],
        ["State track", "the team and the battle at each change, apart from the events: the species, nickname, level, max HP and moves of the team; the HP and status of the team; the two Pokémon of a battle with the name of the trainer. The Harness compares raw bytes at each frame and decodes only on a change. The Race tab shows it."],
        [
          "Game events",
          "from the game state, with typed fields: map, battle, Milestone, heal (Pokémon Center, item or other, with the HP of the party before and after), purchase, item (found or received), catch, faint (of the player or of the enemy), level (with the new moves and the evolution), money (before, after and cause), trainer beaten, obstacle removed (the move, the map, the cell and the Pokémon), FLASH used (the map and the Pokémon) and whiteout.",
        ],
        ["Old record", "a record from before format 1 has only the map, battle and Milestone events, and the facts of the record say “No Game events in this record”. A record from before format 2 has no track, and a record from before format 3 has no State track; a replay and Continue still work on them. `bun run migrate` replays the keys of each one, and writes the track and the State track, and the Game events of the state when the record has none; it does not change the keys."],
        ["Replay", "choose the record in the list of the Run, in the top bar."],
        [
          "Continue",
          "“continue” in the form “Bots”: the Harness replays the keys of the record, keeps its events (Memory tree, Mission, Atlas), and the Bot continues to play. The replay must give the map, battle and Milestone events of the record, or the Harness refuses to start. The other Game events come from the replay, so a better read of the game replaces those of the record. The new record has the old keys and events, then the new ones. Its cost limit or its Token limit counts the new Model calls only, and its model and its Model provider can be other ones.",
        ],
        [
          "Keep the same Run",
          "the checkbox of the form “Bots” after “continue”: an Extended Run plays on with the model, the Coach and the Model provider of the record, and the Bot version of now. It keeps the id, and its new record replaces the file under the same name, so it has no new parent. The header lists each earlier part with its Bot, its result and its end. The limit counts from 0. The checkbox is disabled when another record names this one as its parent, or when a Run plays from it.",
        ],
        ["Prompt", "the prompt of the model bot does not use the new kinds of Game events yet."],
        ["Parallel Runs", "10 emulators at most: the Viewer Run, and 9 places in workers for the Runs of the Bots (at full speed) and the replays of the Grid (at the speed of its cursor), all with no sound. A Run of a Bot gives the same Run record as alone. The form “Bots” starts N Runs of a Bot at one time, each with its own limit."],
      ]}
    >
      <div class={BLOCKS2}>
        <Block label="📼 A Run record">
          <Terms
            numbered
            rows={[
              ["Format version", "a record before format 1 has only map, battle and Milestone events; a record before format 2 has no track; a record before format 3 has no State track"],
              ["Origin", "ROM, seed, save, and the names that the Run wrote in its copy of the save"],
              ["Bot", "its name and version; for an Extended Run, those of the last part"],
              ["Parts", "only for an Extended Run: the Bot, the result and the end of each earlier part"],
              ["Keys", "the buttons at each frame"],
              ["Events", "the Game events, the Model calls"],
              ["Track", "the place of the player at each change of cell, map or facing"],
              ["State track", "the team and the battle at each change"],
              ["Result", "the reason of the end, and the text of the provider at a `plan limit`"],
            ]}
          />
        </Block>
        <Block label="🎯 Game events" sub="From the game state, with typed fields.">
          <Pills>
            {Object.values(EVENT_KINDS).map((kind) => (
              <Pill key={kind}>{kind}</Pill>
            ))}
          </Pills>
        </Block>
      </div>
      <div class={GRID3}>
        <DocCard icon={Play} title="Replay" lines={["choose the record in the list of the Run, in the top bar"]} />
        <DocCard icon={Repeat} title="Continue" lines={["the Harness replays the keys, keeps the Memory tree, the Mission and the Atlas", "the cost limit or the Token limit counts the new Model calls only"]} />
        <DocCard icon={Layers} title="10 at most" lines={["the Viewer Run, and 9 places in workers for the Runs of the Bots and the Grid replays", "a Run in a worker gives the same record as alone"]} />
      </div>
    </Page>
  );
}

export function SpeedPage() {
  return (
    <Page
      lead="A walk moves at the best speed that the game and the choice of the Bot allow. The Run shows it in its frames only."
      details={[
        ["Running", "when the player has the Running Shoes (`FLAG_SYS_B_DASH`), each step holds B with the direction. The Bot does not choose it. The game itself stops the run on a map that does not allow it, for example a house or a gym, and slows it on rock stairs. On a walk, B has no other use, and the Harness stops at the first frame of an Interruption, so B does not close a text."],
        ["The choice to ride", "`use BICYCLE` changes the choice of the Bot. The choice stays until the next `use BICYCLE`, also in a Continued Run and in an Extended Run. Before each leg of a walk, the Harness puts the player in the state of this choice, when the map allows the BICYCLE, the player is not on the Cycling Road and the player does not surf."],
        ["On and off", "the first time, the Harness opens the Bag and selects REGISTER. After that, a press of Select changes the state in 2 frames, with no fade and no text. A `use BICYCLE` where the game refuses the BICYCLE takes no frame: it keeps the choice for the next walk where the game allows it."],
        ["At a door", "the game puts a rider on foot on a map that does not allow the BICYCLE, for example most buildings. Many caves allow it, so the rider stays on the BICYCLE there. The next walk on a map that allows it rides again, with no action of the Bot. The first floor of a gate of the Cycling Road allows it. FireRed has no cell that forbids a BICYCLE."],
        ["Cycling Road", "the Routes 16, 17 and 18 between their two gates. A gate stops a person with no BICYCLE, and the game puts each other person on the BICYCLE. The player must ride until a gate. A trigger with no text in a gate stops a `goTo`: the next `goTo` continues. After the gate, a walk stops the ride when the Bot did not choose to ride."],
        ["Slopes", "Route 17 has them. A slope pulls a rider to the south, unless the rider holds B. So on a walk, a way south holds no B, each other way and each stop holds B, and the player stays on the cell that the walk asked for. A menu action or a Raw input holds no B, so the slope can pull the rider: the next Decision point shows the new cell. A rider who stops on a slope faces south. A direction on a slope is a step, not a turn: so `interact` works on the cell to the south, and on another side it fails with its reason."],
      ]}
    >
      <Block label="🏃 Frames for each cell">
        <div class={GRID3}>
          <DocCard icon={Footprints} title="On foot" lines={["16 frames", "with no Running Shoes, or where the map does not allow a run"]} />
          <DocCard icon={Rabbit} title="Running" lines={["8 frames", "with the Running Shoes, where the map allows a run"]} />
          <DocCard icon={Bike} title="BICYCLE" lines={["6 frames", "when the Bot chose to ride; 4 down a slope and 16 on another way"]} />
        </div>
      </Block>
    </Page>
  );
}

export function NotYetPage() {
  return (
    <Page
      lead="Here the Harness sees a busy game: no Decision point, no action."
      details={[
        ["Menus", "the mailbox of the PC, the Bag outside use, teach, sell and deposit: the Harness sees a busy game. At the Pokémon PC, the Harness does not move a Pokémon between boxes or release a Pokémon."],
        ["Learn a move", "a level up outside a battle (Rare Candy) and a move tutor: the question to learn a move is not a Decision point there."],
      ]}
    >
      <div class={GRID2}>
        <DocCard icon={TriangleAlert} tone="warn" title="Menus" lines={["the mailbox of the PC", "the Bag outside use, teach, sell and deposit", "a move between boxes or a release at the Pokémon PC"]} />
        <DocCard icon={TriangleAlert} tone="warn" title="Learn a move" lines={["a level up outside a battle (Rare Candy)", "a move tutor"]} />
      </div>
    </Page>
  );
}
