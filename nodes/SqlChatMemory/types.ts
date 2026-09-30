/** Shape of the n8n `postgres` credential (subset this node relies on). */
export interface PostgresCredentials {
	host: string;
	port: number;
	database: string;
	user: string;
	password: string;
	ssl?: 'disable' | 'allow' | 'require' | 'verify' | 'verify-full';
	allowUnauthorizedCerts?: boolean;
	sshTunnel?: boolean;
}

/** A single SQL result row in SQL mode. Only `role` and `content` are required. */
export interface SqlChatRow {
	role: unknown;
	content: unknown;
	[key: string]: unknown;
}

/** Roles the AI Agent understands. */
export type ChatRole = 'user' | 'assistant' | 'system';

/** A raw database row in Table Mapping mode. */
export type DbRow = Record<string, unknown>;

/** Column metadata from information_schema (+ enum info where available). */
export interface ColumnInfo {
	column_name: string;
	data_type: string;
	udt_name: string;
	is_nullable: string;
}

/** A single message part in Table Mapping mode. */
export interface ContentPart {
	source: 'column' | 'lookup';
	column?: string;
	prefix?: string;
	suffix?: string;
	fallback?: string;
	lookupTable?: string;
	localColumn?: string;
	foreignColumn?: string;
	valueColumn?: string;
	/** Resolved at fetch time: local key value -> looked-up text. */
	lookupValues?: Map<string, string>;
}

/** Explicit role mapping entry: table value -> chat role. */
export interface RoleMapping {
	from: string;
	to: ChatRole;
}

/** Where-condition in Table Mapping mode (mirrors native Postgres operators). */
export interface WhereCondition {
	column: string;
	condition: string;
	value?: unknown;
}
