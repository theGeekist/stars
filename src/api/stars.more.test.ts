import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runReposCore, runListsCore, runStarsCore } from "./stars";

// JSON logger helper
function makeJsonLogger() {
	const payloads: unknown[] = [];
	const logger = {
		header: (_: string) => {},
		info: (..._args: unknown[]) => {},
		success: (_: string) => {},
		line: (_?: string) => {},
		spinner: (_: string) => ({
			start: () => ({ text: "", succeed: (_: string) => {}, stop: () => {} }),
		}),
		withSpinner: async <T>(_t: string, fn: () => T | Promise<T>) => await fn(),
		json: (v: unknown) => payloads.push(v),
	} as const;
	return { logger, payloads };
}

// Async generator helper
async function* gen<T>(arr: T[]) {
	for (const it of arr) yield it;
}

describe("api/stars additional coverage", () => {
	test("runReposCore prints JSON", async () => {
		const { logger, payloads } = makeJsonLogger();
		// Ensure token present so ensureToken() path doesn't exit
		Bun.env.GITHUB_TOKEN = "x";
		const deps = {
			getReposFromList: (_t: string, _name: string) =>
				Promise.resolve([{ nameWithOwner: "o/r", stars: 1, url: "u" }]),
		} as const;
		await runReposCore("AAA", true, logger as any, deps as any);
		expect(payloads.length).toBe(1);
	});

	test("runListsCore JSON path uses logger.json", async () => {
		const { logger, payloads } = makeJsonLogger();
		Bun.env.GITHUB_TOKEN = "x";
		const deps = {
			getAllLists: (_tok: string) =>
				Promise.resolve([
					{
						listId: "1",
						name: "A",
						description: null,
						isPrivate: false,
						repos: [],
					},
				]),
			getAllListsStream: undefined as never,
			getReposFromList: undefined as never,
			getAllStars: undefined as never,
			getAllStarsStream: undefined as never,
			createStarsService: undefined as never,
			starsLib: undefined as never,
			slugify: (s: string) => s,
		} as const;
		await runListsCore(true, undefined, undefined, logger as any, deps as any);
		expect(payloads.length).toBe(1);
	});

	test("runStarsCore writes to out file", async () => {
		const dir = mkdtempSync(join(tmpdir(), "stars-more-"));
		const out = join(dir, "out.json");
		const { logger } = makeJsonLogger();
		Bun.env.GITHUB_TOKEN = "x";
		const deps = {
			getAllLists: undefined as never,
			getAllListsStream: undefined as never,
			getReposFromList: undefined as never,
			getAllStars: (_tok: string) =>
				Promise.resolve([{ nameWithOwner: "o/r", url: "u" }]),
			getAllStarsStream: undefined as never,
			createStarsService: undefined as never,
			starsLib: undefined as never,
			slugify: (s: string) => s,
		} as const;
		await runStarsCore(false, out, undefined, logger as any, deps as any);
		const body = JSON.parse(readFileSync(out, "utf8"));
		expect(Array.isArray(body)).toBe(true);
		rmSync(dir, { recursive: true, force: true });
	});
});
