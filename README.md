# n8n-nodes-sql-chat-memory

Read-only AI Chat Memory for n8n. Loads conversation history from PostgreSQL — either by pointing at a table in the UI or with your own SQL — and hands it to the AI Agent as ordered chat messages.

## What it does

`Table/SQL → rows → LangChain chat messages → AI Agent memory`

- Appears as an **AI Memory** node. Connect its **Memory** output to an **AI Agent's Memory** input.
- Uses the standard n8n **Postgres** credential.
- Runs during AI Agent execution (`supplyData`); converts rows in order:
  - `user` → `HumanMessage`
  - `assistant` → `AIMessage`
  - `system` → `SystemMessage`
- Strictly read-only: never saves, updates, inserts, caches, or auto-persists. No polling, session management, or schema creation.

## Modes (v1.1)

**Table Mapping** (default, no SQL needed): pick Schema + Table from dropdowns, optionally add Select Rows filters (e.g. a session/user/chat id column = `{{ $json.sessionId }}`), pick ordering (auto-detected: timestamp, else integer key), History Window (Most Recent N / Oldest N) and Limit. Then map:

- **Role Column** (+ Role Mappings for custom values like `sent → assistant`, `received → user`; standard names are auto-recognized),
- **Message Parts** (one or more columns with optional prefix/suffix/fallback, concatenated in order; parts can also come from another table via a batched key lookup, e.g. a quoted message by id).

Every mapping field defaults to auto-detect with an explicit override. The executed SQL is shown in the run's hints.

**Custom Query**: write the SELECT yourself. It must return exactly `role` (`user`/`assistant`/`system`) + `content`, oldest rows first. Rows are handed to the AI unchanged. Read-only: `SELECT`/`WITH ... SELECT` only.

```sql
SELECT role, content
FROM chat_messages
WHERE session_id = '{{ $json.sessionId }}'
ORDER BY created_at ASC
LIMIT 50;
```

The SQL is responsible for filtering, ordering, limiting, transforming, and selecting history. Missing `role`/`content` or an unsupported `role` produces a clear node error.

## Testing inside the node (v1.1)

The node also has a Main input and a **Preview** output. Connect any upstream node (e.g. a Manual Trigger or Set with a sample session id), open the node and **Test step**: the same fetch the Agent would run executes, and the mapped `{ role, content }` rows appear in the output panel. The Memory output works unchanged for the AI Agent.

## Copy Prompt to Ask LLM (v1.1)

At the end of the node (one button per mode page) sits **Copy Prompt to Ask LLM**. Select Schema + Table first, then click: the node reads your table's columns, types, and role values, combines them with your current settings, and builds a ready-to-paste prompt that tells an LLM exactly how to configure the mapping — or which SELECT to write — for your custom table format.

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
- **v1.1** (npm 0.2.0): Table Mapping UI, in-node Preview testing, copy-prompt buttons. Existing v1 workflows keep working untouched.

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
4. Create a GitHub **Release** (tag like `v0.2.0`). Publishing runs automatically (`npm publish --access public`).
5. Install in n8n via **Settings → Community nodes → Install**: `n8n-nodes-sql-chat-memory`.
