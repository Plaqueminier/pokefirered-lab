import { Bike, ChevronRight, CircleHelp, Coins, Footprints, Hand, Layers, OctagonX, Play, Rabbit, Repeat, Skull, Timer, TriangleAlert, Trophy } from "lucide-preact";
import type { EndReason } from "../src/protocol";
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
  {
    form: "goTo(x, y, map?)",
    when: "walk",
    effect:
      "Goes to a cell, also on another map: doors, stairs, edges, ledges. With an exit as the cell and no map, it takes the exit. With a map, a door is the cell next to it, because the game moves the player off the door. The route does not cross a thin wall. " +
      "On another map, the route uses the cells of that map at the last step of the player on it, after the map scripts. On a map with no step of the player on it, it uses the cells of the ROM. " +
      "Some map scripts read a flag or a var that another map changes: the switch of Pokémon Mansion, and the floor switches of Victory Road, which Route 23 resets. " +
      "For these maps, the route uses the cells of the last step with the values now. With no such step, it uses the cells of the ROM. The Atlas shows the same cells. " +
      "The exits of another map stay the exits of the ROM, because the game sets the destination of an Elevator exit again at each entry. " +
      "A step on land between two cells of different elevations is impossible, as in the game. A step from or to a cell at elevation 0 is possible. No layout of FireRed has a cell at elevation 15. " +
      "Water at elevation 3, the elevation of the shore, is an open cell: the player walks on it with no SURF, as on the east edge of Route 14. " +
      "A target at another elevation of the same map, with no stairs that the player saw, gets its own reason: “(x, y) is on another level of <map> than you”. " +
      "When a leg arrives on another map at a cell where an earlier leg of the same walk arrived, the result is `impossible`: the way through the other maps is not open. " +
      "So a route through the other maps that goes in a loop stops with “the walk arrives again at …”. " +
      "A blocked cell that the player saw gets its own reason, not “no route”. A water cell gets one too, while the party cannot use SURF. " +
      "When only a person or an object that does not move closes all the ways, it returns `blocked` at once. It names the person or the object, if the player saw it; for a person who walks, it waits and tries again. " +
      "It also crosses a cut tree or a rock that the party can remove: it faces the obstacle, presses A, answers YES, reads the texts and steps. The result has no text of this. " +
      "When a Pokémon can remove a cut tree or a rock but the player does not have the badge, the reason names the badge. " +
      "When the party can use SURF, it crosses water too. On the shore, it faces the water, presses A and answers YES. The step to the land ends SURF. It never pushes a boulder: a `goTo` past one names `push`, or badge 4 when it is missing. " +
      "When a Pokémon of the party knows FLY and the player has badge 3, it flies when the flight takes fewer frames than the walk. A flight takes 700 frames. A step takes 6 frames on the BICYCLE, and 8 with the Running Shoes on a map that allows Running. It takes 8 frames on the water too, and 16 frames in each other case. It flies from a town or a route, never from the Safari Zone. " +
      "It flies to a place of the fly map that the player entered, in the region of the player. This can be on the map of the player. It opens the party menu, chooses FLY, moves the cursor of the fly map to the place and presses A. " +
      "The player arrives in front of the Pokémon Center, and the walk continues from there. On a map that is dark for the model, it refuses an unseen cell, and its route uses only seen cells. " +
      "A route never steps on a spin tile. A goTo to a spin tile walks to a cell next to it, steps on it and waits for the end of the slide; the result then has `slidTo`, the cell where the player stopped. " +
      "A goTo to a cell of another Part with no way on foot names the two Parts. It says that only a slide leaves the Part of the player. " +
      "A route to another cell takes the Same-map pads of the Saffron Gym and of Silph Co on its way. A goTo to a Same-map pad takes this pad: the route ends with a step onto it. " +
      "When the player stands on the pad, the walk first steps to a cell next to it. The walk ends at the arrival cell of the pad, and the result then has `padTo`, this cell. " +
      "The walk runs when the player has the Running Shoes and the map allows it. It rides when the Bot chose the BICYCLE (page “Running and the BICYCLE”).",
    cards: { walk: "go to a cell, also on another map; at an exit, take it" },
  },
  { form: "walkOn(x, y, direction)", when: "walk", effect: "Goes to a seen cell, then continues in one direction while the map is dark for the model. When a wall closes that direction, it goes along the wall to the side that the walk to the seen cell took, while that side of the wall has unseen cells near it. When the seen cell is straight in that direction from the start, it does not go along a wall. It stops at a wall in front, before an exit, before a ledge, at a new person and at a battle. Only the code of a Bot asks for it: the model writes `go` to an unseen cells target.", cards: { walk: "in the dark, continue in one direction" } },
  {
    form: "push(x, y, direction, steps?)",
    when: "walk",
    effect:
      "Pushes the boulder at (x, y) that the player saw, `steps` cells to `direction` (1 when it is not given). It needs a Pokémon of the party that knows STRENGTH and badge 4. It goes to the cell behind the boulder with a route, faces the boulder, and starts STRENGTH with no question when the STRENGTH flag of the game is clear: a map load clears it. Then each push is one step of the player to the cell behind. It stops before `steps` at a blocked cell, on a switch, at a hole and at a battle. The result has `push`: the pushes, the cell of the boulder, the direction and the cause of the stop, with the map below a hole. It is `impossible` on the water, when the cell behind the boulder is water, with no route to the cell behind, and when `steps` is not a whole number of 1 or more. A route never pushes a boulder.",
    cards: { walk: "go behind the boulder, then push it" },
  },
  { form: "interact(x, y)", when: "walk", effect: "Turns to the next cell and presses A: a person, a sign, a PC, an item. A rider on a slope does not turn (page “Running and the BICYCLE”).", cards: { walk: "turn to the next cell and press A" } },
  {
    form: "readText()",
    when: "text, busy game",
    effect:
      "Reads the texts to the end of the box or to a choice. After a whiteout, it reads to the walk in the Pokémon Center or the house. The word screen of a profile (Easy Chat) has no action: while an action waits, the Harness leaves it (B, then YES), and the result has `leftWordScreen`. In an Arena build, a text of the Arena message panel and the End screen also wait for it, when Auto mode is off.",
    cards: { text: "read to the end of the box or to a choice" },
  },
  {
    form: "choose(option)",
    when: "yes/no, nickname after a catch, script menu, list menu, grid menu of the school blackboard, menus of the PC, Safari battle",
    effect:
      "Moves the cursor to the option and presses A. SOMEONE'S PC or BILL'S PC opens the Pokémon PC. " +
      "The list menu is the special ListMenu of the game: the floors of the Silph Co elevator (11F to 1F, and EXIT), and the badge guide in a house of Cerulean City. " +
      "In a battle of the Safari Zone, the battle action menu is a choice: BALL, BAIT, ROCK and RUN, in 2 columns.",
    cards: { choice: "yes/no, a script or list menu, the menus of the PC, the Safari battle menu" },
  },
  { form: "fight(move, foe?)", when: "battle", effect: "Uses the move 0 to 3, and gives the messages of the turn. With no PP in all the moves, selects FIGHT: the game uses STRUGGLE. Under an ENCORE, FIGHT plays the encored move, and another move is impossible. In a double battle, it is the choice for one Pokémon: the choice for the first Pokémon gives no messages, and the game then waits for the action of the second one. `foe` is 1 or 2, and it is impossible with one foe to choose. With no foe, a move that hits one foe hits foe 1.", cards: { battle: "use the move 0 to 3; no PP: STRUGGLE" } },
  { form: "switch(slot)", when: "battle", effect: "Sends another Pokémon of the party into the battle.", cards: { battle: "send another Pokémon" } },
  { form: "send(slot)", when: "party menu of a battle", effect: "Sends a Pokémon, for example after a faint.", cards: { battle: "send a Pokémon after a faint" } },
  { form: "swap(first, second)", when: "walk", effect: "Changes the order of two Pokémon of the party.", cards: { walk: "change the order of two Pokémon" } },
  { form: "run()", when: "wild battle", effect: "Escapes. Impossible against a trainer.", cards: { battle: "escape a wild battle" } },
  {
    form: "use(item, on?, move?)",
    when: "battle, walk",
    effect:
      "Uses an item of the Bag, on a Pokémon for a Potion. A Poké Ball catches in a wild battle. A Berry goes through the BERRY POUCH. ETHER, MAX ETHER and LEPPA BERRY name a move, on a walk and in a battle, and ELIXIR and MAX ELIXIR work on a Pokémon. On a walk, PP UP and PP MAX name a move, and the medicines, RARE CANDY and the evolution stones work on a Pokémon. RARE CANDY and a stone continue through the new stats, the moves and the evolution, and can stop at the learn-move question of the game. REPEL, SUPER REPEL, MAX REPEL and ESCAPE ROPE work alone (ESCAPE ROPE goes to another map). BICYCLE changes the choice of the Bot to ride or to walk, with no Bag after the first time. Impossible on an Egg, impossible with the moves when a move is missing or unknown, and impossible with the reason of the game when the item does nothing.",
    cards: { walk: "a medicine, a PP item, RARE CANDY, a stone, a Berry, REPEL, ESCAPE ROPE, BICYCLE", battle: "a Potion, an ETHER, a Berry, a Poké Ball" },
  },
  {
    form: "teach(item, on)",
    when: "walk",
    effect: "Teaches the move of a TM or an HM of the Bag to a Pokémon, through the TM Case and the party menu of the game, and returns to the walk. A TM leaves the Bag, and an HM stays. With 4 moves, it stops at the learn-move question of the game. Impossible for a Pokémon that cannot learn the move or that knows it.",
    cards: { walk: "the move of a TM or an HM" },
  },
  {
    form: "give(item, on)",
    when: "walk",
    effect: "A Pokémon holds an item of the Bag, through the Bag (or the BERRY POUCH), GIVE and the party menu. When the Pokémon holds an item, the action answers YES to the swap, and the result says it. Impossible for an item with no effect when a Pokémon holds it, an item that the Pokémon holds, an Egg, a Pokémon that holds Mail, and a swap when the old item has no room in the Bag.",
    cards: { walk: "an item for a Pokémon to hold" },
  },
  {
    form: "take(on)",
    when: "walk",
    effect: "Puts the item that a Pokémon holds in the Bag, through the party menu. Impossible for a Pokémon with no item, an Egg, a Pokémon that holds Mail, and a full Bag. The take is not an item event.",
    cards: { walk: "the item that a Pokémon holds" },
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
    when: "learn a move: “Delete a move to make room for …?”, after a level up in a battle, a RARE CANDY, an evolution, or a TM or an HM",
    effect: "Selects YES and the move on the summary screen: the Pokémon forgets it and learns the new move. After an item, it also returns to the walk, or stops at the next learn-move question. Impossible for a move or a place that the Pokémon does not know, or an HM move.",
    cards: { learn: "forget it and learn the new move" },
  },
  { form: "keep()", when: "learn a move", effect: "Selects NO, then YES at “Stop learning …?”: the Pokémon keeps its 4 moves. After an item, the action returns to the walk, or stops at the next learn-move question, and a TM or an HM stays in the Bag.", cards: { learn: "keep the 4 moves" } },
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
          "what the game waits for, the Milestones, the Atlas, the Bag (items, quantities, effect, price, what the item does when the player uses it in a battle (`effect`: the HP that it heals, the status that it cures, a revive, a stat that it raises), the move of a TM or an HM, and if the item has an effect when a Pokémon holds it) and the money, and the party as the Summary screen shows it (types, ability, held item with its description and if it is Mail, nature, stats, EXP now, at the start of the level and to the next level, and the status, where `bad poison` is not `poison`; for each move its type, power, accuracy, PP and description). On the map: the kind of the map (outdoor, underground or indoor), the grid, the people, the fixed obstacles, the Pokémon in the boxes (species, nickname, level, box and place, types, ability, and the moves as for the party), the items of the PC, whether a REPEL is active, whether the player rides, whether the Bot chose to ride, whether the player is on the water with SURF, the Fly destinations that the player visited (except the one on the map of the player, and none in the Safari Zone) and whether the party can use FLY, each TM and HM of the Bag with its move and the Pokémon that can learn it or know it, and each evolution stone of the Bag with the Pokémon that it can evolve and the species that they become. The Atlas gives the rival with its name from the save. At the learn-move question after a `teach` or an item, the mode is `menu`, with no facts of the map.",
        ],
        [
          "Battle facts",
          "the player's Pokémon, and the enemy as the player sees it, with its types. Both have `states`: the volatile states that a text of the game tells (seeded, confused, infatuated…). The Pokémon of the player also has the abilities of its species and its toxic counter. " +
            "In a wild battle: `inPc`, the number of Pokémon of the enemy species in the boxes of the PC (the party is in `party`). For each move: its effect on the enemy (type chart of the game), STAB and the damage estimate. The estimate is in percent of the enemy HP and in hits to KO. " +
            "A move can also have its chance to hit now (`hitChance`, only when the stages of accuracy and evasion change it). It can have a flag for 2 turns or a recharge turn (`turns`). It can have the ability of the enemy that stops it (`abilityBlock`, from the abilities of its species). " +
            "`speed` has the speed of the Pokémon of the player in the order of a turn. It counts the stat, the stage, the badge boost and the paralysis. At the `full` Knowledge level, it also has the speed of each enemy with the same rules. " +
            "The facts also have the last turn and the turns against the current enemy.",
        ],
        [
          "Unknown GHOST",
          "a GHOST that the game does not identify, because the Bag has no SILPH SCOPE. The battle has `ghost: true`, and the enemy has the species GHOST, no types and no moves seen. " +
            "The enemy keeps its level, its HP, its status and its states. At the `full` Knowledge level, it also has its exact HP and stats, as each enemy has. " +
            "The facts of each move are null, because they tell the type of the enemy. The last turn names the enemy GHOST. " +
            "The battle start in the Run record also names the foe GHOST. So the Viewer and the line after the battle show GHOST, not the species. " +
            "In a wild battle, `inPc` counts the species GHOST in the PC, so it is 0.",
        ],
        [
          "Safari Zone",
          "at a walk in the Safari Zone, `observe()` also has `safari`: the steps and the SAFARI BALLs left. " +
            "A battle there has `safari` too: the SAFARI BALLs left and the chance in percent that the foe flees at its next turn (`fleePercent`). Its battle action menu is a choice (see `choose`).",
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
            <Code>{RAW_INPUT_FORM}</Code> one press when no Macro-action fits. The Harness counts them. A in front of a cut tree or a rock that the party can remove uses the move, with no question and no text. A in front of water uses SURF when the party can use it. During the animation of an evolution, the Harness removes B, so the press reaches the game after the animation.
          </p>
        </Block>
      </div>
      <Block label="👁️ observe()" sub="What the game waits for, and the state of the game.">
        <div class={GRID3}>
          <DocCard title="World" lines={["the Milestones, the Atlas", "on the map: the kind of the map, the grid, the people, the fixed obstacles, the Pokémon in the boxes with their moves, the items of the PC, whether a REPEL is active, the Fly destinations, each TM and HM of the Bag with who can learn it"]} />
          <DocCard title="Party and Bag" lines={["the party as the Summary screen shows it, with bad poison", "the Bag (quantity, price, the effect of each item, the move of a TM) and the money"]} />
          <DocCard title="Battle" lines={["the enemy as the player sees it, with its types and states", "each move: effect, STAB, damage estimate, chance to hit, 2 turns, the ability that stops it"]} />
        </div>
      </Block>
    </Page>
  );
}

const STEPS: string[] = ["has-pokemon", "first-rival-battle", "pokedex", "badge-1 … badge-8", "victory-road", "indigo-plateau", "elite-four-1 … elite-four-4", "champion"];

export function MilestonesPage() {
  return (
    <Page
      lead="The steps of the story, read from the game flags."
      details={[
        ["Order", "`has-pokemon` → `first-rival-battle` → `pokedex` → `badge-1` … `badge-8` → `victory-road` → `indigo-plateau` → `elite-four-1` … `elite-four-4` → `champion`."],
        ["Goal", "the goal of a scripted Bot is a Milestone. The model bot has no goal: the code gives it the next Milestone in the prompt, and its Run continues after it. With no goal, a Run ends at the last Milestone, `champion`."],
        ["A Milestone stays", "the Milestones of a Run are the Milestones of its flags and of its Run record. A whiteout clears the flags of the Elite Four, but their Milestones stay, and the event of a Milestone comes only once."],
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
          ["`victory-road`, `indigo-plateau`", "the first entry into VictoryRoad_1F, and into IndigoPlateau_Exterior"],
          ["`elite-four-1` … `elite-four-4`", "the player beats Lorelei, Bruno, Agatha, then Lance"],
          ["`champion`", "the Hall of Fame, after the Champion"],
          ["Scripted Bot", "its goal is a Milestone"],
          ["Model bot", "no goal: the code gives it the next Milestone in the prompt, and its Run continues after it"],
        ]}
      />
    </Page>
  );
}

const END: Record<EndReason, { icon: typeof Trophy; tone?: InfoTone; lines: string[]; detail: string }> = {
  goal: { icon: Trophy, tone: "ok", lines: ["the goal Milestone is reached", "with no goal: `champion`"], detail: "the goal Milestone is reached (with no goal: `champion`)." },
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
  "time limit": {
    icon: Timer,
    tone: "warn",
    lines: ["the game time reaches the Time limit of a model bot", "after a battle at the limit: the next walk"],
    detail: "the game time from frame 0 reaches the Time limit of a model bot. A battle at the limit plays to its end, and the Run ends at the next walk, or at the start of another battle. So its Milestone counts, also when a script gives it after the battle. A whiteout at the end of this battle also gives this reason.",
  },
  "no progress": { icon: Repeat, tone: "warn", lines: ["the stuck counter reaches N, when the Bot or the Run gives N", "the Genetic bot: 200"], detail: "the stuck counter reaches N, when the Bot or the Run gives N (the Genetic bot: 200)." },
  whiteout: {
    icon: Skull,
    tone: "bad",
    lines: ["the whiteout that reaches the Whiteout limit", "a model bot, 3 by default"],
    detail:
      "all the Pokémon of the party faint, in or out of a battle. This whiteout reaches the Whiteout limit of a model bot (3 by default). The Run ends after the action that reads the whiteout. An Extended Run counts the whiteouts of all its parts. The rules of the prompt tell the model the limit, and also not to play too safe. The result keeps the last text of the game.",
  },
  "unknown screen": {
    icon: CircleHelp,
    tone: "bad",
    lines: ["B on 3 screens in a row that no action covers"],
    detail: "the model bot pressed B for 3 screens in a row that no action covers, with no Model call between them, or the Genetic bot pressed B for 3 screens in a row with no Decision point between them. The result keeps the last text of the game.",
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
  surf: "SURF used",
  strength: "STRENGTH used",
  fly: "FLY used",
  whiteout: "whiteout",
};

export function RecordPage() {
  return (
    <Page
      lead="A Run of a Bot writes a Run record to `lab/runs/` at its end, and from its origin, its keys alone replay the Run."
      details={[
        [
          "Fields",
          "format version, origin (ROM, seed, save, names) and Bot. " +
            "The Bot has its Model provider, its Coach if it has one, its cost limit or Token limit, its Whiteout limit and its Time limit. " +
            "A record with no provider played on `openrouter`, and a Genetic bot has its Genome. " +
            "A Continued Run also has its parent and the first frame of its Run. " +
            "Then come the Fitness of a new best of an Evolution and the Genome id of a Genome of an Evolution. " +
            "Last come the keys at each frame, the events, the track, the State track and the result.",
        ],
        ["Track", "the place of the player at each change of cell, map or facing: 6 numbers (frame, map group, map number, x, y, facing), apart from the events. The Race tab draws it."],
        ["State track", "the team and the battle at each change, apart from the events: the species, nickname, level, max HP and moves of the team; the HP and status of the team; the two Pokémon of a battle with the name of the trainer. The Harness compares raw bytes at each frame and decodes only on a change. The Race tab shows it."],
        [
          "Game events",
          "from the game state, with typed fields: map, battle (a start has the trainer flag and the foe: the name of the trainer, or the species of a wild Pokémon), Milestone, heal (Pokémon Center, item or other, with the HP of the party before and after), purchase, item (found or received), catch, faint (of the player or of the enemy), level (with the new moves and the evolution), money (before, after and cause), trainer beaten, obstacle removed (the move, the map, the cell and the Pokémon), FLASH used (the map and the Pokémon), SURF used (the map, the cell of the shore and the Pokémon), STRENGTH used (the map, the cell of the boulder and the Pokémon), FLY used (the map of departure, the map and the name of the Fly destination, and the Pokémon) and whiteout.",
        ],
        ["Trainer levels", "since bot version 52, the event of a trainer beaten also has the levels of the Pokémon of the trainer. An event of an older record has no levels."],
        ["Old record", "a record from before format 1 has only the map, battle and Milestone events, and the facts of the record say “No Game events in this record”. A record from before format 2 has no track, and a record from before format 3 has no State track; a replay and Continue still work on them. `bun run migrate` replays the keys of each one, and writes the track and the State track, and the Game events of the state when the record has none; it does not change the keys."],
        ["Seed", "the seed of the game RNG, `gLabRngSeed` in the ROM (`0x4c41`). `--seed` of `bun run bot` gives another one: the Harness writes it in the ROM image before the boot. The header keeps it, and the replay, the Grid and Continue play with the seed of the record."],
        ["Replay", "choose the record in the list of the Run, in the top bar."],
        [
          "Continue",
          "“continue” in the form “Bots”: the Harness loads the Checkpoint of the record or replays its keys, and keeps its events. " +
            "The events give the Memory tree, the Mission, the Atlas, and in a battle the last turn and the turns against the foe. " +
            "Then the Bot continues to play. " +
            "A replay must give the map, battle and Milestone events of the record, or the Harness refuses to start. " +
            "With a replay, the other Game events come from the replay, so a better read of the game replaces those of the record. " +
            "The new record has the old keys and events, then the new ones. Its cost limit or its Token limit counts the new Model calls only, and its model and its Model provider can be other ones. " +
            "The Genetic bot continues with the Genome of the header.",
        ],
        [
          "Keep the same Run",
          "the checkbox of the form “Bots” after “continue”: an Extended Run continues with the model, the Coach and the Model provider of the record, and the Bot version of now. " +
            "It keeps the id, and its new record replaces the file under the same name, so it has no new parent. " +
            "The header lists each earlier part with its Bot, its result and its end. " +
            "The cost limit or the Token limit counts from 0. " +
            "The Whiteout limit and the Time limit stay those of the start, and they count all the parts. " +
            "The checkbox is disabled when another record names this one as its parent, or when a Run plays from it. " +
            "It is also disabled after the end reason `whiteout` or `time limit`, and after `goal` at `champion`. " +
            "The goal of an Extended Run is `champion`. So a Run that ended with `goal` at an older goal, for example `badge-8` before bot version 52, continues. " +
            "The new part continues in the worker of the last part when this worker is still idle. Then it has no replay and no Checkpoint. " +
            "A file of `lab/src` or `lab/bots` that changed since the start of the worker needs a new worker, which loads the Checkpoint.",
        ],
        [
          "Checkpoint",
          "at the end of a Run of the Viewer, the server writes `<name>.json.checkpoint` next to the record: the savestate, the save data and the state of the watches of the Harness. " +
            "Continue and Keep the same Run load it in place of the replay. A notice tells how the Run started. " +
            "With a Checkpoint of another record, of another format or with other fields, the Harness replays the keys, and the notice tells why. " +
            "A Run that ends with an error writes none. `--continue` of `bun run bot` replays the keys.",
        ],
        ["Prompt", "the prompts of the model bot use some Game events: the line after a battle, the counts of a Review turn and the Coach advice. Since bot version 52, the Team line of a Check map also reads the levels of the trainers beaten."],
        [
          "Parallel Runs",
          "10 emulators at most: the Viewer Run, and 9 places in workers. " +
            "The places are for the Runs of the Bots, at full speed, and the replays of the Grid, at the speed of its cursor. They have no sound. " +
            "A Run of a Bot gives the same Run record as alone. The form “Bots” starts N Runs of a Bot at one time, each with its own limit. " +
            "After its end, the worker of a Run stays idle for Keep the same Run: 4 idle workers at most, out of the limit of 10. A removed cell closes its worker. " +
            "An Evolution plays its own Runs out of this limit (page “Evolution”).",
        ],
      ]}
    >
      <div class={BLOCKS2}>
        <Block label="📼 A Run record">
          <Terms
            numbered
            rows={[
              ["Format version", "a record before format 1 has only map, battle and Milestone events; a record before format 2 has no track; a record before format 3 has no State track"],
              ["Origin", "ROM, seed, save, and the names that the Run wrote in its copy of the save"],
              ["Bot", "its name and version, and the Genome of a Genetic bot; for an Extended Run, those of the last part"],
              ["Fitness", "only for the Run record of a new best of an Evolution: the Fitness version, the note and the points of each term"],
              ["Genome id", "`genomeId`, for the Run record of a new best of an Evolution and of `bun run bot genetic --genome <Evolution>:<Genome id>`: the number of its Ghost in a Race"],
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
        <DocCard icon={Repeat} title="Continue" lines={["the Harness loads the Checkpoint or replays the keys, keeps the Memory tree, the Mission and the Atlas", "the cost limit or the Token limit counts the new Model calls only"]} />
        <DocCard icon={Layers} title="10 at most" lines={["the Viewer Run, and 9 places in workers for the Runs of the Bots and the Grid replays", "a Run in a worker gives the same record as alone"]} />
      </div>
    </Page>
  );
}

export function SpeedPage() {
  return (
    <Page
      lead="A walk moves at the best speed that the game and the choice of the Bot allow. The Run shows it in its frames. A route counts these frames to choose between a walk and a flight. On the water, a step takes 8 frames, also with no Running Shoes."
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
        ["Menus", "the mailbox of the PC, the Bag outside use, teach, give, sell and deposit: the Harness sees a busy game. At the Pokémon PC, the Harness does not move a Pokémon between boxes or release a Pokémon."],
        ["Learn a move", "a move tutor: the question to learn a move is not a Decision point there."],
      ]}
    >
      <div class={GRID2}>
        <DocCard icon={TriangleAlert} tone="warn" title="Menus" lines={["the mailbox of the PC", "the Bag outside use, teach, give, sell and deposit", "a move between boxes or a release at the Pokémon PC"]} />
        <DocCard icon={TriangleAlert} tone="warn" title="Learn a move" lines={["a move tutor"]} />
      </div>
    </Page>
  );
}
