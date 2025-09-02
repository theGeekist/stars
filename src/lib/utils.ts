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

/** Trim to ≤ cap words; ensure graceful ending. */
export function enforceWordCap(s: string, cap = 100): string {
	const words = s.trim().split(/\s+/);
	if (words.length <= cap) return s.trim();
	return words
		.slice(0, cap)
		.join(" ")
		.replace(/[.,;:!?-]*$/, ".");
}

/** Ratio of lines that look like links; useful to down-weight catalogue-y chunks. */
export function linkDensity(s: string): number {
	const lines = s.split(/\r?\n/);
	if (lines.length === 0) return 0;
	const linkish = lines.filter((l) =>
		/\[[^\]]+\]\([^)]+\)|https?:\/\//i.test(l),
	).length;
	return linkish / lines.length;
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
