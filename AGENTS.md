# AGENTS.md

Guidance for AI agents (Claude Code, Codex, Gemini CLI, Cursor, …) working with this repository.

## Installing AGORA for the user

Everything is one idempotent command. It never asks questions when stdin is not a TTY.

```sh
git clone https://github.com/dvaldesg/agora.git ~/agora   # skip if already cloned
cd ~/agora
node bin/agora.js init --dry-run   # show the plan, change nothing
node bin/agora.js init --yes       # apply it
node bin/agora.js doctor           # verify
```

- `init` installs dependencies, creates `~/.agora`, links `agora` onto the PATH, starts the hub, registers the MCP server in every detected client (Claude Code, Codex, Gemini CLI, Cursor) and installs the `/agora` skill.
- Limit clients with `--clients claude,codex`. Skip parts with `--no-mcp`, `--no-skills`, `--no-link`. Add `--service` to run the hub at login (launchd on macOS, systemd on Linux).
- Use `--json` for machine-readable output. Exit code is non-zero when a step fails.
- `init` edits the user's agent configs (`~/.claude.json` via `claude mcp add`, `~/.codex/config.toml` via `codex mcp add`, `~/.gemini/settings.json`, `~/.cursor/mcp.json`). JSON files get a one-time `.agora-backup`. Tell the user what changed and that agent sessions must restart to load the MCP server.
- Undo with `node bin/agora.js uninstall --yes` (`--purge` also deletes their artifacts; only with explicit consent).

## Working on the code

- Node ≥ 22.5, ES modules, no build step, no framework. Runtime deps: `@modelcontextprotocol/sdk`, `zod`, `diff`.
- `pnpm install`, `pnpm test`, `pnpm format` (Prettier is the only style authority; CI runs `pnpm format:check`).
- Style: functions take a single options object (`fn({ a, b })`), no comments in code (names carry the meaning), small modules, no copy-pasted logic.
- Never commit local data: the hub stores everything in `~/.agora` (or `AGORA_HOME`). Do not add example artifacts to the repo.

### Layout

| Path                                        | What lives there                                                                                          |
| ------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `bin/agora.js`                              | CLI entry: parses flags, dispatches to `src/cli.js`                                                       |
| `src/cli.js`                                | Every CLI command                                                                                         |
| `src/store.js`                              | SQLite schema and all queries (`node:sqlite`)                                                             |
| `src/server/`                               | HTTP hub: `index.js` wires routes, `bus.js` events/SSE/long-poll/webhooks, `routes/*` one file per domain |
| `src/mcp.js`                                | MCP server (stdio) exposed to agents                                                                      |
| `src/listen.js`                             | Listener that wakes agent CLIs (`--exec`)                                                                 |
| `src/setup/`                                | `init`, `doctor`, `uninstall`: client registry, skills, background service                                |
| `src/relevance.js`                          | Which events reach which agent                                                                            |
| `web/index.html`, `web/app.css`, `web/js/*` | Browser UI (plain ES modules)                                                                             |
| `web/overlay.js`                            | Script injected into every artifact: anchors, pins, selection, `agora.state` bridge                       |
| `skills/agora/SKILL.md`                     | `/agora` skill template (`{{AGORA_BIN}}`, `{{AGENT}}` are filled in at install)                           |
| `test/`                                     | `node:test` suites (API end to end, setup in a sandboxed HOME)                                            |
