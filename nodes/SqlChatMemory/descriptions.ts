import type {
	INodeProperties,
	INodeTypeBaseDescription,
} from 'n8n-workflow';

/** Shared description bits for the wrapper and both versions. */
export const sharedBase: INodeTypeBaseDescription = {
	displayName: 'SQL Chat Memory',
	name: 'sqlChatMemory',
	icon: 'file:sqlChatMemory.svg',
	group: ['transform'],
	description: 'Read-only AI chat memory that loads history from PostgreSQL via a custom SQL query',
	codex: {
		categories: ['AI'],
		subcategories: {
			AI: ['Memory'],
		},
	},
};

/** Postgres credential, shared by both versions. */
export const postgresCredentials = [
	{
		name: 'postgres',
		required: true,
	},
] as const;

const chooseFromListDescription =
	'Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/" target="_blank">expression</a>';

const columnPicker = (
	loadOptionsMethod: string,
	loadOptionsDependsOn: string[],
	placeholder = 'e.g. ID',
): Pick<INodeProperties, 'type' | 'typeOptions' | 'description' | 'placeholder'> => ({
	type: 'options',
	description: chooseFromListDescription,
	placeholder,
	typeOptions: {
		loadOptionsMethod,
		loadOptionsDependsOn,
	},
});

/** Custom Query field for v1.1 (same `query` param name as v1). */
export const queryPropertyV11: INodeProperties = {
	displayName: 'SQL Query',
	name: 'query',
	type: 'string',
	required: true,
	default: '',
	placeholder:
		"SELECT role, content FROM chat_messages WHERE session_id = '{{ $json.sessionId }}' ORDER BY created_at ASC LIMIT 50",
	description:
		'Write the query so it already returns the final form: a "role" column (user, assistant or system) and a "content" column, oldest rows first. Build content freely in SQL (concatenation, CASE, subqueries, JOINs). Rows are handed to the AI unchanged. Supports n8n expressions. Read-only: SELECT or WITH ... SELECT only.',
	typeOptions: {
		editor: 'sqlEditor',
		sqlDialect: 'PostgreSQL',
		rows: 8,
	},
	displayOptions: {
		show: {
			mode: ['sql'],
		},
	},
};

const MAPPING_PROMPT_NOTICE = `Need help? Paste this to any LLM: Help me configure an n8n "SQL Chat Memory" node (Table Mapping mode: read-only chat memory that loads past turns for an AI Agent as user/assistant/system messages, oldest-first, never writes). My table: [schema.table — fill in]. My columns (name — TYPE, as shown in the dropdowns above): [paste them here]. Tell me exactly what to set for: 1) Session Column + Session ID value (the column holding the conversation/session/user id, and the value or an expression like {{ $json.sessionId }}), 2) Ordering Column (a timestamp or incrementing id column; empty means auto-detect), 3) Role Column + Role Mappings (every column value mapped to user, assistant or system), 4) Limit (how many messages to return). Rules: output is chronological; only the three roles exist; the node never writes.`;

const SQL_PROMPT_NOTICE = `Need help? Paste this to any LLM: Help me write the SQL for an n8n "SQL Chat Memory" node (Custom Query mode: read-only chat memory for an AI Agent; the query runs at Agent time and supports n8n expressions). My table: [schema.table — fill in]. My columns (name — TYPE): [paste them here]. Write ONE query returning exactly \`role\` (only user, assistant or system — map my values with CASE) and \`content\` (the final message text; build freely with concatenation, CASE, subqueries or JOINs), oldest rows first (ORDER BY time/id ASC), scoped with WHERE <session column> = {{ $json.sessionId }}. SELECT or WITH ... SELECT only — never write.`;

/**
 * Full v1.1 property list. Table Mapping mode is a fixed six-field flow
 * (Schema > Table > Session > Ordering > Role > Limit); Custom Query mode
 * is just the SQL field. Ends with a static copy-paste LLM prompt notice
 * per mode (buttons cannot return backend results in n8n, so there are none).
 */
export const v11Properties: INodeProperties[] = [
	{
		displayName: "Connect the Memory output to an AI Agent's Memory input.",
		name: 'connectionHintNotice',
		type: 'notice',
		default: '',
	},
	{
		displayName: 'Mode',
		name: 'mode',
		type: 'options',
		noDataExpression: true,
		default: 'table',
		description: 'How the history is loaded: form-driven table mapping, or your own SQL.',
		options: [
			{
				name: 'Table Mapping',
				value: 'table',
				description: 'Point at a table and map its columns — no SQL needed',
			},
			{
				name: 'Custom Query',
				value: 'sql',
				description: 'Write the SELECT yourself for full control',
			},
		],
	},
	{
		displayName: 'Schema',
		name: 'schema',
		type: 'resourceLocator',
		default: { mode: 'list', value: 'public' },
		required: true,
		placeholder: 'e.g. public',
		description: 'The schema that contains the history table',
		modes: [
			{
				displayName: 'From List',
				name: 'list',
				type: 'list',
				typeOptions: {
					searchListMethod: 'getSchemas',
				},
			},
			{
				displayName: 'By Name',
				name: 'name',
				type: 'string',
			},
		],
		displayOptions: {
			show: {
				mode: ['table'],
			},
		},
	},
	{
		displayName: 'Table',
		name: 'table',
		type: 'resourceLocator',
		default: { mode: 'list', value: '' },
		required: true,
		description: 'The table that holds the conversation history',
		modes: [
			{
				displayName: 'From List',
				name: 'list',
				type: 'list',
				typeOptions: {
					searchListMethod: 'getTables',
				},
			},
			{
				displayName: 'By Name',
				name: 'name',
				type: 'string',
			},
		],
		displayOptions: {
			show: {
				mode: ['table'],
			},
		},
	},
	{
		displayName: 'Session Column',
		name: 'sessionColumn',
		...columnPicker('getColumns', ['schema.value', 'table.value'], 'e.g. session_id'),
		default: '',
		description:
			'The column holding the conversation/session/user id. Leave empty to load all rows (single-conversation tables). Supports n8n expressions.',
		displayOptions: {
			show: {
				mode: ['table'],
			},
		},
	},
	{
		displayName: 'Session ID',
		name: 'sessionValue',
		type: 'string',
		default: '',
		placeholder: "{{ $json.sessionId }}",
		description:
			'Only rows matching this value are loaded (compared with =). Supports n8n expressions. Required when a Session Column is selected.',
		displayOptions: {
			show: {
				mode: ['table'],
			},
		},
	},
	{
		displayName: 'Ordering Column',
		name: 'orderColumn',
		...columnPicker('getColumns', ['schema.value', 'table.value'], 'e.g. created_at'),
		default: '',
		description:
			'A timestamp or incrementing id column — newer messages have later timestamps / higher ids. Leave empty to auto-detect. History is always loaded most-recent-first and handed to the AI oldest-first.',
		displayOptions: {
			show: {
				mode: ['table'],
			},
		},
	},
	{
		displayName: 'Role Column',
		name: 'roleColumn',
		...columnPicker('getColumns', ['schema.value', 'table.value'], 'e.g. direction'),
		default: '',
		required: true,
		description:
			'The column holding the sender/type. Map each of its values below to user, assistant or system.',
		displayOptions: {
			show: {
				mode: ['table'],
			},
		},
	},
	{
		displayName: 'Role Mappings',
		name: 'roleMappings',
		type: 'fixedCollection',
		typeOptions: {
			multipleValues: true,
		},
		placeholder: 'Add Mapping',
		default: {},
		description:
			'Map every value of the Role Column to a chat role (e.g. sent → assistant, received → user). Unmapped values stop the run with a clear error naming the value.',
		options: [
			{
				displayName: 'Mapping',
				name: 'mappings',
				values: [
					{
						displayName: 'Table Value',
						name: 'sourceValue',
						type: 'options',
						description: chooseFromListDescription,
						default: '',
						typeOptions: {
							loadOptionsMethod: 'getRoleValues',
							loadOptionsDependsOn: ['schema.value', 'table.value', 'roleColumn'],
						},
					},
					{
						displayName: 'Chat Role',
						name: 'role',
						type: 'options',
						noDataExpression: true,
						default: 'user',
						options: [
							{ name: 'User', value: 'user' },
							{ name: 'Assistant', value: 'assistant' },
							{ name: 'System', value: 'system' },
						],
					},
				],
			},
		],
		displayOptions: {
			show: {
				mode: ['table'],
			},
		},
	},
	{
		displayName: 'Limit',
		name: 'limit',
		type: 'number',
		default: 50,
		description: 'How many history messages to return (1–1000). Keep it small to protect the model context window.',
		typeOptions: {
			minValue: 1,
			maxValue: 1000,
		},
		displayOptions: {
			show: {
				mode: ['table'],
			},
		},
	},
	queryPropertyV11,
	{
		displayName:
			'This node is read-only. It runs during AI Agent execution, converts each row to a LangChain message (user → Human, assistant → AI, system → System) in order, and never writes to the database. Persist new turns with your own INSERT downstream.',
		name: 'readOnlyNotice',
		type: 'notice',
		default: '',
	},
	{
		displayName: MAPPING_PROMPT_NOTICE,
		name: 'mappingPromptNotice',
		type: 'notice',
		default: '',
		displayOptions: {
			show: {
				mode: ['table'],
			},
		},
	},
	{
		displayName: SQL_PROMPT_NOTICE,
		name: 'sqlPromptNotice',
		type: 'notice',
		default: '',
		displayOptions: {
			show: {
				mode: ['sql'],
			},
		},
	},
];
