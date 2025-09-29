import { Database } from "bun:sqlite";
import { beforeEach, describe, expect, it } from "bun:test";
import { createDb, initSchema } from "./db";
import {
	addColumnIfMissing,
	createIndexIfNotExists,
	getTableColumns,
	safeExecute,
	tableExists,
} from "./db-utils";

describe("db helpers", () => {
	it("createDb(:memory:) initializes schema", () => {
		const db = createDb(":memory:");
		const row = db
			.query<{ name: string }, []>(
				"SELECT name FROM sqlite_master WHERE type='table' AND name='repo'",
			)
			.get();
		expect(row?.name).toBe("repo");
	});

	it("initSchema works on an arbitrary Database", () => {
		const tmp = new Database(":memory:");
		initSchema(tmp);
		const row = tmp
			.query<{ name: string }, []>(
				"SELECT name FROM sqlite_master WHERE type='table' AND name='list'",
			)
			.get();
		expect(row?.name).toBe("list");
	});
});

describe("db-utils", () => {
	let db: Database;

	beforeEach(() => {
		db = createDb(":memory:");
	});

	describe("tableExists", () => {
		it("returns true for existing table", () => {
			expect(tableExists("repo", db)).toBe(true);
		});

		it("returns false for non-existing table", () => {
			expect(tableExists("nonexistent", db)).toBe(false);
		});
	});

	describe("getTableColumns", () => {
		it("returns column names for table", () => {
			const columns = getTableColumns("repo", db);
			expect(columns.has("id")).toBe(true);
			expect(columns.has("name_with_owner")).toBe(true);
			expect(columns.has("nonexistent_column")).toBe(false);
		});
	});

	describe("addColumnIfMissing", () => {
		it("adds column when it doesn't exist", () => {
			// First verify column doesn't exist
			let columns = getTableColumns("repo", db);
			expect(columns.has("test_column")).toBe(false);

			// Add the column
			addColumnIfMissing("repo", "test_column", "TEXT", db);

			// Verify column now exists
			columns = getTableColumns("repo", db);
			expect(columns.has("test_column")).toBe(true);
		});

		it("doesn't add column when it already exists", () => {
			// Column 'url' should already exist
			const columnsBefore = getTableColumns("repo", db);
			expect(columnsBefore.has("url")).toBe(true);

			// Try to add it again (should be no-op)
			addColumnIfMissing("repo", "url", "TEXT", db);

			// Should still exist and table should be unchanged
			const columnsAfter = getTableColumns("repo", db);
			expect(columnsAfter.has("url")).toBe(true);
			expect(columnsAfter.size).toBe(columnsBefore.size);
		});
	});

	describe("createIndexIfNotExists", () => {
		it("creates regular index", () => {
			createIndexIfNotExists(db, "test_idx", "repo", ["name_with_owner"]);

			// Verify index was created
			const indexes = db
				.query(
					"SELECT name FROM sqlite_master WHERE type='index' AND name='test_idx'",
				)
				.all();
			expect(indexes).toHaveLength(1);
		});

		it("creates unique index", () => {
			createIndexIfNotExists(db, "test_unique_idx", "repo", ["url"], true);

			// Verify unique index was created
			const indexes = db
				.query(
					"SELECT sql FROM sqlite_master WHERE type='index' AND name='test_unique_idx'",
				)
				.all() as Array<{ sql: string }>;
			expect(indexes).toHaveLength(1);
			expect(indexes[0].sql).toContain("UNIQUE");
		});

		it("handles multiple columns", () => {
			createIndexIfNotExists(db, "test_multi_idx", "repo", [
				"name_with_owner",
				"url",
			]);

			const indexes = db
				.query(
					"SELECT name FROM sqlite_master WHERE type='index' AND name='test_multi_idx'",
				)
				.all();
			expect(indexes).toHaveLength(1);
		});
	});

	describe("safeExecute", () => {
		it("executes successful query", () => {
			const results = safeExecute<{ count: number }>(
				db,
				"SELECT COUNT(*) as count FROM repo",
				[],
			);
			expect(results).toHaveLength(1);
			expect(results[0].count).toBe(0);
		});

		it("handles query with parameters", () => {
			// Insert a test record first
			db.run(
				"INSERT INTO repo (repo_id, name_with_owner, url) VALUES (?, ?, ?)",
				["test_id", "test/repo", "https://github.com/test/repo"],
			);

			const results = safeExecute<{ name_with_owner: string }>(
				db,
				"SELECT name_with_owner FROM repo WHERE repo_id = ?",
				["test_id"],
			);
			expect(results).toHaveLength(1);
			expect(results[0].name_with_owner).toBe("test/repo");
		});

		it("throws error for invalid query", () => {
			expect(() => {
				safeExecute(db, "SELECT * FROM nonexistent_table", []);
			}).toThrow();
		});
	});
});
