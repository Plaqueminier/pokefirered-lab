
export type Span = { from: number; to: number };

export type Selection = ({ kind: "range" } & Span) | { kind: "call"; index: number };

export type Cursor = { frame: number; call: number | null };

export type Moment = { cursor: Cursor | null; selection: Selection | null };

export class Store<T> {
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

export class SharedCursor extends Store<Moment> {
  #run = "";

  constructor() {
    super({ cursor: null, selection: null });
  }

  pickCall(index: number, frame: number): void {
    this.set({ cursor: { frame, call: index }, selection: { kind: "call", index } });
  }

  select(selection: Selection | null): void {
    this.set({ ...this.value, selection });
  }

  clear(): void {
    if (this.value.cursor || this.value.selection) this.set({ cursor: null, selection: null });
  }

  onRun(key: string): void {
    if (key !== this.#run) this.clear();
    this.#run = key;
  }
}

export function callAt(calls: readonly { frame: number }[], cursor: Cursor | null): number | null {
  if (!cursor) return calls.length > 0 ? calls.length - 1 : null;
  if (cursor.call !== null && calls[cursor.call]?.frame === cursor.frame) return cursor.call;
  const index = calls.findLastIndex((call) => call.frame <= cursor.frame);
  return index >= 0 ? index : null;
}
