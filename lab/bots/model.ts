import type { ActionResult, Bot, Harness, Observation } from "../src/harness/harness";
import { type ModelAnswer, modelEvents, type ModelOptions, type ModelSettings, modelTotals, type Usage } from "../src/harness/record";
import { type Asked, askedOf, type ModelAction, readAction, readDecision } from "../src/model/decision";
import { type ModelClient, type ModelReply, modelSettings, openRouter } from "../src/model/openrouter";
import { B_PRESSES, situation, systemPrompt, userPrompt } from "../src/model/prompt";
import { approaches, nextTo, type Overworld, type Target, visitedMaps } from "../src/model/targets";

const GOAL = "first-rival-battle";
const GOAL_TEXT = "Get your first Pokémon from Professor Oak, then win your first battle against your rival.";
const FRAME_BUDGET = 200_000;
const MAX_UNREADABLE = 3;
const NO_USAGE: Usage = { promptTokens: 0, completionTokens: 0, reasoningTokens: 0, cost: 0 };

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

class ModelPlay {
  readonly #system = systemPrompt(GOAL_TEXT);

  constructor(
    private readonly harness: Harness,
    private readonly settings: ModelSettings,
    private readonly ask: ModelClient,
  ) {}

  async play(): Promise<void> {
    for (;;) {
      const kind = this.harness.waitingFor().kind;
      if (kind === "text" || kind === "busy") {
        await this.readText();
        continue;
      }
      const observation = this.harness.observe();
      const asked = askedOf(observation, visitedMaps(this.harness.events));
      if (!asked) throw new Error(`the model bot does not know this Decision point: ${kind} in the ${observation.mode} mode`);
      const action = await this.harness.modelCall(() => this.answer(observation, asked));
      this.stopAtLimits();
      if (action) await this.perform(action, asked);
    }
  }

  private async readText(): Promise<void> {
    if ((await this.harness.readText()).status !== "impossible") return;
    for (let i = 0; i < B_PRESSES; i++) await this.harness.press("B");
  }

  private async answer(observation: Observation, asked: Asked): Promise<{ answer: ModelAnswer; action: ModelAction | null }> {
    const prompt = { system: this.#system, user: userPrompt(observation, asked, this.harness.events) };
    const request = { model: this.settings.id, situation: situation(asked), prompt };
    let reply: ModelReply;
    try {
      reply = await this.ask(prompt);
    } catch (error) {
      return { answer: { ...request, answer: null, usage: NO_USAGE, decision: null, error: `the request failed: ${message(error)}` }, action: null };
    }
    const replied = { ...request, answer: reply.content, usage: reply.usage };
    try {
      const decision = readDecision(reply.content);
      return { answer: { ...replied, decision, error: null }, action: readAction(decision.action, asked) };
    } catch (error) {
      return { answer: { ...replied, decision: null, error: message(error) }, action: null };
    }
  }

  private stopAtLimits(): void {
    const { events } = this.harness;
    const { cost } = modelTotals(events);
    if (cost > this.settings.costLimit) {
      throw new Error(`the cost of the Run (${dollars(cost)} $) is more than the cost limit (${dollars(this.settings.costLimit)} $)`);
    }
    const calls = modelEvents(events);
    const unreadable = calls.length - 1 - calls.findLastIndex((e) => e.decision !== null);
    if (unreadable >= MAX_UNREADABLE) throw new Error(`${MAX_UNREADABLE} answers in a row that the Bot cannot read; the last one: ${calls.at(-1)?.error}`);
  }

  private async perform(action: ModelAction, asked: Asked): Promise<void> {
    switch (action.name) {
      case "go":
        if (asked.kind !== "walk") throw new Error("go is an action of a walk only");
        return this.go(asked.targets[action.target - 1], asked.overworld);
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

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function dollars(cost: number): string {
  return String(Number(cost.toFixed(6)));
}
