import { describe, it, expect } from "bun:test";
import { createDb } from "@lib/db";
import {
	fetchReadmeWithCache,
	fetchAndChunkReadmeCached,
	cleanMarkdown,
	chunkMarkdown,
	selectInformativeChunks,
	prepareReadmeForSummary,
} from "@lib/readme";

function makeDb() {
	const db = createDb(":memory:");
	// minimal repo row
	db.run(
		`INSERT INTO repo(name_with_owner, url, is_archived, is_disabled, is_fork, is_mirror, has_issues_enabled)
     VALUES ('owner/repo','https://x',0,0,0,0,1)`,
	);
	return db;
}

describe("readme fetch + cache", () => {
	it("returns null on 404 and does not write DB", async () => {
		const db = makeDb();
		const fakeFetch = async () =>
			new Response("not found", { status: 404, statusText: "Not Found" });
		const md = await fetchReadmeWithCache(
			1,
			"owner/repo",
			200000,
			false,
			fakeFetch,
			db,
		);
		expect(md).toBeNull();
		const row = db
			.query<{ readme_md: string | null }, []>(
				`SELECT readme_md FROM repo WHERE id=1`,
			)
			.get();
		expect(row?.readme_md ?? null).toBeNull();
	});

	it("stores README and ETag on 200, respects maxBytes", async () => {
		const db = makeDb();
		const body = "# Title\n" + "A".repeat(1000);
		const fakeFetch = async () =>
			new Response(body, { status: 200, headers: { ETag: '"abc"' } as any });
		const md = await fetchReadmeWithCache(
			1,
			"owner/repo",
			100,
			false,
			fakeFetch,
			db,
		);
		expect(md?.length).toBe(100);
		const row = db
			.query<{ readme_md: string | null; readme_etag: string | null }, []>(
				`SELECT readme_md, readme_etag FROM repo WHERE id=1`,
			)
			.get();
		expect(row?.readme_md?.length ?? 0).toBe(100);
		expect(row?.readme_etag).toBe('"abc"');
	});

	it("returns cached on 304 and bumps fetched_at", async () => {
		const db = makeDb();
		db.run(`UPDATE repo SET readme_md='cached', readme_etag='"e"' WHERE id=1`);
		const fakeFetch = async () => new Response("", { status: 304 });
		const md = await fetchReadmeWithCache(
			1,
			"owner/repo",
			200000,
			false,
			fakeFetch,
			db,
		);
		expect(md).toBe("cached");
		const row = db
			.query<{ readme_fetched_at: string | null }, []>(
				`SELECT readme_fetched_at FROM repo WHERE id=1`,
			)
			.get();
		expect(typeof row?.readme_fetched_at).toBe("string");
	});
});

describe("readme clean + chunk", () => {
	it("removes frontmatter and normalises whitespace", () => {
		const md = `---\ntitle: x\n---\n\nLine1\n\n\nLine2`;
		const out = cleanMarkdown(md);
		expect(out).toBe("Line1\n\nLine2");
	});

	it("sentence chunking yields non-empty chunks", () => {
		const md = "Sentence one. Sentence two. Sentence three.";
		const chunks = chunkMarkdown(md, {
			mode: "sentence",
			chunkSizeTokens: 20,
			chunkOverlapTokens: 0,
		});
		expect(Array.isArray(chunks)).toBeTrue();
		expect(chunks.length).toBeGreaterThan(0);
	});
});

describe("selectInformativeChunks & prepareReadmeForSummary", () => {
	it("ranks chunks by embedding similarity and trims link-heavy content", async () => {
		const chunks = [
			"Intro paragraph about purpose and architecture.".repeat(20),
			"- [link](http://a)\n- [link2](http://b)",
			"Another paragraph with details and features explained.".repeat(20),
		];
		const embed = async (texts: string[]) =>
			texts.map((_t, i) => [1 - i * 0.01, 0, 0]);
		const picked = await selectInformativeChunks(chunks, "purpose arch", embed);
		expect(picked.length).toBeGreaterThan(0);
		// ensure link-heavy list was filtered
		expect(picked.some((c) => c.text.includes("link"))).toBeFalse();
	});

	it("classifies awesome/directory repos and returns no chunks", async () => {
		const db = makeDb();
		const embed = async (_: string[]) => [[1, 0, 0]];
		// Bypass GitHub by directly inserting readme and calling prepare
		db.run(
			`UPDATE repo SET readme_md='- [link](http://x)\n- [link2](http://y)', readme_etag='"e"' WHERE id=1`,
		);
		const fakeFetch = async () => new Response("", { status: 304 });
		const out = await prepareReadmeForSummary(
			{
				repoId: 1,
				nameWithOwner: "owner/awesome-list",
				description: "curated list",
				topics: ["awesome"],
				embed,
			},
			fakeFetch,
			db,
		);
		expect(out.mode).toBe("directory");
		expect(out.chunks.length).toBe(0);
	});
});
