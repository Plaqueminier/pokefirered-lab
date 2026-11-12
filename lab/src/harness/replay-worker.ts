import { SCREEN_INTERVAL_MS } from "../protocol";
import { Run } from "../run";
import type { ReplayWorkerMessage, ReplayWorkerReply } from "./pool";
import { Keyframes, originDifferences, RecordPlayer, replay as replayToEnd } from "./record";

declare const self: Worker;

// Short steps: the worker reads a new target only between them.
const STEP_MS = 12;

type Keyframe = { frame: number; state: Uint8Array };

let replay: { run: Run; player: RecordPlayer; keyframes: Keyframes<Keyframe> } | null = null;
let target = 0;
let posted: { frame: number; at: number } | null = null;
let stepping = false;

function post(run: Run, player: RecordPlayer): void {
  posted = { frame: player.frame, at: performance.now() };
  reply({ type: "screen", frame: player.frame, screen: run.core.screen().slice() });
}

function reply(message: ReplayWorkerReply): void {
  self.postMessage(message);
}

function step(): void {
  stepping = false;
  if (!replay) return;
  const { run, player, keyframes } = replay;
  const goal = Math.min(target, player.frames);
  const key = keyframes.before(goal);
  if (key && (goal < player.frame || key.frame > player.frame)) {
    if (!run.core.loadState(key.state)) return;
    player.seek(key.frame);
  }
  const end = performance.now() + STEP_MS;
  while (player.frame < goal && performance.now() < end) {
    run.runFrame(player.next());
    keyframes.onFrame(player.frame, () => ({ frame: player.frame, state: run.core.saveState() }));
  }
  const changed = player.frame !== posted?.frame;
  if (changed && (player.frame === goal || performance.now() - (posted?.at ?? 0) >= SCREEN_INTERVAL_MS)) post(run, player);
  if (player.frame !== goal) schedule();
}

function schedule(): void {
  if (stepping) return;
  stepping = true;
  setTimeout(step, 0);
}

self.onmessage = async ({ data }: MessageEvent<ReplayWorkerMessage>) => {
  if (data.type === "target") {
    target = data.frame;
    return schedule();
  }
  if (data.type === "toEnd") {
    try {
      return reply({ type: "end", replay: await replayToEnd(data.record) });
    } catch (error) {
      return reply({ type: "error", error: String(error) });
    }
  }
  const run = await Run.open({ names: data.record.header.names, seed: data.record.header.seed });
  const differences = originDifferences(run, data.record);
  if (differences.length > 0) return reply({ type: "error", error: `the Run record does not replay here (different ${differences.join(", ")})` });
  const keyframes = new Keyframes<Keyframe>();
  keyframes.onFrame(0, () => ({ frame: 0, state: run.core.saveState() }));
  replay = { run, player: new RecordPlayer(data.record), keyframes };
  post(run, replay.player);
  schedule();
};
