import type {
	IDataObject,
	ILoadOptionsFunctions,
	INode,
	INodeListSearchResult,
	INodePropertyOptions,
} from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';

import {
	getDistinctValues,
	getEnumLabels,
	getTableColumns,
	getTables as fetchTables,
	getSchemas as fetchSchemas,
	withPgClient,
	type Queryable,
} from './db';
import { extractRlc, fetchRoleValueHints } from './fetch';
import { buildMappingPrompt as renderMappingPrompt, buildSqlPrompt as renderSqlPrompt } from './prompts';
import { resolveRoleColumn } from './queryBuilder';
import type { ColumnInfo, PostgresCredentials } from './types';

/** Wrap design-time failures into a user-facing error (never a crash). */
function loadingError(node: INode, error: unknown): never {
	if (error instanceof NodeOperationError) throw error;
	const message = error instanceof Error ? error.message : String(error);
	throw new NodeOperationError(node, message);
}

async function readCredentials(ctx: ILoadOptionsFunctions): Promise<PostgresCredentials> {
	return (await ctx.getCredentials('postgres')) as unknown as PostgresCredentials;
}

/** Read a top-level resourceLocator value ({ mode, value } or plain string). */
function readRlc(ctx: ILoadOptionsFunctions, name: string): string {
	try {
		return extractRlc(ctx.getNodeParameter(name, '', { extractValue: true }));
	} catch {
		return '';
	}
}

function columnOption(column: { column_name: string; data_type: string; is_nullable: string }): INodePropertyOptions {
	return {
		name: column.column_name,
		value: column.column_name,
		description: `Type: ${column.data_type.toUpperCase()}, Nullable: ${column.is_nullable}`,
	};
}

export async function getSchemas(this: ILoadOptionsFunctions): Promise<INodeListSearchResult> {
	try {
		const credentials = await readCredentials(this);
		const schemas = await withPgClient(credentials, (db) => fetchSchemas(db));
		return { results: schemas.map((schema) => ({ name: schema, value: schema })) };
	} catch (error) {
		loadingError(this.getNode(), error);
	}
}

export async function getTables(
	this: ILoadOptionsFunctions,
	filter?: string,
): Promise<INodeListSearchResult> {
	try {
		const credentials = await readCredentials(this);
		const schema = readRlc(this, 'schema') || 'public';
		const tables = await withPgClient(credentials, (db) => fetchTables(db, schema));
		const needle = (filter ?? '').trim().toLowerCase();
		const matching = needle === '' ? tables : tables.filter((name) => name.toLowerCase().includes(needle));
		return { results: matching.map((name) => ({ name, value: name })) };
	} catch (error) {
		loadingError(this.getNode(), error);
	}
}

export async function getColumns(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
	try {
		const credentials = await readCredentials(this);
		const schema = readRlc(this, 'schema') || 'public';
		const table = readRlc(this, 'table');
		if (table === '') return [];
		const columns = await withPgClient(credentials, (db) => getTableColumns(db, schema, table));
		return columns.map(columnOption);
	} catch (error) {
		loadingError(this.getNode(), error);
	}
}

/** Role source values: enum labels when the column is an enum, else sampled DISTINCT values. */
export async function getRoleValues(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
	try {
		const credentials = await readCredentials(this);
		const schema = readRlc(this, 'schema') || 'public';
		const table = readRlc(this, 'table');
		if (table === '') return [];
		const roleColumn = String(this.getNodeParameter('roleColumn', '') ?? '');
		if (roleColumn === '') {
			return [{ name: 'Select a Role Column first…', value: '' }];
		}
		return await withPgClient(credentials, async (db) => {
			const columns = await getTableColumns(db, schema, table);
			const column = columns.find((entry) => entry.column_name === roleColumn);
			let values: string[] = [];
			if (column && column.data_type === 'USER-DEFINED' && column.udt_name) {
				values = await getEnumLabels(db, column.udt_name);
			}
			if (values.length === 0) {
				values = await getDistinctValues(db, schema, table, roleColumn, 200);
			}
			const dataType = (column?.data_type ?? 'unknown').toUpperCase();
			return values.map((value) => ({ name: value, value, description: `Type: ${dataType}` }));
		});
	} catch (error) {
		loadingError(this.getNode(), error);
	}
}

/** Same-schema tables for lookups (excludes the history table itself). */
export async function getLookupTables(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
	try {
		const credentials = await readCredentials(this);
		const schema = readRlc(this, 'schema') || 'public';
		const table = readRlc(this, 'table');
		const tables = await withPgClient(credentials, (db) => fetchTables(db, schema));
		return tables
			.filter((name) => name !== table)
			.map((name) => ({ name, value: name }));
	} catch (error) {
		loadingError(this.getNode(), error);
	}
}

/** Columns of the lookup table selected in the same Message Part. */
export async function getLookupColumns(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
	try {
		const credentials = await readCredentials(this);
		const schema = readRlc(this, 'schema') || 'public';
		let lookupTable = '';
		try {
			lookupTable = String(this.getCurrentNodeParameter('&lookupTable') ?? '');
		} catch {
			lookupTable = '';
		}
		if (lookupTable === '') return [];
		const columns = await withPgClient(credentials, (db) => getTableColumns(db, schema, lookupTable));
		return columns.map(columnOption);
	} catch (error) {
		loadingError(this.getNode(), error);
	}
}

function requireTable(ctx: ILoadOptionsFunctions): { schema: string; table: string } {
	const schema = readRlc(ctx, 'schema') || 'public';
	const table = readRlc(ctx, 'table');
	if (table === '') {
		throw new NodeOperationError(ctx.getNode(), 'Select a Schema and Table first', {
			description: 'The prompt needs your table: pick Schema and Table above, then click the button again.',
		});
	}
	return { schema, table };
}

function readParam(ctx: ILoadOptionsFunctions, name: string, fallback = ''): string {
	try {
		return String(ctx.getNodeParameter(name, fallback) ?? '');
	} catch {
		return fallback;
	}
}

/** Short echo of the current mapping config, so the LLM completes instead of restarting. */
function echoMappingConfig(ctx: ILoadOptionsFunctions): string[] {
	const echo: string[] = [];
	const push = (label: string, name: string): void => {
		const value = readParam(ctx, name);
		if (value !== '') echo.push(`${label}: ${value}`);
	};
	push('Ordering', 'ordering');
	push('Ordering Column override', 'orderColumn');
	push('History Window', 'loadMode');
	push('Limit', 'limit');
	push('Role Column', 'roleColumn');
	push('Content Source', 'contentMode');

	try {
		const raw = ctx.getNodeParameter('where', {}) as { values?: Array<Record<string, unknown>> };
		const filters = Array.isArray(raw?.values) ? raw.values : [];
		for (const filter of filters) {
			if (filter.column) echo.push(`Filter: ${String(filter.column)} ${String(filter.condition ?? '')} ${String(filter.value ?? '')}`.trim());
		}
	} catch {
		// Ignore unreadable filters in the echo.
	}

	try {
		const raw = ctx.getNodeParameter('roleMappings', {}) as { mappings?: Array<Record<string, unknown>> };
		const mappings = Array.isArray(raw?.mappings) ? raw.mappings : [];
		for (const mapping of mappings) {
			if (mapping.sourceValue) echo.push(`Role Mapping: ${String(mapping.sourceValue)} -> ${String(mapping.role ?? '')}`);
		}
	} catch {
		// Ignore unreadable mappings in the echo.
	}

	try {
		const raw = ctx.getNodeParameter('contentParts', {}) as { parts?: Array<Record<string, unknown>> };
		const parts = Array.isArray(raw?.parts) ? raw.parts : [];
		parts.forEach((part, index) => {
			if (part.source === 'lookup') {
				echo.push(
					`Message Part ${index + 1}: lookup ${String(part.valueColumn ?? '')} from ${String(part.lookupTable ?? '')} where ${String(part.foreignColumn ?? '')} = row.${String(part.localColumn ?? '')}`,
				);
			} else if (part.column) {
				echo.push(`Message Part ${index + 1}: column ${String(part.column)}`);
			}
		});
	} catch {
		// Ignore unreadable parts in the echo.
	}

	return echo;
}

export async function buildMappingPrompt(
	this: ILoadOptionsFunctions,
	_payload: IDataObject | string | undefined,
): Promise<string> {
	const node = this.getNode();
	const { schema, table } = requireTable(this);
	const credentials = await readCredentials(this);

	const catalog = await withPgClient(credentials, async (db) => {
		const columns = await getTableColumns(db, schema, table);
		let roleColumn = '';
		try {
			roleColumn = String(this.getNodeParameter('roleColumn', '') ?? '');
		} catch {
			roleColumn = '';
		}
		let resolvedRoleColumn = '';
		try {
			resolvedRoleColumn = resolveRoleColumn(columns, roleColumn || undefined);
		} catch {
			resolvedRoleColumn = '';
		}
		let roleValues: string[] = [];
		if (resolvedRoleColumn !== '') {
			try {
				const column = columns.find((entry) => entry.column_name === resolvedRoleColumn);
				if (column && column.data_type === 'USER-DEFINED' && column.udt_name) {
					roleValues = await getEnumLabels(db, column.udt_name);
				}
				if (roleValues.length === 0) {
					roleValues = await getDistinctValues(db, schema, table, resolvedRoleColumn, 50);
				}
			} catch {
				roleValues = [];
			}
		}
		return { columns, roleValues };
	}).catch((error) => {
		loadingError(node, error);
	});

	return renderMappingPrompt({
		schema,
		table,
		columns: catalog.columns,
		roleValues: catalog.roleValues,
		currentConfig: echoMappingConfig(this),
	});
}

export async function buildSqlPrompt(
	this: ILoadOptionsFunctions,
	_payload: IDataObject | string | undefined,
): Promise<string> {
	const node = this.getNode();
	const { schema, table } = requireTable(this);
	const credentials = await readCredentials(this);

	const catalog = await withPgClient(credentials, async (db) => {
		const columns = await getTableColumns(db, schema, table);
		const roleValues = await fetchRoleValueHintsSafe(db, schema, table, columns);
		return { columns, roleValues };
	}).catch((error) => {
		loadingError(node, error);
	});

	let currentSql = '';
	try {
		currentSql = String(this.getNodeParameter('query', '') ?? '');
	} catch {
		currentSql = '';
	}

	return renderSqlPrompt({
		schema,
		table,
		columns: catalog.columns,
		roleValues: catalog.roleValues,
		currentConfig: [],
		currentSql,
	});
}

async function fetchRoleValueHintsSafe(
	db: Queryable,
	schema: string,
	table: string,
	columns: ColumnInfo[],
): Promise<string[]> {
	try {
		const roleColumn = resolveRoleColumn(columns, undefined);
		return await fetchRoleValueHints(db, schema, table, roleColumn, 50);
	} catch {
		return [];
	}
}
