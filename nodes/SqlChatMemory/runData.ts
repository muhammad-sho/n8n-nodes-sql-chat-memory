import { NodeConnectionTypes, type ISupplyDataFunctions } from 'n8n-workflow';
import type { BaseMessage } from '@langchain/core/messages';

import { toText } from './messageMapper';

const TYPE_TO_ROLE: Record<string, string> = {
	human: 'user',
	ai: 'assistant',
	system: 'system',
};

/**
 * Record the messages handed to the AI as this sub-node's run data.
 *
 * This mirrors what n8n core does for built-in memory nodes: the payload is
 * stored on the AiMemory connection (so the editor lists this sub-node with
 * its output after an agent run) and an `ai-messages-retrieved-from-memory`
 * event is emitted for the execution log. The node stays a pure memory
 * sub-node — no Main input/output is added. Recording never throws: debugging
 * must not break the run.
 */
export function recordSuppliedMessages(
	ctx: ISupplyDataFunctions,
	messages: BaseMessage[],
): void {
	try {
		const response = messages.map((message) => {
			const type = typeof message.getType === 'function' ? message.getType() : 'unknown';
			return { role: TYPE_TO_ROLE[type] ?? type, content: toText(message.content) };
		});
		const payload = { action: 'getMessages', response };
		const data = [[{ json: payload }]];
		if (typeof ctx.addInputData === 'function' && typeof ctx.addOutputData === 'function') {
			const { index } = ctx.addInputData(NodeConnectionTypes.AiMemory, data);
			ctx.addOutputData(NodeConnectionTypes.AiMemory, index, data);
		}
		if (typeof ctx.logAiEvent === 'function') {
			ctx.logAiEvent('ai-messages-retrieved-from-memory', JSON.stringify({ response }));
		}
	} catch {
		// Debugging must never break the run.
	}
}
