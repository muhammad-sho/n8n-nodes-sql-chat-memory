'use strict';

const { describe, it, afterEach } = require('node:test');
const assert = require('node:assert/strict');

const loaders = require('../dist/nodes/SqlChatMemory/loadOptions.js');

const fakeNode = { name: 'SQL Chat Memory', type: 'sqlChatMemory', typeVersion: 1.1, position: [0, 0], parameters: {} };
const CREDS = { host: 'localhost', port: 5432, database: 'db', user: 'u', password: 'p', ssl: 'disable' };

const MESSAGES_COLUMNS = [
	{ column_name: 'id', data_type: 'bigint', udt_name: 'int8', is_nullable: 'NO' },
	{ column_name: 'direction', data_type: 'USER-DEFINED', udt_name: 'chat_direction', is_nullable: 'NO' },
	{ column_name: 'message', data_type: 'character varying', udt_name: 'varchar', is_nullable: 'YES' },
	{ column_name: 'created_at', data_type: 'timestamp with time zone', udt_name: 'timestamptz', is_nullable: 'NO' },
];
const QUOTES_COLUMNS = [
	{ column_name: 'id', data_type: 'bigint', udt_name: 'int8', is_nullable: 'NO' },
	{ column_name: 'text', data_type: 'text', udt_name: 'text', is_nullable: 'YES' },
];

function loadCtx({ params = {}, currentParams = {} } = {}) {
	return {
		getNode: () => fakeNode,
		getNodeParameter: (name, fallback, options) => {
			let value = name in params ? params[name] : fallback;
			if (options?.extractValue && value && typeof value === 'object' && 'value' in value) {
				return value.value;
			}
			return value;
		},
		getCurrentNodeParameter: (path) => {
			if (!(path in currentParams)) throw new Error(`missing ${path}`);
			return currentParams[path];
		},
		getCredentials: async () => CREDS,
	};
}

function installFakeClient() {
	const pg = require('pg');
	const OriginalClient = pg.Client;
	const seen = [];
	pg.Client = class FakeClient {
		async connect() {}
		async query(text, values) {
			seen.push({ text, values });
			if (text.includes('information_schema.columns')) {
				return { rows: values[1] === 'quotes' ? QUOTES_COLUMNS : MESSAGES_COLUMNS };
			}
			if (text.includes('pg_enum')) return { rows: [{ label: 'sent' }, { label: 'received' }] };
			if (text.includes('SELECT DISTINCT')) return { rows: [{ value: 'a' }, { value: 'b' }] };
			if (text.includes('information_schema.schemata')) return { rows: [{ schema_name: 'public' }] };
			if (text.includes('information_schema.tables')) return { rows: [{ table_name: 'messages' }, { table_name: 'quotes' }] };
			if (text.includes('pg_index')) return { rows: [{ name: 'id' }] };
			return { rows: [] };
		}
		async end() {}
	};
	return { seen, restore: () => { pg.Client = OriginalClient; } };
}

const BASE_PARAMS = {
	schema: { mode: 'list', value: 'public' },
	table: { mode: 'list', value: 'messages' },
};

describe('listSearch', () => {
	let mock;
	afterEach(() => mock?.restore());

	it('lists schemas and tables (with filter)', async () => {
		mock = installFakeClient();
		const schemas = await loaders.getSchemas.call(loadCtx({ params: BASE_PARAMS }));
		assert.deepEqual(schemas, { results: [{ name: 'public', value: 'public' }] });
		const tables = await loaders.getTables.call(loadCtx({ params: BASE_PARAMS }), 'mes');
		assert.deepEqual(tables, { results: [{ name: 'messages', value: 'messages' }] });
	});
});

describe('loadOptions', () => {
	let mock;
	afterEach(() => mock?.restore());

	it('getColumns shows types', async () => {
		mock = installFakeClient();
		const options = await loaders.getColumns.call(loadCtx({ params: BASE_PARAMS }));
		assert.equal(options.length, 4);
		assert.deepEqual(options[1], { name: 'direction', value: 'direction', description: 'Type: USER-DEFINED, Nullable: NO' });
	});

	it('getColumns returns [] without a table', async () => {
		mock = installFakeClient();
		const options = await loaders.getColumns.call(loadCtx({ params: { ...BASE_PARAMS, table: '' } }));
		assert.deepEqual(options, []);
	});

	it('getRoleValues prefers enum labels, else samples distinct values', async () => {
		mock = installFakeClient();
		const withEnum = await loaders.getRoleValues.call(
			loadCtx({ params: { ...BASE_PARAMS, roleColumn: 'direction' } }),
		);
		assert.deepEqual(withEnum.map((o) => o.value), ['sent', 'received']);

		const sampled = await loaders.getRoleValues.call(
			loadCtx({ params: { ...BASE_PARAMS, roleColumn: 'message' } }),
		);
		assert.deepEqual(sampled.map((o) => o.value), ['a', 'b']);
	});

	it('getRoleValues asks for the role column first', async () => {
		mock = installFakeClient();
		const options = await loaders.getRoleValues.call(loadCtx({ params: BASE_PARAMS }));
		assert.deepEqual(options, [{ name: 'Select a Role Column first…', value: '' }]);
	});

	it('getLookupTables excludes the history table; getLookupColumns reads the sibling', async () => {
		mock = installFakeClient();
		const tables = await loaders.getLookupTables.call(loadCtx({ params: BASE_PARAMS }));
		assert.deepEqual(tables, [{ name: 'quotes', value: 'quotes' }]);
		const columns = await loaders.getLookupColumns.call(
			loadCtx({ params: BASE_PARAMS, currentParams: { '&lookupTable': 'quotes' } }),
		);
		assert.deepEqual(columns.map((c) => c.value), ['id', 'text']);
	});
});

describe('actionHandler (copy-prompt buttons)', () => {
	let mock;
	afterEach(() => mock?.restore());

	it('buildMappingPrompt requires a table and echoes config', async () => {
		mock = installFakeClient();
		await assert.rejects(
			loaders.buildMappingPrompt.call(loadCtx({ params: { schema: BASE_PARAMS.schema, table: '' } })),
			/Select a Schema and Table first/,
		);
		const prompt = await loaders.buildMappingPrompt.call(
			loadCtx({ params: { ...BASE_PARAMS, roleColumn: 'direction', limit: 20 } }),
		);
		assert.match(prompt, /"public"\."messages"/);
		assert.match(prompt, /direction \(USER-DEFINED/);
		assert.match(prompt, /sent, received/);
		assert.match(prompt, /Role Column: direction/);
		assert.match(prompt, /Limit: 20/);
	});

	it('buildSqlPrompt includes the contract and current SQL', async () => {
		mock = installFakeClient();
		const prompt = await loaders.buildSqlPrompt.call(
			loadCtx({ params: { ...BASE_PARAMS, query: 'SELECT role, content FROM t' } }),
		);
		assert.match(prompt, /exactly two columns named `role` and `content`/);
		assert.match(prompt, /SELECT role, content FROM t/);
	});
});
