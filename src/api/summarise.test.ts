import type { Database } from "bun:sqlite";
import { beforeAll, describe, expect, test } from "bun:test";
import { createDb, initSchema, withDB } from "@lib/db";
import { makeCaptureLog, makeLog } from "../__test__/helpers/log";
import {
	generateSummaryForRow,
	saveSummaryOrDryRun,
	summariseBatchAllCore,
	summariseOneCore,
	toSummariseInput,
} from "./summarise";

describe("api/summarise adapters and helpers", () => {
	test("toSummariseInput maps RepoRow fields", () => {
		const row = {
			id: 1,
			repo_id: "r1",
			name_with_owner: "o/r",
			url: "u",
			description: "d",
			primary_language: "ts",
			license: null,
			tags: null,
			summary: null,
			is_archived: 0,
			is_disabled: 0,
			popularity: 0.5,
			freshness: 0.6,
			activeness: 0.7,
			updated_at: null,
			topics: '["a"]',
			stars: 1,
			forks: 2,
		} as unknown as import("@lib/types").RepoRow;
		const input = toSummariseInput(row);
		expect(input.nameWithOwner).toBe("o/r");
		expect(input.metrics.popularity).toBe(0.5);
		expect(input.topics).toEqual(["a"]);
	});

	test("generateSummaryForRow logs spinner start + success and returns paragraph", async () => {
		const { log, successes } = makeCaptureLog();
		const row = {
			id: 1,
			name_with_owner: "o/awesome",
			url: "https://x",
			description: "Awesome list",
			primary_language: null,
			topics: '["awesome"]',
			popularity: 0,
			freshness: 0,
			activeness: 0,
		} as unknown as import("@lib/types").RepoRow;
		const { paragraph, words } = await generateSummaryForRow(
			row,
			undefined,
			log,
		);
		expect(typeof paragraph).toBe("string");
		expect(words).toBeGreaterThan(0);
		expect(successes.some((m) => m.includes("Summary ready"))).toBe(true);
	});

	test("saveSummaryOrDryRun dry path does not call save", () => {
		const { log } = makeLog();
		let called = 0;
		const fakeSvc = {
			saveSummary: (_id: number, _p: string) => {
				called++;
			},
			selectRepos: (_sel: unknown) => [],
		} as unknown as ReturnType<
			typeof import("@features/summarise/service").createSummariseService
		>;
		saveSummaryOrDryRun(fakeSvc, 1, "p", false, log);
		expect(called).toBe(0);
	});
});

describe("api/summarise orchestrators", () => {
	let db: Database;
	beforeAll(() => {
		db = createDb(":memory:");
		initSchema(db);
	});

	test("summariseBatchAllCore processes rows and logs output", async () => {
		const d = withDB(db);
		d.exec(`
      INSERT INTO repo(id, name_with_owner, url, description, topics) VALUES
      (1,'o/a','https://x','Awesome list','["awesome"]'),
      (2,'o/b','https://y','Awesome list','["awesome"]');
    `);
		const { log, headers } = makeCaptureLog();
		await summariseBatchAllCore(10, false, undefined, undefined, db, log);
		expect(headers.length).toBeGreaterThan(0);
	});

	test("summariseOneCore handles repo not found", async () => {
		const { log, successes } = makeCaptureLog();
		await summariseOneCore("no/such", false, undefined, db, log);
		expect(successes).toBeArrayOfSize(0);
	});
});
