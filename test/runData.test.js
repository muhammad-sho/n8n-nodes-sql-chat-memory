'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { recordSuppliedMessages } = require('../dist/nodes/SqlChatMemory/runData.js');

function fakeMessage(type, content) {
	return { getType: () => type, content };
}

function makeCtx() {
	const calls = { input: [], output: [], events: [] };
	const ctx = {
		addInputData: (connectionType, data) => {
			calls.input.push({ connectionType, data });
			return { index: calls.input.length - 1 };
		},
		addOutputData: (connectionType, index, data) => {
			calls.output.push({ connectionType, index, data });
		},
		logAiEvent: (eventName, msg) => {
			calls.events.push({ eventName, msg });
		},
	};
	return { ctx, calls };
}

describe('recordSuppliedMessages', () => {
	it('records role+content rows as AiMemory run data plus the memory event', () => {
		const { ctx, calls } = makeCtx();
		recordSuppliedMessages(ctx, [
			fakeMessage('human', 'hello'),
			fakeMessage('ai', 'hi there'),
			fakeMessage('system', 'be brief'),
		]);

		assert.equal(calls.input.length, 1);
		assert.equal(calls.input[0].connectionType, 'ai_memory');
		const payload = calls.input[0].data[0][0].json;
		assert.deepEqual(payload, {
			action: 'getMessages',
			response: [
				{ role: 'user', content: 'hello' },
				{ role: 'assistant', content: 'hi there' },
				{ role: 'system', content: 'be brief' },
			],
		});

		assert.equal(calls.output.length, 1);
		assert.equal(calls.output[0].connectionType, 'ai_memory');
		assert.equal(calls.output[0].index, 0);
		assert.deepEqual(calls.output[0].data, calls.input[0].data);

		assert.equal(calls.events.length, 1);
		assert.equal(calls.events[0].eventName, 'ai-messages-retrieved-from-memory');
		assert.match(calls.events[0].msg, /"role":"user"/);
	});

	it('never throws when the runtime lacks the recording functions', () => {
		assert.doesNotThrow(() => recordSuppliedMessages({}, [fakeMessage('human', 'hi')]));
		assert.doesNotThrow(() =>
			recordSuppliedMessages(
				{
					addInputData: () => { throw new Error('nope'); },
					addOutputData: () => { throw new Error('nope'); },
					logAiEvent: () => { throw new Error('nope'); },
				},
				[fakeMessage('ai', 'hi')],
			),
		);
	});
});
