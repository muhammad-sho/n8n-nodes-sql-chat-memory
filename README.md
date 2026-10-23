# SQL Chat Memory for n8n

This node gives your AI Agent **memory of past conversations stored in your own PostgreSQL table**.

## The problem it solves

n8n ships a built-in Postgres Chat Memory node, but it only works with **its own table and its own column schema**. If your chat history already lives in a table with different column names, types, or layout (from an app, a CRM, a custom schema, etc.), that built-in node cannot read it.

This node bridges that gap: **point at any existing table, map its columns, and the AI Agent gets the history in the form it understands.** No migration, no renaming columns, no rewriting your schema.

## How it works

```
Your existing history table (any columns, any shape)
        ↓
   SQL Chat Memory  (maps your columns → user/assistant/system messages)
        ↓
   AI Agent  →  remembers the conversation
        ↓
   AI response
        ↓
   You save the new message yourself (INSERT into your own table)
```

This node **only reads**. It never saves, inserts, updates, or deletes anything. You store new messages yourself.

## Quick setup

1. **Connect** the node's **Memory** output to your AI Agent's **Memory** input.
2. **Configure** one of the two modes below (Table Mapping or Custom Query).
3. **Run** — the agent receives the loaded history as chat messages.

## Two ways to load history

### Option A — Table Mapping (no SQL)

Point at an existing table and map its columns in the UI. Best for straightforward tables.

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
- Does not require you to change your existing table schema.

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
