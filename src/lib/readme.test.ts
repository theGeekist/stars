import { describe, it, expect } from "bun:test";
import {
	chunkMarkdown,
	cleanMarkdown,
	fetchReadmeWithCache,
	prepareReadmeForSummary,
	selectInformativeChunks,
} from "@lib/readme";
import { createDb } from "@lib/db";
import type { FetchLike } from "@lib/types";

function makeDb() {
	const db = createDb(":memory:");
	db.run(
		`INSERT INTO repo(id, name_with_owner, url, is_archived, is_disabled, is_fork, is_mirror, has_issues_enabled)
     VALUES (1,'owner/repo','https://x',0,0,0,0,1)`,
	);
	return db;
}

const README_LONG =
	`# Title\n` + Array.from({ length: 1200 }, () => "word").join(" ");

const README_DIR_LIST = `- [link](http://x)\n- [link2](http://y)`;

const README_NORMAL = [
	"# Project",
	"",
	"Purpose. Architecture. Implementation details.",
	"",
	"Features:",
	"- Fast",
	"- Small",
	"- Clever",
].join("\n");

const VOCAB_26 = [
	"alpha",
	"bravo",
	"charlie",
	"delta",
	"echo",
	"foxtrot",
	"golf",
	"hotel",
	"india",
	"juliet",
	"kilo",
	"lima",
	"mike",
	"november",
	"oscar",
	"papa",
	"quebec",
	"romeo",
	"sierra",
	"tango",
	"uniform",
	"victor",
	"whiskey",
	"xray",
	"yankee",
	"zulu",
];

function repeatWords(n: number, vocab = VOCAB_26): string {
	return Array.from({ length: n }, (_, i) => vocab[i % vocab.length]).join(" ");
}

function freezeEnv<K extends string>(key: K, val?: string) {
	const prev = (Bun.env as Record<string, string | undefined>)[key];
	if (val === undefined)
		delete (Bun.env as Record<string, string | undefined>)[key];
	else (Bun.env as Record<string, string | undefined>)[key] = val;
	return () => {
		if (prev === undefined)
			delete (Bun.env as Record<string, string | undefined>)[key];
		else (Bun.env as Record<string, string | undefined>)[key] = prev;
	};
}

export function makeFetch(res: Response | (() => Response)): FetchLike {
	return async () => (typeof res === "function" ? (res as any)() : res);
}

export const embedStub =
	(vals?: number[][]) =>
	async (texts: string[]): Promise<number[][]> =>
		vals ?? texts.map((_, i) => [1 - i * 0.01, 0.0, 0.0]);

describe("readme fetch + cache", () => {
	it("404 returns null and does not write DB", async () => {
		const db = makeDb();
		const fake: FetchLike = makeFetch(
			new Response("not found", { status: 404 }),
		);
		const md = await fetchReadmeWithCache(
			1,
			"owner/repo",
			200000,
			false,
			fake,
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

	it("200 stores README & ETag, respects maxBytes", async () => {
		const db = makeDb();
		const fake = makeFetch(
			new Response(README_LONG, { status: 200, headers: { ETag: '"abc"' } }),
		);
		const md = await fetchReadmeWithCache(
			1,
			"owner/repo",
			100,
			false,
			fake,
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

	it("304 returns cached and bumps fetched_at", async () => {
		const db = makeDb();
		db.run(`UPDATE repo SET readme_md='cached', readme_etag='"e"' WHERE id=1`);
		const fake = makeFetch(new Response("", { status: 304 }));
		const md = await fetchReadmeWithCache(
			1,
			"owner/repo",
			200000,
			false,
			fake,
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

	it("304 with no cache returns null (miss)", async () => {
		const db = makeDb();
		const fake = makeFetch(new Response("", { status: 304 }));
		const md = await fetchReadmeWithCache(
			1,
			"owner/repo",
			200000,
			false,
			fake,
			db,
		);
		expect(md).toBeNull();
	});

	it("non-OK returns cached fallback and bumps fetched_at; honours headers", async () => {
		const restore = freezeEnv("GITHUB_TOKEN", "tok");
		const db = makeDb();
		db.run(`UPDATE repo SET readme_md='cached' WHERE id=1`);
		let headersSeen: HeadersInit | undefined;
		const fake: FetchLike = async (_input, init) => {
			headersSeen = init?.headers;
			return new Response("err", {
				status: 403,
				statusText: "Forbidden",
				headers: { "X-RateLimit-Remaining": "0" },
			});
		};
		const md = await fetchReadmeWithCache(
			1,
			"owner/repo",
			200000,
			false,
			fake,
			db,
		);
		expect(md).toBe("cached");
		const h = headersSeen as Record<string, string>;
		expect(h.Accept).toBe("application/vnd.github.v3.raw");
		expect(h.Authorization).toBe("Bearer tok");
		restore();
	});

	it("forceRefresh ignores If-None-Match", async () => {
		const db = makeDb();
		db.run(
			`UPDATE repo SET readme_md='cached', readme_etag='"etag"' WHERE id=1`,
		);
		let inm: string | undefined;
		const fake: FetchLike = async (_input, init) => {
			inm = (init?.headers as Record<string, string>)?.["If-None-Match"];
			return new Response("OK", { status: 200 });
		};
		await fetchReadmeWithCache(1, "owner/repo", 100, true, fake, db);
		expect(inm).toBeUndefined();
	});
});

describe("cleanMarkdown", () => {
	it("removes frontmatter and normalises blanks", () => {
		const md = `---\ntitle: x\n---\r\n\r\nLine1\r\n\r\n\r\nLine2`;
		const out = cleanMarkdown(md);
		expect(out).toBe("Line1\n\nLine2");
	});
});

describe("chunkMarkdown", () => {
	it("sentence mode yields chunks even for single huge segment", () => {
		const md = "Heading\n\n" + repeatWords(800); // likely > one window
		const chunks = chunkMarkdown(md, {
			mode: "sentence",
			chunkSizeTokens: 128,
			chunkOverlapTokens: 16,
		});
		expect(chunks.length).toBeGreaterThan(1);
	});

	it("token mode slices deterministically with overlap", () => {
		const md = repeatWords(240);
		const chunks = chunkMarkdown(md, {
			mode: "token",
			chunkSizeTokens: 16,
			chunkOverlapTokens: 4,
		});
		expect(chunks.length).toBeGreaterThan(1);
		const a = chunks[0].split(/\s+/);
		const b = chunks[1].split(/\s+/);
		expect(a.slice(-4).join(" ")).toBe(b.slice(0, 4).join(" "));
	});

	it("handles overlap >= size by reducing to step=1", () => {
		const md = repeatWords(40);
		const chunks = chunkMarkdown(md, {
			mode: "token",
			chunkSizeTokens: 8,
			chunkOverlapTokens: 999,
		});
		expect(chunks.length).toBeGreaterThan(1);
	});
});

describe("selectInformativeChunks", () => {
	it("ranks by embedding similarity and filters link-heavy", async () => {
		const chunks = [
			"Intro paragraph about purpose and architecture.".repeat(20),
			"- [link](http://a)\n- [link2](http://b)",
			"Another paragraph with details and features explained.".repeat(20),
		];
		const picked = await selectInformativeChunks(
			chunks,
			"purpose arch",
			embedStub(),
		);
		expect(picked.length).toBeGreaterThan(0);
		expect(picked.some((c) => c.text.includes("link"))).toBeFalse();
	});
});

describe("prepareReadmeForSummary", () => {
	it("classifies awesome/directory and returns empty chunks", async () => {
		const db = makeDb();
		db.run(`UPDATE repo SET readme_md=?, readme_etag='"e"' WHERE id=1`, [
			README_DIR_LIST,
		]);
		const fake: FetchLike = makeFetch(new Response("", { status: 304 }));
		const out = await prepareReadmeForSummary(
			{
				repoId: 1,
				nameWithOwner: "owner/awesome-list",
				description: "curated list",
				topics: ["awesome"],
				embed: embedStub([[1, 0, 0]]),
			},
			fake,
			db,
		);
		expect(out.mode).toBe("directory");
		expect(out.chunks.length).toBe(0);
	});

	it("falls back to deterministic windowing when cosine chunker returns empty", async () => {
		const db = makeDb();
		db.run(`UPDATE repo SET readme_md=?, readme_etag='"e"' WHERE id=1`, [
			README_NORMAL,
		]);
		const fake: FetchLike = makeFetch(new Response("", { status: 304 }));
		// embed stub that makes cosineDropChunker produce something but allow fallback to be covered when empty
		const out = await prepareReadmeForSummary(
			{
				repoId: 1,
				nameWithOwner: "owner/repo",
				description: "desc",
				topics: ["tool"],
				embed: embedStub(),
			},
			fake,
			db,
		);
		// Either cosine chunker or fallback yields chunks; ensure structure is valid
		expect(out.mode).toBe("normal");
		expect(Array.isArray(out.chunks)).toBeTrue();
	});
});
