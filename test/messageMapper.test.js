'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const {
	rowsToMessages,
	mapTableRows,
	resolveRole,
	toText,
} = require('../dist/nodes/SqlChatMemory/messageMapper.js');
const {
	HumanMessage,
	AIMessage,
	SystemMessage,
} = require('@langchain/core/messages');

const fakeNode = { name: 'SQL Chat Memory', type: 'sqlChatMemory', typeVersion: 1, position: [0, 0], parameters: {} };

describe('rowsToMessages (SQL mode, frozen v1 behavior)', () => {
	it('maps user/assistant/system in exact order', () => {
		const msgs = rowsToMessages(
			[
				{ role: 'system', content: 'You are helpful.' },
				{ role: 'user', content: 'Hello' },
				{ role: 'assistant', content: 'Hi' },
			],
			fakeNode,
			0,
		);
		assert.equal(msgs.length, 3);
		assert.ok(msgs[0] instanceof SystemMessage);
		assert.ok(msgs[1] instanceof HumanMessage);
		assert.ok(msgs[2] instanceof AIMessage);
		assert.equal(msgs[1].content, 'Hello');
	});

	it('matches roles case-insensitively', () => {
		const msgs = rowsToMessages([{ role: '  USER ', content: 'a' }], fakeNode, 0);
		assert.ok(msgs[0] instanceof HumanMessage);
	});

	it('returns [] for empty rows', () => {
		assert.deepEqual(rowsToMessages([], fakeNode, 0), []);
	});

	it('errors clearly on missing role / content / bad role / non-array', () => {
		assert.throws(() => rowsToMessages([{ content: 'x' }], fakeNode, 0), /missing required field "role"/);
		assert.throws(() => rowsToMessages([{ role: 'user' }], fakeNode, 0), /missing required field "content"/);
		assert.throws(() => rowsToMessages([{ role: 'tool', content: 'x' }], fakeNode, 0), /unsupported role/);
		assert.throws(() => rowsToMessages(null, fakeNode, 0), /did not return an array/);
	});
});

describe('toText', () => {
	it('passes strings through and stringifies the rest', () => {
		assert.equal(toText('a'), 'a');
		assert.equal(toText(42), '42');
		assert.equal(toText(true), 'true');
		assert.equal(toText({ a: 1 }), '{"a":1}');
	});
});

describe('resolveRole', () => {
	it('prefers explicit mappings (case-insensitive) over auto', () => {
		const explicit = [{ from: 'sent', to: 'assistant' }];
		assert.equal(resolveRole('SENT', explicit, fakeNode, 0), 'assistant');
		assert.equal(resolveRole('user', explicit, fakeNode, 0), 'user');
		assert.equal(resolveRole('ai', [], fakeNode, 0), 'assistant');
		assert.equal(resolveRole('human', [], fakeNode, 0), 'user');
	});

	it('errors with guidance on unknown values', () => {
		assert.throws(() => resolveRole('bot', [], fakeNode, 3), /Row 3 has unsupported role "bot"/);
	});
});

describe('mapTableRows (Table Mapping mode)', () => {
	const config = {
		roleColumn: 'direction',
		explicitRoles: [
			{ from: 'sent', to: 'assistant' },
			{ from: 'received', to: 'user' },
		],
		parts: [{ source: 'column', column: 'message', prefix: '', suffix: '', fallback: '' }],
	};

	it('maps rows in order using explicit + auto roles', () => {
		const msgs = mapTableRows(
			[
				{ direction: 'received', message: 'hi' },
				{ direction: 'sent', message: 'hello' },
			],
			config,
			fakeNode,
			0,
		);
		assert.equal(msgs.length, 2);
		assert.ok(msgs[0] instanceof HumanMessage);
		assert.ok(msgs[1] instanceof AIMessage);
	});

	it('assembles prefix/suffix/fallback and skips empty parts', () => {
		const msgs = mapTableRows(
			[{ direction: 'sent', message: 'see this', quoted: 'orig' }],
			{
				roleColumn: 'direction',
				explicitRoles: [{ from: 'sent', to: 'assistant' }],
				parts: [
					{ source: 'column', column: 'message', prefix: '', suffix: '', fallback: '' },
					{ source: 'column', column: 'quoted', prefix: ' (respondendo a "', suffix: '")', fallback: '' },
				],
			},
			fakeNode,
			0,
		);
		assert.equal(msgs[0].content, 'see this (respondendo a "orig")');

		const skipped = mapTableRows(
			[{ direction: 'sent', message: 'see this', quoted: null }],
			{
				roleColumn: 'direction',
				explicitRoles: [{ from: 'sent', to: 'assistant' }],
				parts: [
					{ source: 'column', column: 'message', prefix: '', suffix: '', fallback: '' },
					{ source: 'column', column: 'quoted', prefix: ' (q: ', suffix: ')', fallback: ' (no quote)' },
				],
			},
			fakeNode,
			0,
		);
		assert.equal(skipped[0].content, 'see this (no quote)');
	});

	it('resolves lookup parts from the pre-fetched map', () => {
		const msgs = mapTableRows(
			[{ direction: 'sent', message: 'reply', quoted_message_id: 7 }],
			{
				roleColumn: 'direction',
				explicitRoles: [{ from: 'sent', to: 'assistant' }],
				parts: [
					{ source: 'column', column: 'message', prefix: '', suffix: '', fallback: '' },
					{
						source: 'lookup',
						localColumn: 'quoted_message_id',
						lookupValues: new Map([['7', 'original text']]),
						prefix: ' (respondendo a "',
						suffix: '")',
						fallback: '',
					},
				],
			},
			fakeNode,
			0,
		);
		assert.equal(msgs[0].content, 'reply (respondendo a "original text")');
	});

	it('errors clearly on missing role values and unmapped roles', () => {
		assert.throws(
			() => mapTableRows([{ direction: null, message: 'x' }], config, fakeNode, 0),
			/no value in role column "direction"/,
		);
		assert.throws(
			() => mapTableRows([{ direction: 'mystery', message: 'x' }], config, fakeNode, 0),
			/Row 0 has unsupported role "mystery"/,
		);
	});
});
