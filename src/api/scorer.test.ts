import { beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { createDb, initSchema } from "@lib/db";
import { randHex } from "@lib/rand";

const db = createDb();

describe("cli-scorer", () => {
	// Ensure schema exists before any cleanup
	beforeAll(() => {
		initSchema();
	});
	beforeEach(() => {
		db.exec(
			"DELETE FROM repo_list_score; DELETE FROM model_run; DELETE FROM list_repo; DELETE FROM list; DELETE FROM repo;",
		);
		// Use a test-specific output directory to avoid CI conflicts
		const testOut = join(process.cwd(), "exports-test", randHex(12));
		(Bun.env as Record<string, string>).LISTLESS_OUT_DIR = testOut;
		// Clean any previous CSV in default path just in case
		const f = join(process.cwd(), "exports", "listless.csv");
		try {
			rmSync(f);
		} catch {}
	});

	it("scoreOne throws when dry=false and GITHUB_TOKEN missing", async () => {
		const { scoreOne } = await import("./scorer");
		db.exec(
			"INSERT INTO repo(id, name_with_owner, url, stars) VALUES (1, 'o/r1', 'u', 10);",
		);
		// Ensure error path triggers even if CI provides a token
		const prevToken = (Bun.env as Record<string, string | undefined>)
			.GITHUB_TOKEN;
		const prevForce = (Bun.env as Record<string, string | undefined>)
			.FORCE_TOKEN_MISSING;
		(Bun.env as Record<string, string | undefined>).FORCE_TOKEN_MISSING = "1";
		try {
			await expect(scoreOne("o/r1", false, undefined, db)).rejects.toThrow(
				/GITHUB_TOKEN/,
			);
		} finally {
			if (prevForce === undefined) {
				delete (Bun.env as Record<string, string | undefined>)
					.FORCE_TOKEN_MISSING;
			} else {
				(Bun.env as Record<string, string | undefined>).FORCE_TOKEN_MISSING =
					prevForce;
			}
			if (prevToken === undefined) {
				delete (Bun.env as Record<string, string | undefined>).GITHUB_TOKEN;
			} else {
				(Bun.env as Record<string, string | undefined>).GITHUB_TOKEN =
					prevToken;
			}
		}
	});

	it("scoreBatchAll logs listless CSV when avoidListless blocks (dry run)", async () => {
		const { scoreBatchAll } = await import("./scorer");
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

		await scoreBatchAll(5, true, fakeLLM, db);

		const csv = join(
			String((Bun.env as Record<string, string>).LISTLESS_OUT_DIR),
			"listless.csv",
		);
		expect(existsSync(csv)).toBeTrue();
		const txt = readFileSync(csv, "utf-8");
		expect(txt).toContain("o/r1");
		expect(txt).toContain("listless");
	});
});
