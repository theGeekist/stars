import type { Database } from "bun:sqlite";
import type { createSummariseService } from "@features/summarise/service";
import type { SummariseDeps } from "@features/summarise/types";
import type { log as realLog } from "@lib/bootstrap";
import type { RepoRow } from "@lib/types";
import type { ProgressEmitter, SummaryItemResult } from "./public.types";
import { generateSummaryForRow, saveSummaryOrDryRun } from "./summarise";

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
	database: Database;
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
				database,
			);
			const persistence = saveSummaryOrDryRun(
				svc,
				repo.id,
				paragraph,
				dry,
				logger,
			);
			const result: SummaryItemResult = {
				repoId: repo.id,
				nameWithOwner: repo.name_with_owner,
				paragraph,
				words,
				saved: persistence.saved,
				status: !dry && !persistence.saved ? "error" : "ok",
				...(persistence.error ? { error: persistence.error } : {}),
			};
			items.push(result);

			if (result.status === "error") {
				await hooks?.afterError?.({
					repo,
					error: result.error ?? "summary was not persisted",
					index: i,
					total: rows.length,
				});
			} else {
				await hooks?.afterSuccess?.({
					repo,
					result,
					index: i,
					total: rows.length,
				});
			}
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			items.push({
				repoId: repo.id,
				nameWithOwner: repo.name_with_owner,
				saved: false,
				status: "error",
				error: message,
			});
			await hooks?.afterError?.({
				repo,
				error: message,
				index: i,
				total: rows.length,
			});
		}
	}

	return items;
}
