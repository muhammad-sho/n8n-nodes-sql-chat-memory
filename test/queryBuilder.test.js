'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const {
	buildHistoryQuery,
	buildWhere,
	resolveContentColumn,
	resolveOrderColumn,
	resolveRoleColumn,
} = require('../dist/nodes/SqlChatMemory/queryBuilder.js');
const { quoteIdent } = require('../dist/nodes/SqlChatMemory/db.js');

const COLUMNS = [
	{ column_name: 'id', data_type: 'bigint', udt_name: 'int8', is_nullable: 'NO' },
	{ column_name: 'chat_id', data_type: 'uuid', udt_name: 'uuid', is_nullable: 'NO' },
	{ column_name: 'direction', data_type: 'text', udt_name: 'text', is_nullable: 'NO' },
	{ column_name: 'message', data_type: 'character varying', udt_name: 'varchar', is_nullable: 'YES' },
	{ column_name: 'quoted_message_id', data_type: 'bigint', udt_name: 'int8', is_nullable: 'YES' },
	{ column_name: 'created_at', data_type: 'timestamp with time zone', udt_name: 'timestamptz', is_nullable: 'NO' },
];

describe('quoteIdent', () => {
	it('quotes any non-empty name as a single identifier (user tables are fully custom)', () => {
		assert.equal(quoteIdent('message'), '"message"');
		assert.equal(quoteIdent('My Messages'), '"My Messages"');
		assert.equal(quoteIdent('9lives'), '"9lives"');
		assert.equal(quoteIdent('a;b'), '"a;b"');
		assert.equal(quoteIdent('a.b.c'), '"a.b.c"');
		assert.equal(quoteIdent('say "hi"'), '"say ""hi"""');
	});

	it('rejects only empty identifiers', () => {
		assert.throws(() => quoteIdent(''), /empty/i);
		assert.throws(() => quoteIdent('   '), /empty/i);
	});
});

describe('resolveOrderColumn', () => {
	it('honors an explicit selection (plus key tiebreak)', () => {
		assert.deepEqual(resolveOrderColumn(COLUMNS, ['id'], 'chat_id'), { primary: 'chat_id', secondary: 'id' });
	});

	it('auto-prefers the first timestamp column', () => {
		assert.deepEqual(resolveOrderColumn(COLUMNS, ['id']), { primary: 'created_at', secondary: 'id' });
	});

	it('falls back to integer keys then integers', () => {
		const noTs = COLUMNS.filter((c) => c.column_name !== 'created_at');
		assert.deepEqual(resolveOrderColumn(noTs, ['id']), { primary: 'id' });
		assert.deepEqual(resolveOrderColumn(noTs, []), { primary: 'id' });
	});

	it('errors when nothing orderable exists and on unknown columns', () => {
		assert.throws(
			() => resolveOrderColumn([{ column_name: 't', data_type: 'text', udt_name: 'text', is_nullable: 'YES' }], []),
			/Could not auto-detect an ordering column/,
		);
		assert.throws(() => resolveOrderColumn(COLUMNS, [], 'nope'), /does not exist/);
	});
});

describe('resolveRoleColumn', () => {
	it('requires an explicit selection validated against the catalog', () => {
		assert.equal(resolveRoleColumn(COLUMNS, 'direction'), 'direction');
		assert.throws(() => resolveRoleColumn(COLUMNS, ''), /does not exist/);
		assert.throws(() => resolveRoleColumn(COLUMNS, 'nope'), /does not exist/);
	});
});

describe('resolveContentColumn', () => {
	it('prefers message-like names, else the first text column', () => {
		assert.equal(resolveContentColumn(COLUMNS), 'message');
		assert.throws(
			() => resolveContentColumn([{ column_name: 'n', data_type: 'integer', udt_name: 'int4', is_nullable: 'YES' }]),
			/Could not auto-detect a content column/,
		);
	});
});

describe('buildWhere', () => {
	it('maps native operators and binds values positionally', () => {
		const { clause, values } = buildWhere(
			[
				{ column: 'chat_id', condition: 'equal', value: 'abc' },
				{ column: 'id', condition: '>', value: 5 },
			],
			'AND',
		);
		assert.equal(clause, '"chat_id" = $1 AND "id" > $2');
		assert.deepEqual(values, ['abc', 5]);
	});

	it('handles IS NULL without placeholders and OR combination', () => {
		const { clause, values } = buildWhere(
			[
				{ column: 'quoted_message_id', condition: 'IS NULL' },
				{ column: 'message', condition: 'LIKE', value: '%hi%' },
			],
			'OR',
		);
		assert.equal(clause, '"quoted_message_id" IS NULL OR "message" LIKE $1');
		assert.deepEqual(values, ['%hi%']);
	});

	it('rejects empty columns and unknown operators', () => {
		assert.throws(() => buildWhere([{ column: '', condition: 'equal', value: 1 }], 'AND'), /no column/);
		assert.throws(() => buildWhere([{ column: 'id', condition: 'IN', value: 1 }], 'AND'), /unsupported operator/);
	});
});

describe('buildHistoryQuery', () => {
	it('quotes everything, parameterizes values, appends limit', () => {
		const { text, values } = buildHistoryQuery({
			schema: 'public',
			table: 'messages',
			select: ['direction', 'message', 'created_at'],
			where: [{ column: 'chat_id', condition: 'equal', value: 's1' }],
			combine: 'AND',
			orderPrimary: 'created_at',
			orderSecondary: 'id',
			direction: 'DESC',
			limit: 50,
		});
		assert.equal(
			text,
			'SELECT "direction", "message", "created_at" FROM "public"."messages" WHERE "chat_id" = $1 ORDER BY "created_at" DESC, "id" DESC LIMIT 50',
		);
		assert.deepEqual(values, ['s1']);
	});

	it('omits WHERE/ORDER BY when not needed and clamps the limit', () => {
		const { text } = buildHistoryQuery({
			schema: 'public',
			table: 'messages',
			select: ['message'],
			where: [],
			combine: 'AND',
			orderPrimary: null,
			direction: 'ASC',
			limit: 0,
		});
		assert.equal(text, 'SELECT "message" FROM "public"."messages" LIMIT 1');
	});
});
