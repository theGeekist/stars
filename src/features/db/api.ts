// src/features/db/api.ts
import type { Database } from "bun:sqlite";
import { withDB } from "./index";
import type { FlagName, ISODateTime, TableName } from "./types";

/* ------------------------------- transactions ------------------------------- */

/** Run a function inside a BEGIN IMMEDIATE/COMMIT, with rollback on error. */
export function tx<T>(fn: (db: Database) => T, database?: Database): T {
	const db = withDB(database);
	db.run("BEGIN IMMEDIATE");
	try {
		const res = fn(db);
		db.run("COMMIT");
		return res;
	} catch (err) {
		db.run("ROLLBACK");
		throw err;
	}
}

/* --------------------------------- runs api -------------------------------- */

/**
 * Append a successful run to the ledger.
 * Absence of a row for (table,rowId,flag) means “not done/failed”.
 */
export function logRun(
	subject: TableName,
	rowId: string | null,
	flag: FlagName,
	meta?: unknown,
	database?: Database,
): void {
	const db = withDB(database);
	const payload = meta == null ? null : JSON.stringify(meta);
	db.query(
		`INSERT INTO runs(subject, row_id, flag, run_at, meta)
     VALUES(?, ?, ?, datetime('now'), ?)`,
	).run(subject, rowId, flag, payload);
}

/** Remove all success rows for (subject,rowId,flag) — effectively a reset. */
export function resetRun(
	subject: TableName,
	rowId: string | null,
	flag: FlagName,
	database?: Database,
): number {
	const db = withDB(database);
	const info = db
		.query(`DELETE FROM runs WHERE subject = ? AND row_id IS ? AND flag = ?`)
		.run(subject, rowId, flag) as { changes: number };
	return info?.changes ?? 0;
}

/** Latest run timestamp for (subject,rowId,flag), or null if never. */
export function latestRunAt(
	subject: TableName,
	rowId: string | null,
	flag: FlagName,
	database?: Database,
): ISODateTime | null {
	const db = withDB(database);
	const row = db
		.query(
			`SELECT MAX(run_at) AS last_run_at
       FROM runs
       WHERE subject = ? AND row_id IS ? AND flag = ?`,
		)
		.get(subject, rowId, flag) as { last_run_at?: string } | undefined;
	return row?.last_run_at ?? null;
}

/**
 * Did a run occur since a given ISO timestamp?
 * Pass a literal ISO string or a SQLite datetime() expression result.
 */
export function hasRunSince(
	subject: TableName,
	rowId: string | null,
	flag: FlagName,
	sinceISO: ISODateTime,
	database?: Database,
): boolean {
	const db = withDB(database);
	const row = db
		.query(
			`SELECT 1
       FROM runs
       WHERE subject = ? AND row_id IS ? AND flag = ? AND run_at >= ?
       LIMIT 1`,
		)
		.get(subject, rowId, flag, sinceISO) as { 1?: number } | undefined;
	return !!row;
}
