import { describe, expect, mock, test } from "bun:test";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	makeCaptureLog,
	makeLiteLog,
	makeLog,
	makeLogWithLines,
} from "../__test__/helpers/log";
import {
	createFullCapturingLogger,
	createLineAndSuccessLogger,
	createSuccessCapturingLogger,
} from "../__test__/helpers/log-factory";
import { runListsCore, runStarsCore, runUnlistedCore } from "./stars";

// provide a minimal logger compatible with Logger (realLog) used by stars.ts

// Async generator helpers
async function* gen<T>(arr: T[]) {
	for (const it of arr) yield it;
}

describe("api/stars core flows", () => {
	test("runListsCore streams to dir and writes index.json", async () => {
		const dir = mkdtempSync(join(tmpdir(), "lists-core-"));
		const { log: logger } = makeLog();
		Bun.env.GITHUB_TOKEN = "x";

		const deps = {
			getAllLists: undefined as never,
			getAllListsStream: (_tok: string) =>
				gen([
					{
						listId: "1",
						name: "AAA list",
						description: null,
						isPrivate: false,
						repos: [{}, {}],
					},
					{
						listId: "2",
						name: "BBB list",
						description: "d",
						isPrivate: true,
						repos: [{}],
					},
				]),
			getReposFromList: undefined as never,
			getAllStars: undefined as never,
			getAllStarsStream: undefined as never,
			createStarsService: undefined as never,
			starsLib: undefined as never,
			slugify: (s: string) => s.toLowerCase().replace(/\s+/g, "-"),
		} as const;

		await runListsCore(
			false,
			undefined,
			dir,
			logger,
			deps as unknown as Parameters<typeof runListsCore>[4],
		);
		const index = JSON.parse(readFileSync(join(dir, "index.json"), "utf8"));
		expect(Array.isArray(index)).toBe(true);
		expect(index.length).toBe(2);
		// file names slugged
		expect(index[0].file).toBe("aaa-list.json");
	});

	test("runStarsCore streams to dir and writes index.json", async () => {
		const dir = mkdtempSync(join(tmpdir(), "stars-core-"));
		const { log: logger } = makeLog();
		Bun.env.GITHUB_TOKEN = "x";
		const deps = {
			getAllLists: undefined as never,
			getAllListsStream: undefined as never,
			getReposFromList: undefined as never,
			getAllStars: undefined as never,
			getAllStarsStream: (_tok: string) =>
				gen([[{ id: 1 }, { id: 2 }], [{ id: 3 }]]),
			createStarsService: undefined as never,
			starsLib: undefined as never,
			slugify: (s: string) => s,
		} as const;

		await runStarsCore(
			false,
			undefined,
			dir,
			logger,
			deps as unknown as Parameters<typeof runStarsCore>[4],
		);
		const idx = JSON.parse(readFileSync(join(dir, "index.json"), "utf8"));
		expect(idx.total).toBe(3);
		expect(idx.pages.length).toBe(2);
		expect(idx.pages[0].file).toContain("stars-page-001.json");
	});

	test("runUnlistedCore writes unlisted.json", async () => {
		const dir = mkdtempSync(join(tmpdir(), "unlisted-core-"));
		const { log: logger } = makeLog();
		Bun.env.GITHUB_TOKEN = "x";
		const deps = {
			getAllLists: undefined as never,
			getAllListsStream: undefined as never,
			getReposFromList: undefined as never,
			getAllStars: undefined as never,
			getAllStarsStream: undefined as never,
			createStarsService: (_lib: unknown, _db: unknown) => ({
				read: {
					getUnlistedStars: mock(() =>
						Promise.resolve([{ nameWithOwner: "o/r", url: "u" }]),
					),
				},
			}),
			starsLib: {},
			slugify: (s: string) => s,
		} as const;

		await runUnlistedCore(
			false,
			undefined,
			dir,
			undefined,
			logger,
			deps as unknown as Parameters<typeof runUnlistedCore>[5],
		);
		const body = JSON.parse(readFileSync(join(dir, "unlisted.json"), "utf8"));
		expect(body.length).toBe(1);
		expect(body[0].nameWithOwner).toBe("o/r");
	});
});

describe("Log Factory", () => {
	test("createSuccessCapturingLogger captures success calls", () => {
		const { log, succeedCalls } = createSuccessCapturingLogger();

		log.success("test message");
		log.header("header"); // should not be captured

		expect(succeedCalls).toEqual(["test message"]);
	});

	test("createLineAndSuccessLogger captures both line and success calls", () => {
		const { log, succeedCalls, lineCalls } = createLineAndSuccessLogger();

		log.success("success msg");
		log.line("line msg");
		log.line(undefined);

		expect(succeedCalls).toEqual(["success msg"]);
		expect(lineCalls).toEqual(["line msg", "undefined"]);
	});

	test("createFullCapturingLogger captures multiple call types", () => {
		const {
			log,
			headers,
			infos,
			successes,
			spinnerStarts,
			spinnerSucceedMsgs,
		} = createFullCapturingLogger();

		log.header("Test Header");
		log.info("Test Info");
		log.success("Test Success");

		const spinner = log.spinner("Loading...");
		const spinnerInstance = spinner.start();
		spinnerInstance.succeed("Done!");

		expect(headers).toEqual(["Test Header"]);
		expect(infos).toEqual(["Test Info"]);
		expect(successes).toEqual(["Test Success"]);
		expect(spinnerStarts).toEqual(["Loading..."]);
		expect(spinnerSucceedMsgs).toEqual(["Done!"]);
	});

	test("backward compatibility - makeLog returns same interface", () => {
		const { log, succeedCalls } = makeLog();
		log.success("test");
		expect(succeedCalls).toEqual(["test"]);
	});

	test("backward compatibility - makeLogWithLines returns same interface", () => {
		const { log, succeedCalls, lineCalls } = makeLogWithLines();
		log.success("success");
		log.line("line");
		expect(succeedCalls).toEqual(["success"]);
		expect(lineCalls).toEqual(["line"]);
	});

	test("backward compatibility - makeCaptureLog returns same interface", () => {
		const { log, headers, successes } = makeCaptureLog();
		log.header("header");
		log.success("success");
		expect(headers).toEqual(["header"]);
		expect(successes).toEqual(["success"]);
	});

	test("backward compatibility - makeLiteLog returns logger without withSpinner", () => {
		const { log } = makeLiteLog();
		// Check withSpinner existence using proper typing
		expect("withSpinner" in log).toBe(false);
		expect(typeof log.spinner).toBe("function");
		expect(typeof log.success).toBe("function");
	});
});
