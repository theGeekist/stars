// src/cli-scorer.ts
import { appendFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { createListsService } from "@features/lists";
import { createScoringService, DEFAULT_POLICY } from "@features/scoring";
import {
	type ListDef,
	type RepoFacts,
	type ScoringLLM,
	scoreRepoAgainstLists,
} from "@features/scoring/llm";
import { OllamaService } from "@jasonnathan/llm-core";
import { log } from "@lib/bootstrap";
import { parseSimpleArgs, SIMPLE_USAGE } from "@lib/cli";
import { db } from "@lib/db";

import type { RepoRow } from "@lib/types";
import { formatNum, parseStringArray } from "@lib/utils";

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
}): string | null {
	return (
		opts.pushed_at ??
		opts.last_commit_iso ??
		opts.last_release_iso ??
		opts.updated_at ??
		null
	);
}

function showRepoHeader(r: RepoRow, idx?: number, total?: number) {
	const title =
		typeof idx === "number" && typeof total === "number"
			? `[${idx}/${total}] ${r.name_with_owner}`
			: r.name_with_owner;
	log.header(title);

	const tags = parseStringArray(r.topics).slice(0, 6).join(", ");
	const upd = chooseFreshnessSource(r) ?? "-";

	log.columns(
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

	if (tags) log.line(`  Topics: ${tags}`);
	if (r.description) log.line(`  Desc  : ${r.description}`);
	log.line();
}

function showTopScores(
	scores: Array<{ list: string; score: number; why?: string }>,
) {
	const sorted = [...scores].sort((a, b) => b.score - a.score);
	log.columns(
		sorted.map((s) => ({
			List: s.list,
			Score: s.score.toFixed(2),
			Why: s.why ?? "",
		})),
		["List", "Score", "Why"],
		{ List: "List", Score: "Score", Why: "Why" },
	);
}

function showPlan(plan: {
	add: string[];
	remove: string[];
	review: string[];
	fallbackUsed?: { list: string; score: number } | null;
}) {
	const { add, remove, review, fallbackUsed } = plan;
	if (add.length) log.info("Suggest ADD   :", add.join(", "));
	if (remove.length) log.info("Suggest REMOVE:", remove.join(", "));
	if (review.length) log.info("Review        :", review.join(", "));
	if (fallbackUsed) {
		log.warn(
			`fallback → using review '${
				fallbackUsed.list
			}' (${fallbackUsed.score.toFixed(2)}) to avoid listless`,
		);
	}
}

// ---- Main -------------------------------------------------------------------
export async function scoreBatchAll(
	limit: number,
	apply: boolean,
	llm?: ScoringLLM,
	opts?: { resume?: number | "last"; notes?: string; fresh?: boolean },
): Promise<void> {
	const scoring = createScoringService();

	// Run context
	const { runId, filterRunId } = scoring.resolveRunContext({
		dry: !apply,
		notes: opts?.notes,
		resume: opts?.resume,
	});
	if (runId) log.info(`model_run id=${runId}`);
	else log.info("dry run (no model_run row created)");

	// Select repos
	const effectiveFilter = opts?.fresh ? null : filterRunId;
	const repos = scoring.selectRepos({ limit }, effectiveFilter);
	if (!repos.length) {
		log.info("No repos matched the criteria.");
		return;
	}
	const total = repos.length;

	// Lists + GH prerequisites
	const listsSvc = createListsService();
	const listRows = await log.withSpinner("Loading list definitions", () =>
		listsSvc.read.getListDefs(),
	);
	const lists: ListDef[] = listRows.map((l) => ({
		slug: l.slug,
		name: l.name,
		description: l.description ?? undefined,
	}));

	const token = Bun.env.GITHUB_TOKEN ?? "";
	if (!token && apply) throw new Error("GITHUB_TOKEN not set");
	if (apply && token) {
		await log.withSpinner("Ensuring GitHub list IDs", () =>
			listsSvc.apply.ensureListGhIds(token),
		);
	}

	const svc =
		llm ??
		(new OllamaService(Bun.env.OLLAMA_MODEL ?? "") as unknown as ScoringLLM);

	for (let i = 0; i < repos.length; i++) {
		const r = repos[i];
		showRepoHeader(r, i + 1, total);

		const facts: RepoFacts = {
			nameWithOwner: r.name_with_owner,
			url: r.url,
			summary: r.summary ?? undefined,
			description: r.description ?? undefined,
			primaryLanguage: r.primary_language ?? undefined,
			topics: parseStringArray(r.topics),
		};

		const result = await log.withSpinner("Scoring", () =>
			scoreRepoAgainstLists(lists, facts, svc),
		);
		showTopScores(result.scores);

		if (runId != null) {
			await log.withSpinner("Saving scores", () =>
				scoring.persistScores(runId, r.id, result.scores),
			);
			log.success("Saved");
		} else {
			log.info("Dry run (not saved)");
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

		showPlan({ add, remove, review, fallbackUsed });

		if (blocked) {
			if (blockReason?.includes("listless")) {
				logListlessCSV({
					nameWithOwner: r.name_with_owner,
					url: r.url,
					current: currentSlugs,
					scores: JSON.stringify(result.scores),
					note: blockReason ?? "blocked",
				});
				log.warn("Would become listless → logged and skipped apply");
			} else {
				log.info(`${blockReason} → not applying`);
				log.info("Not applied (use --apply) or no change");
			}
			log.line();
			continue;
		}

		if (!(apply && runId != null && changed)) {
			log.info("Not applied (use --apply) or no change");
			log.line();
			continue;
		}

		// Apply to GH + reconcile DB
		try {
			await log.withSpinner("Applying to GitHub", async () => {
				const repoGlobalId = await listsSvc.apply.ensureRepoGhId(token, r.id);
				const targetListIds = await listsSvc.read.mapSlugsToGhIds(finalPlanned);
				await listsSvc.apply.updateOnGitHub(token, repoGlobalId, targetListIds);
				await listsSvc.apply.reconcileLocal(r.id, finalPlanned);
			});
			log.success("Applied and reconciled");
		} catch (e) {
			const msg = e instanceof Error ? e.message : String(e);
			log.warn(`Apply failed: ${msg}`);
		}
		log.line();
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
	const listRows = await log.withSpinner("Loading list definitions", () =>
		listsSvc.read.getListDefs(),
	);
	const lists: ListDef[] = listRows.map((l) => ({
		slug: l.slug,
		name: l.name,
		description: l.description ?? undefined,
	}));
	const token = Bun.env.GITHUB_TOKEN ?? "";
	if (!token && apply) throw new Error("GITHUB_TOKEN not set");
	if (apply && token) {
		await log.withSpinner("Ensuring GitHub list IDs", () =>
			listsSvc.apply.ensureListGhIds(token),
		);
	}

	const svc =
		llm ??
		(new OllamaService(Bun.env.OLLAMA_MODEL ?? "") as unknown as ScoringLLM);

	showRepoHeader(row);

	const facts: RepoFacts = {
		nameWithOwner: row.name_with_owner,
		url: row.url,
		summary: row.summary ?? undefined,
		description: row.description ?? undefined,
		primaryLanguage: row.primary_language ?? undefined,
		topics: parseStringArray(row.topics),
	};
	const result = await log.withSpinner("Scoring", () =>
		scoreRepoAgainstLists(lists, facts, svc),
	);
	showTopScores(result.scores);

	if (runId != null) {
		await log.withSpinner("Saving scores", () =>
			scoring.persistScores(runId, row.id, result.scores),
		);
		log.success("Saved");
	} else {
		log.info("Dry run (not saved)");
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

	showPlan({ add, remove, review, fallbackUsed });

	if (blocked) {
		if (blockReason?.includes("listless")) {
			logListlessCSV({
				nameWithOwner: row.name_with_owner,
				url: row.url,
				current: currentSlugs,
				scores: JSON.stringify(result.scores),
				note: blockReason ?? "blocked",
			});
			log.warn("Would become listless → logged and skipped apply");
		} else {
			log.info(`${blockReason} → not applying`);
			log.info("Not applied (use --apply) or no change");
		}
		log.line();
		return;
	}

	if (!(apply && runId != null && changed)) {
		log.info("Not applied (use --apply) or no change");
		log.line();
		return;
	}

	try {
		await log.withSpinner("Applying to GitHub", async () => {
			const repoGlobalId = await listsSvc.apply.ensureRepoGhId(token, row.id);
			const targetListIds = await listsSvc.read.mapSlugsToGhIds(finalPlanned);
			await listsSvc.apply.updateOnGitHub(token, repoGlobalId, targetListIds);
			await listsSvc.apply.reconcileLocal(row.id, finalPlanned);
		});
		log.success("Applied and reconciled");
	} catch (e) {
		const msg = e instanceof Error ? e.message : String(e);
		log.warn(`Apply failed: ${msg}`);
	}
	log.line();
}

// CLI entry (unified simple flags)
if (import.meta.main) {
	const s = parseSimpleArgs(Bun.argv);
	// Advanced flags for direct invocation
	const rest = Bun.argv.slice(3);
	let resume: number | "last" | undefined;
	let notes: string | undefined;
	let fresh = false;
	let dry = s.dry;
	for (let i = 0; i < rest.length; i++) {
		const a = rest[i];
		if (a === "--resume" && rest[i + 1]) {
			const v = rest[++i];
			resume =
				v === "last"
					? "last"
					: Number.isFinite(Number(v))
						? Number(v)
						: undefined;
			continue;
		}
		if (a === "--notes" && rest[i + 1]) {
			notes = rest[++i];
			continue;
		}
		if (a === "--fresh" || a === "--from-scratch") {
			fresh = true;
			continue;
		}
		if (a === "--dry") {
			dry = true;
		}
	}

	if (s.mode === "one") {
		if (!s.one) {
			log.error("--one requires a value");
			log.line(SIMPLE_USAGE);
			process.exit(1);
		}
		const apply = s.apply || !dry;
		await scoreOne(s.one, apply);
	} else {
		const limit = Math.max(1, s.limit ?? 999_999_999);
		const apply = s.apply || !dry;
		log.info(
			`Score --all limit=${limit} apply=${apply}${
				resume ? ` resume=${resume}` : ""
			}${fresh ? " fresh=true" : ""}${notes ? " notes=..." : ""}`,
		);
		await scoreBatchAll(limit, apply, undefined, { resume, notes, fresh });
	}
}
