# The Plan provider Grok has its own home and its own login

Status: accepted. This ADR adds to ADR 0005.

`grok` reads more than the two other tools. In an empty directory, it loads `~/.claude/Claude.md`, the skills and the permissions of Claude Code, and the variables `GROK_CLAUDE_*_ENABLED` did not change this in `grok inspect`. These instructions would change how the model plays, and then two Runs are not equal. So each call has the empty directory of the call as its `HOME`.

The lab also uses its own `GROK_HOME`, `~/.grok-lab`, with one more login (`GROK_HOME=~/.grok-lab grok login`). So a call does not read the config or the skills of `~/.grok`, and it writes no session there. We did not link `auth.json` from `~/.grok`, because a token refresh can replace the link and stop the login of the person. In this home, `[skills] ignore` hides the bundled skills, which add about 2,100 tokens to each call. Only the config file can do this, so the status check of the provider writes it. Each call removes its own session, because `grok` has no option to keep none.

`grok` also has no option for "no tools": a `--tools` entry that names no tool leaves all the tools. So the call names each tool in `--disallowed-tools`, with `--max-turns 1` and `--permission-mode dontAsk` for a tool that a later version adds.

The system prompt of the Bot is not the only system prompt. In `grok` 1.0.70, `--system-prompt-override` has no effect, also with `-p` and with no `--json-schema`, although the docs of Grok tell that it replaces the prompt. `prompt_mode` in an agent file has no effect either. An agent file (`--agent`) adds its text after a base prompt of 3,456 characters, which tells the model that it is an agent for software engineering, and it removes the rules about a browser. This is the smallest prompt that we measured, so the call uses it. The agent file must not have the name `AGENT.md`, because `grok` also reads this name as project instructions.

The cost: the model on `grok` reads this base prompt and a short rule of Grok before the prompt of the Bot, and the two other tools do not have this. So a difference between a Run on `grok` and a Run on another provider can come from these words. A later version of `grok` can also add a tool or a new source of instructions. `system_prompt.txt` and `chat_history.jsonl` in a session show what a call sent. We did not try `systemPromptOverride` through `grok agent stdio`: this needs a client for its protocol, with more code than all the other parts of this provider.
