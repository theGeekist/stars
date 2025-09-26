// src/features/ingest/cleanup.integration.test.ts
import { describe, expect, test } from "bun:test";
import { createDb, initSchema } from "@lib/db";
import { createStarsService, type StarsApi } from "@features/stars/service";
import { createIngestService } from "./service";
import { makeLogWithLines } from "@src/__test__/helpers/log";
import { makeFakeGh } from "@src/__test__/github-fakes";

/**
 * Integration tests that verify cleanup works within the broader ingest flow
 * using proper dependency injection and mocking patterns
 */

function setupTestDb() {
	const db = createDb(":memory:");
	initSchema(db);
	return db;
}

function setupTestData(db: any) {
	// Insert repos that represent different scenarios
	db.run(`
		INSERT INTO repo (id, repo_id, name_with_owner, url, description, stars, created_at, updated_at) VALUES
		(1, 'R_still_starred', 'user/still-starred', 'https://github.com/user/still-starred', 'Still starred', 10, '2024-01-01T00:00:00Z', '2024-01-01T00:00:00Z'),
		(2, 'R_unstarred_safe', 'user/unstarred-safe', 'https://github.com/user/unstarred-safe', 'Unstarred but safe to remove', 5, '2024-01-01T00:00:00Z', '2024-01-01T00:00:00Z'),
		(3, 'R_unstarred_protected', 'user/unstarred-protected', 'https://github.com/user/unstarred-protected', 'Unstarred but has overrides', 8, '2024-01-01T00:00:00Z', '2024-01-01T00:00:00Z'),
		(4, NULL, 'manual/entry', 'https://github.com/manual/entry', 'Manual entry without repo_id', 0, '2024-01-01T00:00:00Z', '2024-01-01T00:00:00Z')
	`);

	// Add an override for the protected repo
	db.run(`
		INSERT INTO repo_overrides (repo_id, summary_override, updated_at)
		VALUES (3, 'Custom summary for protected repo', '2024-01-01T00:00:00Z')
	`);

	// Add list relationships
	db.run(`
		INSERT INTO list (id, list_id, name, slug, description, is_private)
		VALUES (1, 'test-list', 'Test List', 'test-list', 'A test list', 0)
	`);

	db.run(`
		INSERT INTO list_repo (list_id, repo_id) VALUES 
		(1, 1), (1, 2), (1, 3)
	`);
}

function makeFakeStarsApi(currentStarIds: string[]): StarsApi {
	return {
		async getAllStars(token: string) {
			return currentStarIds.map((id, i) => ({
				repoId: id,
				nameWithOwner: `owner/repo-${i}`,
				url: `https://github.com/owner/repo-${i}`,
				description: `Mock repo ${i}`,
				homepageUrl: null,
				stars: 1,
				forks: 0,
				watchers: 0,
				openIssues: 0,
				openPRs: 0,
				defaultBranch: "main",
				lastCommitISO: "2024-01-01T00:00:00Z",
				lastRelease: null,
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
			}));
		},
		async *getAllStarsStream(token: string) {
			const stars = await this.getAllStars(token);
			yield stars; // Single batch for simplicity
		},
		async collectStarIdsSet(token: string) {
			return new Set(currentStarIds);
		},
	};
}

describe("cleanup integration with proper mocking", () => {
	test("cleanup integrates correctly with ingest service using mocked stars API", async () => {
		const db = setupTestDb();
		setupTestData(db);
		const { log } = makeLogWithLines();

		// Verify initial state
		const initialRepos = db
			.query(`SELECT id, repo_id, name_with_owner FROM repo ORDER BY id`)
			.all();
		expect(initialRepos).toHaveLength(4);

		// Mock stars service to return only R_still_starred as currently starred
		const mockStarsApi = makeFakeStarsApi([
			"R_still_starred",
			"R_other_starred",
		]);
		const mockGh = makeFakeGh({
			"query ViewerStarsPage": () => ({
				viewer: {
					starredRepositories: { edges: [], pageInfo: { hasNextPage: false } },
				},
			}),
		});

		// Create stars service with mocked API
		const starsService = createStarsService(mockStarsApi, db, mockGh, {
			token: "mock-token",
		});

		// Get current star IDs using the mocked service
		const currentStarIds = await starsService.read.collectStarIdsSet();
		expect(currentStarIds.has("R_still_starred")).toBe(true);
		expect(currentStarIds.has("R_unstarred_safe")).toBe(false);

		// Run cleanup directly using the service
		const ingestService = createIngestService(db);
		const result = ingestService.cleanupRemovedStars(currentStarIds);

		// Verify results
		expect(result.removed).toBe(1); // R_unstarred_safe should be removed
		expect(result.preserved).toBe(1); // R_unstarred_protected should be preserved
		expect(result.checkedCount).toBe(2); // Two repos were checked for removal

		// Verify database state after cleanup
		const finalRepos = db
			.query(`SELECT id, repo_id, name_with_owner FROM repo ORDER BY id`)
			.all();
		expect(finalRepos).toHaveLength(3); // One repo removed

		const remainingRepoIds = finalRepos.map((r: any) => r.repo_id);
		expect(remainingRepoIds).toContain("R_still_starred"); // Still starred, kept
		expect(remainingRepoIds).toContain("R_unstarred_protected"); // Protected by override, kept
		expect(remainingRepoIds).toContain(null); // Manual entry, kept
		expect(remainingRepoIds).not.toContain("R_unstarred_safe"); // Should be removed

		// Verify list relationships were cleaned up
		const finalListLinks = db
			.query(`SELECT * FROM list_repo ORDER BY repo_id`)
			.all();
		expect(finalListLinks).toHaveLength(2); // One link removed with the repo

		const linkedRepoIds = finalListLinks.map((link: any) => link.repo_id);
		expect(linkedRepoIds).toContain(1); // Still starred repo
		expect(linkedRepoIds).toContain(3); // Protected repo
		expect(linkedRepoIds).not.toContain(2); // Removed repo's links should be gone
	});

	test("cleanup handles empty current star set safely with mocks", async () => {
		const db = setupTestDb();
		setupTestData(db);

		// Mock stars service to return empty set (all unstarred)
		const mockStarsApi = makeFakeStarsApi([]);
		const starsService = createStarsService(mockStarsApi, db, undefined, {
			token: "mock-token",
		});

		const currentStarIds = await starsService.read.collectStarIdsSet();
		expect(currentStarIds.size).toBe(0);

		const ingestService = createIngestService(db);
		const result = ingestService.cleanupRemovedStars(currentStarIds);

		// Should remove unprotected repos but preserve protected ones
		expect(result.removed).toBe(2); // R_still_starred and R_unstarred_safe
		expect(result.preserved).toBe(1); // R_unstarred_protected (has overrides)
		expect(result.checkedCount).toBe(3);

		// Verify protected repo is still there
		const remaining = db
			.query(`
			SELECT name_with_owner FROM repo WHERE repo_id IS NOT NULL
		`)
			.all();
		expect(remaining).toHaveLength(1);
		expect(remaining[0]).toMatchObject({
			name_with_owner: "user/unstarred-protected",
		});
	});

	test("cleanup handles all repos starred scenario with mocks", async () => {
		const db = setupTestDb();
		setupTestData(db);

		// Mock stars service to return all repos as still starred
		const mockStarsApi = makeFakeStarsApi([
			"R_still_starred",
			"R_unstarred_safe",
			"R_unstarred_protected",
		]);
		const starsService = createStarsService(mockStarsApi, db, undefined, {
			token: "mock-token",
		});

		const currentStarIds = await starsService.read.collectStarIdsSet();
		expect(currentStarIds.size).toBe(3);

		const ingestService = createIngestService(db);
		const result = ingestService.cleanupRemovedStars(currentStarIds);

		// Nothing should be removed since everything is still starred
		expect(result.removed).toBe(0);
		expect(result.preserved).toBe(0);
		expect(result.checkedCount).toBe(0);

		// All repos should remain
		const finalRepos = db.query(`SELECT * FROM repo`).all();
		expect(finalRepos).toHaveLength(4); // All original repos still there
	});
});
