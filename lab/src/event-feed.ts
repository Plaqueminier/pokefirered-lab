import type { RunEvent } from "./harness/record";
import { reviewRequestIn } from "./model/prompt";
import type { PromptSource, ServerMessage, ShownEvent } from "./protocol";

type EventsMessage = Extract<ServerMessage, { type: "events" | "events-added" }>;

export const EVENTS_CHUNK = 2000;

export function shownEvent(event: RunEvent): ShownEvent {
  if (event.type === "summary") {
    const { prompt: _, ...light } = event;
    return light;
  }
  if (event.type !== "model") return event;
  const { prompt, ...light } = event;
  return { ...light, turnLines: (prompt.turns ?? []).map((turn) => turn.user.split("\n", 1)[0]), reviewRequest: light.review ? reviewRequestIn(prompt.user) : null };
}

/** The events that one client has of the shown Run, and the next message that it needs. */
export class EventFeed {
  #list: readonly RunEvent[] = [];
  #count = 0;
  #quietTo = 0;

  restart(events: readonly RunEvent[], prompts: PromptSource, quiet = false): EventsMessage {
    const chunk = events.slice(0, EVENTS_CHUNK);
    this.#list = events;
    this.#count = chunk.length;
    this.#quietTo = quiet ? events.length : 0;
    return { type: "events", prompts, events: chunk.map(shownEvent), total: events.length, quiet };
  }

  quietUntil(events: readonly RunEvent[]): void {
    this.#quietTo = events.length;
  }

  next(events: readonly RunEvent[], prompts: PromptSource): EventsMessage | null {
    const count = this.#count;
    const kept = Math.min(count, events.length);
    if (kept > 0 && events[kept - 1] !== this.#list[kept - 1]) return this.restart(events, prompts, true);
    this.#list = events;
    if (events.length < count) {
      this.#count = events.length;
      return { type: "events-added", from: events.length, events: [], total: events.length, quiet: true };
    }
    if (events.length === count) return null;
    const chunk = events.slice(count, count + EVENTS_CHUNK);
    this.#count = count + chunk.length;
    return { type: "events-added", from: count, events: chunk.map(shownEvent), total: events.length, quiet: count < this.#quietTo };
  }
}
