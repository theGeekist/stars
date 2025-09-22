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
	const candidate = resolve(here, "../../../sql/schema.sql");
	console.log(candidate);
	if (existsSync(candidate)) return candidate;
	const cwdCandidate = resolve(process.cwd(), "sql/schema.sql");
	if (existsSync(cwdCandidate)) return cwdCandidate;
	throw new Error("schema.sql not found");
}

/* ----------------------------- tiny migrations ---------------------------- */

function migrateIfNeeded(database: Database = getDefaultDb()): void {
	// With GH ids as PK, keep a sanity unique index on repo(id)
	database.run(`CREATE UNIQUE INDEX IF NOT EXISTS ux_repo_id ON repo(id);`);
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
	initSchema(db);
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

/** Prefer an explicit Database, or fall back to the singleton. */
export function withDB(database?: Database): Database {
	return database ?? _defaultDb;
}

/* ----------------------------- re-exports --------------------------------- */

// Services & types live next door; consumers import from features/db at one place.
export * from "./api";
export * from "./types";
