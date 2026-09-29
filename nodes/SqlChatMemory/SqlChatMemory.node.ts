import {
	AIMessage,
	HumanMessage,
	SystemMessage,
	type BaseMessage,
} from '@langchain/core/messages';
import {
	BaseMemory,
	type InputValues,
	type MemoryVariables,
	type OutputValues,
} from '@langchain/core/memory';
import type {
	INode,
	INodeType,
	INodeTypeDescription,
	ISupplyDataFunctions,
	SupplyData,
} from 'n8n-workflow';
import { NodeConnectionTypes, NodeOperationError } from 'n8n-workflow';
import { Client, type ClientConfig } from 'pg';

/** Shape of the n8n `postgres` credential (subset we rely on). */
interface PostgresCredentials {
	host: string;
	port: number;
	database: string;
	user: string;
	password: string;
	ssl?: 'disable' | 'allow' | 'require' | 'verify' | 'verify-full';
	allowUnauthorizedCerts?: boolean;
	sshTunnel?: boolean;
}

/** A single SQL result row. Only `role` and `content` are required. */
export interface SqlChatRow {
	role: unknown;
	content: unknown;
	[key: string]: unknown;
}

const SUPPORTED_ROLES = ['user', 'assistant', 'system'] as const;

/**
 * Convert SQL rows to LangChain chat messages.
 *
 * - Preserves the exact input order (no sorting, merging or summarizing).
 * - role=user -> HumanMessage, role=assistant -> AIMessage, role=system -> SystemMessage.
 * - Throws a clear node error when `role`/`content` is missing or `role` is unsupported.
 */
export function rowsToMessages(rows: SqlChatRow[], node: INode, itemIndex?: number): BaseMessage[] {
	if (!Array.isArray(rows)) {
		throw new NodeOperationError(node, 'SQL query did not return an array of rows', {
			itemIndex,
			description: 'The SQL query must return rows containing "role" and "content" columns.',
		});
	}

	return rows.map((row, index) => {
		if (row === null || row === undefined || typeof row !== 'object') {
			throw new NodeOperationError(node, `Row ${index} is not an object`, {
				itemIndex,
				description: 'Each SQL result row must be an object with "role" and "content" fields.',
			});
		}

		const { role, content } = row;

		if (role === undefined || role === null || (typeof role === 'string' && role.trim() === '')) {
			throw new NodeOperationError(node, `Row ${index} is missing required field "role"`, {
				itemIndex,
				description:
					'The SQL query must return a "role" column with one of: user, assistant, system. ' +
					`Example: SELECT role, content FROM messages ORDER BY created_at ASC. Got row: ${JSON.stringify(row)}`,
			});
		}

		if (content === undefined || content === null) {
			throw new NodeOperationError(node, `Row ${index} is missing required field "content"`, {
				itemIndex,
				description:
					'The SQL query must return a "content" column with the message text. ' +
					`Example: SELECT role, content FROM messages ORDER BY created_at ASC. Got row: ${JSON.stringify(row)}`,
			});
		}

		const normalizedRole = String(role).trim().toLowerCase();
		const text = toText(content);

		switch (normalizedRole) {
			case 'user':
				return new HumanMessage(text);
			case 'assistant':
				return new AIMessage(text);
			case 'system':
				return new SystemMessage(text);
			default:
				throw new NodeOperationError(
					node,
					`Row ${index} has unsupported role "${String(role)}"`,
					{
						itemIndex,
						description: `Supported roles are: ${SUPPORTED_ROLES.join(', ')}. Got row: ${JSON.stringify(row)}`,
					},
				);
		}
	});
}

function toText(content: unknown): string {
	if (typeof content === 'string') return content;
	if (typeof content === 'number' || typeof content === 'boolean' || typeof content === 'bigint') {
		return String(content);
	}
	try {
		const serialized = JSON.stringify(content);
		return serialized === undefined ? String(content) : serialized;
	} catch {
		return String(content);
	}
}

/**
 * Read-only chat history facade.
 *
 * Exposes the LangChain chat-history surface (`getMessages` / `addMessage` /
 * `addMessages` / `clear`) so the AI Agent can consume history, while every
 * write operation is intentionally a no-op. This node never persists anything.
 */
export class SqlReadOnlyChatHistory {
	constructor(private readonly messages: BaseMessage[]) {}

	async getMessages(): Promise<BaseMessage[]> {
		return [...this.messages];
	}

	async addMessage(_message: BaseMessage): Promise<void> {
		return;
	}

	async addMessages(_messages: BaseMessage[]): Promise<void> {
		return;
	}

	async addUserMessage(_message: string | BaseMessage): Promise<void> {
		return;
	}

	async addAIMessage(_message: string | BaseMessage): Promise<void> {
		return;
	}

	async clear(): Promise<void> {
		return;
	}
}

/**
 * Strictly read-only LangChain memory.
 *
 * - `loadMemoryVariables` returns the SQL-loaded messages under `chat_history`.
 * - `saveContext` / `clear` / history writes are no-ops, so the AI Agent can
 *   never persist conversation turns through this node. Persistence stays
 *   application-controlled (e.g. a downstream database INSERT).
 */
export class SqlChatReadOnlyMemory extends BaseMemory {
	readonly chatHistory: SqlReadOnlyChatHistory;

	private readonly messages: BaseMessage[];

	constructor(messages: BaseMessage[]) {
		super();
		this.messages = [...messages];
		this.chatHistory = new SqlReadOnlyChatHistory(this.messages);
	}

	get memoryKeys(): string[] {
		return ['chat_history'];
	}

	async loadMemoryVariables(_values: InputValues): Promise<MemoryVariables> {
		return { chat_history: [...this.messages] };
	}

	async saveContext(_inputValues: InputValues, _outputValues: OutputValues): Promise<void> {
		return;
	}

	async clear(): Promise<void> {
		return;
	}
}

function createPgClient(credentials: PostgresCredentials): Client {
	const config: ClientConfig = {
		host: credentials.host || 'localhost',
		port: credentials.port ?? 5432,
		database: credentials.database,
		user: credentials.user,
		password: credentials.password,
	};

	if (credentials.allowUnauthorizedCerts === true) {
		config.ssl = { rejectUnauthorized: false };
	} else if (!credentials.ssl || credentials.ssl === 'disable') {
		config.ssl = false;
	} else {
		config.ssl = true;
	}

	return new Client(config);
}

export class SqlChatMemory implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'SQL Chat Memory',
		name: 'sqlChatMemory',
		icon: 'file:sqlChatMemory.svg',
		group: ['transform'],
		version: 1,
		description:
			'Read-only AI chat memory that loads history from PostgreSQL via a custom SQL query',
		defaults: {
			name: 'SQL Chat Memory',
		},
		credentials: [
			{
				name: 'postgres',
				required: true,
			},
		],
		codex: {
			categories: ['AI'],
			subcategories: {
				AI: ['Memory'],
			},
		},
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
					'SELECT query that returns conversation history. It must return a "role" column (user, assistant or system) and a "content" column. Row order is preserved exactly as returned. Supports n8n expressions.',
				typeOptions: {
					editor: 'sqlEditor',
					sqlDialect: 'PostgreSQL',
					rows: 8,
				},
			},
			{
				displayName:
					'This node is read-only. It runs the SQL during AI Agent execution, converts each row to a LangChain message (user → Human, assistant → AI, system → System) in the exact SQL row order, and never writes to the database. Persist new turns with your own INSERT downstream.',
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

		const client = createPgClient(credentials);
		let rows: unknown;
		try {
			await client.connect();
			const result = await client.query(query);
			rows = result.rows;
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			throw new NodeOperationError(node, `SQL query failed: ${message}`, { itemIndex });
		} finally {
			try {
				await client.end();
			} catch {
				// Ignore close errors; the query outcome takes precedence.
			}
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
