// src/jobs/enrich-topics.ts
import { db } from "./lib/db";
import type { Statement } from "bun:sqlite";
import {
	reconcileRepoTopics,
	upsertTopic,
	selectStaleTopics,
	repoTopicsMany,
	topicMetaMany,
	normalizeTopics,
	type RepoRef,
} from "./lib/topics";

// ---- Config ------------------------------------------------------------------
const TTL_DAYS = Number(Bun.env.TOPIC_TTL_DAYS ?? 30);
const CONCURRENCY_REPOS = Number(Bun.env.TOPIC_REPO_CONCURRENCY ?? 4);
const CONCURRENCY_TOPICS = Number(Bun.env.TOPIC_META_CONCURRENCY ?? 3);

// ---- Queries (same pattern as summarise_batch) -------------------------------
type RepoMini = { id: number; name_with_owner: string };

let qReposAll!: Statement<RepoMini, []>;
let qReposActive!: Statement<RepoMini, []>;

function prepareQueries(): void {
	if (qReposAll && qReposActive) return;

	qReposAll = db.query<RepoMini, []>(`
    SELECT id, name_with_owner
    FROM repo
  `);

	qReposActive = db.query<RepoMini, []>(`
    SELECT id, name_with_owner
    FROM repo
    WHERE is_archived = 0
  `);
}

// ---- Main job ---------------------------------------------------------------
export async function enrichAllRepoTopics(opts?: {
	onlyActive?: boolean;
	ttlDays?: number;
}): Promise<void> {
	prepareQueries();

	const ttlDays = opts?.ttlDays ?? TTL_DAYS;
	const rows = (opts?.onlyActive ? qReposActive : qReposAll).all();
	if (!rows.length) {
		console.log("No repos to process.");
		return;
	}

	const token = Bun.env.GITHUB_TOKEN!;
    const refs: RepoRef[] = rows.map((r) => {
        const [owner, name] = (r.name_with_owner || "").split("/");
        if (!owner || !name) throw new Error(`Invalid name_with_owner: ${r.name_with_owner}`);
        return { owner, name };
    });

	// 1) Fetch per-repo topics
	const topicsByRepo = await repoTopicsMany(token, refs, {
		concurrency: CONCURRENCY_REPOS,
	});

	// 2) Persist mapping + collect unique universe
	const universe = new Set<string>();
    for (const r of rows) {
        const key = r.name_with_owner;
        const ts = normalizeTopics(topicsByRepo.get(key) ?? []);
        reconcileRepoTopics(r.id, ts);
        ts.forEach((t) => universe.add(t));
    }

	// 3) Figure out which topics need metadata (missing or TTL-expired)
	const stale = selectStaleTopics(JSON.stringify([...universe]), ttlDays).map(
		(x) => x.topic,
	);
	if (!stale.length) {
		console.log(
			`Topic metadata up-to-date. repos=${rows.length} unique_topics=${universe.size}`,
		);
		return;
	}

	// 4) Fetch metadata once per stale topic
	const metaMap = await topicMetaMany(token, stale, {
		concurrency: CONCURRENCY_TOPICS,
	});

	// 5) Upsert topics table
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
			continue;
		}
		upsertTopic({
			topic: m.name || t,
			display_name: m.displayName ?? m.name ?? t,
			short_description: m.shortDescription ?? null,
			aliases: m.aliases ?? [],
			is_featured: !!m.isFeatured,
		});
	}

	console.log(
		`Topics enriched: repos=${rows.length} unique_topics=${universe.size} refreshed=${stale.length}`,
	);
}

// CLI entry
if (import.meta.main) {
	const onlyActive = Bun.argv.includes("--active");
	const ttlIdx = Bun.argv.indexOf("--ttl");
	const ttl =
		ttlIdx > -1 && Bun.argv[ttlIdx + 1]
			? Number(Bun.argv[ttlIdx + 1])
			: undefined;

	console.log(
		`Enrich topics: onlyActive=${onlyActive} ttlDays=${ttl ?? TTL_DAYS}`,
	);
	await enrichAllRepoTopics({ onlyActive, ttlDays: ttl });
}
