import { createContext } from "preact";
import { useContext, useEffect } from "preact/hooks";
import type { Prompt } from "../src/harness/record";
import { PROMPT_BATCH, type PromptSource, promptBatch, promptsUrl, samePromptSource } from "../src/protocol";
import { fetched, Store, useStore } from "./cursor";

export type PromptLoad = { kind: "ready"; prompt: Prompt } | { kind: "loading" } | { kind: "error"; error: string };

type Batch = { prompts: (Prompt | null)[]; fetching: boolean; error: string | null; wanted: number };

/** The prompts of the list of events that the panels show. The events have no prompts: the Viewer asks for those of PROMPT_BATCH events at a time. */
export class PromptCache {
  #source: PromptSource = null;
  #batches = new Map<number, Batch>();
  #resets = 0;
  readonly changes = new Store(0);

  // A panel asks again for its prompt after a reset, even at the same index.
  get resets(): number {
    return this.#resets;
  }

  // The events of one source only grow, so its prompts stay true: only another source drops them. True when it drops them.
  show(source: PromptSource): boolean {
    if (samePromptSource(source, this.#source)) return false;
    this.#source = source;
    this.#batches = new Map();
    this.#resets++;
    this.#changed();
    return true;
  }

  state(at: number): PromptLoad {
    if (this.#source === null) return { kind: "error", error: "this Run has no Model calls" };
    const batch = this.#batches.get(promptBatch(at));
    const prompt = batch?.prompts[at % PROMPT_BATCH];
    if (prompt !== undefined) return prompt ? { kind: "ready", prompt } : { kind: "error", error: "this event has no prompt" };
    return batch?.error ? { kind: "error", error: batch.error } : { kind: "loading" };
  }

  // A Run that plays adds calls to its last batch: ask only for the prompts that are not here.
  want(at: number): void {
    const source = this.#source;
    if (source === null) return;
    const number = promptBatch(at);
    const batch = this.#batches.get(number) ?? { prompts: [], fetching: false, error: null, wanted: 0 };
    this.#batches.set(number, batch);
    batch.wanted = Math.max(batch.wanted, at % PROMPT_BATCH);
    if (batch.fetching || batch.wanted < batch.prompts.length) return;
    batch.fetching = true;
    batch.error = null;
    const had = batch.prompts.length;
    void fetched(promptsUrl(source, number * PROMPT_BATCH + had, (number + 1) * PROMPT_BATCH))
      .then((response) => response.json() as Promise<(Prompt | null)[]>)
      .then(
        (prompts) => {
          batch.prompts.push(...prompts);
        },
        (error: unknown) => {
          batch.error = String(error);
        },
      )
      .finally(() => {
        batch.fetching = false;
        this.#changed();
        // A call that came while the answer was on its way is not in it.
        const more = batch.prompts.length > had && batch.wanted >= batch.prompts.length;
        if (more && this.#batches.get(number) === batch) this.want(number * PROMPT_BATCH + batch.wanted);
      });
  }

  #changed(): void {
    this.changes.set(this.changes.value + 1);
  }
}

export const PromptContext = createContext<PromptCache | null>(null);

function usePromptCache(): PromptCache {
  const cache = useContext(PromptContext);
  if (!cache) throw new Error("A prompt needs the PromptContext.");
  return cache;
}

/** `at`: the index of the call in the events of the shown Run. */
export function usePrompt(at: number): PromptLoad {
  const cache = usePromptCache();
  useStore(cache.changes);
  const { resets } = cache;
  useEffect(() => cache.want(at), [cache, at, resets]);
  return cache.state(at);
}

export function PromptWait({ load }: { load: Exclude<PromptLoad, { kind: "ready" }> }) {
  if (load.kind === "error") return <p class="text-sm text-bad">The prompt does not load: {load.error}</p>;
  return <p class="text-sm text-muted">Loading the prompt from the server…</p>;
}
