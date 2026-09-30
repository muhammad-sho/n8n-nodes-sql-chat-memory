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

const postgresCredential = {
	name: 'postgres',
	required: true,
} as const;

/** Postgres credential, shared by both versions. */
export const postgresCredentials = [postgresCredential];

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

const OPERATOR_OPTIONS: INodeProperties['options'] = [
	{ name: 'Equal', value: 'equal' },
	{ name: 'Not Equal', value: '!=' },
	{ name: 'Like', value: 'LIKE' },
	{ name: 'Greater Than', value: '>' },
	{ name: 'Less Than', value: '<' },
	{ name: 'Greater Than Or Equal', value: '>=' },
	{ name: 'Less Than Or Equal', value: '<=' },
	{ name: 'Is Null', value: 'IS NULL' },
	{ name: 'Is Not Null', value: 'IS NOT NULL' },
];

/** Custom Query field for v1.1 (same `query` param name as v1, updated guidance). */
export const queryPropertyV11: INodeProperties = {
	displayName: 'SQL Query',
	name: 'query',
	type: 'string',
	required: true,
	default: '',
	placeholder:
		"SELECT role, content FROM chat_messages WHERE session_id = '{{ $json.sessionId }}' ORDER BY created_at ASC LIMIT 50",
	description:
		'Write the query so it already returns the final form: a "role" column (user, assistant or system) and a "content" column, oldest rows first. Rows are handed to the AI unchanged. Supports n8n expressions. Read-only: SELECT or WITH ... SELECT only.',
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

/** Full v1.1 property list (mode switch + Table Mapping + Custom Query + buttons). */
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
				description: 'Write the SELECT yourself; it must return role and content columns',
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
		description:
			'The schema that contains the history table. In Custom Query mode it is only used by the Copy Prompt button below.',
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
				mode: ['table', 'sql'],
			},
		},
	},
	{
		displayName: 'Table',
		name: 'table',
		type: 'resourceLocator',
		default: { mode: 'list', value: '' },
		required: true,
		description:
			'The table that holds the conversation history. In Custom Query mode it is only used by the Copy Prompt button below.',
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
				mode: ['table', 'sql'],
			},
		},
	},
	{
		displayName:
			'Schema and Table above are only used by the Copy Prompt button at the end of this node. The SQL Query below decides what actually runs.',
		name: 'sqlContextNotice',
		type: 'notice',
		default: '',
		displayOptions: {
			show: {
				mode: ['sql'],
			},
		},
	},
	{
		displayName: 'Select Rows',
		name: 'where',
		type: 'fixedCollection',
		typeOptions: {
			multipleValues: true,
		},
		placeholder: 'Add Condition',
		default: {},
		description:
			'Only matching rows are loaded (e.g. a session/user/chat id column). If not set, all rows are selected.',
		options: [
			{
				displayName: 'Values',
				name: 'values',
				values: [
					{
						displayName: 'Column',
						name: 'column',
						...columnPicker('getColumns', ['schema.value', 'table.value']),
						default: '',
					},
					{
						displayName: 'Operator',
						name: 'condition',
						type: 'options',
						description:
							"The operator to check the column against. When using 'Like', percent sign (%) matches zero or more characters, underscore (_) matches any single character.",
						options: OPERATOR_OPTIONS,
						default: 'equal',
						noDataExpression: true,
					},
					{
						displayName: 'Value',
						name: 'value',
						type: 'string',
						displayOptions: {
							hide: {
								condition: ['IS NULL', 'IS NOT NULL'],
							},
						},
						default: '',
						description: 'Supports n8n expressions, e.g. {{ $json.sessionId }}',
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
		displayName: 'Combine Conditions',
		name: 'combineConditions',
		type: 'options',
		description:
			'How to combine the conditions defined in "Select Rows": AND requires all conditions to be true, OR requires at least one condition to be true',
		options: [
			{
				name: 'AND',
				value: 'AND',
				description: 'Only rows that meet all the conditions are selected',
			},
			{
				name: 'OR',
				value: 'OR',
				description: 'Rows that meet at least one condition are selected',
			},
		],
		default: 'AND',
		noDataExpression: true,
		displayOptions: {
			show: {
				mode: ['table'],
			},
		},
	},
	{
		displayName: 'Ordering',
		name: 'ordering',
		type: 'options',
		noDataExpression: true,
		default: 'auto',
		description: 'Which column defines the conversation order.',
		options: [
			{
				name: 'Auto-Detect',
				value: 'auto',
				description: 'First timestamp column, else an integer key column, else the first integer column',
			},
			{
				name: 'Specific Column',
				value: 'column',
				description: 'Order by the column selected below',
			},
			{
				name: 'None',
				value: 'none',
				description: 'No ORDER BY — rows come back in table order',
			},
		],
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
			'Required when Ordering is "Specific column". When Ordering is "Auto-detect", leave empty to detect (primary key, then first timestamp column) or pick a column to override the detection.',
		displayOptions: {
			show: {
				mode: ['table'],
				ordering: ['auto', 'column'],
			},
		},
	},
	{
		displayName: 'History Window',
		name: 'loadMode',
		type: 'options',
		noDataExpression: true,
		default: 'recent',
		description:
			'Which rows to load. Messages are always handed to the AI oldest-first.',
		options: [
			{
				name: 'Most Recent N',
				value: 'recent',
				description: 'Load the newest N rows, shown oldest-first (recommended for chat history)',
			},
			{
				name: 'Oldest N',
				value: 'oldest',
				description: 'Load the first N rows, oldest-first',
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
		description: 'How many history rows to load (1–1000). Keep it small to protect the model context window.',
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
	{
		displayName:
			'Without an ordering column the node cannot determine the most recent rows: the Limit applies in plain table order.',
		name: 'orderingNoneWarning',
		type: 'notice',
		default: '',
		displayOptions: {
			show: {
				mode: ['table'],
				ordering: ['none'],
			},
		},
	},
	{
		displayName: 'Role Column',
		name: 'roleColumn',
		...columnPicker('getColumns', ['schema.value', 'table.value'], 'e.g. direction'),
		default: '',
		description:
			'The column holding the sender/type. Leave empty to auto-detect (looks for role, type, direction, sender, …). Its distinct values are mapped below.',
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
			'Map each value of the Role Column to user, assistant or system. Values named user/assistant/system (or human/ai) are recognized automatically; anything else must be mapped here.',
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
		displayName: 'Content Source',
		name: 'contentMode',
		type: 'options',
		noDataExpression: true,
		default: 'auto',
		description: 'How the message text is built.',
		options: [
			{
				name: 'Auto-Detect',
				value: 'auto',
				description: 'Use the first text-like column (prefers message, content, body, text)',
			},
			{
				name: 'Custom Template',
				value: 'custom',
				description: 'Write a template with {{column}} placeholders, e.g. {{message}} (replying to: "{{quoted}}")',
			},
		],
		displayOptions: {
			show: {
				mode: ['table'],
			},
		},
	},
	{
		displayName: 'Content Template',
		name: 'contentTemplate',
		type: 'string',
		default: '',
		placeholder: '{{message}} (replying to: "{{quoted}}", message id: "{{id}}")',
		description:
			'Message text with {{column}} placeholders for row columns and {{lookup}} placeholders for lookups defined below. Unknown names render empty; missing lookup keys use the lookup fallback. This field is not an n8n expression — write placeholders literally.',
		noDataExpression: true,
		typeOptions: {
			rows: 4,
		},
		displayOptions: {
			show: {
				mode: ['table'],
				contentMode: ['custom'],
			},
		},
	},
	{
		displayName: 'Content Lookups',
		name: 'contentLookups',
		type: 'fixedCollection',
		typeOptions: {
			multipleValues: true,
		},
		placeholder: 'Add Lookup',
		default: {},
		description:
			'Named values fetched from other tables for {{name}} placeholders (one batched query each, e.g. a quoted message by id).',
		options: [
			{
				displayName: 'Lookup',
				name: 'lookups',
				values: [
					{
						displayName: 'Name',
						name: 'name',
						type: 'string',
						default: '',
						placeholder: 'e.g. quoted',
						description: 'Placeholder name used as {{name}} in the template (letters, digits, underscore).',
					},
					{
						displayName: 'Lookup Table',
						name: 'lookupTable',
						type: 'options',
						description: chooseFromListDescription,
						default: '',
						typeOptions: {
							loadOptionsMethod: 'getLookupTables',
							loadOptionsDependsOn: ['schema.value', 'table.value'],
						},
					},
					{
						displayName: 'Local Column',
						name: 'localColumn',
						...columnPicker('getColumns', ['schema.value', 'table.value'], 'e.g. quoted_message_id'),
						default: '',
						description:
							'Column on the history row holding the key (e.g. the quoted message id).',
					},
					{
						displayName: 'Match Column',
						name: 'foreignColumn',
						type: 'options',
						description:
							'Column on the lookup table to match the key against (e.g. its id). Choose from the list, or specify an ID using an expression.',
						default: '',
						typeOptions: {
							loadOptionsMethod: 'getLookupColumns',
							loadOptionsDependsOn: ['&lookupTable'],
						},
					},
					{
						displayName: 'Value Column',
						name: 'valueColumn',
						type: 'options',
						description:
							'Column on the lookup table whose text is used (e.g. its message). Choose from the list, or specify an ID using an expression.',
						default: '',
						typeOptions: {
							loadOptionsMethod: 'getLookupColumns',
							loadOptionsDependsOn: ['&lookupTable'],
						},
					},
					{
						displayName: 'Fallback',
						name: 'fallback',
						type: 'string',
						default: '',
						description:
							'Used when the key is empty or finds no row (e.g. a message without a quote). Leave empty to render nothing.',
					},
				],
			},
		],
		displayOptions: {
			show: {
				mode: ['table'],
				contentMode: ['custom'],
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
		displayName: 'Copy Prompt to Ask LLM',
		name: 'copyMappingPrompt',
		type: 'button',
		default: '',
		description:
			'Builds a ready-to-paste prompt for an LLM (table columns, types, role values and your current settings) that tells it exactly how to configure the mapping above. Requires a Schema and Table first.',
		typeOptions: {
			buttonConfig: {
				label: 'Copy Prompt to Ask LLM',
				action: 'buildMappingPrompt',
			},
		},
		displayOptions: {
			show: {
				mode: ['table'],
			},
		},
	},
	{
		displayName: 'Copy Prompt to Ask LLM',
		name: 'copySqlPrompt',
		type: 'button',
		default: '',
		description:
			'Builds a ready-to-paste prompt for an LLM (table columns, types and your current SQL) that tells it exactly which SELECT to write. Requires a Schema and Table first.',
		typeOptions: {
			buttonConfig: {
				label: 'Copy Prompt to Ask LLM',
				action: 'buildSqlPrompt',
			},
		},
		displayOptions: {
			show: {
				mode: ['sql'],
			},
		},
	},
];
