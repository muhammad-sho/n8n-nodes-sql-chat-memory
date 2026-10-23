# SQL Chat Memory for n8n

This node gives your AI Agent **memory of past conversations** by loading chat history from PostgreSQL. It only reads data — it never saves anything.

## The problem it solves

By default, an n8n AI Agent forgets everything after each run. If you store your chat history in PostgreSQL (from a previous workflow, an app, a database, etc.), this node reads that history and feeds it to the agent so it can continue the conversation.

## How it works

```
Your stored history (PostgreSQL)
        ↓
   SQL Chat Memory
        ↓
   AI Agent  →  remembers the conversation
        ↓
   AI response
        ↓
   You save the new message yourself (INSERT)
```

This node **only reads**. Saving new messages is your responsibility — add a downstream `INSERT` or use a separate node.

## Quick setup (3 steps)

1. **Connect** the node's **Memory** output to your AI Agent's **Memory** input.
2. **Configure** one of the two modes below (Table Mapping or Custom Query).
3. **Run** — the agent receives the loaded history as chat messages.

## Two ways to load history

### Option A — Table Mapping (no SQL)

Point at a table and map its columns in the UI. Good if your history table is simple.

Fields, top to bottom:

1. **Schema** and **Table** — pick from the list, or type a name.
2. **Session Column** + **Session ID** — the column that groups messages into one conversation, and the value for the current one (for example `{{ $json.sessionId }}`). Leave the column empty if the whole table is one conversation.
3. **Order Column** — the date or number column that puts messages in order. Leave empty to detect it automatically. The newest messages are always loaded.
4. **Role Column** (required) + **Role Mappings** — the column that says who wrote each message. Match every value to `user`, `assistant`, or `system`. Unmatched values stop the run and name the value — nothing is guessed.
5. **Max Messages** — how many past messages to load (1–1000, default 50).

The lists load only while you set up the node, never during a run.

### Option B — Custom Query (advanced)

Write your own `SELECT`. Use this for filtering, joins, or building the message text in SQL.

Each result row must look like this:

```json
[
  { "role": "user", "content": "hello" },
  { "role": "assistant", "content": "Hi, how can I help?" }
]
```

- `role` must be one of `user`, `assistant`, or `system`.
- Load the newest X messages, but return them oldest first.
- You can use expressions like `{{ $json.sessionId }}`.
- Only `SELECT` (or `WITH ... SELECT`) is allowed. The query is checked for writes, including writes hidden inside `WITH` clauses.
- Missing `role`/`content` or an unsupported `role` gives a clear error.

The SQL page ends with a guidance box showing this same JSON format.

## What the node does NOT do

- Does not save, insert, update, or delete messages.
- Does not create tables or manage sessions.
- Does not poll or run in the background.
- Does not guess roles — you map them explicitly.

## Debugging

After an AI Agent run, open the SQL Chat Memory sub-node (or the agent's execution log). The exact messages handed to the AI are recorded there as `{ role, content }` rows — the same shape as the Custom Query output.

## Versions

- **v1** (npm 0.1.0): SQL-only sub-node, frozen unchanged.
- **v1.1** (npm 0.2.x–0.4.5): Table Mapping UI plus Custom Query. Existing v1 workflows keep working untouched. Any table or column name works — identifiers are quoted and never judged against examples.

## Development

```sh
npm install
npm run build
npm test
```

## Releasing (publish to npm via GitHub Actions)

1. Push to GitHub (`main` branch).
2. Repo **Settings → Secrets and variables → Actions** holds `NPM_TOKEN` (npm Automation token).
3. Bump `version` in `package.json` for every release (npm rejects re-publishing a version).
4. Create a GitHub **Release** (tag like `v0.4.0`). Publishing runs automatically (`npm publish --access public`).
5. Install in n8n via **Settings → Community nodes → Install**: `n8n-nodes-sql-chat-memory`.
