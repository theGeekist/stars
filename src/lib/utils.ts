export function isObject(x: unknown): x is Record<string, unknown> {
	return typeof x === "object" && x !== null;
}

export function slugify(name: string): string {
	return name
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/(^-|-$)/g, "");
} /** Safe parser for JSON-encoded arrays */
export function parseJsonArray(value: unknown): string[] {
	if (typeof value !== "string" || value.length === 0) return [];
	try {
		const arr = JSON.parse(value);
		return Array.isArray(arr) ? arr.filter((x) => typeof x === "string") : [];
	} catch {
		return [];
	}
}

export function toNum(x: unknown): number | null {
	if (typeof x === "number" && Number.isFinite(x)) return x;
	if (typeof x === "string") {
		const n = Number(x.trim());
		if (Number.isFinite(n)) return n;
	}
	return null;
}

export function parseStringArray(jsonText: string | null): string[] {
	if (!jsonText) return [];
	try {
		const arr = JSON.parse(jsonText);
		return Array.isArray(arr) ? arr.filter((s) => typeof s === "string") : [];
	} catch {
		return [];
	}
}

export function formatNum(n: number | null | undefined): string {
	if (n == null) return "-";
	if (n >= 1000) return `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k`;
	return String(n);
}

/** Count words in a string. */
export function wordCount(s: string): number {
	return s.trim().split(/\s+/).filter(Boolean).length;
}

// Tighter, linear-time link detectors (precompiled once)
// src/lib/text-hygiene.ts

/** ──────────────────────────────────────────────────────────────────────────
 *  Safe, precompiled patterns
 *  ────────────────────────────────────────────────────────────────────────── */
export const MD_LINK_RE = /\[[^\]\n]+\]\([^) \t\r\n]+(?:\s+"[^"\r\n]*")?\)/u;
export const URL_RE = /https?:\/\/\S+/iu;
export const LINKISH_RE = new RegExp(
	`(?:${MD_LINK_RE.source})|(?:${URL_RE.source})`,
	"iu",
);

// Leading bullets, ordered items, or pipe-table rows.
export const BULLET_RE = /^\s*(?:[-*+]\s|\d+\.\s|\|)/u;

// Triple-fence code blocks: ``` or ~~~ (language optional)
const FENCE_START_RE = /^(?:```|~~~)/u;

/** Fast path check to avoid regex when obviously not linkish. */
export function isLinkishLine(l: string): boolean {
	if (!l.includes("](") && !l.includes("http")) return false;
	return LINKISH_RE.test(l);
}

/** Ratio of non-empty lines that look like links (markdown link or raw URL). */
export function linkDensity(s: string): number {
	const lines = s.split(/\r?\n/);
	let nonEmpty = 0,
		linkish = 0;
	for (const l of lines) {
		if (l.trim() === "") continue;
		nonEmpty++;
		if (isLinkishLine(l)) linkish++;
	}
	return nonEmpty === 0 ? 0 : linkish / nonEmpty;
}

/** Remove fenced code blocks (```…``` or ~~~…~~~). O(n), no backtracking. */
export function stripFencedCode(md: string): string {
	const out: string[] = [];
	const lines = md.split(/\r?\n/);
	let inFence = false;
	let fenceToken: "```" | "~~~" | null = null;

	for (const l of lines) {
		if (!inFence && FENCE_START_RE.test(l)) {
			inFence = true;
			fenceToken = l.startsWith("```") ? "```" : "~~~";
			continue;
		}
		if (inFence && fenceToken && l.startsWith(fenceToken)) {
			inFence = false;
			fenceToken = null;
			continue;
		}
		if (!inFence) out.push(l);
	}
	return out.join("\n");
}

export type StripCatalogueOptions = {
	/** Remove a “catalogue block” if ≥ this fraction of its lines are linkish. */
	linkThreshold?: number; // default 0.40
	/** Minimum consecutive lines to treat as a block worth evaluating. */
	minBlockLines?: number; // default 3
	/**
	 * If true, treat any block consisting entirely of bullet/table lines as
	 * catalogue regardless of link density (common in link-farms).
	 */
	dropPureListBlocks?: boolean; // default true
	/** Collapse >N blank lines to exactly N. */
	maxBlankGap?: number; // default 1
};

/**
 * Strip long catalogue sections (bulleted link farms, companies tables, etc.).
 * Safe, single-pass grouping with configurable heuristics.
 */
export function stripCatalogue(
	md: string,
	opts: StripCatalogueOptions = {},
): string {
	const {
		linkThreshold = 0.4,
		minBlockLines = 3,
		dropPureListBlocks = true,
		maxBlankGap = 1,
	} = opts;

	// 1) Remove fenced code first (they bloat tokens and can look “cataloguey”).
	const noCode = stripFencedCode(md);

	// 2) Group into candidate blocks (runs of bulletish or linkish lines).
	const lines = noCode.split(/\r?\n/);
	const out: string[] = [];
	let buf: string[] = [];
	let blankRun = 0;

	const flush = () => {
		if (buf.length === 0) return;
		const block = buf.join("\n");
		const pureList = buf.every((l) => BULLET_RE.test(l.trim()));
		const dense = linkDensity(block);
		const shouldDrop =
			(buf.length >= minBlockLines && dense >= linkThreshold) ||
			(dropPureListBlocks && pureList && buf.length >= minBlockLines);

		if (!shouldDrop) out.push(block);

		buf = [];
	};

	for (const l of lines) {
		const bulletish = BULLET_RE.test(l);
		const linkish = isLinkishLine(l);

		if (bulletish || linkish) {
			buf.push(l);
			blankRun = 0;
		} else {
			flush();
			// keep non-catalogue line, managing blank gaps
			if (l.trim() === "") {
				if (blankRun < maxBlankGap) out.push("");
				blankRun++;
			} else {
				out.push(l);
				blankRun = 0;
			}
		}
	}
	flush();

	// 3) Final trim of leading/trailing blanks.
	// (We already capped internal blank runs.)
	return out.join("\n").trim();
}

// src/lib/text.ts
export type WordCapOptions = {
	/** If true, append "…" instead of punctuation when text is truncated. */
	ellipsis?: boolean; // default: false
	/** Terminal punctuation to ensure when truncated and not using ellipsis. */
	terminal?: "." | "!" | "?" | ""; // default: "."
	/** Treat hyphenated tokens as one word (e.g. "state-of-the-art"). */
	keepHyphenCompounds?: boolean; // default: true
};

export function enforceWordCap(
	s: string,
	cap = 100,
	opts: WordCapOptions = {},
): string {
	const { ellipsis = false, terminal = ".", keepHyphenCompounds = true } = opts;

	const input = s.trim();
	if (input === "") return "";

	// Prefer Unicode-aware segmentation; fall back to a safe split.
	const words: string[] = [];
	if (typeof Intl.Segmenter === "function") {
		const seg = new Intl.Segmenter("en", { granularity: "word" });
		for (const { segment, isWordLike } of seg.segment(input)) {
			if (!isWordLike) continue;
			if (keepHyphenCompounds || !segment.includes("-")) {
				words.push(segment);
			} else {
				words.push(...segment.split("-").filter(Boolean));
			}
			if (words.length >= cap) break;
		}
	} else {
		// Fallback: collapse unicode whitespace, then split
		const collapsed = input.replace(/\s+/gu, " ");
		const raw = collapsed.split(" ");
		if (keepHyphenCompounds) {
			words.push(...raw.slice(0, cap));
		} else {
			for (const w of raw) {
				const parts = w.split("-").filter(Boolean);
				for (const p of parts) {
					words.push(p);
					if (words.length >= cap) break;
				}
				if (words.length >= cap) break;
			}
		}
	}

	// If we didn’t exceed the cap (common case), return a normalised original.
	// Normalise whitespace to avoid surprising downstream diffs.
	const normalised = input.replace(/\s+/gu, " ");
	const normalisedCount = normalised.split(" ").length;
	if (normalisedCount <= cap) return normalised;

	const out = words.join(" ");
	if (ellipsis) return out.endsWith("…") ? out : `${out}…`;
	if (terminal === "") return out;
	if (!out) return out;
	const last = out.charAt(out.length - 1); // "" if out === ""
	return last === "." || last === "!" || last === "?" || last === "…"
		? out
		: out + terminal;
}

/** Cosine similarity for two equal-length vectors. */
export function cosine(a: number[], b: number[]): number {
	let dot = 0,
		na = 0,
		nb = 0;
	for (let i = 0; i < a.length; i++) {
		dot += a[i] * b[i];
		na += a[i] * a[i];
		nb += b[i] * b[i];
	}
	return dot / (Math.sqrt(na) * Math.sqrt(nb) + 1e-9);
}

/** Fast awesome-list detection from metadata (+ optional README first-line). */
export function isAwesomeList(
	nameWithOwner: string,
	description?: string | null,
	topics?: string[],
	readmeFirstLine?: string,
): boolean {
	const name = nameWithOwner.toLowerCase();
	const desc = (description || "").toLowerCase();
	const tops = (topics || []).map((t) => t.toLowerCase());

	const metaHit =
		name.includes("awesome-") ||
		name.endsWith("/awesome") ||
		desc.includes("awesome list") ||
		tops.some((t) =>
			[
				"awesome",
				"awesome-list",
				"awesome-lists",
				"awesome-collection",
			].includes(t),
		);

	const readmeHit = readmeFirstLine
		? /^#\s*awesome\b/i.test(readmeFirstLine.trim())
		: false;

	return metaHit || readmeHit;
}

/** Stable generic paragraph for awesome lists. */
export function summariseAwesomeList(
	description?: string | null,
	topics?: string[],
	cap = 90,
): string {
	const cats = (topics || [])
		.filter((t) => !/awesome/i.test(t))
		.slice(0, 4)
		.join(", ");
	const scopeHint =
		cats || (description ? description.replace(/\s+/g, " ").trim() : "");
	const base =
		`A curated “awesome” list that aggregates noteworthy repositories and resources for ` +
		`${scopeHint || "its domain"}. It focuses on discoverability over implementation, ` +
		`offering links, brief descriptions, and signposts to guides and tools. Best used ` +
		`as a jumping-off point for research and comparing options; the project itself is ` +
		`a catalogue rather than a library.`;
	return enforceWordCap(base, cap);
}

/** Locale-aware alphabetical compare for stable sorting. */
export function compareAlpha(a: string, b: string): number {
	return String(a).localeCompare(String(b));
}

// ───────────────────────────────────────────────────────────────────────────────
// 3) YAML front-matter stripper
// Before:  /^---\s*[\s\S]*?\s*---\s*\n/
// Risk:    "match anything" across the whole doc; if closing '---' missing, it
//          scans the entire string. Not catastrophic, but unnecessarily expensive.
//
// After (no regex): single pass, newline-bounded; O(n), no backtracking.
export function stripFrontmatter(md: string): string {
	if (!md.startsWith("---")) return md;
	// find end fence beginning at a new line to avoid false positives in content
	const endFenceIdx = md.indexOf("\n---", 3);
	if (endFenceIdx === -1) return md; // no closing fence; leave intact
	const afterFenceNL = md.indexOf("\n", endFenceIdx + 4);
	return afterFenceNL === -1 ? "" : md.slice(afterFenceNL + 1);
}
