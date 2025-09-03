import type { Database, Statement } from "bun:sqlite";
import { getDefaultDb } from "@lib/db";
import {
	chooseFreshnessSource,
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

/* ------------------------ Optional progress reporter ----------------------- */

/* ------------------------------- Validators -------------------------------- */

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
		if (it.listId != null && typeof it.listId !== "string")
			throw new Error("Index item.listId must be string|null");
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

function assertStarList(x: unknown): asserts x is StarList {
	if (!isObject(x)) throw new Error("StarList must be an object");
	if (!Array.isArray((x as StarList).repos))
		throw new Error("StarList.repos must be an array");
}

/* --------------------------- Prepared statements --------------------------- */

let upsertList!: Statement<IdRow, UpsertListBind>;
let upsertRepo!: Statement<IdRow, UpsertRepoBind>;
let linkListRepo!: Statement<unknown, LinkListRepoBind>;

function prepareStatements(database: Database): void {
	upsertList = database.prepare<IdRow, UpsertListBind>(`
    INSERT INTO list(name, description, is_private, slug, list_id)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(slug) DO UPDATE SET
      name=excluded.name,
      description=excluded.description,
      is_private=excluded.is_private,
      list_id=COALESCE(list.list_id, excluded.list_id)
    RETURNING id
  `);

	upsertRepo = database.prepare<IdRow, UpsertRepoBind>(`
    INSERT INTO repo(
      repo_id, name_with_owner, url, description, homepage_url, stars, forks, watchers, open_issues, open_prs,
      default_branch, last_commit_iso, last_release_iso, topics, primary_language, languages, license,
      is_archived, is_disabled, is_fork, is_mirror, has_issues_enabled, pushed_at, updated_at, created_at,
      disk_usage, readme_md, summary, tags, popularity, freshness, activeness
    ) VALUES (
      ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
      ?, ?, ?, ?, ?, ?, ?,
      ?, ?, ?, ?, ?, ?, ?, ?,
      ?, ?, ?, ?, ?, ?, ?
    )
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

	linkListRepo = database.prepare<unknown, LinkListRepoBind>(
		`INSERT OR IGNORE INTO list_repo(list_id, repo_id) VALUES (?, ?)`,
	);
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
		{
			hasIssuesEnabled: r.hasIssuesEnabled,
			isArchived: r.isArchived,
		},
	);

	const tags: string[] = [];
	if (r.primaryLanguage) tags.push(`lang:${r.primaryLanguage.toLowerCase()}`);
	if (r.license) tags.push(`license:${r.license.toLowerCase()}`);
	if (r.isArchived) tags.push("archived");
	if (r.isFork) tags.push("fork");
	if (r.isMirror) tags.push("mirror");
	for (const t of r.topics ?? []) if (t) tags.push(t);

	const bind: UpsertRepoBind = [
		r.repoId,
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
		null, // summary
		JSON.stringify(tags),
		popularity,
		freshness,
		activeness,
	];
	return bind;
}

/* --------------------------------- Ingest ---------------------------------- */

async function readIndex(dir: string): Promise<IndexEntry[]> {
	const indexRaw = (await Bun.file(`${dir}/index.json`).json()) as unknown;
	assertIndexEntryArray(indexRaw);
	return indexRaw as IndexEntry[];
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

function ingestTransaction(
	database: Database,
	listsPreloaded: Array<{ meta: IndexEntry; data: StarList }>,
	reporter?: IngestReporter,
): void {
	prepareStatements(database);
	database.transaction(() => {
		for (const { meta, data } of listsPreloaded) {
			const listIdRow = upsertList.get(
				meta.name,
				meta.description ?? "",
				meta.isPrivate ? 1 : 0,
				slugify(meta.name),
				meta.listId ?? data.listId ?? null,
			) as IdRow;

			for (const repo of data.repos) {
				const repoBind = normaliseRepo(repo);
				const repoIdRow = upsertRepo.get(...repoBind) as IdRow;
				linkListRepo.run(listIdRow.id, repoIdRow.id);
			}

			reporter?.listDone?.(meta, data.repos.length);
		}
	})();
}

export async function ingestFromExports(
	dir: string,
	reporter?: IngestReporter,
	database: Database = getDefaultDb(),
): Promise<{ lists: number }> {
	const index = await readIndex(dir);
	reporter?.start?.(index.length);
	const { listsPreloaded, totalRepos } = await preloadLists(
		dir,
		index,
		reporter,
	);
	ingestTransaction(database, listsPreloaded, reporter);
	reporter?.done?.({ lists: listsPreloaded.length, repos: totalRepos });
	return { lists: listsPreloaded.length };
}
