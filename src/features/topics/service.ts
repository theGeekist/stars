// src/features/topics/service.ts
import type { Statement } from "bun:sqlite";
import { db, initSchema } from "@lib/db";
import * as api from "./api";
import type { Deps, RepoMini, RepoRef } from "./types";

let qReposAll!: Statement<RepoMini, []>;
let qReposActive!: Statement<RepoMini, []>;
initSchema();
function prepare() {
	if (qReposAll && qReposActive) return;
	qReposAll = db.query<RepoMini, []>(
		`SELECT id, name_with_owner, is_archived FROM repo`,
	);
	qReposActive = db.query<RepoMini, []>(
		`SELECT id, name_with_owner, is_archived FROM repo WHERE is_archived = 0`,
	);
}

/* ── Small helpers to keep createTopicsService lean ──────────────────────── */
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

export function refreshStaleTopicMeta(
	universe: Set<string>,
	ttlDays: number,
	selectStaleTopics: typeof api.selectStaleTopics,
	topicMetaMany: typeof api.topicMetaMany,
	upsertTopic: typeof api.upsertTopic,
	_topicConcurrency = Number(Bun.env.TOPIC_META_CONCURRENCY ?? 3),
): number {
	const stale = selectStaleTopics(JSON.stringify([...universe]), ttlDays).map(
		(x) => x.topic,
	);
	if (!stale.length) return 0;

	const metaMap = topicMetaMany(stale, {});
	let refreshed = 0;

	for (const t of stale) {
		const m = metaMap.get(t);

		if (!m) {
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
			});
			// no aliases/related for unknown meta
			refreshed++;
			continue;
		}

		const canonical = m.name || t;

		upsertTopic({
			topic: canonical,
			display_name: m.displayName ?? canonical,
			short_description: m.shortDescription ?? null,
			long_description_md: m.longDescriptionMd ?? null,
			is_featured: !!m.isFeatured,
			created_by: m.createdBy ?? null,
			released: m.released ?? null,
			wikipedia_url: m.wikipediaUrl ?? null,
			logo: m.logo ?? null,
		});

		// NEW: persist aliases + related
		api.upsertTopicAliases(canonical, m.aliases ?? []);
		api.upsertTopicRelated(canonical, m.related ?? []);

		refreshed++;
	}
	return refreshed;
}

export function createTopicsService(deps: Partial<Deps> = {}) {
	const {
		normalizeTopics,
		reconcileRepoTopics,
		repoTopicsMany,
		selectStaleTopics,
		topicMetaMany,
		upsertTopic,
	} = { ...api, ...deps } as Deps;

	function listRepoRefs(onlyActive?: boolean): RepoMini[] {
		return listRepoRefsFromDb(onlyActive);
	}

	function enrichAllRepoTopics(opts?: {
		onlyActive?: boolean;
		ttlDays?: number;
	}) {
		const TTL_DAYS = Number(Bun.env.TOPIC_TTL_DAYS ?? 30);
		const ttlDays = opts?.ttlDays ?? TTL_DAYS;

		const rows = listRepoRefsFromDb(opts?.onlyActive);
		if (!rows.length) return { repos: 0, unique_topics: 0, refreshed: 0 };

		const refs: RepoRef[] = buildRepoRefs(rows);
		const topicsByRepo = repoTopicsMany(refs, {});
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
		);

		return { repos: rows.length, unique_topics: universe.size, refreshed };
	}

	return { listRepoRefs, enrichAllRepoTopics };
}
