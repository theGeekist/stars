import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { createDb } from "@features/db";
import { prepareStatements, type Stmts } from "./statements";
import * as ops from "./ops";

describe("features/lists ops (DB-centric)", () => {
	let db: ReturnType<typeof createDb>;
	let stmts: Stmts;
	let repo1Id: number;
	let repo2Id: number;

	beforeEach(() => {
		db = createDb(":memory:");
		db.query(
			`INSERT INTO list(list_id, name, description, is_private, slug)
                         VALUES ('L_alpha', 'Alpha', NULL, 0, 'alpha'),
                                ('L_beta', 'Beta', NULL, 0, 'beta'),
                                ('L_gamma', 'Gamma', NULL, 0, 'gamma')`,
		).run();
		db.query(
			`INSERT INTO repo(repo_id, name_with_owner, url, description, primary_language,
                                topics, pushed_at, updated_at, created_at, popularity, freshness, activeness)
                         VALUES
                         ('R1', 'owner/r1', 'https://example.com/r1', 'Repo 1', 'TypeScript', '[]',
                          '2024-01-01', '2024-01-02', '2023-01-01', 0.9, 0.8, 0.7),
                         ('R2', 'owner/r2', 'https://example.com/r2', 'Repo 2', 'TypeScript', '[]',
                          '2024-01-05', '2024-01-06', '2023-01-01', 0.95, 0.9, 0.85)`,
		).run();
		db.query(
			`INSERT INTO list_repo(list_id, repo_id)
                         VALUES ((SELECT id FROM list WHERE slug = 'alpha'), (SELECT id FROM repo WHERE repo_id = 'R1')),
                                ((SELECT id FROM list WHERE slug = 'beta'), (SELECT id FROM repo WHERE repo_id = 'R2'))`,
		).run();
		const repo1 = db
			.query<{ id: number }, []>(
				"SELECT id FROM repo WHERE repo_id = 'R1' LIMIT 1",
			)
			.get();
		const repo2 = db
			.query<{ id: number }, []>(
				"SELECT id FROM repo WHERE repo_id = 'R2' LIMIT 1",
			)
			.get();
		if (!repo1 || !repo2)
			throw new Error("Seed data missing expected repo rows");
		repo1Id = repo1.id;
		repo2Id = repo2.id;
		stmts = prepareStatements(db);
	});

	afterEach(() => {
		db.close();
	});

	it("gets repos to score with and without list filters", async () => {
		const defaultRows = await ops.getReposToScore(stmts, { limit: 1 });
		expect(defaultRows).toHaveLength(1);
		expect(defaultRows[0].name_with_owner).toBe("owner/r2");

		const slugRows = await ops.getReposToScore(stmts, {
			listSlug: "alpha",
			limit: 5,
		});
		expect(slugRows).toHaveLength(1);
		expect(slugRows[0].name_with_owner).toBe("owner/r1");
	});

	it("reads current membership and maps slugs to GitHub ids", async () => {
		const membership = await ops.currentMembership(stmts, repo1Id);
		expect(membership).toEqual(["alpha"]);

		const ids = await ops.mapSlugsToGhIds(stmts, ["alpha", "missing", "beta"]);
		expect(ids).toEqual(["L_alpha", "L_beta"]);
	});

	it("reconciles local list membership transactionally", async () => {
		stmts.insertListRepo.run("alpha", repo2Id);
		await ops.reconcileLocal(stmts, repo2Id, ["beta", "gamma"]);

		const rows = db
			.query<{ slug: string }, [number]>(
				`SELECT l.slug FROM list_repo lr JOIN list l ON l.id = lr.list_id
                                 WHERE lr.repo_id = ?
                                 ORDER BY l.slug`,
			)
			.all(repo2Id);
		expect(rows.map((r) => r.slug)).toEqual(["beta", "gamma"]);
	});

	it("ensures list and repo GitHub IDs", async () => {
		const ghIds = await ops.ensureListGhIds(stmts);
		expect(ghIds.get("alpha")).toBe("L_alpha");
		expect(ghIds.get("beta")).toBe("L_beta");

		const repoGhId = await ops.ensureRepoGhId(stmts, "R2");
		expect(repoGhId).toBe("R2");
		await expect(ops.ensureRepoGhId(stmts, "missing")).rejects.toThrow(
			"Repo not found id=missing",
		);
	});
});
