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
	description: 'Loads past chat messages from PostgreSQL so an AI agent remembers the conversation',
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

const chooseFromListDescription = 'Choose from the list, or enter a value with an expression';

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
		'Return two columns: role (user, assistant or system) and content (the message text), oldest first. You can use expressions. SELECT only — nothing is ever saved or changed.',
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

const MAPPING_PROMPT_NOTICE = `Copy the text below into any AI chat (for example ChatGPT) after picking the Schema and Table above. It asks the AI to fill in every field for you, based on your table.

---
Help me set up an n8n "SQL Chat Memory" node. Goal: load past chat messages from one database table so an AI agent remembers the conversation. The node only reads; it never saves or changes anything.

My table:
- Schema and table: [fill in, as picked above]
- Columns, with types exactly as shown in the dropdown lists above:
  [list them here, for example: id - number, session_id - text, sender - text, message - text, created_at - date and time]

Tell me exactly what to enter for each field:
1. Session Column and Session ID — which column groups messages into one conversation, and which value (fixed text or an expression) picks the current conversation.
2. Order Column — which date or number column puts the messages in order (or say if it can stay empty for automatic detection).
3. Role Column and Role Mappings — which column says who wrote each message, and which value means the person (user), the AI (assistant) or an instruction (system).
4. Max Messages — how many past messages to load (suggest a number).

Rules: messages reach the AI oldest first; every sender value must be matched to exactly one of user, assistant, system.
---`;

const SQL_PROMPT_NOTICE = `Copy the text below into any AI chat (for example ChatGPT), together with your table name and columns. It asks the AI to write the query this node needs.

---
Write a read-only SELECT query for an n8n "SQL Chat Memory" node. The query must return exactly two columns:
- role: who wrote the message — only user, assistant or system (translate my own values if needed).
- content: the complete message text.

List the oldest messages first. Keep only one conversation (filter on my conversation column and value). The query must never save, change or delete anything.

My table and columns:
[describe them here]
---`;

/**
 * Full v1.1 property list. Table Mapping mode is a fixed six-field flow
 * (Schema > Table > Session > Ordering > Role > Limit); Custom Query mode
 * is just the SQL field. Ends with a static copy-paste AI prompt notice
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
		description: 'Load history using a table form, or your own SQL query.',
		options: [
			{
				name: 'Table Mapping',
				value: 'table',
				description: 'Pick a table and match its columns — no code needed',
			},
			{
				name: 'Custom Query',
				value: 'sql',
				description: 'Write your own query for full control',
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
		description: 'The schema that contains your chat table',
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
		description: 'The table where your chat messages are stored',
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
			'The column that groups messages into one conversation. Leave empty if the table holds a single conversation.',
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
			'Load only messages with this value. You can type an expression such as {{ $json.sessionId }}. Required when a session column is picked above.',
		displayOptions: {
			show: {
				mode: ['table'],
			},
		},
	},
	{
		displayName: 'Order Column',
		name: 'orderColumn',
		...columnPicker('getColumns', ['schema.value', 'table.value'], 'e.g. created_at'),
		default: '',
		description:
			'The date or number column that puts messages in order. The newest messages are loaded. Leave empty to detect it automatically.',
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
			'The column that says who wrote each message. Then match each of its values below.',
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
		description: 'Match each value from the role column to who it stands for. Every value must be matched.',
		options: [
			{
				displayName: 'Mapping',
				name: 'mappings',
				values: [
					{
						displayName: 'Table Value',
						name: 'sourceValue',
						type: 'options',
						description: 'A value from the role column',
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
						description: 'Who this value means: the person, the AI, or an instruction',
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
		displayName: 'Max Messages',
		name: 'limit',
		type: 'number',
		default: 50,
		description: 'How many past messages to load (1–1000).',
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
			'This node only reads — it never saves or changes anything. Save new messages with your own steps after the AI agent replies.',
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
