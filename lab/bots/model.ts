import { isDecisionPoint } from "../src/game";
import { type ActionResult, type Bot, errorText, type Harness, type Observation } from "../src/harness/harness";
import type { Cell } from "../src/harness/path";
import { type ModelAnswer, modelEvents, type ModelOptions, type ModelSettings, type NodeRange, type Prompt, type RunEvent, type Starter, type SummaryAnswer, type Turn, type Usage } from "../src/harness/record";
import { type Asked, askedOf, isPlayed, type ModelAction, type PlayedAction, readAction, readDecision } from "../src/model/decision";
import { dueMerges, type MemoryTree, memoryTree, nodeName, readSummary, summaryPrompt, summarySchema } from "../src/model/memory-tree";
import { type AnswerFormat, type ModelClient, type ModelReply, modelSettings, openRouter } from "../src/model/openrouter";
import { importantEvents } from "../src/model/important-events";
import { atlasMessage, B_PRESSES, errorMessage, impossibleMessage, reflectionTurn, reviewTurn, situation, systemPrompt, userPrompt, zoomMessage } from "../src/model/prompt";
import { approaches, interactCell, type Overworld, type Target } from "../src/model/targets";

const MAX_UNREADABLE = 3;
// After this number of impossible actions in a row, a new conversation starts from a new prompt.
const MAX_IMPOSSIBLE = 3;
const MAX_WALKS = 3;
// After this number of screens in a row that no action covers, with no Model call between them, the Run ends.
const MAX_UNCOVERED = 3;
const WHITEOUT_RULE = "If all your Pokémon faint, the Run ends.";
const NO_USAGE: Usage = { promptTokens: 0, cachedTokens: 0, completionTokens: 0, reasoningTokens: 0, cost: 0 };

export function modelBot(options: ModelOptions = {}, connect: (settings: ModelSettings) => ModelClient = openRouter): Bot {
  const settings = modelSettings(options);
  return {
    name: "model",
    version: "8",
    model: settings,
    play: (harness) => new ModelPlay(harness, settings, connect(settings)).play(),
  };
}

/** The model bot pressed B for MAX_UNCOVERED screens that no action covers, with no Model call between them: it makes a Model call at each Decision point. */
export function unknownScreen(events: readonly RunEvent[]): boolean {
  const since = events.slice(events.findLastIndex((e) => e.type === "model") + 1);
  return since.filter((e) => e.type === "action" && e.action.name === "readText" && e.result.status === "impossible").length >= MAX_UNCOVERED;
}

function starterRule(starter: Starter): string {
  return starter === "free" ? "Choose your first Pokémon as you like: BULBASAUR, CHARMANDER or SQUIRTLE. There is no correct answer." : `Choose ${starter} as your first Pokémon.`;
}

type Conversation = { user: string; turns: Turn[]; atlasShown: boolean; impossible: number; stuck: number; reflection: boolean; review: boolean };

class ModelPlay {
  readonly #system: string;
  #conversation: Conversation | null = null;
  #promptObservation: Observation | null = null;
  // A continued Run keeps the Model calls of its parent: the answers that the Bot cannot read count from this call.
  #firstCall = 0;

  constructor(
    private readonly harness: Harness,
    private readonly settings: ModelSettings,
    private readonly ask: ModelClient,
  ) {
    this.#system = systemPrompt([starterRule(settings.starter), ...(settings.stopAtWhiteout ? [WHITEOUT_RULE] : [])].join("\n"));
  }

  async play(): Promise<void> {
    this.#firstCall = modelEvents(this.harness.events).length;
    for (;;) {
      const waiting = this.harness.waitingFor();
      const { kind } = waiting;
      if (!isDecisionPoint(waiting)) {
        await this.readText();
        continue;
      }
      const observation = this.harness.observe();
      const reflection = this.#conversation?.reflection ?? reflectionTurn(kind, this.harness.events, this.harness.noProgress);
      const review = this.#conversation?.review ?? (!reflection && reviewTurn(kind, this.harness.events));
      const asked = askedOf(observation, this.#conversation?.atlasShown ?? (reflection || review));
      if (!asked) throw new Error(`the model bot does not know this Decision point: ${kind} in the ${observation.mode} mode`);
      if (!this.#conversation) {
        this.#conversation = this.newConversation(observation, asked, { reflection, review });
        this.#promptObservation = observation;
      }
      const conversation = this.#conversation;
      const action = await this.harness.modelCall(() => this.answer(conversation, asked));
      this.stopAtUnreadable();
      await this.summarize();
      if (action && isPlayed(action)) {
        const conversation = this.#conversation;
        this.#conversation = null;
        const result = await this.perform(action, asked);
        if (conversation && result?.status === "impossible" && ++conversation.impossible < MAX_IMPOSSIBLE && this.harness.waitingFor().kind === kind) {
          const call = modelEvents(this.harness.events).at(-1)!;
          conversation.turns.push({ assistant: call.answer ?? "", user: impossibleMessage(call.decision?.action ?? "", "reason" in result ? result.reason : "", asked) });
          this.#conversation = conversation;
        }
      }
    }
  }

  private async readText(): Promise<void> {
    if ((await this.harness.readText()).status !== "impossible") return;
    for (let i = 0; i < B_PRESSES; i++) await this.harness.press("B");
    if (unknownScreen(this.harness.events)) this.harness.end("unknown screen");
  }

  private async answer(conversation: Conversation, asked: Asked): Promise<{ answer: ModelAnswer; action: ModelAction | null }> {
    const prompt: Prompt = { system: this.#system, user: conversation.user, ...(conversation.turns.length > 0 ? { turns: [...conversation.turns] } : {}) };
    const request = { model: this.settings.id, situation: situation(asked), prompt, stuck: conversation.stuck, reflection: conversation.reflection, review: conversation.review };
    const reply = await this.tryAsk(prompt);
    if (typeof reply === "string") return { answer: { ...request, answer: null, usage: NO_USAGE, decision: null, error: reply }, action: null };
    const replied = { ...request, answer: reply.content, usage: reply.usage };
    try {
      const decision = readDecision(reply.content);
      const action = readAction(decision.action, asked);
      if (action.name === "viewAtlas" && asked.kind === "walk") {
        conversation.atlasShown = true;
        conversation.turns.push({ assistant: reply.content, user: atlasMessage(asked) });
      }
      if (action.name === "zoom") conversation.turns.push({ assistant: reply.content, user: zoomMessage(memoryTree(this.harness.events), action, asked) });
      return { answer: { ...replied, decision, error: null }, action };
    } catch (error) {
      conversation.turns.push({ assistant: reply.content, user: errorMessage(errorText(error), asked) });
      return { answer: { ...replied, decision: null, error: errorText(error) }, action: null };
    }
  }

  private newConversation(observation: Observation, asked: Asked, { reflection, review }: { reflection: boolean; review: boolean }): Conversation {
    const { events, noProgress } = this.harness;
    const happened = importantEvents(this.#promptObservation, observation, events);
    const user = userPrompt(observation, asked, events, { noProgress, reflection, review, happened });
    return { user, turns: [], atlasShown: reflection || review, impossible: 0, stuck: noProgress.stuck, reflection, review };
  }

  private async summarize(): Promise<void> {
    const tried = new Set<string>();
    for (;;) {
      const tree = memoryTree(this.harness.events);
      const node = dueMerges(tree).find((due) => !tried.has(nodeName(due)));
      if (!node) return;
      tried.add(nodeName(node));
      await this.harness.summaryCall(() => this.summary(tree, node));
    }
  }

  private async summary(tree: MemoryTree, node: NodeRange): Promise<SummaryAnswer> {
    const prompt = summaryPrompt(tree, node);
    const request = { model: this.settings.id, prompt, ...node };
    const reply = await this.tryAsk(prompt, { name: "summary", schema: summarySchema(node) });
    if (typeof reply === "string") return { ...request, answer: null, usage: NO_USAGE, summary: null, error: reply };
    try {
      return { ...request, answer: reply.content, usage: reply.usage, summary: readSummary(reply.content, node), error: null };
    } catch (error) {
      return { ...request, answer: reply.content, usage: reply.usage, summary: null, error: errorText(error) };
    }
  }

  /** The reply of the model, or the text of the error when the request fails. */
  private async tryAsk(prompt: Prompt, format?: AnswerFormat): Promise<ModelReply | string> {
    try {
      return await this.ask(prompt, format);
    } catch (error) {
      return `the request failed: ${errorText(error)}`;
    }
  }

  private stopAtUnreadable(): void {
    const calls = modelEvents(this.harness.events).slice(this.#firstCall);
    const unreadable = calls.length - 1 - calls.findLastIndex((e) => e.decision !== null);
    if (unreadable >= MAX_UNREADABLE) throw new Error(`${MAX_UNREADABLE} answers in a row that the Bot cannot read; the last one: ${calls.at(-1)?.error}`);
  }

  /** The result of the last Macro-action, or null when go found no cell to walk to. */
  private async perform(action: PlayedAction, asked: Asked): Promise<ActionResult | null> {
    if (action.name !== "go") return this.harness.perform(action);
    if (asked.kind !== "walk") throw new Error("go is an action of a walk only");
    return this.go(asked.view.targets[action.target], asked.overworld);
  }

  private async go(target: Target, overworld: Overworld): Promise<ActionResult | null> {
    switch (target.kind) {
      case "map":
        return this.harness.goTo(target.cell.x, target.cell.y, target.map);
      case "person":
        return this.talkTo(target, overworld, (now) => now.people.find((p) => p.localId === target.localId && p.loaded) ?? null);
      case "sign":
        return this.talkTo(target, overworld, () => target.cell);
      default:
        return this.walkTo(target, overworld);
    }
  }

  /** The first walk goes to the cell of the target in the prompt; `relocate` gives its cell after each walk, as a person can move. */
  private async talkTo(target: Target & { kind: "person" | "sign" }, overworld: Overworld, relocate: (now: Overworld) => Cell | null): Promise<ActionResult | null> {
    let result: ActionResult | null = null;
    let now: Overworld | null = overworld;
    for (let walks = 0; now; walks++) {
      const cell = walks === 0 ? target.cell : relocate(now);
      const at = cell && interactCell({ kind: target.kind, cell }, now.grid, now.player);
      if (at) return this.harness.interact(at.x, at.y);
      if (!cell || walks === MAX_WALKS) break;
      result = await this.walkTo({ ...target, cell }, now);
      const observation = result?.status === "done" ? this.harness.observe() : null;
      now = observation?.mode === "overworld" ? observation : null;
    }
    return result;
  }

  private async walkTo(target: Exclude<Target, { kind: "map" }>, overworld: Overworld): Promise<ActionResult | null> {
    let result: ActionResult | null = null;
    for (const cell of approaches(target, overworld)) {
      result = await this.harness.goTo(cell.x, cell.y);
      if (result.status !== "impossible") return result;
    }
    return result;
  }
}
