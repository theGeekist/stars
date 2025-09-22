// src/features/lists/ops.spec.ts
import { beforeAll, describe, expect, it } from "bun:test";
// import { createDb } from "@lib/db";
import { createDb, initSchema } from "@features/db"; // if your init is separate; otherwise drop
import * as ops from "@features/lists/ops";
import { prepareStatements } from "@features/lists/statements";

let db: ReturnType<typeof createDb>;
let stmts: ReturnType<typeof prepareStatements>;

beforeAll(() => {
	db = createDb(":memory:");
	initSchema(db);

	// seed minimal data
	db.exec(`
    INSERT INTO list(id,list_id,name,description,is_private,slug) VALUES
      (1,'L_A','A','a',0,'a'), (2,'L_B','B',NULL,0,'b');

    INSERT INTO repo(id,repo_id,name_with_owner,url,description,primary_language,topics,stars,forks,updated_at)
      VALUES
      (1,'R_1','o/r1','https://x/1','d1','TS','["x","y"]',10,2,'2024-01-01T00:00:00Z'),
      (2,'R_2','o/r2','https://x/2','d2',NULL,'[]',5,1,'2024-01-01T00:00:00Z');

    INSERT INTO list_repo(list_id, repo_id) VALUES (1, 1);
  `);

	stmts = prepareStatements(db);
});

describe("ops: DB-only", () => {
	it("getReposToScore (default)", async () => {
		const rows = await ops.getReposToScore(stmts, { limit: 10 });
		expect(rows.length).toBeGreaterThan(0);
		expect(rows[0]).toHaveProperty("name_with_owner");
	});

	it("getReposToScore (by slug)", async () => {
		const rows = await ops.getReposToScore(stmts, { listSlug: "a", limit: 10 });
		expect(rows.map((r) => r.id)).toEqual([1]);
	});

	it("currentMembership", async () => {
		const slugs = await ops.currentMembership(stmts, 1);
		expect(slugs).toEqual(["a"]);
	});

	it("mapSlugsToGhIds", async () => {
		const ids = await ops.mapSlugsToGhIds(stmts, ["a", "b", "nope"]);
		expect(ids).toEqual(["L_A", "L_B"]);
	});

	it("reconcileLocal (set to only B)", async () => {
		await ops.reconcileLocal(stmts, 1, ["b"]);
		const after = db
			.query<{ slug: string }, [number]>(
				`SELECT l.slug FROM list_repo lr JOIN list l ON l.id=lr.list_id WHERE lr.repo_id=? ORDER BY l.slug`,
			)
			.all(1)
			.map((r) => r.slug);
		expect(after).toEqual(["b"]);
	});
});
