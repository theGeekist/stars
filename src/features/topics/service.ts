import type { Statement } from "bun:sqlite";
import { db } from "@lib/db";
import {
	normalizeTopics,
	type RepoRef,
	reconcileRepoTopics,
	repoTopicsMany,
	selectStaleTopics,
	topicMetaMany,
	upsertTopic,
} from "./api";

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

export function createTopicsService() {
	function listRepoRefs(onlyActive?: boolean): RepoMini[] {
		prepare();
		return (onlyActive ? qReposActive : qReposAll).all();
	}

	async function enrichAllRepoTopics(opts?: {
		onlyActive?: boolean;
		ttlDays?: number;
	}) {
		const TTL_DAYS = Number(Bun.env.TOPIC_TTL_DAYS ?? 30);
		const CONCURRENCY_REPOS = Number(Bun.env.TOPIC_REPO_CONCURRENCY ?? 4);
		const CONCURRENCY_TOPICS = Number(Bun.env.TOPIC_META_CONCURRENCY ?? 3);

		const ttlDays = opts?.ttlDays ?? TTL_DAYS;
		const rows = listRepoRefs(opts?.onlyActive);
		if (!rows.length) return { repos: 0, unique_topics: 0, refreshed: 0 };

		const token = Bun.env.GITHUB_TOKEN ?? "";
		if (!token) throw new Error("GITHUB_TOKEN not set");

		const refs: RepoRef[] = rows.map((r) => {
			const [owner, name] = (r.name_with_owner || "").split("/");
			if (!owner || !name)
				throw new Error(`Invalid name_with_owner: ${r.name_with_owner}`);
			return { owner, name };
		});

		const topicsByRepo = await repoTopicsMany(token, refs, {
			concurrency: CONCURRENCY_REPOS,
		});

		const universe = new Set<string>();
		for (const r of rows) {
			const key = r.name_with_owner;
			const ts = normalizeTopics(topicsByRepo.get(key) ?? []);
			reconcileRepoTopics(r.id, ts);
			ts.forEach((t) => {
				universe.add(t);
			});
		}

		const stale = selectStaleTopics(JSON.stringify([...universe]), ttlDays).map(
			(x) => x.topic,
		);
		if (!stale.length)
			return { repos: rows.length, unique_topics: universe.size, refreshed: 0 };

		const metaMap = await topicMetaMany(token, stale, {
			concurrency: CONCURRENCY_TOPICS,
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

		return { repos: rows.length, unique_topics: universe.size, refreshed };
	}

	return { listRepoRefs, enrichAllRepoTopics };
}
