import type { BaseMessage } from '@langchain/core/messages';
import type {
	IExecuteFunctions,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
	ISupplyDataFunctions,
	SupplyData,
} from 'n8n-workflow';
import { NodeConnectionTypes } from 'n8n-workflow';

import { sharedBase, postgresCredentials, v11Properties } from './descriptions';
import { fetchMappedMessages, type FetchContext } from './fetch';
import {
	buildMappingPrompt,
	buildSqlPrompt,
	getColumns,
	getLookupColumns,
	getLookupTables,
	getRoleValues,
	getSchemas,
	getTables,
} from './loadOptions';
import { SqlChatReadOnlyMemory } from './memory';

/** Map a LangChain message back to the simple role string for test output. */
function messageRole(message: BaseMessage): string {
	const type = message._getType();
	if (type === 'human') return 'user';
	if (type === 'ai') return 'assistant';
	return type;
}

function messageContent(message: BaseMessage): string {
	if (typeof message.content === 'string') return message.content;
	try {
		return JSON.stringify(message.content);
	} catch {
		return String(message.content);
	}
}

/**
 * SQL Chat Memory v1.1 — Table Mapping UI + Custom Query, in-node testing via
 * the Preview output, and copy-prompt buttons. Still strictly read-only.
 */
export class SqlChatMemoryV11 implements INodeType {
	description: INodeTypeDescription = {
		...sharedBase,
		version: 1.1,
		defaults: {
			name: 'SQL Chat Memory',
		},
		credentials: [...postgresCredentials],
		inputs: [NodeConnectionTypes.Main],
		outputs: [NodeConnectionTypes.Main, NodeConnectionTypes.AiMemory],
		outputNames: ['Preview', 'Memory'],
		properties: v11Properties,
	};

	methods = {
		loadOptions: {
			getColumns,
			getRoleValues,
			getLookupTables,
			getLookupColumns,
		},
		listSearch: {
			getSchemas,
			getTables,
		},
		actionHandler: {
			buildMappingPrompt,
			buildSqlPrompt,
		},
	};

	/**
	 * Test/preview path: runs the same fetch as the Agent memory path and
	 * returns the mapped messages as simple { role, content } items on the
	 * Preview output. Connect any upstream node and Test this step.
	 */
	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const runCount = Math.max(items.length, 1);
		const output: INodeExecutionData[] = [];

		for (let index = 0; index < runCount; index++) {
			const itemIndex = items.length === 0 ? 0 : index;
			const { messages } = await fetchMappedMessages(this as unknown as FetchContext, itemIndex);
			for (const message of messages) {
				output.push({
					json: {
						role: messageRole(message),
						content: messageContent(message),
					},
					pairedItem: items.length === 0 ? undefined : { item: index },
				});
			}
		}

		return [output];
	}

	/** Agent memory path: SQL → rows → LangChain messages → read-only memory. */
	async supplyData(this: ISupplyDataFunctions, itemIndex: number): Promise<SupplyData> {
		const { messages } = await fetchMappedMessages(this as unknown as FetchContext, itemIndex);
		return { response: new SqlChatReadOnlyMemory(messages) };
	}
}
