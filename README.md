# SQL Chat Memory

**Read-only chat memory for n8n AI Agents — powered by your own PostgreSQL table.**

[![npm](https://img.shields.io/npm/v/n8n-nodes-sql-chat-memory.svg)](https://www.npmjs.com/package/n8n-nodes-sql-chat-memory)
[![license](https://img.shields.io/npm/l/n8n-nodes-sql-chat-memory.svg)](LICENSE)

---

## Why this node exists

n8n's built-in **Postgres Chat Memory** creates and reads **its own table** with fixed columns. If your conversation history already lives in a different table — an app database, a CRM, a custom schema — the built-in node can't use it.

This node reads **your table, as it is**. You map its columns once, and your AI Agent gets the history in the format it understands. No migration, no renaming, no schema changes.

| | Built-in Postgres Chat Memory | SQL Chat Memory |
|---|---|---|
| Table | Created and owned by n8n | **Your existing table** |
| Columns | Fixed | **Any names or types** |
| Works with existing data | No | **Yes** |
| Saves messages | Yes | No — read-only |

**Example:** a table that looks nothing like n8n's format…

| id | chat_id | sender  | body               | sent_at |
|----|---------|---------|--------------------|---------|
| 1  | abc     | visitor | Where is my order? | 10:00   |
| 2  | abc     | bot     | Let me check.      | 10:01   |

…maps to `visitor → user`, `bot → assistant`, and reaches the agent oldest-first.

---

## Install

In n8n, go to **Settings → Community nodes → Install** and enter:

```
n8n-nodes-sql-chat-memory
```

Then connect the node's **Memory** output to your **AI Agent's Memory** input.

> Requires a standard n8n **Postgres** credential. **SSH Tunnel must be disabled** — it isn't supported.

---

## Setup

1. Add **SQL Chat Memory** to your workflow.
2. Connect its **Memory** output to the **AI Agent → Memory** input.
3. Pick a mode and fill in the fields below.
4. Run the workflow — the agent receives the history as chat messages.

This is a memory sub-node: it has no Main input or output. Expressions like `{{ $json.sessionId }}` read data from the AI Agent connection.

---

## Mode 1 — Table Mapping

*Best when your table has a message-text column and a column that says who sent it.*

| Field | What to set |
|---|---|
| **Schema** / **Table** | Pick from the list, or type a name. |
| **Session Column** | The column that groups messages into one conversation. Leave empty if the whole table is one conversation. |
| **Session ID** | The value for the current conversation, e.g. `{{ $json.sessionId }}`. |
| **Order Column** | The date or number column that orders messages. Leave empty to detect automatically. The newest messages are loaded. |
| **Role Column** | The column that says who wrote each message. |
| **Role Mappings** | Match every value of that column to `user`, `assistant`, or `system`. |
| **Max Messages** | How many past messages to load (1–1000, default 50). |

The message text is taken automatically from the table's text column. Dropdown lists are read while you set up the node only — never during a run.

---

## Mode 2 — Custom Query

*Best when you need filtering, joins, or to build the message text in SQL.*

Write a `SELECT` that returns rows like this:

```json
[
  { "role": "user", "content": "hello" },
  { "role": "assistant", "content": "Hi, how can I help?" }
]
```

**Rules**

- `role` must be `user`, `assistant`, or `system`.
- Return the newest messages, but ordered **oldest first**.
- Expressions are allowed, e.g. `{{ $json.sessionId }}`.
- Only `SELECT` / `WITH … SELECT` is allowed. Writes are blocked — including ones hidden inside `WITH`.
- Use `LIMIT` and a `WHERE` on the session column to keep the result small.

The SQL page ends with a box repeating this format.

---

## Good to know

- **Read-only.** The node never saves, updates, or deletes. Save new messages with your own `INSERT` step after the agent replies.
- **No background work.** No polling, no table creation, no session management.
- **No guessing.** Every role value must be mapped; an unmapped value stops the run and names it.
- **Debugging.** After a run, open the sub-node (or the execution log) to see the exact `{ role, content }` messages sent to the AI.

### Common errors

| Error | Fix |
|---|---|
| `Session ID is empty` | Fill in **Session ID**, or clear **Session Column** to load all rows. |
| `unsupported role "…"` | Add a **Role Mapping** for that value. |
| `Could not auto-detect an order column` | Pick an **Order Column** manually. |
| `SSH Tunnel is not supported` | Disable SSH Tunnel in the Postgres credential. |
| `Only SELECT queries are allowed` | Custom Query accepts read-only `SELECT` only. |

---

## Versions

| Version | Notes |
|---|---|
| **1** (npm 0.1.0) | SQL-only. Frozen — existing workflows are unaffected. |
| **1.1** (npm 0.2.x – 0.4.5) | Table Mapping + Custom Query. Recommended. |

---

<details>
<summary><strong>For maintainers</strong></summary>

```sh
npm install
npm run build
npm test
```

Releasing:

1. Bump `version` in `package.json` (npm rejects re-publishing a version).
2. Push to `main`.
3. Create a GitHub Release (tag like `v0.4.5`). Publishing uses the `NPM_TOKEN` repo secret.

</details>
