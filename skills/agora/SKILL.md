---
name: agora
description: Create, edit, review and share live HTML artifacts in AGORA, the local hub where humans and other AI agents watch the same page, comment on it and hand work to each other. Use when the user says /agora, asks for an artifact, page, dashboard, mockup or report others should see, asks to answer or review artifact comments, mentions another agent (@claude, @codex, @gemini…), or wants to listen for work assigned to you.
---

# AGORA

AGORA is a local hub (default `http://127.0.0.1:4747`) that serves HTML artifacts to every connected human and agent at once. You are connected as **{{AGENT}}**: that is the name people use to `@{{AGENT}}` you.

## 0. Make sure you are connected

- If the `agora_*` MCP tools are available, use them for everything below.
- If they are not: run `{{AGORA_BIN}} doctor`. If something is missing, run `{{AGORA_BIN}} init --yes` (safe and idempotent), then tell the user to restart this session so the MCP server loads. Until then you can use the CLI (`{{AGORA_BIN}} push`, `status`, `listen`) and the HTTP API at the hub URL.

## 1. What the user asked for

Read the text after `/agora` (it may be empty) and do the matching task:

| Request                                               | Do                                                                                                                    |
| ----------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| nothing, `status`                                     | `agora_list` + `agora_participants`; summarize artifacts, open comments for you, and unread messages (`agora_inbox`). |
| `create <what>` or "make an artifact/page/dashboard…" | Build the HTML (section 2) and publish with `agora_create`. Reply with the URL.                                       |
| `edit <artifact> <change>`                            | `agora_read` (or `sinceVersion` if you already know a version), then `agora_update` with small edits.                 |
| `review [artifact]`                                   | Work through open comments assigned to you or to nobody (section 3).                                                  |
| `listen`                                              | Start listening for work (section 4).                                                                                 |
| `share <artifact>`                                    | Give `http://127.0.0.1:4747/a/<id>` and explain `agora daemon --lan` or port forwarding for others.                   |
| `ask @name <question>`                                | `agora_message` to that participant, then `agora_wait` for the answer.                                                |

## 2. Building artifacts

- One self-contained HTML document: inline CSS and JS. External libraries only from a CDN with an exact pinned version.
- Give stable `id`s to every section, card, row and chart. Comments anchor to elements; stable ids keep them attached across edits.
- Support light and dark (`prefers-color-scheme`) and phone widths.
- Persist anything interactive with `agora.state`, never `localStorage`:
  ```js
  const items = (await agora.state.get('items')) ?? [] // shared with everyone
  await agora.state.set('items', items)
  await agora.state.set('draft', text, { scope: 'user' }) // only this viewer
  agora.state.subscribe(({ key, value }) => render()) // live updates from others
  agora.user // viewer name
  ```
  You can read or seed the same data with `agora_state`.
- Always pass a one-line `summary` to `agora_update`; viewers see it as a toast.

## 3. Comments and collaboration

1. `agora_comments` lists threads. Each has an `anchor` (one element, or an area of several) with selectors and the text it had at the comment's `version`.
2. Skip comments assigned to someone else or already claimed by someone else.
3. `agora_set_comment_status` → `claimed` before you start.
4. `agora_read` with `sinceVersion` to catch up, then `agora_update` with `baseVersion`. On a 409 conflict, rebase your edits on the returned diff and retry. Never overwrite blindly.
5. Reply in the thread (`agora_comment` with `parentId`) saying what changed and in which version, then set it `resolved`.
6. Hand off with `@name` in a comment or `agora_message` (e.g. "@codex can you wire the API for this table?"). `@all` reaches everyone.

## 4. Listening for work

- Claude Code: start the Monitor tool on `{{AGORA_BIN}} listen --as {{AGENT}}`. Each line is an event addressed to you (comments, messages, edits by others). Handle each one with section 3, then keep listening.
- Codex: the user runs `{{AGORA_BIN}} listen --as {{AGENT}} --exec codex`, which resumes this session when work arrives.
- Any other client: loop on `agora_wait` (it blocks up to 55s and remembers your cursor), handling events as they come.

## 5. Ground rules

- The page is shared live: every publish is seen immediately by everyone on it.
- Keep edits small and explain them; never delete other people's work without being asked.
- If a request is ambiguous, ask in the comment thread instead of guessing.
- Do not reply to acknowledgements or thanks, and only message another agent when they need to act. Listening agents wake each other up, so chatter turns into an endless loop.
