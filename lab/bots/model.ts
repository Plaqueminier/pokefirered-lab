import { type ActionResult, type Bot, errorText, type Harness, type Observation } from "../src/harness/harness";
import { type ModelAnswer, modelEvents, type ModelOptions, type ModelSettings, modelTotals, type NodeRange, type Prompt, type Starter, type SummaryAnswer, type Turn, type Usage } from "../src/harness/record";
import { type Asked, askedOf, type ModelAction, readAction, readDecision } from "../src/model/decision";
import { dueMerges, type MemoryTree, memoryTree, nodeName, readSummary, summaryPrompt } from "../src/model/memory-tree";
import { type ModelClient, type ModelReply, modelSettings, openRouter, SUMMARY_FORMAT } from "../src/model/openrouter";
import { atlasMessage, B_PRESSES, errorMessage, situation, systemPrompt, userPrompt, zoomMessage } from "../src/model/prompt";
import { approaches, nextTo, type Overworld, type Target } from "../src/model/targets";

const GOAL = "first-rival-battle";
const GOAL_TEXT = "Get your first Pokémon from Professor Oak, then win your first battle against your rival.";
// The cost limit and the no-progress limit stop a model bot, not the frames.
const FRAME_BUDGET = Number.POSITIVE_INFINITY;
const MAX_UNREADABLE = 3;
const NO_USAGE: Usage = { promptTokens: 0, cachedTokens: 0, completionTokens: 0, reasoningTokens: 0, cost: 0 };

export function modelBot(options: ModelOptions = {}, connect: (settings: ModelSettings) => ModelClient = openRouter): Bot {
  const settings = modelSettings(options);
  return {
    name: "model",
    version: "1",
    goal: GOAL,
    model: settings,
    frameBudget: FRAME_BUDGET,
    play: (harness) => new ModelPlay(harness, settings, connect(settings)).play(),
  };
}

function goalText(starter: Starter): string {
  const choice = starter === "free" ? "Choose your first Pokémon as you like: BULBASAUR, CHARMANDER or SQUIRTLE. There is no correct answer." : `Choose ${starter} as your first Pokémon.`;
  return `${GOAL_TEXT} ${choice}`;
}

// The Model calls at one Decision point are one conversation. An action that the Bot plays ends it.
type Conversation = { user: string; turns: Turn[]; atlasViewed: boolean };

class ModelPlay {
  readonly #system: string;
  #conversation: Conversation | null = null;

  constructor(
    private readonly harness: Harness,
    private readonly settings: ModelSettings,
    private readonly ask: ModelClient,
  ) {
    this.#system = systemPrompt(goalText(settings.starter));
  }

  async play(): Promise<void> {
    for (;;) {
      const kind = this.harness.waitingFor().kind;
      if (kind === "text" || kind === "busy") {
        await this.readText();
        continue;
      }
      const observation = this.harness.observe();
      const asked = askedOf(observation, this.#conversation?.atlasViewed ?? false);
      if (!asked) throw new Error(`the model bot does not know this Decision point: ${kind} in the ${observation.mode} mode`);
      const action = await this.harness.modelCall(() => this.answer(observation, asked));
      this.stopAtLimits();
      await this.summarize();
      if (action && action.name !== "viewAtlas" && action.name !== "zoom") {
        this.#conversation = null;
        await this.perform(action, asked);
      }
    }
  }

  private async readText(): Promise<void> {
    if ((await this.harness.readText()).status !== "impossible") return;
    for (let i = 0; i < B_PRESSES; i++) await this.harness.press("B");
  }

  private async answer(observation: Observation, asked: Asked): Promise<{ answer: ModelAnswer; action: ModelAction | null }> {
    const conversation = this.#conversation ?? { user: userPrompt(observation, asked, this.harness.events, this.harness.noProgress), turns: [], atlasViewed: false };
    this.#conversation = conversation;
    const prompt: Prompt = { system: this.#system, user: conversation.user, ...(conversation.turns.length > 0 ? { turns: [...conversation.turns] } : {}) };
    const request = { model: this.settings.id, situation: situation(asked), prompt };
    let reply: ModelReply;
    try {
      reply = await this.ask(prompt);
    } catch (error) {
      return { answer: { ...request, answer: null, usage: NO_USAGE, decision: null, error: `the request failed: ${errorText(error)}` }, action: null };
    }
    const replied = { ...request, answer: reply.content, usage: reply.usage };
    try {
      const decision = readDecision(reply.content);
      const action = readAction(decision.action, asked);
      if (action.name === "viewAtlas" && asked.kind === "walk") {
        conversation.atlasViewed = true;
        conversation.turns.push({ assistant: reply.content, user: atlasMessage(asked) });
      }
      if (action.name === "zoom") conversation.turns.push({ assistant: reply.content, user: zoomMessage(memoryTree(this.harness.events), action, asked) });
      return { answer: { ...replied, decision, error: null }, action };
    } catch (error) {
      conversation.turns.push({ assistant: reply.content, user: errorMessage(errorText(error), asked) });
      return { answer: { ...replied, decision: null, error: errorText(error) }, action: null };
    }
  }

  // One Summary call for each merge that is due, at the same Decision point. A merge whose call failed stays due: the next Model call tries it again.
  private async summarize(): Promise<void> {
    const tried = new Set<string>();
    for (;;) {
      const tree = memoryTree(this.harness.events);
      const node = dueMerges(tree).find((due) => !tried.has(nodeName(due)));
      if (!node) return;
      tried.add(nodeName(node));
      await this.harness.summaryCall(() => this.summary(tree, node));
      this.stopAtCost();
    }
  }

  private async summary(tree: MemoryTree, node: NodeRange): Promise<SummaryAnswer> {
    const prompt = summaryPrompt(tree, node);
    const request = { model: this.settings.id, prompt, ...node };
    let reply: ModelReply;
    try {
      reply = await this.ask(prompt, SUMMARY_FORMAT);
    } catch (error) {
      return { ...request, answer: null, usage: NO_USAGE, summary: null, error: `the request failed: ${errorText(error)}` };
    }
    try {
      return { ...request, answer: reply.content, usage: reply.usage, summary: readSummary(reply.content), error: null };
    } catch (error) {
      return { ...request, answer: reply.content, usage: reply.usage, summary: null, error: errorText(error) };
    }
  }

  private stopAtCost(): void {
    const { cost } = modelTotals(this.harness.events);
    if (cost > this.settings.costLimit) {
      throw new Error(`the cost of the Run (${dollars(cost)} $) is more than the cost limit (${dollars(this.settings.costLimit)} $)`);
    }
  }

  private stopAtLimits(): void {
    this.stopAtCost();
    const calls = modelEvents(this.harness.events);
    const unreadable = calls.length - 1 - calls.findLastIndex((e) => e.decision !== null);
    if (unreadable >= MAX_UNREADABLE) throw new Error(`${MAX_UNREADABLE} answers in a row that the Bot cannot read; the last one: ${calls.at(-1)?.error}`);
  }

  private async perform(action: Exclude<ModelAction, { name: "viewAtlas" | "zoom" }>, asked: Asked): Promise<void> {
    switch (action.name) {
      case "go":
        if (asked.kind !== "walk") throw new Error("go is an action of a walk only");
        return this.go(asked.view.targets[action.target - 1], asked.overworld);
      case "goTo":
        await this.harness.goTo(action.x, action.y, action.map);
        return;
      case "choose":
        await this.harness.choose(action.option);
        return;
      case "fight":
        await this.harness.fight(action.move);
        return;
      case "run":
        await this.harness.run();
        return;
      case "press":
        await this.harness.press(action.button);
        return;
    }
  }

  private async go(target: Target, overworld: Overworld): Promise<void> {
    if (target.kind === "map") {
      await this.harness.goTo(target.cell.x, target.cell.y, target.map);
      return;
    }
    const interactAt = target.kind === "person" || target.kind === "sign" ? target.cell : null;
    if (interactAt && nextTo(overworld.player, interactAt)) {
      await this.harness.interact(interactAt.x, interactAt.y);
      return;
    }
    let status: ActionResult["status"] = "impossible";
    for (const cell of approaches(target, overworld)) {
      status = (await this.harness.goTo(cell.x, cell.y)).status;
      if (status !== "impossible") break;
    }
    if (interactAt && status === "done") await this.harness.interact(interactAt.x, interactAt.y);
  }
}

function dollars(cost: number): string {
  return String(Number(cost.toFixed(6)));
}
