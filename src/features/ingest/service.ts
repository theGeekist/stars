import type { Database, Statement } from "bun:sqlite";
import { existsSync } from "node:fs";
import { withDB } from "@lib/db";
import {
	chooseFreshnessSource,
	deriveTags,
	scoreActiveness,
	scoreFreshnessFromISO,
	scorePopularity,
} from "@lib/metrics";
import type { RepoInfo, StarList } from "@lib/types";
import { isObject, slugify } from "@lib/utils";
import type {
	IdRow,
	IndexEntry,
	LinkListRepoBind,
	UpsertListBind,
	UpsertRepoBind,
} from "@src/types";
import type { IngestReporter } from "./types";

/* -------------------------------- Validators ------------------------------- */

function assertIndexEntryArray(x: unknown): asserts x is IndexEntry[] {
	if (!Array.isArray(x)) throw new Error("exports/index.json must be an array");
	for (const it of x) {
		if (!isObject(it)) throw new Error("Index item must be an object");
		if (typeof it.name !== "string")
			throw new Error("Index item.name must be string");
		if (typeof it.isPrivate !== "boolean")
			throw new Error("Index item.isPrivate must be boolean");
		if (typeof it.file !== "string")
			throw new Error("Index item.file must be string");
		if (it.description != null && typeof it.description !== "string")
			throw new Error("Index item.description must be string|null");
		if (typeof it.listId !== "string" || !it.listId.trim())
			throw new Error("Index item.listId must be a non-empty string");
	}
}

function assertRepoInfo(x: unknown): asserts x is RepoInfo {
	if (!isObject(x)) throw new Error("RepoInfo must be an object");
	const r = x as Partial<RepoInfo>;
	if (typeof r.nameWithOwner !== "string" || typeof r.url !== "string")
		throw new Error("RepoInfo.nameWithOwner and url are required");
	for (const k of [
		"stars",
		"forks",
		"watchers",
		"openIssues",
		"openPRs",
	] as const) {
		if (typeof r[k] !== "number")
			throw new Error(`RepoInfo.${k} must be number`);
	}
}

function assertRepoInfoArray(x: unknown): asserts x is RepoInfo[] {
	if (!Array.isArray(x)) throw new Error("Expected an array of RepoInfo");
	for (const it of x) assertRepoInfo(it);
}

function assertStarList(x: unknown): asserts x is StarList {
	if (!isObject(x)) throw new Error("StarList must be an object");
	if (!Array.isArray((x as StarList).repos))
		throw new Error("StarList.repos must be an array");
}

/* --------------------------- Prepared statements --------------------------- */

let upsertList!: Statement<IdRow | null, UpsertListBind>;
let upsertRepoById!: Statement<IdRow | null, UpsertRepoBind>; // primary path
let upsertRepoByName!: Statement<IdRow | null, UpsertRepoBind>; // fallback
let updateRepoFieldsById!: Statement<IdRow | null, [...UpsertRepoBind, number]>;
let forceUpdateName!: Statement<unknown, [string, number]>;

let selRepoByName!: Statement<
	{ id: number; repo_id: string | null } | null,
	[string]
>;
let selRepoByNode!: Statement<{ id: number } | null, [string]>;
let moveLinksToRepo!: Statement<unknown, [number, number]>;
let deleteRepoById!: Statement<unknown, [number]>;
let linkListRepo!: Statement<unknown, LinkListRepoBind>;

function prepareStatements(database: Database): void {
	upsertList = database.prepare<IdRow | null, UpsertListBind>(`
    INSERT INTO list(name, description, is_private, slug, list_id)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(slug) DO UPDATE SET
      name=excluded.name,
      description=excluded.description,
      is_private=excluded.is_private,
      list_id=COALESCE(list.list_id, excluded.list_id)
    RETURNING id
  `);

	// Column order matches schema.sql (includes readme_etag, readme_fetched_at)
	const UPSERT_REPO_COLUMNS = `
    repo_id, name_with_owner, url, description, homepage_url,
    stars, forks, watchers, open_issues, open_prs,
    default_branch, last_commit_iso, last_release_iso,
    topics, primary_language, languages, license,
    is_archived, is_disabled, is_fork, is_mirror, has_issues_enabled,
    pushed_at, updated_at, created_at, disk_usage,
    readme_md, readme_etag, readme_fetched_at,
    summary, tags, popularity, freshness, activeness
  `;

	const UPSERT_REPO_VALUES = `
    ?, ?, ?, ?, ?,
    ?, ?, ?, ?, ?,
    ?, ?, ?,
    ?, ?, ?, ?,
    ?, ?, ?, ?, ?,
    ?, ?, ?, ?,
    ?, ?, ?,
    ?, ?, ?, ?, ?
  `;

	upsertRepoById = database.prepare<IdRow | null, UpsertRepoBind>(`
    INSERT INTO repo(${UPSERT_REPO_COLUMNS})
    VALUES (${UPSERT_REPO_VALUES})
    ON CONFLICT(repo_id) DO UPDATE SET
      name_with_owner = excluded.name_with_owner,
      url=excluded.url, description=excluded.description, homepage_url=excluded.homepage_url,
      stars=excluded.stars, forks=excluded.forks, watchers=excluded.watchers,
      open_issues=excluded.open_issues, open_prs=excluded.open_prs,
      default_branch=excluded.default_branch, last_commit_iso=excluded.last_commit_iso, last_release_iso=excluded.last_release_iso,
      topics=excluded.topics, primary_language=excluded.primary_language, languages=excluded.languages,
      license=excluded.license, is_archived=excluded.is_archived, is_disabled=excluded.is_disabled,
      is_fork=excluded.is_fork, is_mirror=excluded.is_mirror, has_issues_enabled=excluded.has_issues_enabled,
      pushed_at=excluded.pushed_at, updated_at=excluded.updated_at, created_at=excluded.created_at,
      disk_usage=excluded.disk_usage, tags=excluded.tags,
      popularity=excluded.popularity, freshness=excluded.freshness, activeness=excluded.activeness
    RETURNING id
  `);

	upsertRepoByName = database.prepare<IdRow | null, UpsertRepoBind>(`
    INSERT INTO repo(${UPSERT_REPO_COLUMNS})
    VALUES (${UPSERT_REPO_VALUES})
    ON CONFLICT(name_with_owner) DO UPDATE SET
      repo_id=COALESCE(repo.repo_id, excluded.repo_id),
      url=excluded.url, description=excluded.description, homepage_url=excluded.homepage_url,
      stars=excluded.stars, forks=excluded.forks, watchers=excluded.watchers,
      open_issues=excluded.open_issues, open_prs=excluded.open_prs,
      default_branch=excluded.default_branch, last_commit_iso=excluded.last_commit_iso, last_release_iso=excluded.last_release_iso,
      topics=excluded.topics, primary_language=excluded.primary_language, languages=excluded.languages,
      license=excluded.license, is_archived=excluded.is_archived, is_disabled=excluded.is_disabled,
      is_fork=excluded.is_fork, is_mirror=excluded.is_mirror, has_issues_enabled=excluded.has_issues_enabled,
      pushed_at=excluded.pushed_at, updated_at=excluded.updated_at, created_at=excluded.created_at,
      disk_usage=excluded.disk_usage, tags=excluded.tags,
      popularity=excluded.popularity, freshness=excluded.freshness, activeness=excluded.activeness
    RETURNING id
  `);

	updateRepoFieldsById = database.prepare<
		IdRow | null,
		[...UpsertRepoBind, number]
	>(`
  UPDATE repo SET
    repo_id=?,
    name_with_owner=?,
    url=?, description=?, homepage_url=?,
    stars=?, forks=?, watchers=?, open_issues=?, open_prs=?,
    default_branch=?, last_commit_iso=?, last_release_iso=?,
    topics=?, primary_language=?, languages=?, license=?,
    is_archived=?, is_disabled=?, is_fork=?, is_mirror=?, has_issues_enabled=?,
    pushed_at=?, updated_at=?, created_at=?, disk_usage=?,
    readme_md = COALESCE(?, readme_md),
    readme_etag = COALESCE(?, readme_etag),
    readme_fetched_at = COALESCE(?, readme_fetched_at),
    summary = COALESCE(?, summary),
    tags=?, popularity=?, freshness=?, activeness=?
  WHERE id = ?
  RETURNING id
`);

	forceUpdateName = database.prepare<unknown, [string, number]>(
		`UPDATE repo SET name_with_owner = ? WHERE id = ?`,
	);

	selRepoByName = database.prepare<
		{ id: number; repo_id: string | null } | null,
		[string]
	>(`SELECT id, repo_id FROM repo WHERE name_with_owner = ? LIMIT 1`);
	selRepoByNode = database.prepare<{ id: number } | null, [string]>(
		`SELECT id FROM repo WHERE repo_id = ? LIMIT 1`,
	);

	moveLinksToRepo = database.prepare<unknown, [number, number]>(
		`UPDATE OR IGNORE list_repo SET repo_id = ? WHERE repo_id = ?`,
	);
	deleteRepoById = database.prepare<unknown, [number]>(
		`DELETE FROM repo WHERE id = ?`,
	);

	linkListRepo = database.prepare<unknown, LinkListRepoBind>(
		`INSERT OR IGNORE INTO list_repo(list_id, repo_id) VALUES (?, ?)`,
	);
}

/* -------------------------------- Utilities -------------------------------- */

function getIdOrThrow(label: string, row: IdRow | null): number {
	if (!row) throw new Error(`${label} returned null`);
	return row.id;
}

function requireListId(meta: IndexEntry, data: StarList): string {
	const id = meta.listId ?? data.listId;
	if (!id || typeof id !== "string" || !id.trim()) {
		throw new Error(`Missing listId for list "${meta.name}" (${meta.file})`);
	}
	return id;
}

/**
 * Write/merge policy:
 *  - If repo_id exists → upsert by repo_id.
 *  - If both name row and repo_id row exist and differ → merge into repo_id row
 *    (move links, delete loser, then set name to the incoming value).
 *  - If only one exists → update it.
 *  - Else insert (by repo_id if present, otherwise by name).
 */
function upsertRepoSmart(bind: UpsertRepoBind, db: Database): number {
	const [repoId, nameWithOwner] = bind;

	const byName = selRepoByName.get(nameWithOwner) ?? null;
	const byNode = repoId ? (selRepoByNode.get(repoId) ?? null) : null;

	// A) Merge name-row into node-row deterministically
	if (byName && byNode && byName.id !== byNode.id) {
		const winner = byNode.id;
		const loser = byName.id;
		db.transaction(() => {
			moveLinksToRepo.run(winner, loser); // move list links
			deleteRepoById.run(loser); // free UNIQUE(name_with_owner)
			forceUpdateName.run(nameWithOwner, winner); // set incoming name explicitly
			getIdOrThrow(
				"updateRepoFieldsById",
				updateRepoFieldsById.get(...bind, winner),
			);
		})();
		return winner;
	}

	// B) Update existing single row
	if (byNode) {
		return getIdOrThrow(
			"updateRepoFieldsById",
			updateRepoFieldsById.get(...bind, byNode.id),
		);
	}
	if (byName) {
		return getIdOrThrow(
			"updateRepoFieldsById",
			updateRepoFieldsById.get(...bind, byName.id),
		);
	}

	// C) Insert new
	if (repoId)
		return getIdOrThrow("upsertRepoById", upsertRepoById.get(...bind));
	return getIdOrThrow("upsertRepoByName", upsertRepoByName.get(...bind));
}

/* ----------------------------- Normalisation ------------------------------- */

function normaliseRepo(r: RepoInfo): UpsertRepoBind {
	const languageNames = (r.languages ?? [])
		.map((l) => l?.name)
		.filter(Boolean) as string[];

	const lastCommitISO =
		typeof r.lastCommitISO === "string" ? r.lastCommitISO : null;
	const lastReleaseISO = r.lastRelease?.publishedAt ?? null;

	const freshnessISO = chooseFreshnessSource({
		pushedAt: r.pushedAt ?? null,
		lastCommitISO,
		lastReleaseISO,
		updatedAt: r.updatedAt ?? null,
	});

	const popularity = scorePopularity(r.stars, r.forks, r.watchers);
	const freshness = scoreFreshnessFromISO(freshnessISO, 90);
	const activeness = scoreActiveness(
		r.openIssues,
		r.openPRs,
		r.pushedAt ?? null,
		{ hasIssuesEnabled: r.hasIssuesEnabled, isArchived: r.isArchived },
	);

	const tags = deriveTags({
		topics: r.topics ?? [],
		primary_language: r.primaryLanguage ?? null,
		license: r.license ?? null,
		is_archived: r.isArchived,
		is_fork: r.isFork,
		is_mirror: r.isMirror,
	});

	const bind: UpsertRepoBind = [
		r.repoId ?? null,
		r.nameWithOwner,
		r.url,
		r.description ?? null,
		r.homepageUrl ?? null,
		r.stars,
		r.forks,
		r.watchers,
		r.openIssues,
		r.openPRs,
		r.defaultBranch ?? null,
		lastCommitISO,
		lastReleaseISO,
		JSON.stringify(r.topics ?? []),
		r.primaryLanguage ?? null,
		JSON.stringify(languageNames),
		r.license ?? null,
		r.isArchived ? 1 : 0,
		r.isDisabled ? 1 : 0,
		r.isFork ? 1 : 0,
		r.isMirror ? 1 : 0,
		r.hasIssuesEnabled ? 1 : 0,
		r.pushedAt ?? null,
		r.updatedAt ?? null,
		r.createdAt ?? null,
		r.diskUsage ?? null,
		null, // readme_md
		null, // readme_etag
		null, // readme_fetched_at
		null, // summary
		JSON.stringify(tags),
		popularity,
		freshness,
		activeness,
	];
	return bind;
}

/* ----------------------------------- I/O ----------------------------------- */

async function readIndex(dir: string): Promise<IndexEntry[] | null> {
	const file = `${dir}/index.json`;
	if (!existsSync(file)) return null;
	const raw = (await Bun.file(file).json()) as unknown;
	assertIndexEntryArray(raw);
	return raw as IndexEntry[];
}

async function readUnlisted(dir: string): Promise<RepoInfo[] | null> {
	const file = `${dir}/unlisted.json`;
	if (!existsSync(file)) return null;
	const raw = (await Bun.file(file).json()) as unknown;
	assertRepoInfoArray(raw);
	return raw as RepoInfo[];
}

async function preloadLists(
	dir: string,
	index: IndexEntry[],
	reporter?: IngestReporter,
): Promise<{
	listsPreloaded: Array<{ meta: IndexEntry; data: StarList }>;
	totalRepos: number;
}> {
	const listsPreloaded: Array<{ meta: IndexEntry; data: StarList }> = [];
	let totalRepos = 0;

	for (let i = 0; i < index.length; i++) {
		const meta = index[i];
		const dataRaw = (await Bun.file(`${dir}/${meta.file}`).json()) as unknown;

		assertStarList(dataRaw);
		const starList = dataRaw as StarList;
		for (const r of starList.repos) assertRepoInfo(r);

		listsPreloaded.push({ meta, data: starList });
		totalRepos += starList.repos.length;

		reporter?.listStart?.(meta, i, index.length, starList.repos.length);
	}

	return { listsPreloaded, totalRepos };
}

/* ---------------------------------- Service -------------------------------- */

export function createIngestService(database?: Database) {
	const db = withDB(database);

	function ingestListsTx(
		listsPreloaded: Array<{ meta: IndexEntry; data: StarList }>,
		reporter?: IngestReporter,
	): { lists: number; reposFromLists: number } {
		prepareStatements(db);
		let reposFromLists = 0;

		db.transaction(() => {
			for (const { meta, data } of listsPreloaded) {
				const listInternalId = getIdOrThrow(
					"upsertList",
					upsertList.get(
						meta.name,
						meta.description ?? "",
						meta.isPrivate ? 1 : 0,
						slugify(meta.name),
						requireListId(meta, data),
					),
				);

				for (const repo of data.repos) {
					const repoBind = normaliseRepo(repo);
					const repoInternalId = upsertRepoSmart(repoBind, db);
					linkListRepo.run(listInternalId, repoInternalId);
					reposFromLists++;
				}

				reporter?.listDone?.(meta, data.repos.length);
			}
		})();

		return { lists: listsPreloaded.length, reposFromLists };
	}

	function ingestUnlistedTx(unlisted: RepoInfo[]): number {
		prepareStatements(db);
		let count = 0;
		db.transaction(() => {
			for (const repo of unlisted) {
				const repoBind = normaliseRepo(repo);
				upsertRepoSmart(repoBind, db); // no list link here
				count++;
			}
		})();
		return count;
	}

	return {
		/** Ingest order: UNLISTED FIRST, then LISTS (lists win on conflicts). */
		async ingestFromExports(
			dir: string,
			reporter?: IngestReporter,
		): Promise<{ lists: number; reposFromLists: number; unlisted: number }> {
			prepareStatements(db);

			// unlisted first (so lists win on any subsequent conflicts)
			const unlistedArr = await readUnlisted(dir);
			let unlisted = 0;
			if (unlistedArr?.length) {
				unlisted = ingestUnlistedTx(unlistedArr);
			}

			// lists (optional)
			const index = await readIndex(dir);
			let lists = 0;
			let reposFromLists = 0;

			if (index?.length) {
				reporter?.start?.(index.length);
				const { listsPreloaded, totalRepos } = await preloadLists(
					dir,
					index,
					reporter,
				);
				const res = ingestListsTx(listsPreloaded, reporter);
				lists = res.lists;
				reposFromLists = res.reposFromLists;
				reporter?.done?.({ lists, repos: totalRepos });
			} else {
				reporter?.start?.(0);
				reporter?.done?.({ lists: 0, repos: 0 });
			}

			return { lists, reposFromLists, unlisted };
		},

		/** Ingest from in-memory data (optionally with unlisted first, then lists). */
		ingestFromData(
			lists: StarList[],
			unlisted?: RepoInfo[],
			reporter?: IngestReporter,
		): { lists: number; reposFromLists: number; unlisted: number } {
			prepareStatements(db);

			let unlistedCount = 0;
			if (unlisted?.length) unlistedCount = ingestUnlistedTx(unlisted);

			const listsPreloaded = (lists ?? []).map((l) => ({
				meta: {
					listId: l.listId,
					name: l.name,
					description: l.description ?? null,
					isPrivate: l.isPrivate,
					count: l.repos.length,
					file: "",
				} as IndexEntry,
				data: l,
			}));

			let res = { lists: 0, reposFromLists: 0 };
			if (listsPreloaded.length) {
				reporter?.start?.(listsPreloaded.length);
				res = ingestListsTx(listsPreloaded, reporter);
				reporter?.done?.({
					lists: res.lists,
					repos: listsPreloaded.reduce((a, b) => a + b.data.repos.length, 0),
				});
			} else {
				reporter?.start?.(0);
				reporter?.done?.({ lists: 0, repos: 0 });
			}

			return {
				lists: res.lists,
				reposFromLists: res.reposFromLists,
				unlisted: unlistedCount,
			};
		},
	};
}
