# SQL Chat Memory (n8n node)

Read-only AI Chat Memory for n8n. Loads past conversation turns from PostgreSQL and hands them to an AI Agent so it remembers the conversation.

This node **only reads**. It never saves, inserts, updates, or deletes anything. You store new messages yourself (for example, with a downstream `INSERT`).

## What you do with it

1. Add the node to your workflow.
2. Connect its **Memory** output to your AI Agent's **Memory** input.
3. Configure how to load history (point at a table, or write your own SQL).
4. Run the workflow — the agent receives the loaded history as chat messages.

## Connection

- Pure AI sub-node: **no Main input/output**. Data context (for example `{{ $json.sessionId }}`) reaches it through the AI Agent connection.
- Uses the standard n8n **Postgres** credential.
- Output: **Memory** (connect to the AI Agent's Memory input).

## How history is loaded

Each database row becomes one chat message:

| `role` value | becomes |
|---|---|
| `user` | a message from the person |
| `assistant` | a message from the AI |
| `system` | an instruction/system message |

You choose how to load history:

- **Table Mapping** — pick a table and map its columns in the UI. No SQL needed.
- **Custom Query** — write your own `SELECT` for full control (filtering, joins, building the message text in SQL).

## Table Mapping mode

Six fields, top to bottom:

1. **Schema** and **Table** — pick from the lists, or type a name.
2. **Session Column** + **Session ID** — the column that groups messages into one conversation, and the value for the current one (for example `{{ $json.sessionId }}`). Leave the column empty if the whole table is one conversation.
3. **Order Column** — the date or number column that puts messages in order. Leave empty to detect it automatically. The newest messages are always loaded.
4. **Role Column** (required) + **Role Mappings** — the column that says who wrote each message. Match every value there to `user`, `assistant`, or `system`. Unmatched values stop the run and name the value — nothing is guessed.
5. **Max Messages** — how many past messages to load (1–1000, default 50).

The lists load only while you set up the node, never during a run.

## Custom Query mode

Only the **SQL Query** field. Write whatever you need, as long as each result row looks like this:

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

## Intended workflow

```
Incoming message
    ↓
SQL Chat Memory ──────┐
                      ↓
                   AI Agent
                      ↓
                 AI response
                      ↓
             normal workflow nodes
                      ↓
             your own database INSERT
```

Persist new turns with your own downstream `INSERT`. This node only reads.

## Debugging

After an AI Agent run, open the SQL Chat Memory sub-node (or the agent's execution log). The exact messages handed to the AI are recorded there as `{ role, content }` rows — the same shape as the Custom Query output. The node stays a pure memory sub-node with no Main input/output.

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
