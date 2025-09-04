// src/features/stars.service.test.ts
import { describe, expect, it } from "bun:test";
import { createStarsService } from "@features/stars";
import { createDb } from "@lib/db";
import { VIEWER_STARS_PAGE } from "@lib/stars";
import type { StarEdge } from "@lib/types";

// test/utils/makeFakeGh.ts (reuse your shared helper)
export function makeFakeGh(
	handlers: Record<string, (vars?: Record<string, unknown>) => unknown>,
) {
	const norm = (s: string) => s.replace(/\s+/g, " ").trim();

	// normalised lookup table
	const table = new Map<string, (vars?: Record<string, unknown>) => unknown>();
	for (const [k, v] of Object.entries(handlers)) {
		table.set(norm(k), v);
	}

	// Signature compatible with githubGraphQL<T>
	return async function fakeGh<T>(
		_token: string,
		query: string,
		vars?: Record<string, unknown>,
	): Promise<T> {
		const q = norm(query);
		let h = table.get(q);

		// Fallback: allow substring match after normalisation
		if (!h) {
			for (const [k, fn] of table) {
				if (q.includes(k)) {
					h = fn;
					break;
				}
			}
		}

		if (!h) {
			throw new Error(
				`No fake handler for query:\n\n${query.slice(0, 200)}...`,
			);
		}
		return h(vars) as T;
	};
}

/* ------------------------------- fixtures -------------------------------- */

function makeEdge(
	partial: Partial<StarEdge> & { node: Partial<StarEdge["node"]> },
): StarEdge {
	return {
		starredAt: partial.starredAt ?? "2024-01-01T00:00:00Z",
		node: {
			id: partial.node.id ?? "R_id",
			nameWithOwner: partial.node.nameWithOwner ?? "o/r",
			url: partial.node.url ?? "https://x",
			description: partial.node.description ?? "d",
			homepageUrl: partial.node.homepageUrl ?? null,
			stargazerCount: partial.node.stargazerCount ?? 10,
			forkCount: partial.node.forkCount ?? 2,
			issues: partial.node.issues ?? { totalCount: 3 },
			pullRequests: partial.node.pullRequests ?? { totalCount: 4 },
			defaultBranchRef: partial.node.defaultBranchRef ?? {
				name: "main",
				target: { committedDate: "2024-01-02T00:00:00Z" },
			},
			primaryLanguage: partial.node.primaryLanguage ?? { name: "TS" },
			licenseInfo: partial.node.licenseInfo ?? { spdxId: "MIT" },
			isArchived: partial.node.isArchived ?? false,
			isDisabled: partial.node.isDisabled ?? false,
			isFork: partial.node.isFork ?? false,
			isMirror: partial.node.isMirror ?? false,
			hasIssuesEnabled: partial.node.hasIssuesEnabled ?? true,
			pushedAt: partial.node.pushedAt ?? "2024-01-03T00:00:00Z",
			updatedAt: partial.node.updatedAt ?? "2024-01-04T00:00:00Z",
			createdAt: partial.node.createdAt ?? "2023-01-01T00:00:00Z",
			repositoryTopics: partial.node.repositoryTopics ?? {
				nodes: [{ topic: { name: "x" } }, { topic: { name: "y" } }],
			},
		},
	};
}

function starsPage(
	edges: StarEdge[],
	hasNextPage: boolean,
	endCursor: string | null,
) {
	return {
		viewer: {
			starredRepositories: {
				pageInfo: { hasNextPage, endCursor },
				edges,
			},
		},
	};
}

/* ---------------------------------- tests ---------------------------------- */

describe("stars service", () => {
	it("read.getAll streams through lib and aggregates across pages", async () => {
		const db = createDb(); // not used here but keeps constructor shape stable

		const p1 = starsPage(
			[makeEdge({ node: { id: "R1", nameWithOwner: "o1/r1", url: "" } })],
			true,
			"c1",
		);
		const p2 = starsPage(
			[makeEdge({ node: { id: "R2", nameWithOwner: "o2/r2", url: "" } })],
			false,
			null,
		);

		const fakeGh = makeFakeGh({
			[VIEWER_STARS_PAGE]: (vars) => (vars?.after ? p2 : p1),
		});

		const svc = createStarsService(db, fakeGh, { token: "TEST" });
		const all = await svc.read.getAll();
		expect(all.map((r) => r.nameWithOwner)).toEqual(["o1/r1", "o2/r2"]);
	});

	it("read.getAllStream yields batches in order", async () => {
		const db = createDb();

		const p1 = starsPage(
			[makeEdge({ node: { id: "RA", nameWithOwner: "a/r", url: "" } })],
			true,
			"c1",
		);
		const p2 = starsPage(
			[makeEdge({ node: { id: "RB", nameWithOwner: "b/r", url: "" } })],
			false,
			null,
		);

		const fakeGh = makeFakeGh({
			[VIEWER_STARS_PAGE]: (vars) => (vars?.after ? p2 : p1),
		});

		const svc = createStarsService(db, fakeGh, { token: "TEST" });
		const seen: string[] = [];
		for await (const batch of svc.read.getAllStream()) {
			for (const r of batch) seen.push(r.nameWithOwner);
		}
		expect(seen).toEqual(["a/r", "b/r"]);
	});

	it("read.getReposToScore selects top N from local DB", async () => {
		const db = createDb();
		const svc = createStarsService(db);

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
		const svc = createStarsService(db, undefined, { token: "TEST" });

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
		expect([...set].sort()).toEqual(["R1"]); // only linked one returns
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

		const svc = createStarsService(db, fakeGh, { token: "TEST" });
		const unlisted = await svc.read.getUnlistedStars();

		// Expect R2, R3 only (R1 is listed locally)
		expect(unlisted.map((r) => r.repoId)).toEqual(["R2", "R3"]);
		expect(unlisted.map((r) => r.nameWithOwner)).toEqual(["o/r2", "o/r3"]);
	});
});
