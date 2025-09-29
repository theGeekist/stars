import type { Database } from "bun:sqlite";
import { makeCreateService } from "@lib/create-service";
import { withDB } from "@lib/db";
import * as api from "./api";
import type { Deps, RepoMini, RepoRef } from "./types";

/* ── Small helpers ──────────────────────────────────────────────────────── */
function getConfiguredTtlDays(override?: number): number {
	const envTtl = Number(Bun.env.TOPIC_TTL_DAYS ?? 30);
	return override ?? envTtl;
}

function getConfiguredRepoConcurrency(): number {
	return Number(Bun.env.TOPIC_REPO_CONCURRENCY ?? 4);
}

export function listRepoRefsFromDb(
	onlyActive?: boolean,
	database?: Database,
): RepoMini[] {
	const db = withDB(database);
	const q = db.query<RepoMini, []>(
		onlyActive
			? `SELECT id, name_with_owner, is_archived FROM repo WHERE is_archived = 0`
			: `SELECT id, name_with_owner, is_archived FROM repo`,
	);
	return q.all();
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

function getTopicsByRepo(
	refs: RepoRef[],
	repoTopicsMany: typeof api.repoTopicsMany,
	concurrency: number,
	db: Database | undefined,
): Map<string, string[]> {
	return repoTopicsMany(
		refs,
		{
			concurrency,
		},
		db,
	);
}

function bindDbToDeps(db: Database | undefined, deps: Deps) {
	return {
		selectStaleTopics: ((u: string, t: number) =>
			deps.selectStaleTopics(u, t, db)) as typeof api.selectStaleTopics,
		upsertTopic: ((row: Parameters<typeof api.upsertTopic>[0]) =>
			deps.upsertTopic(row, db)) as typeof api.upsertTopic,
		upsertTopicAliases: ((topic: string, aliases: string[]) =>
			deps.upsertTopicAliases(
				topic,
				aliases,
				db,
			)) as typeof api.upsertTopicAliases,
		upsertTopicRelated: ((topic: string, related: string[]) =>
			deps.upsertTopicRelated(
				topic,
				related,
				db,
			)) as typeof api.upsertTopicRelated,
		reconcileRepoTopics: ((id: number, ts: string[]) =>
			deps.reconcileRepoTopics(id, ts, db)) as typeof api.reconcileRepoTopics,
	};
}

/* ── Deps type is defined in ./types ────────────────────────────────────── */

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

// For production use with standard dependency injection
export const createTopicsService = makeCreateService(({ db }) => {
	return createTopicsServiceInternal({}, db);
});

// Internal service factory that allows full customization for tests
export function createTopicsServiceInternal(
	deps: Partial<Deps> = {},
	database?: Database,
) {
	const db = withDB(database);
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
		return listRepoRefsFromDb(onlyActive, db);
	}

	function enrichAllRepoTopics(opts?: {
		onlyActive?: boolean;
		ttlDays?: number;
	}): { repos: number; unique_topics: number; refreshed: number } {
		const ttlDays = getConfiguredTtlDays(opts?.ttlDays);
		const concurrency = getConfiguredRepoConcurrency();

		const rows = listRepoRefsFromDb(opts?.onlyActive, db);
		if (!rows.length) return { repos: 0, unique_topics: 0, refreshed: 0 };

		const refs: RepoRef[] = buildRepoRefs(rows);

		const topicsByRepo = getTopicsByRepo(refs, repoTopicsMany, concurrency, db);

		const bound = bindDbToDeps(db, {
			normalizeTopics,
			reconcileRepoTopics,
			repoTopicsMany,
			selectStaleTopics,
			topicMetaMany,
			upsertTopic,
			upsertTopicAliases,
			upsertTopicRelated,
		});

		const universe = reconcileRowsAndCollectUniverse(
			rows,
			topicsByRepo,
			normalizeTopics,
			bound.reconcileRepoTopics,
		);

		const refreshed = refreshStaleTopicMeta(
			universe,
			ttlDays,
			bound.selectStaleTopics,
			topicMetaMany,
			bound.upsertTopic,
			bound.upsertTopicAliases,
			bound.upsertTopicRelated,
		);

		return { repos: rows.length, unique_topics: universe.size, refreshed };
	}

	return { listRepoRefs, enrichAllRepoTopics };
}
