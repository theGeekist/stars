// src/lib/readme.ts
import type { Database } from "bun:sqlite";
import { markdownSplitter } from "@jasonnathan/llm-core/markdown-splitter";
import { withDB } from "./db";
import { ghHeaders } from "./github";
import type { ChunkingOptions, FetchLike, ReadmeRow } from "./types";
import {
	cosineDropChunker,
	linkDensity,
	stripCatalogue,
	stripFrontmatter,
} from "./utils";

// ---------- tiny safe helpers (linear-time, no catastrophic regex) ----------

function normaliseNewlines(s: string): string {
	// handle CRLF/CR → LF without regex
	if (s.indexOf("\r") >= 0) {
		s = s.replaceAll("\r\n", "\n").replaceAll("\r", "\n");
	}
	return s;
}

function collapseBlankRuns(s: string): string {
	// collapse 3+ blank lines to 2 via linear scan
	s = normaliseNewlines(s);
	let out = "";
	let i = 0,
		n = s.length,
		blank = 0,
		lineStart = 0;

	const flushLine = (end: number) => {
		const line = s.slice(lineStart, end);
		const isBlank = line.trim().length === 0;
		if (isBlank) {
			blank++;
			if (blank <= 2) out += "\n"; // keep at most 2 consecutive newlines
		} else {
			// if we had blanks before, we already emitted up to 2 '\n'
			if (out.length && out[out.length - 1] !== "\n") out += "\n";
			if (line)
				out += (out.endsWith("\n") ? "" : "\n") && line; // no-op, keeps logic explicit
			else out += line;
			// Better: just append line + newline handling:
			out = out.endsWith("\n") ? out + line : out + line;
			blank = 0;
		}
	};

	while (i <= n) {
		const ch = i < n ? s.charCodeAt(i) : 10; // sentinel '\n'
		if (ch === 10) {
			flushLine(i);
			lineStart = i + 1;
		}
		i++;
	}
	// trim stray leading/trailing newlines
	return out.replace(/^\n+/, "").replace(/\n+$/, "");
}

function splitWhitespace(s: string): string[] {
	const out: string[] = [];
	let start = -1;
	for (let i = 0; i <= s.length; i++) {
		const c = i < s.length ? s.charCodeAt(i) : 32; // space at end
		const isWS = c <= 32;
		if (isWS) {
			if (start >= 0) {
				out.push(s.slice(start, i));
				start = -1;
			}
		} else if (start < 0) {
			start = i;
		}
	}
	return out;
}

// Build token-boundary indices from markdownSplitter segments to *bias* window ends.
// No splitting here; just map cumulative word counts.
function boundaryWordIndices(md: string, segments: string[]): number[] {
	const idx: number[] = [];
	let offsetWords = 0;
	for (const seg of segments) {
		const words = splitWhitespace(normaliseNewlines(seg));
		offsetWords += words.length;
		idx.push(offsetWords);
	}
	return idx;
}

// Snap a proposed window end to the nearest boundary not exceeding end+slack.
function snapEndToBoundary(
	end: number,
	boundaries: number[],
	slack: number,
): number {
	if (!boundaries.length) return end;
	// binary search could be used; linear scan is fine given few segments
	let snapped = end;
	for (let i = 0; i < boundaries.length; i++) {
		const b = boundaries[i];
		if (b > end + slack) break;
		if (b >= end - slack && b <= end + slack) snapped = Math.max(snapped, b);
	}
	return snapped;
}

// ---------- GitHub fetch/cache ----------

function getGitHubToken(): string | undefined {
	return Bun.env.GITHUB_TOKEN ?? Bun.env.GH_TOKEN ?? undefined;
}

function headersWithAuth(etag?: string): Record<string, string> {
	const token = getGitHubToken();
	const base = ghHeaders(token ?? "", false);
	if (!token) delete base.Authorization;
	base.Accept = "application/vnd.github.v3.raw";
	if (etag) base["If-None-Match"] = etag;
	return base;
}

export async function fetchReadmeWithCache(
	repoId: number,
	nameWithOwner: string,
	maxBytes = 200_000,
	forceRefresh = false,
	fetchImpl?: FetchLike,
	database?: Database,
): Promise<string | null> {
	const [owner, repo] = nameWithOwner.split("/");
	const db = withDB(database);
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

	if (res.status === 304) {
		if (existing?.readme_md) {
			db.query<unknown, [string, number]>(
				`UPDATE repo SET readme_fetched_at = ? WHERE id = ?`,
			).run(now, repoId);
			return existing.readme_md;
		}
		return null;
	}

	if (res.status === 404) return null;

	if (!res.ok) {
		const remain = res.headers.get("X-RateLimit-Remaining");
		const reset = res.headers.get("X-RateLimit-Reset");
		console.warn(
			`GitHub ${res.status} ${res.statusText} for ${nameWithOwner} (remaining=${remain ?? "?"}, reset=${reset ?? "?"})`,
		);
		if (existing?.readme_md)
			db.query<unknown, [string, number]>(
				`UPDATE repo SET readme_fetched_at = ? WHERE id = ?`,
			).run(now, repoId);
		return existing?.readme_md ?? null;
	}

	const body = await res.text();
	const md = body.slice(0, maxBytes);
	const etag = res.headers.get("ETag") ?? null;

	db.query<unknown, [string | null, string | null, string, number]>(
		`UPDATE repo SET readme_md = ?, readme_etag = ?, readme_fetched_at = ? WHERE id = ?`,
	).run(md, etag, now, repoId);
	return md;
}

// ---------- clean + chunk ----------

export function cleanMarkdown(md: string): string {
	// keep stripFrontmatter (your impl), then normalise/collapse safely
	const withoutFrontmatter = stripFrontmatter(md);
	const nn = normaliseNewlines(withoutFrontmatter);
	// collapse runs of blank lines to at most two
	const s = stripFrontmatter(md);
	return collapseBlankRuns(s).trim();
}

export function chunkMarkdown(
	md: string,
	opts: ChunkingOptions = {},
): string[] {
	const {
		chunkSizeTokens = 768,
		chunkOverlapTokens = 80,
		mode = "sentence", // "sentence" | "token"
		// countTokens,                      // optional hook if you want exact tokenizer
	} = opts;

	const size = Math.max(1, chunkSizeTokens | 0);
	const overlap = Math.max(0, Math.min(chunkOverlapTokens | 0, size - 1));
	const step = Math.max(1, size - overlap);

	const text = normaliseNewlines(md).trim();
	if (!text) return [];

	// Core token stream: whitespace-split words
	const words = splitWhitespace(text);

	// Boundary bias (sentence mode only): try to end windows near markdownSplitter edges
	let boundaries: number[] = [];
	if (mode === "sentence") {
		try {
			const segs = markdownSplitter(text, {
				minChunkSize: 300,
				maxChunkSize: 1800,
				useHeadingsOnly: false,
			});
			boundaries = boundaryWordIndices(text, segs);
		} catch {
			boundaries = [];
		}
	}

	const out: string[] = [];
	const slack = Math.min(Math.floor(size / 4), 32); // how far we allow snapping

	for (let start = 0; start < words.length; ) {
		let end = start + size;
		if (end >= words.length) {
			out.push(words.slice(start).join(" "));
			break;
		}

		if (boundaries.length) {
			const snapped = snapEndToBoundary(end, boundaries, slack);
			if (snapped > start) end = snapped;
		}

		out.push(words.slice(start, end).join(" "));
		start += step;
	}

	return out;
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

// ---------- heuristics ----------

function looksLikeDirectoryRepo(
	nameWithOwner: string,
	description?: string | null,
	topics?: string[],
): boolean {
	const name = nameWithOwner.toLowerCase();
	const desc = (description ?? "").toLowerCase();
	const topicHit = (topics ?? []).some((t) => {
		const x = t.toLowerCase();
		return (
			x.includes("awesome") ||
			x.includes("list") ||
			x.includes("curated") ||
			x.includes("link")
		);
	});
	const nameHit =
		name.startsWith("awesome") ||
		name.includes("awesome-") ||
		name.endsWith("awesome") ||
		name.includes("list");
	const descHit =
		desc.includes("curated list") ||
		desc.includes("awesome list") ||
		desc.includes("directory") ||
		desc.includes("index");
	return topicHit || nameHit || descHit;
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
	const candidates = chunks
		.map((t) => t.trim())
		.filter((t) => t.length > 200 && linkDensity(t) < 0.35);
	if (candidates.length === 0) return [];

	const [qv] = await embed([query]);
	const cvs = await embed(candidates);

	const scored = cvs.map((v, i) => {
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

	// try cosine chunker; fallback to our deterministic windowing
	let chunks: string[] = [];
	try {
		const embedFn = opts.embed;
		if (embedFn) {
			const chunker = cosineDropChunker(embedFn);
			chunks = await chunker.chunk(pruned, {
				type: "markdown",
				breakPercentile: 95,
				minChunkSize: 300,
				maxChunkSize: 2000,
				overlapSize: 1,
			});
		}
	} catch (e) {
		console.warn(
			"Cosine chunker failed, falling back to windowing",
			e instanceof Error ? e.message : e,
		);
	}

	if (!chunks || chunks.length === 0) {
		chunks = chunkMarkdown(pruned, {
			chunkSizeTokens: 768,
			chunkOverlapTokens: 80,
			mode: "sentence",
		});
	}

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
