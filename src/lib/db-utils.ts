// src/lib/db-utils.ts
// Common database utility functions

import type { Database } from "bun:sqlite";

/** Check if a table exists in the database */
export function tableExists(tableName: string, database: Database): boolean {
	const query = `SELECT name FROM sqlite_master WHERE type='table' AND name=?`;
	const result = database.query(query).get(tableName);
	return !!result;
}

/** Get column names for a table */
export function getTableColumns(
	table: string,
	database: Database,
): Set<string> {
	const rows = database.query(`PRAGMA table_info(${table})`).all() as Array<{
		name: string;
	}>;
	return new Set(rows.map((r) => r.name));
}

/** Add column to table if it doesn't exist */
export function addColumnIfMissing(
	table: string,
	column: string,
	sqlType: string,
	database: Database,
): void {
	const columns = getTableColumns(table, database);
	if (!columns.has(column)) {
		database.run(`ALTER TABLE ${table} ADD COLUMN ${column} ${sqlType}`);
	}
}

/** Execute a query with error handling and logging */
export function safeExecute<T>(
	database: Database,
	query: string,
	params: (string | number | boolean | null)[] = [],
	errorContext?: string,
): T[] {
	try {
		const stmt = database.query(query);
		return stmt.all(...params) as T[];
	} catch (error) {
		const context = errorContext ? ` (${errorContext})` : "";
		console.error(`Database query failed${context}:`, error);
		console.error(`Query: ${query}`);
		console.error(`Params:`, params);
		throw error;
	}
}

/** Create index if it doesn't exist */
export function createIndexIfNotExists(
	database: Database,
	indexName: string,
	tableName: string,
	columns: string[],
	unique = false,
): void {
	const indexType = unique ? "UNIQUE INDEX" : "INDEX";
	const columnList = columns.join(", ");
	const sql = `CREATE ${indexType} IF NOT EXISTS ${indexName} ON ${tableName}(${columnList})`;
	database.run(sql);
}
