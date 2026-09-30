import type { BaseMessage } from '@langchain/core/messages';
import type {
	IDataObject,
	INode,
	IGetNodeParameterOptions,
	NodeExecutionHint,
	NodeParameterValueType,
} from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';

import {
	getKeyColumns,
	getTableColumns,
	withPgClient,
	type Queryable,
} from './db';
import { mapTableRows, rowsToMessages } from './messageMapper';
import {
	buildHistoryQuery,
	resolveContentColumn,
	resolveOrderColumn,
	resolveRoleColumn,
} from './queryBuilder';
import type {
	ChatRole,
	DbRow,
	PostgresCredentials,
	RoleMapping,
	SqlChatRow,
	WhereCondition,
} from './types';

/**
 * Minimal context for the shared fetch. Callers cast their
 * full context object to this shape.
 */
export interface FetchContext {
	getNode(): INode;
	getNodeParameter(
		parameterName: string,
		itemIndex: number,
		fallbackValue?: unknown,
		options?: IGetNodeParameterOptions,
	): unknown;
	getCredentials(credentialName: string): Promise<unknown>;
	addExecutionHints(...hints: NodeExecutionHint[]): void;
}

export interface FetchResult {
	messages: BaseMessage[];
	/** The exact SQL text that was executed (shown to the user via hints). */
	sql: string;
	rowCount: number;
}

function asParam(value: unknown): NodeParameterValueType | IDataObject {
	return value as NodeParameterValueType | IDataObject;
}

/** Unwrap a resourceLocator value ({ mode, value }) or a plain string. */
export function extractRlc(value: unknown): string {
	if (value === null || value === undefined) return '';
	if (typeof value === 'object') {
		const record = value as Record<string, unknown>;
		if (typeof record.value === 'string') return record.value;
		return '';
	}
	return String(value);
}

function fail(node: INode, itemIndex: number | undefined, message: string, description: string): never {
	throw new NodeOperationError(node, message, { itemIndex, description });
}

/** Best-effort read-only guard for user SQL (v1.1 SQL mode). */
export function assertReadOnlySql(sql: string, node: INode, itemIndex?: number): void {
	const withoutComments = sql
		.replace(/--[^\n]*\n?/g, '\n')
		.replace(/\/\*[\s\S]*?\*\//g, ' ')
		.trim();
	const firstWord = withoutComments.split(/[\s(]/, 1)[0]?.toUpperCase() ?? '';
	if (firstWord !== 'SELECT' && firstWord !== 'WITH') {
		fail(
			node,
			itemIndex,
			'Only SELECT queries are allowed',
			'This node is strictly read-only. The query must start with SELECT (or WITH ... SELECT). Writes belong in a downstream node, e.g. a database INSERT you control.',
		);
	}
}

interface TableParams {
	schema: string;
	table: string;
	sessionColumn: string;
	sessionValue: unknown;
	orderColumnSelected: string;
	roleColumnSelected: string;
	explicitRoles: RoleMapping[];
	limit: number;
}

function readTableParams(ctx: FetchContext, itemIndex: number): TableParams {
	const get = (name: string, fallback?: unknown): unknown =>
		ctx.getNodeParameter(name, itemIndex, fallback);

	const schema = extractRlc(asParam(get('schema', '')));
	const table = extractRlc(asParam(get('table', '')));

	const roleRaw = get('roleMappings', {}) as { mappings?: Array<Record<string, unknown>> };
	const explicitRoles: RoleMapping[] = Array.isArray(roleRaw?.mappings)
		? roleRaw.mappings
				.filter((entry) => String(entry.sourceValue ?? '').trim() !== '')
				.map((entry) => ({
					from: String(entry.sourceValue ?? ''),
					to: String(entry.role ?? 'user') as ChatRole,
				}))
		: [];

	const limitRaw = Number(get('limit', 50));
	const limit = Number.isFinite(limitRaw) ? Math.min(1000, Math.max(1, Math.floor(limitRaw))) : 50;

	return {
		schema,
		table,
		sessionColumn: String(get('sessionColumn', '') ?? ''),
		sessionValue: get('sessionValue', ''),
		orderColumnSelected: String(get('orderColumn', '') ?? ''),
		roleColumnSelected: String(get('roleColumn', '') ?? ''),
		explicitRoles,
		limit,
	};
}

function wrapResolve<T>(node: INode, itemIndex: number | undefined, what: string, fn: () => T): T {
	try {
		return fn();
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		fail(node, itemIndex, `${what}: ${message}`, 'Adjust the Table Mapping settings (a hint below shows the executed SQL).');
	}
}

async function fetchTableMode(
	ctx: FetchContext,
	node: INode,
	itemIndex: number | undefined,
	params: TableParams,
	credentials: PostgresCredentials,
): Promise<FetchResult> {
	if (params.table.trim() === '') {
		fail(
			node,
			itemIndex,
			'Select a Schema and Table first',
			'Pick the history table above. The dropdowns list what the Postgres credential can see.',
		);
	}
	if (params.roleColumnSelected.trim() === '') {
		fail(
			node,
			itemIndex,
			'Select a Role Column',
			'Pick the column holding the sender/type, then map each of its values below.',
		);
	}

	// Single safe session filter. A selected column with an empty value fails
	// fast: silently loading every conversation would leak other sessions.
	let where: WhereCondition[] = [];
	if (params.sessionColumn.trim() !== '') {
		if (
			params.sessionValue === undefined ||
			params.sessionValue === null ||
			String(params.sessionValue).trim() === ''
		) {
			fail(
				node,
				itemIndex,
				'Session ID is empty',
				'A Session Column is selected but the Session ID value resolved empty. Fill it (a value or an expression like {{ $json.sessionId }}), or clear the Session Column to load all rows.',
			);
		}
		where = [{ column: params.sessionColumn, condition: 'equal', value: params.sessionValue }];
	}

	return await withPgClient(credentials, async (db: Queryable) => {
		const tableColumns = await getTableColumns(db, params.schema, params.table);
		if (tableColumns.length === 0) {
			fail(
				node,
				itemIndex,
				`Table "${params.schema}"."${params.table}" was not found or has no visible columns`,
				'Check the Schema/Table selection and that the Postgres credential may read the table.',
			);
		}

		const roleColumn = wrapResolve(node, itemIndex, 'Role column', () =>
			resolveRoleColumn(tableColumns, params.roleColumnSelected),
		);

		// Message history is logically ordered (newer = higher id / later
		// timestamp). Empty selection auto-detects; otherwise the pick is used.
		const keys =
			params.orderColumnSelected.trim() !== ''
				? []
				: await getKeyColumns(db, params.schema, params.table, false);
		const order = wrapResolve(node, itemIndex, 'Ordering column', () =>
			resolveOrderColumn(tableColumns, keys, params.orderColumnSelected.trim() || undefined),
		);

		const contentColumn = wrapResolve(node, itemIndex, 'Content column', () =>
			resolveContentColumn(tableColumns),
		);

		const selectSet = new Set<string>([roleColumn, order.primary, contentColumn]);
		if (order.secondary) selectSet.add(order.secondary);

		const { text: sql, values } = buildHistoryQuery({
			schema: params.schema,
			table: params.table,
			select: [...selectSet],
			where,
			combine: 'AND',
			orderPrimary: order.primary,
			orderSecondary: order.secondary,
			direction: 'DESC',
			limit: params.limit,
		});

	 let rows: DbRow[];
		try {
			const result = await db.query(sql, values);
			if (!Array.isArray(result.rows)) {
				fail(node, itemIndex, 'Table query did not return an array of rows', 'Internal error: expected the history query to return rows.');
			}
			rows = result.rows as DbRow[];
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			fail(node, itemIndex, `Table query failed: ${message}`, `Executed SQL: ${sql}`);
		}

		// Newest N rows come back first; reverse to chronological for the AI.
		let messages = mapTableRows(
			rows,
			{ roleColumn, explicitRoles: params.explicitRoles, contentColumn },
			node,
			itemIndex ?? undefined,
		);
		messages = [...messages].reverse();

		const autoNotes: string[] = [];
		if (params.orderColumnSelected.trim() === '') {
			autoNotes.push(`ordering=${order.primary}`);
		}
		autoNotes.push(`content=${contentColumn}`);
		ctx.addExecutionHints({
			type: 'info',
			message: `SQL Chat Memory executed: ${sql}${autoNotes.length > 0 ? ` (auto-detected ${autoNotes.join(', ')})` : ''}`,
			location: 'outputPane',
		});

		return { messages, sql, rowCount: rows.length };
	});
}

async function fetchSqlMode(
	ctx: FetchContext,
	node: INode,
	itemIndex: number | undefined,
	credentials: PostgresCredentials,
): Promise<FetchResult> {
	const query = ctx.getNodeParameter('query', itemIndex ?? 0, '') as string;
	if (!query || query.trim() === '') {
		fail(
			node,
			itemIndex,
			'SQL Query is empty',
			'Enter a SELECT query that returns "role" and "content" columns, e.g. SELECT role, content FROM chat_messages ORDER BY created_at ASC.',
		);
	}
	assertReadOnlySql(query, node, itemIndex);

	const { messages, rowCount } = await withPgClient(credentials, async (db: Queryable) => {
		let rows: unknown;
		try {
			const result = await db.query(query);
			rows = result.rows;
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			fail(node, itemIndex, `SQL query failed: ${message}`, 'Check the query syntax and that the referenced tables/columns exist.');
		}
		if (!Array.isArray(rows)) {
			fail(node, itemIndex, 'SQL query did not return an array of rows', 'The SQL query must return rows containing "role" and "content" columns.');
		}
		const mapped = rowsToMessages(rows as SqlChatRow[], node, itemIndex ?? undefined);
		return { messages: mapped, rowCount: (rows as unknown[]).length };
	});

	ctx.addExecutionHints({
		type: 'info',
		message: `SQL Chat Memory executed ${rowCount} histor${rowCount === 1 ? 'y row' : 'y rows'} from custom SQL.`,
		location: 'outputPane',
	});

	return { messages, sql: query, rowCount };
}

/** Shared fetch behind supplyData() (Agent memory path). */
export async function fetchMappedMessages(
	ctx: FetchContext,
	itemIndex: number,
): Promise<FetchResult> {
	const node = ctx.getNode();
	const mode = String(ctx.getNodeParameter('mode', itemIndex, 'table') ?? 'table');

	const credentials = (await ctx.getCredentials('postgres')) as unknown as PostgresCredentials;
	if (credentials?.sshTunnel) {
		fail(node, itemIndex, 'SSH Tunnel is not supported by SQL Chat Memory', 'Disable SSH Tunnel in the Postgres credential for this node.');
	}

	if (mode === 'sql') {
		return await fetchSqlMode(ctx, node, itemIndex, credentials);
	}
	return await fetchTableMode(ctx, node, itemIndex, readTableParams(ctx, itemIndex), credentials);
}
