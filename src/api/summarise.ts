// src/api/summarise.ts
import type { Database } from "bun:sqlite";
import { summariseRepoOneParagraph } from "@features/summarise/llm";
import { createSummariseService } from "@features/summarise/service";
import type { SummariseDeps } from "@features/summarise/types";
import { log as realLog } from "@lib/bootstrap";
import { withDB } from "@lib/db";
import type { RepoRow } from "@lib/types";

import type { SummariseBatchOpts } from "./types";
import { parseStringArray, withSpinner, wordCount } from "./utils";

/* ------------------------------ Adapters ------------------------------ */

/** Pure adapter: DB row -> LLM input payload */
export function toSummariseInput(row: RepoRow) {
	return {
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
	};
}

/** Generate a single-paragraph summary for a repo row. */
export async function generateSummaryForRow(
	row: RepoRow,
	deps?: SummariseDeps,
	logger?: typeof realLog,
) {
	const label = `Generating summary for ${row.name_with_owner}...`;
	const { paragraph } = await withSpinner(
		logger ?? realLog,
		label,
		async () => {
			const p = await summariseRepoOneParagraph(toSummariseInput(row), deps);
			return { paragraph: p };
		},
	);
	const words = wordCount(paragraph);
	(logger ?? realLog).success(`Summary ready (${words} words)`);
	return { paragraph, words };
}

/** Save summary if apply=true; otherwise log dry-run. */
export function saveSummaryOrDryRun(
	svc: ReturnType<typeof createSummariseService>,
	rowId: number,
	paragraph: string,
	apply: boolean,
	logger: typeof realLog,
) {
	if (!apply) {
		logger.info("dry run (not saved)\n");
		return;
	}
	const spin = logger.spinner("Saving to repo.summary").start();
	try {
		svc.saveSummary(rowId, paragraph);
		spin.succeed("Saved");
	} catch (e) {
		spin.stop();
		const msg = e instanceof Error ? e.message : String(e);
		logger.error(msg);
	}
	logger.line("");
}

/* ---------------------------- Orchestrators --------------------------- */

export async function summariseBatchAllCore(
	limit: number,
	apply: boolean,
	deps: SummariseDeps | undefined,
	opts: SummariseBatchOpts | undefined,
	database: Database | undefined,
	logger: typeof realLog,
): Promise<void> {
	const svc = createSummariseService(database);
	const rows = svc.selectRepos({ limit, resummarise: !!opts?.resummarise });

	if (!rows.length) {
		logger.info("No repos matched the criteria.");
		return;
	}

	const total = rows.length;
	logger.info(`Summarising ${total} repos...`);

	for (let i = 0; i < total; i++) {
		const r = rows[i];
		logger.header(`[${i + 1}/${total}] ${r.name_with_owner}`);
		logger.info(`URL: ${r.url}`);
		if (r.primary_language) logger.info(`Lang: ${r.primary_language}`);

		try {
			const { paragraph } = await generateSummaryForRow(r, deps, logger);
			logger.line("");
			logger.line(paragraph);
			logger.line("");
			saveSummaryOrDryRun(svc, r.id, paragraph, apply, logger);
		} catch (e) {
			const msg = e instanceof Error ? e.message : String(e);
			logger.error(`${msg}\n`);
			// continue with next row
		}
	}
}

export async function summariseOneCore(
	selector: string,
	apply: boolean,
	deps: SummariseDeps | undefined,
	database: Database | undefined,
	logger: typeof realLog,
): Promise<void> {
	const db = withDB(database);
	const row = db
		.query<RepoRow, [string]>(
			`SELECT id, name_with_owner, url, description, primary_language, topics,
              stars, forks, popularity, freshness, activeness, pushed_at, last_commit_iso, last_release_iso, updated_at, summary
       FROM repo WHERE name_with_owner = ?`,
		)
		.get(selector);

	if (!row) {
		logger.error(`repo not found: ${selector}`);
		return;
	}

	logger.header(row.name_with_owner);
	logger.info("URL:", row.url);
	if (row.primary_language) logger.info("Lang:", row.primary_language);

	const svc = createSummariseService(database);

	try {
		const { paragraph } = await generateSummaryForRow(row, deps, logger);
		logger.line("");
		logger.line(paragraph);
		logger.line("");
		saveSummaryOrDryRun(svc, row.id, paragraph, apply, logger);
	} catch (e) {
		const msg = e instanceof Error ? e.message : String(e);
		logger.error(`${msg}\n`);
	}
}

/* --------------------------- Public CLI API --------------------------- */
/** Public API preserved */
export async function summariseBatchAll(
	limit: number,
	apply: boolean,
	deps?: SummariseDeps,
	opts?: SummariseBatchOpts,
	database?: Database,
): Promise<void> {
	await summariseBatchAllCore(limit, apply, deps, opts, database, realLog);
}

/** Public API preserved */
export async function summariseOne(
	selector: string,
	apply: boolean,
	deps?: SummariseDeps,
	database?: Database,
): Promise<void> {
	await summariseOneCore(selector, apply, deps, database, realLog);
}
