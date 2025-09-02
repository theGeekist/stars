// src/lib/summarise_batch.ts

import { createSummariseService } from "@features/summarise/service";
import { initSchema } from "@lib/db";
import { summariseRepoOneParagraph } from "@lib/summarise";
import type { RepoRow } from "@lib/types";

initSchema();
// ---- CLI args ---------------------------------------------------------------
export type Args = {
	limit: number; // how many to process
	dry: boolean; // don't write to DB
	resummarise: boolean; // include repos that already have summary
	slug?: string; // only repos from a specific list slug
};

function parseArgs(argv: string[]): Args {
	let limit = 10;
	let dry = false;
	let resummarise = false;
	let slug: string | undefined;

	for (let i = 2; i < argv.length; i++) {
		const a = argv[i];
		if (/^\d+$/.test(a)) {
			limit = Number(a);
			continue;
		}
		if (a === "--dry") {
			dry = true;
			continue;
		}
		if (a === "--resummarise" || a === "--resummarize") {
			resummarise = true;
			continue;
		}
		if (a === "--slug" && argv[i + 1]) {
			slug = argv[++i];
		}
	}
	return { limit, dry, resummarise, slug };
}

// No local prepared queries — handled by summarise service

// ---- Helpers ----------------------------------------------------------------
function parseStringArray(jsonText: string | null): string[] {
	if (!jsonText) return [];
	try {
		const arr = JSON.parse(jsonText);
		return Array.isArray(arr) ? arr.filter((s) => typeof s === "string") : [];
	} catch {
		return [];
	}
}

function formatNum(n: number | null | undefined): string {
	if (n == null) return "-";
	if (n >= 1000) return `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k`;
	return String(n);
}

function wc(s: string): number {
	return s.trim().split(/\s+/).filter(Boolean).length;
}

function chooseFreshnessSource(opts: {
	pushed_at?: string | null;
	last_commit_iso?: string | null;
	last_release_iso?: string | null;
	updated_at?: string | null;
}): string | null {
	return (
		opts.pushed_at ??
		opts.last_commit_iso ??
		opts.last_release_iso ??
		opts.updated_at ??
		null
	);
}

function annotateHeader(r: RepoRow): string {
	const tags = parseStringArray(r.topics).slice(0, 6).join(", ");
	const stars = formatNum(r.stars);
	const forks = formatNum(r.forks);
	const pop = r.popularity?.toFixed(2) ?? "-";
	const fresh = r.freshness?.toFixed(2) ?? "-";
	const act = r.activeness?.toFixed(2) ?? "-";
	const upd = chooseFreshnessSource(r);

	return [
		`▶ ${r.name_with_owner}`,
		`   URL      : ${r.url}`,
		`   Lang     : ${r.primary_language ?? "-"}`,
		`   Stars    : ${stars}   Forks: ${forks}`,
		`   Metrics  : popularity=${pop}  freshness=${fresh}  activeness=${act}`,
		`   Updated  : ${upd}`,
		`   Topics   : ${tags || "-"}`,
		r.description ? `   Desc     : ${r.description}` : undefined,
	]
		.filter(Boolean)
		.join("\n");
}

// ---- Main -------------------------------------------------------------------
export async function summariseBatch(args: Args): Promise<void> {
	const svc = createSummariseService();
	const rows = svc.selectRepos({
		limit: args.limit,
		slug: args.slug,
		resummarise: args.resummarise,
	});

	if (!rows.length) {
		console.log("No repos matched the criteria.");
		return;
	}

	for (const r of rows) {
		console.log(annotateHeader(r));
		console.log("   --- generating summary ...");

		const paragraph = await summariseRepoOneParagraph({
			repoId: r.id, // ← pass it
			nameWithOwner: r.name_with_owner,
			url: r.url,
			description: r.description,
			primaryLanguage: r.primary_language ?? undefined,
			topics: parseStringArray(r.topics),
			metrics: {
				popularity: r.popularity ?? 0,
				freshness: r.freshness ?? 0,
				activeness: r.activeness ?? 0,
			},
		});

		// Show result to console
		console.log(`\n${paragraph}\n(${wc(paragraph)} words)\n`);

		if (!args.dry) {
			svc.saveSummary(r.id, paragraph);
			console.log("   ✓ saved to repo.summary\n");
		} else {
			console.log("   • dry run (not saved)\n");
		}
	}
}

// CLI entry
if (import.meta.main) {
	const args = parseArgs(Bun.argv);
	console.log(
		`Batch summarise: limit=${args.limit} dry=${args.dry} resummarise=${args.resummarise}` +
			(args.slug ? ` slug=${args.slug}` : ""),
	);
	await summariseBatch(args);
}
