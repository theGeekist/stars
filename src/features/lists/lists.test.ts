import { describe, it, expect } from "bun:test";
import { Database } from "bun:sqlite";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createListsService } from "@features/lists";

function makeDb() {
	const db = new Database(":memory:");
	const schema = readFileSync(
		resolve(process.cwd(), "sql/schema.sql"),
		"utf-8",
	);
	db.exec(schema);
	return db;
}

describe("lists service DB ops", () => {
	it("getReposToScore selects default and by slug", async () => {
		const db = makeDb();
		const svc = createListsService(db);
		// seed two lists and repos
		db.run(
			`INSERT INTO list(name, description, is_private, slug, list_id) VALUES ('AI','',0,'ai','L1'),('Prod','',0,'productivity','L2')`,
		);
		db.run(`INSERT INTO repo(name_with_owner, url, stars, forks, watchers, is_archived, is_disabled, is_fork, is_mirror, has_issues_enabled, popularity, freshness)
            VALUES ('o/r1','u1',50,1,1,0,0,0,0,1, 10, 5), ('o/r2','u2',10,1,1,0,0,0,0,1, 5,  3)`);
		db.run(`INSERT INTO list_repo(list_id, repo_id) VALUES (1,1), (2,2)`);

		const all = await svc.read.getReposToScore({ limit: 10 });
		expect(all.length).toBe(2);
		const ai = await svc.read.getReposToScore({ limit: 10, listSlug: "ai" });
		expect(ai.length).toBe(1);
		expect(ai[0].name_with_owner).toBe("o/r1");
	});

	it("currentMembership returns slugs", async () => {
		const db = makeDb();
		const svc = createListsService(db);
		db.run(
			`INSERT INTO list(name, description, is_private, slug, list_id) VALUES ('AI','',0,'ai','L1'),('Prod','',0,'productivity','L2')`,
		);
		db.run(`INSERT INTO repo(name_with_owner, url, stars, forks, watchers, is_archived, is_disabled, is_fork, is_mirror, has_issues_enabled)
            VALUES ('o/r1','u1',50,1,1,0,0,0,0,1)`);
		db.run(`INSERT INTO list_repo(list_id, repo_id) VALUES (1,1), (2,1)`);
		const slugs = await svc.read.currentMembership(1);
		expect(slugs.sort()).toEqual(["ai", "productivity"]);
	});

	it("reconcileLocal makes mapping exact", async () => {
		const db = makeDb();
		const svc = createListsService(db);
		db.run(
			`INSERT INTO list(name, description, is_private, slug, list_id) VALUES ('AI','',0,'ai','L1'),('Prod','',0,'productivity','L2'),('Learn','',0,'learning','L3')`,
		);
		db.run(`INSERT INTO repo(name_with_owner, url, stars, forks, watchers, is_archived, is_disabled, is_fork, is_mirror, has_issues_enabled)
            VALUES ('o/r1','u1',50,1,1,0,0,0,0,1)`);
		// start with ai + prod
		await svc.apply.reconcileLocal(1, ["ai", "productivity"]);
		let cur = await svc.read.currentMembership(1);
		expect(cur.sort()).toEqual(["ai", "productivity"]);
		// change to learning only
		await svc.apply.reconcileLocal(1, ["learning"]);
		cur = await svc.read.currentMembership(1);
		expect(cur).toEqual(["learning"]);
	});

	it("mapSlugsToGhIds returns only known GH ids", async () => {
		const db = makeDb();
		const svc = createListsService(db);
		db.run(
			`INSERT INTO list(name, description, is_private, slug, list_id) VALUES ('AI','',0,'ai','L1'),('Prod','',0,'productivity','L2')`,
		);
		const ids = await svc.read.mapSlugsToGhIds(["ai", "unknown"]);
		expect(ids).toEqual(["L1"]);
	});

	it("ensureListGhIds maps by list name and updates DB using injected GH client", async () => {
		const db = makeDb();
		// seed two lists
		db.run(
			`INSERT INTO list(name, description, is_private, slug, list_id) VALUES ('AI','',0,'ai',''),('Prod','',0,'productivity','')`,
		);
		// fake github runner that returns those two names with IDs
		const fakeGh = async <T>(
			_tok: string,
			_q: string,
			_vars?: Record<string, unknown>,
		): Promise<T> => {
			const page = {
				viewer: {
					lists: {
						pageInfo: { endCursor: null, hasNextPage: false },
						edges: [
							{
								cursor: "c1",
								node: {
									listId: "L_AI",
									name: "AI",
									description: "",
									isPrivate: false,
								},
							},
							{
								cursor: "c2",
								node: {
									listId: "L_PROD",
									name: "Prod",
									description: "",
									isPrivate: false,
								},
							},
						],
					},
				},
			} as any;
			return page as T;
		};
		const svc = createListsService(db, fakeGh);
		const map = await svc.apply.ensureListGhIds("token");
		expect(map.get("ai")).toBe("L_AI");
		expect(map.get("productivity")).toBe("L_PROD");
		const rows = db
			.query<{ list_id: string | null }, []>(
				`SELECT list_id FROM list ORDER BY id`,
			)
			.all();
		expect(rows.map((r) => r.list_id)).toEqual(["L_AI", "L_PROD"]);
	});

	it("ensureRepoGhId fetches and saves new global ID via injected GH client", async () => {
		const db = makeDb();
		db.run(`INSERT INTO repo(name_with_owner, url, stars, forks, watchers, is_archived, is_disabled, is_fork, is_mirror, has_issues_enabled)
            VALUES ('owner/repo','url',0,0,0,0,0,0,0,1)`);
		const fakeGh = async <T>(
			_tok: string,
			_q: string,
			_vars?: Record<string, unknown>,
		): Promise<T> => {
			return { repository: { id: "R_kgNEW" } } as any as T;
		};
		const svc = createListsService(db, fakeGh);
		const id = await svc.apply.ensureRepoGhId("token", 1);
		expect(id).toBe("R_kgNEW");
		const row = db
			.query<{ repo_id: string | null }, []>(
				`SELECT repo_id FROM repo WHERE id=1`,
			)
			.get();
		expect(row?.repo_id).toBe("R_kgNEW");
	});

	it("updateOnGitHub forwards itemId and listIds via injected GH client", async () => {
		const db = makeDb();
		let captured: any = null;
		const fakeGh = async <T>(
			_tok: string,
			_q: string,
			vars?: Record<string, unknown>,
		): Promise<T> => {
			captured = vars;
			return { updateUserListsForItem: { lists: [] } } as any as T;
		};
		const svc = createListsService(db, fakeGh);
		await svc.apply.updateOnGitHub("token", "R_kgX", ["L1", "L2"]);
		expect(captured).toEqual({ itemId: "R_kgX", listIds: ["L1", "L2"] });
	});
});
