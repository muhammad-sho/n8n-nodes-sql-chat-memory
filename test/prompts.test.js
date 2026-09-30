'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { buildMappingPrompt, buildSqlPrompt } = require('../dist/nodes/SqlChatMemory/prompts.js');

const COLUMNS = [
	{ column_name: 'id', data_type: 'bigint', udt_name: 'int8', is_nullable: 'NO' },
	{ column_name: 'direction', data_type: 'text', udt_name: 'text', is_nullable: 'NO' },
	{ column_name: 'message', data_type: 'character varying', udt_name: 'varchar', is_nullable: 'YES' },
];

const BASE = { schema: 'public', table: 'messages', columns: COLUMNS, currentConfig: [] };

describe('buildMappingPrompt', () => {
	it('contains purpose, table, columns with types, and mapping instructions', () => {
		const prompt = buildMappingPrompt({ ...BASE, roleValues: ['sent', 'received'] });
		assert.match(prompt, /READ-ONLY/i);
		assert.match(prompt, /"public"\."messages"/);
		assert.match(prompt, /direction \(TEXT/);
		assert.match(prompt, /message \(CHARACTER VARYING/);
		assert.match(prompt, /sent, received/);
		assert.match(prompt, /Role Mappings/);
		assert.match(prompt, /Content Template/);
		assert.match(prompt, /Content Lookup/);
		assert.match(prompt, /Ordering Column/);
		assert.match(prompt, /Select Rows filter/);
	});

	it('echoes the current partial configuration', () => {
		const prompt = buildMappingPrompt({
			...BASE,
			currentConfig: ['Role Column: direction', 'Limit: 20'],
		});
		assert.match(prompt, /Role Column: direction/);
		assert.match(prompt, /Limit: 20/);
		assert.match(prompt, /complete it, do not restart from scratch/);
	});
});

describe('buildSqlPrompt', () => {
	it('contains the role+content contract and read-only rules', () => {
		const prompt = buildSqlPrompt({ ...BASE, currentSql: '' });
		assert.match(prompt, /READ-ONLY/i);
		assert.match(prompt, /exactly two columns named `role` and `content`/);
		assert.match(prompt, /oldest first/);
		assert.match(prompt, /\{\{ \$json\.sessionId \}\}/);
		assert.match(prompt, /SELECT or WITH/);
	});

	it('echoes current SQL when present', () => {
		const prompt = buildSqlPrompt({ ...BASE, currentSql: 'SELECT 1' });
		assert.match(prompt, /SELECT 1/);
		assert.match(prompt, /fix\/complete it/);
	});
});
