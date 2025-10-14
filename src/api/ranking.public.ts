import type { Database } from "bun:sqlite";
import { createListsService } from "@features/lists";
import { createScoringService, DEFAULT_POLICY } from "@features/scoring";
import type { ScoringLLM, ScoreItem } from "@features/scoring/llm";
import { scoreRepoAgainstLists } from "@features/scoring/llm";
import type {
	ApplyPolicy,
	PlanMembershipResult,
} from "@features/scoring/types";
import type { log as realLog } from "@lib/bootstrap";
import { withDB } from "@lib/db";
import * as listsLib from "@lib/lists";
import type { RepoRow } from "@lib/types";
import { parseStringArray } from "@lib/utils";
import type {
	BatchResult,
	ModelConfig,
	ProgressEmitter,
	RankingItemResult,
} from "./public.types";
import {
	buildBatchStats,
	createScoringLLMFromConfig,
	resolveGithubToken,
	resolveModelConfig,
} from "./public.types";

/**
 * Options for `rankAll` batch operation.
 * - Provide either a custom `llm` or a lightweight `modelConfig` (not both) to override environment defaults.
 * - Dependency precedence: explicit `llm` overrides `modelConfig`, which overrides env (`OLLAMA_*`).
 * - When `dry` is false (default) the function persists scores and (if policy allows) applies membership updates to GitHub Lists.
 * - `onProgress` receives phase `ranking:repo` with incremental index + total.
 */
export interface RankAllOptions {
	limit?: number;
	dry?: boolean;
	llm?: ScoringLLM;
	// NOTE: alternative lightweight adapter config when full llm not injected
	modelConfig?: ModelConfig;
	db?: Database;
	logger?: typeof realLog;
	onProgress?: ProgressEmitter<"ranking:repo">;
	policy?: ApplyPolicy; // NEW: curation policy support
}

/**
 * Options for ranking a single repository by `owner/name`.
 * `llm` → `modelConfig` → env precedence mirrors `RankAllOptions`.
 */
export interface RankOneOptions {
	selector: string;
	dry?: boolean;
	llm?: ScoringLLM;
	// NOTE: alternative lightweight adapter config when full llm not injected
	modelConfig?: ModelConfig;
	db?: Database;
	logger?: typeof realLog;
	policy?: ApplyPolicy; // NEW: curation policy support
}

type RankingRuntime = {
	apply: boolean;
	scoring: ReturnType<typeof createScoringService>;
	listsSvc: ReturnType<typeof createListsService>;
	lists: Array<{ slug: string; name: string; description?: string }>;
	llm: ScoringLLM;
	token: string;
	runId: number | null;
	policy: ApplyPolicy;
};

type ListRow = { slug: string; name: string; description?: string | null };

function mapListRows(
	listRows: Array<ListRow>,
): Array<{ slug: string; name: string; description?: string }> {
	return listRows.map((l) => ({
		slug: l.slug,
		name: l.name,
		description: l.description ?? undefined,
	}));
}

async function prepareRankingRuntime(
	database: Database,
	opts: {
		apply: boolean;
		llm?: ScoringLLM;
		modelConfig?: ModelConfig;
		policy?: ApplyPolicy;
		resume?: "last";
	},
): Promise<{ runtime: RankingRuntime; filterRunId?: number | null }> {
	const { apply, llm, modelConfig, policy, resume } = opts;
	const scoring = createScoringService({ db: database });
	const runContext = scoring.resolveRunContext({ dry: !apply, resume });
	const listsSvc = createListsService(listsLib, database);
	const listRows = await listsSvc.read.getListDefs();
	const lists = mapListRows(listRows);
	const token = resolveGithubToken({
		required: apply,
		help: "GITHUB_TOKEN missing. Required to apply ranking changes.",
	});
	if (apply) {
		await listsSvc.apply.ensureListGhIds(token);
	}
	let effectiveLlm: ScoringLLM;
	if (llm) {
		effectiveLlm = llm;
	} else {
		effectiveLlm = createScoringLLMFromConfig(
			resolveModelConfig(modelConfig, {
				help: "Set OLLAMA_MODEL or pass options.modelConfig.model for ranking.",
			}),
		);
	}
	return {
		runtime: {
			apply,
			scoring,
			listsSvc,
			lists,
			llm: effectiveLlm,
			token,
			runId: runContext.runId,
			policy: policy ?? DEFAULT_POLICY,
		},
		filterRunId: runContext.filterRunId ?? undefined,
	};
}

export async function persistScores(
	runtime: RankingRuntime,
	repoId: number,
	scores: ScoreItem[],
): Promise<boolean> {
	if (!runtime.apply || runtime.runId == null) return false;
	await runtime.scoring.persistScores(runtime.runId, repoId, scores);
	return true;
}

export async function planMembershipChange(
	runtime: RankingRuntime,
	repo: RepoRow,
	scores: ScoreItem[],
): Promise<PlanMembershipResult> {
	const currentSlugs = await runtime.listsSvc.read.currentMembership(repo.id);
	return runtime.scoring.planMembership(
		repo,
		currentSlugs,
		scores,
		runtime.policy,
	);
}

export async function applyMembership(
	runtime: RankingRuntime,
	repo: RepoRow,
	plan: PlanMembershipResult,
): Promise<{ applied: boolean; error?: string }> {
	if (!runtime.apply || runtime.runId == null) return { applied: false };
	if (plan.blocked || !plan.changed) return { applied: false };
	try {
		const repoGlobalId = await runtime.listsSvc.apply.ensureRepoGhId(
			runtime.token,
			repo.id,
		);
		const targetListIds = await runtime.listsSvc.read.mapSlugsToGhIds(
			plan.finalPlanned,
		);
		await runtime.listsSvc.apply.updateOnGitHub(
			runtime.token,
			repoGlobalId,
			targetListIds,
		);
		await runtime.listsSvc.apply.reconcileLocal(repo.id, plan.finalPlanned);
		return { applied: true };
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return { applied: false, error: message };
	}
}

interface RankingRepoOps {
	persistScores: (
		runtime: RankingRuntime,
		repoId: number,
		scores: ScoreItem[],
	) => Promise<boolean>;
	planMembership: (
		runtime: RankingRuntime,
		repo: RepoRow,
		scores: ScoreItem[],
	) => Promise<PlanMembershipResult>;
	applyMembership: (
		runtime: RankingRuntime,
		repo: RepoRow,
		plan: PlanMembershipResult,
	) => Promise<{ applied: boolean; error?: string }>;
}

const defaultRepoOps: RankingRepoOps = {
	persistScores,
	planMembership: planMembershipChange,
	applyMembership,
};

async function runRankingForRepo(
	repo: RepoRow,
	runtime: RankingRuntime,
	behaviour: { reportPlanChange: boolean; includePlanOnApplyError: boolean },
	ops: RankingRepoOps = defaultRepoOps,
): Promise<RankingItemResult> {
	try {
		const facts = {
			nameWithOwner: repo.name_with_owner,
			url: repo.url,
			summary: repo.summary ?? undefined,
			description: repo.description ?? undefined,
			primaryLanguage: repo.primary_language ?? undefined,
			topics: parseStringArray(repo.topics),
		};
		const result = await scoreRepoAgainstLists(
			runtime.lists,
			facts,
			runtime.llm,
		);

		const scoresPersisted = await ops.persistScores(
			runtime,
			repo.id,
			result.scores,
		);
		const plan = await ops.planMembership(runtime, repo, result.scores);
		const applyResult = await ops.applyMembership(runtime, repo, plan);

		if (applyResult.error) {
			if (behaviour.includePlanOnApplyError) {
				return {
					repoId: repo.id,
					nameWithOwner: repo.name_with_owner,
					status: "error",
					saved: false,
					error: applyResult.error,
					scores: result.scores,
					plannedLists: plan.finalPlanned,
					blocked: plan.blocked,
					blockReason: plan.blockReason ?? null,
					fallbackUsed: plan.fallbackUsed ?? null,
					scoresPersisted,
					membershipApplied: false,
					changed: behaviour.reportPlanChange ? plan.changed : false,
				};
			}
			return {
				repoId: repo.id,
				nameWithOwner: repo.name_with_owner,
				status: "error",
				saved: false,
				error: applyResult.error,
			};
		}

		const membershipApplied = applyResult.applied;
		const changed = behaviour.reportPlanChange
			? plan.changed
			: plan.changed && membershipApplied;

		return {
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
		};
	} catch (error) {
		return {
			repoId: repo.id,
			nameWithOwner: repo.name_with_owner,
			status: "error",
			saved: false,
			error: error instanceof Error ? error.message : String(error),
		};
	}
}

/**
 * Rank (categorise) a batch of repositories against all list criteria.
 * Selection mirrors the core scoring service ordering (summaries required).
 * Returns per-repo results including scores, planned list membership and change flags.
 */
export async function rankAll(
	options: RankAllOptions = {},
): Promise<BatchResult<RankingItemResult>> {
	const {
		limit = 50,
		dry = false,
		llm,
		modelConfig,
		db,
		onProgress,
		policy,
	} = options;
	const apply = !dry;
	const database = withDB(db);
	const { runtime, filterRunId } = await prepareRankingRuntime(database, {
		apply,
		llm,
		modelConfig,
		policy,
		resume: "last",
	});
	const repos: RepoRow[] = runtime.scoring.selectRepos({ limit }, filterRunId);
	if (!repos.length) {
		return {
			items: [],
			stats: { processed: 0, succeeded: 0, failed: 0, saved: 0 },
		};
	}

	const items: RankingItemResult[] = [];
	for (let i = 0; i < repos.length; i++) {
		const repo = repos[i];
		await onProgress?.({
			phase: "ranking:repo",
			index: i + 1,
			total: repos.length,
			repo: repo.name_with_owner,
		});
		const result = await runRankingForRepo(repo, runtime, {
			reportPlanChange: false,
			includePlanOnApplyError: false,
		});
		items.push(result);
	}
	return { items, stats: buildBatchStats(items) };
}

/** Rank a single repository. Mirrors `rankAll` semantics for one target. */
export async function rankOne(
	options: RankOneOptions,
): Promise<RankingItemResult> {
	const { selector, dry = false, llm, modelConfig, db, policy } = options;
	const apply = !dry;
	const database = withDB(db);
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
		const { runtime } = await prepareRankingRuntime(database, {
			apply,
			llm,
			modelConfig,
			policy,
		});
		return await runRankingForRepo(row, runtime, {
			reportPlanChange: true,
			includePlanOnApplyError: true,
		});
	} catch (error) {
		return {
			repoId: row.id,
			nameWithOwner: row.name_with_owner,
			status: "error",
			saved: false,
			error: error instanceof Error ? error.message : String(error),
		};
	}
}

// Export policies for CLI and consumer use
export { DEFAULT_POLICY };

/** @deprecated Use rankAll */
export const scoreBatchAll = rankAll;
/** @deprecated Use rankOne */
export const scoreOne = rankOne;
