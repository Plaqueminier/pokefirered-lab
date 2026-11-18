@AGENTS.md

## GBA saves

The `.sav` files at the root of the main checkout, for example `pokefirered_modern.sav`, are the user's own gameplay. Git ignores them, so git cannot restore them. Do not delete or overwrite them.

## Disk usage

- Do not copy footage or other large media (audio, video, image sequences) to make a new version. Make a symlink (`ln -s`) to the source footage, or an APFS clone (`cp -c`, `cp -cR`). A clone uses no extra space.
- A folder for a new version holds only the files that change (code, config, renders). It links to the shared footage.
- `remotion bundle --out-dir` copies all of `lab/video/public` (about 16 GB) into the bundle. Make the bundle with `--public-dir` set to an empty folder. Then replace `<bundle>/public` with a symlink to `lab/video/public`. Use this one bundle for all the stills and renders of the session.
- Before you write a large output (a render, extracted frames, converted audio), make sure that the disk has at least 50 GB free (`df -h /`). If it has less, stop and tell me.
- Before you make new frames, renders or versions, delete the ones that you no longer need.
- If your scratchpad is more than 30 GB (`du -sh <scratchpad>`), stop and ask me before you continue.
