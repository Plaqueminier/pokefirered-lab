// The cursor and the selection that all the panels of the Lab tab share (CONTEXT.md, Viewer).

export type Span = { from: number; to: number };

/** A range of frames, or the frames of one Model call: from its frame to the frame before the next call. */
export type Selection = ({ kind: "range" } & Span) | { kind: "call"; index: number };

/** A frame of the shown Run. `call`: the Model call that a person picked, because more calls can have the same frame. */
export type Cursor = { frame: number; call: number | null };

/** No cursor: the panels show now. No selection: the whole Run. */
export type Moment = { cursor: Cursor | null; selection: Selection | null };

/** A value that the panels read and follow. */
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

  /** A click on a Model call: the cursor goes to its frame, and the selection is its frames. */
  pickCall(index: number, frame: number): void {
    this.set({ cursor: { frame, call: index }, selection: { kind: "call", index } });
  }

  select(selection: Selection | null): void {
    this.set({ ...this.value, selection });
  }

  /** Back to now, and the whole Run. */
  clear(): void {
    if (this.value.cursor || this.value.selection) this.set({ cursor: null, selection: null });
  }

  /** Another Run or another replay clears the cursor and the selection. */
  onRun(key: string): void {
    if (key !== this.#run) this.clear();
    this.#run = key;
  }
}

/** The index of the Model call at the cursor: the call that a person picked, else the last call at or before its frame. No cursor: the last call. */
export function callAt(calls: readonly { frame: number }[], cursor: Cursor | null): number | null {
  if (!cursor) return calls.length > 0 ? calls.length - 1 : null;
  if (cursor.call !== null && calls[cursor.call]?.frame === cursor.frame) return cursor.call;
  const index = calls.findLastIndex((call) => call.frame <= cursor.frame);
  return index >= 0 ? index : null;
}
