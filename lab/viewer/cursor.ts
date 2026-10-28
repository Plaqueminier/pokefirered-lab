import type { RunEvent } from "../src/harness/record";
import type { ShownRun } from "../src/protocol";
import { runKey } from "./runs";

export type Span = { from: number; to: number };

// The call is the Model call picked by a click. Calls can share one frame, so the frame alone does not tell which one.
export type Cursor = { frame: number; call: number | null };

export type Moment = { cursor: Cursor | null; range: Span | null };

export type Readable<T> = { readonly value: T; subscribe(listener: (value: T) => void): () => void };

export class Store<T> implements Readable<T> {
  readonly #listeners = new Set<(value: T) => void>();

  constructor(private current: T) {}

  get value(): T {
    return this.current;
  }

  set(next: T): void {
    if (next === this.current) return;
    this.current = next;
    for (const listener of this.#listeners) listener(next);
  }

  subscribe(listener: (value: T) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }
}

function continues(before: readonly RunEvent[], after: readonly RunEvent[]): boolean {
  if (after.length < before.length) return false;
  const last = before.at(-1);
  if (!last) return true;
  const same = after[before.length - 1];
  return same.frame === last.frame && same.type === last.type && after[0].frame === before[0].frame;
}

// The one owner of the cursor, of the selected range and of the question "is this still the same Run?".
export class SharedCursor implements Readable<Moment> {
  readonly #moment = new Store<Moment>({ cursor: null, range: null });
  #run = "";
  #events: readonly RunEvent[] | null = null;

  get value(): Moment {
    return this.#moment.value;
  }

  subscribe(listener: (value: Moment) => void): () => void {
    return this.#moment.subscribe(listener);
  }

  pickCall(index: number, frame: number): void {
    this.#moment.set({ ...this.value, cursor: { frame, call: index } });
  }

  pickFrame(frame: number): void {
    this.#moment.set({ ...this.value, cursor: { frame, call: null } });
  }

  selectRange(range: Span): void {
    this.#moment.set({ ...this.value, range });
  }

  // Back to now, with the whole Run.
  clear(): void {
    if (this.value.cursor || this.value.range) this.#moment.set({ cursor: null, range: null });
  }

  // True when the shown Run is another one. The events and the cursor of the old Run are dropped.
  onStatus(shown: ShownRun): boolean {
    const key = runKey(shown);
    if (key === this.#run) return false;
    this.#run = key;
    this.#events = null;
    this.clear();
    return true;
  }

  // The events that came after the last call, or null when the events restarted: another Run, or a replay that starts again.
  onEvents(events: readonly RunEvent[]): readonly RunEvent[] | null {
    const before = this.#events;
    this.#events = events;
    if (before && continues(before, events)) return events.slice(before.length);
    this.clear();
    return null;
  }
}

export function callAt(calls: readonly { frame: number }[], cursor: Cursor | null): number | null {
  if (!cursor) return calls.length > 0 ? calls.length - 1 : null;
  if (cursor.call !== null) return cursor.call;
  const index = calls.findLastIndex((call) => call.frame <= cursor.frame);
  return index >= 0 ? index : null;
}
