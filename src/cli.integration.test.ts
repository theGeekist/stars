// src/features/integration/cli.integration.test.ts

import type { Database } from "bun:sqlite";
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { createDb, initSchema, setDefaultDb, withDB } from "@lib/db";
import { _testMain } from "@src/cli";

let db: Database;

function resetTables(database?: Database) {
	const d = withDB(database);
	d.exec(`
    DELETE FROM repo_list_score;
    DELETE FROM model_run;
    DELETE FROM list_repo;
    DELETE FROM repo;
    DELETE FROM list;
    DELETE FROM topics;
    DELETE FROM repo_topics;
  `);
}

beforeAll(() => {
	db = createDb(":memory:"); // one DB for the whole file
	setDefaultDb(db);
	initSchema(db); // ensure schema+indexes
	resetTables(db);
});

afterAll(() => {
	resetTables(db);
});

describe("CLI integration", () => {
	it("scores repos end-to-end with injected LLM (dry)", async () => {
		const { scoreBatchAll } = await import("@src/api/scorer");

		// Seed using the SAME db handle
		db.query(
			`INSERT INTO list (id, list_id, name, slug, is_private)
       VALUES (1,'L1','Productivity','productivity',0)`,
		).run();
		db.query(
			`INSERT INTO list (id, list_id, name, slug, is_private)
       VALUES (2,'L2','Self Marketing','self-marketing',0)`,
		).run();
		db.query(
			`INSERT INTO repo (id, name_with_owner, url, stars, popularity, freshness, activeness, topics)
       VALUES (1, 'a/r', 'https://example.com/a/r', 120, 0.8, 0.5, 0.6, '[]')`,
		).run();

		// Fake LLM: clear top score to productivity
		const fakeLLM = {
			async generatePromptAndSend() {
				return {
					scores: [
						{ list: "productivity", score: 0.9, why: "automates common tasks" },
						{ list: "self-marketing", score: 0.1 },
					],
				};
			},
		} as const;

		await scoreBatchAll(5, true, fakeLLM);

		// Dry-run → no persistence
		const count =
			db
				.query<{ n: number }, []>(`SELECT COUNT(*) n FROM repo_list_score`)
				.get()?.n ?? 0;
		expect(count).toBe(0);
	});

	it("summarises repos and saves to DB with dry=false (no network)", async () => {
		const { summariseOne } = await import("@src/api/summarise");

		db.query(
			`INSERT INTO repo (id, name_with_owner, url, description, stars, popularity, freshness, activeness, topics)
       VALUES (2, 'owner/awesome-stuff', 'https://example.com/owner/awesome-stuff',
               'Awesome list of things', 5, 0.1, 0.1, 0.1, '["awesome"]')`,
		).run();

		await summariseOne("owner/awesome-stuff", false);

		const row = db
			.query<{ summary: string | null }, [number]>(
				`SELECT summary FROM repo WHERE id = ?`,
			)
			.get(2);
		expect(row?.summary).toBeTruthy();
		expect(String(row?.summary)).toContain("curated");
	});
});

describe("cli routing smoke coverage", () => {
	it("help path runs", async () => {
		await _testMain(["bun", "cli.ts", "help"]);
	});
});
