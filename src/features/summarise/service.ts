import { db } from "@lib/db";
import type { RepoRow } from "@lib/types";
import type { BatchSelector, BindLimit, BindLimitSlug } from "./types";

const qBatchDefault = db.query<RepoRow, BindLimit>(`
  SELECT id, name_with_owner, url, description, primary_language, topics,
         stars, forks, popularity, freshness, activeness, pushed_at, last_commit_iso, last_release_iso, updated_at, summary
  FROM repo
  WHERE summary IS NULL
  ORDER BY popularity DESC NULLS LAST, freshness DESC NULLS LAST
  LIMIT ?
`);

const qBatchBySlug = db.query<RepoRow, BindLimitSlug>(`
  SELECT r.id, r.name_with_owner, r.url, r.description, r.primary_language, r.topics,
         r.stars, r.forks, r.popularity, r.freshness, r.activeness, r.pushed_at, r.last_commit_iso, r.last_release_iso, r.updated_at, r.summary
  FROM repo r
  JOIN list_repo lr ON lr.repo_id = r.id
  JOIN list l ON l.id = lr.list_id
  WHERE r.summary IS NULL AND l.slug = ?
  ORDER BY r.popularity DESC NULLS LAST, r.freshness DESC NULLS LAST
  LIMIT ?
`);

const qBatchDefaultRe = db.query<RepoRow, BindLimit>(`
  SELECT id, name_with_owner, url, description, primary_language, topics,
         stars, forks, popularity, freshness, activeness, pushed_at, last_commit_iso, last_release_iso, updated_at, summary
  FROM repo
  ORDER BY popularity DESC NULLS LAST, freshness DESC NULLS LAST
  LIMIT ?
`);

const qBatchBySlugRe = db.query<RepoRow, BindLimitSlug>(`
  SELECT r.id, r.name_with_owner, r.url, r.description, r.primary_language, r.topics,
         r.stars, r.forks, r.popularity, r.freshness, r.activeness, r.pushed_at, r.last_commit_iso, r.last_release_iso, r.updated_at, r.summary
  FROM repo r
  JOIN list_repo lr ON lr.repo_id = r.id
  JOIN list l ON l.id = lr.list_id
  WHERE l.slug = ?
  ORDER BY r.popularity DESC NULLS LAST, r.freshness DESC NULLS LAST
  LIMIT ?
`);

const uSummary = db.query<unknown, [string, number]>(
	`UPDATE repo SET summary = ? WHERE id = ?`,
);

export function createSummariseService() {
	function selectRepos(sel: BatchSelector): RepoRow[] {
		const limit = Math.max(1, Number(sel.limit ?? 10));
		if (sel.slug) {
			return sel.resummarise
				? qBatchBySlugRe.all(limit, sel.slug)
				: qBatchBySlug.all(limit, sel.slug);
		}
		return sel.resummarise
			? qBatchDefaultRe.all(limit)
			: qBatchDefault.all(limit);
	}

	function saveSummary(repoId: number, summary: string): void {
		uSummary.run(summary, repoId);
	}

	return { selectRepos, saveSummary };
}
