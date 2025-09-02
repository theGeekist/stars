import { Database } from "bun:sqlite";
import { describe, expect, it } from "bun:test";
import { createDb, initSchema } from "./db";

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
