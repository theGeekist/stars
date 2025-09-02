import { beforeEach, describe, expect, it } from "bun:test";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { db } from "@lib/db";

describe("cli-scorer", () => {
	beforeEach(() => {
		db.exec(
			"DELETE FROM repo_list_score; DELETE FROM model_run; DELETE FROM list_repo; DELETE FROM list; DELETE FROM repo;",
		);
		// Clean any previous CSV
		const f = join(process.cwd(), "exports", "listless.csv");
		try {
			rmSync(f);
		} catch {}
	});

	it("scoreOne throws when apply=true and GITHUB_TOKEN missing", async () => {
		const { scoreOne } = await import("./cli-scorer");
		db.exec(
			"INSERT INTO repo(id, name_with_owner, url, stars) VALUES (1, 'o/r1', 'u', 10);",
		);
		// Ensure token is not set
		const prev = (Bun.env as Record<string, string | undefined>).GITHUB_TOKEN;
		delete (Bun.env as Record<string, string | undefined>).GITHUB_TOKEN;
		try {
			await expect(scoreOne("o/r1", true)).rejects.toThrow(/GITHUB_TOKEN/);
		} finally {
			if (prev)
				(Bun.env as Record<string, string | undefined>).GITHUB_TOKEN = prev;
		}
	});

	it("scoreBatchAll logs listless CSV when avoidListless blocks (dry run)", async () => {
		const { scoreBatchAll } = await import("./cli-scorer");
		// Seed one list and one repo with high stars (avoid minStars block)
		db.exec(`
      INSERT INTO list(id, list_id, name, slug, is_private) VALUES (1, 'L1', 'Alpha', 'alpha', 0);
      INSERT INTO repo(id, name_with_owner, url, stars, popularity, freshness, activeness, topics)
      VALUES (1, 'o/r1', 'https://example.com/o/r1', 100, 0.9, 0.5, 0.4, '[]');
    `);
		// Fake LLM that yields low scores -> review empty, planned empty -> listless block
		const fakeLLM = {
			async generatePromptAndSend() {
				return {
					scores: [{ list: "alpha", score: 0.1, why: "nope" }],
				} as const;
			},
		} as const;

		await scoreBatchAll(5, false, fakeLLM);

		const csv = join(process.cwd(), "exports", "listless.csv");
		expect(existsSync(csv)).toBeTrue();
		const txt = readFileSync(csv, "utf-8");
		expect(txt).toContain("o/r1");
		expect(txt).toContain("listless");
	});
});
