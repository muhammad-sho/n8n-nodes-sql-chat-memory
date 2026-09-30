import type {
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
} from './db';
import { extractRlc } from './fetch';
import type { PostgresCredentials } from './types';

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
