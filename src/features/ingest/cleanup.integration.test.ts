// Test that the new export-based cleanup works in ingestFromExports
import { describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createIngestService } from "@features/ingest/service";
import { createDb, initSchema } from "@lib/db";

describe("export-based cleanup integration", () => {
	test("ingestFromExports automatically cleans up repos not in export files", async () => {
		const db = createDb(":memory:");
		initSchema(db);
		const service = createIngestService({ db });

		// Create a temporary export directory
		const tempDir = await mkdtemp(join(tmpdir(), "stars-test-"));

		// Add initial repo to database
		db.run(`
			INSERT INTO repo (id, repo_id, name_with_owner, url, description, stars, created_at, updated_at)
			VALUES (1, 'R_old', 'user/old-repo', 'https://github.com/user/old-repo', 'Old repo', 5, '2024-01-01T00:00:00Z', '2024-01-01T00:00:00Z')
		`);

		// Create export files with different repos (simulating export files being updated)
		await writeFile(
			join(tempDir, "index.json"),
			JSON.stringify([
				{
					name: "New List",
					description: "A new list",
					isPrivate: false,
					file: "new-list.json",
					listId: "new-list",
				},
			]),
		);

		await writeFile(
			join(tempDir, "new-list.json"),
			JSON.stringify({
				name: "New List",
				description: "A new list",
				isPrivate: false,
				repos: [
					{
						nameWithOwner: "user/new-repo",
						url: "https://github.com/user/new-repo",
						description: "New repo",
						homepageUrl: null,
						stars: 10,
						forks: 2,
						watchers: 8,
						openIssues: 1,
						openPRs: 0,
						defaultBranch: "main",
						lastCommitISO: "2024-01-01T00:00:00Z",
						lastReleaseISO: null,
						topics: [],
						primaryLanguage: "TypeScript",
						languages: [{ name: "TypeScript", bytes: 1000 }],
						license: "MIT",
						isArchived: false,
						isDisabled: false,
						isFork: false,
						isMirror: false,
						hasIssuesEnabled: true,
						pushedAt: "2024-01-01T00:00:00Z",
						updatedAt: "2024-01-01T00:00:00Z",
						createdAt: "2024-01-01T00:00:00Z",
						diskUsage: 100,
					},
				],
			}),
		);

		await writeFile(join(tempDir, "unlisted.json"), JSON.stringify([]));

		// Verify old repo exists before ingest
		const beforeIngest = db
			.query(`SELECT * FROM repo WHERE repo_id = 'R_old'`)
			.all();
		expect(beforeIngest).toHaveLength(1);

		// Run ingestFromExports - this should automatically cleanup old repos
		await service.ingestFromExports(tempDir);

		// Verify old repo was cleaned up and new repo was added
		const afterIngest = db
			.query(`SELECT name_with_owner FROM repo ORDER BY name_with_owner`)
			.all();
		expect(afterIngest).toHaveLength(1);
		expect(afterIngest[0]).toMatchObject({ name_with_owner: "user/new-repo" });

		// Cleanup
		await rm(tempDir, { recursive: true, force: true });
	});
});
