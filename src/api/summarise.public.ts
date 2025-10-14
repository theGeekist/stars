import type { Database } from "bun:sqlite";
import type { SummariseDeps } from "@features/summarise/types";
import { createSummariseService } from "@features/summarise/service";
import { log as realLog } from "@lib/bootstrap";
import { withDB } from "@lib/db";
import type {
	BatchResult,
	ModelConfig,
	ProgressEmitter,
	SummaryItemResult,
} from "./public.types";
import {
	buildBatchStats,
	createSummariseDepsFromConfig,
	resolveModelConfig,
} from "./public.types";
import { runSummariseRows, selectSummariseRows } from "./summarise.runner";

function resolveSummariseDeps(
	deps: SummariseDeps | undefined,
	modelConfig: ModelConfig | undefined,
): SummariseDeps | undefined {
	if (deps) return deps;
	if (modelConfig) {
		return createSummariseDepsFromConfig(
			resolveModelConfig(modelConfig, {
				help: "Set OLLAMA_MODEL or pass options.modelConfig.model for summarisation.",
			}),
		);
	}
	return undefined;
}

/**
 * Options for `summariseAll` batch operation.
 * - `resummarise: true` will re-summarise repos that already have summaries.
 * - Dependency precedence: explicit `deps` overrides `modelConfig`, which overrides env (`OLLAMA_*`).
 * - `onProgress` emits phase `summarising:repo` with incremental counters.
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
	onProgress?: ProgressEmitter<"summarising:repo">;
}

/**
 * Options for summarising a single repository.
 * Mirrors `SummariseAllOptions` precedence: `deps` > `modelConfig` > env defaults.
 */
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
	const svc = createSummariseService({ db });
	const rows = selectSummariseRows(svc, { limit, resummarise });
	if (!rows.length) {
		return {
			items: [],
			stats: { processed: 0, succeeded: 0, failed: 0, saved: 0 },
		};
	}
	const effectiveDeps = resolveSummariseDeps(deps, modelConfig);
	const items = await runSummariseRows(rows, {
		svc,
		dry,
		deps: effectiveDeps,
		logger,
		onProgress,
		database: db ? withDB(db) : undefined,
	});
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
		const effectiveDeps = resolveSummariseDeps(deps, modelConfig);
		const svc = createSummariseService({ db });
		const [result] = await runSummariseRows([row], {
			svc,
			dry,
			deps: effectiveDeps,
			logger,
			database: withDB(db),
		});
		return result;
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

export type {
	SummariseExecutionHooks,
	SummariseRunContext,
} from "./summarise.runner";
