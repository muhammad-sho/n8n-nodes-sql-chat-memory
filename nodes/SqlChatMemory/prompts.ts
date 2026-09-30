import type { ColumnInfo } from './types';

export interface PromptTableContext {
	schema: string;
	table: string;
	columns: ColumnInfo[];
	/** Distinct values of the role column (enum labels or sampled), if known. */
	roleValues?: string[];
	/** Snake-case echo of the current (possibly partial) node configuration. */
	currentConfig: string[];
}

function formatColumns(columns: ColumnInfo[]): string {
	return columns
		.map((column) => `- ${column.column_name} (${column.data_type.toUpperCase()}, nullable: ${column.is_nullable})`)
		.join('\n');
}

const SHARED_INTRO = `You are helping configure an n8n "SQL Chat Memory" community node (package n8n-nodes-sql-chat-memory).

What the node is: a strictly READ-ONLY AI chat memory. At AI Agent runtime it loads past conversation turns from a PostgreSQL table and hands them to the AI Agent as ordered chat messages (user -> Human, assistant -> AI, system -> System). It NEVER writes: no INSERT, UPDATE, DELETE, no persistence, no caching. New turns must be saved by a separate downstream INSERT in the workflow, which is outside this node's job.`;

const SHARED_RULES = `Hard rules for anything you produce:
- Output messages must be in chronological order (oldest first).
- Only three roles exist: user, assistant, system. Map every source value to exactly one of them.
- The node is read-only. Never propose writes, triggers, schema changes, or persistence.`;

export function buildMappingPrompt(context: PromptTableContext): string {
	const lines: string[] = [
		SHARED_INTRO,
		'',
		'The user configures the node with the "Table Mapping" UI (no SQL needed). Your job: tell them EXACTLY what to select in each field, based on THEIR table below.',
		'',
		`TABLE: "${context.schema}"."${context.table}"`,
		'COLUMNS:',
		formatColumns(context.columns),
	];

	if (context.roleValues && context.roleValues.length > 0) {
		lines.push('', `DISTINCT VALUES found in the likely role column: ${context.roleValues.join(', ')}`);
	}

	if (context.currentConfig.length > 0) {
		lines.push('', 'CURRENT (possibly incomplete) node configuration — complete it, do not restart from scratch:');
		for (const entry of context.currentConfig) lines.push(`- ${entry}`);
	}

	lines.push(
		'',
		'Now produce, field by field:',
		'1. Role Column: which column holds the sender/type. Then the Role Mappings: EVERY distinct value mapped to user, assistant or system (e.g. sent -> assistant, received -> user).',
		'2. Content Template: one text with {{column}} placeholders for row columns and {{lookup}} placeholders for looked-up values, e.g. {{message}} (replying to: "{{quoted}}", message id: "{{id}}"). For values living in another table (e.g. a quoted message behind quoted_message_id), define a Content Lookup: a name plus lookup table, local key column, match column and value column; missing keys render the lookup fallback text.',
		'3. Ordering Column (timestamp or incrementing id column) and History Window (Most Recent N vs Oldest N).',
		'4. Select Rows filter for scoping to one conversation (e.g. a session/user/chat id column = the runtime session id).',
		'',
		SHARED_RULES,
		'',
		'Respond with the concrete field values only, no SQL, no explanations of other tools.',
	);

	return lines.join('\n');
}

export function buildSqlPrompt(context: PromptTableContext & { currentSql?: string }): string {
	const lines: string[] = [
		SHARED_INTRO,
		'',
		'The user configures the node with a "Custom Query" (raw SQL). Your job: write the exact SELECT for THEIR table below.',
		'',
		`TABLE: "${context.schema}"."${context.table}"`,
		'COLUMNS:',
		formatColumns(context.columns),
	];

	if (context.roleValues && context.roleValues.length > 0) {
		lines.push('', `DISTINCT VALUES found in the likely role column: ${context.roleValues.join(', ')}`);
	}

	if (context.currentSql && context.currentSql.trim() !== '') {
		lines.push('', 'CURRENT SQL (fix/complete it, do not restart from scratch):', context.currentSql);
	}

	lines.push(
		'',
		'The query MUST:',
		'1. Return exactly two columns named `role` and `content`. `role` must contain only user, assistant or system (map the table\'s own values with a CASE expression). `content` is the final message text — build it in SQL (concatenation, CASE, subqueries or JOINs for quoted messages are all fine).',
		'2. Return rows oldest first (ORDER BY a timestamp or incrementing id column ASC).',
		'3. Scope to one conversation, e.g. WHERE session_column = {{ $json.sessionId }} (the node evaluates n8n expressions in the query).',
		'4. Be read-only: SELECT or WITH ... SELECT only. Never INSERT/UPDATE/DELETE.',
		'',
		SHARED_RULES,
		'',
		'Respond with the final SQL only, plus one line per non-obvious mapping choice.',
	);

	return lines.join('\n');
}
