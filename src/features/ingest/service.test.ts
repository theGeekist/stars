// src/features/ingest/service.test.ts
import { beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createDb, initSchema } from "@lib/db";
import { randBase36 } from "@lib/rand";
import { createIngestService } from "./service";

function mkTempDir(prefix = "ingest-test-") {
	const base = join(process.cwd(), `.${prefix}${randBase36(6)}`);
	mkdirSync(base, { recursive: true });
	return base;
}

// Use ONE in-memory DB for all tests and pass it into the service.
const db = createDb();
initSchema(db);
const ingest = createIngestService(db);

beforeEach(() => {
	db.run("DELETE FROM list_repo");
	db.run("DELETE FROM repo_list_score");
	db.run("DELETE FROM model_run");
	db.run("DELETE FROM repo");
	db.run("DELETE FROM list");
	db.run("DELETE FROM repo_topics");
	db.run("DELETE FROM topics");
});

describe("ingestFromExports", () => {
	it("reads index + list files and upserts lists, repos, and links", async () => {
		const dir = mkTempDir();
		try {
			const index = [
				{
					listId: "L_AI",
					name: "AI",
					description: "Artificial Intelligence",
					isPrivate: false,
					count: 1,
					file: "ai.json",
				},
			];
			writeFileSync(join(dir, "index.json"), JSON.stringify(index, null, 2));

			const list = {
				listId: "L_AI",
				name: "AI",
				description: "Artificial Intelligence",
				isPrivate: false,
				repos: [
					{
						repoId: "R1",
						nameWithOwner: "owner/repo",
						url: "https://example.com",
						description: "desc",
						homepageUrl: null,
						stars: 10,
						forks: 2,
						watchers: 3,
						openIssues: 1,
						openPRs: 0,
						defaultBranch: "main",
						lastCommitISO: "2024-01-01T00:00:00Z",
						lastRelease: null,
						topics: ["ml"],
						primaryLanguage: "TS",
						languages: [{ name: "TypeScript", bytes: 100 }],
						license: "MIT",
						isArchived: false,
						isDisabled: false,
						isFork: false,
						isMirror: false,
						hasIssuesEnabled: true,
						pushedAt: "2024-01-02T00:00:00Z",
						updatedAt: "2024-01-03T00:00:00Z",
						createdAt: "2023-01-01T00:00:00Z",
						diskUsage: 123,
					},
				],
			};
			writeFileSync(join(dir, "ai.json"), JSON.stringify(list, null, 2));

			const res = await ingest.ingestFromExports(dir);
			expect(res).toEqual({ lists: 1, reposFromLists: 1, unlisted: 0 });

			const lists = db
				.query<{ slug: string; list_id: string | null }, []>(
					"SELECT slug, list_id FROM list",
				)
				.all();
			expect(lists).toEqual([{ slug: "ai", list_id: "L_AI" }]);

			const repos = db
				.query<
					{
						name_with_owner: string;
						url: string;
						topics: string | null;
						tags: string | null;
						primary_language: string | null;
					},
					[]
				>(
					"SELECT name_with_owner, url, topics, tags, primary_language FROM repo",
				)
				.all();
			expect(repos.length).toBe(1);
			const r = repos[0];
			expect(r.name_with_owner).toBe("owner/repo");
			expect(r.url).toBe("https://example.com");
			expect(r.primary_language).toBe("TS");
			expect(r.topics && JSON.parse(r.topics)).toEqual(["ml"]);
			expect(r.tags && JSON.parse(r.tags)).toContain("lang:ts");

			const link = db
				.query<{ c: number }, []>(
					`SELECT COUNT(*) as c
           FROM list_repo
           INNER JOIN list ON list_repo.list_id = list.id
           INNER JOIN repo ON list_repo.repo_id = repo.id`,
				)
				.get();
			expect(link?.c).toBe(1);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});

describe("ingestFromExports (unlisted)", () => {
	it("upserts repos from unlisted.json without creating list links", async () => {
		const dir = mkTempDir();
		try {
			// no index.json on purpose
			const unlisted = [
				{
					repoId: "RU1",
					nameWithOwner: "ul/one",
					url: "https://u/one",
					description: "unlisted one",
					homepageUrl: null,
					stars: 1,
					forks: 0,
					watchers: 0,
					openIssues: 0,
					openPRs: 0,
					defaultBranch: null,
					lastCommitISO: null,
					lastRelease: null,
					topics: ["misc"],
					primaryLanguage: "TS",
					languages: [{ name: "TypeScript", bytes: 10 }],
					license: null,
					isArchived: false,
					isDisabled: false,
					isFork: false,
					isMirror: false,
					hasIssuesEnabled: true,
					pushedAt: "2024-01-01T00:00:00Z",
					updatedAt: "2024-01-02T00:00:00Z",
					createdAt: "2023-01-01T00:00:00Z",
					diskUsage: 123,
				},
			];
			writeFileSync(
				join(dir, "unlisted.json"),
				JSON.stringify(unlisted, null, 2),
			);

			const res = await ingest.ingestFromExports(dir);
			expect(res).toEqual({ lists: 0, reposFromLists: 0, unlisted: 1 });

			// repo inserted…
			const repos = db
				.query<{ name_with_owner: string; repo_id: string | null }, []>(
					"SELECT name_with_owner, repo_id FROM repo",
				)
				.all();
			expect(repos).toEqual([{ name_with_owner: "ul/one", repo_id: "RU1" }]);

			// …but no list links created
			const linkCount = db
				.query<{ c: number }, []>("SELECT COUNT(*) AS c FROM list_repo")
				.get();
			expect(linkCount?.c).toBe(0);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("imports lists and unlisted together; links only for list repos", async () => {
		const dir = mkTempDir();
		try {
			// index + one list with one repo (RL1)
			const index = [
				{
					listId: "L_AI",
					name: "AI",
					description: "Artificial Intelligence",
					isPrivate: false,
					count: 1,
					file: "ai.json",
				},
			];
			writeFileSync(join(dir, "index.json"), JSON.stringify(index, null, 2));

			const list = {
				listId: "L_AI",
				name: "AI",
				description: "Artificial Intelligence",
				isPrivate: false,
				repos: [
					{
						repoId: "RL1",
						nameWithOwner: "owner/repo-listed",
						url: "https://example.com/rl1",
						description: "listed",
						homepageUrl: null,
						stars: 10,
						forks: 2,
						watchers: 3,
						openIssues: 1,
						openPRs: 0,
						defaultBranch: "main",
						lastCommitISO: "2024-01-01T00:00:00Z",
						lastRelease: null,
						topics: ["ml"],
						primaryLanguage: "TS",
						languages: [{ name: "TypeScript", bytes: 100 }],
						license: "MIT",
						isArchived: false,
						isDisabled: false,
						isFork: false,
						isMirror: false,
						hasIssuesEnabled: true,
						pushedAt: "2024-01-02T00:00:00Z",
						updatedAt: "2024-01-03T00:00:00Z",
						createdAt: "2023-01-01T00:00:00Z",
						diskUsage: 123,
					},
				],
			};
			writeFileSync(join(dir, "ai.json"), JSON.stringify(list, null, 2));

			// unlisted repo (RU1) should NOT create list_repo links
			const unlisted = [
				{
					repoId: "RU1",
					nameWithOwner: "owner/repo-unlisted",
					url: "https://example.com/ru1",
					description: "unlisted",
					homepageUrl: null,
					stars: 5,
					forks: 1,
					watchers: 0,
					openIssues: 0,
					openPRs: 0,
					defaultBranch: null,
					lastCommitISO: null,
					lastRelease: null,
					topics: [],
					primaryLanguage: null,
					languages: [],
					license: null,
					isArchived: false,
					isDisabled: false,
					isFork: false,
					isMirror: false,
					hasIssuesEnabled: true,
					pushedAt: "2024-02-01T00:00:00Z",
					updatedAt: "2024-02-02T00:00:00Z",
					createdAt: "2023-02-01T00:00:00Z",
					diskUsage: null,
				},
			];
			writeFileSync(
				join(dir, "unlisted.json"),
				JSON.stringify(unlisted, null, 2),
			);

			const res = await ingest.ingestFromExports(dir);
			expect(res).toEqual({ lists: 1, reposFromLists: 1, unlisted: 1 });

			// both repos present
			const names = db
				.query<{ name_with_owner: string }, []>(
					"SELECT name_with_owner FROM repo ORDER BY name_with_owner",
				)
				.all()
				.map((r) => r.name_with_owner);
			expect(names).toEqual(["owner/repo-listed", "owner/repo-unlisted"]);

			// exactly one link (for the listed repo)
			const linkCount = db
				.query<{ c: number }, []>("SELECT COUNT(*) AS c FROM list_repo")
				.get();
			expect(linkCount?.c).toBe(1);

			// sanity: ensure the linked repo is the listed one
			const linkedNames = db
				.query<{ name_with_owner: string }, []>(`
          SELECT r.name_with_owner
          FROM list_repo lr
          JOIN repo r ON r.id = lr.repo_id
          ORDER BY r.name_with_owner
        `)
				.all()
				.map((r) => r.name_with_owner);
			expect(linkedNames).toEqual(["owner/repo-listed"]);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});

/**
 * Merge path test:
 * 1) Import list with legacy name-only repo (no repoId).
 * 2) Import unlisted with repoId but a different name → creates a second row by repo_id.
 * 3) Re-import list but now with the repoId and the OLD legacy name → merge happens:
 *    - links move to the repo_id row
 *    - legacy row is deleted
 *    - final row has repo_id and takes the last provided name (old one in this case).
 */
describe("ingestFromExports (merge legacy name row into repo_id row)", () => {
	it("merges via repo_id and moves links", async () => {
		const dir = mkTempDir();
		try {
			// Step 1: list import with NO repoId (legacy)
			const index = [
				{
					listId: "L_AI",
					name: "AI",
					description: "",
					isPrivate: false,
					count: 1,
					file: "ai.json",
				},
			];
			writeFileSync(join(dir, "index.json"), JSON.stringify(index, null, 2));
			const legacyList = {
				listId: "L_AI",
				name: "AI",
				description: "",
				isPrivate: false,
				repos: [
					{
						// repoId intentionally omitted
						nameWithOwner: "owner/legacy",
						url: "https://ex/legacy",
						description: null,
						homepageUrl: null,
						stars: 0,
						forks: 0,
						watchers: 0,
						openIssues: 0,
						openPRs: 0,
						defaultBranch: null,
						lastCommitISO: null,
						lastRelease: null,
						topics: [],
						primaryLanguage: null,
						languages: [],
						license: null,
						isArchived: false,
						isDisabled: false,
						isFork: false,
						isMirror: false,
						hasIssuesEnabled: true,
						pushedAt: null,
						updatedAt: null,
						createdAt: null,
						diskUsage: null,
					},
				],
			};
			writeFileSync(join(dir, "ai.json"), JSON.stringify(legacyList, null, 2));

			let res = await ingest.ingestFromExports(dir);
			expect(res).toEqual({ lists: 1, reposFromLists: 1, unlisted: 0 });

			// Confirm 1 repo and 1 link
			let counts = db
				.query<{ repos: number; links: number }, []>(`
          SELECT (SELECT COUNT(*) FROM repo) AS repos,
                 (SELECT COUNT(*) FROM list_repo) AS links
        `)
				.get();
			expect(counts?.repos).toBe(1);
			expect(counts?.links).toBe(1);

			// Step 2: unlisted import with repoId and a different name (creates second row)
			const unlistedV1 = [
				{
					repoId: "RZ",
					nameWithOwner: "owner/renamed",
					url: "https://ex/renamed",
					description: "renamed",
					homepageUrl: null,
					stars: 1,
					forks: 0,
					watchers: 0,
					openIssues: 0,
					openPRs: 0,
					defaultBranch: null,
					lastCommitISO: null,
					lastRelease: null,
					topics: [],
					primaryLanguage: null,
					languages: [],
					license: null,
					isArchived: false,
					isDisabled: false,
					isFork: false,
					isMirror: false,
					hasIssuesEnabled: true,
					pushedAt: null,
					updatedAt: null,
					createdAt: null,
					diskUsage: null,
				},
			];
			writeFileSync(
				join(dir, "unlisted.json"),
				JSON.stringify(unlistedV1, null, 2),
			);

			res = await ingest.ingestFromExports(dir);
			expect(res.unlisted).toBe(1);

			// Now expect 2 repos: legacy (by name) + new (by repo_id)
			counts = db
				.query<{ repos: number; links: number }, []>(`
          SELECT (SELECT COUNT(*) FROM repo) AS repos,
                 (SELECT COUNT(*) FROM list_repo) AS links
        `)
				.get();
			expect(counts?.repos).toBe(2);
			expect(counts?.links).toBe(1); // link still on legacy row

			// Step 3: re-import list with the SAME old name but now with repoId → triggers merge
			const listMerged = {
				listId: "L_AI",
				name: "AI",
				description: "",
				isPrivate: false,
				repos: [
					{
						repoId: "RZ", // now present
						nameWithOwner: "owner/legacy", // old name -> matches legacy row
						url: "https://ex/legacy",
						description: null,
						homepageUrl: null,
						stars: 2,
						forks: 0,
						watchers: 0,
						openIssues: 0,
						openPRs: 0,
						defaultBranch: null,
						lastCommitISO: null,
						lastRelease: null,
						topics: [],
						primaryLanguage: null,
						languages: [],
						license: null,
						isArchived: false,
						isDisabled: false,
						isFork: false,
						isMirror: false,
						hasIssuesEnabled: true,
						pushedAt: null,
						updatedAt: null,
						createdAt: null,
						diskUsage: null,
					},
				],
			};
			writeFileSync(join(dir, "ai.json"), JSON.stringify(listMerged, null, 2));

			res = await ingest.ingestFromExports(dir);
			expect(res).toEqual({ lists: 1, reposFromLists: 1, unlisted: 1 });

			// After merge: only one repo remains, it has repo_id "RZ" and name "owner/legacy"
			const rows = db
				.query<{ name_with_owner: string; repo_id: string | null }, []>(
					"SELECT name_with_owner, repo_id FROM repo ORDER BY name_with_owner",
				)
				.all();
			expect(rows).toEqual([
				{ name_with_owner: "owner/legacy", repo_id: "RZ" },
			]);

			// list link survived and now points to the merged (repo_id) row
			const linkNames = db
				.query<{ name_with_owner: string }, []>(`
          SELECT r.name_with_owner
          FROM list_repo lr
          JOIN repo r ON r.id = lr.repo_id
        `)
				.all()
				.map((r) => r.name_with_owner);
			expect(linkNames).toEqual(["owner/legacy"]);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});
