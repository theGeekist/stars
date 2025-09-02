// src/lib/summarise_batch.ts

import { createSummariseService } from "@features/summarise/service";
import { db, initSchema } from "@lib/db";
import { summariseRepoOneParagraph, type SummariseDeps } from "@lib/summarise";
import { createLogger } from "@lib/logger";
import { parseSimpleArgs, SIMPLE_USAGE } from "@lib/cli";
import type { RepoRow } from "@lib/types";

initSchema();
// ---- CLI args (simplified via src/lib/cli.ts) --------------------------------

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
export async function summariseBatchAll(
	limit: number,
	apply: boolean,
	deps?: SummariseDeps,
): Promise<void> {
	const log = createLogger();
	const svc = createSummariseService();
	const rows = svc.selectRepos({ limit, resummarise: false });

	if (!rows.length) {
		log.info("No repos matched the criteria.");
		return;
	}

	for (const r of rows) {
		log.header(r.name_with_owner);
		log.info("URL:", r.url);
		log.info("Lang:", r.primary_language ?? "-");
		log.info("--- generating summary ...");

		const paragraph = await summariseRepoOneParagraph(
			{
				repoId: r.id,
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
			},
			deps,
		);

		log.line("\n" + paragraph);
		log.info(`(${wc(paragraph)} words)`);

		if (apply) {
			svc.saveSummary(r.id, paragraph);
			log.success("saved to repo.summary\n");
		} else {
			log.info("dry run (not saved)\n");
		}
	}
}

export async function summariseOne(
	selector: string,
	apply: boolean,
	deps?: SummariseDeps,
): Promise<void> {
	const log = createLogger();
	const row = db
		.query<RepoRow, [string]>(
			`SELECT id, name_with_owner, url, description, primary_language, topics,
              stars, forks, popularity, freshness, activeness, pushed_at, last_commit_iso, last_release_iso, updated_at, summary
       FROM repo WHERE name_with_owner = ?`,
		)
		.get(selector);

	if (!row) {
		log.error(`repo not found: ${selector}`);
		return;
	}

	log.header(row.name_with_owner);
	log.info("URL:", row.url);
	log.info("Lang:", row.primary_language ?? "-");
	log.info("--- generating summary ...");

	const paragraph = await summariseRepoOneParagraph(
		{
			repoId: row.id,
			nameWithOwner: row.name_with_owner,
			url: row.url,
			description: row.description,
			primaryLanguage: row.primary_language ?? undefined,
			topics: parseStringArray(row.topics),
			metrics: {
				popularity: row.popularity ?? 0,
				freshness: row.freshness ?? 0,
				activeness: row.activeness ?? 0,
			},
		},
		deps,
	);

	log.line("\n" + paragraph);
	log.info(`(${wc(paragraph)} words)`);

	if (apply) {
		const svc = createSummariseService();
		svc.saveSummary(row.id, paragraph);
		log.success("saved to repo.summary\n");
	} else {
		log.info("dry run (not saved)\n");
	}
}

// CLI entry (unified simple flags)
if (import.meta.main) {
	const log = createLogger();
	const s = parseSimpleArgs(Bun.argv);

	if (s.mode === "one") {
		if (!s.one) {
			log.error("--one requires a value");
			log.line(SIMPLE_USAGE);
			process.exit(1);
		}
		await summariseOne(s.one, s.apply);
	} else {
		const limit = Math.max(1, s.limit ?? 10);
		log.info(`Summarise --all limit=${limit} apply=${s.apply}`);
		await summariseBatchAll(limit, s.apply);
	}
}
