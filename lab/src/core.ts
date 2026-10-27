// One emulator instance (libmgba through shim/shim.c and bun:ffi).
import { dlopen, FFIType, ptr, type Pointer } from "bun:ffi";
import { mkdir, rename, rm } from "node:fs/promises";
import { join } from "node:path";
import type { MemoryBus } from "./memory";

const LAB_DIR = join(import.meta.dir, "..");
const SHIM_SOURCE = join(LAB_DIR, "shim", "shim.c");
const MGBA = "/opt/homebrew/opt/mgba";

export const CACHE_DIR = join(LAB_DIR, ".cache");


async function buildShim(): Promise<string> {
  const lib = join(CACHE_DIR, "libpfrlab.dylib");
  const src = Bun.file(SHIM_SOURCE);
  const out = Bun.file(lib);
  if ((await out.exists()) && (await out.stat()).mtimeMs >= (await src.stat()).mtimeMs) return lib;
  await mkdir(CACHE_DIR, { recursive: true });
  // Runs start in parallel workers: write then rename, so dlopen never loads a partial library.
  const tmp = `${lib}.${crypto.randomUUID()}`;
  const cc = Bun.spawnSync(
    ["cc", "-O2", "-shared", "-fPIC", SHIM_SOURCE, `-I${MGBA}/include`, `-L${MGBA}/lib`, "-lmgba", `-Wl,-rpath,${MGBA}/lib`, "-o", tmp],
    { stderr: "pipe" },
  );
  if (cc.exitCode !== 0) {
    await rm(tmp, { force: true });
    throw new Error(`shim build failed:\n${cc.stderr.toString()}`);
  }
  await rename(tmp, lib);
  return lib;
}

const symbols = {
  lab_open: { args: [FFIType.cstring], returns: FFIType.ptr },
  lab_close: { args: [FFIType.ptr], returns: FFIType.void },
  lab_reset: { args: [FFIType.ptr], returns: FFIType.void },
  lab_width: { args: [FFIType.ptr], returns: FFIType.u32 },
  lab_height: { args: [FFIType.ptr], returns: FFIType.u32 },
  lab_set_keys: { args: [FFIType.ptr, FFIType.u32], returns: FFIType.void },
  lab_run_frame: { args: [FFIType.ptr], returns: FFIType.void },
  lab_audio_enable: { args: [FFIType.ptr, FFIType.bool, FFIType.u32], returns: FFIType.void },
  lab_audio_read: { args: [FFIType.ptr, FFIType.ptr, FFIType.u32], returns: FFIType.u32 },
  lab_frame_counter: { args: [FFIType.ptr], returns: FFIType.u32 },
  lab_frame_rgba: { args: [FFIType.ptr, FFIType.ptr], returns: FFIType.void },
  lab_read: { args: [FFIType.ptr, FFIType.u32, FFIType.ptr, FFIType.u32], returns: FFIType.void },
  lab_patch16: { args: [FFIType.ptr, FFIType.u32, FFIType.u16], returns: FFIType.void },
  lab_savedata_size: { args: [FFIType.ptr], returns: FFIType.u64 },
  lab_savedata_read: { args: [FFIType.ptr, FFIType.ptr, FFIType.u64], returns: FFIType.u64 },
  lab_savedata_write: { args: [FFIType.ptr, FFIType.ptr, FFIType.u64], returns: FFIType.bool },
  lab_state_size: { args: [FFIType.ptr], returns: FFIType.u64 },
  lab_state_save: { args: [FFIType.ptr, FFIType.ptr], returns: FFIType.bool },
  lab_state_load: { args: [FFIType.ptr, FFIType.ptr], returns: FFIType.bool },
} as const;

let lib: Awaited<ReturnType<typeof dlopen<typeof symbols>>> | null = null;

export class Core implements MemoryBus {
  readonly width: number;
  readonly height: number;
  private readonly frame: Uint8Array;
  private readonly audio = new Int16Array(2 * 8192);

  private constructor(private handle: Pointer | bigint) {
    const f = lib!.symbols;
    this.width = f.lab_width(handle);
    this.height = f.lab_height(handle);
    this.frame = new Uint8Array(this.width * this.height * 4);
  }

  static async open(romPath: string): Promise<Core> {
    lib ??= dlopen(await buildShim(), symbols);
    const handle = lib.symbols.lab_open(Buffer.from(`${romPath}\0`));
    if (!handle) throw new Error(`cannot open ROM ${romPath}`);
    return new Core(handle);
  }

  private get f() {
    return lib!.symbols;
  }

  close(): void {
    this.f.lab_close(this.handle);
  }

  reset(): void {
    this.f.lab_reset(this.handle);
  }

  setKeys(keys: number): void {
    this.f.lab_set_keys(this.handle, keys);
  }

  runFrame(): void {
    this.f.lab_run_frame(this.handle);
  }

  /** Keeps audio at this sample rate for readAudio(), or drops it. */
  enableAudio(enabled: boolean, sampleRate = 48000): void {
    this.f.lab_audio_enable(this.handle, enabled, sampleRate);
  }

  /** The audio made since the last call: interleaved stereo 16-bit samples. */
  readAudio(): Int16Array {
    const frames = this.f.lab_audio_read(this.handle, ptr(this.audio), this.audio.length / 2);
    return this.audio.subarray(0, frames * 2);
  }

  get frameCounter(): number {
    return this.f.lab_frame_counter(this.handle);
  }

  /** The screen as RGBA bytes. The same buffer is reused on each call. */
  screen(): Uint8Array {
    this.f.lab_frame_rgba(this.handle, ptr(this.frame));
    return this.frame;
  }

  read(address: number, length: number): Uint8Array {
    const out = new Uint8Array(length);
    if (length > 0) this.f.lab_read(this.handle, address, ptr(out), length);
    return out;
  }

  patch16(address: number, value: number): void {
    this.f.lab_patch16(this.handle, address, value);
  }

  /** The battery save (flash) as it is now. */
  saveData(): Uint8Array {
    const size = Number(this.f.lab_savedata_size(this.handle));
    const out = new Uint8Array(size);
    if (size > 0) this.f.lab_savedata_read(this.handle, ptr(out), size);
    return out;
  }

  /** Replaces the battery save. Only in memory: no file is written. */
  loadSaveData(data: Uint8Array): boolean {
    return this.f.lab_savedata_write(this.handle, ptr(data), data.length);
  }

  saveState(): Uint8Array {
    const out = new Uint8Array(Number(this.f.lab_state_size(this.handle)));
    if (!this.f.lab_state_save(this.handle, ptr(out))) throw new Error("saveState failed");
    return out;
  }

  loadState(state: Uint8Array): boolean {
    return this.f.lab_state_load(this.handle, ptr(state));
  }
}
