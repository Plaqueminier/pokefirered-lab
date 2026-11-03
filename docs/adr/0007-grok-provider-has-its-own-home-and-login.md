# The Plan provider Grok has its own home and its own login

Status: accepted. This ADR adds to ADR 0005.

`grok` reads more than the two other tools. In an empty directory, it loads `~/.claude/Claude.md`, the skills and the permissions of Claude Code, and the variables `GROK_CLAUDE_*_ENABLED` did not change this in `grok inspect`. These instructions would change how the model plays, and then two Runs are not equal. So each call has the empty directory of the call as its `HOME`.

The usual `~/.grok` stays a problem with this `HOME`: its skills and agents add about 2,000 input tokens to each call, and each call writes a session of about 80 KB there. So the lab uses its own `GROK_HOME`, `~/.grok-lab`. This needs one more login (`GROK_HOME=~/.grok-lab grok login`). We did not link `auth.json` from `~/.grok`, because a token refresh can replace the link and stop the login of the person. Each call removes its own session, because `grok` has no option to keep none.

`grok` also has no option for "no tools": a `--tools` entry that names no tool leaves all the tools. So the call names each tool in `--disallowed-tools`, with `--max-turns 1` and `--permission-mode dontAsk` for a tool that a later version adds.

The cost: a later version of `grok` can add a tool or a new source of instructions, and this list does not stop the new source. `grok inspect`, with the same `HOME` and `GROK_HOME`, shows what a call reads.
