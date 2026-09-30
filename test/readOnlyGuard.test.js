'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { assertReadOnlySql } = require('../dist/nodes/SqlChatMemory/fetch.js');

const fakeNode = { name: 'SQL Chat Memory', type: 'sqlChatMemory', typeVersion: 1.1, position: [0, 0], parameters: {} };

function allows(sql) {
	assert.doesNotThrow(() => assertReadOnlySql(sql, fakeNode, 0), `should allow: ${sql}`);
}

function blocks(sql, pattern) {
	assert.throws(() => assertReadOnlySql(sql, fakeNode, 0), pattern, `should block: ${sql}`);
}

describe('assertReadOnlySql', () => {
	it('allows plain SELECT and read-only WITH', () => {
		allows('SELECT role, content FROM t');
		allows('select role, content from t');
		allows('WITH x AS (SELECT 1) SELECT * FROM x');
		allows('with x as (select 1) select * from x');
		allows('-- a comment\nSELECT role, content FROM t');
		allows('/* block */ SELECT role, content FROM t');
	});

	it('does not mistake keywords inside literals for writes', () => {
		allows("SELECT role, content FROM t WHERE role <> 'update'");
		allows("SELECT role, content FROM t WHERE content = 'dropped and deleted'");
		allows('SELECT "Update" FROM t');
		allows('SELECT shadow, window FROM t');
	});

	it('blocks leading writes', () => {
		blocks('UPDATE t SET x = 1', /Only SELECT queries are allowed/);
		blocks('INSERT INTO t VALUES (1)', /Only SELECT queries are allowed/);
		blocks('DELETE FROM t', /Only SELECT queries are allowed/);
		blocks('DROP TABLE t', /Only SELECT queries are allowed/);
		blocks('   TRUNCATE t', /Only SELECT queries are allowed/);
	});

	it('blocks writes hidden inside WITH clauses', () => {
		blocks('WITH x AS (INSERT INTO t VALUES (1) RETURNING *) SELECT * FROM x', /Data-modifying/);
		blocks('WITH x AS (UPDATE t SET a = 1 RETURNING *) SELECT * FROM x', /Data-modifying/);
		blocks('WITH x AS (DELETE FROM t RETURNING *) SELECT * FROM x', /Data-modifying/);
		blocks('WITH x AS (SELECT 1) SELECT * FROM x; DROP TABLE t', /Data-modifying/);
		blocks('WITH x AS (SELECT 1) SELECT * FROM x; CALL run()', /Data-modifying/);
		blocks('WITH x AS (SELECT 1) SELECT * FROM x; DO $$ BEGIN RAISE NOTICE \'hi\'; END $$', /Data-modifying/);
	});
});
