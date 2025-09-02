import { beforeEach, describe, expect, it } from "bun:test";
import { db } from "@lib/db";
import { createSummariseService } from "./service";

beforeEach(() => {
	db.exec("DELETE FROM list_repo; DELETE FROM list; DELETE FROM repo;");
});

describe("summarise service", () => {
	it("selectRepos chooses only unsummarised by default and orders by popularity/freshness", () => {
		// Seed repos: r1 (no summary, higher popularity), r2 (has summary), r3 (no summary, lower popularity)
		db.exec(`
      INSERT INTO repo(id, name_with_owner, url, popularity, freshness, summary)
      VALUES (1, 'o/r1', 'u1', 0.9, 0.5, NULL),
             (2, 'o/r2', 'u2', 0.95, 0.9, 'done'),
             (3, 'o/r3', 'u3', 0.5, 0.9, NULL);
    `);

		const svc = createSummariseService();
		const rows = svc.selectRepos({ limit: 10 });
		expect(rows.map((r) => r.name_with_owner)).toEqual(["o/r1", "o/r3"]);
	});

	it("selectRepos filters by slug and respects resummarise flag", () => {
		db.exec(`
      INSERT INTO list(id, list_id, name, slug, is_private) VALUES (1, 'L1', 'Productivity', 'productivity', 0);
      INSERT INTO repo(id, name_with_owner, url, popularity, freshness, summary)
      VALUES (1, 'o/r1', 'u1', 0.9, 0.5, NULL),
             (2, 'o/r2', 'u2', 0.95, 0.9, 'done');
      INSERT INTO list_repo(list_id, repo_id) VALUES (1, 1), (1, 2);
    `);

		const svc = createSummariseService();
		// Without resummarise, only r1 (summary NULL)
		const a = svc.selectRepos({ limit: 10, slug: "productivity" });
		expect(a.map((r) => r.name_with_owner)).toEqual(["o/r1"]);

		// With resummarise, includes both r2 and r1 ordered by popularity
		const b = svc.selectRepos({
			limit: 10,
			slug: "productivity",
			resummarise: true,
		});
		expect(b.map((r) => r.name_with_owner)).toEqual(["o/r2", "o/r1"]);
	});

	it("saveSummary writes summary to repo row", () => {
		db.exec(
			`INSERT INTO repo(id, name_with_owner, url) VALUES (42, 'o/x', 'u');`,
		);
		const svc = createSummariseService();
		svc.saveSummary(42, "hello world");
		const row = db
			.query<{ summary: string | null }, [number]>(
				`SELECT summary FROM repo WHERE id = ?`,
			)
			.get(42);
		expect(row?.summary).toBe("hello world");
	});
});
