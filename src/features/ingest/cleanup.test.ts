// src/features/ingest/cleanup.test.ts
import { describe, expect, test } from "bun:test";
import { createDb, initSchema } from "@lib/db";
import { createIngestService } from "./service";

function createTestRepo(
	id: number,
	repoId: string,
	name: string,
	source = "stars",
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
	test("cleanupRemovedStars removes repos no longer starred without overrides", () => {
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

		// Run cleanup with current starred set that doesn't include our test repo
		const currentStarIds = new Set(["R_keep1", "R_keep2"]);
		service.cleanupRemovedStars(currentStarIds);

		// Verify repo was removed
		const afterCleanup = db
			.query(`SELECT * FROM repo WHERE repo_id = 'R_removed'`)
			.all();
		expect(afterCleanup).toHaveLength(0);
	});

	test("cleanupRemovedStars preserves repos with repo_overrides", () => {
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

		// Run cleanup with current starred set that doesn't include our test repo
		const currentStarIds = new Set(["R_keep1", "R_keep2"]);
		service.cleanupRemovedStars(currentStarIds);

		// Verify repo was preserved due to override
		const afterCleanup = db
			.query(`SELECT * FROM repo WHERE repo_id = 'R_preserved'`)
			.all();
		expect(afterCleanup).toHaveLength(1);
	});

	test("cleanupRemovedStars preserves currently starred repos", () => {
		const db = setupTestDb();
		const service = createIngestService(db);

		// Insert test repo
		db.run(`
			INSERT INTO repo (id, repo_id, name_with_owner, url, description, stars, created_at, updated_at)
			VALUES (1, 'R_starred', 'test/starred-repo', 'https://github.com/test/starred-repo', 'Test repo', 5, '2024-01-01T00:00:00Z', '2024-01-01T00:00:00Z')
		`);

		// Run cleanup including our test repo in current stars
		const currentStarIds = new Set(["R_starred", "R_other"]);
		service.cleanupRemovedStars(currentStarIds);

		// Verify repo was preserved because it's still starred
		const afterCleanup = db
			.query(`SELECT * FROM repo WHERE repo_id = 'R_starred'`)
			.all();
		expect(afterCleanup).toHaveLength(1);
	});

	test("cleanupRemovedStars removes repo from lists before deleting", () => {
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
		const currentStarIds = new Set(["R_other"]);
		service.cleanupRemovedStars(currentStarIds);

		// Verify both repo and list link were removed
		const reposAfter = db.query(`SELECT * FROM repo WHERE id = 1`).all();
		const linksAfter = db
			.query(`SELECT * FROM list_repo WHERE repo_id = 1`)
			.all();

		expect(reposAfter).toHaveLength(0);
		expect(linksAfter).toHaveLength(0);
	});

	test("cleanupRemovedStars handles repos with null repo_id safely", () => {
		const db = setupTestDb();
		const service = createIngestService(db);

		// Insert repo with null repo_id (manual entry)
		db.run(`
			INSERT INTO repo (id, name_with_owner, url, description, stars, created_at, updated_at)
			VALUES (1, 'manual/entry', 'https://github.com/manual/entry', 'Manual entry', 0, '2024-01-01T00:00:00Z', '2024-01-01T00:00:00Z')
		`);

		// Should not throw and should preserve manual entry
		const currentStarIds = new Set(["R_other"]);
		expect(() => service.cleanupRemovedStars(currentStarIds)).not.toThrow();

		// Verify manual entry was preserved
		const afterCleanup = db
			.query(`SELECT * FROM repo WHERE name_with_owner = 'manual/entry'`)
			.all();
		expect(afterCleanup).toHaveLength(1);
	});

	test("cleanupRemovedStars returns summary of actions taken", () => {
		const db = setupTestDb();
		const service = createIngestService(db);

		// Insert repos: one to remove, one to preserve with overrides, one still starred
		db.run(`
			INSERT INTO repo (id, repo_id, name_with_owner, url, description, stars, created_at, updated_at)
			VALUES 
			(1, 'R_remove', 'test/remove', 'https://github.com/test/remove', 'Remove me', 5, '2024-01-01T00:00:00Z', '2024-01-01T00:00:00Z'),
			(2, 'R_preserve', 'test/preserve', 'https://github.com/test/preserve', 'Preserve me', 3, '2024-01-01T00:00:00Z', '2024-01-01T00:00:00Z'),
			(3, 'R_starred', 'test/starred', 'https://github.com/test/starred', 'Still starred', 10, '2024-01-01T00:00:00Z', '2024-01-01T00:00:00Z')
		`);

		// Add override for preservation
		db.run(`
			INSERT INTO repo_overrides (repo_id, summary_override, updated_at)
			VALUES (2, 'Custom summary', '2024-01-01T00:00:00Z')
		`);

		const currentStarIds = new Set(["R_starred", "R_other"]);
		const result = service.cleanupRemovedStars(currentStarIds);

		expect(result.removed).toBe(1);
		expect(result.preserved).toBe(1);
		expect(result.checkedCount).toBe(2);
	});

	test("cleanupRemovedStars handles empty database gracefully", () => {
		const db = setupTestDb();
		const service = createIngestService(db);

		const currentStarIds = new Set(["R_any"]);
		const result = service.cleanupRemovedStars(currentStarIds);

		expect(result.removed).toBe(0);
		expect(result.preserved).toBe(0);
		expect(result.checkedCount).toBe(0);
	});
});
