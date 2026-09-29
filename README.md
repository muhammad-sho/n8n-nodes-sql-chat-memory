# n8n-nodes-sql-chat-memory

Read-only AI Chat Memory for n8n. Loads conversation history from PostgreSQL with a user-defined SQL query.

## What it does

`SQL → rows → LangChain chat messages → AI Agent memory`

- Appears as an **AI Memory** node. Connect its **Memory** output to an **AI Agent's Memory** input.
- Uses the standard n8n **Postgres** credential.
- Runs a user-defined **SQL Query** (expressions supported) during AI Agent execution.
- Expects each SQL row to contain:
  - `role`: `user` | `assistant` | `system` (case-insensitive)
  - `content`: message text
- Converts rows in exact SQL order:
  - `user` → `HumanMessage`
  - `assistant` → `AIMessage`
  - `system` → `SystemMessage`
- Strictly read-only: never saves, updates, inserts, caches, or auto-persists. No polling, session management, or schema creation.

## Example query

```sql
SELECT role, content
FROM chat_messages
WHERE session_id = '{{ $json.sessionId }}'
ORDER BY created_at ASC
LIMIT 50;
```

The SQL is responsible for filtering, ordering, limiting, transforming, and selecting history. Missing `role`/`content` or an unsupported `role` produces a clear node error.

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

## Development

```sh
npm install
npm run build
```

## Releasing (publish to npm via GitHub Actions)

1. Create the GitHub repo and push this project to it.
2. In the repo, go to **Settings → Secrets and variables → Actions** and add a repository secret named `NPM_TOKEN` containing an npm access token (`npmjs.com → Access Tokens → Generate New Token → Automation`).
3. Bump the version in `package.json` for every release (npm rejects re-publishing an existing version).
4. Create a GitHub **Release** (tags like `v0.1.0`). Publishing is triggered automatically when a Release is published and runs `npm publish --access public` using `NPM_TOKEN`.
5. After the workflow succeeds, install in n8n via **Settings → Community nodes → Install** with the package name `n8n-nodes-sql-chat-memory`.
# n8n-nodes-sql-chat-memory
