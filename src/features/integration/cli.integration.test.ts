import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { createDb, db, initSchema, setDefaultDb } from "@lib/db";

function resetTables() {
	db.exec(
		`DELETE FROM repo_list_score; DELETE FROM model_run; DELETE FROM list_repo; DELETE FROM repo; DELETE FROM list; DELETE FROM topics; DELETE FROM repo_topics;`,
	);
}

beforeAll(() => {
	const mem = createDb(":memory:");
	setDefaultDb(mem);
	initSchema(mem);
	resetTables();
});

afterAll(() => {
	resetTables();
});

describe("CLI integration", () => {
	it("scores repos end-to-end with injected LLM (dry)", async () => {
		const { scoreBatchAll } = await import("@src/cli-scorer");
		// Seed minimal lists and one repo
		db.query(
			`INSERT INTO list (id, list_id, name, slug, is_private) VALUES (1, 'L1', 'Productivity', 'productivity', 0)`,
		).run();
		db.query(
			`INSERT INTO list (id, list_id, name, slug, is_private) VALUES (2, 'L2', 'Self Marketing', 'self-marketing', 0)`,
		).run();
		db.query(
			`INSERT INTO repo (id, name_with_owner, url, stars, popularity, freshness, activeness, topics)
       VALUES (1, 'a/r', 'https://example.com/a/r', 120, 0.8, 0.5, 0.6, '[]')`,
		).run();

		// Fake LLM which gives clear top score to productivity
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

		await scoreBatchAll(5, false, fakeLLM);

		// Dry-run should not persist to repo_list_score
		const count =
			db
				.query<{ n: number }, []>(`SELECT COUNT(*) n FROM repo_list_score`)
				.get()?.n ?? 0;
		expect(count).toBe(0);
	});

	it("summarises repos and saves to DB with apply=true (no network)", async () => {
		const { summariseOne } = await import("@src/cli-summarise");
		// Seed one repo that looks like an awesome list to avoid README fetch
		db.query(
			`INSERT INTO repo (id, name_with_owner, url, description, stars, popularity, freshness, activeness, topics)
       VALUES (2, 'owner/awesome-stuff', 'https://example.com/owner/awesome-stuff', 'Awesome list of things', 5, 0.1, 0.1, 0.1, '["awesome"]')`,
		).run();

		await summariseOne("owner/awesome-stuff", true);

		const row = db
			.query<{ summary: string | null }, [number]>(
				`SELECT summary FROM repo WHERE id = ?`,
			)
			.get(2);
		expect(row?.summary).toBeTruthy();
		expect(String(row?.summary)).toContain("curated");
	});
});
