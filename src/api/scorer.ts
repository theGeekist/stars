// ./api/scorer.ts
import type { Database } from "bun:sqlite";
import { existsSync, mkdirSync } from "node:fs";

import { createListsService } from "@features/lists";
import { createScoringService, DEFAULT_POLICY } from "@features/scoring";
import {
	type ListDef,
	type RepoFacts,
	type ScoringLLM,
	scoreRepoAgainstLists,
} from "@features/scoring/llm";
import { createOllamaService } from "@jasonnathan/llm-core/ollama-service";
import { log as realLog } from "@lib/bootstrap";
import { withDB } from "@lib/db";
import * as listsLib from "@lib/lists";
import type { RepoRow } from "@lib/types";
import { formatNum, parseStringArray } from "@lib/utils";

import type {
	FreshnessSources,
	ListlessCsvRow,
	PlanDisplay,
	ProcessRepoOptions,
} from "./types";
import { chooseFreshnessSource, showPlan, writeListlessCsvRow } from "./utils";

/* ------------------------------- local helpers ------------------------------- */

type Logger = typeof realLog;

function _ensureDir(p: string) {
	if (!existsSync(p)) mkdirSync(p, { recursive: true });
}

function showRepoHeader(
	r: RepoRow,
	logger: Logger,
	idx?: number,
	total?: number,
) {
	const title =
		typeof idx === "number" && typeof total === "number"
			? `[${idx}/${total}] ${r.name_with_owner}`
			: r.name_with_owner;
	logger.header(title);

	const tags = parseStringArray(r.topics).slice(0, 6).join(", ");
	const upd = chooseFreshnessSource(r as FreshnessSources) ?? "-";

	logger.columns(
		[
			{
				URL: r.url,
				Lang: r.primary_language ?? "-",
				"★": formatNum(r.stars),
				Forks: formatNum(r.forks),
				Pop: r.popularity?.toFixed(2) ?? "-",
				Fresh: r.freshness?.toFixed(2) ?? "-",
				Act: r.activeness?.toFixed(2) ?? "-",
				Updated: upd,
			},
		],
		["URL", "Lang", "★", "Forks", "Pop", "Fresh", "Act", "Updated"],
		{
			URL: "URL",
			Lang: "Lang",
			"★": "★",
			Forks: "Forks",
			Pop: "Pop",
			Fresh: "Fresh",
			Act: "Act",
			Updated: "Updated",
		},
	);

	if (tags) logger.line(`  Topics: ${tags}`);
	if (r.description) logger.line(`  Desc  : ${r.description}`);
	logger.line();
}

function showTopScores(
	logger: Logger,
	scores: Array<{ list: string; score: number; why?: string }>,
) {
	const sorted = [...scores].sort((a, b) => b.score - a.score);
	logger.columns(
		sorted.map((s) => ({
			List: s.list,
			Score: s.score.toFixed(2),
			Why: s.why ?? "",
		})),
		["List", "Score", "Why"],
		{ List: "List", Score: "Score", Why: "Why" },
	);
}

// Pure mappers
function buildLists(
	listRows: Array<{ slug: string; name: string; description?: string | null }>,
): ListDef[] {
	return listRows.map((l) => ({
		slug: l.slug,
		name: l.name,
		description: l.description ?? undefined,
	}));
}

function buildFacts(r: RepoRow): RepoFacts {
	return {
		nameWithOwner: r.name_with_owner,
		url: r.url,
		summary: r.summary ?? undefined,
		description: r.description ?? undefined,
		primaryLanguage: r.primary_language ?? undefined,
		topics: parseStringArray(r.topics),
	};
}

async function ensureApplyPrereqs(
	apply: boolean,
	token: string,
	listsSvc: ReturnType<typeof createListsService>,
	logger: Logger,
): Promise<void> {
	const forceMissing = Bun.env.FORCE_TOKEN_MISSING === "1";
	if (apply && (forceMissing || token.trim().length === 0)) {
		throw new Error("GITHUB_TOKEN not set");
	}
	if (apply && token) {
		await logger.withSpinner("Ensuring GitHub list IDs", () =>
			listsSvc.apply.ensureListGhIds(token),
		);
	}
}

async function persistScoresMaybe(
	scoring: ReturnType<typeof createScoringService>,
	runId: number | null,
	repoId: number,
	scores: Array<{ list: string; score: number; why?: string }>,
	logger: Logger,
): Promise<void> {
	if (runId == null) {
		logger.info("Dry run (not saved)");
		return;
	}
	await logger.withSpinner("Saving scores", () =>
		scoring.persistScores(runId, repoId, scores),
	);
	logger.success("Saved");
}

/* ---------------------------------- cores ---------------------------------- */

export async function scoreBatchAllCore(
	limit: number,
	apply: boolean,
	llm: ScoringLLM | undefined,
	database: Database | undefined,
	logger: Logger,
): Promise<void> {
	const scoring = createScoringService(database);

	// Run context
	const { runId, filterRunId } = scoring.resolveRunContext({
		dry: !apply,
		resume: "last",
	});
	if (runId) logger.info(`model_run id=${runId}`);
	else logger.info("dry run (no model_run row created)");

	// Select repos
	const repos = scoring.selectRepos({ limit }, filterRunId);
	if (!repos.length) {
		logger.info("No repos matched the criteria.");
		return;
	}
	const total = repos.length;

	// Lists + GH prerequisites
	const listsSvc = createListsService(listsLib, database);
	const listRows = await logger.withSpinner("Loading list definitions", () =>
		listsSvc.read.getListDefs(),
	);
	const lists: ListDef[] = buildLists(listRows);
	const token = Bun.env.GITHUB_TOKEN ?? "";
	await ensureApplyPrereqs(apply, token, listsSvc, logger);

	const svc =
		llm ??
		createOllamaService({
			model: Bun.env.OLLAMA_MODEL ?? "",
			endpoint: Bun.env.OLLAMA_ENDPOINT ?? Bun.env.OLLAMA_HOST ?? "",
			apiKey: Bun.env.OLLAMA_API_KEY ?? "",
		});

	for (let i = 0; i < repos.length; i++) {
		await processRepo(
			{
				repo: repos[i],
				idx: i + 1,
				total,
				apply,
				runId,
				scoring,
				listsSvc,
				token,
				lists,
				svc,
			},
			logger,
		);
	}
}

export async function scoreOneCore(
	selector: string,
	apply: boolean,
	llm: ScoringLLM | undefined,
	database: Database | undefined,
	logger: Logger,
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

	const scoring = createScoringService(db);
	const { runId } = scoring.resolveRunContext({ dry: !apply });

	const listsSvc = createListsService(listsLib, db);
	const listRows = await logger.withSpinner("Loading list definitions", () =>
		listsSvc.read.getListDefs(),
	);
	const lists: ListDef[] = buildLists(listRows);
	const token = Bun.env.GITHUB_TOKEN ?? "";
	await ensureApplyPrereqs(apply, token, listsSvc, logger);

	const svc =
		llm ??
		createOllamaService({
			model: Bun.env.OLLAMA_MODEL ?? "",
			endpoint: Bun.env.OLLAMA_ENDPOINT ?? Bun.env.OLLAMA_HOST ?? "",
			apiKey: Bun.env.OLLAMA_API_KEY ?? "",
		});

	await processRepo(
		{ repo: row, apply, runId, scoring, listsSvc, token, lists, svc },
		logger,
	);
}

/* ----------------------- shared per-repo flow (export) ---------------------- */
export async function processRepo(opts: ProcessRepoOptions, logger: Logger) {
	const {
		repo,
		idx,
		total,
		apply,
		runId,
		scoring,
		listsSvc,
		token,
		lists,
		svc,
	} = opts;

	showRepoHeader(repo, logger, idx, total);

	const facts: RepoFacts = buildFacts(repo);
	const result = await logger.withSpinner("Scoring", () =>
		scoreRepoAgainstLists(lists, facts, svc),
	);

	showTopScores(logger, result.scores);
	await persistScoresMaybe(scoring, runId, repo.id, result.scores, logger);

	const currentSlugs = await listsSvc.read.currentMembership(repo.id);
	const plan = scoring.planMembership(
		repo,
		currentSlugs,
		result.scores,
		DEFAULT_POLICY,
	);

	const {
		add,
		remove,
		review,
		finalPlanned,
		changed,
		blocked,
		blockReason,
		fallbackUsed,
	} = plan;
	showPlan(logger, { add, remove, review, fallbackUsed } as PlanDisplay);

	if (blocked) {
		if (blockReason?.includes("listless")) {
			writeListlessCsvRow({
				nameWithOwner: repo.name_with_owner,
				url: repo.url,
				current: currentSlugs,
				scores: JSON.stringify(result.scores),
				note: blockReason ?? "blocked",
			} as ListlessCsvRow);
			logger.warn("Would become listless → logged and skipped apply");
		} else {
			logger.info(`${blockReason} → not applying`);
			logger.info("Not applied (use --apply) or no change");
		}
		logger.line();
		return;
	}

	if (!(apply && runId != null && changed)) {
		logger.info("Not applied (use --apply) or no change");
		logger.line();
		return;
	}

	try {
		await logger.withSpinner("Applying to GitHub", async () => {
			const repoGlobalId = await listsSvc.apply.ensureRepoGhId(token, repo.id);
			const targetListIds = await listsSvc.read.mapSlugsToGhIds(finalPlanned);
			await listsSvc.apply.updateOnGitHub(token, repoGlobalId, targetListIds);
			await listsSvc.apply.reconcileLocal(repo.id, finalPlanned);
		});
		logger.success("Applied and reconciled");
	} catch (e) {
		const msg = e instanceof Error ? e.message : String(e);
		logger.warn(`Apply failed: ${msg}`);
	}
	logger.line();
}

/* --------------------------------- Public API -------------------------------- */

/** @deprecated Use rankAll from ranking.public */
export async function scoreBatchAll(
	limit: number,
	apply: boolean,
	llm?: ScoringLLM,
	database?: Database,
): Promise<void> {
	await scoreBatchAllCore(limit, apply, llm, database, realLog);
}

/** @deprecated Use rankOne from ranking.public */
export async function scoreOne(
	selector: string,
	apply: boolean,
	llm?: ScoringLLM,
	database?: Database,
): Promise<void> {
	await scoreOneCore(selector, apply, llm, database, realLog);
}
