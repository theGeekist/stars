// src/lib/db.ts
import { Database } from "bun:sqlite";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Default on-disk database (used by CLI/server).
// Prefer using createDb() in libraries and pass DBs around for testability.
// Allow override via DB_FILE for integration tests.
export const db = new Database(Bun.env.DB_FILE || "repolists.db");

function resolveSchemaPath(): string {
	const here = dirname(fileURLToPath(import.meta.url));
	const candidate = resolve(here, "../../sql/schema.sql");

	if (existsSync(candidate)) return candidate;
	const cwdCandidate = resolve(process.cwd(), "sql/schema.sql");
	if (existsSync(cwdCandidate)) return cwdCandidate;

	throw new Error("schema.sql not found");
}

export function initSchema(database: Database = db): void {
	const schemaPath = resolveSchemaPath();
	const sql = readFileSync(schemaPath, "utf-8");
	database.exec(sql);
}

// Test helpers: create new DBs with loaded schema
export function createDb(filename = Bun.env.DB_FILE || ":memory:"): Database {
	const newDb = new Database(filename);
	const schemaPath = resolveSchemaPath();
	const sql = readFileSync(schemaPath, "utf-8");
	newDb.exec(sql);
	return newDb;
}
