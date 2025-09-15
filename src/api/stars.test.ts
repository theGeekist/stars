import { describe, expect, mock, test } from "bun:test";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { makeLog } from "../__test__/helpers/log";
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
