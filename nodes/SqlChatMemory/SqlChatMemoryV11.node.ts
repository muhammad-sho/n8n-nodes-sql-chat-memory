import type {
	INodeType,
	INodeTypeDescription,
	ISupplyDataFunctions,
	SupplyData,
} from 'n8n-workflow';
import { NodeConnectionTypes } from 'n8n-workflow';

import { sharedBase, postgresCredentials, v11Properties } from './descriptions';
import { fetchMappedMessages, type FetchContext } from './fetch';
import {
	getColumns,
	getRoleValues,
	getSchemas,
	getTables,
} from './loadOptions';
import { SqlChatReadOnlyMemory } from './memory';

/**
 * SQL Chat Memory v1.1 — Table Mapping UI + Custom Query with an
 * expected-format guidance box. A pure AI sub-node: no Main input/output, it receives its data
 * context (e.g. previous nodes' items for expressions) through the AI Agent
 * connection. Still strictly read-only.
 */
export class SqlChatMemoryV11 implements INodeType {
	description: INodeTypeDescription = {
		...sharedBase,
		version: 1.1,
		defaults: {
			name: 'SQL Chat Memory',
		},
		credentials: [...postgresCredentials],
		inputs: [],
		outputs: [NodeConnectionTypes.AiMemory],
		outputNames: ['Memory'],
		properties: v11Properties,
	};

	methods = {
		loadOptions: {
			getColumns,
			getRoleValues,
		},
		listSearch: {
			getSchemas,
			getTables,
		},
	};

	/**
	 * Agent memory path: SQL → rows → LangChain messages → read-only memory.
	 * Expression context (e.g. {{ $json.sessionId }}) comes from the connected
	 * AI Agent's input items, so no Main input is needed on this node.
	 */
	async supplyData(this: ISupplyDataFunctions, itemIndex: number): Promise<SupplyData> {
		const { messages } = await fetchMappedMessages(this as unknown as FetchContext, itemIndex);
		return { response: new SqlChatReadOnlyMemory(messages) };
	}
}
