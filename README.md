# SQL Chat Memory for n8n

Give your AI Agent memory of past conversations — **read straight from your existing PostgreSQL table**, whatever its shape.

## The problem it solves

n8n's built-in Postgres Chat Memory only works with **its own table and its own columns**. If your chat history already lives somewhere else — an app's `messages` table, a CRM, a custom schema — that node can't read it.

This node connects to that table as it is. You point at the table, map its columns, and the AI Agent receives a normal conversation history. **No migration, no renaming, no schema changes.**

For example, a table that looks nothing like n8n's format:

| id | chat_id | sender  | body              | sent_at  |
|----|---------|---------|-------------------|----------|
| 1  | abc     | visitor | Where is my order?| 10:00    |
| 2  | abc     | bot     | Let me check.     | 10:01    |

…becomes `visitor → user`, `bot → assistant`, and the rows are handed to the agent oldest first.

## Installation

In n8n: **Settings → Community nodes → Install**, then enter:

```
n8n-nodes-sql-chat-memory
```

Requires a **Postgres credential** (the standard n8n one). SSH Tunnel must be disabled for this credential — it isn't supported.

## Setup in 3 steps

1. **Connect** the node's **Memory** output to your AI Agent's **Memory** input.
2. **Choose a mode** and fill in the fields (see below).
3. **Run** the workflow — the agent receives the history as chat messages.

This is a pure memory sub-node: it has no Main input/output. Data for expressions (like `{{ $json.sessionId }}`) comes from the AI Agent connection.

## Mode A — Table Mapping (no SQL)

Use this when your table has a column for the message text and a column that says who sent it.

1. **Schema** and **Table** — pick from the list, or type the name.
2. **Session Column** + **Session ID** — the column that groups messages into one conversation, and the value for the current one (for example `{{ $json.sessionId }}`). Leave the column empty if the whole table is one conversation.
3. **Order Column** — the date or number column that puts messages in order. Leave empty to detect it automatically. The newest messages are loaded.
4. **Role Column** (required) + **Role Mappings** — the column that says who wrote each message. Match every value to `user`, `assistant`, or `system`. Unmatched values stop the run and name the value — nothing is guessed.
5. **Max Messages** — how many past messages to load (1–1000, default 50).

The text of each message is taken from the table's text column automatically. The dropdown lists are read only while you set up the node — never during a run.

## Mode B — Custom Query (advanced)

Use this when you need filtering, joins, or to build the message text in SQL.

Write a `SELECT` that returns rows in this form:

```json
[
  { "role": "user", "content": "hello" },
  { "role": "assistant", "content": "Hi, how can I help?" }
]
```

- `role` must be `user`, `assistant`, or `system`.
- Load the newest messages, but return them **oldest first**.
- Expressions are allowed, e.g. `{{ $json.sessionId }}`.
- Only `SELECT` (or `WITH ... SELECT`) is allowed. Writes are blocked, including ones hidden inside `WITH`.
- Missing `role`/`content` or an unsupported `role` produces a clear error.

The SQL page ends with a guidance box showing this same format.

## What this node does not do

- It never saves, updates, or deletes — saving new messages is up to you (add your own `INSERT` step after the agent replies).
- It doesn't create tables or manage sessions.
- It doesn't run in the background or poll.
- It doesn't guess roles — you map them.

## Debugging

After an agent run, open the SQL Chat Memory sub-node (or the agent's execution log). The exact messages handed to the AI are listed there as `{ role, content }` rows — the same shape as the Custom Query output.

## Versions

- **v1** (npm 0.1.0): SQL-only, frozen unchanged.
- **v1.1** (npm 0.2.x–0.4.5): Table Mapping plus Custom Query. Existing v1 workflows keep working untouched.

## Development

```sh
npm install
npm run build
npm test
```

## Releasing

1. Push to GitHub (`main`).
2. The repo's **Settings → Secrets and variables → Actions** holds `NPM_TOKEN` (npm automation token).
3. Bump `version` in `package.json` for every release — npm rejects re-publishing a version.
4. Create a GitHub **Release** (tag like `v0.4.5`); publishing runs automatically.
