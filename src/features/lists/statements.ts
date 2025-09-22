// src/features/lists/statements.ts
import type { Database } from "bun:sqlite";
import type {
	BindLimit,
	BindSlugLimit,
	ListDefRow,
	ListedRepoIdRow,
	ListIdRow,
	ListKeyIdRow, // ← add to ./types (see Patch 3)
	ListSlugRow,
	RepoIdLookupRow,
	RepoRow,
} from "./types";

export type Stmts = ReturnType<typeof prepareStatements>;

export function prepareStatements(db: Database) {
	const qReposDefault = db.query<RepoRow, BindLimit>(/* sql */ `
    SELECT id, name_with_owner, url, description, primary_language, topics,
           stars, forks, popularity, freshness, activeness, pushed_at,
           last_commit_iso, last_release_iso, updated_at, summary
    FROM repo
    ORDER BY popularity DESC NULLS LAST, freshness DESC NULLS LAST
    LIMIT ?
  `);

	const qReposBySlug = db.query<RepoRow, BindSlugLimit>(/* sql */ `
    SELECT r.id, r.name_with_owner, r.url, r.description, r.primary_language, r.topics,
           r.stars, r.forks, r.popularity, r.freshness, r.activeness,
           r.pushed_at, r.last_commit_iso, r.last_release_iso, r.updated_at, r.summary
    FROM repo r
    JOIN list_repo lr ON lr.repo_id = r.id
    JOIN list l ON l.id = lr.list_id
    WHERE l.slug = ?
    ORDER BY r.popularity DESC NULLS LAST, r.freshness DESC NULLS LAST
    LIMIT ?
  `);

	const qCurrentMembership = db.query<ListSlugRow, [number]>(/* sql */ `
    SELECT l.slug
    FROM list l
    JOIN list_repo lr ON lr.list_id = l.id
    WHERE lr.repo_id = ?
    ORDER BY l.name
  `);

	const qListIdBySlug = db.query<ListIdRow, [string]>(
		`SELECT list_id as id FROM list WHERE slug = ? LIMIT 1`,
	);

	const qListDefs = db.query<ListDefRow, []>(/* sql */ `
    SELECT slug, name, description
    FROM list
    WHERE slug IS NULL OR slug NOT IN ('valuable-resources','interesting-to-explore')
    ORDER BY name
  `);

	const qListedRepoIds = db.query<ListedRepoIdRow, []>(/* sql */ `
    SELECT DISTINCT r.repo_id FROM repo r
    JOIN list_repo lr ON lr.repo_id = r.id
  `);

	const qRepoLookup = db.query<RepoIdLookupRow, [string]>(/* sql */ `
    SELECT repo_id as id, name_with_owner, url, description, primary_language, topics, summary
    FROM repo WHERE repo_id = ? LIMIT 1
  `);

	const qListKeyId = db.query<ListKeyIdRow, []>(/* sql */ `
    SELECT list_id as id, slug, name FROM list
  `);

	const insertListRepo = db.query<
		Record<string, never>,
		[string, number]
	>(/* sql */ `
    INSERT INTO list_repo (list_id, repo_id)
    VALUES ((SELECT id FROM list WHERE slug = ?), ?)
    ON CONFLICT(list_id, repo_id) DO NOTHING
  `);

	// Dynamic IN (...) — compiled per call
	const makeDeleteOther = (slugs: string[]) =>
		db.query<Record<string, never>, [number, ...string[]]>(/* sql */ `
      DELETE FROM list_repo
      WHERE repo_id = ?
        AND list_id NOT IN (SELECT id FROM list WHERE slug IN (${slugs.map(() => "?").join(",")}))
    `);

	return {
		/** explicit handle for tx() */
		db,

		// reads
		qReposDefault,
		qReposBySlug,
		qCurrentMembership,
		qListIdBySlug,
		qListDefs,
		qListedRepoIds,
		qRepoLookup,
		qListKeyId,

		// writes
		insertListRepo,
		makeDeleteOther,
	};
}
