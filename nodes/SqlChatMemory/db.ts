import { Client, type ClientConfig } from 'pg';

import type { ColumnInfo, PostgresCredentials } from './types';

export type { ColumnInfo };

/**
 * Quote a SQL identifier by wrapping it in double quotes and escaping embedded
 * double quotes (`"` -> `""`).
 *
 * Deliberately permissive: any non-empty name is accepted as-is — quoted
 * identifiers in Postgres may contain spaces, mixed case, digits, unicode,
 * even dots. User tables are fully custom, so the node never judges a name
 * against example patterns. The only rejection is an empty string, which
 * cannot form an identifier at all. Callers pass schema and table (or column)
 * separately, so qualification stays correct without ever splitting names.
 * Throws a plain Error — callers wrap it into a NodeOperationError.
 */
export function quoteIdent(name: string): string {
	const text = String(name ?? '');
	if (text.trim() === '') {
		throw new Error('Identifier is empty');
	}
	return `"${text.replace(/"/g, '""')}"`;
}

export function createPgClient(credentials: PostgresCredentials): Client {
	const config: ClientConfig = {
		host: credentials.host || 'localhost',
		port: credentials.port ?? 5432,
		database: credentials.database,
		user: credentials.user,
		password: credentials.password,
	};

	if (credentials.allowUnauthorizedCerts === true) {
		config.ssl = { rejectUnauthorized: false };
	} else if (!credentials.ssl || credentials.ssl === 'disable') {
		config.ssl = false;
	} else {
		config.ssl = true;
	}

	return new Client(config);
}

/** Run `fn` with a connected client that is always closed afterwards. */
export async function withPgClient<T>(
	credentials: PostgresCredentials,
	fn: (client: Pick<Client, 'query'>) => Promise<T>,
): Promise<T> {
	const client = createPgClient(credentials);
	try {
		await client.connect();
		return await fn(client);
	} finally {
		try {
			await client.end();
		} catch {
			// Ignore close errors; the query outcome takes precedence.
		}
	}
}

/** Minimal queryable surface (real pg Client satisfies this; tests stub it). */
export interface Queryable {
	query(text: string, values?: unknown[]): Promise<{ rows: Array<Record<string, unknown>> }>;
}

export async function getTableColumns(
	db: Queryable,
	schema: string,
	table: string,
): Promise<ColumnInfo[]> {
	const result = await db.query(
		'SELECT column_name, data_type, udt_name, is_nullable ' +
			'FROM information_schema.columns WHERE table_schema = $1 AND table_name = $2 ' +
			'ORDER BY ordinal_position',
		[schema, table],
	);
	return result.rows as unknown as ColumnInfo[];
}

export async function getSchemas(db: Queryable): Promise<string[]> {
	const result = await db.query(
		"SELECT schema_name FROM information_schema.schemata " +
			"WHERE schema_name NOT LIKE 'pg\\_%' AND schema_name <> 'information_schema' " +
			'ORDER BY schema_name',
	);
	return result.rows.map((row) => String(row.schema_name));
}

export async function getTables(db: Queryable, schema: string): Promise<string[]> {
	const result = await db.query(
		'SELECT table_name FROM information_schema.tables WHERE table_schema = $1 ORDER BY table_name',
		[schema],
	);
	return result.rows.map((row) => String(row.table_name));
}

/** Enum labels for a user-defined (enum) column type, e.g. a role enum. */
export async function getEnumLabels(db: Queryable, udtName: string): Promise<string[]> {
	const result = await db.query(
		'SELECT e.enumlabel AS label FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid ' +
			'WHERE t.typname = $1 ORDER BY e.enumsortorder',
		[udtName],
	);
	return result.rows.map((row) => String(row.label));
}

/** Distinct non-null values of a column (capped), for role-value pickers. */
export async function getDistinctValues(
	db: Queryable,
	schema: string,
	table: string,
	column: string,
	limit = 200,
): Promise<string[]> {
	const result = await db.query(
		`SELECT DISTINCT ${quoteIdent(column)} AS value FROM ${quoteIdent(schema)}.${quoteIdent(table)} ` +
			`WHERE ${quoteIdent(column)} IS NOT NULL ORDER BY 1 LIMIT ${Math.max(1, Math.floor(limit))}`,
	);
	return result.rows.map((row) => String(row.value));
}

/**
 * Primary-key columns of a table (unique columns as fallback), for
 * auto ordering. Mirrors the approach of n8n's native Postgres node.
 */
export async function getKeyColumns(
	db: Queryable,
	schema: string,
	table: string,
	primaryOnly: boolean,
): Promise<string[]> {
	const result = await db.query(
		'SELECT DISTINCT a.attname AS name FROM pg_index i ' +
			'JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey) ' +
			"WHERE i.indrelid = (quote_ident($1) || '.' || quote_ident($2))::regclass " +
			(primaryOnly ? 'AND i.indisprimary' : 'AND (i.indisprimary OR i.indisunique)'),
		[schema, table],
	);
	return result.rows.map((row) => String(row.name));
}
