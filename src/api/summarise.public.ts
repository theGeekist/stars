import type { Database } from "bun:sqlite";
import type { SummariseDeps } from "@features/summarise/types";
import { log as realLog } from "@lib/bootstrap";
import { withDB } from "@lib/db";
import type {
	BatchResult,
	ModelConfig,
	ProgressEvent,
	SummaryItemResult,
} from "./public.types";
import { buildBatchStats } from "./public.types";

/**
 * Create summarisation deps (LLM gen) from a `ModelConfig`.
 * Used when the caller does not inject full `deps`.
 */
function createSummariseDepsFromConfig(cfg: ModelConfig): SummariseDeps {
	// Lazy require to avoid upfront cost if not used
	const { gen } = require("@lib/ollama");
	return {
		gen: async (prompt: string, _opts?: Record<string, unknown>) => {
			const headers = cfg.apiKey
				? { Authorization: `Bearer ${cfg.apiKey}` }
				: undefined;
			return gen(prompt, { model: cfg.model, host: cfg.host, headers });
		},
	};
}

/**
 * Options for `summariseAll` batch operation.
 * - `resummarise: true` will re-summarise repos that already have summaries.
 * - `onProgress` emits phase `summarising` with incremental counters.
 */
export interface SummariseAllOptions {
	limit?: number;
	dry?: boolean;
	resummarise?: boolean;
	deps?: SummariseDeps;
	// NOTE: alternative lightweight LLM config when full deps not provided
	modelConfig?: ModelConfig;
	db?: Database;
	logger?: typeof realLog;
	onProgress?: (e: ProgressEvent) => void;
}

/** Options for summarising a single repository. */
export interface SummariseOneOptions {
	selector: string;
	dry?: boolean;
	deps?: SummariseDeps;
	// NOTE: alternative lightweight LLM config when full deps not provided
	modelConfig?: ModelConfig;
	db?: Database;
	logger?: typeof realLog;
}

/**
 * Generate summaries for a batch of repositories.
 * Selection logic matches the summarise service (README-first ordering).
 * Returns a structured batch result with per-item status and paragraph metadata.
 */
export async function summariseAll(
	options: SummariseAllOptions = {},
): Promise<BatchResult<SummaryItemResult>> {
	const {
		limit = 50,
		dry = false,
		resummarise = false,
		deps,
		modelConfig,
		db,
		logger = realLog,
		onProgress,
	} = options;
	const _apply = !dry;

	// We replay the logic similarly to summariseBatchAllCore but capture results.
	// Since the existing core handles selection + logging + saving, we re-query for rows.
	// To avoid duplication, we minimally reproduce selection here using service.
	const { createSummariseService } = await import(
		"@features/summarise/service"
	);
	const { generateSummaryForRow, saveSummaryOrDryRun } = await import(
		"./summarise"
	);

	const svc = createSummariseService(db);
	const rows = svc.selectRepos({ limit, resummarise });
	if (!rows.length) {
		return {
			items: [],
			stats: { processed: 0, succeeded: 0, failed: 0, saved: 0 },
		};
	}
	const items: SummaryItemResult[] = [];
	// Resolve deps precedence: explicit deps > modelConfig > undefined (env fallback)
	const effectiveDeps = deps
		? deps
		: modelConfig
			? createSummariseDepsFromConfig(modelConfig)
			: undefined;

	for (let i = 0; i < rows.length; i++) {
		const r = rows[i];
		onProgress?.({
			phase: "summarising",
			index: i + 1,
			total: rows.length,
			repo: r.name_with_owner,
		});
		try {
			const { paragraph, words } = await generateSummaryForRow(
				r,
				effectiveDeps,
				logger,
			);
			// Save or dry run
			saveSummaryOrDryRun(svc, r.id, paragraph, dry, logger);
			items.push({
				repoId: r.id,
				nameWithOwner: r.name_with_owner,
				paragraph,
				words,
				saved: !dry,
				status: "ok",
			});
		} catch (e) {
			items.push({
				repoId: r.id,
				nameWithOwner: r.name_with_owner,
				saved: false,
				status: "error",
				error: e instanceof Error ? e.message : String(e),
			});
		}
	}
	return { items, stats: buildBatchStats(items) };
}

/** Summarise a single repository identified by its `owner/name` slug. */
export async function summariseRepo(
	options: SummariseOneOptions,
): Promise<SummaryItemResult> {
	const {
		selector,
		dry = false,
		deps,
		modelConfig,
		db,
		logger = realLog,
	} = options;
	const _apply = !dry;
	const database = withDB(db);
	const row = database
		.query<import("@lib/types").RepoRow, [string]>(
			`SELECT id, name_with_owner, url, description, primary_language, topics,
              stars, forks, popularity, freshness, activeness, pushed_at, last_commit_iso, last_release_iso, updated_at, summary
       FROM repo WHERE name_with_owner = ?`,
		)
		.get(selector);
	if (!row) {
		return {
			repoId: -1,
			nameWithOwner: selector,
			saved: false,
			status: "error",
			error: "repo not found",
		};
	}
	try {
		const effectiveDeps = deps
			? deps
			: modelConfig
				? createSummariseDepsFromConfig(modelConfig)
				: undefined;
		const { paragraph, words } = await (
			await import("./summarise")
		).generateSummaryForRow(row, effectiveDeps, logger);
		const svc = (
			await import("@features/summarise/service")
		).createSummariseService(db);
		(await import("./summarise")).saveSummaryOrDryRun(
			svc,
			row.id,
			paragraph,
			dry,
			logger,
		);
		return {
			repoId: row.id,
			nameWithOwner: row.name_with_owner,
			paragraph,
			words,
			saved: !dry,
			status: "ok",
		};
	} catch (e) {
		return {
			repoId: row.id,
			nameWithOwner: row.name_with_owner,
			saved: false,
			status: "error",
			error: e instanceof Error ? e.message : String(e),
		};
	}
}

/** @deprecated Use summariseAll */
export const summariseBatchAll = summariseAll;
/** @deprecated Use summariseRepo */
export const summariseOne = summariseRepo;
