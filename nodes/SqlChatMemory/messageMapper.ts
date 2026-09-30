import { AIMessage, HumanMessage, SystemMessage, type BaseMessage } from '@langchain/core/messages';
import type { INode } from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';

import type { ChatRole, ContentPart, DbRow, RoleMapping, SqlChatRow } from './types';

export const SUPPORTED_ROLES: readonly ChatRole[] = ['user', 'assistant', 'system'];

/** Values the auto role recognizer understands (case-insensitive). */
const AUTO_ROLE_ALIASES: Record<string, ChatRole> = {
	user: 'user',
	human: 'user',
	assistant: 'assistant',
	ai: 'assistant',
	system: 'system',
};

/**
 * Convert SQL rows to LangChain chat messages (Custom Query mode).
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

export function toText(content: unknown): string {
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

function toMessage(role: ChatRole, text: string): BaseMessage {
	switch (role) {
		case 'user':
			return new HumanMessage(text);
		case 'assistant':
			return new AIMessage(text);
		case 'system':
			return new SystemMessage(text);
	}
}

/** Resolve a raw role value: explicit mappings win, then auto-recognition. */
export function resolveRole(
	rawRole: unknown,
	explicit: RoleMapping[],
	node: INode,
	rowIndex: number,
	itemIndex?: number,
): ChatRole {
	const normalized = String(rawRole ?? '').trim();
	const lowered = normalized.toLowerCase();

	for (const mapping of explicit) {
		if (String(mapping.from ?? '').trim().toLowerCase() === lowered) {
			return mapping.to;
		}
	}

	const auto = AUTO_ROLE_ALIASES[lowered];
	if (auto) return auto;

	throw new NodeOperationError(node, `Row ${rowIndex} has unsupported role "${String(rawRole)}"`, {
		itemIndex,
		description:
			`Supported roles are: ${SUPPORTED_ROLES.join(', ')}. ` +
			`Add a Role Mapping for "${normalized}" (e.g. "${normalized}" → assistant) or fix the Role Column.`,
	});
}

function partText(part: ContentPart, row: DbRow): string {
	let raw: unknown;
	if (part.source === 'lookup') {
		const key = row[part.localColumn ?? ''];
		raw = key === undefined || key === null ? undefined : part.lookupValues?.get(String(key));
	} else {
		raw = part.column ? row[part.column] : undefined;
	}

	if (raw === undefined || raw === null || raw === '') {
		return part.fallback ?? '';
	}
	const prefix = part.prefix ?? '';
	const suffix = part.suffix ?? '';
	return `${prefix}${toText(raw)}${suffix}`;
}

export interface TableMapConfig {
	roleColumn: string;
	explicitRoles: RoleMapping[];
	parts: ContentPart[];
}

/**
 * Convert Table Mapping mode rows to LangChain messages, preserving row order.
 * Content is assembled by concatenating the configured parts in order.
 */
export function mapTableRows(
	rows: DbRow[],
	config: TableMapConfig,
	node: INode,
	itemIndex?: number,
): BaseMessage[] {
	if (!Array.isArray(rows)) {
		throw new NodeOperationError(node, 'Table query did not return an array of rows', {
			itemIndex,
			description: 'Internal error: expected the history query to return rows.',
		});
	}

	return rows.map((row, index) => {
		if (row === null || row === undefined || typeof row !== 'object') {
			throw new NodeOperationError(node, `Row ${index} is not an object`, {
				itemIndex,
				description: 'Internal error: expected each history row to be an object.',
			});
		}

		const rawRole = (row as DbRow)[config.roleColumn];
		if (rawRole === undefined || rawRole === null || String(rawRole).trim() === '') {
			throw new NodeOperationError(
				node,
				`Row ${index} has no value in role column "${config.roleColumn}"`,
				{
					itemIndex,
					description:
						`Every history row needs a role. Check the Role Column setting or add a filter. Got row: ${JSON.stringify(row)}`,
				},
			);
		}

		const role = resolveRole(rawRole, config.explicitRoles, node, index, itemIndex);
		const text = config.parts.map((part) => partText(part, row as DbRow)).join('');
		return toMessage(role, text);
	});
}
