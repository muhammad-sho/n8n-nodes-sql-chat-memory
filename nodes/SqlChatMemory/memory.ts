import {
	BaseMemory,
	type InputValues,
	type MemoryVariables,
	type OutputValues,
} from '@langchain/core/memory';
import type { BaseMessage } from '@langchain/core/messages';

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
