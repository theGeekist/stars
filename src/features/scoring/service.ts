import { db as defaultDb } from "@lib/db";
import type { RepoRow } from "@lib/types";
import type { ScoreItem } from "@lib/score";
import type {
	ApplyPolicy,
	BatchSelector,
	PlanMembershipResult,
	PlanResult,
	ResumeFlag,
	ScoringService,
	Thresholds,
} from "./types";

// Prepared queries mirror current cli-scorer selection with resume filtering
type BindRunLimit = [
	runIdNullCheck: number | null,
	runIdForExists: number | null,
	limit: number,
];
type BindSlugRunLimit = [
	slug: string,
	runIdNullCheck: number | null,
	runIdForExists: number | null,
	limit: number,
];

export function createScoringService(db = defaultDb): ScoringService {
	const qBatchDefault = db.query<RepoRow, BindRunLimit>(`
      SELECT r.id, r.name_with_owner, r.url, r.description, r.primary_language, r.topics,
             r.stars, r.forks, r.popularity, r.freshness, r.activeness, r.pushed_at,
             r.last_commit_iso, r.last_release_iso, r.updated_at, r.summary
      FROM repo r
      WHERE (? IS NULL) OR NOT EXISTS (
        SELECT 1 FROM repo_list_score s
        WHERE s.repo_id = r.id AND s.run_id = ?
      )
      ORDER BY r.popularity DESC, r.freshness DESC
      LIMIT ?
    `);

	const qBatchBySlug = db.query<RepoRow, BindSlugRunLimit>(`
      SELECT r.id, r.name_with_owner, r.url, r.description, r.primary_language, r.topics,
             r.stars, r.forks, r.popularity, r.freshness, r.activeness, r.pushed_at,
             r.last_commit_iso, r.last_release_iso, r.updated_at, r.summary
      FROM repo r
      JOIN list_repo lr ON lr.repo_id = r.id
      JOIN list l       ON l.id = lr.list_id
      WHERE l.slug = ?
        AND ((? IS NULL) OR NOT EXISTS (
          SELECT 1 FROM repo_list_score s WHERE s.repo_id = r.id AND s.run_id = ?
        ))
      ORDER BY r.popularity DESC, r.freshness DESC
      LIMIT ?
    `);

	const iScore = db.query<
		unknown,
		[number, number, string, number, string | null]
	>(`
      INSERT INTO repo_list_score (run_id, repo_id, list_slug, score, rationale)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(run_id, repo_id, list_slug) DO UPDATE SET
        score = excluded.score,
        rationale = excluded.rationale
    `);
	function getLastRunId(): number | null {
		const row = db
			.query<{ id: number | null }, []>(`SELECT MAX(id) AS id FROM model_run`)
			.get();
		return row?.id ?? null;
	}

	function createRun(notes?: string): number {
		db.query(`INSERT INTO model_run (notes) VALUES (?)`).run(notes ?? null);
		const row = db
			.query<{ id: number }, []>(`SELECT last_insert_rowid() AS id`)
			.get();
		if (!row?.id) throw new Error("failed to create model_run");
		return row.id;
	}

	function resolveRunContext(opts: {
		dry: boolean;
		notes?: string;
		resume?: ResumeFlag;
	}): { runId: number | null; filterRunId: number | null } {
		if (opts.resume === "last") {
			const last = getLastRunId();
			if (opts.dry) return { runId: null, filterRunId: last };
			if (last) return { runId: last, filterRunId: last };
			const created = createRun(opts.notes);
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
				? { runId: null, filterRunId: opts.resume }
				: { runId: opts.resume, filterRunId: opts.resume };
		}
		if (opts.dry) return { runId: null, filterRunId: null };
		const id = createRun(opts.notes);
		return { runId: id, filterRunId: id };
	}

	function selectRepos(
		sel: BatchSelector,
		filterRunId: number | null,
	): RepoRow[] {
		const limit = Math.max(1, Number(sel.limit ?? 10));
		if (sel.listSlug)
			return qBatchBySlug.all(sel.listSlug, filterRunId, filterRunId, limit);
		return qBatchDefault.all(filterRunId, filterRunId, limit);
	}

	function persistScores(
		runId: number,
		repoId: number,
		scores: ScoreItem[],
	): void {
		for (const s of scores)
			iScore.run(runId, repoId, s.list, s.score, s.why ?? null);
	}

	function planTargets(
		current: string[],
		scores: ScoreItem[],
		cfg?: Thresholds,
	): PlanResult {
		const addBySlug = cfg?.addBySlug ?? {};
		const defaultAdd = cfg?.defaultAdd ?? 0.7;
		const removeTh = cfg?.remove ?? 0.3;
		const preserve = cfg?.preserve ?? new Set<string>();

		const scoreMap = new Map<string, number>(
			scores.map((s) => [s.list, s.score]),
		);
		const keep = current.filter((slug) => (scoreMap.get(slug) ?? 0) > removeTh);

		const review = scores
			.filter(
				(s) =>
					s.score > removeTh && s.score < (addBySlug[s.list] ?? defaultAdd),
			)
			.map((s) => s.list);

		const add = scores
			.filter((s) => {
				const th = addBySlug[s.list] ?? defaultAdd;
				return s.score >= th && !keep.includes(s.list);
			})
			.map((s) => s.list);

		const plannedBase = [...new Set([...keep, ...add])];
		const preservedOnRepo = current.filter((s) => preserve.has(s));
		const planned = [...new Set([...plannedBase, ...preservedOnRepo])];
		const remove = current.filter(
			(s) => !planned.includes(s) && !preserve.has(s),
		);

		return { planned, add, remove, keep, review };
	}

	function planMembership(
		repo: RepoRow,
		current: string[],
		scores: ScoreItem[],
		policy?: ApplyPolicy,
	): PlanMembershipResult {
		const base = planTargets(current, scores, policy?.thresholds);
		const preserve = policy?.thresholds?.preserve ?? new Set<string>();

		// Start with base plan
		let finalPlanned = base.planned.slice();
		let blocked = false;
		let blockReason: string | undefined;
		let fallbackUsed: { list: string; score: number } | null = null;

		// Guard: min stars
		if (policy?.minStars != null && (repo.stars ?? 0) < policy.minStars) {
			blocked = true;
			blockReason = `safety: stars ${repo.stars ?? 0} < ${policy.minStars}`;
		}

		// Avoid listless: if planned is empty, optionally fall back to top review
		if (!blocked && policy?.avoidListless && finalPlanned.length === 0) {
			const byScoreDesc = [...scores].sort((a, b) => b.score - a.score);
			const topReview =
				byScoreDesc.find((s) => base.review.includes(s.list)) ?? null;
			if (topReview) {
				finalPlanned = [topReview.list];
				fallbackUsed = { list: topReview.list, score: topReview.score };
			} else {
				blocked = true;
				blockReason = "would become listless (no review candidate)";
			}
		}

		// Always preserve personal lists already on the repo
		if (!blocked) {
			const preserved = current.filter((s) => preserve.has(s));
			finalPlanned = [...new Set([...finalPlanned, ...preserved])];
		}

		const changed =
			finalPlanned.slice().sort().join(",") !==
			current.slice().sort().join(",");

		return {
			...base,
			finalPlanned,
			changed,
			blocked,
			blockReason,
			fallbackUsed,
		};
	}

	return {
		getLastRunId,
		createRun,
		resolveRunContext,
		selectRepos,
		persistScores,
		planTargets,
		planMembership,
	};
}
