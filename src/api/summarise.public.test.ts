import {
	afterAll,
	afterEach,
	beforeAll,
	beforeEach,
	describe,
	expect,
	it,
	mock,
} from "bun:test";
import type { Database } from "bun:sqlite";
import type { RepoRow } from "@lib/types";
import { createDb, initSchema } from "@lib/db";

const makeRow = (id: number, name: string): RepoRow => ({
	id,
	repo_id: `R_${id}`,
	name_with_owner: name,
	url: `https://github.com/${name}`,
	description: "Test repo",
	primary_language: "TypeScript",
	topics: '["testing"]',
	summary: null,
	stars: 10,
	forks: 2,
	popularity: 0.5,
	freshness: 0.6,
	activeness: 0.7,
	is_archived: 0,
	is_disabled: 0,
});

let rows: RepoRow[] = [makeRow(1, "org/one"), makeRow(2, "org/two")];
const generateSummaryForRow = mock(async (row: RepoRow, deps?: unknown) => {
	capturedDeps.push(deps);
	return { paragraph: `Summary for ${row.name_with_owner}`, words: 3 };
});
const saveSummaryOrDryRun = mock(() => {});
const summariseService = {
	selectRepos: () => rows,
	saveSummary: () => {},
};
const capturedDeps: unknown[] = [];
const ollamaGen = mock(async () => "paragraph");

mock.module("@features/summarise/service", () => ({
	createSummariseService: () => summariseService,
}));
mock.module("./summarise", () => ({
	generateSummaryForRow,
	saveSummaryOrDryRun,
}));
mock.module("@lib/ollama", () => ({
	gen: ollamaGen,
}));

const { summariseAll, summariseRepo } = await import("./summarise.public");

afterAll(() => {
	mock.restore();
});

let db: Database;

beforeAll(() => {
	db = createDb(":memory:");
	initSchema(db);
	db.exec(
		`INSERT INTO repo(id, repo_id, name_with_owner, url, description, primary_language, topics, stars, forks, popularity, freshness, activeness)
         VALUES (1,'R_1','org/one','https://github.com/org/one','Repo','TypeScript','["testing"]',10,2,0.5,0.6,0.7);`,
	);
});

beforeEach(() => {
	rows = [makeRow(1, "org/one"), makeRow(2, "org/two")];
	capturedDeps.length = 0;
	generateSummaryForRow.mockClear();
	saveSummaryOrDryRun.mockClear();
	ollamaGen.mockClear();
});

afterEach(() => {
	Bun.env.OLLAMA_MODEL = "test-model";
});

describe("summariseAll", () => {
	it("summarises rows using modelConfig fallback", async () => {
		const progress: unknown[] = [];
		const result = await summariseAll({
			dry: true,
			modelConfig: { model: "llama3", host: "http://ollama" },
			onProgress: (evt) => progress.push(evt),
		});

		expect(result.items).toHaveLength(2);
		expect(result.items.every((i) => i.status === "ok")).toBeTrue();
		expect(result.stats).toEqual({
			processed: 2,
			succeeded: 2,
			failed: 0,
			saved: 0,
		});
		expect(progress).toHaveLength(2);
		expect(generateSummaryForRow).toHaveBeenCalledTimes(2);
		expect(capturedDeps[0]).toBeDefined();
	});

	it("returns empty payload when no rows selected", async () => {
		rows = [];

		const result = await summariseAll({
			dry: true,
			modelConfig: { model: "stub" },
		});

		expect(result.items).toHaveLength(0);
		expect(result.stats).toEqual({
			processed: 0,
			succeeded: 0,
			failed: 0,
			saved: 0,
		});
	});
});

describe("summariseRepo", () => {
	it("summarises specific repo and saves when dry=false", async () => {
		const result = await summariseRepo({
			selector: "org/one",
			dry: false,
			modelConfig: { model: "stub" },
			db,
		});

		expect(result.status).toBe("ok");
		expect(result.saved).toBeTrue();
		expect(saveSummaryOrDryRun).toHaveBeenCalledWith(
			expect.any(Object),
			1,
			expect.any(String),
			false,
			expect.anything(),
		);
	});

	it("returns error when repo missing", async () => {
		const result = await summariseRepo({
			selector: "unknown/repo",
			dry: true,
			modelConfig: { model: "stub" },
			db,
		});

		expect(result.status).toBe("error");
		expect(result.error).toBe("repo not found");
	});

	it("propagates errors from summary generation", async () => {
		generateSummaryForRow.mockImplementationOnce(async () => {
			throw new Error("boom");
		});

		const result = await summariseRepo({
			selector: "org/one",
			dry: true,
			modelConfig: { model: "stub" },
			db,
		});

		expect(result.status).toBe("error");
		expect(result.error).toBe("boom");
	});
});
