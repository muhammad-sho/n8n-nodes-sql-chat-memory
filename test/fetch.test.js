'use strict';

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');

const { SqlChatMemoryV1 } = require('../dist/nodes/SqlChatMemory/SqlChatMemoryV1.node.js');
const { SqlChatMemoryV11 } = require('../dist/nodes/SqlChatMemory/SqlChatMemoryV11.node.js');

const fakeNode = { name: 'SQL Chat Memory', type: 'sqlChatMemory', typeVersion: 1.1, position: [0, 0], parameters: {} };
const CREDS = { host: 'localhost', port: 5432, database: 'db', user: 'u', password: 'p', ssl: 'disable' };

const CATALOG = {
	messages: [
		{ column_name: 'id', data_type: 'bigint', udt_name: 'int8', is_nullable: 'NO' },
		{ column_name: 'direction', data_type: 'text', udt_name: 'text', is_nullable: 'NO' },
		{ column_name: 'message', data_type: 'character varying', udt_name: 'varchar', is_nullable: 'YES' },
		{ column_name: 'quoted_message_id', data_type: 'bigint', udt_name: 'int8', is_nullable: 'YES' },
		{ column_name: 'created_at', data_type: 'timestamp with time zone', udt_name: 'timestamptz', is_nullable: 'NO' },
	],
};

function installFakeClient(handler) {
	const pg = require('pg');
	const OriginalClient = pg.Client;
	const seen = { configs: [], queries: [] };
	pg.Client = class FakeClient {
		constructor(config) {
			seen.configs.push(config);
		}
		async connect() {}
		async query(text, values) {
			seen.queries.push({ text, values });
			return handler(text, values);
		}
		async end() {
			seen.ended = true;
		}
	};
	return { seen, restore: () => { pg.Client = OriginalClient; } };
}

function catalogHandler(extra = {}) {
	return (text) => {
		if (text.includes('information_schema.columns')) {
			return { rows: CATALOG.messages };
		}
		if (text.includes('pg_index')) {
			return { rows: [{ name: 'id' }] };
		}
		return extra.default ? extra.default(text) : { rows: [] };
	};
}

function makeCtx({ params = {}, hints = [] } = {}) {
	return {
		hints,
		getNode: () => fakeNode,
		getNodeParameter: (name, _itemIndex, fallback) => (name in params ? params[name] : fallback),
		getCredentials: async () => CREDS,
		addExecutionHints: (...h) => { hints.push(...h); },
	};
}

const TABLE_PARAMS = {
	mode: 'table',
	schema: { mode: 'list', value: 'public' },
	table: { mode: 'list', value: 'messages' },
	where: {},
	combineConditions: 'AND',
	ordering: 'auto',
	orderColumn: '',
	loadMode: 'recent',
	limit: 50,
	roleColumn: '',
	roleMappings: {
		mappings: [
			{ sourceValue: 'sent', role: 'assistant' },
			{ sourceValue: 'received', role: 'user' },
		],
	},
	contentMode: 'auto',
	contentParts: {},
};

describe('fetchMappedMessages — Table Mapping mode (mocked pg)', () => {
	let mock;
	afterEach(() => mock?.restore());

	it('auto-detects role/order/content, reverses recent-first rows, adds hints', async () => {
		const historyRows = [
			{ direction: 'sent', message: 'second' },
			{ direction: 'received', message: 'first' },
		];
		mock = installFakeClient((text) => {
			const base = catalogHandler()(text);
			if (base.rows.length > 0 || text.includes('information_schema') || text.includes('pg_index')) return base;
			return { rows: historyRows };
		});
		const hints = [];
		const node = new SqlChatMemoryV11();
		const out = await node.supplyData.call(makeCtx({ params: TABLE_PARAMS, hints }), 0);

		const vars = await out.response.loadMemoryVariables({});
		assert.equal(vars.chat_history.length, 2);
		// DB returned newest-first (DESC); memory must be chronological.
		assert.equal(vars.chat_history[0].content, 'first');
		assert.equal(vars.chat_history[1].content, 'second');
		assert.match(mock.seen.queries.map((q) => q.text).join(' '), /ORDER BY "created_at" DESC/);
		assert.ok(hints.some((h) => String(h.message).includes('SQL Chat Memory executed:')));
		assert.ok(hints.some((h) => String(h.message).includes('role=direction')));
		// Read-only: nothing extra was written.
		await out.response.saveContext({ input: 'x' }, { output: 'y' });
		assert.equal((await out.response.loadMemoryVariables({})).chat_history.length, 2);
	});

	it('resolves lookups with a single batched ANY query', async () => {
		const historyRows = [
			{ direction: 'sent', message: 'reply', quoted_message_id: 7 },
			{ direction: 'received', message: 'plain', quoted_message_id: null },
		];
		let lookupCalls = 0;
		mock = installFakeClient((text) => {
			if (text.includes('information_schema.columns')) return { rows: CATALOG.messages };
			if (text.includes('pg_index')) return { rows: [{ name: 'id' }] };
			if (text.includes('__key')) {
				lookupCalls += 1;
				assert.match(text, /= ANY\(\$1\)/);
				return { rows: [{ __key: 7, __value: 'original text' }] };
			}
			return { rows: historyRows };
		});
		const params = {
			...TABLE_PARAMS,
			contentMode: 'custom',
			contentParts: {
				parts: [
					{ source: 'column', column: 'message', prefix: '', suffix: '', fallback: '' },
					{
						source: 'lookup', lookupTable: 'messages', localColumn: 'quoted_message_id',
						foreignColumn: 'id', valueColumn: 'message',
						prefix: ' (respondendo a "', suffix: '")', fallback: '',
					},
				],
			},
		};
		const node = new SqlChatMemoryV11();
		const out = await node.supplyData.call(makeCtx({ params }), 0);
		const vars = await out.response.loadMemoryVariables({});
		assert.equal(lookupCalls, 1, 'exactly one batched lookup query');
		assert.equal(vars.chat_history[1].content, 'reply (respondendo a "original text")');
		assert.equal(vars.chat_history[0].content, 'plain');
	});

	it('applies where filters as bound parameters', async () => {
		mock = installFakeClient((text) => {
			const base = catalogHandler()(text);
			if (base.rows.length > 0 || text.includes('information_schema') || text.includes('pg_index')) return base;
			return { rows: [] };
		});
		const params = {
			...TABLE_PARAMS,
			where: { values: [{ column: 'chat_id', condition: 'equal', value: 's1' }] },
		};
		await new SqlChatMemoryV11().supplyData.call(makeCtx({ params }), 0);
		const main = mock.seen.queries.find((q) => q.text.startsWith('SELECT "direction"'));
		assert.match(main.text, /WHERE "chat_id" = \$1/);
		assert.deepEqual(main.values, ['s1']);
	});

	it('errors clearly without a table and on unmapped roles', async () => {
		const node = new SqlChatMemoryV11();
		await assert.rejects(
			node.supplyData.call(makeCtx({ params: { ...TABLE_PARAMS, table: '' } }), 0),
			/Select a Schema and Table first/,
		);

		mock = installFakeClient((text) => {
			const base = catalogHandler()(text);
			if (base.rows.length > 0 || text.includes('information_schema') || text.includes('pg_index')) return base;
			return { rows: [{ direction: 'mystery', message: 'x' }] };
		});
		await assert.rejects(
			node.supplyData.call(makeCtx({ params: { ...TABLE_PARAMS, roleMappings: {} } }), 0),
			/unsupported role "mystery"/,
		);
	});
});

describe('fetchMappedMessages — SQL mode (mocked pg)', () => {
	let mock;
	afterEach(() => mock?.restore());

	it('maps role/content rows directly', async () => {
		mock = installFakeClient(() => ({
			rows: [
				{ role: 'user', content: 'hello' },
				{ role: 'assistant', content: 'hi!' },
			],
		}));
		const out = await new SqlChatMemoryV11().supplyData.call(
			makeCtx({ params: { mode: 'sql', query: 'SELECT role, content FROM t ORDER BY id' } }),
			0,
		);
		const vars = await out.response.loadMemoryVariables({});
		assert.equal(vars.chat_history.length, 2);
		assert.equal(mock.seen.queries[0].text, 'SELECT role, content FROM t ORDER BY id');
	});

	it('rejects non-SELECT statements, allows WITH', async () => {
		const node = new SqlChatMemoryV11();
		await assert.rejects(
			node.supplyData.call(makeCtx({ params: { mode: 'sql', query: 'UPDATE t SET x = 1' } }), 0),
			/Only SELECT queries are allowed/,
		);
		mock = installFakeClient(() => ({ rows: [{ role: 'user', content: 'x' }] }));
		const out = await node.supplyData.call(
			makeCtx({ params: { mode: 'sql', query: 'WITH x AS (SELECT 1) SELECT * FROM x' } }),
			0,
		);
		assert.equal((await out.response.loadMemoryVariables({})).chat_history.length, 1);
	});
});

describe('V1 supplyData (frozen behavior, mocked pg)', () => {
	let mock;
	afterEach(() => mock?.restore());

	it('maps rows, wraps SQL failures, closes the client', async () => {
		mock = installFakeClient(() => ({
			rows: [
				{ role: 'user', content: 'hello' },
				{ role: 'assistant', content: 'hi!' },
			],
		}));
		const node = new SqlChatMemoryV1();
		const ctx = makeCtx({ params: { query: 'SELECT role, content FROM t' } });
		const out = await node.supplyData.call(ctx, 0);
		assert.ok(mock.seen.ended, 'client closed');
		assert.equal((await out.response.loadMemoryVariables({})).chat_history.length, 2);

		await assert.rejects(node.supplyData.call(makeCtx({ params: { query: '   ' } }), 0), /SQL Query is empty/);
	});

	it('closes the client even when SQL fails', async () => {
		let ended = false;
		const pg = require('pg');
		const OriginalClient = pg.Client;
		pg.Client = class {
			async connect() {}
			async query() {
				throw new Error('relation "nope" does not exist');
			}
			async end() {
				ended = true;
			}
		};
		try {
			await assert.rejects(
				new SqlChatMemoryV1().supplyData.call(makeCtx({ params: { query: 'SELECT 1' } }), 0),
				/SQL query failed.*relation "nope" does not exist/,
			);
			assert.ok(ended);
		} finally {
			pg.Client = OriginalClient;
		}
	});
});

describe('read-only memory', () => {
	it('never accumulates writes', async () => {
		const { SqlChatReadOnlyMemory } = require('../dist/nodes/SqlChatMemory/memory.js');
		const { HumanMessage } = require('@langchain/core/messages');
		const mem = new SqlChatReadOnlyMemory([new HumanMessage('hi')]);
		await mem.saveContext({ input: 'a' }, { output: 'b' });
		await mem.chatHistory.addMessages([new HumanMessage('evil')]);
		await mem.clear();
		assert.equal((await mem.loadMemoryVariables({})).chat_history.length, 1);
	});
});
