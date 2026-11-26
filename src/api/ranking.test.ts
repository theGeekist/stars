import { describe, expect, it } from "bun:test";
import type { ScoringLLM } from "@features/scoring/llm";
import { createDb, initSchema } from "@lib/db";
import { rankAll, rankOne } from "./ranking.public";

function makeDb() {
	const db = createDb(":memory:");
	initSchema(db);
	db.exec(
		`INSERT INTO list(id, list_id, name, slug, is_private) VALUES (1,'L1','Alpha','alpha',0);`,
	);
	db.exec(`
		INSERT INTO repo(id, repo_id, name_with_owner, url, description, primary_language, topics, summary, stars, forks, popularity, freshness, activeness)
		VALUES (1, 'R_1', 'org/one', 'https://github.com/org/one', 'Repo description', 'TypeScript', '["testing"]', 'Test summary', 10, 2, 0.5, 0.6, 0.7);
	`);
	return db;
}

const scoringLLM: ScoringLLM = {
	generatePromptAndSend: async () => ({
		scores: [{ list: "alpha", score: 0.9, why: "fits the list" }],
	}),
};

describe("ranking public API", () => {
	it("ranks repositories with an injected LLM and emits progress", async () => {
		const events: unknown[] = [];
		const result = await rankAll({
			dry: true,
			llm: scoringLLM,
			db: makeDb(),
			onProgress: (event) => {
				events.push(event);
			},
		});

		expect(result.items).toHaveLength(1);
		expect(result.items[0]).toMatchObject({
			nameWithOwner: "org/one",
			status: "ok",
			scores: [{ list: "alpha", score: 0.9 }],
		});
		expect(result.stats).toEqual({
			processed: 1,
			succeeded: 1,
			failed: 0,
			saved: 0,
		});
		expect(events).toHaveLength(1);
	});

	it("returns an error when the LLM response is invalid", async () => {
		const result = await rankOne({
			selector: "org/one",
			dry: true,
			llm: { generatePromptAndSend: async () => null },
			db: makeDb(),
		});

		expect(result.status).toBe("error");
		expect(result.error).toBe("Invalid LLM response");
	});

	it("returns an error when the selected repo does not exist", async () => {
		const result = await rankOne({
			selector: "unknown/repo",
			dry: true,
			llm: scoringLLM,
			db: makeDb(),
		});

		expect(result.status).toBe("error");
		expect(result.error).toBe("repo not found");
	});
});
