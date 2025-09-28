// src/lib/db.ts
import { Database } from "bun:sqlite";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** Default DB selection: in-memory under tests; otherwise env or local file. */
const isTestRunner = Array.isArray(Bun.argv) && Bun.argv.includes("test");
const DEFAULT_DB_FILE = isTestRunner
	? ":memory:"
	: Bun.env.DB_FILE || "repolists.db";

/** Internal singleton. Do not touch directly; use withDB() for fallbacks. */
let _defaultDb = new Database(DEFAULT_DB_FILE);

/* ------------------------------ path helpers ------------------------------ */

function resolveSchemaPath(): string {
	const here = dirname(fileURLToPath(import.meta.url));
	const candidate = resolve(here, "../../sql/schema.sql");
	if (existsSync(candidate)) return candidate;
	const cwdCandidate = resolve(process.cwd(), "sql/schema.sql");
	if (existsSync(cwdCandidate)) return cwdCandidate;
	throw new Error("schema.sql not found");
}

/* ----------------------------- tiny migrations ---------------------------- */

function tableColumns(table: string, database?: Database): Set<string> {
	const db = withDB(database);
	// PRAGMA table_info() doesn’t accept parameters; safe for known tables.
	const rows = db.query(`PRAGMA table_info(${table})`).all() as Array<{
		name: string;
	}>;
	return new Set(rows.map((r) => r.name));
}

function _addColumnIfMissing(
	table: string,
	col: string,
	sqlType: string,
	database?: Database,
): void {
	const db = withDB(database);
	const cols = tableColumns(table, db);
	if (!cols.has(col)) {
		db.run(`ALTER TABLE ${table} ADD COLUMN ${col} ${sqlType}`);
	}
}

/** Idempotent migration layer for existing DBs. Keep minimal. */
function migrateIfNeeded(database: Database = getDefaultDb()): void {
	// If an older partial unique index exists, drop it and recreate as non-partial.
	// Partial unique indexes are not eligible for ON CONFLICT targets.
	database.run(`
    DROP INDEX IF EXISTS ux_repo_repo_id;
  `);
	database.run(`
    CREATE UNIQUE INDEX IF NOT EXISTS ux_repo_repo_id
    ON repo(repo_id);
  `);
	_addColumnIfMissing("repo", "updates_json", "TEXT", database);
}

/* --------------------------------- API ------------------------------------ */

/** Apply schema.sql + migrations to a provided DB (or the default via withDB). */
export function initSchema(database?: Database): void {
	const db = withDB(database);
	const schemaPath = resolveSchemaPath();
	const sql = readFileSync(schemaPath, "utf-8");
	db.exec(sql);
	migrateIfNeeded(db);
}

/** Create a brand-new DB file (or :memory:) pre-initialised with schema+migrations. */
export function createDb(filename = ":memory:"): Database {
	const db = new Database(filename);
	const schemaPath = resolveSchemaPath();
	const sql = readFileSync(schemaPath, "utf-8");
	db.exec(sql);
	migrateIfNeeded(db);
	return db;
}

/** Swap the internal default DB (useful for app boot or specialised runners). */
export function setDefaultDb(database: Database): void {
	_defaultDb = database;
}

/** Get the current default DB (avoid in tests; inject instead). */
export function getDefaultDb(): Database {
	return _defaultDb;
}

/**
 * Prefer an explicit Database, or fall back to the singleton.
 * This is the **only** function that should read the default DB.
 */
export function withDB(database?: Database): Database {
	return database ?? _defaultDb;
}
