// src/cli-scorer.ts

import { appendFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { createListsService } from "@features/lists";
import { createScoringService, DEFAULT_POLICY } from "@features/scoring";
import { OllamaService } from "@jasonnathan/llm-core";
import { initSchema } from "@lib/db";
import {
	type ListDef,
	type RepoFacts,
	scoreRepoAgainstLists,
} from "@lib/score";
import type { RepoRow } from "@lib/types";
import { formatNum, parseStringArray } from "@lib/utils";

initSchema();

// ---- CLI args ---------------------------------------------------------------
export type Args = {
	limit: number;
	dry: boolean;
	slug?: string;
	notes?: string;
	apply?: boolean;
	resume?: number | "last"; // optional
};

function parseArgs(argv: string[]): Args {
	let limit = 10;
	let dry = false;
	let slug: string | undefined;
	let notes: string | undefined;
	let apply = false;
	let resume: number | "last" | undefined;

	for (let i = 2; i < argv.length; i++) {
		const a = argv[i];
		if (/^\d+$/.test(a)) {
			limit = Number(a);
			continue;
		}
		if (a === "--dry") {
			dry = true;
			continue;
		}
		if (a === "--apply") {
			apply = true;
			continue;
		}
		if (a === "--slug" && argv[i + 1]) {
			slug = argv[++i];
			continue;
		}
		if (a === "--notes" && argv[i + 1]) {
			notes = argv[++i];
			continue;
		}
		if (a === "--resume" && argv[i + 1]) {
			const v = argv[++i];
			resume =
				v === "last"
					? "last"
					: Number.isFinite(Number(v))
						? Number(v)
						: undefined;
		}
	}
	return { limit, dry, slug, notes, apply, resume };
}

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
export async function scoreBatch(args: Args): Promise<void> {
	const scoring = createScoringService();

	// 0) Run context (tiny + predictable)
	const { runId, filterRunId } = scoring.resolveRunContext({
		dry: args.dry,
		notes: args.notes,
		resume: args.resume,
	});
	if (runId) console.log(`model_run id=${runId}`);
	else console.log("dry run (no model_run row created)");

	// 1) Select repos AFTER we know the filter
	const repos = scoring.selectRepos(
		{ limit: args.limit, listSlug: args.slug },
		filterRunId,
	);

	if (!repos.length) {
		console.log("No repos matched the criteria.");
		return;
	}

	// 2) Lists to score against (via Lists service)
	const listsSvc = createListsService();
	const listRows = await listsSvc.read.getListDefs();
	const lists: ListDef[] = listRows.map((l) => ({
		slug: l.slug,
		name: l.name,
		description: l.description ?? undefined,
	}));

	// 3) Ensure GH ids once per run
	const token = Bun.env.GITHUB_TOKEN ?? "";
	if (!token) throw new Error("GITHUB_TOKEN not set");
	await listsSvc.apply.ensureListGhIds(token);

	// 4) LLM client
	const svc = new OllamaService(Bun.env.OLLAMA_MODEL ?? "");

	// 5) Process
	for (const r of repos) {
		console.log(annotateHeader(r));
		console.log("   --- scoring ...");

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
			console.log(
				`   - ${s.list}: ${s.score.toFixed(2)}${s.why ? ` — ${s.why}` : ""}`,
			);
		}

		// Persist scores (UPSERT makes this resume-safe)
		if (runId != null) {
			scoring.persistScores(runId, r.id, result.scores);
			console.log("   ✓ saved scores");
		} else {
			console.log("   • dry run (not saved)");
		}

		// Decide membership via scoring policy
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

		if (add.length) console.log("   Suggest ADD   :", add.join(", "));
		if (remove.length) console.log("   Suggest REMOVE:", remove.join(", "));
		if (review.length) console.log("   Review        :", review.join(", "));

		if (fallbackUsed)
			console.log(
				`   ⚠️ fallback -> using review '${
					fallbackUsed.list
				}' (${fallbackUsed.score.toFixed(2)}) to avoid listless`,
			);

		if (blocked) {
			if (blockReason?.includes("listless")) {
				logListlessCSV({
					nameWithOwner: r.name_with_owner,
					url: r.url,
					current: currentSlugs,
					scores: JSON.stringify(result.scores),
					note: blockReason ?? "blocked",
				});
				console.log("   ⚠️ would become listless → logged and skipped apply\n");
			} else {
				console.log(`   • ${blockReason} → not applying`);
				console.log("   • not applied (use --apply) or no change\n");
			}
			continue;
		}

		if (!(args.apply && runId != null && changed)) {
			console.log("   • not applied (use --apply) or no change\n");
			continue;
		}

		// Apply to GH + reconcile DB
		try {
			const repoGlobalId = await listsSvc.apply.ensureRepoGhId(token, r.id);
			const targetListIds = await listsSvc.read.mapSlugsToGhIds(finalPlanned);
			await listsSvc.apply.updateOnGitHub(token, repoGlobalId, targetListIds);
			await listsSvc.apply.reconcileLocal(r.id, finalPlanned);
			console.log("   ✅ applied to GitHub and reconciled locally\n");
		} catch (e) {
			console.error("   ⚠️ apply failed:", e, "\n");
		}
	}
}

// CLI entry
if (import.meta.main) {
	const args = parseArgs(Bun.argv);
	console.log(
		`Batch score: limit=${args.limit} dry=${args.dry}` +
			(args.slug ? ` slug=${args.slug}` : "") +
			(args.notes ? ` notes=${args.notes}` : "") +
			(args.apply ? ` apply=true` : ""),
	);
	await scoreBatch(args);
}
