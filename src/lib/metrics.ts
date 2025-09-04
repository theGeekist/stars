// src/libs/metrics.ts
export function deriveTags(input: {
	topics?: string[];
	primary_language?: string | null;
	license?: string | null;
	is_archived?: boolean;
	is_fork?: boolean;
	is_mirror?: boolean;
}): string[] {
	const t = new Set<string>();
	(input.topics ?? []).forEach((x) => {
		x && t.add(x);
	});
	if (input.primary_language)
		t.add(`lang:${input.primary_language.toLowerCase()}`);
	if (input.license) t.add(`license:${input.license.toLowerCase()}`);
	if (input.is_archived) t.add("archived");
	if (input.is_fork) t.add("fork");
	if (input.is_mirror) t.add("mirror");
	return Array.from(t);
}
// ----- POPULARITY -----------------------------------------------------------
// Inputs vary by orders of magnitude. Use a log to compress, then a sigmoid to
// keep values in [0,1] with a reasonable "midpoint".

export function scorePopularity(
	stars: number,
	forks: number,
	watchers: number,
	dbg?: (msg: string) => void,
): number {
	const weighted = 1 + stars + 2 * forks + 0.5 * watchers;
	const raw = Math.log10(Math.max(1, weighted)); // 0..~5.5+

	// Ceiling chosen so 99th percentile repos hit ~0.95 1.00; tweak if needed.
	const CEIL = 5;
	const s = Math.min(1, raw / CEIL);
	if (dbg && (Number.isNaN(s) || s === 0 || s === 1)) {
		console.log(
			`[metrics] popularity dbg raw=${raw.toFixed(4)} weighted=${weighted}`,
		);
	}
	return Number(s.toFixed(4));
}
// ----- helpers --------------------------------------------------------------
function clamp01(x: number): number {
	if (!Number.isFinite(x)) return 0;
	return Math.max(0, Math.min(1, x));
}

// ----- FRESHNESS ------------------------------------------------------------
// Exponential decay w/ half-life → perceptually nicer than linear.
// 90d half-life means: 0.5 @ 90d, 0.25 @ 180d, ~0.06 @ 1y.
export function scoreFreshnessFromISO(
	iso?: string | null,
	halfLifeDays = 90,
): number {
	if (!iso) return 0;
	const t = Date.parse(iso);
	if (Number.isNaN(t)) return 0;

	const days = (Date.now() - t) / 86400000;

	// last year should still look reasonably "fresh"
	if (days <= 365) {
		// linear: 0d -> 1.0, 365d -> 0.5
		const s = 1 - 0.5 * (days / 365);
		const v = Number(Math.max(0, Math.min(1, s)).toFixed(4));
		console.log(
			`[metrics] freshness<1y iso=${iso} days=${days.toFixed(1)} -> ${v}`,
		);
		return v;
	}

	// older than a year: tank with half-life
	const extra = days - 365;
	// const HALF_LIFE_DAYS = 365; // tweakable
	const s = 0.5 * 2 ** (-extra / halfLifeDays); // 2y≈0.25, 3y≈0.125
	const v = Number(Math.max(0, Math.min(1, s)).toFixed(4));
	console.log(
		`[metrics] freshness>1y iso=${iso} days=${days.toFixed(1)} -> ${v}`,
	);
	return v;
}
// Source precedence: code-first; updatedAt only if we have nothing else.
export function chooseFreshnessSource(opts: {
	pushedAt?: string | null;
	lastCommitISO?: string | null;
	lastReleaseISO?: string | null;
	updatedAt?: string | null;
}): string | null {
	return (
		opts.pushedAt ??
		opts.lastCommitISO ??
		opts.lastReleaseISO ??
		opts.updatedAt ??
		null
	);
}
// ----- ACTIVENESS -----------------------------------------------------------
// Two parts: (A) backlog density (log dampened, PRs > issues)
//            (B) recent code (freshness from pushedAt)
// Then blend and penalize if issues are disabled or repo is archived.
export function scoreActiveness(
	openIssues: number,
	openPRs: number,
	pushedAt?: string | null,
	opts?: { hasIssuesEnabled?: boolean; isArchived?: boolean },
): number {
	const backlogRaw = Math.max(0, openIssues + 2 * openPRs);
	const backlog = Math.log10(1 + backlogRaw); // dampen
	const backlogScore = Math.min(1, backlog / 3); // cap ~1 around 10^3 density

	// Recent push is the strongest live-signal
	const pushFresh = scoreFreshnessFromISO(pushedAt, 90);

	// Blend: emphasize code recency
	let s = 0.35 * backlogScore + 0.65 * pushFresh;

	// Light penalty if issues are off (reduced surface for activity)
	if (opts?.hasIssuesEnabled === false) s *= 0.85;

	// Heavy penalty for archived repos
	if (opts?.isArchived) s *= 0.25;

	return Number(clamp01(s).toFixed(4));
}
