import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDb, initSchema, setDefaultDb } from "@lib/db";
import { _testMain } from "@src/cli";

describe("CLI more routes", () => {
	test("ingest reads from EXPORTS_DIR", async () => {
		const dir = mkdtempSync(join(tmpdir(), "cli-ingest-"));
		const listA = {
			listId: "L1",
			name: "AAA",
			description: null,
			isPrivate: false,
			repos: [],
		};
		writeFileSync(
			join(dir, "index.json"),
			JSON.stringify(
				[
					{
						listId: "L1",
						name: "AAA",
						description: null,
						isPrivate: false,
						count: 0,
						file: "aaa.json",
					},
				],
				null,
				2,
			),
		);
		writeFileSync(join(dir, "aaa.json"), JSON.stringify(listA, null, 2));

		const db = createDb(":memory:");
		setDefaultDb(db);
		initSchema(db);
		const prev = Bun.env.EXPORTS_DIR;
		Bun.env.EXPORTS_DIR = dir;
		try {
			await _testMain(["bun", "cli.ts", "ingest"]);
			const n =
				db.query<{ c: number }, []>("SELECT COUNT(*) c FROM list").get()?.c ??
				0;
			expect(n).toBe(1);
		} finally {
			Bun.env.EXPORTS_DIR = prev;
			rmSync(dir, { recursive: true, force: true });
		}
	});
	test("topics:enrich runs on empty DB", async () => {
		const db = createDb(":memory:");
		setDefaultDb(db);
		initSchema(db);
		await _testMain(["bun", "cli.ts", "topics:enrich"]);
	});
	// test("unlisted --json prints JSON without errors", async () => {
	//   const db = createDb(":memory:");
	//   setDefaultDb(db);
	//   initSchema(db);
	//   await _testMain(["bun", "cli.ts", "unlisted", "--json"]);
	// }, 15_000);
});
