import type { Database } from "bun:sqlite";
import { createListsService } from "@features/lists";
import { createScoringService, DEFAULT_POLICY } from "@features/scoring";
import type { ScoringLLM } from "@features/scoring/llm";
import { scoreRepoAgainstLists } from "@features/scoring/llm";
import { createOllamaService } from "@jasonnathan/llm-core/ollama-service";
import type { log as realLog } from "@lib/bootstrap";
import { withDB } from "@lib/db";
import * as listsLib from "@lib/lists";
import type { RepoRow } from "@lib/types";
import { parseStringArray } from "@lib/utils";
import type {
	BatchResult,
	ModelConfig,
	ProgressEvent,
	RankingItemResult,
} from "./public.types";
import { buildBatchStats, getRequiredEnv } from "./public.types";

/**
 * Options for `rankAll` batch operation.
 * - Provide either a custom `llm` or a lightweight `modelConfig` (not both) to override environment defaults.
 * - When `dry` is false (default) the function persists scores and (if policy allows) applies membership updates to GitHub Lists.
 * - `onProgress` receives phase `ranking` with incremental index + total.
 */
export interface RankAllOptions {
	limit?: number;
	dry?: boolean;
	llm?: ScoringLLM;
	// NOTE: alternative lightweight adapter config when full llm not injected
	modelConfig?: ModelConfig;
	db?: Database;
	logger?: typeof realLog;
	onProgress?: (e: ProgressEvent) => void;
}

/** Options for ranking a single repository by `owner/name`. */
export interface RankOneOptions {
	selector: string;
	dry?: boolean;
	llm?: ScoringLLM;
	// NOTE: alternative lightweight adapter config when full llm not injected
	modelConfig?: ModelConfig;
	db?: Database;
	logger?: typeof realLog;
}

/**
 * Rank (categorise) a batch of repositories against all list criteria.
 * Selection mirrors the core scoring service ordering (summaries required).
 * Returns per-repo results including scores, planned list membership and change flags.
 */
export async function rankAll(
	options: RankAllOptions = {},
): Promise<BatchResult<RankingItemResult>> {
	const { limit = 50, dry = false, llm, modelConfig, db, onProgress } = options;
	const apply = !dry;
	const database = withDB(db);
	const scoring = createScoringService(database);
	const { runId, filterRunId } = scoring.resolveRunContext({
		dry,
		resume: "last",
	});
	// Select repos (mirrors core logic)
	const repos: RepoRow[] = scoring.selectRepos({ limit }, filterRunId);
	if (!repos.length)
		return {
			items: [],
			stats: { processed: 0, succeeded: 0, failed: 0, saved: 0 },
		};

	const listsSvc = createListsService(listsLib, database);
	const listRows = await listsSvc.read.getListDefs();
	const lists = listRows.map((l) => ({
		slug: l.slug,
		name: l.name,
		description: l.description ?? undefined,
	}));
	const token = apply
		? getRequiredEnv("GITHUB_TOKEN", "Required to apply ranking changes.")
		: (Bun.env.GITHUB_TOKEN ?? "");
	if (apply) await listsSvc.apply.ensureListGhIds(token);

	const svc: ScoringLLM = llm
		? llm
		: createOllamaService(
				modelConfig ?? {
					model: Bun.env.OLLAMA_MODEL ?? "",
					endpoint: Bun.env.OLLAMA_ENDPOINT ?? Bun.env.OLLAMA_HOST ?? "",
					apiKey: Bun.env.OLLAMA_API_KEY ?? "",
				},
			);

	const items: RankingItemResult[] = [];
	for (let i = 0; i < repos.length; i++) {
		const repo = repos[i];
		onProgress?.({
			phase: "ranking",
			index: i + 1,
			total: repos.length,
			repo: repo.name_with_owner,
		});
		try {
			// Facts
			const facts = {
				nameWithOwner: repo.name_with_owner,
				url: repo.url,
				summary: repo.summary ?? undefined,
				description: repo.description ?? undefined,
				primaryLanguage: repo.primary_language ?? undefined,
				topics: parseStringArray(repo.topics),
			};
			const result = await scoreRepoAgainstLists(lists, facts, svc);
			// Persist scores
			let scoresPersisted = false;
			if (apply && runId != null) {
				await scoring.persistScores(runId, repo.id, result.scores);
				scoresPersisted = true;
			}
			// Plan membership
			const currentSlugs = await listsSvc.read.currentMembership(repo.id);
			const plan = scoring.planMembership(
				repo,
				currentSlugs,
				result.scores,
				DEFAULT_POLICY,
			);
			let changed = false;
			let membershipApplied = false;
			if (apply && runId != null && !plan.blocked && plan.changed) {
				try {
					const repoGlobalId = await listsSvc.apply.ensureRepoGhId(
						token,
						repo.id,
					);
					const targetListIds = await listsSvc.read.mapSlugsToGhIds(
						plan.finalPlanned,
					);
					await listsSvc.apply.updateOnGitHub(
						token,
						repoGlobalId,
						targetListIds,
					);
					await listsSvc.apply.reconcileLocal(repo.id, plan.finalPlanned);
					changed = true;
					membershipApplied = true;
				} catch (e) {
					items.push({
						repoId: repo.id,
						nameWithOwner: repo.name_with_owner,
						status: "error",
						saved: false,
						error: e instanceof Error ? e.message : String(e),
					});
					continue;
				}
			}
			items.push({
				repoId: repo.id,
				nameWithOwner: repo.name_with_owner,
				status: "ok",
				saved: scoresPersisted && (!plan.changed || membershipApplied),
				plannedLists: plan.finalPlanned,
				changed,
				scores: result.scores,
				blocked: plan.blocked,
				blockReason: plan.blockReason ?? null,
				fallbackUsed: plan.fallbackUsed ?? null,
				scoresPersisted,
				membershipApplied,
			});
		} catch (e) {
			items.push({
				repoId: repo.id,
				nameWithOwner: repo.name_with_owner,
				status: "error",
				saved: false,
				error: e instanceof Error ? e.message : String(e),
			});
		}
	}
	return { items, stats: buildBatchStats(items) };
}

/** Rank a single repository. Mirrors `rankAll` semantics for one target. */
export async function rankOne(
	options: RankOneOptions,
): Promise<RankingItemResult> {
	const { selector, dry = false, llm, modelConfig, db } = options;
	const apply = !dry;
	const database = withDB(db);
	// Fetch repo
	const row = database
		.query<RepoRow, [string]>(
			`SELECT id, name_with_owner, url, description, primary_language, topics, summary,
			 stars, forks, popularity, freshness, activeness FROM repo WHERE name_with_owner = ?`,
		)
		.get(selector);
	if (!row) {
		return {
			repoId: -1,
			nameWithOwner: selector,
			status: "error",
			saved: false,
			error: "repo not found",
		};
	}
	try {
		const scoring = createScoringService(database);
		const { runId } = scoring.resolveRunContext({ dry });
		const listsSvc = createListsService(listsLib, database);
		const listRows = await listsSvc.read.getListDefs();
		const lists = listRows.map((l) => ({
			slug: l.slug,
			name: l.name,
			description: l.description ?? undefined,
		}));
		const token = apply
			? getRequiredEnv("GITHUB_TOKEN", "Required to apply ranking changes.")
			: (Bun.env.GITHUB_TOKEN ?? "");
		if (apply) await listsSvc.apply.ensureListGhIds(token);
		const svc: ScoringLLM = llm
			? llm
			: createOllamaService(
					modelConfig ?? {
						model: Bun.env.OLLAMA_MODEL ?? "",
						endpoint: Bun.env.OLLAMA_ENDPOINT ?? Bun.env.OLLAMA_HOST ?? "",
						apiKey: Bun.env.OLLAMA_API_KEY ?? "",
					},
				);
		const facts = {
			nameWithOwner: row.name_with_owner,
			url: row.url,
			summary: row.summary ?? undefined,
			description: row.description ?? undefined,
			primaryLanguage: row.primary_language ?? undefined,
			topics: parseStringArray(row.topics),
		};
		const result = await scoreRepoAgainstLists(lists, facts, svc);
		let scoresPersisted = false;
		let membershipApplied = false;
		if (apply && runId != null) {
			await scoring.persistScores(runId, row.id, result.scores);
			scoresPersisted = true;
		}
		const currentSlugs = await listsSvc.read.currentMembership(row.id);
		const plan = scoring.planMembership(
			row,
			currentSlugs,
			result.scores,
			DEFAULT_POLICY,
		);
		if (apply && runId != null && !plan.blocked && plan.changed) {
			try {
				const repoGlobalId = await listsSvc.apply.ensureRepoGhId(token, row.id);
				const targetListIds = await listsSvc.read.mapSlugsToGhIds(
					plan.finalPlanned,
				);
				await listsSvc.apply.updateOnGitHub(token, repoGlobalId, targetListIds);
				await listsSvc.apply.reconcileLocal(row.id, plan.finalPlanned);
				membershipApplied = true;
			} catch (e) {
				return {
					repoId: row.id,
					nameWithOwner: row.name_with_owner,
					status: "error",
					saved: false,
					error: e instanceof Error ? e.message : String(e),
					scores: result.scores,
					plannedLists: plan.finalPlanned,
					blocked: plan.blocked,
					blockReason: plan.blockReason ?? null,
					fallbackUsed: plan.fallbackUsed ?? null,
					scoresPersisted,
					membershipApplied,
					changed: plan.changed,
				};
			}
		}
		return {
			repoId: row.id,
			nameWithOwner: row.name_with_owner,
			status: "ok",
			saved: scoresPersisted && (!plan.changed || membershipApplied),
			scores: result.scores,
			plannedLists: plan.finalPlanned,
			blocked: plan.blocked,
			blockReason: plan.blockReason ?? null,
			fallbackUsed: plan.fallbackUsed ?? null,
			scoresPersisted,
			membershipApplied,
			changed: plan.changed,
		};
	} catch (e) {
		return {
			repoId: row.id,
			nameWithOwner: row.name_with_owner,
			status: "error",
			saved: false,
			error: e instanceof Error ? e.message : String(e),
		};
	}
}

/** @deprecated Use rankAll */
export const scoreBatchAll = rankAll;
/** @deprecated Use rankOne */
export const scoreOne = rankOne;
