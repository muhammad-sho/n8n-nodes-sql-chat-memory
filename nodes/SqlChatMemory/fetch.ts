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
	getDistinctValues,
	getEnumLabels,
	getKeyColumns,
	getTableColumns,
	withPgClient,
	type Queryable,
} from './db';
import { mapTableRows, rowsToMessages, toText } from './messageMapper';
import {
	buildHistoryQuery,
	buildLookupQuery,
	resolveContentColumn,
	resolveOrderColumn,
	resolveRoleColumn,
} from './queryBuilder';
import type {
	ChatRole,
	ContentPart,
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
	where: WhereCondition[];
	combine: 'AND' | 'OR';
	ordering: 'auto' | 'column' | 'none';
	orderColumnSelected: string;
	loadMode: 'recent' | 'oldest';
	limit: number;
	roleColumnSelected: string;
	explicitRoles: RoleMapping[];
	contentMode: 'auto' | 'custom';
	parts: ContentPart[];
}

function readTableParams(ctx: FetchContext, itemIndex: number): TableParams {
	const get = (name: string, fallback?: unknown): unknown =>
		ctx.getNodeParameter(name, itemIndex, fallback);

	const schema = extractRlc(asParam(get('schema', '')));
	const table = extractRlc(asParam(get('table', '')));

	const whereRaw = get('where', {}) as { values?: Array<Record<string, unknown>> };
	const where: WhereCondition[] = Array.isArray(whereRaw?.values)
		? whereRaw.values.map((entry) => ({
				column: String(entry.column ?? ''),
				condition: String(entry.condition ?? 'equal'),
				value: entry.value,
			}))
		: [];

	const roleRaw = get('roleMappings', {}) as { mappings?: Array<Record<string, unknown>> };
	const explicitRoles: RoleMapping[] = Array.isArray(roleRaw?.mappings)
		? roleRaw.mappings
				.filter((entry) => String(entry.sourceValue ?? '').trim() !== '')
				.map((entry) => ({
					from: String(entry.sourceValue ?? ''),
					to: String(entry.role ?? 'user') as ChatRole,
				}))
		: [];

	const contentMode = String(get('contentMode', 'auto') ?? 'auto') as 'auto' | 'custom';
	const partsRaw = get('contentParts', {}) as { parts?: Array<Record<string, unknown>> };
	const parts: ContentPart[] = Array.isArray(partsRaw?.parts)
		? partsRaw.parts.map((entry) => ({
				source: (String(entry.source ?? 'column') === 'lookup' ? 'lookup' : 'column') as
					| 'column'
					| 'lookup',
				column: String(entry.column ?? ''),
				prefix: String(entry.prefix ?? ''),
				suffix: String(entry.suffix ?? ''),
				fallback: String(entry.fallback ?? ''),
				lookupTable: String(entry.lookupTable ?? ''),
				localColumn: String(entry.localColumn ?? ''),
				foreignColumn: String(entry.foreignColumn ?? ''),
				valueColumn: String(entry.valueColumn ?? ''),
			}))
		: [];

	const limitRaw = Number(get('limit', 50));
	const limit = Number.isFinite(limitRaw) ? Math.min(1000, Math.max(1, Math.floor(limitRaw))) : 50;

	return {
		schema,
		table,
		where,
		combine: (String(get('combineConditions', 'AND')) === 'OR' ? 'OR' : 'AND') as 'AND' | 'OR',
		ordering: ((): 'auto' | 'column' | 'none' => {
			const value = String(get('ordering', 'auto') ?? 'auto');
			return value === 'column' || value === 'none' ? value : 'auto';
		})(),
		orderColumnSelected: String(get('orderColumn', '') ?? ''),
		loadMode: (String(get('loadMode', 'recent')) === 'oldest' ? 'oldest' : 'recent') as
			| 'recent'
			| 'oldest',
		limit,
		roleColumnSelected: String(get('roleColumn', '') ?? ''),
		explicitRoles,
		contentMode,
		parts,
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
			resolveRoleColumn(tableColumns, params.roleColumnSelected || undefined),
		);

		let orderPrimary: string | null = null;
		let orderSecondary: string | undefined;
		if (params.ordering !== 'none') {
			const keys = await getKeyColumns(db, params.schema, params.table, false);
			const resolved = wrapResolve(node, itemIndex, 'Ordering column', () =>
				resolveOrderColumn(
					tableColumns,
					keys,
					params.ordering === 'column' || params.orderColumnSelected
						? params.orderColumnSelected || undefined
						: undefined,
				),
			);
			if (params.ordering === 'column' && !params.orderColumnSelected) {
				fail(node, itemIndex, 'Select an Ordering Column', 'Ordering is set to "Specific column" but no column is selected.');
			}
			orderPrimary = resolved.primary;
			orderSecondary = resolved.secondary;
		}

		let parts: ContentPart[];
		if (params.contentMode === 'auto') {
			const autoColumn = wrapResolve(node, itemIndex, 'Content column', () =>
				resolveContentColumn(tableColumns),
			);
			parts = [{ source: 'column', column: autoColumn, prefix: '', suffix: '', fallback: '' }];
		} else {
			if (params.parts.length === 0) {
				fail(
					node,
					itemIndex,
					'Add at least one Message Part',
					'Content Source is "Custom parts" but no parts are defined. Add a part (column or lookup) below.',
				);
			}
			parts = params.parts.map((part, partIndex) => {
				if (part.source === 'lookup') {
					for (const [key, label] of [
						['lookupTable', 'Lookup Table'],
						['localColumn', 'Local Column'],
						['foreignColumn', 'Match Column'],
						['valueColumn', 'Value Column'],
					] as const) {
						if (!part[key] || String(part[key]).trim() === '') {
							fail(node, itemIndex, `Message Part ${partIndex + 1}: ${label} is missing`, 'Fill in all lookup fields (table, local column, match column, value column).');
						}
					}
				} else if (!part.column || part.column.trim() === '') {
					fail(node, itemIndex, `Message Part ${partIndex + 1}: no column selected`, 'Pick a column for the message part (or switch the part to a lookup).');
				}
				return part;
			});
		}

		const selectSet = new Set<string>([roleColumn]);
		if (orderPrimary) selectSet.add(orderPrimary);
		if (orderSecondary) selectSet.add(orderSecondary);
		for (const part of parts) {
			if (part.source === 'lookup') {
				if (part.localColumn) selectSet.add(part.localColumn);
			} else if (part.column) {
				selectSet.add(part.column);
			}
		}

		const direction = params.loadMode === 'recent' && orderPrimary ? 'DESC' : 'ASC';
		const { text: sql, values } = buildHistoryQuery({
			schema: params.schema,
			table: params.table,
			select: [...selectSet],
			where: params.where,
			combine: params.combine,
			orderPrimary,
			orderSecondary,
			direction,
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

		// Single batched lookup per lookup part (no N+1).
		for (const part of parts) {
			if (part.source !== 'lookup') continue;
			const keys = [...new Set(rows.map((row) => row[part.localColumn ?? '']).filter((key) => key !== undefined && key !== null && key !== ''))];
			const lookupValues = new Map<string, string>();
			if (keys.length > 0) {
				const lookup = buildLookupQuery({
					schema: params.schema,
					table: String(part.lookupTable),
					foreignColumn: String(part.foreignColumn),
					valueColumn: String(part.valueColumn),
				});
				try {
					const lookupResult = await db.query(lookup.text, [keys]);
					for (const lookupRow of lookupResult.rows) {
						lookupValues.set(String(lookupRow.__key), toText(lookupRow.__value));
					}
				} catch (error) {
					const message = error instanceof Error ? error.message : String(error);
					fail(node, itemIndex, `Lookup query failed: ${message}`, `Executed SQL: ${lookup.text}`);
				}
			}
			part.lookupValues = lookupValues;
		}

		let messages = mapTableRows(
			rows,
			{ roleColumn, explicitRoles: params.explicitRoles, parts },
			node,
			itemIndex ?? undefined,
		);
		if (params.loadMode === 'recent' && orderPrimary) {
			messages = [...messages].reverse();
		}

		const autoNotes: string[] = [];
		if (params.ordering === 'auto' && !params.orderColumnSelected && orderPrimary) {
			autoNotes.push(`ordering=${orderPrimary}`);
		}
		if (params.contentMode === 'auto') {
			autoNotes.push(`content=${parts[0]?.column ?? ''}`);
		}
		if (!params.roleColumnSelected) {
			autoNotes.push(`role=${roleColumn}`);
		}
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

/** Distinct role values for prompt context (enum labels preferred, else sampled). */
export async function fetchRoleValueHints(
	db: Queryable,
	schema: string,
	table: string,
	roleColumn: string,
	limit = 50,
): Promise<string[]> {
	try {
		const columns = await getTableColumns(db, schema, table);
		const column = columns.find((entry) => entry.column_name === roleColumn);
		if (column && column.data_type === 'USER-DEFINED' && column.udt_name) {
			const labels = await getEnumLabels(db, column.udt_name);
			if (labels.length > 0) return labels;
		}
	} catch {
		// Fall through to sampling below.
	}
	try {
		return await getDistinctValues(db, schema, table, roleColumn, limit);
	} catch {
		return [];
	}
}
