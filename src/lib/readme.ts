// src/lib/readme.ts
import { db as defaultDb } from "./db";
import type { Database } from "bun:sqlite";
import { ghHeaders } from "./github";
import { Document, SentenceSplitter, TokenTextSplitter } from "llamaindex";
import type { ChunkingOptions, ReadmeRow } from "./types";

// NOTE: No module-level prepared statements; use provided DB or default DB per call.

// --- helpers -----------------------------------------------------------------
function getGitHubToken(): string | undefined {
	// Prefer GITHUB_TOKEN; fallback to GH_TOKEN
	return Bun.env.GITHUB_TOKEN ?? Bun.env.GH_TOKEN ?? undefined;
}

function headersWithAuth(etag?: string): Record<string, string> {
	const token = getGitHubToken();
	// Start from shared GH headers for consistency
	const base = ghHeaders(token ?? "", false);
	if (!token) delete base.Authorization;
	// Force raw Accept for README content
	base.Accept = "application/vnd.github.v3.raw";
	if (etag) base["If-None-Match"] = etag;
	return base;
}

// --- fetch + cache -----------------------------------------------------------
/**
 * Fetch README with ETag caching and persist:
 * - 200: save (readme_md, readme_etag, readme_fetched_at)
 * - 304: keep readme_md/etag, update readme_fetched_at
 * - 404: return null (no update)
 * - other errors: log & return cached; bump fetched_at so we know we tried
 */
type FetchLike = (
	input: RequestInfo | URL,
	init?: RequestInit,
) => Promise<Response>;

export async function fetchReadmeWithCache(
	repoId: number,
	nameWithOwner: string,
	maxBytes = 200_000,
	forceRefresh = false,
	fetchImpl?: FetchLike,
	database?: Database,
): Promise<string | null> {
	const [owner, repo] = nameWithOwner.split("/");
	const db = database ?? defaultDb;
	const existing = db
		.query<ReadmeRow, [number]>(
			`SELECT id, readme_md, readme_etag FROM repo WHERE id = ?`,
		)
		.get(repoId);
	const etagHint = forceRefresh
		? undefined
		: (existing?.readme_etag ?? undefined);

	const doFetch = fetchImpl ?? fetch;
	const res = await doFetch(
		`https://api.github.com/repos/${owner}/${repo}/readme`,
		{ headers: headersWithAuth(etagHint) },
	);

	const now = new Date().toISOString();

	// 304 → unchanged, bump fetched_at and return cached
	if (res.status === 304) {
		if (existing?.readme_md) {
			db.query<unknown, [string, number]>(
				`UPDATE repo SET readme_fetched_at = ? WHERE id = ?`,
			).run(now, repoId); // keep a record that we checked
			return existing.readme_md;
		}
		// theoretically 304 with no cache; treat as miss
		return null;
	}

	// 404 → no README
	if (res.status === 404) return null;

	// Other non-OK → log & fallback; still bump fetched_at so we don't hammer repeatedly
	if (!res.ok) {
		const remain = res.headers.get("X-RateLimit-Remaining");
		const reset = res.headers.get("X-RateLimit-Reset");
		console.warn(
			`GitHub ${res.status} ${res.statusText} for ${nameWithOwner} (remaining=${
				remain ?? "?"
			}, reset=${reset ?? "?"})`,
		);
		if (existing?.readme_md)
			db.query<unknown, [string, number]>(
				`UPDATE repo SET readme_fetched_at = ? WHERE id = ?`,
			).run(now, repoId);
		return existing?.readme_md ?? null;
	}

	// 200 OK → store README + ETag + fetched_at
	const body = await res.text();
	const md = body.slice(0, maxBytes);
	const etag = res.headers.get("ETag") ?? null;

	db.query<unknown, [string | null, string | null, string, number]>(
		`UPDATE repo SET readme_md = ?, readme_etag = ?, readme_fetched_at = ? WHERE id = ?`,
	).run(md, etag, now, repoId);
	return md;
}

// --- clean + chunk -----------------------------------------------------------
export function cleanMarkdown(md: string): string {
	const withoutFrontmatter = md.replace(/^---\s*[\s\S]*?\s*---\s*\n/, "");
	return withoutFrontmatter
		.replace(/\r\n/g, "\n")
		.replace(/\n{3,}/g, "\n\n")
		.trim();
}

export function chunkMarkdown(
	md: string,
	opts: ChunkingOptions = {},
): string[] {
	const {
		chunkSizeTokens = 768,
		chunkOverlapTokens = 80,
		mode = "sentence",
	} = opts;
	const doc = new Document({ text: md });
	if (mode === "sentence") {
		const splitter = new SentenceSplitter({
			chunkSize: chunkSizeTokens,
			chunkOverlap: chunkOverlapTokens,
		});
		return splitter.splitText(doc.getText());
	} else {
		const splitter = new TokenTextSplitter({
			chunkSize: chunkSizeTokens,
			chunkOverlap: chunkOverlapTokens,
		});
		return splitter.splitText(doc.getText());
	}
}

/** fetch + clean + chunk (cached) */
export async function fetchAndChunkReadmeCached(
	repoId: number,
	nameWithOwner: string,
	options?: ChunkingOptions,
	fetchImpl?: FetchLike,
	database?: Database,
): Promise<string[]> {
	const raw = await fetchReadmeWithCache(
		repoId,
		nameWithOwner,
		undefined,
		false,
		fetchImpl,
		database,
	);
	if (!raw) return [];
	const clean = cleanMarkdown(raw);
	return chunkMarkdown(clean, options);
}

// readme.ts (append)

function linkDensity(s: string): number {
	const lines = s.split(/\r?\n/);
	if (lines.length === 0) return 0;
	const linkish = lines.filter((l) =>
		/\[[^\]]+\]\([^)]+\)|https?:\/\//i.test(l),
	).length;
	return linkish / lines.length;
}

function looksLikeDirectoryRepo(
	nameWithOwner: string,
	description?: string | null,
	topics?: string[],
): boolean {
	const name = nameWithOwner.toLowerCase();
	const desc = (description ?? "").toLowerCase();
	const topicHit = (topics ?? []).some((t) =>
		/awesome|list|curated|links?/.test(t),
	);
	const nameHit = /awesome-|awesome$|^awesome|list|lists/.test(name);
	const descHit = /curated\s+list|awesome\s+list|directory|index/.test(desc);
	return topicHit || nameHit || descHit;
}

/** strip long catalogue sections (bulleted link farms, companies tables, etc.) */
function stripCatalogue(md: string): string {
	const lines = md.split(/\r?\n/);

	// drop code blocks as they often bloat tokens
	const cleaned = [];
	let inCode = false;
	for (const l of lines) {
		if (/^```/.test(l)) {
			inCode = !inCode;
			continue;
		}
		if (inCode) continue;
		cleaned.push(l);
	}

	// remove list/table “cataloguey” blocks: paragraph with >40% link lines
	const out: string[] = [];
	let buf: string[] = [];
	const flush = () => {
		if (buf.length) {
			const block = buf.join("\n");
			if (linkDensity(block) < 0.4) out.push(block);
			buf = [];
		}
	};
	for (const l of cleaned) {
		if (/^\s*([-*+] |\d+\. |\|)/.test(l) || /\[[^\]]+\]\([^)]+\)/.test(l)) {
			buf.push(l);
		} else {
			flush();
			out.push(l);
		}
	}
	flush();

	return out
		.join("\n")
		.replace(/\n{3,}/g, "\n\n")
		.trim();
}

export type SelectedChunk = { text: string; score: number };
/** pick up to K salient chunks guided by a “what is this project?” query */
export async function selectInformativeChunks(
	chunks: string[],
	query: string,
	embed: (texts: string[]) => Promise<number[][]>,
	topK = 6,
): Promise<SelectedChunk[]> {
	if (chunks.length === 0) return [];
	// Filter out very short and very link-dense chunks
	const candidates = chunks
		.map((t) => t.trim())
		.filter((t) => t.length > 200 && linkDensity(t) < 0.35);

	if (candidates.length === 0) return [];

	const [qv] = await embed([query]);
	const cvs = await embed(candidates);

	const scored = cvs.map((v, i) => {
		// cosine similarity
		let dot = 0,
			na = 0,
			nb = 0;
		for (let k = 0; k < v.length; k++) {
			dot += v[k] * qv[k];
			na += v[k] * v[k];
			nb += qv[k] * qv[k];
		}
		const score = dot / (Math.sqrt(na) * Math.sqrt(nb) + 1e-9);
		return { text: candidates[i], score };
	});

	return scored.sort((a, b) => b.score - a.score).slice(0, topK);
}

/** One-shot classifier to decide summarisation mode + curated chunks */
export async function prepareReadmeForSummary(
	opts: {
		repoId: number;
		nameWithOwner: string;
		description?: string | null;
		topics?: string[];
		embed: (texts: string[]) => Promise<number[][]>;
	},
	fetchImpl?: FetchLike,
	database?: Database,
) {
	const raw = await fetchReadmeWithCache(
		opts.repoId,
		opts.nameWithOwner,
		undefined,
		false,
		fetchImpl,
		database,
	);
	if (!raw) {
		return { mode: "no-readme" as const, chunks: [] as SelectedChunk[] };
	}

	const isDirectory = looksLikeDirectoryRepo(
		opts.nameWithOwner,
		opts.description,
		opts.topics,
	);
	const base = cleanMarkdown(raw);
	const pruned = isDirectory ? stripCatalogue(base) : base;
	const chunks = chunkMarkdown(pruned, {
		chunkSizeTokens: 768,
		chunkOverlapTokens: 80,
		mode: "sentence",
	});

	if (isDirectory) {
		return { mode: "directory" as const, chunks: [] as SelectedChunk[] };
	}

	const picked = await selectInformativeChunks(
		chunks,
		"what is this project, its core purpose, technical approach, and standout capability",
		opts.embed,
	);
	return { mode: "normal" as const, chunks: picked };
}
