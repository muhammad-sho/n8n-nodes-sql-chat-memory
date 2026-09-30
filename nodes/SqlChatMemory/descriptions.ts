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
		'Must return role and content columns, oldest rows first. Expressions allowed. SELECT only.',
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

const SQL_FORMAT_NOTICE = `Expected query output: exactly two columns — role (one of user, assistant, system) and content (the message text) — oldest rows first. Example: SELECT role, content FROM chat_messages WHERE session_id = '{{ $json.sessionId }}' ORDER BY created_at ASC LIMIT 50. SELECT only.`;

/**
 * Full v1.1 property list. Table Mapping mode is a fixed six-field flow
 * (Schema > Table > Session > Ordering > Role > Limit); Custom Query mode
 * is just the SQL field plus a short expected-output-format guidance box.
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
		description: 'Table form or custom SQL.',
		options: [
			{
				name: 'Table Mapping',
				value: 'table',
				description: 'Map table columns, no SQL needed',
			},
			{
				name: 'Custom Query',
				value: 'sql',
				description: 'Full control with your own query',
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
		description: 'Schema containing the table',
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
		description: 'Table storing the chat messages',
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
			'Column holding the session id. Empty = the whole table is one conversation.',
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
			'Value the session column must equal, e.g. {{ $json.sessionId }}. Expressions allowed. Required when a session column is set.',
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
			'Date or incremental column defining the row order. Newest rows are loaded. Empty = auto-detect.',
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
		description: 'Column holding the sender value. Map each value below.',
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
		description: 'Map each role-column value to user, assistant or system.',
		options: [
			{
				displayName: 'Mapping',
				name: 'mappings',
				values: [
					{
						displayName: 'Table Value',
						name: 'sourceValue',
						type: 'options',
						description: 'Value from the role column',
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
						description: 'user = person, assistant = AI, system = instruction',
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
		description: 'Number of messages to load (1–1000).',
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
		displayName: SQL_FORMAT_NOTICE,
		name: 'sqlFormatNotice',
		type: 'notice',
		default: '',
		displayOptions: {
			show: {
				mode: ['sql'],
			},
		},
	},
];
