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

1. **Schema** / 2. **Table** — dropdowns listing what the credential can see (or typed names).
3. **Session Column** + **Session ID** — the column holding the conversation/session/user id, and the value (or an expression like `{{ $json.sessionId }}`). Leave the column empty to load all rows. A selected column with an empty value stops the run instead of leaking other sessions.
4. **Ordering Column** — a timestamp or incrementing id column (newer messages = later timestamps / higher ids). Leave empty to auto-detect. History is always loaded most-recent-first and handed to the AI oldest-first.
5. **Role Column** (required) + **Role Mappings** — map every column value to `user`, `assistant` or `system` (e.g. `sent → assistant`, `received → user`). The dropdown shows each value with its type. Unmapped values stop the run naming the value — nothing is guessed.
6. **Limit** — how many messages to return (1–1000, default 50).

At runtime the node runs exactly one history `SELECT` (plus one tiny catalog read only when Ordering is left on auto-detect). Dropdown population queries only ever run while you configure the node — never per execution. The executed SQL is shown in the run's hints.

## Custom Query mode (advanced)

Only the **SQL Query** field. Write whatever you need — filtering, JOINs, quoted-message lookups, content built with concatenation/CASE — as long as it returns exactly `role` (`user`/`assistant`/`system`) + `content`, oldest rows first. Rows are handed to the AI unchanged. Supports n8n expressions. Read-only: `SELECT`/`WITH ... SELECT` only.

```sql
SELECT role, content
FROM chat_messages
WHERE session_id = '{{ $json.sessionId }}'
ORDER BY created_at ASC
LIMIT 50;
```

Missing `role`/`content` or an unsupported `role` produces a clear node error.

## Ask an LLM for help

Each mode page ends with a static, copy-paste prompt notice (n8n buttons cannot run backend code, so there is deliberately no button — the prompt text is directly selectable). Fill in your table/columns and paste it to any LLM:

- Table Mapping page: asks for the six field values above.
- Custom Query page: asks for the `role`+`content` SELECT.

Full annotated versions live in this README's history: the Table Mapping prompt needs your columns (visible with types in the dropdowns above); the SQL prompt needs your table shape pasted in.

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
