import { quoteIdent } from './db';
import type { ColumnInfo, WhereCondition } from './types';

const TEXT_TYPES = new Set([
	'text',
	'character varying',
	'varchar',
	'character',
	'char',
	'citext',
	'uuid',
	'name',
]);
const JSON_TYPES = new Set(['json', 'jsonb']);
const TIMESTAMP_TYPES = new Set([
	'timestamp without time zone',
	'timestamp with time zone',
	'date',
]);
const INTEGER_TYPES = new Set(['smallint', 'integer', 'bigint', 'smallserial', 'serial', 'bigserial']);

const ROLE_NAME_HINT = /^(role|type|direction|sender|sent_by|from|author|speaker|role_name|message_type)$/i;
const CONTENT_NAME_HINT = /(message|content|body|text)/i;

export function isTextColumn(column: ColumnInfo): boolean {
	if (TEXT_TYPES.has(column.data_type)) return true;
	if (JSON_TYPES.has(column.data_type)) return true;
	// Postgres enums surface as USER-DEFINED with a custom udt_name.
	if (column.data_type === 'USER-DEFINED' && column.udt_name && !column.udt_name.startsWith('_')) {
		return true;
	}
	return false;
}

function columnNames(columns: ColumnInfo[]): string[] {
	return columns.map((column) => column.column_name);
}

/** Resolve the role column: explicit selection wins, otherwise auto-detect by name. */
export function resolveRoleColumn(columns: ColumnInfo[], selected?: string): string {
	const names = columnNames(columns);
	if (selected) {
		if (!names.includes(selected)) {
			throw new Error(
				`Role column "${selected}" does not exist. Available text columns: ${names.filter((name) => columns.some((c) => c.column_name === name && isTextColumn(c))).join(', ') || '(none)'}`,
			);
		}
		return selected;
	}
	const candidates = columns.filter(isTextColumn);
	const byName = candidates.find((column) => ROLE_NAME_HINT.test(column.column_name));
	if (byName) return byName.column_name;
	throw new Error(
		'Could not auto-detect the role column. ' +
			`Pick it explicitly. Text-like columns: ${candidates.map((c) => c.column_name).join(', ') || '(none)'}`,
	);
}

export interface ResolvedOrder {
	primary: string;
	secondary?: string;
}

/**
 * Resolve the ordering column: explicit selection wins, otherwise
 * first timestamp column, then an integer key column, then a first integer column.
 */
export function resolveOrderColumn(
	columns: ColumnInfo[],
	keyColumns: string[],
	selected?: string,
): ResolvedOrder {
	const names = new Set(columnNames(columns));
	if (selected) {
		if (!names.has(selected)) {
			throw new Error(`Ordering column "${selected}" does not exist in this table.`);
		}
		const secondary = keyColumns.find((key) => key !== selected && names.has(key));
		return secondary ? { primary: selected, secondary } : { primary: selected };
	}

	const timestamp = columns.find((column) => TIMESTAMP_TYPES.has(column.data_type));
	if (timestamp) {
		const secondary = keyColumns.find((key) => key !== timestamp.column_name && names.has(key));
		return secondary
			? { primary: timestamp.column_name, secondary }
			: { primary: timestamp.column_name };
	}

	const integerKeys = keyColumns.filter((key) => {
		const column = columns.find((c) => c.column_name === key);
		return column !== undefined && INTEGER_TYPES.has(column.data_type);
	});
	if (integerKeys.length > 0) return { primary: integerKeys[0] };

	const integer = columns.find((column) => INTEGER_TYPES.has(column.data_type));
	if (integer) return { primary: integer.column_name };

	throw new Error(
		'Could not auto-detect an ordering column (no timestamp or integer column found). ' +
			'Pick an Ordering Column explicitly or set Ordering to "None".',
	);
}

/** Resolve the content column for auto content mode. */
export function resolveContentColumn(columns: ColumnInfo[]): string {
	const textLike = columns.filter(isTextColumn);
	const preferred = textLike.find((column) => CONTENT_NAME_HINT.test(column.column_name));
	if (preferred) return preferred.column_name;
	if (textLike.length > 0) return textLike[0].column_name;
	throw new Error(
		'Could not auto-detect a content column (no text-like column found). ' +
			'Switch Content Source to "Custom parts" and pick the columns explicitly.',
	);
}

const CONDITION_SQL: Record<string, string> = {
	equal: '=',
	'!=': '!=',
	'>': '>',
	'<': '<',
	'>=': '>=',
	'<=': '<=',
	LIKE: 'LIKE',
	'NOT LIKE': 'NOT LIKE',
};

/** Build a WHERE clause fragment (without the WHERE keyword) + bound values. */
export function buildWhere(
	conditions: WhereCondition[],
	combine: 'AND' | 'OR',
): { clause: string; values: unknown[] } {
	const parts: string[] = [];
	const values: unknown[] = [];

	conditions.forEach((condition, index) => {
		if (!condition.column || String(condition.column).trim() === '') {
			throw new Error(`Select Rows: condition ${index + 1} has no column selected.`);
		}
		const column = quoteIdent(String(condition.column));
		if (condition.condition === 'IS NULL' || condition.condition === 'IS NOT NULL') {
			parts.push(`${column} ${condition.condition}`);
			return;
		}
		const operator = CONDITION_SQL[condition.condition];
		if (operator === undefined) {
			throw new Error(`Select Rows: unsupported operator "${condition.condition}".`);
		}
		values.push(condition.value ?? null);
		parts.push(`${column} ${operator} $${values.length}`);
	});

	return { clause: parts.join(` ${combine} `), values };
}

export interface HistoryQueryParams {
	schema: string;
	table: string;
	select: string[];
	where: WhereCondition[];
	combine: 'AND' | 'OR';
	orderPrimary: string | null;
	orderSecondary?: string;
	direction: 'ASC' | 'DESC';
	limit: number;
}

export interface BuiltQuery {
	text: string;
	values: unknown[];
}

/** Build the history SELECT. All identifiers quoted, all values parameterized. */
export function buildHistoryQuery(params: HistoryQueryParams): BuiltQuery {
	if (params.select.length === 0) {
		throw new Error('Internal error: nothing to select for the history query.');
	}
	const limit = Math.max(1, Math.floor(params.limit));
	let text =
		`SELECT ${params.select.map((column) => quoteIdent(column)).join(', ')} ` +
		`FROM ${quoteIdent(params.schema)}.${quoteIdent(params.table)}`;

	const { clause, values } = buildWhere(params.where, params.combine);
	if (clause !== '') {
		text += ` WHERE ${clause}`;
	}

	if (params.orderPrimary) {
		text += ` ORDER BY ${quoteIdent(params.orderPrimary)} ${params.direction}`;
		if (params.orderSecondary) {
			text += `, ${quoteIdent(params.orderSecondary)} ${params.direction}`;
		}
	}

	text += ` LIMIT ${limit}`;
	return { text, values };
}

/** Build the single batched lookup query (keys bound as one array parameter). */
export function buildLookupQuery(params: {
	schema: string;
	table: string;
	foreignColumn: string;
	valueColumn: string;
}): BuiltQuery {
	const text =
		`SELECT ${quoteIdent(params.foreignColumn)} AS __key, ${quoteIdent(params.valueColumn)} AS __value ` +
		`FROM ${quoteIdent(params.schema)}.${quoteIdent(params.table)} ` +
		`WHERE ${quoteIdent(params.foreignColumn)} = ANY($1)`;
	return { text, values: [] };
}
