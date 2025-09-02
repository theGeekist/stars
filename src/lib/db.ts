// src/lib/db.ts
import { Database } from "bun:sqlite";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { existsSync, readFileSync } from "node:fs";

export const db = new Database("repolists.db");

function resolveSchemaPath(): string {
	const here = dirname(fileURLToPath(import.meta.url));
	const candidate = resolve(here, "../../sql/schema.sql");

	if (existsSync(candidate)) return candidate;
	const cwdCandidate = resolve(process.cwd(), "sql/schema.sql");
	if (existsSync(cwdCandidate)) return cwdCandidate;

	throw new Error("schema.sql not found");
}

export function initSchema(): void {
	const schemaPath = resolveSchemaPath();
	const sql = readFileSync(schemaPath, "utf-8");
	db.exec(sql);
}
