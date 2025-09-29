// src/features/stars.service.test.ts
import { describe, expect, it } from "bun:test";
import {
	createStarsServiceInternal,
	type StarsApi,
} from "@features/stars/service";
import { createDb } from "@lib/db";
import * as starsLib from "@lib/stars";
import { makeEdge, starsPage, VIEWER_STARS_PAGE } from "@lib/stars";
import { compareAlpha } from "@lib/utils";
import { makeFakeGh } from "@src/__test__/github-fakes";

/* ---------------------------------- helpers --------------------------------- */

function makeFakeApi(batches: string[][]): StarsApi {
	return {
		async getAllStars() {
			return batches.flat().map((name, i) => ({
				repoId: `R${i}`,
				nameWithOwner: name,
				url: "",
				stars: 0,
				forks: 0,
				openIssues: 0,
				openPRs: 0,
				primaryLanguage: null,
				languages: [],
				license: null,
				topics: [],
				defaultBranch: "main",
				lastCommitISO: undefined,
				description: null,
				homepageUrl: null,
				isArchived: false,
				isDisabled: false,
				isFork: false,
				isMirror: false,
				hasIssuesEnabled: true,
				watchers: 0,
				pushedAt: "",
				updatedAt: "",
				createdAt: "",
			}));
		},
		async *getAllStarsStream() {
			for (const b of batches) {
				yield b.map((name, i) => ({
					repoId: `RB${i}`,
					nameWithOwner: name,
					url: "",
					stars: 0,
					forks: 0,
					openIssues: 0,
					openPRs: 0,
					primaryLanguage: null,
					license: null,
					topics: [],
					defaultBranch: "main",
					languages: [],
					lastCommitISO: undefined,
					description: null,
					homepageUrl: null,
					isArchived: false,
					isDisabled: false,
					isFork: false,
					isMirror: false,
					hasIssuesEnabled: true,
					watchers: 0,
					pushedAt: "",
					updatedAt: "",
					createdAt: "",
				}));
			}
		},
		async collectStarIdsSet() {
			return new Set<string>(["R1", "R2"]);
		},
	};
}

/* ---------------------------------- tests ---------------------------------- */

describe("stars service — delegation (no pagination duplication)", () => {
	it("read.getAll delegates to lib and returns combined list", async () => {
		const db = createDb();
		const svc = createStarsServiceInternal(
			makeFakeApi([["o1/r1"], ["o2/r2"]]),
			db,
			undefined,
			{ token: "T" },
		);
		const all = await svc.read.getAll();
		expect(all.map((r) => r.nameWithOwner)).toEqual(["o1/r1", "o2/r2"]);
	});

	it("read.getAllStream yields batches passed through from lib", async () => {
		const db = createDb();
		const svc = createStarsServiceInternal(
			makeFakeApi([["a/r"], ["b/r"]]),
			db,
			undefined,
			{ token: "T" },
		);
		const seen: string[] = [];
		for await (const batch of svc.read.getAllStream()) {
			for (const r of batch) seen.push(r.nameWithOwner);
		}
		expect(seen).toEqual(["a/r", "b/r"]);
	});
});

describe("stars service — DB-centric behaviour", () => {
	it("read.getReposToScore selects top N from local DB", async () => {
		const db = createDb();
		// use real api surface; GH client not needed here
		const svc = createStarsServiceInternal(starsLib, db);

		// Seed local repo table (no lists linkage required)
		db.run(`
      INSERT INTO repo(name_with_owner, url, stars, forks, watchers, is_archived, is_disabled, is_fork, is_mirror, has_issues_enabled, popularity, freshness)
      VALUES
      ('o/r1','u1',50,1,1,0,0,0,0,1, 10, 5),
      ('o/r2','u2',10,1,1,0,0,0,0,1,  5, 3)
    `);

		const rows = await svc.read.getReposToScore({ limit: 1 });
		expect(rows.length).toBe(1);
		expect(rows[0].name_with_owner).toBe("o/r1"); // highest popularity first
	});

	it("read.collectLocallyListedRepoIdsSet returns GH node ids linked via lists", async () => {
		const db = createDb();
		const svc = createStarsServiceInternal(starsLib, db, undefined, {
			token: "TEST",
		});

		// list table and repo table with GH node ids, link one repo via list_repo
		db.run(
			`INSERT INTO list(name, description, is_private, slug, list_id) VALUES ('AI','',0,'ai','L1')`,
		);
		db.run(`
      INSERT INTO repo(repo_id, name_with_owner, url, stars, forks, watchers, is_archived, is_disabled, is_fork, is_mirror, has_issues_enabled)
      VALUES
      ('R1','o/r1','u1',0,0,0,0,0,0,0,1),
      ('R2','o/r2','u2',0,0,0,0,0,0,0,1)
    `);
		db.run(`INSERT INTO list_repo(list_id, repo_id) VALUES (1, 1)`); // only R1 is listed

		const set = await svc.read.collectLocallyListedRepoIdsSet();
		expect([...set].toSorted(compareAlpha)).toEqual(["R1"]); // only linked one returns
	});

	it("read.getUnlistedStars diffs GH stars vs local listed set", async () => {
		const db = createDb();

		// Locally, repo R1 exists and is in a list; R2/R3 are unknown locally (should be considered unlisted)
		db.run(
			`INSERT INTO list(name, description, is_private, slug, list_id) VALUES ('AI','',0,'ai','L1')`,
		);
		db.run(`
      INSERT INTO repo(repo_id, name_with_owner, url, stars, forks, watchers, is_archived, is_disabled, is_fork, is_mirror, has_issues_enabled)
      VALUES ('R1','o/r1','u1',0,0,0,0,0,0,0,1)
    `);
		db.run(`INSERT INTO list_repo(list_id, repo_id) VALUES (1, 1)`);

		// GH returns stars for R1, R2, R3 (R1 should be filtered out as it's locally listed)
		const p1 = starsPage(
			[
				makeEdge({ node: { id: "R1", nameWithOwner: "o/r1", url: "" } }),
				makeEdge({ node: { id: "R2", nameWithOwner: "o/r2", url: "" } }),
			],
			true,
			"c1",
		);
		const p2 = starsPage(
			[makeEdge({ node: { id: "R3", nameWithOwner: "o/r3", url: "" } })],
			false,
			null,
		);

		const fakeGh = makeFakeGh({
			[VIEWER_STARS_PAGE]: (vars) => (vars?.after ? p2 : p1),
		});

		// Use real lib for stream diffing, but inject GH client & token
		const svc = createStarsServiceInternal(starsLib, db, fakeGh, {
			token: "TEST",
		});
		const unlisted = await svc.read.getUnlistedStars();

		// Expect R2, R3 only (R1 is listed locally)
		expect(unlisted.map((r) => r.repoId)).toEqual(["R2", "R3"]);
		expect(unlisted.map((r) => r.nameWithOwner)).toEqual(["o/r2", "o/r3"]);
	});
});
