import type { Statement } from "bun:sqlite";
import { db } from "@lib/db";
import * as api from "./api";
import type { RepoMini, RepoRef } from "./types";

let qReposAll!: Statement<RepoMini, []>;
let qReposActive!: Statement<RepoMini, []>;

function prepare() {
	if (qReposAll && qReposActive) return;
	qReposAll = db.query<RepoMini, []>(
		`SELECT id, name_with_owner, is_archived FROM repo`,
	);
	qReposActive = db.query<RepoMini, []>(
		`SELECT id, name_with_owner, is_archived FROM repo WHERE is_archived = 0`,
	);
}

/* ── Small helpers ──────────────────────────────────────────────────────── */
export function listRepoRefsFromDb(onlyActive?: boolean): RepoMini[] {
	prepare();
	return (onlyActive ? qReposActive : qReposAll).all();
}

export function buildRepoRefs(rows: RepoMini[]): RepoRef[] {
	return rows.map((r) => {
		const [owner, name] = (r.name_with_owner || "").split("/");
		if (!owner || !name)
			throw new Error(`Invalid name_with_owner: ${r.name_with_owner}`);
		return { owner, name } as RepoRef;
	});
}

export function reconcileRowsAndCollectUniverse(
	rows: RepoMini[],
	topicsByRepo: Map<string, string[]>,
	normalizeTopics: typeof api.normalizeTopics,
	reconcileRepoTopics: typeof api.reconcileRepoTopics,
): Set<string> {
	const universe = new Set<string>();
	for (const r of rows) {
		const key = r.name_with_owner;
		const ts = normalizeTopics(topicsByRepo.get(key) ?? []);
		reconcileRepoTopics(r.id, ts);
		for (const t of ts) universe.add(t);
	}
	return universe;
}

/* ── Deps shape for DI ──────────────────────────────────────────────────── */
export type Deps = {
	normalizeTopics: typeof api.normalizeTopics;
	reconcileRepoTopics: typeof api.reconcileRepoTopics;
	repoTopicsMany: typeof api.repoTopicsMany; // sync (DB-only)
	selectStaleTopics: typeof api.selectStaleTopics;
	topicMetaMany: typeof api.topicMetaMany; // sync (reads GH_EXPLORE_PATH)
	upsertTopic: typeof api.upsertTopic;
	upsertTopicAliases: typeof api.upsertTopicAliases;
	upsertTopicRelated: typeof api.upsertTopicRelated;
};

/** DB-only metadata refresh (sync). */
export function refreshStaleTopicMeta(
	universe: Set<string>,
	ttlDays: number,
	selectStaleTopics: typeof api.selectStaleTopics,
	topicMetaMany: typeof api.topicMetaMany,
	upsertTopic: typeof api.upsertTopic,
	upsertTopicAliases: typeof api.upsertTopicAliases,
	upsertTopicRelated: typeof api.upsertTopicRelated,
): number {
	const stale = selectStaleTopics(JSON.stringify([...universe]), ttlDays).map(
		(x) => x.topic,
	);
	if (!stale.length) return 0;

	// DB-only; token unused but signature retained → pass empty
	const metaMap = topicMetaMany(stale, {});

	let refreshed = 0;
	for (const t of stale) {
		const m = metaMap.get(t);

		if (!m) {
			// Minimal row so FKs are satisfied; no aliases/related
			upsertTopic({
				topic: t,
				display_name: t,
				short_description: null,
				long_description_md: null,
				is_featured: false,
				created_by: null,
				released: null,
				wikipedia_url: null,
				logo: null,
				etag: null,
			});
			refreshed++;
			continue;
		}

		// Prefer canonical from meta; fall back to incoming slug
		const canonical = m.name || t;

		upsertTopic({
			topic: canonical,
			display_name: m.displayName ?? m.name ?? t,
			short_description: m.shortDescription ?? null,
			long_description_md: m.longDescriptionMd ?? null,
			is_featured: !!m.isFeatured,
			created_by: m.createdBy ?? null,
			released: m.released ?? null,
			wikipedia_url: m.wikipediaUrl ?? null,
			logo: m.logo ?? null,
			etag: null,
		});

		// Maintain alias and related edges
		upsertTopicAliases(canonical, m.aliases ?? []);
		upsertTopicRelated(canonical, m.related ?? []);

		refreshed++;
	}
	return refreshed;
}

/* ── Public service (sync) ──────────────────────────────────────────────── */
export function createTopicsService(deps: Partial<Deps> = {}) {
	const {
		normalizeTopics,
		reconcileRepoTopics,
		repoTopicsMany,
		selectStaleTopics,
		topicMetaMany,
		upsertTopic,
		upsertTopicAliases,
		upsertTopicRelated,
	} = { ...api, ...deps } as Deps;

	function listRepoRefs(onlyActive?: boolean): RepoMini[] {
		return listRepoRefsFromDb(onlyActive);
	}

	function enrichAllRepoTopics(opts?: {
		onlyActive?: boolean;
		ttlDays?: number;
	}): { repos: number; unique_topics: number; refreshed: number } {
		const TTL_DAYS = Number(Bun.env.TOPIC_TTL_DAYS ?? 30);
		const CONCURRENCY_REPOS = Number(Bun.env.TOPIC_REPO_CONCURRENCY ?? 4);

		const ttlDays = opts?.ttlDays ?? TTL_DAYS;
		const rows = listRepoRefsFromDb(opts?.onlyActive);
		if (!rows.length) return { repos: 0, unique_topics: 0, refreshed: 0 };

		const refs: RepoRef[] = buildRepoRefs(rows);

		// DB-only: collect topics from repo.topics JSON (no network)
		const topicsByRepo = repoTopicsMany(refs, {
			concurrency: CONCURRENCY_REPOS,
		});

		const universe = reconcileRowsAndCollectUniverse(
			rows,
			topicsByRepo,
			normalizeTopics,
			reconcileRepoTopics,
		);

		const refreshed = refreshStaleTopicMeta(
			universe,
			ttlDays,
			selectStaleTopics,
			topicMetaMany,
			upsertTopic,
			upsertTopicAliases,
			upsertTopicRelated,
		);

		return { repos: rows.length, unique_topics: universe.size, refreshed };
	}

	return { listRepoRefs, enrichAllRepoTopics };
}
