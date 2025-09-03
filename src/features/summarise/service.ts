import { getDefaultDb } from "@lib/db";
import type { RepoRow } from "@lib/types";
import type { BatchSelector, BindLimit, BindLimitSlug } from "./types";

export function createSummariseService(database = getDefaultDb()) {
	function selectRepos(sel: BatchSelector): RepoRow[] {
		const limit = Math.max(1, Number(sel.limit ?? 10));
		if (sel.slug) {
			const where = sel.resummarise
				? "WHERE l.slug = ?"
				: "WHERE r.summary IS NULL AND l.slug = ?";
			const qBySlug = database.query<RepoRow, BindLimitSlug>(`
        SELECT r.id, r.name_with_owner, r.url, r.description, r.primary_language, r.topics,
               r.stars, r.forks, r.popularity, r.freshness, r.activeness, r.pushed_at, r.last_commit_iso, r.last_release_iso, r.updated_at, r.summary
        FROM repo r
        JOIN list_repo lr ON lr.repo_id = r.id
        JOIN list l ON l.id = lr.list_id
        ${where}
        ORDER BY r.popularity DESC NULLS LAST, r.freshness DESC NULLS LAST
        LIMIT ?
      `);
			return qBySlug.all(sel.slug, limit);
		}
		const qDefault = database.query<RepoRow, BindLimit>(`
      SELECT id, name_with_owner, url, description, primary_language, topics,
             stars, forks, popularity, freshness, activeness, pushed_at, last_commit_iso, last_release_iso, updated_at, summary
      FROM repo
      ${sel.resummarise ? "" : "WHERE summary IS NULL"}
      ORDER BY popularity DESC NULLS LAST, freshness DESC NULLS LAST
      LIMIT ?
    `);
		return qDefault.all(limit);
	}

	function saveSummary(repoId: number, summary: string): void {
		const u = database.query<unknown, [string, number]>(
			`UPDATE repo SET summary = ? WHERE id = ?`,
		);
		u.run(summary, repoId);
	}

	return { selectRepos, saveSummary };
}
