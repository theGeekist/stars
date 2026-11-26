// src/api/ingest.test.ts
import { afterEach, describe, expect, mock, test } from "bun:test";
import type { IngestReporter } from "@features/ingest/types";
import { createDb, initSchema } from "@lib/db";
import { setListsModuleLoaderForTests } from "@lib/lists-loader";
import type { RepoInfo, StarList } from "@lib/types";
import { makeLog, makeLogWithLines } from "../__test__/helpers/log";
import {
	ingestCoreWith,
	ingestFromData,
	ingestListedFromGh,
	ingestUnlistedFromGh,
} from "./ingest";
import { createIngestReporter, resolveSourceDir } from "./utils";

// Helper to create test repo data
function makeRepo(nameWithOwner: string): RepoInfo {
	const now = new Date().toISOString();
	return {
		repoId: nameWithOwner.replace("/", ":"),
		nameWithOwner,
		url: `https://example.com/${nameWithOwner}`,
		description: "Test repo description",
		homepageUrl: null,
		stars: 100,
		forks: 10,
		watchers: 5,
		openIssues: 2,
		openPRs: 1,
		defaultBranch: "main",
		lastCommitISO: now,
		lastRelease: null,
		topics: ["typescript"],
		primaryLanguage: "TypeScript",
		languages: [{ name: "TypeScript", bytes: 1000 }],
		license: "MIT",
		isArchived: false,
		isDisabled: false,
		isFork: false,
		isMirror: false,
		hasIssuesEnabled: true,
		pushedAt: now,
		updatedAt: now,
		createdAt: now,
		diskUsage: 1024,
		updates: null,
	};
}

type IngestReturn = {
	lists: number;
	reposFromLists?: number;
	unlisted?: number;
};

type IngestFn = (
	source: string,
	reporter: Required<IngestReporter>,
	signal?: AbortSignal,
) => Promise<IngestReturn>;

describe("ingest API coverage", () => {
	afterEach(() => {
		// Clean up any environment variables
		delete Bun.env.EXPORTS_DIR;
		setListsModuleLoaderForTests();
		mock.restore();
	});

	test("ingestCore uses dependency injection properly", async () => {
		const { log, lineCalls } = makeLogWithLines();

		// Create a mock ingest function that follows the real signature
		const mockIngestFn: IngestFn = async (_source, reporter) => {
			reporter.start(2);
			reporter.done({ lists: 2, repos: 13 });
			return {
				type: "lists",
				status: "ok",
				lists: 2,
				counts: { reposFromLists: 10 },
				unlisted: 3,
			};
		};

		// Use the existing ingestCoreWith function which supports DI
		await ingestCoreWith(mockIngestFn, log, "./test-dir");

		expect(lineCalls).toContain("Details: 3 unlisted repos");
	});

	test("ingestCoreWith wires reporter and handles details output", async () => {
		const { log, succeedCalls, lineCalls } = makeLogWithLines();

		const mockIngestFn = mock(async (_source, reporter) => {
			reporter.start(3);
			reporter.listStart(
				{ name: "list1", isPrivate: false, file: "", listId: "1" },
				0,
				3,
				2,
			);
			reporter.listDone(
				{ name: "list1", isPrivate: false, file: "", listId: "1" },
				2,
			);
			reporter.listStart(
				{ name: "list2", isPrivate: false, file: "", listId: "2" },
				1,
				3,
				1,
			);
			reporter.listDone(
				{ name: "list2", isPrivate: false, file: "", listId: "2" },
				1,
			);
			reporter.done({ lists: 3, repos: 3 });
			return {
				lists: 3,
				reposFromLists: 3,
				unlisted: 5,
			};
		});

		await ingestCoreWith(mockIngestFn, log, "/test/exports");

		expect(mockIngestFn).toHaveBeenCalledWith(
			"/test/exports",
			expect.any(Object),
		);
		expect(succeedCalls).toContain("Ingest complete: 3 lists, 3 repos");
		expect(lineCalls).toContain("Details: 3 repos via lists, 5 unlisted repos");
	});

	test("ingestCoreWith handles unlisted-only results", async () => {
		const { log, lineCalls } = makeLogWithLines();

		const mockIngestFn: IngestFn = async (_source, reporter) => {
			reporter.start(0);
			reporter.done({ lists: 0, repos: 0 });
			return {
				lists: 0,
				unlisted: 7,
			};
		};

		await ingestCoreWith(mockIngestFn, log, "/test/exports");

		expect(lineCalls).toContain("Details: 7 unlisted repos");
	});

	test("ingestListedFromGh processes GitHub lists with DI", async () => {
		const db = createDb(":memory:");
		initSchema(db);
		const { log } = makeLog();

		// Save original env
		const prevToken = Bun.env.GITHUB_TOKEN;
		Bun.env.GITHUB_TOKEN = "test-token";

		// Create mock lists data
		const mockLists: StarList[] = [
			{
				listId: "work",
				name: "Work Tools",
				description: "Professional tools",
				isPrivate: false,
				repos: [makeRepo("company/api-tool"), makeRepo("team/workflow")],
			},
			{
				listId: "personal",
				name: "Personal Projects",
				description: "Side projects",
				isPrivate: false,
				repos: [makeRepo("me/side-project")],
			},
		];

		// Mock the lists stream
		setListsModuleLoaderForTests(() => ({
			getAllListsStream: async function* () {
				for (const list of mockLists) {
					yield list;
				}
			},
		}));

		const result = await ingestListedFromGh(db, log);

		// Should have processed the lists through ingestFromData
		expect(result.lists).toBe(2);
		expect(result.reposFromLists).toBe(3);
		expect(result.unlisted).toBe(0);

		// Restore env
		Bun.env.GITHUB_TOKEN = prevToken;
	});

	test("ingestUnlistedFromGh fetches and processes unlisted stars", async () => {
		const db = createDb(":memory:");
		initSchema(db);
		const { log } = makeLog();

		// Create mock unlisted repos
		const mockUnlisted: RepoInfo[] = [
			makeRepo("random/useful-lib"),
			makeRepo("someone/interesting-tool"),
		];

		// Mock the stars service
		const mockStarsService = {
			read: {
				getUnlistedStars: mock(async () => mockUnlisted),
			},
		};

		mock.module("@features/stars", () => ({
			createStarsService: () => mockStarsService,
		}));

		const result = await ingestUnlistedFromGh(db, log);

		expect(mockStarsService.read.getUnlistedStars).toHaveBeenCalledWith(
			undefined,
		);
		expect(result.lists).toBe(0);
		expect(result.reposFromLists).toBe(0);
		expect(result.unlisted).toBe(2);
	});

	test("ingestListedFromGh handles abort signal", async () => {
		const { log } = makeLog();
		const controller = new AbortController();

		Bun.env.GITHUB_TOKEN = "test-token";

		// Mock stream that responds to abort signal
		setListsModuleLoaderForTests(() => ({
			getAllListsStream: async function* () {
				if (controller.signal.aborted) {
					throw new Error("Operation was aborted");
				}
				yield {
					listId: "test",
					name: "Test",
					description: "",
					isPrivate: false,
					repos: [],
				};
			},
		}));

		// Abort immediately
		controller.abort();

		await expect(
			ingestListedFromGh(undefined, log, controller.signal),
		).rejects.toThrow("Operation was aborted");
	});

	test("ingestUnlistedFromGh handles abort signal", async () => {
		const { log } = makeLog();
		const controller = new AbortController();

		// Abort immediately before calling the function
		controller.abort();

		await expect(
			ingestUnlistedFromGh(undefined, log, controller.signal),
		).rejects.toThrow("Aborted");
	});

	test("ingestFromData with real database and mixed data", () => {
		const db = createDb(":memory:");
		initSchema(db);
		const { log, lineCalls } = makeLogWithLines();

		// Create test data with multiple lists and unlisted repos
		const lists: StarList[] = [
			{
				listId: "productivity",
				name: "Productivity Tools",
				description: "Tools that boost productivity",
				isPrivate: false,
				repos: [
					makeRepo("user/awesome-tool"),
					makeRepo("dev/productivity-app"),
				],
			},
			{
				listId: "learning",
				name: "Learning Resources",
				description: "Educational content",
				isPrivate: false,
				repos: [makeRepo("edu/course-material")],
			},
		];

		const unlisted: RepoInfo[] = [
			makeRepo("misc/random-repo"),
			makeRepo("temp/test-project"),
		];

		// Use real function with real database - no mocking needed
		const result = ingestFromData(lists, unlisted, db, log);

		// Verify the results
		expect(result.lists).toBe(2);
		expect(result.reposFromLists).toBe(3);
		expect(result.unlisted).toBe(2);

		// Verify logging includes details
		expect(
			lineCalls.some((line) =>
				String(line).includes("Details: 3 repos via lists, 2 unlisted repos"),
			),
		).toBe(true);
	});

	test("ingestFromData with empty data handles edge case", () => {
		const db = createDb(":memory:");
		initSchema(db);
		const { log, lineCalls } = makeLogWithLines();

		// Test with no data
		const result = ingestFromData([], [], db, log);

		expect(result.lists).toBe(0);
		expect(result.reposFromLists).toBe(0);
		expect(result.unlisted).toBe(0);

		// Should still log details
		expect(
			lineCalls.some((line) =>
				String(line).includes("Details: 0 repos via lists, 0 unlisted repos"),
			),
		).toBe(true);
	});
});

// Test utility functions without module mocking
describe("resolveSourceDir", () => {
	test("arg > env > default", () => {
		const prev = Bun.env.EXPORTS_DIR;
		Bun.env.EXPORTS_DIR = "/env";

		expect(resolveSourceDir("./arg")).toBe("./arg");
		expect(resolveSourceDir()).toBe("/env");

		delete Bun.env.EXPORTS_DIR;
		expect(resolveSourceDir()).toBe("./exports");

		Bun.env.EXPORTS_DIR = prev;
	});
});

describe("createReporter", () => {
	test("tracks totals and logs final message (computed totals)", () => {
		const { log, succeedCalls } = makeLog();
		const { reporter, getTotals } = createIngestReporter(log, "/temp");

		reporter.start(2);
		expect(getTotals()).toEqual({ lists: 2, repos: 0 });

		reporter.listStart(
			{ name: "A", isPrivate: false, file: "", listId: "A" },
			0,
			2,
			1,
		);
		reporter.listDone(
			{ name: "A", isPrivate: false, file: "", listId: "A" },
			1,
		);
		reporter.listStart(
			{ name: "B", isPrivate: false, file: "", listId: "B" },
			1,
			2,
			3,
		);
		reporter.listDone(
			{ name: "B", isPrivate: false, file: "", listId: "B" },
			3,
		);

		expect(getTotals()).toEqual({ lists: 2, repos: 4 });

		// Force computation with computed totals
		reporter.done({ lists: 2, repos: 4 });

		expect(succeedCalls).toContain("Ingest complete: 2 lists, 4 repos");
	});

	test("done() honours provided totals", () => {
		const { log, succeedCalls } = makeLog();
		const { reporter } = createIngestReporter(log, "/temp");

		reporter.start(2);
		reporter.listDone(
			{ name: "X", isPrivate: false, file: "", listId: "X" },
			1,
		);
		reporter.done({ lists: 5, repos: 10 });

		expect(succeedCalls).toContain("Ingest complete: 5 lists, 10 repos");
	});
});
