import { Database } from "bun:sqlite";
import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createScoringService } from "@features/scoring";
import type { ScoreItem } from "@features/scoring/llm";
import type { RepoRow } from "@lib/types";

const makeRepoRow = (id: number, stars: number): RepoRow => ({
	id,
	repo_id: "R_0000000001",
	name_with_owner: "owner/name",
	url: "https://github.com/owner/name",
	description: null,
	primary_language: null,
	license: null,
	tags: null,
	summary: null,
	is_archived: 0,
	is_disabled: 0,
	popularity: null,
	freshness: null,
	activeness: null,
	updated_at: null,
	topics: "[]",
	stars,
	forks: null,
});

describe("scoring planTargets", () => {
	const scoring = createScoringService();

	it("adds when score >= slug threshold and not in current", () => {
		const current: string[] = ["ai"];
		const scores: ScoreItem[] = [
			{ list: "ai", score: 0.6 },
			{ list: "productivity", score: 0.75 },
			{ list: "learning", score: 0.2 },
		];
		const out = scoring.planTargets(current, scores, {
			addBySlug: { productivity: 0.7 },
			defaultAdd: 0.7,
			remove: 0.3,
			preserve: new Set(),
		});
		expect(out.add).toContain("productivity");
		expect(out.keep).toContain("ai");
		expect(out.remove).not.toContain("ai");
	});

	it("respects preserve set to avoid removal", () => {
		const current = ["personal"];
		const scores: ScoreItem[] = [{ list: "personal", score: 0.0 }];
		const out = scoring.planTargets(current, scores, {
			preserve: new Set(["personal"]),
			defaultAdd: 0.7,
			remove: 0.3,
		});
		expect(out.remove).toHaveLength(0);
		expect(out.planned).toContain("personal");
	});
});

describe("scoring planMembership", () => {
	const scoring = createScoringService();
	const repo: RepoRow = makeRepoRow(1, 100);

	it("blocks apply for low stars when minStars set", () => {
		const current: string[] = [];
		const scores: ScoreItem[] = [{ list: "ai", score: 0.9 }];
		const res = scoring.planMembership(makeRepoRow(2, 10), current, scores, {
			thresholds: { defaultAdd: 0.7, remove: 0.3 },
			minStars: 50,
			avoidListless: true,
		});
		expect(res.blocked).toBeTrue();
	});

	it("falls back to top review to avoid listless when enabled", () => {
		const current: string[] = ["old-cat"];
		const scores: ScoreItem[] = [
			{ list: "old-cat", score: 0.1 }, // would be removed
			{ list: "ai", score: 0.6 }, // review
			{ list: "learning", score: 0.2 },
		];
		const res = scoring.planMembership(repo, current, scores, {
			thresholds: { defaultAdd: 0.7, remove: 0.3 },
			avoidListless: true,
		});
		expect(res.blocked).toBeFalse();
		expect(res.finalPlanned.length).toBe(1);
		expect(["ai"]).toContain(res.finalPlanned[0]);
		expect(res.fallbackUsed?.list).toBe("ai");
	});
});

describe("scoring DB-backed selection & persistence", () => {
	function makeDb() {
		const db = new Database(":memory:");
		const schema = readFileSync(
			resolve(process.cwd(), "sql/schema.sql"),
			"utf-8",
		);
		db.exec(schema);
		return db;
	}

	it("selectRepos filters by listSlug and respects resume filter", () => {
		const db = makeDb();
		const svc = createScoringService(db);
		// seed list and repos
		db.run(
			`INSERT INTO list(name, description, is_private, slug, list_id) VALUES ('AI','',0,'ai','L1')`,
		);
		db.run(`INSERT INTO repo(
			name_with_owner, url, stars, forks, watchers,
			is_archived, is_disabled, is_fork, is_mirror, has_issues_enabled,
			summary
		) VALUES
			('o/r1','u1',10,1,1,0,0,0,0,1,'summary r1'),
			('o/r2','u2',5,1,1,0,0,0,0,1,'summary r2')`);
		db.run(`INSERT INTO list_repo(list_id, repo_id) VALUES (1,1), (1,2)`);

		// no resume, by slug
		const rows1 = svc.selectRepos({ limit: 10, listSlug: "ai" }, null);
		expect(rows1.length).toBe(2);

		// create run and persist score for r1 to filter it out
		db.run(`INSERT INTO model_run(notes) VALUES ('t')`);
		const q = db
			.query<{ id: number }, []>(`SELECT MAX(id) as id FROM model_run`)
			.get();
		const runId = q ? q.id : 1;
		svc.persistScores(runId, 1, [{ list: "ai", score: 0.9 }]);

		const rows2 = svc.selectRepos({ limit: 10, listSlug: "ai" }, runId);
		expect(rows2.length).toBe(1);
		expect(rows2[0].name_with_owner).toBe("o/r2");
	});

	it("resolveRunContext covers last/no-run dry and create flow", () => {
		const db = makeDb();
		const svc = createScoringService(db);
		// resume last with dry and no runs
		const a = svc.resolveRunContext({ dry: true, resume: "last" });
		expect(a.runId).toBeNull();
		expect(a.filterRunId).toBeNull();

		// resume last without runs (non-dry) => creates run
		const b = svc.resolveRunContext({ dry: false, notes: "x", resume: "last" });
		expect(b.runId).toBeNumber();
		expect(b.filterRunId).toBe(b.runId);

		// add another run and ensure last is used
		db.run(`INSERT INTO model_run(notes) VALUES ('y')`);
		const c = svc.resolveRunContext({ dry: false, resume: "last" });
		expect(c.runId).toBeGreaterThan(b.runId as number);
		expect(c.filterRunId).toBe(c.runId);

		// numeric resume missing should throw
		expect(() =>
			svc.resolveRunContext({ dry: false, resume: 99999 }),
		).toThrow();

		// no resume: dry => inspect all
		const d = svc.resolveRunContext({ dry: true });
		expect(d.runId).toBeNull();
		expect(d.filterRunId).toBeNull();

		// no resume: non-dry => create
		const e = svc.resolveRunContext({ dry: false, notes: "z" });
		expect(e.runId).toBeNumber();
		expect(e.filterRunId).toBe(e.runId);
	});

	it("planMembership blocks when listless and no review candidate", () => {
		const svc = createScoringService();
		const current: string[] = ["old-cat"];
		const scores: ScoreItem[] = [
			{ list: "old-cat", score: 0.1 }, // removed
			{ list: "ai", score: 0.2 }, // below review threshold (<= remove)
			{ list: "learning", score: 0.3 }, // equal to remove -> not review
		];
		const res = svc.planMembership(makeRepoRow(1, 100), current, scores, {
			thresholds: { defaultAdd: 0.7, remove: 0.3 },
			avoidListless: true,
		});
		expect(res.blocked).toBeTrue();
		expect(res.blockReason).toContain("listless");
	});
});
