import { db } from "./lib/db";
import type { RepoInfo, StarList } from "./lib/types";
import { Statement } from "bun:sqlite";

type IndexEntry = {
  name: string;
  description?: string | null;
  isPrivate: boolean;
  file: string;
};

function isObject(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null;
}
function assertIndexEntryArray(x: unknown): asserts x is IndexEntry[] {
  if (!Array.isArray(x)) throw new Error("exports/index.json must be an array");
  for (const it of x) {
    if (!isObject(it)) throw new Error("Index item must be an object");
    if (typeof it.name !== "string") throw new Error("Index item.name must be string");
    if (typeof it.isPrivate !== "boolean") throw new Error("Index item.isPrivate must be boolean");
    if (typeof it.file !== "string") throw new Error("Index item.file must be string");
    if (it.description != null && typeof it.description !== "string")
      throw new Error("Index item.description must be string|null");
  }
}
function assertRepoInfo(x: unknown): asserts x is RepoInfo {
  if (!isObject(x)) throw new Error("RepoInfo must be an object");
  const r = x as Partial<RepoInfo>;
  if (typeof r.nameWithOwner !== "string" || typeof r.url !== "string")
    throw new Error("RepoInfo.nameWithOwner and url are required");
  for (const k of ["stars", "forks", "watchers", "openIssues", "openPRs"] as const) {
    if (typeof (r as any)[k] !== "number") throw new Error(`RepoInfo.${k} must be number`);
  }
}
function assertStarList(x: unknown): asserts x is StarList {
  if (!isObject(x)) throw new Error("StarList must be an object");
  if (!Array.isArray((x as any).repos)) throw new Error("StarList.repos must be an array");
}

const EXPORTS_DIR = Bun.env.EXPORTS_DIR ?? "./exports";

function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}
function scorePopularity(stars: number, forks: number, watchers: number): number {
  const base = Math.log10(1 + stars + 2 * forks + 0.5 * watchers);
  return Number(base.toFixed(4));
}
function scoreFreshness(iso?: string | null): number {
  if (!iso) return 0;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return 0;
  const days = (Date.now() - t) / 86_400_000;
  return Number(Math.max(0, 1 - days / 365).toFixed(4));
}
function scoreActiveness(openIssues: number, openPRs: number, pushedAt?: string | null): number {
  const load = Math.log10(1 + openIssues + 2 * openPRs);
  const pushBoost = scoreFreshness(pushedAt) * 0.7;
  const s = Math.min(1, load / 2) * 0.6 + pushBoost;
  return Number(s.toFixed(4));
}

/** Row & binding types */
type IdRow = { id: number };
type UpsertListBind = [name: string, description: string | null, is_private: number, slug: string];
type LinkListRepoBind = [list_id: number, repo_id: number];
type UpsertRepoBind = [
  name_with_owner: string, url: string, description: string | null, homepage_url: string | null,
  stars: number, forks: number, watchers: number, open_issues: number, open_prs: number,
  default_branch: string | null, last_commit_iso: string | null, last_release_iso: string | null,
  topics: string, primary_language: string | null, languages: string, license: string | null,
  is_archived: number, is_disabled: number, is_fork: number, is_mirror: number, has_issues_enabled: number,
  pushed_at: string | null, updated_at: string | null, created_at: string | null, disk_usage: number | null,
  readme_md: string | null, summary: string | null, tags: string, popularity: number, freshness: number, activeness: number
];

let upsertList!: Statement<IdRow, UpsertListBind>;
let upsertRepo!: Statement<IdRow, UpsertRepoBind>;
let linkListRepo!: Statement<unknown, LinkListRepoBind>;

function prepareStatements(): void {
  upsertList = db.prepare<IdRow, UpsertListBind>(`
    INSERT INTO list(name, description, is_private, slug)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(slug) DO UPDATE SET
      name=excluded.name, description=excluded.description, is_private=excluded.is_private
    RETURNING id
  `);

  upsertRepo = db.prepare<IdRow, UpsertRepoBind>(`
    INSERT INTO repo(
      name_with_owner, url, description, homepage_url, stars, forks, watchers, open_issues, open_prs,
      default_branch, last_commit_iso, last_release_iso, topics, primary_language, languages, license,
      is_archived, is_disabled, is_fork, is_mirror, has_issues_enabled, pushed_at, updated_at, created_at,
      disk_usage, readme_md, summary, tags, popularity, freshness, activeness
    ) VALUES (
      ?, ?, ?, ?, ?, ?, ?, ?, ?,
      ?, ?, ?, ?, ?, ?, ?,
      ?, ?, ?, ?, ?, ?, ?, ?,
      ?, ?, ?, ?, ?, ?
    )
    ON CONFLICT(name_with_owner) DO UPDATE SET
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

  linkListRepo = db.prepare<unknown, LinkListRepoBind>(`
    INSERT OR IGNORE INTO list_repo(list_id, repo_id) VALUES (?, ?)
  `);
}

function normaliseRepo(r: RepoInfo) {
  const languageNames = (r.languages ?? []).map((l) => l?.name).filter(Boolean) as string[];
  const lastCommitISO = typeof r.lastCommitISO === "string" ? r.lastCommitISO : null;
  const lastReleaseISO = r.lastRelease?.publishedAt ?? null;

  const popularity = scorePopularity(r.stars, r.forks, r.watchers);
  const freshness = scoreFreshness(r.updatedAt ?? r.pushedAt ?? lastCommitISO);
  const activeness = scoreActiveness(r.openIssues, r.openPRs, r.pushedAt);

  const tags: string[] = [];
  if (r.primaryLanguage) tags.push(`lang:${r.primaryLanguage.toLowerCase()}`);
  if (r.license) tags.push(`license:${r.license.toLowerCase()}`);
  if (r.isArchived) tags.push("archived");
  if (r.isFork) tags.push("fork");
  if (r.isMirror) tags.push("mirror");
  for (const t of r.topics ?? []) if (t) tags.push(t);

  const bind: UpsertRepoBind = [
    r.nameWithOwner, r.url, r.description ?? null, r.homepageUrl ?? null,
    r.stars, r.forks, r.watchers, r.openIssues, r.openPRs,
    r.defaultBranch ?? null, lastCommitISO, lastReleaseISO,
    JSON.stringify(r.topics ?? []), r.primaryLanguage ?? null, JSON.stringify(languageNames), r.license ?? null,
    r.isArchived ? 1 : 0, r.isDisabled ? 1 : 0, r.isFork ? 1 : 0, r.isMirror ? 1 : 0, r.hasIssuesEnabled ? 1 : 0,
    r.pushedAt ?? null, r.updatedAt ?? null, r.createdAt ?? null, r.diskUsage ?? null,
    null, null, JSON.stringify(tags), popularity, freshness, activeness,
  ];
  return bind;
}

// --------- preload all inputs (no async inside transaction) ----------
const indexRaw = await Bun.file(`${EXPORTS_DIR}/index.json`).json() as unknown;
assertIndexEntryArray(indexRaw);

const listsPreloaded: Array<{ meta: IndexEntry; data: StarList }> = [];
for (const meta of indexRaw) {
  const dataRaw = await Bun.file(`${EXPORTS_DIR}/${meta.file}`).json() as unknown;
  assertStarList(dataRaw);
  listsPreloaded.push({ meta, data: dataRaw as StarList });
  // runtime guard each repo up front for clear errors
  for (const r of (dataRaw as StarList).repos) assertRepoInfo(r);
}

// --------- write phase ----------
prepareStatements();

db.transaction(() => {
  for (const { meta, data } of listsPreloaded) {
    // Upsert list
    const listIdRow = upsertList.get(
      meta.name,
      meta.description ?? null,
      meta.isPrivate ? 1 : 0,
      slugify(meta.name),
    ) as IdRow;

    // Upsert repos + link
    for (const repo of data.repos) {
      const repoBind = normaliseRepo(repo);        // returns UpsertRepoBind
      const repoIdRow = upsertRepo.get(...repoBind) as IdRow; // <-- spread, not array
      linkListRepo.run(listIdRow.id, repoIdRow.id);           // <-- scalars, not array
    }
  }
})();
console.log(`Ingested ${listsPreloaded.length} lists from ${EXPORTS_DIR}`);
