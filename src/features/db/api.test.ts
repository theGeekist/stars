import { describe, expect, it } from "bun:test";
import { Database } from "bun:sqlite";
import { hasRunSince, latestRunAt, logRun, resetRun, tx } from "./api";

describe("features/db api", () => {
	function createRunsDb(): Database {
		const db = new Database(":memory:");
		db.exec(`CREATE TABLE runs (
                        subject TEXT NOT NULL,
                        row_id TEXT,
                        flag TEXT NOT NULL,
                        run_at TEXT NOT NULL,
                        meta TEXT
                )`);
		return db;
	}

	it("commits transactions and rolls back on error", () => {
		const db = createRunsDb();

		const committed = tx((inner) => {
			inner
				.query(`INSERT INTO runs(subject, row_id, flag, run_at, meta)
                                VALUES('repo', '1', 'score', '2024-01-01T00:00:00Z', NULL)
                        `)
				.run();
			return "ok";
		}, db);

		expect(committed).toBe("ok");
		const rows = db.query(`SELECT COUNT(*) as count FROM runs`).get() as {
			count: number;
		};
		expect(rows.count).toBe(1);

		expect(() =>
			tx(() => {
				db.query(`INSERT INTO runs(subject, row_id, flag, run_at, meta)
                                        VALUES('repo', '2', 'score', '2024-01-02T00:00:00Z', NULL)
                                `).run();
				throw new Error("fail");
			}, db),
		).toThrow("fail");

		const countAfterRollback = db
			.query(`SELECT COUNT(*) as count FROM runs WHERE row_id = '2'`)
			.get() as { count: number };
		expect(countAfterRollback.count).toBe(0);

		db.close();
	});

	it("logs runs and resets them", () => {
		const db = createRunsDb();

		logRun("repo", "42", "score", { batch: 3 }, db);
		logRun("repo", "42", "score", undefined, db);

		const stored = db
			.query(`SELECT subject, row_id, flag, meta FROM runs ORDER BY run_at`)
			.all() as Array<{
			subject: string;
			row_id: string;
			flag: string;
			meta: string | null;
		}>;
		expect(stored.length).toBe(2);
		expect(stored[0]).toEqual({
			subject: "repo",
			row_id: "42",
			flag: "score",
			meta: '{"batch":3}',
		});
		expect(stored[1].meta).toBeNull();

		const deleted = resetRun("repo", "42", "score", db);
		expect(deleted).toBe(2);
		const remaining = db
			.query(`SELECT COUNT(*) as count FROM runs WHERE subject = 'repo'`)
			.get() as { count: number };
		expect(remaining.count).toBe(0);

		db.close();
	});

	it("reports latest run timestamp and run history", () => {
		const db = createRunsDb();

		const insert = db.query(
			`INSERT INTO runs(subject, row_id, flag, run_at, meta) VALUES(?, ?, ?, ?, NULL)`,
		);
		insert.run("repo", "1", "score", "2024-01-01T00:00:00Z");
		insert.run("repo", "1", "score", "2024-02-01T00:00:00Z");
		insert.run("repo", "1", "ingest", "2024-03-01T00:00:00Z");

		expect(latestRunAt("repo", "1", "score", db)).toBe("2024-02-01T00:00:00Z");
		expect(latestRunAt("repo", "1", "sync", db)).toBeNull();

		expect(hasRunSince("repo", "1", "score", "2024-01-15T00:00:00Z", db)).toBe(
			true,
		);
		expect(hasRunSince("repo", "1", "score", "2024-02-15T00:00:00Z", db)).toBe(
			false,
		);

		db.close();
	});
});
