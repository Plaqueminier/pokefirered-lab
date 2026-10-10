// Plays the Run audio: 16-bit stereo chunks at 48 kHz go into a queue that an
// AudioWorklet reads. The queue length goes back to the harness, which trims the
// Run speed to keep the queue near its target.

const SAMPLE_RATE = 48000;

// Runs in the audio thread. Kept as a string: the worklet must be its own module.
const WORKLET = `
const CAPACITY = 48000; // 1 s of stereo frames
const START_FRAMES = 1920; // 40 ms queued before playing (again)
const MAX_FRAMES = 14400; // above 300 ms, drop the oldest audio

class LabAudio extends AudioWorkletProcessor {
  constructor() {
    super();
    this.left = new Float32Array(CAPACITY);
    this.right = new Float32Array(CAPACITY);
    this.read = 0;
    this.size = 0;
    this.playing = false;
    this.sinceReport = 0;
    this.port.onmessage = (event) => {
      if (event.data === "clear") {
        this.size = 0;
        this.playing = false;
        return;
      }
      const samples = new Int16Array(event.data);
      for (let i = 0; i + 1 < samples.length; i += 2) {
        if (this.size === CAPACITY) {
          this.read = (this.read + 1) % CAPACITY;
          this.size--;
        }
        const at = (this.read + this.size) % CAPACITY;
        this.left[at] = samples[i] / 32768;
        this.right[at] = samples[i + 1] / 32768;
        this.size++;
      }
      if (this.size > MAX_FRAMES) {
        const drop = this.size - START_FRAMES;
        this.read = (this.read + drop) % CAPACITY;
        this.size -= drop;
      }
      if (!this.playing && this.size >= START_FRAMES) this.playing = true;
    };
  }

  process(_inputs, outputs) {
    const [left, right] = outputs[0];
    for (let i = 0; i < left.length; i++) {
      if (this.playing && this.size > 0) {
        left[i] = this.left[this.read];
        right[i] = this.right[this.read];
        this.read = (this.read + 1) % CAPACITY;
        this.size--;
      } else {
        // Ran dry: wait for the queue to fill again, so the sound does not crackle.
        left[i] = 0;
        right[i] = 0;
        this.playing = false;
      }
    }
    this.sinceReport += left.length;
    if (this.sinceReport >= 4800) {
      this.sinceReport = 0;
      this.port.postMessage((this.size / sampleRate) * 1000);
    }
    return true;
  }
}

registerProcessor("lab-audio", LabAudio);
`;

export class AudioOut {
  private context: AudioContext | null = null;
  private node: AudioWorkletNode | null = null;
  private starting: Promise<void> | null = null;

  constructor(private readonly onLevel: (ms: number) => void) {}

  /** Must run from a click or a key press: browsers block sound before that. */
  start(): Promise<void> {
    this.starting ??= this.create();
    return this.starting;
  }

  private async create(): Promise<void> {
    const context = new AudioContext({ sampleRate: SAMPLE_RATE, latencyHint: "interactive" });
    const url = URL.createObjectURL(new Blob([WORKLET], { type: "application/javascript" }));
    await context.audioWorklet.addModule(url);
    URL.revokeObjectURL(url);
    const node = new AudioWorkletNode(context, "lab-audio", { outputChannelCount: [2] });
    node.port.onmessage = (event) => this.onLevel(event.data as number);
    node.connect(context.destination);
    await context.resume();
    this.context = context;
    this.node = node;
  }

  get running(): boolean {
    return this.context?.state === "running";
  }

  /** Takes interleaved stereo 16-bit samples. */
  push(samples: ArrayBuffer): void {
    this.node?.port.postMessage(samples, [samples]);
  }

  clear(): void {
    this.node?.port.postMessage("clear");
  }
}
