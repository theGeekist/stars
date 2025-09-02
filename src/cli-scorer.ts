// src/cli-scorer.ts
import { db, initSchema } from "./lib/db";
import type { Statement } from "bun:sqlite";
import { OllamaService } from "@jasonnathan/llm-core";
import {
	scoreRepoAgainstLists,
	type ListDef,
	type RepoFacts,
} from "./lib/score";
import { createListsService } from "./features/lists";
import type { RepoRow } from "./lib/types";
import { mkdirSync, existsSync, appendFileSync } from "node:fs";
import { join } from "node:path";
import { parseStringArray, formatNum } from "./lib/utils";
import { createScoringService } from "./features/scoring";

initSchema();

const PRESERVE_SLUGS = new Set([
	"valuable-resources",
	"interesting-to-explore",
]);

const ADD_THRESHOLDS: Record<string, number> = {
	ai: 0.8,
	monetise: 0.7,
	productivity: 0.7,
	networking: 0.7,
	learning: 0.75,
	"blockchain-finance": 0.8,
	"self-marketing": 0.7,
	"team-management": 0.7,
};
const DEFAULT_ADD = 0.7;
const REMOVE_THRESHOLD = 0.3;
const MIN_STARS = 50; // optional safety filter

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
			continue;
		}
	}
	return { limit, dry, slug, notes, apply, resume };
}

export type BindRunLimit = [runId: number | null, limit: number];
export type BindSlugRunLimit = [
	slug: string,
	runId: number | null,
	limit: number,
];

// ---- Prepared queries --------------------------------------------------------
let qBatchDefault!: Statement<RepoRow, BindRunLimit>;
let qBatchBySlug!: Statement<RepoRow, BindSlugRunLimit>;

type ListRow = { slug: string; name: string; description: string | null };
let qLists!: Statement<ListRow, []>;

let iRun!: Statement<unknown, [notes: string | null]>;
let iScore!: Statement<
	unknown,
	[run: number, repo: number, list: string, score: number, why: string | null]
>;

function prepareQueries(): void {
	qBatchDefault = db.query<RepoRow, BindRunLimit>(`
    SELECT r.id, r.name_with_owner, r.url, r.description, r.primary_language, r.topics,
           r.stars, r.forks, r.popularity, r.freshness, r.activeness, r.pushed_at,
           r.last_commit_iso, r.last_release_iso, r.updated_at, r.summary
    FROM repo r
    WHERE NOT EXISTS (
      SELECT 1
      FROM repo_list_score s
      WHERE s.repo_id = r.id
        AND s.run_id = ?
    )
    ORDER BY r.popularity DESC, r.freshness DESC
    LIMIT ?
  `);

	qBatchBySlug = db.query<RepoRow, BindSlugRunLimit>(`
    SELECT r.id, r.name_with_owner, r.url, r.description, r.primary_language, r.topics,
           r.stars, r.forks, r.popularity, r.freshness, r.activeness, r.pushed_at,
           r.last_commit_iso, r.last_release_iso, r.updated_at, r.summary
    FROM repo r
    JOIN list_repo lr ON lr.repo_id = r.id
    JOIN list l       ON l.id = lr.list_id
    WHERE l.slug = ?
      AND NOT EXISTS (
        SELECT 1
        FROM repo_list_score s
        WHERE s.repo_id = r.id
          AND s.run_id = ?
      )
    ORDER BY r.popularity DESC, r.freshness DESC
    LIMIT ?
  `);

	qLists = db.query<ListRow, []>(`
    SELECT slug, name, description
    FROM list
    WHERE slug != 'valuable-resources' AND slug != 'interesting-to-explore'
    ORDER BY name
  `);

	iRun = db.query<unknown, [string | null]>(`
    INSERT INTO model_run (notes) VALUES (?)
  `);

	iScore = db.query<unknown, [number, number, string, number, string | null]>(`
  INSERT INTO repo_list_score (run_id, repo_id, list_slug, score, rationale)
  VALUES (?, ?, ?, ?, ?)
  ON CONFLICT(run_id, repo_id, list_slug) DO UPDATE SET
    score = excluded.score,
    rationale = excluded.rationale
`);
}

// ---- Helpers ----------------------------------------------------------------
function targetSlugsFromScores(
	current: string[],
	scores: { list: string; score: number }[],
	preserve: Set<string>,
): {
	planned: string[];
	add: string[];
	remove: string[];
	keep: string[];
	review: string[];
} {
	const byList = new Map<string, number>(scores.map((s) => [s.list, s.score]));
	const keep = current.filter(
		(slug) => (byList.get(slug) ?? 0) > REMOVE_THRESHOLD,
	);

	const review = scores
		.filter(
			(s) =>
				s.score > REMOVE_THRESHOLD &&
				s.score < (ADD_THRESHOLDS[s.list] ?? DEFAULT_ADD),
		)
		.map((s) => s.list);

	const add = scores
		.filter((s) => {
			const th = ADD_THRESHOLDS[s.list] ?? DEFAULT_ADD;
			return s.score >= th && !keep.includes(s.list);
		})
		.map((s) => s.list);

	const plannedBase = [...new Set([...keep, ...add])];

	// Always preserve personal lists already on the repo
	const preservedOnRepo = current.filter((s) => preserve.has(s));
	const planned = [...new Set([...plannedBase, ...preservedOnRepo])];

	// Compute removes (excluding preserved)
	const remove = current.filter(
		(s) => !planned.includes(s) && !preserve.has(s),
	);

	return { planned, add, remove, keep, review };
}

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
		[
			esc(row.nameWithOwner),
			esc(row.url),
			esc(row.current.join("|")),
			esc(row.scores),
			esc(row.note),
		].join(",") + "\n",
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

function getLastRunId(): number | null {
	return (
		db.query<{ id: number }, []>(`SELECT MAX(id) AS id FROM model_run`).get()
			?.id ?? null
	);
}

function createRun(notes?: string): number {
	db.query(`INSERT INTO model_run (notes) VALUES (?)`).run(notes ?? null);
	const row = db
		.query<{ id: number }, []>(`SELECT last_insert_rowid() AS id`)
		.get();
	if (!row?.id) throw new Error("failed to create model_run");
	return row.id;
}

/**
 * Decide:
 * - runId: the run we WRITE into (null in dry mode)
 * - filterRunId: the run we FILTER against for resume/skip logic
 *
 * Rules:
 * - --resume=<id> → filter that id. If !dry, also write into that same runId.
 * - --resume=last → same as above, using MAX(id); if none and !dry, create a run and use it.
 * - no --resume:
 *     dry  → { runId:null, filterRunId:null }  (inspect everything; write nothing)
 *     !dry → create a new run; filter that id (so you can resume it later)
 */
function resolveRunContext(opts: {
	dry: boolean;
	notes?: string;
	resume?: number | "last";
}): { runId: number | null; filterRunId: number | null } {
	if (opts.resume === "last") {
		const last = getLastRunId();
		if (opts.dry) return { runId: null, filterRunId: last }; // dry inspect last
		if (last) return { runId: last, filterRunId: last }; // write into last
		const created = createRun(opts.notes); // nothing to resume -> start one
		return { runId: created, filterRunId: created };
	}

	if (typeof opts.resume === "number") {
		const ok = db
			.query<{ ok: number }, [number]>(
				`SELECT 1 ok FROM model_run WHERE id = ?`,
			)
			.get(opts.resume);
		if (!ok) throw new Error(`--resume ${opts.resume} does not exist`);
		return opts.dry
			? { runId: null, filterRunId: opts.resume } // dry inspect specific run
			: { runId: opts.resume, filterRunId: opts.resume }; // write into that run
	}

	// no resume flag
	if (opts.dry) return { runId: null, filterRunId: null }; // dry inspect all
	const id = createRun(opts.notes);
	return { runId: id, filterRunId: id }; // new run; resumable
}

// ---- Main -------------------------------------------------------------------
export async function scoreBatch(args: Args): Promise<void> {
    prepareQueries();

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
    const repos = scoring.selectRepos({ limit: args.limit, listSlug: args.slug }, filterRunId);

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

		const result = await scoreRepoAgainstLists(svc, lists, facts);
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

		// Decide membership (your existing helper)
        const currentSlugs = await listsSvc.read.currentMembership(r.id);

        const { planned, add, remove, review } = scoring.planTargets(currentSlugs, result.scores, {
            addBySlug: ADD_THRESHOLDS,
            defaultAdd: DEFAULT_ADD,
            remove: REMOVE_THRESHOLD,
            preserve: PRESERVE_SLUGS,
        });

		if (add.length) console.log("   Suggest ADD   :", add.join(", "));
		if (remove.length) console.log("   Suggest REMOVE:", remove.join(", "));
		if (review.length) console.log("   Review        :", review.join(", "));

		// Optional safety
		if ((r.stars ?? 0) < MIN_STARS) {
			console.log("   • safety: low stars → not applying");
			console.log("   • not applied (use --apply) or no change\n");
			continue;
		}

		// Guard: avoid listless
		let finalPlanned = planned.slice();
		if (finalPlanned.length === 0) {
			const topReview = [...result.scores]
				.filter((s) => review.includes(s.list))
				.sort((a, b) => b.score - a.score)[0];

			if (topReview) {
				finalPlanned = [topReview.list];
				console.log(
					`   ⚠️ fallback -> using review '${topReview.list}' (${topReview.score.toFixed(2)}) to avoid listless`,
				);
			} else {
				logListlessCSV({
					nameWithOwner: r.name_with_owner,
					url: r.url,
					current: currentSlugs,
					scores: JSON.stringify(result.scores),
					note: "No adds; removals would leave repo listless. Skipped apply.",
				});
				console.log("   ⚠️ would become listless → logged and skipped apply\n");
				continue;
			}
		}

		const plannedChanged =
			finalPlanned.slice().sort().join(",") !==
			currentSlugs.slice().sort().join(",");

		if (!(args.apply && runId != null && plannedChanged)) {
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
