'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { SqlChatMemory } = require('../dist/nodes/SqlChatMemory/SqlChatMemory.node.js');
const { SqlChatMemoryV1 } = require('../dist/nodes/SqlChatMemory/SqlChatMemoryV1.node.js');
const { SqlChatMemoryV11 } = require('../dist/nodes/SqlChatMemory/SqlChatMemoryV11.node.js');

function collectDynamicRefs(properties, refs = { loadOptions: new Set(), search: new Set() }) {
	for (const property of properties) {
		const method = property.typeOptions?.loadOptionsMethod;
		if (method) refs.loadOptions.add(method);
		for (const mode of property.modes ?? []) {
			const search = mode.typeOptions?.searchListMethod;
			if (search) refs.search.add(search);
		}
		for (const option of property.options ?? []) {
			if (option.values) collectDynamicRefs(option.values, refs);
		}
	}
	return refs;
}

describe('versioned wrapper', () => {
	it('exposes v1 and v1.1 with the same node name', () => {
		const wrapper = new SqlChatMemory();
		assert.equal(wrapper.getNodeType(1).description.version, 1);
		assert.equal(wrapper.getNodeType(1.1).description.version, 1.1);
		assert.equal(wrapper.getNodeType(1).description.name, 'sqlChatMemory');
		assert.equal(wrapper.getNodeType(1.1).description.name, 'sqlChatMemory');
		assert.equal(wrapper.getLatestVersion(), 1.1);
	});
});

describe('V1 (frozen as published in 0.1.0)', () => {
	const description = new SqlChatMemoryV1().description;

	it('is a pure AI sub-node with the SQL field only', () => {
		assert.deepEqual(description.inputs, []);
		assert.deepEqual(description.outputs, ['ai_memory']);
		assert.deepEqual(description.outputNames, ['Memory']);
		assert.ok(description.credentials.some((c) => c.name === 'postgres' && c.required));
		const names = description.properties.map((p) => p.name);
		assert.deepEqual(names, ['connectionHintNotice', 'query', 'readOnlyNotice']);
		const query = description.properties.find((p) => p.name === 'query');
		assert.equal(query.type, 'string');
		assert.equal(query.required, true);
		assert.ok(!query.noDataExpression, 'query keeps expression support');
	});

	it('has supplyData but no execute/methods/mode', () => {
		const node = new SqlChatMemoryV1();
		assert.equal(typeof node.supplyData, 'function');
		assert.equal(node.execute, undefined);
		assert.equal(node.methods, undefined);
	});
});

describe('V11', () => {
	const node = new SqlChatMemoryV11();
	const description = node.description;

	it('is a pure AI sub-node: no Main I/O, both entry points limited to supplyData', () => {
		assert.deepEqual(description.inputs, []);
		assert.deepEqual(description.outputs, ['ai_memory']);
		assert.deepEqual(description.outputNames, ['Memory']);
		assert.equal(typeof node.supplyData, 'function');
		assert.equal(node.execute, undefined);
	});

	it('defaults new nodes to Table Mapping mode', () => {
		const mode = description.properties.find((p) => p.name === 'mode');
		assert.ok(mode);
		assert.equal(mode.default, 'table');
	});

	it('shows an expected-format guidance box on the SQL page only (no prompts, no buttons)', () => {
		assert.equal(
			description.properties.find((p) => p.name === 'mappingPromptNotice'),
			undefined,
		);
		const formatNotice = description.properties.find((p) => p.name === 'sqlFormatNotice');
		assert.equal(formatNotice.type, 'notice');
		assert.match(formatNotice.displayName, /one JSON object per row/);
		assert.match(formatNotice.displayName, /"role"/);
		assert.match(formatNotice.displayName, /"content"/);
		assert.match(formatNotice.displayName, /oldest first/);
		assert.deepEqual(formatNotice.displayOptions.show, { mode: ['sql'] });
		assert.ok(!description.properties.some((p) => p.type === 'button'), 'no button properties');
	});

	it('every referenced dynamic method exists and no actionHandler remains', () => {
		const refs = collectDynamicRefs(description.properties);
		for (const name of refs.loadOptions) {
			assert.equal(typeof node.methods.loadOptions[name], 'function', `loadOptions.${name}`);
		}
		for (const name of refs.search) {
			assert.equal(typeof node.methods.listSearch[name], 'function', `listSearch.${name}`);
		}
		assert.equal(node.methods.actionHandler, undefined);
		assert.ok(refs.loadOptions.size > 0 && refs.search.size > 0);
	});
});
