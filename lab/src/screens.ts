import type { ServerWebSocket } from "bun";
import type { ReplayView } from "./harness/pool";
import { BinaryKind, type GridSize, SCREEN_HEADER, SCREEN_INTERVAL_MS, SMALL_SCREEN_INTERVAL_MS } from "./protocol";

type Socket = ServerWebSocket<unknown>;

type Follower = { runIds: Set<number>; size: GridSize; sent: Map<number, { frame: number; at: number }> };

export class ScreenFanout {
  readonly #followers = new Map<Socket, Follower>();
  #message: Uint8Array | null = null;

  add(ws: Socket): void {
    this.#followers.set(ws, { runIds: new Set(), size: 4, sent: new Map() });
  }

  delete(ws: Socket): void {
    this.#followers.delete(ws);
  }

  follow(ws: Socket, runIds: readonly number[], size: GridSize): void {
    const follower = this.#followers.get(ws);
    if (!follower) return;
    follower.runIds = new Set(runIds);
    follower.size = size;
  }

  forget(id: number): void {
    for (const { sent } of this.#followers.values()) sent.delete(id);
  }

  send(now: number, shownId: number, screenOf: (id: number) => ReplayView | undefined): boolean {
    let shownSent = false;
    for (const [ws, { runIds, size, sent }] of this.#followers) {
      const wanted = new Set([shownId, ...runIds]);
      for (const id of sent.keys()) if (!wanted.has(id)) sent.delete(id);
      const interval = size === 9 && runIds.size > 0 ? SMALL_SCREEN_INTERVAL_MS : SCREEN_INTERVAL_MS;
      for (const id of wanted) {
        const source = screenOf(id);
        const last = sent.get(id);
        if (!source?.screen || (last && (last.frame === source.frame || now - last.at < interval))) continue;
        sent.set(id, { frame: source.frame, at: now });
        ws.send(this.#pack(id, source.screen));
        if (id === shownId) shownSent = true;
      }
    }
    return shownSent;
  }

  // One buffer for all the sends: a send copies it.
  #pack(id: number, screen: Uint8Array): Uint8Array {
    this.#message ??= new Uint8Array(SCREEN_HEADER + screen.length);
    this.#message[0] = BinaryKind.Screen;
    new DataView(this.#message.buffer).setUint32(1, id, true);
    this.#message.set(screen, SCREEN_HEADER);
    return this.#message;
  }
}
