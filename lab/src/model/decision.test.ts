import { describe, expect, test } from "bun:test";
import type { BagItem } from "../bag";
import type { BattleState } from "../harness/harness";
import type { PartyMon } from "../party";
import { type Asked, MAX_SENTENCE, readAction, readDecision } from "./decision";
import type { Overworld, Target } from "./targets";

const answer = (fields: Record<string, unknown>) => JSON.stringify({ reason: "r", action: "go 1", mission: "m", objective: "o", note: "n", ...fields });

describe("readDecision", () => {
  test("it reads the five fields of the answer, and cuts the Mission, the objective and the note to their limits", () => {
    expect(readDecision(answer({ reason: " I go north. ", mission: "Get my first Pokémon", objective: "Find Oak" }))).toEqual({
      reason: "I go north.",
      action: "go 1",
      mission: "Get my first Pokémon",
      objective: "Find Oak",
      note: "n",
    });
    expect(readDecision(answer({ mission: "x".repeat(MAX_SENTENCE + 10) })).mission).toHaveLength(MAX_SENTENCE);
    expect(readDecision(answer({ note: "x".repeat(MAX_SENTENCE + 10) })).note).toHaveLength(MAX_SENTENCE);
    expect(readDecision(answer({ objective: "x".repeat(MAX_SENTENCE + 10) })).objective).toHaveLength(MAX_SENTENCE);
  });

  test("it reads the JSON object after text that is not JSON, as a stray brace or a code fence", () => {
    expect(readDecision(`{\n${answer({ action: "go 7" })}`).action).toBe("go 7");
    expect(readDecision(`\`\`\`json\n${answer({ action: "go 2" })}\n\`\`\``).action).toBe("go 2");
  });

  test("it refuses an answer that is not JSON, or that has a field missing or not a string", () => {
    expect(() => readDecision("I go north")).toThrow("the answer is not JSON");
    expect(() => readDecision(" ")).toThrow("the answer is empty");
    expect(() => readDecision(JSON.stringify({ reason: "r", action: "go 1", mission: "m", objective: "o" }))).toThrow('the answer has no string "note"');
    expect(() => readDecision(JSON.stringify({ reason: "r", action: "go 1", objective: "o", note: "n" }))).toThrow('the answer has no string "mission"');
    expect(() => readDecision(answer({ action: 3 }))).toThrow('the answer has no string "action"');
    expect(() => readDecision("[]")).toThrow("the answer is not a JSON object");
  });
});

describe("readAction", () => {
  const overworld = {} as Overworld;
  const battle = { player: { partyIndex: 0 } } as BattleState;
  const party: PartyMon[] = [];
  const edge: Target = { kind: "edge", name: "north edge", label: "north edge, 3 north: not taken", side: "north", to: null };
  const walk = (targets: number, mons = party, bagEmpty = false): Asked => ({
    kind: "walk",
    party: mons,
    overworld,
    view: { lines: [], targets: Array.from({ length: targets }, () => edge) },
    atlasShown: false,
    items: [],
    bagEmpty,
  });
  const choice: Asked = { kind: "choice", party, overworld, options: ["YES", "NO"] };

  test("at a walk: a target, a cell of the map or of another map, or a Raw input, also in the form with parentheses", () => {
    expect(readAction("go C", walk(3))).toEqual({ name: "go", target: 2 });
    expect(readAction(" GO b ", walk(3))).toEqual({ name: "go", target: 1 });
    expect(readAction("goTo 12 -1", walk(3))).toEqual({ name: "goTo", x: 12, y: -1 });
    expect(readAction("goTo 3 4 Route1", walk(3))).toEqual({ name: "goTo", x: 3, y: 4, map: "Route1" });
    expect(readAction("press select", walk(3))).toEqual({ name: "press", button: "Select" });
    expect(readAction("zoom 1-8", walk(3))).toEqual({ name: "zoom", from: 1, to: 8 });
    expect(readAction("zoom #13", walk(3))).toEqual({ name: "zoom", from: 13, to: 13 });
    expect(readAction("press(Up)", walk(3))).toEqual({ name: "press", button: "Up" });
    expect(readAction("go(B)", walk(3))).toEqual({ name: "go", target: 1 });
    expect(readAction("goTo(4, 7)", walk(3))).toEqual({ name: "goTo", x: 4, y: 7 });
    expect(readAction("goTo 9, 42", walk(3))).toEqual({ name: "goTo", x: 9, y: 42 });
  });

  test("at a choice: an option of the choice, in any case", () => {
    expect(readAction("choose no", choice)).toEqual({ name: "choose", option: "NO" });
    expect(() => readAction("choose MAYBE", choice)).toThrow('"MAYBE" is not an option: YES, NO');
    expect(readAction("choose(NO, THANKS)", { ...choice, options: ["YES", "NO, THANKS"] })).toEqual({ name: "choose", option: "NO, THANKS" });
    expect(() => readAction(`choose ${"o".repeat(500)}`, choice)).toThrow(`"${"o".repeat(80)}" is not an option`);
  });

  test("in a battle: a move, run or a Raw input; in the party menu: Raw inputs only", () => {
    expect(readAction("fight 1", { kind: "battleAction", party, battle, items: [] })).toEqual({ name: "fight", move: 1 });
    expect(readAction("fight 0", { kind: "battleMove", party, battle, items: [] })).toEqual({ name: "fight", move: 0 });
    expect(readAction("run", { kind: "battleAction", party, battle, items: [] })).toEqual({ name: "run" });
    expect(readAction("press A", { kind: "partyPick", party, battle, items: [] })).toEqual({ name: "press", button: "A" });
    expect(() => readAction("fight 1", { kind: "partyPick", party, battle, items: [] })).toThrow('"fight" is not an action now: use zoom or press');
  });

  test("press Start is not read: its reason tells that there is no Start menu, names use and the items of the Bag that work now, or tells that none works", () => {
    const potion: BagItem = { name: "POTION", quantity: 5, description: "", price: 300, battle: "pokemon", walk: "pokemon" };
    expect(() => readAction("press Start", { kind: "battleMove", party, battle, items: [potion] })).toThrow("there is no Start menu: write use <item> to use an item of your Bag; the items that work now: POTION");
    expect(() => readAction("press(start)", walk(3))).toThrow("there is no Start menu: write use <item> to use an item of your Bag; your Bag has no item that works now");
    expect(() => readAction("press Start", walk(3, party, true))).toThrow("there is no Start menu: write use <item> to use an item of your Bag; your Bag is empty");
  });

  test("in a battle: use an item that works now, on a Pokémon of the party for an item that needs one", () => {
    const potion: BagItem = { name: "POTION", quantity: 5, description: "", price: 300, battle: "pokemon", walk: "pokemon" };
    const ball: BagItem = { name: "POKé BALL", quantity: 20, description: "", price: 200, battle: "alone", walk: null };
    const party = [{ nickname: "SQUIRTLE", species: "SQUIRTLE" }, { nickname: "BIRD", species: "PIDGEY" }] as PartyMon[];
    const asked: Asked = { kind: "battleAction", battle, items: [potion, ball], party };
    expect(readAction("use potion on bird", asked)).toEqual({ name: "use", item: "POTION", on: 1 });
    expect(readAction("use Poke Ball", asked)).toEqual({ name: "use", item: "POKé BALL" });
    expect(readAction("use(POTION, BIRD)", asked)).toEqual({ name: "use", item: "POTION", on: 1 });
    expect(() => readAction("use POTION", asked)).toThrow("POTION works on a Pokémon: use POTION on <Pokémon>");
    expect(() => readAction("use POTION on MEW", asked)).toThrow('"MEW" is not a Pokémon of your party: SQUIRTLE, BIRD');
    expect(() => readAction("use ANTIDOTE", asked)).toThrow('"ANTIDOTE" is not an item that works now: POTION, POKé BALL');
  });

  test("at the shop menu of a Poké Mart: buy an item for sale, or sell an item of the Bag that the Mart buys, with a quantity, or leave", () => {
    const potion: BagItem = { name: "POTION", quantity: 5, description: "", price: 300, battle: "pokemon", walk: "pokemon" };
    const asked: Asked = { kind: "shopMenu", forSale: [{ name: "POKé BALL", price: 200 }], sellable: [potion], party: [] };
    expect(readAction("buy Poke Ball 5", asked)).toEqual({ name: "buy", item: "POKé BALL", quantity: 5 });
    expect(readAction("sell potion 2", asked)).toEqual({ name: "sell", item: "POTION", quantity: 2 });
    expect(readAction("leave", asked)).toEqual({ name: "leave" });
    expect(readAction("buy(POTION, 2)", { ...asked, forSale: [{ name: "POTION", price: 300 }] })).toEqual({ name: "buy", item: "POTION", quantity: 2 });
    expect(readAction("buy POTION, 2", { ...asked, forSale: [{ name: "POTION", price: 300 }] })).toEqual({ name: "buy", item: "POTION", quantity: 2 });
    expect(() => readAction("buy POTION 1", asked)).toThrow('"POTION" is not an item for sale: POKé BALL');
    expect(() => readAction("sell ANTIDOTE 1", asked)).toThrow('"ANTIDOTE" is not an item of your Bag that the Poké Mart buys: POTION');
    expect(() => readAction("press B", asked)).toThrow('"press" is not an action now: use buy, sell, leave or zoom');
  });

  test("at the naming screen: name with the rest of the line as the text, with its spaces and its case, or name alone to keep the name; no press", () => {
    const naming: Asked = { kind: "naming", party, subject: "a nickname for BULBASAUR", maxLength: 10, keys: [] };
    expect(readAction("name Mr Bulb", naming)).toEqual({ name: "name", text: "Mr Bulb" });
    expect(readAction("name", naming)).toEqual({ name: "name", text: "" });
    expect(readAction("name(Bulby, Jr.)", naming)).toEqual({ name: "name", text: "Bulby, Jr." });
    expect(readAction("name A, B", naming)).toEqual({ name: "name", text: "A, B" });
    expect(() => readAction("press A", naming)).toThrow('"press" is not an action now: use name or zoom');
  });

  test("it refuses an action that it cannot read, a target that is not in the list and an action of another Decision point", () => {
    expect(() => readAction("walk north", walk(3))).toThrow('"walk north" is not an action');
    expect(() => readAction("goTo 9 north", walk(3))).toThrow('"goTo 9 north" is not an action: write goTo <x> <y>, for example goTo 9 42');
    expect(() => readAction("go D", walk(3))).toThrow("there is no target D: the targets are A to C");
    expect(() => readAction("go 2", walk(3))).toThrow("there is no target 2: the targets are letters, A to C");
    expect(() => readAction("go A", walk(0))).toThrow("there is no target A: the map has no targets");
    expect(() => readAction("choose YES", walk(3))).toThrow('"choose" is not an action now: use go, goTo, viewAtlas, zoom or press');
    expect(() => readAction("fight 4", { kind: "battleAction", party, battle, items: [] })).toThrow('"fight 4" is not an action: write fight <0-3>, for example fight 0');
    expect(() => readAction("press X", walk(3))).toThrow('"press X" is not an action: write press <button>, for example press A');
    expect(() => readAction("a".repeat(500), walk(3))).toThrow(`"${"a".repeat(80)}" is not an action`);
  });

  test("the party actions take a Pokémon of the party by its name in any case, or by its place in the party; a name that is not in the party is refused", () => {
    const mon = (nickname: string, hp = 10) => ({ nickname, hp }) as PartyMon;
    const three = [mon("SQUIRTLE"), mon("SHELL"), mon("PIDGEY", 0)];
    expect(readAction("switch shell", { kind: "battleAction", party: three, battle, items: [] })).toEqual({ name: "switch", slot: 1 });
    expect(readAction("send 2", { kind: "partyPick", party: three, battle, items: [] })).toEqual({ name: "send", slot: 1 });
    expect(readAction("swap PIDGEY SQUIRTLE", walk(0, three))).toEqual({ name: "swap", first: 2, second: 0 });
    expect(() => readAction("switch RATTATA", { kind: "battleAction", party: three, battle, items: [] })).toThrow('"RATTATA" is not a Pokémon of your party: SQUIRTLE, SHELL, PIDGEY');
    expect(() => readAction("send 4", { kind: "partyPick", party: three, battle, items: [] })).toThrow("there is no Pokémon 4: the places in the party are 1 to 3");
  });

  test("a Pokémon argument can give a place with the name, to choose one of two Pokémon with the same name", () => {
    const mon = (nickname: string) => ({ nickname, hp: 10 }) as PartyMon;
    const twins = [mon("IVYSAUR"), mon("CATERPIE"), mon("CATERPIE")];
    expect(readAction("switch CATERPIE (position 2)", { kind: "battleAction", party: twins, battle, items: [] })).toEqual({ name: "switch", slot: 1 });
  });
});
