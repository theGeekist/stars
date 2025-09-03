// src/lib/db.ts
import { Database } from "bun:sqlite";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Default DB selection: use in-memory when running under `bun test` to avoid
// accidentally touching a developer's on-disk database during tests.
const isTestRunner = Array.isArray(Bun.argv) && Bun.argv.includes("test");
const DEFAULT_DB_FILE = isTestRunner
	? ":memory:"
	: Bun.env.DB_FILE || "repolists.db";

// Internal singleton; do not export directly. Use getters/helpers below.
let _defaultDb = new Database(DEFAULT_DB_FILE);

function resolveSchemaPath(): string {
	const here = dirname(fileURLToPath(import.meta.url));
	const candidate = resolve(here, "../../sql/schema.sql");
	if (existsSync(candidate)) return candidate;
	const cwdCandidate = resolve(process.cwd(), "sql/schema.sql");
	if (existsSync(cwdCandidate)) return cwdCandidate;
	throw new Error("schema.sql not found");
}

/** Return column names for a table. */
function tableColumns(
	table: string,
	database: Database = getDefaultDb(),
): Set<string> {
	// PRAGMA table_info() doesn’t accept bound parameters; safe for known tables.
	const rows = database.query(`PRAGMA table_info(${table})`).all() as Array<{
		name: string;
	}>;
	return new Set(rows.map((r) => r.name));
}

function addColumnIfMissing(
	table: string,
	col: string,
	sqlType: string,
	database: Database = getDefaultDb(),
) {
	const cols = tableColumns(table, database);
	if (!cols.has(col)) {
		database.run(`ALTER TABLE ${table} ADD COLUMN ${col} ${sqlType}`);
	}
}

/** Minimal, idempotent migrations for existing DBs. */
function migrateIfNeeded(database: Database = getDefaultDb()): void {
	// topics: newly added fields
	addColumnIfMissing("topics", "long_description_md", "TEXT", database);
	addColumnIfMissing("topics", "created_by", "TEXT", database);
	addColumnIfMissing("topics", "released", "TEXT", database);
	addColumnIfMissing("topics", "wikipedia_url", "TEXT", database);
	addColumnIfMissing("topics", "logo", "TEXT", database);

	// repo: keep these guards for older DBs that predate readme caching etc.
	addColumnIfMissing("repo", "readme_etag", "TEXT", database);
	addColumnIfMissing("repo", "readme_fetched_at", "TEXT", database);

	// New tables are created by schema.sql via CREATE TABLE IF NOT EXISTS,
	// so no action needed here for topic_alias/topic_related.
}

export function initSchema(database: Database = getDefaultDb()): void {
	const schemaPath = resolveSchemaPath();
	const sql = readFileSync(schemaPath, "utf-8");
	database.exec(sql);
	migrateIfNeeded(database);
}

export function createDb(filename = ":memory:"): Database {
	const newDb = new Database(filename);
	const schemaPath = resolveSchemaPath();
	const sql = readFileSync(schemaPath, "utf-8");
	newDb.exec(sql);
	migrateIfNeeded(newDb);
	return newDb;
}

export function setDefaultDb(database: Database): void {
	_defaultDb = database;
}

/** Return the current default (singleton) Database instance. */
export function getDefaultDb(): Database {
	return _defaultDb;
}

/** Utility to prefer an explicit Database, or fall back to the default. */
export function withDB(database?: Database): Database {
	return database ?? getDefaultDb();
}
