# n8n-nodes-sql-chat-memory

Read-only AI Chat Memory for n8n. Loads conversation history from PostgreSQL — either by pointing at a table in the UI or with your own SQL — and hands it to the AI Agent as ordered chat messages.

## What it does

`Table/SQL → rows → LangChain chat messages → AI Agent memory`

- A pure AI sub-node: connect its **Memory** output to an **AI Agent's Memory** input. It receives its data context (e.g. previous nodes' items for expressions like `{{ $json.sessionId }}`) through that connection — no Main input/output.
- Uses the standard n8n **Postgres** credential.
- Runs during AI Agent execution; converts rows in order:
  - `user` → `HumanMessage`
  - `assistant` → `AIMessage`
  - `system` → `SystemMessage`
- Strictly read-only: never saves, updates, inserts, caches, or auto-persists. No polling, session management, or schema creation.

## Table Mapping mode (direct mapping, no SQL)

Six fields, top to bottom:

1. **Schema** / 2. **Table** — pick from the lists, or type a name.
3. **Session Column** + **Session ID** — the column that groups messages into one conversation, and the value for the current one (or an expression like `{{ $json.sessionId }}`). Leave the column empty if the table holds a single conversation.
4. **Order Column** — the date or number column that puts messages in order. Leave empty to detect it automatically. The newest messages are always loaded.
5. **Role Column** (required) + **Role Mappings** — the column that says who wrote each message, with every value matched to the person (`user`), the AI (`assistant`) or an instruction (`system`). Unmatched values stop the run and name the value — nothing is guessed.
6. **Max Messages** — how many past messages to load (1–1000, default 50).

The lists only load while you set up the node — never during a run.

## Custom Query mode (advanced)

Only the **SQL Query** field. Write whatever you need — filtering, JOINs, message text built in SQL — as long as each result row looks like this:

```json
[
  { "role": "user", "content": "hello" },
  { "role": "assistant", "content": "Hi, how can I help?" }
]
```

`role` is one of `user`, `assistant` or `system`. Load the newest X messages, but return them oldest first. You can use expressions. Read-only: `SELECT` queries only.

Missing `role`/`content` or an unsupported `role` produces a clear node error.

## Custom query format

The Custom Query page ends with a guidance box showing this same JSON output format. Write the query however you want around that.

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
             application-controlled
             database INSERT
```

Persist new turns with your own downstream INSERT. This node only reads.

## Debugging

After an AI Agent run, open the SQL Chat Memory sub-node (or the agent's execution log): the exact messages handed to the AI are recorded there as `{ role, content }` rows — the same shape as the Custom Query output. The node stays a pure memory sub-node with no Main input/output.

## Versions

- **v1** (npm 0.1.0): SQL-only sub-node, frozen unchanged.
- **v1.1** (npm 0.2.x–0.4.x): Table Mapping UI plus Custom Query. Existing v1 workflows keep working untouched. Any table/column naming works — identifiers are quoted, never judged against examples.

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
