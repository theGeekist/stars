// src/cli-scorer.ts

import { appendFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { createListsService } from "@features/lists";
import { createScoringService, DEFAULT_POLICY } from "@features/scoring";
import type { ScoringLLM } from "@features/scoring/llm";
import { OllamaService } from "@jasonnathan/llm-core";
import { db } from "@lib/db";
import {
	type ListDef,
	type RepoFacts,
	scoreRepoAgainstLists,
} from "@lib/score";
import type { RepoRow } from "@lib/types";
import { formatNum, parseStringArray } from "@lib/utils";
import { log } from "@lib/bootstrap";
import { parseSimpleArgs, SIMPLE_USAGE } from "@lib/cli";

// ---- Helpers ----------------------------------------------------------------

function ensureDir(p: string) {
	if (!existsSync(p)) mkdirSync(p, { recursive: true });
}

function logListlessCSV(row: {
	nameWithOwner: string;
	url: string;
	current: string[];
	scores: string; // JSON
	note: string;
}) {
	const outDir = join(process.cwd(), "exports");
	const outFile = join(outDir, "listless.csv");
	ensureDir(outDir);

	const header = "name_with_owner,url,current_slugs,scores_json,note\n";
	if (!existsSync(outFile)) appendFileSync(outFile, header, "utf8");

	const esc = (s: string) => `"${s.replace(/"/g, '""')}"`;
	appendFileSync(
		outFile,
		`${[
			esc(row.nameWithOwner),
			esc(row.url),
			esc(row.current.join("|")),
			esc(row.scores),
			esc(row.note),
		].join(",")}\n`,
		"utf8",
	);
}

function chooseFreshnessSource(opts: {
	pushed_at?: string | null;
	last_commit_iso?: string | null;
	last_release_iso?: string | null;
	updated_at?: string | null;
}): string | null;
function chooseFreshnessSource(opts: {
	pushed_at?: string | null;
	last_commit_iso?: string | null;
	last_release_iso?: string | null;
	updated_at?: string | null;
}): string | null;
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
export async function scoreBatchAll(
	limit: number,
	apply: boolean,
	llm?: ScoringLLM,
): Promise<void> {
	const scoring = createScoringService();

	// Run context
	const { runId, filterRunId } = scoring.resolveRunContext({
		dry: !apply,
	});
	if (runId) log.info(`model_run id=${runId}`);
	else log.info("dry run (no model_run row created)");

	// Select repos
	const repos = scoring.selectRepos({ limit }, filterRunId);
	if (!repos.length) {
		log.info("No repos matched the criteria.");
		return;
	}

	// Lists + GH prerequisites
	const listsSvc = createListsService();
	const listRows = await listsSvc.read.getListDefs();
	const lists: ListDef[] = listRows.map((l) => ({
		slug: l.slug,
		name: l.name,
		description: l.description ?? undefined,
	}));

	const token = Bun.env.GITHUB_TOKEN ?? "";
	if (!token && apply) throw new Error("GITHUB_TOKEN not set");
	if (apply && token) await listsSvc.apply.ensureListGhIds(token);

	const svc =
		llm ??
		(new OllamaService(Bun.env.OLLAMA_MODEL ?? "") as unknown as ScoringLLM);

	for (const r of repos) {
		log.header(r.name_with_owner);
		log.info("URL:", r.url);
		log.info("--- scoring ...");

		const facts: RepoFacts = {
			nameWithOwner: r.name_with_owner,
			url: r.url,
			summary: r.summary ?? undefined,
			description: r.description ?? undefined,
			primaryLanguage: r.primary_language ?? undefined,
			topics: parseStringArray(r.topics),
		};

		const result = await scoreRepoAgainstLists(lists, facts, svc);
		const top3 = [...result.scores]
			.sort((a, b) => b.score - a.score)
			.slice(0, 3);
		for (const s of top3) {
			log.info(
				`- ${s.list}: ${s.score.toFixed(2)}${s.why ? ` — ${s.why}` : ""}`,
			);
		}

		if (runId != null) {
			scoring.persistScores(runId, r.id, result.scores);
			log.success("saved scores");
		} else {
			log.info("dry run (not saved)");
		}

		const currentSlugs = await listsSvc.read.currentMembership(r.id);
		const plan = scoring.planMembership(
			r,
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

		if (add.length) log.info("Suggest ADD   :", add.join(", "));
		if (remove.length) log.info("Suggest REMOVE:", remove.join(", "));
		if (review.length) log.info("Review        :", review.join(", "));

		if (fallbackUsed) {
			log.warn(
				`fallback -> using review '${fallbackUsed.list}' (${fallbackUsed.score.toFixed(2)}) to avoid listless`,
			);
		}

		if (blocked) {
			if (blockReason?.includes("listless")) {
				logListlessCSV({
					nameWithOwner: r.name_with_owner,
					url: r.url,
					current: currentSlugs,
					scores: JSON.stringify(result.scores),
					note: blockReason ?? "blocked",
				});
				log.warn("would become listless → logged and skipped apply\n");
			} else {
				log.info(`${blockReason} → not applying`);
				log.info("not applied (use --apply) or no change\n");
			}
			continue;
		}

		if (!(apply && runId != null && changed)) {
			log.info("not applied (use --apply) or no change\n");
			continue;
		}

		try {
			const repoGlobalId = await listsSvc.apply.ensureRepoGhId(token, r.id);
			const targetListIds = await listsSvc.read.mapSlugsToGhIds(finalPlanned);
			await listsSvc.apply.updateOnGitHub(token, repoGlobalId, targetListIds);
			await listsSvc.apply.reconcileLocal(r.id, finalPlanned);
			log.success("applied to GitHub and reconciled locally\n");
		} catch (e) {
			const msg = e instanceof Error ? e.message : String(e);
			log.warn(`apply failed: ${msg}`);
		}
	}
}

export async function scoreOne(
	selector: string,
	apply: boolean,
	llm?: ScoringLLM,
): Promise<void> {
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

	const scoring = createScoringService();
	const { runId } = scoring.resolveRunContext({ dry: !apply });

	const listsSvc = createListsService();
	const listRows = await listsSvc.read.getListDefs();
	const lists: ListDef[] = listRows.map((l) => ({
		slug: l.slug,
		name: l.name,
		description: l.description ?? undefined,
	}));
	const token = Bun.env.GITHUB_TOKEN ?? "";
	if (!token && apply) throw new Error("GITHUB_TOKEN not set");
	if (apply && token) await listsSvc.apply.ensureListGhIds(token);

	const svc =
		llm ??
		(new OllamaService(Bun.env.OLLAMA_MODEL ?? "") as unknown as ScoringLLM);

	log.header(row.name_with_owner);
	log.info("URL:", row.url);
	log.info("--- scoring ...");

	const facts: RepoFacts = {
		nameWithOwner: row.name_with_owner,
		url: row.url,
		summary: row.summary ?? undefined,
		description: row.description ?? undefined,
		primaryLanguage: row.primary_language ?? undefined,
		topics: parseStringArray(row.topics),
	};
	const result = await scoreRepoAgainstLists(lists, facts, svc);
	const top3 = [...result.scores].sort((a, b) => b.score - a.score).slice(0, 3);
	for (const s of top3)
		log.info(`- ${s.list}: ${s.score.toFixed(2)}${s.why ? ` — ${s.why}` : ""}`);

	if (runId != null) {
		scoring.persistScores(runId, row.id, result.scores);
		log.success("saved scores");
	} else {
		log.info("dry run (not saved)");
	}

	const currentSlugs = await listsSvc.read.currentMembership(row.id);
	const plan = scoring.planMembership(
		row,
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
	if (add.length) log.info("Suggest ADD   :", add.join(", "));
	if (remove.length) log.info("Suggest REMOVE:", remove.join(", "));
	if (review.length) log.info("Review        :", review.join(", "));
	if (fallbackUsed)
		log.warn(
			`fallback -> using review '${fallbackUsed.list}' (${fallbackUsed.score.toFixed(2)}) to avoid listless`,
		);

	if (blocked) {
		if (blockReason?.includes("listless")) {
			logListlessCSV({
				nameWithOwner: row.name_with_owner,
				url: row.url,
				current: currentSlugs,
				scores: JSON.stringify(result.scores),
				note: blockReason ?? "blocked",
			});
			log.warn("would become listless → logged and skipped apply\n");
		} else {
			log.info(`${blockReason} → not applying`);
			log.info("not applied (use --apply) or no change\n");
		}
		return;
	}

	if (!(apply && runId != null && changed)) {
		log.info("not applied (use --apply) or no change\n");
		return;
	}

	try {
		const repoGlobalId = await listsSvc.apply.ensureRepoGhId(token, row.id);
		const targetListIds = await listsSvc.read.mapSlugsToGhIds(finalPlanned);
		await listsSvc.apply.updateOnGitHub(token, repoGlobalId, targetListIds);
		await listsSvc.apply.reconcileLocal(row.id, finalPlanned);
		log.success("applied to GitHub and reconciled locally\n");
	} catch (e) {
		const msg = e instanceof Error ? e.message : String(e);
		log.warn(`apply failed: ${msg}`);
	}
}

// CLI entry (unified simple flags)
if (import.meta.main) {
	const s = parseSimpleArgs(Bun.argv);

	if (s.mode === "one") {
		if (!s.one) {
			log.error("--one requires a value");
			log.line(SIMPLE_USAGE);
			process.exit(1);
		}
		await scoreOne(s.one, s.apply);
	} else {
		const limit = Math.max(1, s.limit ?? 10);
		log.info(`Score --all limit=${limit} apply=${s.apply}`);
		await scoreBatchAll(limit, s.apply);
	}
}
