import type { SummariseDeps } from "@features/summarise/types";
import type { log as realLog } from "@lib/bootstrap";
import { getDefaultDb, setDefaultDb, withDB } from "@lib/db";
import type { RepoRow } from "@lib/types";
import type { ProgressEmitter, SummaryItemResult } from "./public.types";
import { generateSummaryForRow, saveSummaryOrDryRun } from "./summarise";
import type { createSummariseService } from "@features/summarise/service";
import type { Database } from "bun:sqlite";

type SummariseService = ReturnType<typeof createSummariseService>;

export interface SummariseSelectionOptions {
	limit: number;
	resummarise?: boolean;
}

export interface SummariseExecutionHooks {
	beforeRow?: (payload: {
		repo: RepoRow;
		index: number;
		total: number;
	}) => void | Promise<void>;
	afterSuccess?: (payload: {
		repo: RepoRow;
		result: SummaryItemResult;
		index: number;
		total: number;
	}) => void | Promise<void>;
	afterError?: (payload: {
		repo: RepoRow;
		error: string;
		index: number;
		total: number;
	}) => void | Promise<void>;
}

export interface SummariseRunContext {
	svc: SummariseService;
	dry: boolean;
	deps?: SummariseDeps;
	logger: typeof realLog;
	onProgress?: ProgressEmitter<"summarising:repo">;
	hooks?: SummariseExecutionHooks;
	database?: Database;
}

export function selectSummariseRows(
	svc: SummariseService,
	options: SummariseSelectionOptions,
): RepoRow[] {
	const { limit, resummarise } = options;
	return svc.selectRepos({ limit, resummarise: !!resummarise });
}

export async function runSummariseRows(
	rows: RepoRow[],
	context: SummariseRunContext,
): Promise<SummaryItemResult[]> {
	const { svc, dry, deps, logger, onProgress, hooks, database } = context;
	if (rows.length === 0) return [];

	const items: SummaryItemResult[] = [];
	const providedDb = database ? withDB(database) : undefined;
	const previousDefault = providedDb ? getDefaultDb() : undefined;

	if (providedDb) {
		setDefaultDb(providedDb);
	}

	try {
		for (let i = 0; i < rows.length; i++) {
			const repo = rows[i];
			await hooks?.beforeRow?.({ repo, index: i, total: rows.length });
			await onProgress?.({
				phase: "summarising:repo",
				index: i + 1,
				total: rows.length,
				repo: repo.name_with_owner,
			});

			try {
				const { paragraph, words } = await generateSummaryForRow(
					repo,
					deps,
					logger,
				);

				saveSummaryOrDryRun(svc, repo.id, paragraph, dry, logger);

				const result: SummaryItemResult = {
					repoId: repo.id,
					nameWithOwner: repo.name_with_owner,
					paragraph,
					words,
					saved: !dry,
					status: "ok",
				};
				items.push(result);
				await hooks?.afterSuccess?.({
					repo,
					result,
					index: i,
					total: rows.length,
				});
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				const result: SummaryItemResult = {
					repoId: repo.id,
					nameWithOwner: repo.name_with_owner,
					saved: false,
					status: "error",
					error: message,
				};
				items.push(result);
				await hooks?.afterError?.({
					repo,
					error: message,
					index: i,
					total: rows.length,
				});
			}
		}
	} finally {
		if (previousDefault) {
			setDefaultDb(previousDefault);
		}
	}

	return items;
}
