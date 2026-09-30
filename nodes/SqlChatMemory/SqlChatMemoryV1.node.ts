import type {
	INodeType,
	INodeTypeDescription,
	ISupplyDataFunctions,
	SupplyData,
} from 'n8n-workflow';
import { NodeConnectionTypes, NodeOperationError } from 'n8n-workflow';

import { withPgClient, type Queryable } from './db';
import { sharedBase, postgresCredentials } from './descriptions';
import { SqlChatReadOnlyMemory } from './memory';
import { rowsToMessages } from './messageMapper';
import type { PostgresCredentials, SqlChatRow } from './types';

/**
 * SQL Chat Memory v1 — frozen exactly as published in 0.1.0.
 * SQL-only, supplyData-only, permissive SQL. Do not change.
 */
export class SqlChatMemoryV1 implements INodeType {
	description: INodeTypeDescription = {
		...sharedBase,
		version: 1,
		defaults: {
			name: 'SQL Chat Memory',
		},
		credentials: [...postgresCredentials],
		inputs: [],
		outputs: [NodeConnectionTypes.AiMemory],
		outputNames: ['Memory'],
		properties: [
			{
				displayName: "Connect the Memory output to an AI Agent's Memory input.",
				name: 'connectionHintNotice',
				type: 'notice',
				default: '',
			},
			{
				displayName: 'SQL Query',
				name: 'query',
				type: 'string',
				required: true,
				default: '',
				placeholder:
					"SELECT role, content FROM chat_messages WHERE session_id = '{{ $json.sessionId }}' ORDER BY created_at ASC LIMIT 50",
				description:
					'Return two columns: role (user, assistant or system) and content (the message text), oldest first. You can use expressions.',
				typeOptions: {
					editor: 'sqlEditor',
					sqlDialect: 'PostgreSQL',
					rows: 8,
				},
			},
			{
				displayName:
					'This node only reads — it never saves or changes anything. Save new messages with your own steps after the AI agent replies.',
				name: 'readOnlyNotice',
				type: 'notice',
				default: '',
			},
		],
	};

	async supplyData(this: ISupplyDataFunctions, itemIndex: number): Promise<SupplyData> {
		const node = this.getNode();

		const query = this.getNodeParameter('query', itemIndex) as string;
		if (!query || (typeof query === 'string' && query.trim() === '')) {
			throw new NodeOperationError(node, 'SQL Query is empty', {
				itemIndex,
				description:
					'Enter a SELECT query that returns "role" and "content" columns, e.g. SELECT role, content FROM chat_messages ORDER BY created_at ASC.',
			});
		}

		const credentials = (await this.getCredentials('postgres')) as unknown as PostgresCredentials;

		if (credentials?.sshTunnel) {
			throw new NodeOperationError(node, 'SSH Tunnel is not supported by SQL Chat Memory', {
				itemIndex,
				description: 'Disable SSH Tunnel in the Postgres credential for this node.',
			});
		}

		// Single client per call, always closed (same lifecycle as the original v1).
		let rows: unknown;
		try {
			rows = await withPgClient(credentials, async (db: Queryable) => {
				const result = await db.query(query);
				return result.rows;
			});
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			throw new NodeOperationError(node, `SQL query failed: ${message}`, { itemIndex });
		}

		if (!Array.isArray(rows)) {
			throw new NodeOperationError(node, 'SQL query did not return an array of rows', {
				itemIndex,
				description: 'The SQL query must return rows containing "role" and "content" columns.',
			});
		}

		const messages = rowsToMessages(rows as SqlChatRow[], node, itemIndex);
		const memory = new SqlChatReadOnlyMemory(messages);

		return { response: memory };
	}
}
