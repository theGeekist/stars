import type { Statement } from "bun:sqlite";
import { db } from "@lib/db";
import type { RepoRef } from "./api";
import * as api from "./api";

type RepoMini = { id: number; name_with_owner: string; is_archived: number };

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

// ── Small helpers to keep createTopicsService lean ──────────────────────────
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

export async function refreshStaleTopicMeta(
	token: string,
	universe: Set<string>,
	ttlDays: number,
	selectStaleTopics: typeof api.selectStaleTopics,
	topicMetaMany: typeof api.topicMetaMany,
	upsertTopic: typeof api.upsertTopic,
	topicConcurrency = Number(Bun.env.TOPIC_META_CONCURRENCY ?? 3),
): Promise<number> {
	const stale = selectStaleTopics(JSON.stringify([...universe]), ttlDays).map(
		(x) => x.topic,
	);
	if (!stale.length) return 0;

	const metaMap = await topicMetaMany(token, stale, {
		concurrency: topicConcurrency,
	});
	let refreshed = 0;
	for (const t of stale) {
		const m = metaMap.get(t);
		if (!m) {
			upsertTopic({
				topic: t,
				display_name: t,
				short_description: null,
				aliases: [],
				is_featured: false,
			});
			refreshed++;
			continue;
		}
		upsertTopic({
			topic: m.name || t,
			display_name: m.displayName ?? m.name ?? t,
			short_description: m.shortDescription ?? null,
			aliases: m.aliases ?? [],
			is_featured: !!m.isFeatured,
		});
		refreshed++;
	}
	return refreshed;
}

type Deps = {
	normalizeTopics: typeof api.normalizeTopics;
	reconcileRepoTopics: typeof api.reconcileRepoTopics;
	repoTopicsMany: typeof api.repoTopicsMany;
	selectStaleTopics: typeof api.selectStaleTopics;
	topicMetaMany: typeof api.topicMetaMany;
	upsertTopic: typeof api.upsertTopic;
};

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

	async function enrichAllRepoTopics(opts?: {
		onlyActive?: boolean;
		ttlDays?: number;
	}) {
		const TTL_DAYS = Number(Bun.env.TOPIC_TTL_DAYS ?? 30);
		const CONCURRENCY_REPOS = Number(Bun.env.TOPIC_REPO_CONCURRENCY ?? 4);

		const ttlDays = opts?.ttlDays ?? TTL_DAYS;
		const rows = listRepoRefsFromDb(opts?.onlyActive);
		if (!rows.length) return { repos: 0, unique_topics: 0, refreshed: 0 };

		const token = Bun.env.GITHUB_TOKEN ?? "";
		if (!token) throw new Error("GITHUB_TOKEN not set");

		const refs: RepoRef[] = buildRepoRefs(rows);

		const topicsByRepo = await repoTopicsMany(token, refs, {
			concurrency: CONCURRENCY_REPOS,
		});

		const universe = reconcileRowsAndCollectUniverse(
			rows,
			topicsByRepo,
			normalizeTopics,
			reconcileRepoTopics,
		);

		const refreshed = await refreshStaleTopicMeta(
			token,
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
