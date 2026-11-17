#!/bin/sh
# Gives a new worktree the files that git ignores and that the lab needs:
# the ROMs, the built tools, the saves of lab/saves and lab/node_modules.
# It copies (APFS clone, so no disk cost) and never links: a build or a test
# in the worktree must not write to the files of the main checkout.
# Usage, at the root of the worktree: ./worktree_setup.sh [--runs]
set -eu

HERE=$(git rev-parse --show-toplevel)
MAIN=$(git worktree list --porcelain | sed -n '1s/^worktree //p')
if [ "$HERE" = "$MAIN" ]; then
  echo "This is the main checkout. Run this script in a worktree." >&2
  exit 1
fi

# cp -c clones the file on APFS. -n keeps a file that the worktree already has.
copy() { cp -c -n "$1" "$2" 2>/dev/null || cp -n "$1" "$2"; }

roms=0
for f in "$MAIN"/pokefirered*.gba "$MAIN"/pokefirered*.elf "$MAIN"/pokefirered*.map; do
  [ -f "$f" ] || continue
  copy "$f" "$HERE/" && roms=$((roms + 1))
done

tools=0
for f in "$MAIN"/tools/*/*; do
  [ -f "$f" ] && [ -x "$f" ] || continue
  case "$f" in *.sh | *.py) continue ;; esac
  rel=${f#"$MAIN"/}
  [ -e "$HERE/$rel" ] && continue
  # A clone keeps the old date, so make would build the tool again from the newer sources.
  copy "$f" "$HERE/$rel" && touch "$HERE/$rel" && tools=$((tools + 1))
done

mkdir -p "$HERE/lab/saves"
saves=0
for f in "$MAIN"/lab/saves/*.sav; do
  [ -f "$f" ] || continue
  copy "$f" "$HERE/lab/saves/" && saves=$((saves + 1))
done

if [ "${1:-}" = "--runs" ] && [ -d "$MAIN/lab/runs" ] && [ ! -e "$HERE/lab/runs" ]; then
  cp -c -R "$MAIN/lab/runs" "$HERE/lab/runs"
  echo "Copied lab/runs."
fi

(cd "$HERE/lab" && bun install --frozen-lockfile >/dev/null)

echo "Copied $roms ROM files, $tools tools and $saves saves. Installed lab/node_modules."
[ -f "$HERE/pokefirered_modern_lab.gba" ] || echo "No pokefirered_modern_lab.gba in the main checkout: run 'make lab' there first, or the tests that need the ROM fail." >&2
