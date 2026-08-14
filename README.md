# agent-sync

Türkçe: [README.tr.md](README.tr.md)

`agent-sync` is a small Node.js tool for developers. It keeps your AI coding skills, memory, and settings the same across many computers (macOS, Windows, Linux) and many AI tools (**Claude Code, Codex, OpenCode, Gemini CLI, Aider, Cursor**). It has no extra dependencies. It finds the same project even when the folder path is different on each computer.

---

### 1. Overview
`agent-sync` stops your AI agent from losing context when you work on different computers, or with different AI tools. A decision or a memory note from one tool becomes available to agents on other computers and other tools, through a shared sync folder.

### 2. How it works
`agent-sync` keeps a local mirror at `~/.agent-sync/staged/`, plus a canonical copy inside `syncRoot`.

- `push` reads memory, skills, and settings straight out of each tool (for example `~/.claude/skills/`), writes them into the local mirror, then compares each file's hash against `syncRoot`. Files that changed here get copied out.
- `pull` does the opposite. It compares `syncRoot` against the local mirror, copies down what changed elsewhere, then hands the result to an adapter for each tool you use, which writes it into that tool's own format (`AGENTS.md`, `CLAUDE.md`, `.cursor/rules/`, and so on).
- Every sync remembers the hash each file had last time, in `~/.agent-sync/state.json`. That saved hash is what tells apart "changed here," "changed there," and "changed on both sides." Only the last case is a real conflict.
- On a conflict, nothing gets overwritten. Your local version is saved next to the incoming one, as `<name>.conflict-<machine>-<timestamp>.<ext>`, and both sides keep a copy.
- Before every `pull`, `agent-sync` saves the current local files into `~/.agent-sync/snapshots/` (last 20 kept), so a bad sync can be undone by hand.
- Each supported tool has its own small adapter module. The sync engine itself does not know about any tool. It only moves generic files between the mirror and `syncRoot`. Adapters turn that generic content into `AGENTS.md`, Claude Code's memory folder, and so on.

### 3. Requirements and policies
- You need Node.js version 20 or higher. `agent-sync` uses only built-in Node modules, so it needs no `npm` packages.
- `syncRoot` is a folder that already syncs between your computers. You can use Google Drive, OneDrive, Dropbox, Syncthing, or a network share. `agent-sync` does not move files between computers itself. It uses your cloud tool for that.
- Add a rule in `<syncRoot>/CLAUDE.md`, or in your shared instructions, that tells agents to save key decisions to memory. This is the "Phase 0" memory policy, and it is what makes the memory sync worth using.

> ⚠️ **Warning**: Do not put a Git repository (`.git`) inside `syncRoot`. If two computers write to it at the same time, the Git database can break.

### 4. Installation and testing
1. Clone the repository.
   ```bash
   git clone https://github.com/mert-gng-99/agent-skill-sync.git
   cd agent-sync
   ```
2. Run the setup on each computer.
   ```bash
   node bin/agent-sync.mjs init
   ```
   If you use Claude Code in a terminal, not the VS Code extension, `init` offers to install two hooks in `~/.claude/settings.json`: one that runs `pull` when a session starts, one that runs `push` when it ends. These hook commands always carry `--hook` (see section 6), so a session that happens to start in an unrelated folder, like your desktop, never turns it into a new tracked project on its own.
3. Run the tests.
   - Unit tests: `npm test`
   - End to end test: `./scripts/smoke-test.sh` (this runs inside a temporary `$HOME` folder, so it never touches your real `~/.claude` or `~/.agent-sync` folders)

### 5. Install with an AI agent
You do not have to type every step yourself. Paste one of the prompts below into a coding agent that can run shell commands, for example Claude Code, Codex CLI, OpenCode, Aider, or Cursor's agent mode. The setup is just a few shell commands, so the same prompt works for all of them.

Fill in the two placeholders before you send it.

```
Clone https://github.com/mert-gng-99/agent-skill-sync.git into ~/agent-sync, then run its setup wizard: `node bin/agent-sync.mjs init`.
When it asks for the sync folder, use: <path to your Google Drive / OneDrive / Dropbox / Syncthing folder>
When it asks for a machine name, use: <short name for this computer, e.g. macbook or work-pc>
When it lists the tools it found, pick the ones I actually use.
If it asks about installing Claude Code hooks, say yes only if you are Claude Code running in a terminal, not the VS Code extension.
After that, run `npm test` and `./scripts/smoke-test.sh`, and tell me if they pass.
```

Do this once per computer. Use the same sync folder on every machine, the local path can differ from computer to computer since cloud drives often mount at different paths, but it has to point at the same shared folder.

If you plan to use the VS Code extension (see section 9) instead of terminal hooks, add this line to the prompt too:

```
Then build and install the VS Code extension: `npx @vscode/vsce package --allow-missing-repository --skip-license`, then `code --install-extension agent-sync-0.1.0.vsix`.
```

### 6. CLI commands
`node bin/agent-sync.mjs <command> [--force]` (or `agent-sync <command>` after `npm link`):

| Command | What it does |
|---|---|
| `init` | Sets up this computer: config, syncRoot, and tool targets |
| `pull` \| `push` | Syncs skills, memory, and shared settings |
| `status` | Shows the machine, the project, the targets, and pending changes |
| `doctor` | Runs health checks: conflicts, registry problems, secret scan |
| `projects` | Lists every known project and which machines have it |
| `link <project-id>` | Connects this folder to an existing project ID by hand |
| `forget <path>` | Deletes a file on purpose, both locally and remotely |
| `run <command...>` | Pulls first, runs your command, then pushes when it ends |
| `--force` | Pushes files even when they look like they hold a secret |
| `--hook` | For automated callers, like the Claude Code hooks from `init` (see section 4): skips a folder with no project marker yet, instead of creating a new project |

### 7. Supported tools

| Target ID | Tool | File or folder it writes to |
|---|---|---|
| `claude` | Claude Code | `~/.claude/projects/<slug>/memory/` and `~/.claude/skills/` |
| `codex` | Codex CLI | `AGENTS.md` and `.agents/skills/` |
| `opencode` | OpenCode | `AGENTS.md` |
| `gemini` | Gemini CLI | `GEMINI.md` |
| `aider` | Aider | `CONVENTIONS.md` |
| `cursor` | Cursor | `.cursor/rules/agent-sync.mdc` |

`agent-sync` sends the full content of `~/.claude/skills/` (`SKILL.md` plus references and scripts) as real files only to **Claude Code and Codex CLI**. Both tools read the same `SKILL.md` format. Codex looks for skills under `.agents/skills/` in the project root, per [OpenAI's docs](https://learn.chatgpt.com/docs/build-skills). For the other tools (`opencode`, `gemini`, `aider`, `cursor`), `agent-sync` only lists skill names inside `AGENTS.md` or `GEMINI.md`. These tools do not auto load skills, because they have no confirmed skill system.

### 8. Path independent project identity
The same project can sit at `/Users/mert/Desktop/app` on macOS and `C:\Users\mert\Desktop\app` on Windows. `agent-sync` still finds it, using 4 steps, in this order.
1. A `.claude-project-id` marker file in the project root.
2. A Git remote URL that matches an entry in the registry.
3. A folder name that matches one entry in the registry, and only one.
4. If nothing matches, `agent-sync` makes a new project ID. If two projects share a folder name, fix the match by hand with `agent-sync link <id>`.

The marker file is added to `.git/info/exclude`. `agent-sync` never touches your own `.gitignore` file.

### 9. VS Code extension
The extension (in `extension/`) syncs on its own at these times: VS Code start (pull), window gets focus (pull), window loses focus (push), and `deactivate` (push). With the extension installed, you do not need shell hooks.

Build and install it once per computer, after `init`.

```bash
npx @vscode/vsce package --allow-missing-repository --skip-license
code --install-extension agent-sync-0.1.0.vsix
```

Restart VS Code. Then `agent-sync` shows up in the status bar.

**Commands** (press `Cmd/Ctrl + Shift + P`, then search "agent-sync"):
- `agent-sync: Sync now` runs a pull and a push by hand.
- `agent-sync: Run health checks` shows `doctor` output in the Output panel.
- `agent-sync: Show all projects` lists every project `agent-sync` knows about, with the path it has on each of your machines. Same data as `agent-sync projects` on the CLI, read straight from `registry.json`.
- `agent-sync: Link this folder to a project` shows which project this folder matches right now, and how. It also lets you pick a different known project, or make a new one. Use it when the automatic match picks the wrong project, for example when two projects share a folder name. It does the same job as `agent-sync link <id>` on the CLI.

**Settings** (press `Cmd/Ctrl + ,`, then search "agent-sync"): you can set `syncRoot`, `machineId`, and `targets` here, so you never need to hand edit `config.json`. `targets` is a pick list (`claude`, `codex`, `opencode`, `gemini`, `aider`, `cursor`), not free text. If you leave a field empty, `agent-sync` keeps the value already in `config.json`. The Settings screen only changes the fields you actually touch.

### 10. Design limits
- Deletions do not spread. If you delete a file on one computer, `agent-sync` brings it back from the remote copy. To delete a file on purpose, use `agent-sync forget <path>`.
- Sync is not live streaming. It runs at the start and end of a session, or through the `run` command wrapper.
- Skills only auto trigger inside Claude Code. In the other tools they are readable text, but nothing loads them on its own.
- Before a push, `agent-sync` scans outgoing files for API keys and passwords. A file that looks risky stays local and gets reported, instead of being pushed. Use `--force` to push it anyway, if the match was wrong. Incoming files, from `pull`, are not scanned.

### 11. Session continuity (transcript sync)
Say you open the same project on a different computer, maybe a different folder path, maybe a different OS. If you want your Claude Code session to pick up where it left off, turn on `syncTranscripts` (from the extension Settings, or in `config.json`). Once it is on:

- This project's `.jsonl` session files are stored by project ID, not by path, under `<syncRoot>/transcripts/<project-id>/`.
- When you pull the same project on another computer, those files land in that computer's own path based folder, and `claude --resume` finds and lists them there.
- It is off by default, because session files are large and grow without limit, and they are not cleaned up the way memory notes are. They still go through the same secret scan as everything else, before a push.
- Known limit: the text of the conversation, what was said and decided, comes through fully. Old tool results inside the session file still point to file paths on the first computer, and those paths do not exist on the second one. So "continue the chat" works, but reaching back into an old tool result does not.

---

## License
MIT License. Copyright (c) 2026 agent-sync contributors.
