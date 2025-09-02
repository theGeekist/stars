import { beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { db } from "@lib/db";
import { ingestFromExports } from "./service";

function mkTempDir(prefix = "ingest-test-") {
	const base = join(
		process.cwd(),
		`.${prefix}${Math.random().toString(36).slice(2, 8)}`,
	);
	mkdirSync(base, { recursive: true });
	return base;
}

beforeEach(() => {
	db.run("DELETE FROM list_repo");
	db.run("DELETE FROM list");
	db.run("DELETE FROM repo");
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

			const res = await ingestFromExports(dir);
			expect(res.lists).toBe(1);

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
					"SELECT COUNT(*) as c FROM list_repo INNER JOIN list ON list_repo.list_id = list.id INNER JOIN repo ON list_repo.repo_id = repo.id",
				)
				.get();
			expect(link?.c).toBe(1);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});
