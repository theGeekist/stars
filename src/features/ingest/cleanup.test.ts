// src/features/ingest/cleanup.test.ts
import { describe, expect, test } from "bun:test";
import { createDb, initSchema } from "@lib/db";
import { createIngestService } from "./service";

function _createTestRepo(
	id: number,
	repoId: string,
	name: string,
	_source = "stars",
) {
	return {
		id,
		repoId,
		nameWithOwner: name,
		url: `https://github.com/${name}`,
		description: "Test repo",
		homepageUrl: null,
		stars: 1,
		forks: 0,
		watchers: 0,
		openIssues: 0,
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
	};
}

function setupTestDb() {
	const db = createDb(":memory:");
	initSchema(db);
	return db;
}

describe("ingest service cleanup functionality", () => {
	test("cleanupRemovedFromExports removes repos no longer in exports without overrides", () => {
		const db = setupTestDb();
		const service = createIngestService(db);

		// Insert test repo
		db.run(`
			INSERT INTO repo (id, repo_id, name_with_owner, url, description, stars, created_at, updated_at)
			VALUES (1, 'R_removed', 'test/removed-repo', 'https://github.com/test/removed-repo', 'Test repo', 5, '2024-01-01T00:00:00Z', '2024-01-01T00:00:00Z')
		`);

		// Verify repo exists before cleanup
		const beforeCleanup = db
			.query(`SELECT * FROM repo WHERE repo_id = 'R_removed'`)
			.all();
		expect(beforeCleanup).toHaveLength(1);

		// Run cleanup with current export repos that doesn't include our test repo
		const currentExportRepos = new Set(["test/keep-repo1", "test/keep-repo2"]);
		service.cleanupRemovedFromExports(currentExportRepos);

		// Verify repo was removed
		const afterCleanup = db
			.query(`SELECT * FROM repo WHERE repo_id = 'R_removed'`)
			.all();
		expect(afterCleanup).toHaveLength(0);
	});

	test("cleanupRemovedFromExports preserves repos with repo_overrides", () => {
		const db = setupTestDb();
		const service = createIngestService(db);

		// Insert test repo
		db.run(`
			INSERT INTO repo (id, repo_id, name_with_owner, url, description, stars, created_at, updated_at)
			VALUES (1, 'R_preserved', 'test/preserved-repo', 'https://github.com/test/preserved-repo', 'Test repo', 5, '2024-01-01T00:00:00Z', '2024-01-01T00:00:00Z')
		`);

		// Add repo override
		db.run(`
			INSERT INTO repo_overrides (repo_id, summary_override, updated_at)
			VALUES (1, 'Custom summary', '2024-01-01T00:00:00Z')
		`);

		// Run cleanup with current export repos that doesn't include our test repo
		const currentExportRepos = new Set(["test/keep-repo1", "test/keep-repo2"]);
		service.cleanupRemovedFromExports(currentExportRepos);

		// Verify repo was preserved due to override
		const afterCleanup = db
			.query(`SELECT * FROM repo WHERE repo_id = 'R_preserved'`)
			.all();
		expect(afterCleanup).toHaveLength(1);
	});

	test("cleanupRemovedFromExports preserves currently exported repos", () => {
		const db = setupTestDb();
		const service = createIngestService(db);

		// Insert test repo
		db.run(`
			INSERT INTO repo (id, repo_id, name_with_owner, url, description, stars, created_at, updated_at)
			VALUES (1, 'R_starred', 'test/starred-repo', 'https://github.com/test/starred-repo', 'Test repo', 5, '2024-01-01T00:00:00Z', '2024-01-01T00:00:00Z')
		`);

		// Run cleanup including our test repo in current exports
		const currentExportRepos = new Set([
			"test/starred-repo",
			"test/other-repo",
		]);
		service.cleanupRemovedFromExports(currentExportRepos);

		// Verify repo was preserved because it's still in exports
		const afterCleanup = db
			.query(`SELECT * FROM repo WHERE repo_id = 'R_starred'`)
			.all();
		expect(afterCleanup).toHaveLength(1);
	});

	test("cleanupRemovedFromExports removes repo from lists before deleting", () => {
		const db = setupTestDb();
		const service = createIngestService(db);

		// Insert test repo and list
		db.run(`
			INSERT INTO repo (id, repo_id, name_with_owner, url, description, stars, created_at, updated_at)
			VALUES (1, 'R_linked', 'test/linked-repo', 'https://github.com/test/linked-repo', 'Test repo', 5, '2024-01-01T00:00:00Z', '2024-01-01T00:00:00Z')
		`);

		db.run(`
			INSERT INTO list (id, list_id, name, slug, description, is_private)
			VALUES (1, 'test-list-id', 'Test List', 'test-list', 'Test list', 0)
		`);

		db.run(`
			INSERT INTO list_repo (list_id, repo_id) VALUES (1, 1)
		`);

		// Verify link exists before cleanup
		const beforeCleanup = db
			.query(`SELECT * FROM list_repo WHERE repo_id = 1`)
			.all();
		expect(beforeCleanup).toHaveLength(1);

		// Run cleanup
		const currentExportRepos = new Set(["test/other-repo"]);
		service.cleanupRemovedFromExports(currentExportRepos);

		// Verify both repo and list link were removed
		const reposAfter = db.query(`SELECT * FROM repo WHERE id = 1`).all();
		const linksAfter = db
			.query(`SELECT * FROM list_repo WHERE repo_id = 1`)
			.all();

		expect(reposAfter).toHaveLength(0);
		expect(linksAfter).toHaveLength(0);
	});

	test("cleanupRemovedFromExports handles repos with null repo_id safely", () => {
		const db = setupTestDb();
		const service = createIngestService(db);

		// Insert repo with null repo_id (manual entry)
		db.run(`
			INSERT INTO repo (id, name_with_owner, url, description, stars, created_at, updated_at)
			VALUES (1, 'manual/entry', 'https://github.com/manual/entry', 'Manual entry', 0, '2024-01-01T00:00:00Z', '2024-01-01T00:00:00Z')
		`);

		// Should not throw and should preserve manual entry
		const currentExportRepos = new Set(["test/other-repo"]);
		expect(() =>
			service.cleanupRemovedFromExports(currentExportRepos),
		).not.toThrow();

		// Verify manual entry was preserved
		const afterCleanup = db
			.query(`SELECT * FROM repo WHERE name_with_owner = 'manual/entry'`)
			.all();
		expect(afterCleanup).toHaveLength(1);
	});

	test("cleanupRemovedFromExports returns summary of actions taken", () => {
		const db = setupTestDb();
		const service = createIngestService(db);

		// Insert repos: one to remove, one to preserve with overrides, one still in exports
		db.run(`
			INSERT INTO repo (id, repo_id, name_with_owner, url, description, stars, created_at, updated_at)
			VALUES 
			(1, 'R_remove', 'test/remove', 'https://github.com/test/remove', 'Remove me', 5, '2024-01-01T00:00:00Z', '2024-01-01T00:00:00Z'),
			(2, 'R_preserve', 'test/preserve', 'https://github.com/test/preserve', 'Preserve me', 3, '2024-01-01T00:00:00Z', '2024-01-01T00:00:00Z'),
			(3, 'R_exported', 'test/exported', 'https://github.com/test/exported', 'Still exported', 10, '2024-01-01T00:00:00Z', '2024-01-01T00:00:00Z')
		`);

		// Add override for preservation
		db.run(`
			INSERT INTO repo_overrides (repo_id, summary_override, updated_at)
			VALUES (2, 'Custom summary', '2024-01-01T00:00:00Z')
		`);

		const currentExportRepos = new Set(["test/exported", "test/other-repo"]);
		const result = service.cleanupRemovedFromExports(currentExportRepos);

		expect(result.removed).toBe(1);
		expect(result.preserved).toBe(1);
		expect(result.checkedCount).toBe(2);
	});

	test("cleanupRemovedFromExports handles empty database gracefully", () => {
		const db = setupTestDb();
		const service = createIngestService(db);

		const currentExportRepos = new Set(["test/any-repo"]);
		const result = service.cleanupRemovedFromExports(currentExportRepos);

		expect(result.removed).toBe(0);
		expect(result.preserved).toBe(0);
		expect(result.checkedCount).toBe(0);
	});
});
