import { AIMessage, HumanMessage, SystemMessage, type BaseMessage } from '@langchain/core/messages';
import type { INode } from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';

import type { ChatRole, ContentLookup, DbRow, RoleMapping, SqlChatRow } from './types';

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

const PLACEHOLDER_PATTERN = /\{\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*\}\}/g;

/**
 * List the placeholder names used in a content template, in order of first
 * appearance, e.g. `{{message}} (replying to "{{quoted}}")` -> ["message", "quoted"].
 * Anything that is not a `{{name}}` placeholder is left untouched.
 */
export function extractTemplateNames(template: string): string[] {
	const names: string[] = [];
	const seen = new Set<string>();
	PLACEHOLDER_PATTERN.lastIndex = 0;
	let match: RegExpExecArray | null;
	while ((match = PLACEHOLDER_PATTERN.exec(template)) !== null) {
		if (!seen.has(match[1])) {
			seen.add(match[1]);
			names.push(match[1]);
		}
	}
	return names;
}

export interface ResolvedLookup {
	values: Map<string, string>;
	fallback: string;
	localColumn: string;
}

/**
 * Render a content template for one row. `{{name}}` resolves to the row's
 * column first, then to a named lookup; unknown names render as an empty
 * string, and missing lookup keys fall back to the lookup's fallback text.
 */
export function renderContentTemplate(
	template: string,
	row: DbRow,
	lookups: Map<string, ResolvedLookup>,
): string {
	PLACEHOLDER_PATTERN.lastIndex = 0;
	return template.replace(PLACEHOLDER_PATTERN, (_whole, name: string) => {
		const columnValue = row[name];
		if (columnValue !== undefined && columnValue !== null && columnValue !== '') {
			return toText(columnValue);
		}
		const lookup = lookups.get(name);
		if (!lookup) return '';
		const key = row[lookup.localColumn];
		if (key !== undefined && key !== null && key !== '') {
			const hit = lookup.values.get(String(key));
			if (hit !== undefined) return hit;
		}
		return lookup.fallback;
	});
}

export interface TableMapConfig {
	roleColumn: string;
	explicitRoles: RoleMapping[];
	template: string;
	lookups: ContentLookup[];
}

/**
 * Convert Table Mapping mode rows to LangChain messages, preserving row order.
 * Content is rendered from the template; each `{{name}}` pulls the row's
 * column or the named lookup (lookups carry their pre-fetched value maps).
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
		const lookups = new Map<string, ResolvedLookup>();
		for (const lookup of config.lookups) {
			lookups.set(lookup.name, {
				values: lookup.lookupValues ?? new Map<string, string>(),
				fallback: lookup.fallback ?? '',
				localColumn: lookup.localColumn,
			});
		}
		const text = renderContentTemplate(config.template, row as DbRow, lookups);
		return toMessage(role, text);
	});
}
