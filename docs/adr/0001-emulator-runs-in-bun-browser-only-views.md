# The emulator runs natively in Bun; the browser only views

The harness runs libmgba natively from Bun (through a small C shim and `bun:ffi`). The web page does not emulate: it receives frames and game state over a WebSocket and sends keyboard input back. We chose this because the AI needs several runs in parallel at full speed (about 22× real time per run), with full access to memory. A web emulator (EmulatorJS) already worked for Emerald, but it runs one game per tab and hides part of the memory.
